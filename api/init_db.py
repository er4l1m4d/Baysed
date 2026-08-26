"""Database initialization for Bayse Bot.

Creates tables if they don't exist. Used on startup.
"""
import os
import asyncio
import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine

from api.models import Base

log = logging.getLogger(__name__)


def get_database_url() -> str:
    """Get database URL from environment, with fallback to SQLite."""
    url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./bayse_bot.db")
    
    # Convert postgres:// to postgresql:// for SQLAlchemy
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    
    # Add async driver if not present
    if url.startswith("postgresql://") and "+asyncpg" not in url:
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    
    return url


async def init_db():
    """Create all tables if they don't exist."""
    url = get_database_url()
    
    # For Alembic migrations, we use the sync URL
    # For runtime, we use the async URL
    sync_url = url.replace("+asyncpg", "").replace("+psycopg2", "")
    
    engine = create_async_engine(url, echo=False)
    
    async with engine.begin() as conn:
        # Create tables if they don't exist
        await conn.run_sync(Base.metadata.create_all)
    
    await engine.dispose()
    
    log.info("database initialized: %s", url.split("@")[-1] if "@" in url else url)
    return url


if __name__ == "__main__":
    asyncio.run(init_db())
