"""Documented Bayse HTTP adapter; unknown fields remain in `raw` for traceability."""
from __future__ import annotations
import asyncio, base64, hashlib, hmac, json, logging, time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
import aiohttp
from .models import BookLevel, OrderBook, Outcome, Quote

log = logging.getLogger(__name__)

DOCS = "https://docs.bayse.markets/"

class BayseHTTPError(RuntimeError):
    def __init__(self, status: int, message: str, request_id: str | None = None):
        super().__init__(f"Bayse HTTP {status}: {message}")
        self.status, self.request_id = status, request_id

def canonical_json_bytes(body: dict[str, Any]) -> bytes:
    """The exact UTF-8 bytes used for both hash/signature and HTTP body."""
    return json.dumps(body, separators=(",", ":"), sort_keys=True, ensure_ascii=False).encode("utf-8")

def sign_request(secret: str, timestamp: int, method: str, path: str, body: bytes | None = None) -> str:
    """HMAC-SHA256 signature per Bayse docs: {timestamp}.{METHOD}.{path}.{bodyHash}

    path is the URL path WITHOUT query parameters.
    bodyHash is SHA-256 hex digest of body bytes, or empty string if no body.
    """
    # Strip query params from path for signing (Bayse docs: path is just the endpoint)
    signing_path = path.split("?")[0] if "?" in path else path
    body_hash = hashlib.sha256(body).hexdigest() if body else ""
    payload = f"{timestamp}.{method.upper()}.{signing_path}.{body_hash}".encode()
    return base64.b64encode(hmac.new(secret.encode(), payload, hashlib.sha256).digest()).decode()

def _d(v: Any, default: str = "0") -> Decimal: return Decimal(str(v if v is not None else default))

class BayseClient:
    def __init__(self, base_url: str, public_key: str = "", secret_key: str = "", session: aiohttp.ClientSession | None = None):
        self.base_url, self.public_key, self.secret_key, self.session = base_url.rstrip("/"), public_key, secret_key, session
        self._owned_session = session is None

    async def __aenter__(self):
        if self.session is None:
            self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
        return self
    async def __aexit__(self, *_):
        if self._owned_session and self.session: await self.session.close()

    async def refresh_session(self) -> None:
        """Recreate the aiohttp session to avoid stale connections."""
        if self.session is not None:
            await self.session.close()
        self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))

    async def request(self, method: str, path: str, body: dict[str, Any] | None = None, *, authenticated: bool = False, signed: bool = False, retries: int = 2) -> dict[str, Any]:
        if self.session is None: raise RuntimeError("BayseClient must be used as an async context manager")
        raw = canonical_json_bytes(body) if body is not None else None
        headers: dict[str, str] = {"Accept": "application/json"}
        if authenticated:
            if not self.public_key: raise RuntimeError("authenticated Bayse request requires BAYSE_PUBLIC_KEY")
            headers["X-Public-Key"] = self.public_key
        if signed:
            if not self.secret_key: raise RuntimeError("signed Bayse request requires BAYSE_SECRET_KEY")
            timestamp = int(time.time()); headers.update({"X-Timestamp": str(timestamp), "X-Signature": sign_request(self.secret_key, timestamp, method, path, raw), "Content-Type": "application/json"})
        for attempt in range(retries + 1):
            try:
                async with self.session.request(method, self.base_url + path, headers=headers, data=raw) as response:
                    request_id = response.headers.get("X-Request-Id") or response.headers.get("x-request-id")
                    payload = await response.json(content_type=None)
                    if response.status < 300: return payload if isinstance(payload, dict) else {"data": payload}
                    retryable = method.upper() in {"GET", "HEAD"} and response.status in {429, 500, 502, 503, 504}
                    if retryable and attempt < retries:
                        await asyncio.sleep(min(2 ** attempt, 4)); continue
                    raise BayseHTTPError(response.status, str(payload), request_id)
            except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                if method.upper() in {"GET", "HEAD"} and attempt < retries:
                    await asyncio.sleep(min(2 ** attempt, 4)); continue
                raise BayseHTTPError(0, str(exc)) from exc
        raise AssertionError("unreachable")

    async def events(self) -> list[dict[str, Any]]:
        return self._event_list(await self.request("GET", "/v1/pm/events?status=open"))
    async def events_by_series(self, slug: str) -> list[dict[str, Any]]:
        """Fetch open events filtered by seriesSlug (e.g. crypto-btc-15min)."""
        return self._event_list(await self.request("GET", f"/v1/pm/events?seriesSlug={slug}&status=open"))
    async def event(self, event_id: str) -> dict[str, Any]:
        """Fetch one event by ID, including canonical resolution fields."""
        raw = await self.request("GET", f"/v1/pm/events/{event_id}", retries=0)
        return raw.get("event", raw.get("data", raw))
    async def resolved_events(self, series_slug: str | None = None) -> list[dict[str, Any]]:
        """Fetch resolved events, optionally filtered by series. Used for outcome tracking."""
        path = "/v1/pm/events?status=resolved&size=50"
        if series_slug:
            path += f"&seriesSlug={series_slug}"
        try:
            return self._event_list(await self.request("GET", path, authenticated=bool(self.public_key)))
        except BayseHTTPError as exc:
            # If filtered query fails, try without seriesSlug
            if series_slug and exc.status >= 400:
                log.warning("resolved_events with seriesSlug failed (%d), retrying without filter", exc.status)
                return self._event_list(await self.request("GET", "/v1/pm/events?status=resolved&size=50", authenticated=bool(self.public_key)))
            raise
    async def series_events(self, slug: str) -> list[dict[str, Any]]:
        """Fetch lean events for a series (lightweight, no full market details)."""
        raw = await self.request("GET", f"/v1/pm/events/series/{slug}/lean-events")
        if isinstance(raw, list): return raw
        return raw.get("events", raw.get("data", []))
    async def current_series_event(self, slug: str) -> dict[str, Any] | None:
        """Fetch the full event for the series interval that is open now."""
        now = datetime.now(timezone.utc)
        lean_events = await self.series_events(slug)
        current: list[tuple[datetime, str]] = []
        for event in lean_events:
            event_id = event.get("id")
            opens_raw = event.get("openingDate") or event.get("startDate")
            closes_raw = event.get("closingDate")
            if not event_id or not opens_raw or not closes_raw:
                continue
            try:
                opens_at = datetime.fromisoformat(opens_raw.replace("Z", "+00:00"))
                closes_at = datetime.fromisoformat(closes_raw.replace("Z", "+00:00"))
            except (TypeError, ValueError):
                continue
            if opens_at <= now < closes_at:
                current.append((closes_at, event_id))
        if not current:
            return None
        _, event_id = min(current)
        return await self.event(event_id)
    async def trades(self, market_id: str) -> list[dict[str, Any]]:
        """Fetch recent trades for a market."""
        raw = await self.request("GET", f"/v1/pm/trades?marketId={market_id}")
        if isinstance(raw, list): return raw
        return raw.get("trades", raw.get("data", []))
    async def ticker(self, market_id: str) -> dict[str, Any]:
        """Fetch real-time ticker for a market."""
        return await self.request("GET", f"/v1/pm/markets/{market_id}/ticker")
    @staticmethod
    def _event_list(payload: dict[str, Any]) -> list[dict[str, Any]]: return payload.get("events", payload.get("data", []))
    async def book(self, outcome_ids: list[str]) -> list[dict[str, Any]]:
        """Fetch order books for one or more outcome IDs. Returns list of book dicts."""
        params = "&".join(f"outcomeId[]={oid}" for oid in outcome_ids)
        raw = await self.request("GET", f"/v1/pm/books?{params}")
        # Response is an array, but request() wraps non-dict in {"data": [...]}
        if isinstance(raw, list): return raw
        return raw.get("data", raw.get("books", []))
    async def quote(self, event_id: str, market_id: str, body: dict[str, Any]) -> dict[str, Any]: return await self.request("POST", f"/v1/pm/events/{event_id}/markets/{market_id}/quote", body, authenticated=bool(self.public_key), signed=bool(self.secret_key), retries=0)
    async def place_order(self, event_id: str, market_id: str, body: dict[str, Any]) -> dict[str, Any]:
        # Never retried: caller must poll/reconcile after an ambiguous outcome.
        return await self.request("POST", f"/v1/pm/events/{event_id}/markets/{market_id}/orders", body, authenticated=True, signed=True, retries=0)
    async def orders(self) -> dict[str, Any]: return await self.request("GET", "/v1/pm/orders", authenticated=True)
    async def portfolio(self) -> dict[str, Any]: return await self.request("GET", "/v1/pm/portfolio", authenticated=True)
    async def activities(self) -> dict[str, Any]: return await self.request("GET", "/v1/pm/activities", authenticated=True)
    async def cancel(self, order_id: str) -> dict[str, Any]: return await self.request("DELETE", f"/v1/pm/orders/{order_id}", authenticated=True, signed=True, retries=0)

def parse_book(payload: dict[str, Any], market_id: str, outcome: Outcome) -> OrderBook:
    """Parse a single order book dict from the Bayse API response."""
    def levels(name: str, reverse: bool) -> tuple[BookLevel, ...]:
        raw = payload.get(name, [])
        parsed = [BookLevel(_d(x.get("price") if isinstance(x, dict) else x[0]), _d(x.get("quantity", x.get("size")) if isinstance(x, dict) else x[1])) for x in raw]
        return tuple(sorted(parsed, key=lambda x: x.price, reverse=reverse))
    captured = datetime.now(timezone.utc)
    return OrderBook(market_id, outcome, levels("bids", True), levels("asks", False), captured)

def parse_quote(payload: dict[str, Any], side: str, outcome: Outcome) -> Quote:
    q = payload.get("quote", payload)
    # CLOB fields are documented in Fees. Missing fields remain a hard failure.
    required = ("price", "quantity", "fee", "amount", "completeFill")
    aliases = {"price": "expectedPrice", "quantity": "expectedShares"}
    if any(k not in q and aliases.get(k) not in q for k in required): raise ValueError("incomplete Bayse quote; refusing execution")
    return Quote(side.upper(), outcome, _d(q.get("price", q.get("expectedPrice"))), _d(q.get("quantity", q.get("expectedShares"))), _d(q["fee"]), _d(q["amount"]), bool(q["completeFill"]), datetime.now(timezone.utc), q)
