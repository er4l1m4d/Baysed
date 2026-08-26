"""Initial schema with predictions, bot_status, and trades tables

Revision ID: 001_initial
Revises: 
Create Date: 2025-01-01 00:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Predictions table
    op.create_table(
        'predictions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('market_id', sa.String(length=255), nullable=False),
        sa.Column('event_id', sa.String(length=255), nullable=False),
        sa.Column('title', sa.String(length=500), nullable=False),
        sa.Column('strike_price', sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column('current_btc_price', sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column('distance_from_strike_pct', sa.Numeric(precision=10, scale=6), nullable=False),
        sa.Column('is_above_strike', sa.Boolean(), nullable=False),
        sa.Column('seconds_remaining', sa.Integer(), nullable=False),
        sa.Column('seconds_elapsed', sa.Integer(), nullable=False),
        sa.Column('realized_volatility', sa.Numeric(precision=10, scale=6), nullable=False),
        sa.Column('momentum_pct', sa.Numeric(precision=10, scale=6), nullable=False),
        sa.Column('yes_ask', sa.Numeric(precision=10, scale=6), nullable=True),
        sa.Column('no_ask', sa.Numeric(precision=10, scale=6), nullable=True),
        sa.Column('spread', sa.Numeric(precision=10, scale=6), nullable=True),
        sa.Column('strategy', sa.String(length=100), nullable=False),
        sa.Column('probability', sa.Numeric(precision=10, scale=6), nullable=True),
        sa.Column('predicted_outcome', sa.String(length=10), nullable=True),
        sa.Column('edge', sa.Numeric(precision=10, scale=6), nullable=True),
        sa.Column('signal_strength', sa.Numeric(precision=10, scale=6), nullable=True),
        sa.Column('approved', sa.Boolean(), server_default='0', nullable=True),
        sa.Column('reasons', sa.JSON(), nullable=True),
        sa.Column('strategy_version', sa.String(length=20), server_default='2', nullable=True),
        sa.Column('experiment_tag', sa.String(length=100), server_default='distance_to_strike_v1', nullable=True),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('outcome_resolution', sa.String(length=20), server_default='pending', nullable=True),
        sa.Column('actual_price', sa.Numeric(precision=20, scale=8), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('prediction_correct', sa.Boolean(), nullable=True),
        sa.Column('brier_score', sa.Numeric(precision=10, scale=6), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_predictions_market_id', 'predictions', ['market_id'], unique=True)
    op.create_index('ix_predictions_event_id', 'predictions', ['event_id'], unique=False)
    op.create_index('ix_predictions_resolution', 'predictions', ['outcome_resolution'], unique=False)
    op.create_index('ix_predictions_recorded', 'predictions', ['recorded_at'], unique=False)

    # Bot status table
    op.create_table(
        'bot_status',
        sa.Column('id', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('is_running', sa.Boolean(), server_default='0', nullable=True),
        sa.Column('mode', sa.String(length=50), server_default='observation', nullable=True),
        sa.Column('strategy', sa.String(length=100), server_default='distance_to_strike', nullable=True),
        sa.Column('last_cycle_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_btc_price', sa.Numeric(precision=20, scale=8), nullable=True),
        sa.Column('last_momentum_pct', sa.Numeric(precision=10, scale=6), nullable=True),
        sa.Column('last_volatility', sa.Numeric(precision=10, scale=6), nullable=True),
        sa.Column('total_predictions', sa.Integer(), server_default='0', nullable=True),
        sa.Column('total_resolved', sa.Integer(), server_default='0', nullable=True),
        sa.Column('total_correct', sa.Integer(), server_default='0', nullable=True),
        sa.Column('brier_mean', sa.Numeric(precision=10, scale=6), nullable=True),
        sa.Column('uptime_seconds', sa.Integer(), server_default='0', nullable=True),
        sa.Column('error_count', sa.Integer(), server_default='0', nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

    # Trades table
    op.create_table(
        'trades',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('market_id', sa.String(length=255), nullable=False),
        sa.Column('event_id', sa.String(length=255), nullable=False),
        sa.Column('outcome', sa.String(length=10), nullable=False),
        sa.Column('side', sa.String(length=10), server_default='BUY', nullable=False),
        sa.Column('amount', sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column('price', sa.Numeric(precision=10, scale=6), nullable=False),
        sa.Column('shares', sa.Numeric(precision=20, scale=8), nullable=True),
        sa.Column('fee', sa.Numeric(precision=10, scale=6), nullable=True),
        sa.Column('status', sa.String(length=50), server_default='pending', nullable=True),
        sa.Column('mode', sa.String(length=50), server_default='paper', nullable=True),
        sa.Column('order_id', sa.String(length=255), nullable=True),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('settled', sa.Boolean(), server_default='0', nullable=True),
        sa.Column('pnl', sa.Numeric(precision=20, scale=8), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_trades_market_id', 'trades', ['market_id'], unique=False)


def downgrade() -> None:
    op.drop_table('trades')
    op.drop_table('bot_status')
    op.drop_table('predictions')
