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


# Columns to add if missing (table, column_name, column_definition)
PREDICTION_COLUMNS = [
    ("observed_at", "TIMESTAMP WITH TIME ZONE"),
    ("decided_at", "TIMESTAMP WITH TIME ZONE"),
    ("opened_at", "TIMESTAMP WITH TIME ZONE"),
    ("closes_at", "TIMESTAMP WITH TIME ZONE"),
    ("volume_ratio", "NUMERIC(10, 6)"),
    ("outcome1_id", "VARCHAR(255)"),
    ("outcome2_id", "VARCHAR(255)"),
    ("resolved_outcome_id", "VARCHAR(255)"),
    ("edge_fee", "NUMERIC(10, 6)"),
    ("bayse_implied", "NUMERIC(10, 6)"),
    ("yes_edge", "NUMERIC(10, 6)"),
    ("yes_edge_fee", "NUMERIC(10, 6)"),
    ("no_edge", "NUMERIC(10, 6)"),
    ("no_edge_fee", "NUMERIC(10, 6)"),
    ("model_version", "VARCHAR(100)"),
    ("run_id", "VARCHAR(100)"),
    ("resolution_source", "VARCHAR(50)"),
]

BOT_STATUS_COLUMNS = [
    ("feed_health", "JSONB"),
]


async def _run_statement(engine, stmt: str, description: str, max_retries: int = 5) -> None:
    """Run one migration statement in its own transaction with lock timeout + retry.

    Small lock footprint per statement avoids deadlocking against the still-running
    previous deploy (Render zero-downtime deploys keep the old instance querying).
    """
    is_postgres = engine.dialect.name == "postgresql"
    for attempt in range(max_retries):
        try:
            async with engine.begin() as conn:
                if is_postgres:
                    await conn.execute(text("SET LOCAL lock_timeout = '3s'"))
                await conn.execute(text(stmt))
            return
        except Exception as e:
            if not is_postgres:
                log.warning("could not run migration %s: %s", description, e)
                return
            msg = str(e).lower()
            retryable = "deadlock" in msg or "lock timeout" in msg or "canceling statement due to lock" in msg
            if retryable and attempt < max_retries - 1:
                delay = 2 ** attempt
                log.warning("migration %s attempt %d hit lock contention, retrying in %ds: %s",
                            description, attempt + 1, delay, e)
                await asyncio.sleep(delay)
            elif "already exists" in msg:
                return
            else:
                log.warning("could not run migration %s: %s", description, e)
                return


async def ensure_columns(engine):
    """Add missing columns to existing tables (safe — only adds if not exists)."""
    statements: list[tuple[str, str]] = []
    for col_name, col_def in PREDICTION_COLUMNS:
        statements.append((
            f"ALTER TABLE predictions ADD COLUMN IF NOT EXISTS {col_name} {col_def}",
            f"predictions.{col_name}",
        ))
    for col_name, col_def in BOT_STATUS_COLUMNS:
        statements.append((
            f"ALTER TABLE bot_status ADD COLUMN IF NOT EXISTS {col_name} {col_def}",
            f"bot_status.{col_name}",
        ))
    statements.append((
        "UPDATE predictions SET observed_at = recorded_at, decided_at = recorded_at "
        "WHERE observed_at IS NULL",
        "backfill_timestamps",
    ))
    statements.append(("DROP INDEX IF EXISTS ix_predictions_market_id", "drop_unique_index"))
    statements.append((
        "CREATE INDEX IF NOT EXISTS ix_predictions_market_id ON predictions (market_id)",
        "index_market_id",
    ))
    statements.append((
        "CREATE INDEX IF NOT EXISTS ix_predictions_market_time ON predictions (market_id, recorded_at)",
        "index_market_time",
    ))

    for stmt, description in statements:
        await _run_statement(engine, stmt, description)


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

    # create_all on existing tables only reads the catalog, but retry anyway
    # so a zero-downtime deploy overlap can't fail startup.
    for attempt in range(5):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            break
        except Exception as e:
            if attempt < 4:
                log.warning("create_all attempt %d failed, retrying in %ds: %s",
                            attempt + 1, 2 ** attempt, e)
                await asyncio.sleep(2 ** attempt)
            else:
                raise

    # Add missing columns for existing databases
    await ensure_columns(engine)

    await engine.dispose()

    log.info("database initialized: %s", url.split("@")[-1] if "@" in url else url)
    return url


if __name__ == "__main__":
    asyncio.run(init_db())
