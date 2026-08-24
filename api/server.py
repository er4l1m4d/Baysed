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
    recorded_at: str
    outcome_resolution: str
    actual_price: float | None
    resolved_at: str | None
    prediction_correct: bool | None
    brier_score: float | None


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


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/status", response_model=StatusResponse)
async def get_status(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BotStatus).where(BotStatus.id == 1))
    status = result.scalar_one_or_none()

    if not status:
        return StatusResponse(
            is_running=False, mode="observation", strategy="distance_to_strike",
            last_cycle_at=None, last_btc_price=None, last_momentum_pct=None,
            last_volatility=None, total_predictions=0, total_resolved=0,
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
        last_btc_price=float(status.last_btc_price) if status.last_btc_price else None,
        last_momentum_pct=float(status.last_momentum_pct) if status.last_momentum_pct else None,
        last_volatility=float(status.last_volatility) if status.last_volatility else None,
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
            recorded_at=p.recorded_at.isoformat() if p.recorded_at else "",
            outcome_resolution=p.outcome_resolution or "pending",
            actual_price=float(p.actual_price) if p.actual_price else None,
            resolved_at=p.resolved_at.isoformat() if p.resolved_at else None,
            prediction_correct=p.prediction_correct,
            brier_score=float(p.brier_score) if p.brier_score else None,
        )
        for p in predictions
    ]


@app.get("/calibration", response_model=CalibrationResponse)
async def get_calibration(db: AsyncSession = Depends(get_db)):
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

    # Calibration curve
    curve = []
    for bucket_idx in range(10):
        low = bucket_idx * 0.1
        high = (bucket_idx + 1) * 0.1
        bucket_result = await db.execute(
            select(
                func.count(Prediction.id),
                func.avg(Prediction.probability),
                func.sum(func.cast(Prediction.prediction_correct, Integer)),
            ).where(
                Prediction.probability >= low,
                Prediction.probability < high,
                Prediction.outcome_resolution != "pending",
            )
        )
        row = bucket_result.one()
        count = row[0] or 0
        if count > 0:
            avg_prob = float(row[1]) if row[1] else 0
            bucket_correct = row[2] or 0
            actual_rate = bucket_correct / count
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


async def broadcast_prediction(prediction: dict):
    """Called by the bot to push new predictions to terminals."""
    await manager.broadcast({
        "type": "prediction",
        "data": prediction,
    })
