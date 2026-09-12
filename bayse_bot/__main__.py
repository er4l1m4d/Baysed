"""Bayse Bot entry point.

Starts the trading engine with repository-backed persistence.
Supports PostgreSQL (production) and SQLite (development).
"""
from __future__ import annotations
import argparse, asyncio, logging, signal, os


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", metavar="RUN_DIR")
    parser.add_argument("--health", action="store_true")
    parser.add_argument("--calibrate", metavar="RUN_DIR", help="Run calibration report on resolved predictions")
    parser.add_argument("--tune", metavar="RUN_DIR", help="Suggest parameter adjustments based on calibration data")
    args = parser.parse_args()

    if args.health:
        print('{"status":"ok","orders_submitted":false}')
        return

    if args.tune:
        from .calibration import suggest_parameter_adjustments
        print(suggest_parameter_adjustments(__import__('pathlib').Path(args.tune)))
        return

    if args.calibrate:
        from .calibration import generate_report
        print(generate_report(__import__('pathlib').Path(args.calibrate)))
        return

    if args.report:
        from .reporting import report
        print(report(__import__('pathlib').Path(args.report)))
        return

    from .bayse import BayseClient
    from .bayse_market_ws import BayseMarketFeed
    from .config import Settings
    from .engine import Bot
    from .feed import BayseFeed, MarketState
    from .repositories import create_repositories

    s = Settings()
    s.validate_live()
    logging.basicConfig(level=logging.INFO, format='%(message)s')

    # Get database URL from environment (defaults to SQLite for local dev)
    database_url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./bayse_bot.db")

    # Create repositories
    repos = await create_repositories(database_url)
    log = logging.getLogger(__name__)
    log.info("repositories initialized (database=%s)", database_url.split("@")[-1] if "@" in database_url else database_url)

    # Shared state — continuously updated by feeds
    state = MarketState()
    feed = BayseFeed(state, momentum_window_seconds=s.momentum_window_seconds)
    market_feed = BayseMarketFeed()

    # BTC feed + market data feed run as background tasks
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            pass

    # Reload the engine's own candles from the last checkpoint to skip the
    # ~22-min warm-up after a restart (falls back to warm-up if missing/stale).
    try:
        _ck = await repos.feed_state.load_candles()
        if _ck:
            feed.restore_candles(_ck, max_age_seconds=300)
    except Exception as e:
        log.warning("feed checkpoint restore failed (warming up): %s", e)

    btc_task = asyncio.create_task(feed.run(stop))
    market_task = asyncio.create_task(market_feed.run(stop))

    async def _checkpoint():
        last = -1
        while not stop.is_set():
            try:
                if feed.finalized_count != last and feed.last_price is not None:
                    await repos.feed_state.save_candles(feed.serialize_candles())
                    last = feed.finalized_count
            except Exception as e:
                log.debug("feed checkpoint save skipped: %s", e)
            await asyncio.sleep(20)

    checkpoint_task = asyncio.create_task(_checkpoint())

    # Wait briefly for initial BTC data to arrive before starting the bot loop
    for _ in range(50):
        if feed.last_price:
            break
        await asyncio.sleep(0.1)

    async with BayseClient(s.bayse_base_url, s.public_key, s.secret_key) as client:
        await Bot(s, client, state, repos, market_feed).run(stop)


if __name__ == "__main__":
    asyncio.run(main())
