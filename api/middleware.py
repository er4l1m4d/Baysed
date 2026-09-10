"""HTTP middleware and endpoint guards.

- RateLimitMiddleware: per-IP sliding window (in-memory, single instance)
- require_admin: optional ADMIN_TOKEN gate for /debug endpoints

No external dependencies — plain Starlette/FastAPI.
"""
from __future__ import annotations

import os
import time
from collections import defaultdict, deque

from fastapi import Header, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


def client_ip(request) -> str:
    """Best-effort client IP (Render proxies set X-Forwarded-For)."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window per-IP rate limit.

    Limit: 300 requests / 60s per IP (terminal worst case is ~64/min with
    every poll hook mounted; 429 carries CORS headers because CORSMiddleware
    wraps this). WebSocket upgrades are exempt. In-memory — resets on
    restart, fine for a single-instance deployment.
    """

    def __init__(self, app, limit: int = 300, window_seconds: int = 60) -> None:
        super().__init__(app)
        self.limit = limit
        self.window_seconds = window_seconds
        self._hits: dict[str, deque] = defaultdict(deque)

    async def dispatch(self, request, call_next):
        if request.url.path.startswith("/ws"):
            return await call_next(request)

        ip = client_ip(request)
        now = time.monotonic()
        hits = self._hits[ip]

        while hits and now - hits[0] > self.window_seconds:
            hits.popleft()

        if len(hits) >= self.limit:
            return JSONResponse(
                {"error": "rate_limited", "retry_after_seconds": self.window_seconds},
                status_code=429,
                headers={"Retry-After": str(self.window_seconds)},
            )

        hits.append(now)

        # Evict stale IPs so spoofed X-Forwarded-For values can't grow memory unbounded
        if len(self._hits) > 10_000:
            self._evict_stale(now)

        return await call_next(request)

    def _evict_stale(self, now: float) -> None:
        stale = [
            ip for ip, hits in self._hits.items()
            if not hits or now - hits[-1] > self.window_seconds
        ]
        for ip in stale:
            del self._hits[ip]


async def require_admin(x_admin_token: str = Header(default=None)) -> None:
    """Gate for /debug endpoints. Active only when ADMIN_TOKEN is set.

    Set ADMIN_TOKEN on Render to lock down /debug, /debug/discovery and
    /debug/resolution (they trigger live Bayse API calls and expose
    internals). Without the env var the endpoints stay open for local dev.
    """
    token = os.getenv("ADMIN_TOKEN")
    if token and x_admin_token != token:
        raise HTTPException(
            status_code=401,
            detail="admin token required (X-Admin-Token header)",
        )
