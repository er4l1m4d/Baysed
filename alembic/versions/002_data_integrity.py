"""Data integrity refactor — multi-snapshot predictions, resolution audit trail

Revision ID: 002_data_integrity
Revises: 001_initial
Create Date: 2025-08-27 00:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '002_data_integrity'
down_revision: Union[str, None] = '001_initial'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Drop the unique constraint on market_id — allow multiple snapshots per market
    op.drop_index('ix_predictions_market_id', table_name='predictions')
    op.create_index('ix_predictions_market_id', 'predictions', ['market_id'], unique=False)

    # 2. Add composite index for market+time queries
    op.create_index('ix_predictions_market_time', 'predictions', ['market_id', 'recorded_at'])

    # 3. Add new columns (nullable — safe on existing data)
    op.add_column('predictions', sa.Column('observed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('predictions', sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('predictions', sa.Column('opened_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('predictions', sa.Column('closes_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('predictions', sa.Column('volume_ratio', sa.Numeric(10, 6), nullable=True))
    op.add_column('predictions', sa.Column('outcome1_id', sa.String(255), nullable=True))
    op.add_column('predictions', sa.Column('outcome2_id', sa.String(255), nullable=True))
    op.add_column('predictions', sa.Column('resolved_outcome_id', sa.String(255), nullable=True))

    # 4. Backfill timestamps for existing rows
    op.execute("""
        UPDATE predictions
        SET observed_at = recorded_at, decided_at = recorded_at
        WHERE observed_at IS NULL
    """)


def downgrade() -> None:
    op.drop_column('predictions', 'resolved_outcome_id')
    op.drop_column('predictions', 'outcome2_id')
    op.drop_column('predictions', 'outcome1_id')
    op.drop_column('predictions', 'volume_ratio')
    op.drop_column('predictions', 'closes_at')
    op.drop_column('predictions', 'opened_at')
    op.drop_column('predictions', 'decided_at')
    op.drop_column('predictions', 'observed_at')
    op.drop_index('ix_predictions_market_time', table_name='predictions')
    op.drop_index('ix_predictions_market_id', table_name='predictions')
    op.create_index('ix_predictions_market_id', 'predictions', ['market_id'], unique=True)
