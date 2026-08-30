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
    ):
        self.predictions = predictions
        self.trades = trades
        self.bot_status = bot_status
        self.risk = risk
        self.market = market
        self.market_outcome = market_outcome
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

    # Parse URL to check for SSL and strip incompatible params
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    needs_ssl = params.get("sslmode", [None])[0] == "require"
    
    # Remove ALL query params - asyncpg doesn't understand most of them
    clean_url = urlunparse(parsed._replace(query=""))

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
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS market_outcomes (
                id SERIAL PRIMARY KEY,
                market_id VARCHAR(255) NOT NULL UNIQUE,
                event_id VARCHAR(255) NOT NULL,
                resolved_outcome_id VARCHAR(255) NOT NULL,
                outcome_resolution VARCHAR(50) NOT NULL,
                event_close_value TEXT,
                btc_close_price NUMERIC,
                resolved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))

    from .postgres import (
        PostgresPredictionRepository, PostgresTradeRepository,
        PostgresBotStatusRepository, PostgresRiskRepository,
        PostgresMarketRepository, PostgresMarketOutcomeRepository,
        PostgresEventLogRepository,
    )

    return RepositorySet(
        predictions=PostgresPredictionRepository(session_factory),
        trades=PostgresTradeRepository(session_factory),
        bot_status=PostgresBotStatusRepository(session_factory),
        risk=PostgresRiskRepository(session_factory),
        market=PostgresMarketRepository(session_factory),
        market_outcome=PostgresMarketOutcomeRepository(session_factory),
        event_log=PostgresEventLogRepository(session_factory),
    )
