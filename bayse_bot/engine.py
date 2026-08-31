"""Bayse Bot Trading Engine.

Now uses repository pattern for all persistence.
Supports PostgreSQL (production) and SQLite (development).
"""
from __future__ import annotations
from datetime import datetime, timezone
import asyncio, logging
from decimal import Decimal
from .bayse import BayseClient, parse_book, parse_quote
from .bayse_market_ws import BayseMarketFeed
from .config import Settings
from .contract import ContractState, build_contract_state
from .feed import MarketState
from .market import adapt_market, validate_market
from .models import BTCFeatures, BookLevel, Market, OrderBook, Outcome, RunMode, EventType
from .predictions import PredictionRecord, PredictionRecorder
from .repositories import RepositorySet
from .resolution import ResolutionTracker
from .risk import RiskManager
from .strategy import StrategyInput, strategy_by_name

log = logging.getLogger(__name__)


def _dec(v, default="0"):
    from decimal import Decimal, InvalidOperation
    try:
        return Decimal(str(v)) if v is not None else Decimal(default)
    except (InvalidOperation, ValueError):
        return Decimal(default)

# Map Bayse outcome labels to our internal Outcome enum
_LABEL_TO_OUTCOME = {"up": Outcome.YES, "down": Outcome.NO, "yes": Outcome.YES, "no": Outcome.NO}
_OUTCOME_TO_LABEL = {Outcome.YES: "YES", Outcome.NO: "NO"}


def _outcome_for(market: Market, label: str) -> Outcome | None:
    """Map a Bayse outcome label (Up/Down/Yes/No) to our Outcome enum."""
    return _LABEL_TO_OUTCOME.get(label.lower())


def _book_index(market: Market, outcome: Outcome) -> int:
    """Return 0 for first outcome (Up/Yes), 1 for second (Down/No)."""
    if outcome is Outcome.YES:
        return 0
    return 1


class Bot:
    """Trading engine with repository-backed persistence."""

    def __init__(
        self,
        settings: Settings,
        client: BayseClient,
        state: MarketState,
        repos: RepositorySet,
        market_feed: BayseMarketFeed | None = None,
    ):
        self.s = settings
        self.client = client
        self.state = state
        self.market_feed = market_feed
        self.repos = repos
        self.risk = RiskManager(settings, repos.risk)
        self.strategy = strategy_by_name(settings.strategy)
        self.pred_rec = PredictionRecorder(repos.predictions)
        self.resolver = ResolutionTracker(repos.predictions, repos.market_outcome)

    async def initialize(self) -> None:
        """Load persisted state on startup."""
        await self.risk.load()
        log.info("risk state loaded: active=%s uncertain=%s",
            self.risk.state.active_market_id,
            self.risk.state.uncertain_market_ids)

    async def scan_once(self) -> None:
        """Single scan cycle."""
        # Check for resolved predictions first
        await self._check_resolutions()

        # Primary: series-based discovery (faster, more precise)
        # Fallback: full event scan (if series fails or returns nothing)
        events = []
        try:
            events = await self.client.events_by_series(self.s.series_slug)
            if events:
                log.info("scan: series=%s -> %d events", self.s.series_slug, len(events))
        except Exception as exc:
            log.warning("series discovery failed: %s: %s, falling back to full scan", type(exc).__name__, exc)

        if not events:
            events = await self.client.events()
            log.info("scan: full scan -> %d open events", len(events))

        last_market = None
        for event in events:
            for raw_market in event.get("markets", []):
                market = adapt_market(event, raw_market)
                # Store outcome IDs for WS resolution
                if self.market_feed and market.outcome1_id and market.outcome2_id:
                    self.market_feed.store.store_outcome_ids(
                        market.market_id, market.outcome1_id, market.outcome2_id
                    )
                reasons = validate_market(market, self.s)
                if reasons:
                    await self.repos.event_log.log_event(
                        EventType.CANDIDATE_REJECTED,
                        market_id=market.market_id,
                        title=market.title,
                        reasons=reasons,
                    )
                    continue
                log.info("scan: evaluating %s (strike=%s)", market.title[:40], market.strike_price)
                await self.evaluate_market(market)
                last_market = market

        # Store timing from the last evaluated market for adaptive interval
        if last_market:
            self._last_market_opens_at = last_market.opens_at
            self._last_market_closes_at = last_market.closes_at

    def _adaptive_interval(self) -> int:
        """Determine scan interval based on market lifecycle position.

        Market window: 15 minutes (900 seconds)
        Phase 1 (0-180s from open):  15s — market forming, capture initial move
        Phase 2 (180-720s):          60s — stable, save API calls
        Phase 3 (720-900s):          15s — resolution window, capture final state
        Default: 30s when no market timing available.
        """
        if not getattr(self, "_last_market_opens_at", None) or not getattr(self, "_last_market_closes_at", None):
            return 30

        now = datetime.now(timezone.utc)
        opens_at = self._last_market_opens_at
        closes_at = self._last_market_closes_at

        seconds_elapsed = (now - opens_at).total_seconds()
        seconds_remaining = (closes_at - now).total_seconds()

        # Market has closed or hasn't opened yet
        if seconds_remaining <= 0 or seconds_elapsed < 0:
            return 30

        if seconds_elapsed <= 180:
            return 15   # Phase 1: market forming
        elif seconds_elapsed <= 720:
            return 60   # Phase 2: stable
        else:
            return 15   # Phase 3: resolution window

    async def run(self, stop: asyncio.Event, interval_seconds: int = 15) -> None:
        """Worker loop. Uses adaptive scan interval based on market lifecycle.

        Phase 1 (0-180s from open):  15s — market forming
        Phase 2 (180-720s):          60s — stable, save API calls
        Phase 3 (720-900s):          15s — resolution window
        Default: 30s when no market timing available.
        """
        try:
            await self.initialize()
        except Exception as exc:
            log.error("initialize failed: %s: %s", type(exc).__name__, exc)
            return

        self._last_market_opens_at = None
        self._last_market_closes_at = None

        while not stop.is_set():
            btc = self.state.btc_features
            log.info("--- cycle | BTC=$%.2f momentum=%.4f%% vol_ratio=%.2f atr=%.4f%% complete=%s",
                btc.price, btc.momentum_pct, btc.volume_ratio, btc.atr_pct, btc.complete)

            # Each attempt gets its own session. On failure, we abandon it entirely
            # (close + discard) and create a fresh one next attempt. This prevents
            # "prepared" state corruption from leaking between cycles.
            for attempt in range(3):
                cycle_session = self.repos._session_factory()
                self.repos.set_shared_session(cycle_session)
                try:
                    await self.repos.bot_status.update_status({
                        "is_running": True,
                        "last_cycle_at": datetime.now(timezone.utc),
                        "last_btc_price": btc.price,
                        "last_momentum_pct": btc.momentum_pct,
                        "last_volatility": btc.atr_pct,
                    })

                    await asyncio.wait_for(self.scan_once(), timeout=25)
                    await cycle_session.commit()
                    break  # success

                except asyncio.TimeoutError:
                    log.warning("scan_once timed out (attempt %d/3)", attempt + 1)
                except Exception as exc:
                    log.warning("scan_failure (attempt %d/3): %s: %s", attempt + 1, type(exc).__name__, exc)
                finally:
                    self.repos.clear_shared_session()
                    try:
                        await cycle_session.close()
                    except Exception:
                        pass

                # Wait before retrying (don't hammer the DB)
                try:
                    await asyncio.wait_for(stop.wait(), timeout=5)
                except asyncio.TimeoutError:
                    pass
            else:
                # All 3 attempts failed
                try:
                    await self.repos.event_log.log_event(
                        EventType.SCAN_FAILURE,
                        error="all_attempts_failed",
                        detail="3 consecutive scan failures",
                    )
                except Exception:
                    pass

            # Increment cycle counter
            try:
                from api.shared import bot_diagnostics
                bot_diagnostics["cycles"] += 1
            except Exception:
                pass

            # Adaptive interval based on market lifecycle
            adaptive_interval = self._adaptive_interval()
            log.info("next scan in %ds (adaptive)", adaptive_interval)

            try:
                await asyncio.wait_for(stop.wait(), timeout=adaptive_interval)
            except asyncio.TimeoutError:
                pass

    async def _check_resolutions(self) -> None:
        """Check for resolved predictions and update records."""
        try:
            resolved_events = await self.client.resolved_events(self.s.series_slug)
            if not resolved_events:
                log.debug("no resolved events from Bayse API")
                return

            log.info("resolution check: %d resolved events from Bayse", len(resolved_events))
            resolved_count, resolved_market_ids = await self.resolver.resolve_from_events(resolved_events)
            if resolved_count > 0:
                log.info("resolved %d predictions", resolved_count)

                # Log calibration stats periodically
                stats = await self.resolver.calibration_stats()
                if stats["resolved"] > 0:
                    log.info("calibration: %d/%d resolved brier_mean=%s",
                        stats["resolved"], stats["total"], stats["brier_mean"])

                # Close risk manager position if the resolved market was active
                active_id = self.risk.state.active_market_id
                if active_id and active_id in resolved_market_ids:
                    pnl = await self._compute_resolution_pnl(active_id)
                    await self.risk.closed(pnl)
                    log.info("risk: closed active position %s pnl=%s", active_id, pnl)
            else:
                log.info("resolution: %d resolved events but 0 predictions matched", len(resolved_events))

        except Exception as exc:
            log.warning("resolution_check_failed: %s: %s", type(exc).__name__, exc)

    async def _compute_resolution_pnl(self, market_id: str) -> Decimal | None:
        """Compute PnL for a resolved market from the trades table.

        Returns (payout - cost) for the trade, or None if no trade found.
        Binary market: payout = amount / price if won, 0 if lost.
        """
        try:
            trade = await self.repos.trades.get_trade_by_market(market_id)
            if not trade:
                log.warning("resolution: no trade found for market %s", market_id)
                return None

            # Get the outcome resolution
            outcome = await self.repos.market_outcome.get_outcome(market_id)
            if not outcome:
                log.warning("resolution: no outcome found for market %s", market_id)
                return None

            trade_outcome = trade.get("outcome", "")
            resolved_won = outcome.get("outcome_resolution", "")

            # Trade wins if our outcome matches the resolved outcome
            won = trade_outcome == resolved_won
            amount = Decimal(str(trade.get("amount", 0)))
            price = Decimal(str(trade.get("price", 0)))

            if price <= 0:
                return None

            payout = amount / price if won else Decimal("0")
            pnl = payout - amount
            return pnl

        except Exception as exc:
            log.warning("pnl_computation_failed: %s: %s", market_id, exc)
            return None

    async def evaluate_market(self, market: Market) -> None:
        """Evaluate a single market for trading opportunity.

        Book source priority:
        1. MarketStateStore (WS) — fresh books from live feed
        2. REST API — fallback when WS is stale or missing
        """
        try:
            o1_id = market.outcome1_id
            o2_id = market.outcome2_id
            if not o1_id or not o2_id:
                await self.repos.event_log.log_event(
                    EventType.CANDIDATE_REJECTED,
                    market_id=market.market_id,
                    reasons=["missing_outcome_ids"],
                )
                return

            source = "ws"
            # Try WS store first — check freshness
            store = self.market_feed.store if self.market_feed else None
            if store and store.has_fresh_books(market.market_id):
                books = store.get_books(market.market_id)
                yes = books.get(Outcome.YES)
                no = books.get(Outcome.NO)
                if yes and no:
                    log.info("  books from WS store (age_yes=%.0fms age_no=%.0fms)",
                        store.book_age_ms(market.market_id, Outcome.YES) or 0,
                        store.book_age_ms(market.market_id, Outcome.NO) or 0)
                else:
                    source = "rest"
            else:
                source = "rest"

            # Fallback to REST if WS books unavailable
            if source == "rest":
                books_raw = await self.client.book([o1_id, o2_id])
                if isinstance(books_raw, list) and len(books_raw) >= 2:
                    yes = parse_book(books_raw[0], market.market_id, Outcome.YES)
                    no = parse_book(books_raw[1], market.market_id, Outcome.NO)
                    log.info("  books from REST API")
                else:
                    # Use market last-trade prices as final fallback
                    raw_market = market.raw.get("market", {}) if market.raw else {}
                    y_price = _dec(raw_market.get("outcome1Price"), "0.5")
                    n_price = _dec(raw_market.get("outcome2Price"), "0.5")
                    now = datetime.now(timezone.utc)
                    spread = Decimal("0.01")
                    yes = OrderBook(market.market_id, Outcome.YES,
                        (BookLevel(y_price - spread, Decimal("1")),),
                        (BookLevel(y_price + spread, Decimal("1")),), now)
                    no = OrderBook(market.market_id, Outcome.NO,
                        (BookLevel(n_price - spread, Decimal("1")),),
                        (BookLevel(n_price + spread, Decimal("1")),), now)
                    log.info("  no book data, using last-trade prices: YES=%s NO=%s", y_price, n_price)

            # Build contract state
            spread = yes.spread
            contract = build_contract_state(market, self.state.btc_features, yes.best_ask, no.best_ask, spread)
            if contract:
                log.info("  contract: strike=$%s BTC=$%s dist=%.3f%% above=%s time_left=%ds/%ds",
                    contract.strike_price, contract.current_btc_price,
                    contract.distance_from_strike_pct, contract.is_above_strike,
                    contract.seconds_remaining, contract.seconds_elapsed + contract.seconds_remaining)

            # Check book quality (skip liquidity check in observation mode — we just want training data)
            reasons = []
            for b in (yes, no):
                if not b.best_ask or not b.best_bid:
                    reasons.append("empty_book")
                elif b.best_bid >= b.best_ask:
                    reasons.append("crossed_book")
                elif b.spread and b.spread > self.s.max_spread:
                    reasons.append("spread_too_wide")
                elif b.relative_spread and b.relative_spread > self.s.max_relative_spread:
                    reasons.append("relative_spread_too_wide")
                elif self.s.mode is not RunMode.OBSERVATION and b.depth_at_or_better("BUY", b.best_ask) < self.s.min_liquidity:
                    reasons.append("insufficient_entry_depth")

            if reasons:
                await self.repos.event_log.log_event(
                    EventType.BOOK_ISSUES,
                    market_id=market.market_id,
                    reasons=reasons,
                )
                log.info("  book issues: %s", reasons)
                return

            # Evaluate strategy
            decision = self.strategy.evaluate(
                StrategyInput(self.state.btc_features, yes.best_ask, no.best_ask, contract),
                self.s,
            )
            risk_reasons = await self.risk.approve(market.market_id)
            reasons = list(decision.reasons) + risk_reasons

            # Record every prediction (regardless of approval)
            if contract:
                now = datetime.now(timezone.utc)
                pred = PredictionRecord(
                    market_id=market.market_id,
                    event_id=market.event_id,
                    title=market.title,
                    strike_price=contract.strike_price,
                    current_btc_price=contract.current_btc_price,
                    distance_from_strike_pct=contract.distance_from_strike_pct,
                    is_above_strike=contract.is_above_strike,
                    seconds_remaining=contract.seconds_remaining,
                    seconds_elapsed=contract.seconds_elapsed,
                    realized_volatility=contract.realized_volatility,
                    momentum_pct=contract.momentum_pct,
                    yes_ask=yes.best_ask,
                    no_ask=no.best_ask,
                    spread=contract.spread,
                    strategy=decision.strategy,
                    probability=decision.probability,
                    predicted_outcome=decision.outcome.value if decision.outcome else "",
                    edge=decision.edge,
                    edge_fee=decision.edge_fee,
                    bayse_implied=yes.best_ask if decision.outcome and decision.outcome.value == "YES" else no.best_ask,
                    signal_strength=decision.strength,
                    approved=decision.approved,
                    reasons=tuple(reasons),
                    # Timestamps
                    observed_at=now,
                    decided_at=now,
                    # Contract timing
                    opened_at=contract.opened_at if hasattr(contract, 'opened_at') else None,
                    closes_at=contract.closes_at if hasattr(contract, 'closes_at') else None,
                    volume_ratio=contract.volume_ratio if hasattr(contract, 'volume_ratio') else Decimal("0"),
                    # Outcome IDs (for resolution mapping)
                    outcome1_id=market.outcome1_id or "",
                    outcome2_id=market.outcome2_id or "",
                )
                await self.pred_rec.record(pred)

                # Update bot status prediction count
                try:
                    from sqlalchemy import select, func
                    from api.models import Prediction
                    async with self.repos.predictions._session() as s:
                        total = (await s.execute(select(func.count(Prediction.id)))).scalar() or 0
                    await self.repos.bot_status.update_status({"total_predictions": total})
                except Exception:
                    pass

            # Log decision
            await self.repos.event_log.log_event(
                EventType.MARKET_EVALUATED,
                market_id=market.market_id,
                strategy=decision.strategy,
                probability=str(decision.probability) if decision.probability else None,
                edge=str(decision.edge) if decision.edge else None,
                approved=decision.approved and not reasons,
                reasons=reasons,
            )

            log.info("  %s | YES ask=%s NO ask=%s | model=%.2f%% edge=%s | %s %s",
                market.title[:30], yes.best_ask, no.best_ask,
                (decision.probability or 0) * 100, decision.edge,
                decision.outcome,
                "APPROVED" if decision.approved and not reasons else f"REJECTED: {reasons}")

            if not decision.approved or reasons or self.s.mode is RunMode.OBSERVATION:
                return

            await self._execute(market, decision.outcome, yes if decision.outcome is Outcome.YES else no)

        except Exception as exc:
            log.warning("market_evaluation_failure: %s: %s", market.market_id, exc)
            await self.repos.event_log.log_event(
                EventType.MARKET_EVALUATION_FAILURE,
                market_id=market.market_id,
                error=type(exc).__name__,
                detail=str(exc),
            )

    async def _execute(self, market: Market, outcome: Outcome, book) -> None:
        """Execute a trade."""
        assert outcome and book.best_ask

        # Determine the outcome ID for the selected outcome
        outcome_id = market.outcome1_id if outcome is Outcome.YES else market.outcome2_id
        body = {
            "side": "BUY",
            "outcomeId": outcome_id,
            "amount": float(self.s.position_size),
            "type": "LIMIT",
            "price": float(book.best_ask),
            "currency": self.s.currency,
            "timeInForce": "FOK",
        }

        quote = parse_quote(
            await self.client.quote(market.event_id, market.market_id, body),
            "BUY",
            outcome,
        )
        age = (datetime.now(timezone.utc) - quote.captured_at).total_seconds()
        reasons = []

        if not quote.complete_fill:
            reasons.append("quote_not_complete_fill")
        if age > self.s.quote_max_age:
            reasons.append("stale_quote")
        if abs(quote.expected_price - book.best_ask) > self.s.execution_tolerance:
            reasons.append("quote_moved_beyond_tolerance")

        if reasons:
            await self.repos.event_log.log_event(
                EventType.TRADE_ATTEMPT_FAILED,
                market_id=market.market_id,
                reasons=reasons,
            )
            return

        if self.s.mode is RunMode.PAPER:
            await self.risk.opened(market.market_id)
            await self.repos.trades.save_trade({
                "market_id": market.market_id,
                "event_id": market.event_id,
                "outcome": outcome.value,
                "side": "BUY",
                "amount": float(self.s.position_size),
                "price": float(quote.expected_price),
                "shares": float(quote.expected_shares),
                "fee": float(quote.fee),
                "status": "filled",
                "mode": "paper",
            })
            return

        if self.s.mode is RunMode.LIVE:
            await self.risk.opened(market.market_id)
            try:
                order = await self.client.place_order(market.event_id, market.market_id, body)
                await self.repos.trades.save_trade({
                    "market_id": market.market_id,
                    "event_id": market.event_id,
                    "outcome": outcome.value,
                    "side": "BUY",
                    "amount": float(self.s.position_size),
                    "price": float(quote.expected_price),
                    "shares": float(quote.expected_shares),
                    "fee": float(quote.fee),
                    "status": "submitted",
                    "mode": "live",
                    "order_id": order.get("id"),
                })
            except Exception as exc:
                await self.risk.uncertain(market.market_id)
                await self.repos.event_log.log_event(
                    EventType.LIVE_ORDER_AMBIGUOUS,
                    market_id=market.market_id,
                    error=str(exc),
                )
