"""Run the Bayse Bot API server with database initialization."""
import asyncio
import logging
import uvicorn

from api.init_db import init_db

log = logging.getLogger(__name__)


async def start():
    """Initialize database and start server."""
    await init_db()
    log.info("database ready, starting server...")
    
    # Start uvicorn server
    config = uvicorn.Config(
        "api.server:app",
        host="0.0.0.0",
        port=8000,
        reload=False,  # Disable reload in production
        log_level="info"
    )
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    asyncio.run(start())
