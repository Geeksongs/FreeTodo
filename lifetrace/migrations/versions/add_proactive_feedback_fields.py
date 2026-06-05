"""Add is_proactive to chats and feedback fields to messages

Revision ID: add_proactive_feedback_001
Revises: remove_project_task
Create Date: 2026-06-05
"""

import sqlalchemy as sa
from alembic import op

revision = "add_proactive_feedback_001"
down_revision = "remove_project_task"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)

    if "chats" in inspector.get_table_names():
        existing_cols = [c["name"] for c in inspector.get_columns("chats")]
        if "is_proactive" not in existing_cols:
            op.add_column("chats", sa.Column("is_proactive", sa.Boolean(), nullable=False, server_default="0"))

    if "messages" in inspector.get_table_names():
        existing_cols = [c["name"] for c in inspector.get_columns("messages")]
        if "feedback" not in existing_cols:
            op.add_column("messages", sa.Column("feedback", sa.String(20), nullable=True))
        if "feedback_reason" not in existing_cols:
            op.add_column("messages", sa.Column("feedback_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)

    if "chats" in inspector.get_table_names():
        existing_cols = [c["name"] for c in inspector.get_columns("chats")]
        if "is_proactive" in existing_cols:
            op.drop_column("chats", "is_proactive")

    if "messages" in inspector.get_table_names():
        existing_cols = [c["name"] for c in inspector.get_columns("messages")]
        if "feedback" in existing_cols:
            op.drop_column("messages", "feedback")
        if "feedback_reason" in existing_cols:
            op.drop_column("messages", "feedback_reason")
