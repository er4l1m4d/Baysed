"""Database connection and session management."""
from __future__ import annotations
import os
import ssl
from urllib.parse import urlparse, parse_qs, urlunparse
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from .models import Base

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./bayse_bot.db")

# Convert postgres:// to postgresql+asyncpg:// for SQLAlchemy
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://") and "+asyncpg" not in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

# Use aiosqlite for local SQLite development
if DATABASE_URL.startswith("sqlite://") and "+aiosqlite" not in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("sqlite://", "sqlite+aiosqlite://", 1)

# Parse URL to check for SSL and strip incompatible params (Neon adds sslmode, channel_binding, etc.)
parsed = urlparse(DATABASE_URL)
params = parse_qs(parsed.query)
needs_ssl = params.get("sslmode", [None])[0] == "require"

# Remove ALL query params — asyncpg doesn't understand Neon's extras
DATABASE_URL = urlunparse(parsed._replace(query=""))

# Configure SSL for asyncpg if needed
connect_args = {}
if needs_ssl:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    connect_args["ssl"] = ctx

engine = create_async_engine(
    DATABASE_URL, 
    echo=False, 
    pool_pre_ping=True,
    connect_args=connect_args if connect_args else None
)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
    """Create all tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncSession:
    """Dependency for FastAPI endpoints."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
