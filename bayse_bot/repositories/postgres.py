"""PostgreSQL repository implementations.

Uses async SQLAlchemy for all database operations.
Works with Neon, Render Postgres, or any PostgreSQL provider.
"""
from __future__ import annotations
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import select, func, update, Integer, text
from sqlalchemy.ext.asyncio import AsyncSession

from .interfaces import (
    PredictionRepository, TradeRepository, BotStatusRepository,
    RiskRepository, MarketRepository, EventLogRepository,
)


class PostgresPredictionRepository(PredictionRepository):
    """PostgreSQL implementation of prediction persistence."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def save_prediction(self, prediction: dict[str, Any]) -> None:
        from api.models import Prediction
        pred = Prediction(**prediction)
        self.session.add(pred)
        await self.session.flush()

    async def get_prediction(self, market_id: str) -> dict[str, Any] | None:
        from api.models import Prediction
        result = await self.session.execute(
            select(Prediction).where(Prediction.market_id == market_id)
        )
        pred = result.scalar_one_or_none()
        if not pred:
            return None
        return self._to_dict(pred)

    async def get_predictions(
        self, limit: int = 50, offset: int = 0, resolution: str | None = None
    ) -> list[dict[str, Any]]:
        from api.models import Prediction
        query = select(Prediction).order_by(Prediction.recorded_at.desc())
        if resolution:
            query = query.where(Prediction.outcome_resolution == resolution)
        query = query.offset(offset).limit(limit)
        result = await self.session.execute(query)
        return [self._to_dict(p) for p in result.scalars().all()]

    async def update_resolution(
        self,
        market_id: str,
        outcome_resolution: str,
        actual_price: Decimal | None = None,
        prediction_correct: bool | None = None,
        brier_score: Decimal | None = None,
    ) -> None:
        from api.models import Prediction
        values: dict[str, Any] = {
            "outcome_resolution": outcome_resolution,
            "resolved_at": datetime.now(timezone.utc),
        }
        if actual_price is not None:
            values["actual_price"] = actual_price
        if prediction_correct is not None:
            values["prediction_correct"] = prediction_correct
        if brier_score is not None:
            values["brier_score"] = brier_score

        await self.session.execute(
            update(Prediction)
            .where(Prediction.market_id == market_id)
            .values(**values)
        )

    async def get_pending_predictions(self) -> list[dict[str, Any]]:
        from api.models import Prediction
        result = await self.session.execute(
            select(Prediction).where(Prediction.outcome_resolution == "pending")
        )
        return [self._to_dict(p) for p in result.scalars().all()]

    async def get_calibration_stats(self) -> dict[str, Any]:
        from api.models import Prediction
        total = await self.count_predictions()
        resolved = await self.count_resolved()
        correct = await self.count_correct()
        brier_mean = await self.get_brier_mean()

        # Calibration curve
        curve = []
        for bucket_idx in range(10):
            low = bucket_idx * 0.1
            high = (bucket_idx + 1) * 0.1
            result = await self.session.execute(
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
            row = result.one()
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

        return {
            "total": total,
            "resolved": resolved,
            "pending": total - resolved,
            "correct": correct,
            "accuracy": correct / resolved if resolved > 0 else None,
            "brier_mean": float(brier_mean) if brier_mean else None,
            "calibration_curve": curve,
        }

    async def count_predictions(self) -> int:
        from api.models import Prediction
        result = await self.session.execute(select(func.count(Prediction.id)))
        return result.scalar() or 0

    async def count_resolved(self) -> int:
        from api.models import Prediction
        result = await self.session.execute(
            select(func.count(Prediction.id)).where(Prediction.outcome_resolution != "pending")
        )
        return result.scalar() or 0

    async def count_correct(self) -> int:
        from api.models import Prediction
        result = await self.session.execute(
            select(func.count(Prediction.id)).where(Prediction.prediction_correct == True)
        )
        return result.scalar() or 0

    async def get_brier_mean(self) -> Decimal | None:
        from api.models import Prediction
        result = await self.session.execute(
            select(func.avg(Prediction.brier_score)).where(Prediction.brier_score.isnot(None))
        )
        avg = result.scalar()
        return Decimal(str(avg)) if avg else None

    def _to_dict(self, pred) -> dict[str, Any]:
        return {
            "market_id": pred.market_id,
            "event_id": pred.event_id,
            "title": pred.title,
            "strike_price": float(pred.strike_price),
            "current_btc_price": float(pred.current_btc_price),
            "distance_from_strike_pct": float(pred.distance_from_strike_pct),
            "is_above_strike": pred.is_above_strike,
            "seconds_remaining": pred.seconds_remaining,
            "seconds_elapsed": pred.seconds_elapsed,
            "realized_volatility": float(pred.realized_volatility),
            "momentum_pct": float(pred.momentum_pct),
            "yes_ask": float(pred.yes_ask) if pred.yes_ask else None,
            "no_ask": float(pred.no_ask) if pred.no_ask else None,
            "spread": float(pred.spread) if pred.spread else None,
            "strategy": pred.strategy,
            "probability": float(pred.probability) if pred.probability else None,
            "predicted_outcome": pred.predicted_outcome or "",
            "edge": float(pred.edge) if pred.edge else None,
            "signal_strength": float(pred.signal_strength),
            "approved": pred.approved,
            "reasons": pred.reasons,
            "recorded_at": pred.recorded_at.isoformat() if pred.recorded_at else "",
            "outcome_resolution": pred.outcome_resolution or "pending",
            "actual_price": float(pred.actual_price) if pred.actual_price else None,
            "resolved_at": pred.resolved_at.isoformat() if pred.resolved_at else None,
            "prediction_correct": pred.prediction_correct,
            "brier_score": float(pred.brier_score) if pred.brier_score else None,
        }


class PostgresTradeRepository(TradeRepository):
    """PostgreSQL implementation of trade persistence."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def save_trade(self, trade: dict[str, Any]) -> int:
        from api.models import TradeRecord
        record = TradeRecord(**trade)
        self.session.add(record)
        await self.session.flush()
        return record.id

    async def get_trade(self, trade_id: int) -> dict[str, Any] | None:
        from api.models import TradeRecord
        result = await self.session.execute(
            select(TradeRecord).where(TradeRecord.id == trade_id)
        )
        trade = result.scalar_one_or_none()
        if not trade:
            return None
        return self._to_dict(trade)

    async def get_trades(
        self, limit: int = 50, offset: int = 0
    ) -> list[dict[str, Any]]:
        from api.models import TradeRecord
        result = await self.session.execute(
            select(TradeRecord)
            .order_by(TradeRecord.recorded_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return [self._to_dict(t) for t in result.scalars().all()]

    async def update_trade_status(
        self, trade_id: int, status: str, order_id: str | None = None
    ) -> None:
        from api.models import TradeRecord
        values: dict[str, Any] = {"status": status}
        if order_id is not None:
            values["order_id"] = order_id
        await self.session.execute(
            update(TradeRecord).where(TradeRecord.id == trade_id).values(**values)
        )

    async def get_open_trades(self) -> list[dict[str, Any]]:
        from api.models import TradeRecord
        result = await self.session.execute(
            select(TradeRecord).where(TradeRecord.status.in_(["pending", "open"]))
        )
        return [self._to_dict(t) for t in result.scalars().all()]

    async def get_uncertain_trades(self) -> list[dict[str, Any]]:
        from api.models import TradeRecord
        result = await self.session.execute(
            select(TradeRecord).where(TradeRecord.status == "unknown")
        )
        return [self._to_dict(t) for t in result.scalars().all()]

    def _to_dict(self, trade) -> dict[str, Any]:
        return {
            "id": trade.id,
            "market_id": trade.market_id,
            "event_id": trade.event_id,
            "outcome": trade.outcome,
            "side": trade.side,
            "amount": float(trade.amount),
            "price": float(trade.price),
            "shares": float(trade.shares) if trade.shares else None,
            "fee": float(trade.fee) if trade.fee else None,
            "status": trade.status,
            "mode": trade.mode,
            "order_id": trade.order_id,
            "recorded_at": trade.recorded_at.isoformat() if trade.recorded_at else "",
            "settled": trade.settled,
            "pnl": float(trade.pnl) if trade.pnl else None,
        }


class PostgresBotStatusRepository(BotStatusRepository):
    """PostgreSQL implementation of bot status persistence."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_status(self) -> dict[str, Any]:
        from api.models import BotStatus
        result = await self.session.execute(select(BotStatus).where(BotStatus.id == 1))
        status = result.scalar_one_or_none()
        if not status:
            return {
                "is_running": False,
                "mode": "observation",
                "strategy": "distance_to_strike",
                "total_predictions": 0,
                "total_resolved": 0,
                "total_correct": 0,
                "uptime_seconds": 0,
                "error_count": 0,
            }
        return {
            "is_running": status.is_running,
            "mode": status.mode,
            "strategy": status.strategy,
            "last_cycle_at": status.last_cycle_at.isoformat() if status.last_cycle_at else None,
            "last_btc_price": float(status.last_btc_price) if status.last_btc_price else None,
            "last_momentum_pct": float(status.last_momentum_pct) if status.last_momentum_pct else None,
            "last_volatility": float(status.last_volatility) if status.last_volatility else None,
            "total_predictions": status.total_predictions,
            "total_resolved": status.total_resolved,
            "total_correct": status.total_correct,
            "brier_mean": float(status.brier_mean) if status.brier_mean else None,
            "uptime_seconds": status.uptime_seconds,
            "error_count": status.error_count,
            "last_error": status.last_error,
        }

    async def update_status(self, status: dict[str, Any]) -> None:
        from api.models import BotStatus
        result = await self.session.execute(select(BotStatus).where(BotStatus.id == 1))
        db_status = result.scalar_one_or_none()

        if not db_status:
            db_status = BotStatus(id=1, **status)
            self.session.add(db_status)
        else:
            for key, value in status.items():
                if hasattr(db_status, key):
                    setattr(db_status, key, value)

        await self.session.flush()

    async def set_heartbeat(self) -> None:
        await self.update_status({"updated_at": datetime.now(timezone.utc)})

    async def set_btc_tick(self, price: Decimal, momentum: Decimal, volatility: Decimal) -> None:
        await self.update_status({
            "last_btc_price": price,
            "last_momentum_pct": momentum,
            "last_volatility": volatility,
        })

    async def set_feed_status(self, feed_name: str, status: str, last_message_at: datetime | None = None) -> None:
        # Feed status could be stored in a separate table or as JSON
        # For now, we'll log it as an event
        pass


class PostgresRiskRepository(RiskRepository):
    """PostgreSQL implementation of risk state persistence."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def load_risk_state(self) -> dict[str, Any]:
        # Risk state could be stored in a dedicated table
        # For now, we'll use a simple key-value approach
        result = await self.session.execute(
            text("SELECT state_json FROM risk_state WHERE id = 1")
        )
        row = result.fetchone()
        if row:
            import json
            return json.loads(row[0])
        return {
            "consecutive_losses": 0,
            "cooldown_until": None,
            "active_market_id": None,
            "uncertain_market_ids": [],
            "daily_pnl": "0",
            "trade_count": 0,
        }

    async def save_risk_state(self, state: dict[str, Any]) -> None:
        import json
        state_json = json.dumps(state, sort_keys=True)
        await self.session.execute(
            text("""
                INSERT INTO risk_state (id, state_json, updated_at)
                VALUES (1, :state_json, :updated_at)
                ON CONFLICT (id) DO UPDATE SET state_json = :state_json, updated_at = :updated_at
            """),
            {"state_json": state_json, "updated_at": datetime.now(timezone.utc)},
        )

    async def add_uncertain_market(self, market_id: str) -> None:
        state = await self.load_risk_state()
        if market_id not in state.get("uncertain_market_ids", []):
            state.setdefault("uncertain_market_ids", []).append(market_id)
        state["active_market_id"] = None
        await self.save_risk_state(state)

    async def remove_uncertain_market(self, market_id: str) -> None:
        state = await self.load_risk_state()
        uncertain = state.get("uncertain_market_ids", [])
        if market_id in uncertain:
            uncertain.remove(market_id)
        await self.save_risk_state(state)


class PostgresMarketRepository(MarketRepository):
    """PostgreSQL implementation of market state persistence."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def save_active_market(self, market_id: str, event_id: str, metadata: dict[str, Any]) -> None:
        import json
        await self.session.execute(
            text("""
                INSERT INTO active_market (id, market_id, event_id, metadata_json, updated_at)
                VALUES (1, :market_id, :event_id, :metadata_json, :updated_at)
                ON CONFLICT (id) DO UPDATE SET
                    market_id = :market_id,
                    event_id = :event_id,
                    metadata_json = :metadata_json,
                    updated_at = :updated_at
            """),
            {
                "market_id": market_id,
                "event_id": event_id,
                "metadata_json": json.dumps(metadata, sort_keys=True),
                "updated_at": datetime.now(timezone.utc),
            },
        )

    async def get_active_market(self) -> dict[str, Any] | None:
        result = await self.session.execute(
            text("SELECT market_id, event_id, metadata_json FROM active_market WHERE id = 1")
        )
        row = result.fetchone()
        if not row:
            return None
        import json
        return {
            "market_id": row[0],
            "event_id": row[1],
            **json.loads(row[2]),
        }

    async def clear_active_market(self) -> None:
        await self.session.execute(text("DELETE FROM active_market WHERE id = 1"))


class PostgresEventLogRepository(EventLogRepository):
    """PostgreSQL implementation of event logging."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def log_event(self, event: str, **fields: Any) -> None:
        import json
        await self.session.execute(
            text("""
                INSERT INTO event_log (event, fields_json, recorded_at)
                VALUES (:event, :fields_json, :recorded_at)
            """),
            {
                "event": event,
                "fields_json": json.dumps(fields, sort_keys=True, default=str),
                "recorded_at": datetime.now(timezone.utc),
            },
        )

    async def get_events(
        self, limit: int = 100, event_type: str | None = None
    ) -> list[dict[str, Any]]:
        import json
        query = "SELECT event, fields_json, recorded_at FROM event_log"
        params: dict[str, Any] = {"limit": limit}

        if event_type:
            query += " WHERE event = :event_type"
            params["event_type"] = event_type

        query += " ORDER BY recorded_at DESC LIMIT :limit"

        result = await self.session.execute(text(query), params)
        return [
            {
                "event": row[0],
                **json.loads(row[1]),
                "recorded_at": row[2].isoformat() if row[2] else "",
            }
            for row in result.fetchall()
        ]
