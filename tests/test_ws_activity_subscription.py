"""Tests for activity-channel subscription rotation in BayseMarketFeed."""
import json

from bayse_bot.bayse_market_ws import BayseMarketFeed


class FakeWS:
    def __init__(self):
        self.sent = []

    async def send(self, raw):
        self.sent.append(json.loads(raw))


def test_ensure_subscribed_sends_all_three_channels():
    feed = BayseMarketFeed()
    ws = FakeWS()
    feed._ws = ws

    feed.subscribed_events = {"old-event"}
    feed.subscribed_activity_events = {"old-event"}
    feed.subscribed_markets = {"old-market"}

    feed.store.store_outcome_ids("new-market", "o1", "o2")

    import asyncio

    async def run():
        await feed.ensure_subscribed("new-event", ["new-market"])

    asyncio.run(run())

    types = [(m["channel"], m.get("eventId") or m.get("marketIds")) for m in ws.sent]
    assert ("prices", "new-event") in types
    assert ("activity", "new-event") in types
    assert ("orderbook", ["new-market"]) in types
    # rotation replaced the old subscriptions
    assert feed.subscribed_events == {"new-event"}
    assert feed.subscribed_activity_events == {"new-event"}
    assert feed.subscribed_markets == {"new-market"}
