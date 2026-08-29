"""Bayse Bot API Server.

REST API for the quantitative engine:
- GET /status — bot status, BTC price, strategy metrics
- GET /predictions — prediction history with filters
- GET /predictions/{market_id} — single prediction
- GET /calibration — calibration stats (Brier score, accuracy)
- GET /trades — trade history
- GET /health — health check
- WS /ws — live BTC price + market updates
"""
from __future__ import annotations
import asyncio
import json
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import FastAPI, Depends, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from .database import init_db, get_db, async_session
from .models import Prediction, BotStatus, TradeRecord
from .shared import shared_state

log = logging.getLogger(__name__)

app = FastAPI(title="Bayse Bot API", version="1.0.0")

# CORS for Vercel terminal
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class StatusResponse(BaseModel):
    is_running: bool
    mode: str
    strategy: str
    last_cycle_at: str | None
    last_btc_price: float | None
    last_momentum_pct: float | None
    last_volatility: float | None
    total_predictions: int
    total_resolved: int
    total_correct: int
    accuracy: float | None
    brier_mean: float | None
    uptime_seconds: int
    error_count: int
    last_error: str | None


class PredictionResponse(BaseModel):
    id: int
    market_id: str
    event_id: str
    title: str
    strike_price: float
    current_btc_price: float
    distance_from_strike_pct: float
    is_above_strike: bool
    seconds_remaining: int
    seconds_elapsed: int
    realized_volatility: float
    momentum_pct: float
    yes_ask: float | None
    no_ask: float | None
    spread: float | None
    strategy: str
    probability: float | None
    predicted_outcome: str
    edge: float | None
    signal_strength: float
    approved: bool
    reasons: list[str] | None
    # Timestamps
    observed_at: str | None = None
    decided_at: str | None = None
    recorded_at: str
    # Contract timing
    opened_at: str | None = None
    closes_at: str | None = None
    volume_ratio: float | None = None
    # Outcome IDs
    outcome1_id: str | None = None
    outcome2_id: str | None = None
    # Resolution
    outcome_resolution: str
    actual_price: float | None
    resolved_at: str | None
    resolved_outcome_id: str | None = None
    prediction_correct: bool | None
    brier_score: float | None


class LiveMarketResponse(BaseModel):
    """Canonical live market state for the terminal."""
    market_id: str | None = None
    event_id: str | None = None
    title: str | None = None
    strike_price: float | None = None
    btc_price: float | None = None
    opens_at: str | None = None
    closes_at: str | None = None
    seconds_remaining: int | None = None
    yes_ask: float | None = None
    no_ask: float | None = None
    model_probability: float | None = None
    model_predicted_outcome: str | None = None
    edge: float | None = None
    is_active: bool = False


class CalibrationResponse(BaseModel):
    total: int
    resolved: int
    pending: int
    correct: int
    accuracy: float | None
    brier_mean: float | None
    calibration_curve: list[dict[str, Any]]


class TradeResponse(BaseModel):
    id: int
    market_id: str
    outcome: str
    side: str
    amount: float
    price: float
    shares: float | None
    fee: float | None
    status: str
    mode: str
    recorded_at: str
    settled: bool
    pnl: float | None


# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass


manager = ConnectionManager()


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup():
    await init_db()


@app.api_route("/health", methods=["GET", "HEAD"])
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/debug")
async def debug():
    from .shared import bot_diagnostics
    # Test Bayse API connectivity
    bayse_ok = False
    bayse_events = 0
    try:
        from bayse_bot.bayse import BayseClient
        async with BayseClient("https://relay.bayse.markets") as client:
            events = await client.events_by_series("crypto-btc-15min")
            bayse_events = len(events)
            bayse_ok = True
    except Exception as e:
        bayse_ok = False
    return {
        "btc_price": float(shared_state.btc_price) if shared_state.btc_price else None,
        "btc_connected": shared_state.last_tick_at is not None if hasattr(shared_state, 'last_tick_at') else False,
        "bot_started": bot_diagnostics["started"],
        "bot_error": bot_diagnostics["error"],
        "init_error": bot_diagnostics["init_error"],
        "cycles": bot_diagnostics["cycles"],
        "bayse_api_ok": bayse_ok,
        "bayse_events": bayse_events,
    }


@app.get("/state", response_model=LiveMarketResponse)
async def get_live_state(db: AsyncSession = Depends(get_db)):
    """Canonical live market state for the terminal.

    Returns the current active market with live countdown.
    The terminal should use this for the LIVE MARKET section,
    not prediction snapshots.
    """
    live_price = float(shared_state.btc_price) if shared_state.btc_price else None

    # Get the most recent prediction (closest to current market state)
    result = await db.execute(
        select(Prediction)
        .where(Prediction.outcome_resolution == "pending")
        .order_by(Prediction.recorded_at.desc())
        .limit(1)
    )
    latest = result.scalar_one_or_none()

    if not latest:
        return LiveMarketResponse(btc_price=live_price, is_active=False)

    # Calculate live seconds remaining from closes_at
    now = datetime.now(timezone.utc)
    seconds_remaining = None
    if latest.closes_at:
        seconds_remaining = max(0, int((latest.closes_at - now).total_seconds()))

    return LiveMarketResponse(
        market_id=latest.market_id,
        event_id=latest.event_id,
        title=latest.title,
        strike_price=float(latest.strike_price) if latest.strike_price else None,
        btc_price=live_price,
        opens_at=latest.opened_at.isoformat() if latest.opened_at else None,
        closes_at=latest.closes_at.isoformat() if latest.closes_at else None,
        seconds_remaining=seconds_remaining,
        yes_ask=float(latest.yes_ask) if latest.yes_ask else None,
        no_ask=float(latest.no_ask) if latest.no_ask else None,
        model_probability=float(latest.probability) if latest.probability else None,
        model_predicted_outcome=latest.predicted_outcome or None,
        edge=float(latest.edge) if latest.edge else None,
        is_active=seconds_remaining is not None and seconds_remaining > 0,
    )


@app.get("/status", response_model=StatusResponse)
async def get_status(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BotStatus).where(BotStatus.id == 1))
    status = result.scalar_one_or_none()

    # Get live BTC price from shared state (in-memory, updated by feed)
    live_price = float(shared_state.btc_price) if shared_state.btc_price else None
    live_momentum = float(shared_state.btc_features.momentum_pct) if shared_state.btc_features.momentum_pct else None
    live_volatility = float(shared_state.btc_features.atr_pct) if shared_state.btc_features.atr_pct else None

    if not status:
        return StatusResponse(
            is_running=False, mode="observation", strategy="distance_to_strike",
            last_cycle_at=None, last_btc_price=live_price, last_momentum_pct=live_momentum,
            last_volatility=live_volatility, total_predictions=0, total_resolved=0,
            total_correct=0, accuracy=None, brier_mean=None, uptime_seconds=0,
            error_count=0, last_error=None,
        )

    accuracy = None
    if status.total_resolved and status.total_resolved > 0:
        accuracy = status.total_correct / status.total_resolved

    return StatusResponse(
        is_running=status.is_running,
        mode=status.mode,
        strategy=status.strategy,
        last_cycle_at=status.last_cycle_at.isoformat() if status.last_cycle_at else None,
        last_btc_price=live_price or (float(status.last_btc_price) if status.last_btc_price else None),
        last_momentum_pct=live_momentum or (float(status.last_momentum_pct) if status.last_momentum_pct else None),
        last_volatility=live_volatility or (float(status.last_volatility) if status.last_volatility else None),
        total_predictions=status.total_predictions,
        total_resolved=status.total_resolved,
        total_correct=status.total_correct,
        accuracy=accuracy,
        brier_mean=float(status.brier_mean) if status.brier_mean else None,
        uptime_seconds=status.uptime_seconds,
        error_count=status.error_count,
        last_error=status.last_error,
    )


@app.get("/predictions", response_model=list[PredictionResponse])
async def get_predictions(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    resolution: str | None = Query(None, description="Filter by resolution status"),
    db: AsyncSession = Depends(get_db),
):
    query = select(Prediction).order_by(Prediction.recorded_at.desc())
    if resolution:
        query = query.where(Prediction.outcome_resolution == resolution)
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    predictions = result.scalars().all()

    return [
        PredictionResponse(
            id=p.id,
            market_id=p.market_id,
            event_id=p.event_id,
            title=p.title,
            strike_price=float(p.strike_price),
            current_btc_price=float(p.current_btc_price),
            distance_from_strike_pct=float(p.distance_from_strike_pct),
            is_above_strike=p.is_above_strike,
            seconds_remaining=p.seconds_remaining,
            seconds_elapsed=p.seconds_elapsed,
            realized_volatility=float(p.realized_volatility),
            momentum_pct=float(p.momentum_pct),
            yes_ask=float(p.yes_ask) if p.yes_ask else None,
            no_ask=float(p.no_ask) if p.no_ask else None,
            spread=float(p.spread) if p.spread else None,
            strategy=p.strategy,
            probability=float(p.probability) if p.probability else None,
            predicted_outcome=p.predicted_outcome or "",
            edge=float(p.edge) if p.edge else None,
            signal_strength=float(p.signal_strength),
            approved=p.approved,
            reasons=p.reasons,
            # Timestamps
            observed_at=p.observed_at.isoformat() if p.observed_at else None,
            decided_at=p.decided_at.isoformat() if p.decided_at else None,
            recorded_at=p.recorded_at.isoformat() if p.recorded_at else "",
            # Contract timing
            opened_at=p.opened_at.isoformat() if p.opened_at else None,
            closes_at=p.closes_at.isoformat() if p.closes_at else None,
            volume_ratio=float(p.volume_ratio) if p.volume_ratio else None,
            # Outcome IDs
            outcome1_id=p.outcome1_id or None,
            outcome2_id=p.outcome2_id or None,
            # Resolution
            outcome_resolution=p.outcome_resolution or "pending",
            actual_price=float(p.actual_price) if p.actual_price else None,
            resolved_at=p.resolved_at.isoformat() if p.resolved_at else None,
            resolved_outcome_id=p.resolved_outcome_id or None,
            prediction_correct=p.prediction_correct,
            brier_score=float(p.brier_score) if p.brier_score else None,
        )
        for p in predictions
    ]


@app.get("/calibration", response_model=CalibrationResponse)
async def get_calibration(db: AsyncSession = Depends(get_db)):
    try:
        # Total counts
        total = (await db.execute(select(func.count(Prediction.id)))).scalar() or 0
        resolved = (await db.execute(
            select(func.count(Prediction.id)).where(Prediction.outcome_resolution != "pending")
        )).scalar() or 0
        correct = (await db.execute(
            select(func.count(Prediction.id)).where(Prediction.prediction_correct == True)
        )).scalar() or 0

        # Brier mean
        brier_result = await db.execute(
            select(func.avg(Prediction.brier_score)).where(Prediction.brier_score.isnot(None))
        )
        brier_mean = brier_result.scalar()

        # Calibration curve: single grouped SQL query
        # Uses actual YES rate from outcome_resolution (not prediction_correct)
        curve_result = await db.execute(text("""
            SELECT
                FLOOR(probability * 10) AS bucket_idx,
                COUNT(*) AS cnt,
                AVG(probability) AS avg_prob,
                AVG(CASE WHEN outcome_resolution = 'yes_won' THEN 1.0 ELSE 0.0 END) AS actual_yes_rate
            FROM predictions
            WHERE outcome_resolution != 'pending'
              AND probability IS NOT NULL
            GROUP BY FLOOR(probability * 10)
            ORDER BY bucket_idx
        """))
        curve = []
        for row in curve_result.fetchall():
            bucket_idx = int(row[0])
            count = row[1] or 0
            avg_prob = float(row[2]) if row[2] else 0
            actual_rate = float(row[3]) if row[3] else 0
            low = bucket_idx * 0.1
            high = (bucket_idx + 1) * 0.1
            curve.append({
                "bucket": f"{int(low*100)}-{int(high*100)}%",
                "count": count,
                "avg_predicted": round(avg_prob, 4),
                "actual_rate": round(actual_rate, 4),
                "gap": round(avg_prob - actual_rate, 4),
            })

        return CalibrationResponse(
            total=total,
            resolved=resolved,
            pending=total - resolved,
            correct=correct,
            accuracy=correct / resolved if resolved > 0 else None,
            brier_mean=float(brier_mean) if brier_mean else None,
            calibration_curve=curve,
        )
    except Exception as e:
        logging.getLogger(__name__).error("calibration error: %s", e)
        return CalibrationResponse(
            total=0, resolved=0, pending=0, correct=0,
            accuracy=None, brier_mean=None, calibration_curve=[],
        )


@app.get("/trades", response_model=list[TradeResponse])
async def get_trades(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TradeRecord).order_by(TradeRecord.recorded_at.desc()).offset(offset).limit(limit)
    )
    trades = result.scalars().all()

    return [
        TradeResponse(
            id=t.id,
            market_id=t.market_id,
            outcome=t.outcome,
            side=t.side,
            amount=float(t.amount),
            price=float(t.price),
            shares=float(t.shares) if t.shares else None,
            fee=float(t.fee) if t.fee else None,
            status=t.status,
            mode=t.mode,
            recorded_at=t.recorded_at.isoformat() if t.recorded_at else "",
            settled=t.settled,
            pnl=float(t.pnl) if t.pnl else None,
        )
        for t in trades
    ]


# ---------------------------------------------------------------------------
# WebSocket for live data
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive, client can send pings
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect(websocket)


async def broadcast_btc_price(price: float, momentum: float, volatility: float):
    """Called by the bot to push live BTC data to all connected terminals."""
    await manager.broadcast({
        "type": "btc_price",
        "price": price,
        "momentum": momentum,
        "volatility": volatility,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


async def broadcast_active_market(market_data: dict):
    """Called by the bot to push live market state to all connected terminals."""
    await manager.broadcast({
        "type": "active_market",
        "data": market_data,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


async def broadcast_prediction(prediction: dict):
    """Called by the bot to push new predictions to terminals."""
    await manager.broadcast({
        "type": "prediction",
        "data": prediction,
    })
