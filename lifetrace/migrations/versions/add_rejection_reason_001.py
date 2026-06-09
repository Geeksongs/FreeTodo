"""Add rejection_reason column to todos table

Revision ID: add_rejection_reason_001
Revises: merge_proactive_feedback_automation_001
Create Date: 2026-06-08
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "add_rejection_reason_001"
down_revision = "merge_proactive_feedback_automation_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("todos", sa.Column("rejection_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("todos", "rejection_reason")
