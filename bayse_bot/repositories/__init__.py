"""Repository factory for Bayse Bot.

Creates the right repository implementation based on configuration.
"""
from __future__ import annotations
from typing import Any
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
import ssl

from .interfaces import (
    PredictionRepository, TradeRepository, BotStatusRepository,
    RiskRepository, MarketRepository, MarketOutcomeRepository, EventLogRepository,
    MarketActivityRepository, FeedStateRepository,
)


class RepositorySet:
    """Container for all repository instances."""

    def __init__(
        self,
        predictions: PredictionRepository,
        trades: TradeRepository,
        bot_status: BotStatusRepository,
        risk: RiskRepository,
        market: MarketRepository,
        market_outcome: MarketOutcomeRepository,
        event_log: EventLogRepository,
        activity: MarketActivityRepository | None = None,
        feed_state: FeedStateRepository | None = None,
        session_factory=None,
    ):
        self.predictions = predictions
        self.trades = trades
        self.bot_status = bot_status
        self.risk = risk
        self.market = market
        self.market_outcome = market_outcome
        self.event_log = event_log
        self.activity = activity
        self.feed_state = feed_state
        self._session_factory = session_factory

    def set_shared_session(self, session):
        """Set a shared session on all repositories (for one scan cycle)."""
        # feed_state is intentionally excluded: the checkpoint writer runs as a
        # separate periodic task and must use its OWN session, never share the
        # scan-cycle transaction (AsyncSession is not safe for concurrent use).
        for repo in [self.predictions, self.trades, self.bot_status,
                     self.risk, self.market, self.market_outcome, self.event_log,
                     self.activity]:
            if repo is not None and hasattr(repo, "set_shared_session"):
                repo.set_shared_session(session)

    def clear_shared_session(self):
        """Remove shared session from all repositories."""
        self.set_shared_session(None)


async def create_repositories(database_url: str) -> RepositorySet:
    """Create repository set based on database URL.

    Supports:
    - PostgreSQL (asyncpg) — for production (Neon, Render, etc.)
    - SQLite (aiosqlite) — for local development
    """
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

    # Normalize URL
    url = database_url
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgresql://") and "+asyncpg" not in url:
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("sqlite://") and "+aiosqlite" not in url:
        url = url.replace("sqlite://", "sqlite+aiosqlite://", 1)

    # Parse URL to check for SSL and strip incompatible params
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    needs_ssl = params.get("sslmode", [None])[0] == "require"

    # Remove ALL query params - asyncpg doesn't understand most of them.
    # Only round-trip through urlunparse when there IS a query: for URLs with
    # an empty netloc (SQLite), urlunparse mangles 'scheme:///path' into
    # 'scheme:/path', which SQLAlchemy cannot parse (see error.md 2026-09-10).
    clean_url = urlunparse(parsed._replace(query="")) if parsed.query else url

    # Configure SSL for asyncpg if needed
    connect_args = {}
    if needs_ssl:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        connect_args["ssl"] = ctx

    engine = create_async_engine(
        clean_url,
        echo=False,
        pool_pre_ping=True,
        connect_args=connect_args,  # {} is SQLAlchemy's effective default; None crashes it
    )
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # Import models to ensure tables exist
    from api.models import Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Create extra tables needed by repositories.
    # DDL is dialect-aware: NOW() and SERIAL are PostgreSQL-only; SQLite
    # needs INTEGER PRIMARY KEY for autoincrement and CURRENT_TIMESTAMP
    # (which PostgreSQL also accepts).
    is_sqlite = clean_url.startswith("sqlite")
    auto_id = "INTEGER PRIMARY KEY" if is_sqlite else "SERIAL PRIMARY KEY"
    async with engine.begin() as conn:
        await conn.execute(text(f"""
            CREATE TABLE IF NOT EXISTS risk_state (
                id INTEGER PRIMARY KEY DEFAULT 1,
                state_json TEXT NOT NULL DEFAULT '{{}}',
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        """))
        await conn.execute(text(f"""
            CREATE TABLE IF NOT EXISTS active_market (
                id INTEGER PRIMARY KEY DEFAULT 1,
                market_id VARCHAR(255) NOT NULL,
                event_id VARCHAR(255) NOT NULL,
                metadata_json TEXT NOT NULL DEFAULT '{{}}',
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        """))
        await conn.execute(text(f"""
            CREATE TABLE IF NOT EXISTS event_log (
                id {auto_id},
                event VARCHAR(255) NOT NULL,
                fields_json TEXT NOT NULL DEFAULT '{{}}',
                recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        """))
        await conn.execute(text(f"""
            CREATE TABLE IF NOT EXISTS market_outcomes (
                id {auto_id},
                market_id VARCHAR(255) NOT NULL UNIQUE,
                event_id VARCHAR(255) NOT NULL,
                resolved_outcome_id VARCHAR(255) NOT NULL,
                outcome_resolution VARCHAR(50) NOT NULL,
                event_close_value TEXT,
                btc_close_price NUMERIC,
                resolved_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        """))
        await conn.execute(text(f"""
            CREATE TABLE IF NOT EXISTS feed_state (
                id INTEGER PRIMARY KEY DEFAULT 1,
                candles_json TEXT NOT NULL DEFAULT '[]',
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        """))

    from .postgres import (
        PostgresPredictionRepository, PostgresTradeRepository,
        PostgresBotStatusRepository, PostgresRiskRepository,
        PostgresMarketRepository, PostgresMarketOutcomeRepository,
        PostgresEventLogRepository, PostgresMarketActivityRepository,
        PostgresFeedStateRepository,
    )

    return RepositorySet(
        predictions=PostgresPredictionRepository(session_factory),
        trades=PostgresTradeRepository(session_factory),
        bot_status=PostgresBotStatusRepository(session_factory),
        risk=PostgresRiskRepository(session_factory),
        market=PostgresMarketRepository(session_factory),
        market_outcome=PostgresMarketOutcomeRepository(session_factory),
        event_log=PostgresEventLogRepository(session_factory),
        activity=PostgresMarketActivityRepository(session_factory),
        feed_state=PostgresFeedStateRepository(session_factory),
        session_factory=session_factory,
    )
