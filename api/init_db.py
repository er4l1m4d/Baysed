"""Database initialization for Bayse Bot.

Creates tables if they don't exist. Used on startup.
"""
import os
import asyncio
import logging
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
from sqlalchemy.ext.asyncio import create_async_engine

from api.models import Base

log = logging.getLogger(__name__)


def get_database_url() -> str:
    """Get database URL from environment, with fallback to SQLite.
    
    Handles Neon's sslmode=require by converting to asyncpg's ssl parameter.
    """
    url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./bayse_bot.db")
    
    # Convert postgres:// to postgresql:// for SQLAlchemy
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    
    # Parse the URL to handle sslmode parameter
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    
    # Extract sslmode if present (Neon uses this)
    sslmode = params.pop("sslmode", [None])[0]
    
    # Rebuild query string without sslmode
    clean_query = urlencode(params, doseq=True)
    clean_url = urlunparse(parsed._replace(query=clean_query))
    
    # Add async driver if not present
    if clean_url.startswith("postgresql://") and "+asyncpg" not in clean_url:
        clean_url = clean_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    
    return clean_url, sslmode


async def init_db():
    """Create all tables if they don't exist."""
    url, sslmode = get_database_url()
    
    # Configure SSL for asyncpg if needed
    connect_args = {}
    if sslmode == "require":
        import ssl
        connect_args["ssl"] = ssl.create_default_context()
        connect_args["ssl"].verify_mode = ssl.CERT_REQUIRED
    
    engine = create_async_engine(
        url, 
        echo=False,
        connect_args=connect_args if connect_args else None
    )
    
    async with engine.begin() as conn:
        # Create tables if they don't exist
        await conn.run_sync(Base.metadata.create_all)
    
    await engine.dispose()
    
    log.info("database initialized: %s", url.split("@")[-1] if "@" in url else url)
    return url


if __name__ == "__main__":
    asyncio.run(init_db())
