import hashlib
import asyncio
from datetime import datetime, timedelta, timezone

from bayse_bot.bayse import BayseClient, canonical_json_bytes,sign_request,parse_quote
from bayse_bot.models import Outcome

def test_canonical_body_and_fixed_signature():
    body=canonical_json_bytes({"amount":100,"outcome":"YES","side":"BUY"})
    assert body==b'{"amount":100,"outcome":"YES","side":"BUY"}'
    # Independent construction fixes the HMAC contract: timestamp.METHOD.path.body_hash.
    assert sign_request("secret",1700000000,"POST","/v1/x",body)=="aSypOibuC6TXJNUW0jMgVl+QptWwBdx2HkAXjYsb808="
    assert hashlib.sha256(body).hexdigest()=="c452747cbc8631bf20bebae7a149d7ee63e43d923294190907721cc9e7909cb5"

def test_quote_requires_documented_clob_fields():
    q=parse_quote({"price":.5,"quantity":190,"fee":2,"amount":100,"completeFill":True},"BUY",Outcome.YES)
    assert q.expected_shares==190 and q.complete_fill
    try: parse_quote({"price":.5},"BUY",Outcome.YES)
    except ValueError: pass
    else: assert False


def test_open_event_discovery_is_public_even_when_client_has_keys():
    async def run():
        client = BayseClient("https://example.test", "public", "secret")
        calls = []

        async def request(method, path, body=None, authenticated=False, signed=False, retries=2):
            calls.append((method, path, authenticated, signed))
            return {"events": []}

        client.request = request
        await client.events_by_series("crypto-btc-15min")
        await client.events()
        return calls

    calls = asyncio.run(run())
    assert calls == [
        ("GET", "/v1/pm/events?seriesSlug=crypto-btc-15min&status=open", False, False),
        ("GET", "/v1/pm/events?status=open", False, False),
    ]


def test_current_series_event_fetches_only_the_open_interval():
    async def run():
        client = BayseClient("https://example.test", "public", "secret")
        now = datetime.now(timezone.utc)
        fetched = []

        async def series_events(slug):
            assert slug == "crypto-btc-15min"
            return [
                {"id": "closed", "openingDate": (now - timedelta(minutes=30)).isoformat(),
                 "closingDate": (now - timedelta(minutes=15)).isoformat()},
                {"id": "current", "openingDate": (now - timedelta(minutes=5)).isoformat(),
                 "closingDate": (now + timedelta(minutes=10)).isoformat()},
                {"id": "future", "openingDate": (now + timedelta(minutes=10)).isoformat(),
                 "closingDate": (now + timedelta(minutes=25)).isoformat()},
            ]

        async def event(event_id):
            fetched.append(event_id)
            return {"id": event_id, "markets": [{"id": "market"}]}

        client.series_events = series_events
        client.event = event
        result = await client.current_series_event("crypto-btc-15min")
        return result, fetched

    result, fetched = asyncio.run(run())
    assert result["id"] == "current"
    assert fetched == ["current"]
