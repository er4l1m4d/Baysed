from __future__ import annotations
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from .config import Settings
from .models import Market

def parse_time(value: object) -> datetime | None:
    if not value: return None
    if isinstance(value, (int, float)): return datetime.fromtimestamp(value, timezone.utc)
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)

def _dec(v, default="0") -> Decimal:
    try: return Decimal(str(v)) if v is not None else Decimal(default)
    except (InvalidOperation, ValueError): return Decimal(default)

def adapt_market(event: dict, market: dict) -> Market:
    """Adapt Bayse API event+market dict into a Market model.

    Handles both the current API shape (Up/Down outcomes, eventThreshold,
    closingDate) and the legacy shape (Yes/No outcomes, opensAt/closesAt).
    """
    # Outcomes: current API uses outcome1Label/outcome2Label
    o1 = market.get("outcome1Label", "")
    o2 = market.get("outcome2Label", "")
    if o1 and o2:
        outcomes = (o1, o2)
    else:
        outcomes = tuple(str(x) for x in market.get("outcomes", []))

    # Duration: current API uses createdAt + closingDate on event
    opens_at = parse_time(market.get("opensAt", event.get("opensAt"))) or parse_time(event.get("createdAt"))
    closes_at = parse_time(market.get("closesAt", market.get("endTime", event.get("closesAt", event.get("endTime"))))) or parse_time(event.get("closingDate"))

    # Strike: current API uses eventThreshold or marketThreshold
    strike = None
    for key in ("eventThreshold", "marketThreshold"):
        v = event.get(key) or market.get(key)
        if v is not None:
            strike = _dec(v)
            break

    # Resolution rules: current API uses "rules" on market, legacy uses "resolutionRules"
    rules = market.get("rules") or market.get("resolutionRules") or event.get("resolutionRules")

    # Resolution source: event level
    source = event.get("resolutionSource") or market.get("resolutionSource")

    # Currency: check supportedCurrencies on event, fallback to market
    currency = str(market.get("currency", event.get("currency", ""))).upper()
    if not currency:
        supported = event.get("supportedCurrencies")
        if supported and isinstance(supported, list) and supported:
            currency = str(supported[0]).upper()

    return Market(
        event_id=str(event.get("id", "")),
        market_id=str(market.get("id", "")),
        title=str(event.get("title", "")),
        question=str(market.get("question", event.get("title", ""))),
        engine=str(market.get("engine", event.get("engine", ""))).upper(),
        currency=currency,
        outcomes=outcomes,
        status=str(market.get("status", event.get("status", ""))).lower(),
        opens_at=opens_at,
        closes_at=closes_at,
        resolution_rules=rules,
        resolution_source=source,
        strike_price=strike,
        series_slug=event.get("seriesSlug"),
        outcome1_id=market.get("outcome1Id"),
        outcome2_id=market.get("outcome2Id"),
        raw={"event": event, "market": market},
    )

def validate_market(m: Market, s: Settings, now: datetime | None = None) -> list[str]:
    now = now or datetime.now(timezone.utc); reasons: list[str] = []
    text = f"{m.title} {m.question}".lower()
    if not m.event_id or not m.market_id: reasons.append("missing_market_identity")
    if m.status not in {"active", "open"}: reasons.append("market_not_open")
    if m.engine and m.engine != "CLOB": reasons.append(f"unsupported_engine:{m.engine}")
    # Currency check: only if currency is present (current API often omits it)
    if m.currency and m.currency != s.currency: reasons.append(f"currency_mismatch:{m.currency}")
    # Accept both Yes/No and Up/Down binary outcomes
    outcome_labels = {x.lower() for x in m.outcomes}
    if outcome_labels not in ({"yes", "no"}, {"up", "down"}):
        reasons.append("not_binary_outcome")
    if not any(term in text for term in s.btc_terms): reasons.append("not_btc_specific")
    if not m.opens_at or not m.closes_at: reasons.append("missing_duration_metadata")
    elif abs((m.closes_at - m.opens_at).total_seconds() - 900) > 30: reasons.append("not_15_minute_market")
    if not m.resolution_rules: reasons.append("missing_resolution_rules")
    if not m.resolution_source: reasons.append("missing_resolution_source")
    if m.resolution_source and m.resolution_rules:
        combined = (m.resolution_rules + " " + m.resolution_source).lower()
        if not all(term in combined for term in s.resolution_terms): reasons.append("resolution_safety_rule_mismatch")
    # Only reject near-expiry in paper/live modes — observation still wants data
    from .models import RunMode
    if s.mode is not RunMode.OBSERVATION:
        if not m.closes_at or (m.closes_at - now).total_seconds() < s.no_entry_expiry: reasons.append("too_close_to_expiry")
    return reasons
