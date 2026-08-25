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
from .models import BTCFeatures, Market, Outcome, RunMode
from .predictions import PredictionRecord, PredictionRecorder
from .repositories import RepositorySet
from .resolution import ResolutionTracker
from .risk import RiskManager
from .strategy import StrategyInput, strategy_by_name

log = logging.getLogger(__name__)

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
        self.resolver = ResolutionTracker(repos.predictions)

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

        for event in events:
            for raw_market in event.get("markets", []):
                market = adapt_market(event, raw_market)
                reasons = validate_market(market, self.s)
                if reasons:
                    await self.repos.event_log.log_event(
                        "candidate_rejected",
                        market_id=market.market_id,
                        title=market.title,
                        reasons=reasons,
                    )
                    continue
                log.info("scan: evaluating %s (strike=%s)", market.title[:40], market.strike_price)
                await self.evaluate_market(market)

    async def run(self, stop: asyncio.Event, interval_seconds: int = 15) -> None:
        """Worker loop. Individual scan failures are logged, never converted into trades."""
        await self.initialize()

        while not stop.is_set():
            try:
                btc = self.state.btc_features
                log.info("--- cycle | BTC=$%.2f momentum=%.4f%% vol_ratio=%.2f atr=%.4f%% complete=%s",
                    btc.price, btc.momentum_pct, btc.volume_ratio, btc.atr_pct, btc.complete)

                # Update bot status
                await self.repos.bot_status.update_status({
                    "is_running": True,
                    "last_cycle_at": datetime.now(timezone.utc),
                    "last_btc_price": btc.price,
                    "last_momentum_pct": btc.momentum_pct,
                    "last_volatility": btc.atr_pct,
                })

                await self.scan_once()

            except Exception as exc:
                log.warning("scan_failure: %s: %s", type(exc).__name__, exc)
                await self.repos.event_log.log_event(
                    "scan_failure",
                    error=type(exc).__name__,
                    detail=str(exc),
                )

            try:
                await asyncio.wait_for(stop.wait(), timeout=interval_seconds)
            except asyncio.TimeoutError:
                pass

    async def _check_resolutions(self) -> None:
        """Check for resolved predictions and update records."""
        try:
            resolved_events = await self.client.resolved_events(self.s.series_slug)
            if not resolved_events:
                return

            resolved_count = await self.resolver.resolve_from_events(resolved_events)
            if resolved_count > 0:
                log.info("resolved %d predictions", resolved_count)

                # Log calibration stats periodically
                stats = await self.resolver.calibration_stats()
                if stats["resolved"] > 0:
                    log.info("calibration: %d/%d resolved brier_mean=%s",
                        stats["resolved"], stats["total"], stats["brier_mean"])

        except Exception as exc:
            log.warning("resolution_check_failed: %s: %s", type(exc).__name__, exc)

    async def evaluate_market(self, market: Market) -> None:
        """Evaluate a single market for trading opportunity."""
        try:
            # Fetch both outcome books in one call using outcome IDs
            o1_id = market.outcome1_id
            o2_id = market.outcome2_id
            if not o1_id or not o2_id:
                await self.repos.event_log.log_event(
                    "candidate_rejected",
                    market_id=market.market_id,
                    reasons=["missing_outcome_ids"],
                )
                return

            books_raw = await self.client.book([o1_id, o2_id])
            if not isinstance(books_raw, list) or len(books_raw) < 2:
                await self.repos.event_log.log_event(
                    "candidate_rejected",
                    market_id=market.market_id,
                    reasons=["incomplete_book_response"],
                )
                return

            # Parse: first book = Up/Yes, second = Down/No
            yes = parse_book(books_raw[0], market.market_id, Outcome.YES)
            no = parse_book(books_raw[1], market.market_id, Outcome.NO)

            # Build contract state
            spread = yes.spread
            contract = build_contract_state(market, self.state.btc_features, yes.best_ask, no.best_ask, spread)
            if contract:
                log.info("  contract: strike=$%s BTC=$%s dist=%.3f%% above=%s time_left=%ds/%ds",
                    contract.strike_price, contract.current_btc_price,
                    contract.distance_from_strike_pct, contract.is_above_strike,
                    contract.seconds_remaining, contract.seconds_elapsed + contract.seconds_remaining)

            # Check book quality
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
                elif b.depth_at_or_better("BUY", b.best_ask) < self.s.min_liquidity:
                    reasons.append("insufficient_entry_depth")

            if reasons:
                await self.repos.event_log.log_event(
                    "book_issues",
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
                    signal_strength=decision.strength,
                    approved=decision.approved,
                    reasons=tuple(reasons),
                )
                await self.pred_rec.record(pred)

                # Update bot status prediction count
                total = await self.repos.predictions.count_predictions()
                await self.repos.bot_status.update_status({"total_predictions": total})

            # Log decision
            await self.repos.event_log.log_event(
                "market_evaluated",
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
                "market_evaluation_failure",
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
                "trade_attempt_failed",
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
                    "live_order_ambiguous",
                    market_id=market.market_id,
                    error=str(exc),
                )
