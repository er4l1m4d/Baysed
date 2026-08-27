"""Repository factory for Bayse Bot.

Creates the right repository implementation based on configuration.
"""
from __future__ import annotations
from typing import Any
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

from .interfaces import (
    PredictionRepository, TradeRepository, BotStatusRepository,
    RiskRepository, MarketRepository, EventLogRepository,
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
        event_log: EventLogRepository,
    ):
        self.predictions = predictions
        self.trades = trades
        self.bot_status = bot_status
        self.risk = risk
        self.market = market
        self.event_log = event_log


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

    # Parse URL to handle sslmode parameter
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    sslmode = params.pop("sslmode", [None])[0]
    
    # Rebuild URL without sslmode
    clean_query = urlencode(params, doseq=True)
    clean_url = urlunparse(parsed._replace(query=clean_query))

    # Configure SSL for asyncpg if needed
    connect_args = {}
    if sslmode == "require":
        import ssl
        connect_args["ssl"] = ssl.create_default_context()
        connect_args["ssl"].verify_mode = ssl.CERT_REQUIRED

    engine = create_async_engine(
        clean_url, 
        echo=False, 
        pool_pre_ping=True,
        connect_args=connect_args if connect_args else None
    )
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # Import models to ensure tables exist
    from api.models import Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Create extra tables needed by repositories
    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS risk_state (
                id INTEGER PRIMARY KEY DEFAULT 1,
                state_json TEXT NOT NULL DEFAULT '{}',
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS active_market (
                id INTEGER PRIMARY KEY DEFAULT 1,
                market_id VARCHAR(255) NOT NULL,
                event_id VARCHAR(255) NOT NULL,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS event_log (
                id SERIAL PRIMARY KEY,
                event VARCHAR(255) NOT NULL,
                fields_json TEXT NOT NULL DEFAULT '{}',
                recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))

    def get_session():
        return session_factory()

    from .postgres import (
        PostgresPredictionRepository, PostgresTradeRepository,
        PostgresBotStatusRepository, PostgresRiskRepository,
        PostgresMarketRepository, PostgresEventLogRepository,
    )

    return RepositorySet(
        predictions=PostgresPredictionRepository(get_session()),
        trades=PostgresTradeRepository(get_session()),
        bot_status=PostgresBotStatusRepository(get_session()),
        risk=PostgresRiskRepository(get_session()),
        market=PostgresMarketRepository(get_session()),
        event_log=PostgresEventLogRepository(get_session()),
    )
