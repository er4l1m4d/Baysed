from __future__ import annotations
import argparse,asyncio,logging,signal

async def main():
    parser=argparse.ArgumentParser();parser.add_argument("--report",metavar="RUN_DIR");parser.add_argument("--health",action="store_true");args=parser.parse_args()
    if args.health: print('{"status":"ok","orders_submitted":false}');return
    if args.report:
        from .reporting import report
        print(report(__import__('pathlib').Path(args.report)));return
    from .bayse import BayseClient
    from .config import Settings
    from .engine import Bot
    from .feed import BayseFeed, MarketState
    s=Settings();s.validate_live();logging.basicConfig(level=logging.INFO,format='%(message)s')

    # Shared state — continuously updated by BayseFeed
    state=MarketState()
    feed=BayseFeed(state)

    # BTC feed runs as background task; seeds from REST then connects WebSocket
    stop=asyncio.Event(); loop=asyncio.get_running_loop()
    for sig in (signal.SIGINT,signal.SIGTERM):
        try: loop.add_signal_handler(sig,stop.set)
        except NotImplementedError: pass

    btc_task=asyncio.create_task(feed.run(stop))

    # Wait briefly for initial data to arrive before starting the bot loop
    for _ in range(50):
        if feed.last_price: break
        await asyncio.sleep(0.1)

    async with BayseClient(s.bayse_base_url,s.public_key,s.secret_key) as client:
        await Bot(s,client,state).run(stop)
if __name__=="__main__":asyncio.run(main())
