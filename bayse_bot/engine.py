from __future__ import annotations
from datetime import datetime, timezone
import asyncio, logging
from decimal import Decimal
from .bayse import BayseClient, parse_book, parse_quote
from .bayse_market_ws import BayseMarketFeed
from .config import Settings
from .feed import MarketState
from .market import adapt_market, validate_market
from .models import BTCFeatures, Market, Outcome, RunMode
from .records import RunRecorder
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
    def __init__(self, settings:Settings, client:BayseClient, state:MarketState, market_feed:BayseMarketFeed|None=None):
        self.s,self.client,self.state,self.market_feed=settings,client,state,market_feed;self.rec=RunRecorder(settings.runs_dir,settings.mode);self.risk=RiskManager(settings);self.strategy=strategy_by_name(settings.strategy)
    async def scan_once(self)->None:
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
            for raw_market in event.get("markets",[]):
                market=adapt_market(event,raw_market); reasons=validate_market(market,self.s)
                if reasons: self.rec.append("candidates",{"record_type":"candidate","market_id":market.market_id,"title":market.title,"reasons":reasons,"data_quality":"rejected_metadata"});continue
                log.info("scan: evaluating %s (strike=%s)", market.title[:40], market.strike_price)
                await self.evaluate_market(market)
    async def run(self, stop: asyncio.Event, interval_seconds: int = 15) -> None:
        """Worker loop. Individual scan failures are logged, never converted into trades."""
        while not stop.is_set():
            try:
                btc = self.state.btc_features
                log.info("--- cycle | BTC=$%.2f momentum=%.4f%% vol_ratio=%.2f atr=%.4f%% complete=%s", btc.price, btc.momentum_pct, btc.volume_ratio, btc.atr_pct, btc.complete)
                await self.scan_once()
            except Exception as exc: log.warning("scan_failure: %s: %s", type(exc).__name__, exc); self.rec.log("scan_failure",error=type(exc).__name__,detail=str(exc))
            try: await asyncio.wait_for(stop.wait(), timeout=interval_seconds)
            except asyncio.TimeoutError: pass
    async def evaluate_market(self,market):
        try:
            # Fetch both outcome books in one call using outcome IDs
            o1_id = market.outcome1_id
            o2_id = market.outcome2_id
            if not o1_id or not o2_id:
                self.rec.append("candidates",{"record_type":"candidate","market_id":market.market_id,"reasons":["missing_outcome_ids"],"data_quality":"rejected_metadata"})
                return

            books_raw = await self.client.book([o1_id, o2_id])
            if not isinstance(books_raw, list) or len(books_raw) < 2:
                self.rec.append("candidates",{"record_type":"candidate","market_id":market.market_id,"reasons":["incomplete_book_response"],"data_quality":"rejected_metadata"})
                return

            # Parse: first book = Up/Yes, second = Down/No
            yes=parse_book(books_raw[0],market.market_id,Outcome.YES)
            no=parse_book(books_raw[1],market.market_id,Outcome.NO)

            reasons=[]
            for b in (yes,no):
                if not b.best_ask or not b.best_bid: reasons.append("empty_book")
                elif b.best_bid>=b.best_ask: reasons.append("crossed_book")
                elif b.spread and b.spread>self.s.max_spread: reasons.append("spread_too_wide")
                elif b.relative_spread and b.relative_spread>self.s.max_relative_spread: reasons.append("relative_spread_too_wide")
                elif b.depth_at_or_better("BUY",b.best_ask)<self.s.min_liquidity: reasons.append("insufficient_entry_depth")
            if reasons: self.rec.append("candidates",{"record_type":"candidate","market_id":market.market_id,"reasons":reasons,"book_yes":yes,"book_no":no,"data_quality":"unexecutable_book"});log.info("  book issues: %s", reasons);return
            decision=self.strategy.evaluate(StrategyInput(self.state.btc_features,yes.best_ask,no.best_ask),self.s)
            reasons=list(decision.reasons)+self.risk.approve(market.market_id)
            record={"record_type":"candidate","experiment_tag":"baseline_unvalidated","strategy":decision.strategy,"strategy_version":"1","market_id":market.market_id,"event_id":market.event_id,"title":market.title,"question":market.question,"engine":market.engine,"currency":market.currency,"strike_price":market.strike_price,"series_slug":market.series_slug,"resolution_rules":market.resolution_rules,"resolution_source":market.resolution_source,"btc":self.state.btc_features,"book_yes":yes,"book_no":no,"decision":decision.approved,"outcome":decision.outcome,"probability":decision.probability,"edge":decision.edge,"signal_strength":decision.strength,"reasons":reasons,"wat_hour":datetime.now().astimezone().hour,"data_quality":"complete"}
            self.rec.append("candidates",record)
            log.info("  %s | YES ask=%s NO ask=%s | model=%.2f%% edge=%s | %s %s", market.title[:30], yes.best_ask, no.best_ask, (decision.probability or 0)*100, decision.edge, decision.outcome, "APPROVED" if decision.approved and not reasons else f"REJECTED: {reasons}")
            if not decision.approved or reasons or self.s.mode is RunMode.OBSERVATION:return
            await self._execute(market,decision.outcome,yes if decision.outcome is Outcome.YES else no)
        except Exception as exc: self.rec.log("market_evaluation_failure",market_id=market.market_id,error=type(exc).__name__,detail=str(exc))
    async def _execute(self,market,outcome,book):
        assert outcome and book.best_ask
        # Determine the outcome ID for the selected outcome
        outcome_id = market.outcome1_id if outcome is Outcome.YES else market.outcome2_id
        body={"side":"BUY","outcomeId":outcome_id,"amount":float(self.s.position_size),"type":"LIMIT","price":float(book.best_ask),"currency":self.s.currency,"timeInForce":"FOK"}
        quote=parse_quote(await self.client.quote(market.event_id,market.market_id,body),"BUY",outcome)
        age=(datetime.now(timezone.utc)-quote.captured_at).total_seconds()
        reasons=[]
        if not quote.complete_fill:reasons.append("quote_not_complete_fill")
        if age>self.s.quote_max_age:reasons.append("stale_quote")
        if abs(quote.expected_price-book.best_ask)>self.s.execution_tolerance:reasons.append("quote_moved_beyond_tolerance")
        if reasons:self.rec.append("trades",{"record_type":"trade_attempt","market_id":market.market_id,"quote":quote,"reasons":reasons});return
        if self.s.mode is RunMode.PAPER:
            self.risk.opened(market.market_id); self.rec.append("trades",{"record_type":"trade","mode":"paper","market_id":market.market_id,"outcome":outcome,"quote":quote,"gross_shares":self.s.position_size/quote.expected_price,"net_shares":quote.expected_shares,"entry_price":quote.expected_price,"fee":quote.fee,"status":"filled","data_quality":"simulated_from_quote"});return
        if self.s.mode is RunMode.LIVE:
            self.risk.opened(market.market_id)
            try:
                order=await self.client.place_order(market.event_id,market.market_id,body)
                self.rec.append("trades",{"record_type":"trade","mode":"live","market_id":market.market_id,"outcome":outcome,"quote":quote,"order":order,"data_quality":"awaiting_reconciliation"})
            except Exception as exc: self.risk.uncertain(market.market_id);self.rec.log("live_order_ambiguous",market_id=market.market_id,error=str(exc))
