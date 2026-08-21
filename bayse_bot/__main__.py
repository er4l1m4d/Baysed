from __future__ import annotations
import argparse,asyncio,logging,signal

async def main():
    parser=argparse.ArgumentParser();parser.add_argument("--report",metavar="RUN_DIR");parser.add_argument("--health",action="store_true");args=parser.parse_args()
    if args.health: print('{"status":"ok","orders_submitted":false}');return
    if args.report:
        from .reporting import report
        print(report(__import__('pathlib').Path(args.report)));return
    from .bayse import BayseClient
    from .bybit import BybitFeed
    from .config import Settings
    from .engine import Bot
    s=Settings();s.validate_live();logging.basicConfig(level=logging.INFO,format='%(message)s')
    feed=BybitFeed()
    async with __import__('aiohttp').ClientSession() as session: await feed.reseed(session)
    stop=asyncio.Event(); loop=asyncio.get_running_loop()
    for sig in (signal.SIGINT,signal.SIGTERM):
        try: loop.add_signal_handler(sig,stop.set)
        except NotImplementedError: pass
    async with BayseClient(s.bayse_base_url,s.public_key,s.secret_key) as client:
        await Bot(s,client,feed.features(s.momentum_window_seconds)).run(stop)
if __name__=="__main__":asyncio.run(main())
