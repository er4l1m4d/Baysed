"""Run the Bayse Bot API server + trading engine together."""
import asyncio
import logging
import os
import uvicorn

from api.init_db import init_db
from api.shared import shared_state, bot_diagnostics

log = logging.getLogger(__name__)


async def broadcast_loop():
    """Periodically broadcast BTC price to all connected WebSocket clients."""
    from api.server import broadcast_btc_price

    last_price = None
    while True:
        try:
            price = float(shared_state.btc_price) if shared_state.btc_price else None
            if price and price != last_price:
                momentum = float(shared_state.btc_features.momentum_pct) if shared_state.btc_features else 0
                volatility = float(shared_state.btc_features.atr_pct) if shared_state.btc_features else 0
                await broadcast_btc_price(price, momentum, volatility)
                last_price = price
        except Exception as e:
            log.debug("broadcast error: %s", e)
        await asyncio.sleep(1)


async def feed_checkpoint_loop(feed, repos, stop: asyncio.Event, interval: float = 20.0):
    """Persist the BTC feed's candle buffer so a restart skips the warm-up.

    Writes only when a new candle has finalized (at most ~1/min), using a
    fresh session (not the scan-cycle shared one) so it never contends with
    the engine's per-cycle transaction.
    """
    last_written = -1
    while not stop.is_set():
        try:
            if feed.finalized_count != last_written and feed.last_price is not None:
                await repos.feed_state.save_candles(feed.serialize_candles())
                last_written = feed.finalized_count
        except Exception as e:
            log.debug("feed checkpoint save skipped: %s", e)
        await asyncio.sleep(interval)


async def start_bot_engine():
    """Start the trading engine as a background task."""
    try:
        from bayse_bot.config import Settings
        from bayse_bot.engine import Bot
        from bayse_bot.feed import BayseFeed
        from bayse_bot.bayse_market_ws import BayseMarketFeed
        from bayse_bot.activity_buffer import ActivityBuffer
        from bayse_bot.bayse import BayseClient
        from bayse_bot.repositories import create_repositories

        s = Settings()
        log.info("starting bot engine in %s mode...", s.mode.value)

        database_url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./bayse_bot.db")
        repos = await create_repositories(database_url)
        log.info("repositories created")

        state = shared_state
        feed = BayseFeed(state, momentum_window_seconds=s.momentum_window_seconds)
        market_feed = BayseMarketFeed()
        activity_buffer = ActivityBuffer(maxlen=5000)
        log.info("feeds created, starting BTC feed...")

        stop = asyncio.Event()

        # Skip the ~22-min feature warm-up after a restart by reloading the
        # engine's OWN tick-derived candles from the last checkpoint. Same
        # source/units/phase => no feature contamination. If the checkpoint is
        # missing or stale, restore_candles() ignores it and we warm up normally.
        try:
            checkpoint = await repos.feed_state.load_candles()
            if checkpoint:
                feed.restore_candles(checkpoint, max_age_seconds=300)
        except Exception as e:
            log.warning("feed checkpoint restore failed (warming up normally): %s", e)

        btc_task = asyncio.create_task(feed.run(stop))
        market_task = asyncio.create_task(market_feed.run(stop, on_trade=activity_buffer.add))
        checkpoint_task = asyncio.create_task(feed_checkpoint_loop(feed, repos, stop))

        for _ in range(50):
            if feed.last_price:
                break
            await asyncio.sleep(0.1)

        if feed.last_price:
            log.info("BTC feed connected, price=$%s", feed.last_price)
        else:
            log.warning("no BTC price data after waiting, bot engine starting anyway")

        bot_diagnostics["started"] = True
        bot_diagnostics["market_feed"] = market_feed
        bot_diagnostics["btc_feed"] = feed

        # Create client (read-only endpoints work without API keys)
        client = BayseClient(s.bayse_base_url, s.public_key or "", s.secret_key or "")
        await client.__aenter__()

        bot = Bot(s, client, state, repos, market_feed, activity_buffer=activity_buffer)

        try:
            await bot.initialize()
        except Exception as e:
            bot_diagnostics["init_error"] = str(e)
            log.error("bot initialize failed: %s", e, exc_info=True)
            # Keep feeds running anyway
            while not stop.is_set():
                await asyncio.sleep(1)
            return

        log.info("bot initialized, starting scan loop")
        await bot.run(stop)

    except Exception as e:
        bot_diagnostics["error"] = str(e)
        log.error("bot engine error: %s", e, exc_info=True)


async def start():
    """Initialize database and start server + bot."""
    await init_db()
    log.info("database ready, starting server + bot engine...")

    bot_task = asyncio.create_task(start_bot_engine())
    bcast_task = asyncio.create_task(broadcast_loop())

    config = uvicorn.Config(
        "api.server:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info"
    )
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    asyncio.run(start())
