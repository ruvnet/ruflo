"""
Database initialization script.

This script creates all tables and optionally seeds initial data.
"""

import asyncio
import logging
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import engine, Base, async_session_maker
from app.core.config import settings
from app.core.security import get_password_hash
from app.models import User, Role

# Import all models to ensure they're registered with SQLAlchemy
from app.models import (
    User, Role, APIKey,
    Resource, Collection, ResourceChunk,
    Conversation, Message, SavedPrompt
)

logger = logging.getLogger(__name__)


async def create_db_and_tables() -> None:
    """Create database and all tables."""
    logger.info("Creating database tables...")
    
    async with engine.begin() as conn:
        # Create all tables
        await conn.run_sync(Base.metadata.create_all)
    
    logger.info("Database tables created successfully!")


async def create_superuser(session: AsyncSession) -> Optional[User]:
    """
    Create the initial superuser if it doesn't exist.
    
    Args:
        session: Database session
        
    Returns:
        Created or existing superuser
    """
    # Check if superuser already exists
    result = await session.execute(
        text("SELECT * FROM \"user\" WHERE email = :email"),
        {"email": settings.first_superuser_email}
    )
    existing_user = result.first()
    
    if existing_user:
        logger.info(f"Superuser {settings.first_superuser_email} already exists")
        return None
    
    # Create superuser
    superuser = User(
        email=settings.first_superuser_email,
        username=settings.first_superuser_username,
        full_name="System Administrator",
        hashed_password=get_password_hash(settings.first_superuser_password),
        is_active=True,
        is_verified=True,
        is_superuser=True
    )
    
    session.add(superuser)
    await session.commit()
    await session.refresh(superuser)
    
    logger.info(f"Superuser {superuser.email} created successfully")
    return superuser


async def create_default_roles(session: AsyncSession) -> None:
    """Create default user roles."""
    default_roles = [
        {
            "name": "admin",
            "description": "Administrator with full access",
            "permissions": {
                "users": ["create", "read", "update", "delete"],
                "resources": ["create", "read", "update", "delete"],
                "conversations": ["create", "read", "update", "delete"],
                "system": ["manage"]
            }
        },
        {
            "name": "user",
            "description": "Regular user with standard access",
            "permissions": {
                "users": ["read:self", "update:self"],
                "resources": ["create", "read:own", "update:own", "delete:own"],
                "conversations": ["create", "read:own", "update:own", "delete:own"]
            }
        },
        {
            "name": "guest",
            "description": "Guest with limited read-only access",
            "permissions": {
                "resources": ["read:public"],
                "conversations": ["read:public"]
            }
        }
    ]
    
    for role_data in default_roles:
        # Check if role exists
        result = await session.execute(
            text("SELECT * FROM role WHERE name = :name"),
            {"name": role_data["name"]}
        )
        if result.first():
            logger.info(f"Role '{role_data['name']}' already exists")
            continue
        
        # Create role
        role = Role(**role_data)
        session.add(role)
        logger.info(f"Created role '{role_data['name']}'")
    
    await session.commit()


async def init_db() -> None:
    """Initialize database with tables and seed data."""
    logger.info("Initializing database...")
    
    # Create tables
    await create_db_and_tables()
    
    # Create initial data
    async with async_session_maker() as session:
        # Create default roles
        await create_default_roles(session)
        
        # Create superuser
        await create_superuser(session)
    
    logger.info("Database initialization completed!")


async def reset_db() -> None:
    """Reset database by dropping and recreating all tables."""
    logger.warning("Resetting database - all data will be lost!")
    
    async with engine.begin() as conn:
        # Drop all tables
        await conn.run_sync(Base.metadata.drop_all)
        logger.info("All tables dropped")
        
        # Recreate tables
        await conn.run_sync(Base.metadata.create_all)
        logger.info("All tables recreated")
    
    # Reinitialize with seed data
    await init_db()


if __name__ == "__main__":
    # Setup logging
    logging.basicConfig(level=logging.INFO)
    
    # Run initialization
    asyncio.run(init_db())