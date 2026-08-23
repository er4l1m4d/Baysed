from __future__ import annotations
from datetime import datetime, timezone
import asyncio, logging
from decimal import Decimal
from .bayse import BayseClient, parse_book, parse_quote
from .config import Settings
from .feed import MarketState
from .market import adapt_market, validate_market
from .models import BTCFeatures, Outcome, RunMode
from .records import RunRecorder
from .risk import RiskManager
from .strategy import StrategyInput, strategy_by_name

log = logging.getLogger(__name__)

class Bot:
    def __init__(self, settings:Settings, client:BayseClient, state:MarketState):
        self.s,self.client,self.state=settings,client,state;self.rec=RunRecorder(settings.runs_dir,settings.mode);self.risk=RiskManager(settings);self.strategy=strategy_by_name(settings.strategy)
    async def scan_once(self)->None:
        events=await self.client.events()
        for event in events:
            for raw_market in event.get("markets",[]):
                market=adapt_market(event,raw_market); reasons=validate_market(market,self.s)
                if reasons: self.rec.append("candidates",{"record_type":"candidate","market_id":market.market_id,"title":market.title,"reasons":reasons,"data_quality":"rejected_metadata"});continue
                await self.evaluate_market(market)
    async def run(self, stop: asyncio.Event, interval_seconds: int = 15) -> None:
        """Worker loop. Individual scan failures are logged, never converted into trades."""
        while not stop.is_set():
            try: await self.scan_once()
            except Exception as exc: log.warning("scan_failure: %s: %s", type(exc).__name__, exc); self.rec.log("scan_failure",error=type(exc).__name__,detail=str(exc))
            try: await asyncio.wait_for(stop.wait(), timeout=interval_seconds)
            except asyncio.TimeoutError: pass
    async def evaluate_market(self,market):
        # Safe adapter: both outcome books must exist; missing schema/data is rejected.
        try:
            yes=parse_book(await self.client.book(market.market_id),market.market_id,Outcome.YES)
            no=parse_book(await self.client.book(market.market_id),market.market_id,Outcome.NO)
            reasons=[]
            for b in (yes,no):
                if not b.best_ask or not b.best_bid: reasons.append("empty_book")
                elif b.best_bid>=b.best_ask: reasons.append("crossed_book")
                elif b.spread and b.spread>self.s.max_spread: reasons.append("spread_too_wide")
                elif b.relative_spread and b.relative_spread>self.s.max_relative_spread: reasons.append("relative_spread_too_wide")
                elif b.depth_at_or_better("BUY",b.best_ask)<self.s.min_liquidity: reasons.append("insufficient_entry_depth")
            if reasons: self.rec.append("candidates",{"record_type":"candidate","market_id":market.market_id,"reasons":reasons,"book_yes":yes,"book_no":no,"data_quality":"unexecutable_book"});return
            decision=self.strategy.evaluate(StrategyInput(self.state.btc_features,yes.best_ask,no.best_ask),self.s)
            reasons=list(decision.reasons)+self.risk.approve(market.market_id)
            record={"record_type":"candidate","experiment_tag":"baseline_unvalidated","strategy":decision.strategy,"strategy_version":"1","market_id":market.market_id,"event_id":market.event_id,"title":market.title,"question":market.question,"engine":market.engine,"currency":market.currency,"resolution_rules":market.resolution_rules,"resolution_source":market.resolution_source,"btc":self.state.btc_features,"book_yes":yes,"book_no":no,"decision":decision.approved,"outcome":decision.outcome,"probability":decision.probability,"edge":decision.edge,"signal_strength":decision.strength,"reasons":reasons,"wat_hour":datetime.now().astimezone().hour,"data_quality":"complete"}
            self.rec.append("candidates",record)
            if not decision.approved or reasons or self.s.mode is RunMode.OBSERVATION:return
            await self._execute(market,decision.outcome,yes if decision.outcome is Outcome.YES else no)
        except Exception as exc: self.rec.log("market_evaluation_failure",market_id=market.market_id,error=type(exc).__name__,detail=str(exc))
    async def _execute(self,market,outcome,book):
        assert outcome and book.best_ask
        body={"side":"BUY","outcome":outcome.value,"amount":float(self.s.position_size),"price":float(book.best_ask),"currency":self.s.currency,"timeInForce":"FOK"}
        quote=parse_quote(await self.client.quote(market.event_id,market.market_id,body),"BUY",outcome)
        age=(datetime.now(timezone.utc)-quote.captured_at).total_seconds()
        reasons=[]
        if not quote.complete_fill:reasons.append("quote_not_complete_fill")
        if age>self.s.quote_max_age:reasons.append("stale_quote")
        if abs(quote.expected_price-book.best_ask)>self.s.execution_tolerance:reasons.append("quote_moved_beyond_tolerance")
        if reasons:self.rec.append("trades",{"record_type":"trade_attempt","market_id":market.market_id,"quote":quote,"reasons":reasons});return
        if self.s.mode is RunMode.PAPER:
            # Conservative paper fill only after FOK-style quote evidence; buy fee reduces net shares per Bayse docs.
            self.risk.opened(market.market_id); self.rec.append("trades",{"record_type":"trade","mode":"paper","market_id":market.market_id,"outcome":outcome,"quote":quote,"gross_shares":self.s.position_size/quote.expected_price,"net_shares":quote.expected_shares,"entry_price":quote.expected_price,"fee":quote.fee,"status":"filled","data_quality":"simulated_from_quote"});return
        if self.s.mode is RunMode.LIVE:
            self.risk.opened(market.market_id)
            try:
                order=await self.client.place_order(market.event_id,market.market_id,body)
                self.rec.append("trades",{"record_type":"trade","mode":"live","market_id":market.market_id,"outcome":outcome,"quote":quote,"order":order,"data_quality":"awaiting_reconciliation"})
            except Exception as exc: self.risk.uncertain(market.market_id);self.rec.log("live_order_ambiguous",market_id=market.market_id,error=str(exc))
