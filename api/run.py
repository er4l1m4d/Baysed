"""Run the Bayse Bot API server + trading engine together."""
import asyncio
import logging
import os
import signal
import uvicorn

from api.init_db import init_db

log = logging.getLogger(__name__)


async def start_bot_engine():
    """Start the trading engine as a background task."""
    try:
        from bayse_bot.config import Settings
        from bayse_bot.engine import Bot
        from bayse_bot.feed import BayseFeed, MarketState
        from bayse_bot.bayse_market_ws import BayseMarketFeed
        from bayse_bot.bayse import BayseClient
        from bayse_bot.repositories import create_repositories

        s = Settings()
        s.validate_live()
        log.info("starting bot engine in %s mode...", s.mode.value)

        database_url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./bayse_bot.db")
        repos = await create_repositories(database_url)

        state = MarketState()
        feed = BayseFeed(state, momentum_window_seconds=s.momentum_window_seconds)
        market_feed = BayseMarketFeed()

        stop = asyncio.Event()

        btc_task = asyncio.create_task(feed.run(stop))
        market_task = asyncio.create_task(market_feed.run(stop))

        # Wait for initial BTC data
        for _ in range(50):
            if feed.last_price:
                break
            await asyncio.sleep(0.1)

        async with BayseClient(s.bayse_base_url, s.public_key, s.secret_key) as client:
            await Bot(s, client, state, repos, market_feed).run(stop)

    except Exception as e:
        log.error("bot engine error: %s", e, exc_info=True)


async def start():
    """Initialize database and start server + bot."""
    await init_db()
    log.info("database ready, starting server + bot engine...")

    # Start bot engine in background
    bot_task = asyncio.create_task(start_bot_engine())

    # Start uvicorn server
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
