from __future__ import annotations
from datetime import datetime, timezone
from .config import Settings
from .models import Market

def parse_time(value: object) -> datetime | None:
    if not value: return None
    if isinstance(value, (int, float)): return datetime.fromtimestamp(value, timezone.utc)
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)

def adapt_market(event: dict, market: dict) -> Market:
    return Market(event_id=str(event.get("id", "")), market_id=str(market.get("id", "")), title=str(event.get("title", "")), question=str(market.get("question", event.get("title", ""))), engine=str(market.get("engine", event.get("engine", ""))).upper(), currency=str(market.get("currency", event.get("currency", ""))).upper(), outcomes=tuple(str(x) for x in market.get("outcomes", [])), status=str(market.get("status", event.get("status", ""))).lower(), opens_at=parse_time(market.get("opensAt", event.get("opensAt"))), closes_at=parse_time(market.get("closesAt", market.get("endTime", event.get("closesAt", event.get("endTime"))))), resolution_rules=market.get("resolutionRules", event.get("resolutionRules")), resolution_source=market.get("resolutionSource", event.get("resolutionSource")), raw={"event": event, "market": market})

def validate_market(m: Market, s: Settings, now: datetime | None = None) -> list[str]:
    now = now or datetime.now(timezone.utc); reasons: list[str] = []
    text = f"{m.title} {m.question}".lower()
    if not m.event_id or not m.market_id: reasons.append("missing_market_identity")
    if m.status not in {"active", "open"}: reasons.append("market_not_open")
    if m.engine != "CLOB": reasons.append(f"unsupported_engine:{m.engine or 'missing'}")
    if m.currency != s.currency: reasons.append(f"currency_mismatch:{m.currency or 'missing'}")
    if not all(x in {"Yes", "No", "YES", "NO"} for x in m.outcomes) or {x.upper() for x in m.outcomes} != {"YES", "NO"}: reasons.append("not_binary_yes_no")
    if not any(term in text for term in s.btc_terms): reasons.append("not_btc_specific")
    if not m.opens_at or not m.closes_at: reasons.append("missing_duration_metadata")
    elif (m.closes_at - m.opens_at).total_seconds() != 900: reasons.append("not_15_minute_market")
    if not m.resolution_rules or not m.resolution_source: reasons.append("missing_resolution_rules_or_source")
    elif not all(term in (m.resolution_rules + " " + m.resolution_source).lower() for term in s.resolution_terms): reasons.append("resolution_safety_rule_mismatch")
    if not m.closes_at or (m.closes_at - now).total_seconds() < s.no_entry_expiry: reasons.append("too_close_to_expiry")
    return reasons
