"""Database initialization for Bayse Bot.

Creates tables if they don't exist and adds missing columns.
Used on startup for both development and production.
"""
import os
import asyncio
import logging
import ssl
from urllib.parse import urlparse, parse_qs, urlunparse
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

from api.models import Base

log = logging.getLogger(__name__)


def get_database_url() -> tuple[str, bool]:
    """Get database URL from environment, with fallback to SQLite."""
    raw_url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./bayse_bot.db")

    if raw_url.startswith("postgres://"):
        raw_url = raw_url.replace("postgres://", "postgresql://", 1)

    parsed = urlparse(raw_url)
    params = parse_qs(parsed.query)
    needs_ssl = params.get("sslmode", [None])[0] == "require"

    clean_url = urlunparse(parsed._replace(query=""))

    if clean_url.startswith("postgresql://") and "+asyncpg" not in clean_url:
        clean_url = clean_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    return clean_url, needs_ssl


# Columns to add if missing (column_name, column_definition)
COLUMNS_TO_ADD = [
    ("observed_at", "TIMESTAMP WITH TIME ZONE"),
    ("decided_at", "TIMESTAMP WITH TIME ZONE"),
    ("opened_at", "TIMESTAMP WITH TIME ZONE"),
    ("closes_at", "TIMESTAMP WITH TIME ZONE"),
    ("volume_ratio", "NUMERIC(10, 6)"),
    ("outcome1_id", "VARCHAR(255)"),
    ("outcome2_id", "VARCHAR(255)"),
    ("resolved_outcome_id", "VARCHAR(255)"),
]


async def ensure_columns(engine):
    """Add missing columns to existing tables (safe — only adds if not exists)."""
    async with engine.begin() as conn:
        for col_name, col_def in COLUMNS_TO_ADD:
            try:
                await conn.execute(text(
                    f"ALTER TABLE predictions ADD COLUMN IF NOT EXISTS {col_name} {col_def}"
                ))
            except Exception as e:
                # SQLite doesn't support ALTER TABLE ADD COLUMN IF NOT EXISTS
                # but it's fine — create_all handles SQLite
                if "sqlite" not in str(type(conn)):
                    log.warning("could not add column %s: %s", col_name, e)

        # Backfill timestamps for existing rows
        try:
            await conn.execute(text(
                "UPDATE predictions SET observed_at = recorded_at, decided_at = recorded_at "
                "WHERE observed_at IS NULL"
            ))
        except Exception:
            pass

        # Ensure index exists (drop unique, create non-unique)
        try:
            await conn.execute(text(
                "DROP INDEX IF EXISTS ix_predictions_market_id"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_predictions_market_id ON predictions (market_id)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_predictions_market_time ON predictions (market_id, recorded_at)"
            ))
        except Exception:
            pass


async def init_db():
    """Create all tables and ensure schema is up to date."""
    url, needs_ssl = get_database_url()

    connect_args = {}
    if needs_ssl:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        connect_args["ssl"] = ctx

    engine = create_async_engine(url, echo=False, connect_args=connect_args if connect_args else None)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Add missing columns for existing databases
    await ensure_columns(engine)

    await engine.dispose()

    log.info("database initialized: %s", url.split("@")[-1] if "@" in url else url)
    return url


if __name__ == "__main__":
    asyncio.run(init_db())
