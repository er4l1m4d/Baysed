"""Database initialization for Bayse Bot.

Creates tables if they don't exist. Used on startup.
"""
import os
import asyncio
import logging
import ssl
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
from sqlalchemy.ext.asyncio import create_async_engine

from api.models import Base

log = logging.getLogger(__name__)


def get_database_url() -> tuple[str, bool]:
    """Get database URL from environment, with fallback to SQLite.
    
    Returns (url, needs_ssl) tuple.
    Strips Neon-specific query params that asyncpg doesn't understand.
    """
    raw_url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./bayse_bot.db")
    
    # Convert postgres:// to postgresql:// for SQLAlchemy
    if raw_url.startswith("postgres://"):
        raw_url = raw_url.replace("postgres://", "postgresql://", 1)
    
    # Parse the URL
    parsed = urlparse(raw_url)
    params = parse_qs(parsed.query)
    
    # Check if SSL is needed
    needs_ssl = params.get("sslmode", [None])[0] == "require"
    
    # Remove ALL query params - asyncpg doesn't understand most of them
    clean_url = urlunparse(parsed._replace(query=""))
    
    # Add async driver if not present
    if clean_url.startswith("postgresql://") and "+asyncpg" not in clean_url:
        clean_url = clean_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    
    return clean_url, needs_ssl


async def init_db():
    """Create all tables if they don't exist."""
    url, needs_ssl = get_database_url()
    
    # Configure SSL for asyncpg if needed
    connect_args = {}
    if needs_ssl:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        connect_args["ssl"] = ctx
    
    engine = create_async_engine(
        url, 
        echo=False,
        connect_args=connect_args if connect_args else None
    )
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    await engine.dispose()
    
    log.info("database initialized: %s", url.split("@")[-1] if "@" in url else url)
    return url


if __name__ == "__main__":
    asyncio.run(init_db())
