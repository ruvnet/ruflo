"""
Database models for RagBoard application.

This module exports all SQLAlchemy models used in the application.
"""

from app.models.user import User, Role, APIKey
from app.models.resource import (
    Resource, 
    Collection, 
    ResourceChunk,
    ResourceType,
    ProcessingStatus
)
from app.models.conversation import (
    Conversation,
    Message,
    SavedPrompt,
    MessageRole,
    ConversationType
)
from app.models.board import Board

# Export all models
__all__ = [
    # User models
    "User",
    "Role",
    "APIKey",
    
    # Resource models
    "Resource",
    "Collection",
    "ResourceChunk",
    "ResourceType",
    "ProcessingStatus",
    
    # Conversation models
    "Conversation",
    "Message",
    "SavedPrompt",
    "MessageRole",
    "ConversationType",
    
    # Board models
    "Board",
]