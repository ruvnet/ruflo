"""
Local development runner that patches database configuration for SQLite.
"""
import os
import sys
import uvicorn
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import String
from sqlalchemy.dialects.postgresql import UUID

# Set environment variable
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./ragboard.db"

# Monkey-patch UUID and JSONB types for SQLite
def patch_types_for_sqlite():
    """Patch UUID and JSONB types to work with SQLite."""
    import sqlalchemy.dialects.sqlite.base as sqlite_base
    
    # Override UUID to use String for SQLite
    def visit_UUID(self, type_, **kw):
        return "CHAR(36)"
    
    # Override JSONB to use JSON for SQLite
    def visit_JSONB(self, type_, **kw):
        return "JSON"
    
    sqlite_base.SQLiteTypeCompiler.visit_UUID = visit_UUID
    sqlite_base.SQLiteTypeCompiler.visit_JSONB = visit_JSONB

# Monkey-patch the database module before importing the app
def patch_database():
    """Patch database configuration for SQLite."""
    import app.db.base as db_base
    
    # Create new engine without pool settings
    db_base.engine = create_async_engine(
        os.environ["DATABASE_URL"],
        echo=False,  # Less verbose logging
        future=True,
    )
    
    # Create new session factory
    db_base.async_session_maker = async_sessionmaker(
        db_base.engine,
        class_=db_base.AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

# Apply patches
patch_types_for_sqlite()
patch_database()

# Import and run the app
from app.main import app

if __name__ == "__main__":
    # Create database tables
    import asyncio
    from app.db.base import engine, Base
    
    async def init_tables():
        async with engine.begin() as conn:
            # Check if tables exist first
            from sqlalchemy import text
            result = await conn.execute(text("SELECT name FROM sqlite_master WHERE type='table';"))
            tables = result.fetchall()
            if not tables or len(tables) < 5:  # If tables don't exist or incomplete
                await conn.run_sync(Base.metadata.drop_all)
                await conn.run_sync(Base.metadata.create_all)
                print("✓ Database tables created")
            else:
                print("✓ Database tables already exist")
    
    # Initialize tables
    asyncio.run(init_tables())
    
    # Run the server
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
