"""
Database session management utilities.
"""

from typing import AsyncGenerator
from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.base import async_session_maker


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Context manager for database sessions.
    
    Usage:
        async with get_session() as session:
            # Use session here
            result = await session.execute(query)
    
    Yields:
        AsyncSession: Database session
    """
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


class DatabaseSessionManager:
    """Manager for database session lifecycle."""
    
    def __init__(self):
        self._session_factory = async_session_maker
    
    async def __aenter__(self) -> AsyncSession:
        self._session = self._session_factory()
        return self._session
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            await self._session.rollback()
        else:
            await self._session.commit()
        await self._session.close()
    
    @property
    def session(self) -> AsyncSession:
        """Get the current session."""
        return self._session


# Convenience function for dependency injection
db_session = DatabaseSessionManager