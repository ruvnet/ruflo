"""Add boards table

Revision ID: add_boards_table
Revises: a5770e01b390
Create Date: 2024-01-26 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_boards_table'
down_revision = 'a5770e01b390'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create boards table
    op.create_table('boards',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False, primary_key=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('resources_data', sa.Text(), nullable=True),
        sa.Column('connections_data', sa.Text(), nullable=True),
        sa.Column('ai_chats_data', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create index on user_id for faster queries
    op.create_index(op.f('ix_boards_user_id'), 'boards', ['user_id'], unique=False)


def downgrade() -> None:
    # Drop the index
    op.drop_index(op.f('ix_boards_user_id'), table_name='boards')
    
    # Drop the boards table
    op.drop_table('boards')