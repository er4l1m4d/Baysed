"""Tests for API middleware: rate limiting and admin gating."""
import pytest


class DummyRequest:
    def __init__(self, path="/predictions", headers=None, client_host="1.2.3.4"):
        self.url = type("U", (), {"path": path})()
        self.headers = headers or {}
        self.client = type("C", (), {"host": client_host})()


async def ok_call_next(request):
    async def resp():
        yield b"{}"
    return type("R", (), {"status_code": 200, "body_iterator": resp()})()


@pytest.mark.asyncio
async def test_rate_limit_allows_normal_traffic():
    from api.middleware import RateLimitMiddleware

    mw = RateLimitMiddleware(app=None, limit=5, window_seconds=60)
    for i in range(5):
        resp = await mw.dispatch(DummyRequest(), ok_call_next)
        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_rate_limit_blocks_excess():
    from api.middleware import RateLimitMiddleware

    mw = RateLimitMiddleware(app=None, limit=3, window_seconds=60)
    for _ in range(3):
        await mw.dispatch(DummyRequest(), ok_call_next)
    resp = await mw.dispatch(DummyRequest(), ok_call_next)
    assert resp.status_code == 429
    assert resp.headers["Retry-After"] == "60"


@pytest.mark.asyncio
async def test_rate_limit_tracks_ips_separately():
    from api.middleware import RateLimitMiddleware

    mw = RateLimitMiddleware(app=None, limit=2, window_seconds=60)
    for _ in range(2):
        await mw.dispatch(DummyRequest(client_host="1.1.1.1"), ok_call_next)
    # Different IP unaffected
    resp = await mw.dispatch(DummyRequest(client_host="2.2.2.2"), ok_call_next)
    assert resp.status_code == 200
    # First IP blocked
    resp = await mw.dispatch(DummyRequest(client_host="1.1.1.1"), ok_call_next)
    assert resp.status_code == 429


@pytest.mark.asyncio
async def test_rate_limit_exempts_websocket():
    from api.middleware import RateLimitMiddleware

    mw = RateLimitMiddleware(app=None, limit=1, window_seconds=60)
    await mw.dispatch(DummyRequest(path="/ws"), ok_call_next)
    # /ws never counts; even beyond limit, /ws passes
    await mw.dispatch(DummyRequest(path="/ws"), ok_call_next)
    await mw.dispatch(DummyRequest(path="/ws"), ok_call_next)
    resp = await mw.dispatch(DummyRequest(path="/ws"), ok_call_next)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_rate_limit_uses_x_forwarded_for():
    from api.middleware import RateLimitMiddleware

    mw = RateLimitMiddleware(app=None, limit=1, window_seconds=60)
    req_a = DummyRequest(headers={"x-forwarded-for": "9.9.9.9, 10.0.0.1"})
    await mw.dispatch(req_a, ok_call_next)
    # Same forwarded IP -> blocked
    req_b = DummyRequest(headers={"x-forwarded-for": "9.9.9.9"}, client_host="8.8.8.8")
    resp = await mw.dispatch(req_b, ok_call_next)
    assert resp.status_code == 429


@pytest.mark.asyncio
async def test_admin_gate_open_when_no_token_set(monkeypatch):
    from api.middleware import require_admin

    monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    await require_admin(x_admin_token=None)  # no error


@pytest.mark.asyncio
async def test_admin_gate_rejects_wrong_token(monkeypatch):
    from api.middleware import require_admin
    from fastapi import HTTPException

    monkeypatch.setenv("ADMIN_TOKEN", "sekrit")
    with pytest.raises(HTTPException) as exc:
        await require_admin(x_admin_token="wrong")
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_admin_gate_accepts_correct_token(monkeypatch):
    from api.middleware import require_admin

    monkeypatch.setenv("ADMIN_TOKEN", "sekrit")
    await require_admin(x_admin_token="sekrit")  # no error
