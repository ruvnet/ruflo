"""
Conversation and message schemas.
"""

from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict

from app.models.conversation import MessageRole


class ConversationBase(BaseModel):
    """Base conversation schema."""
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    settings: Optional[Dict[str, Any]] = {}


class ConversationCreate(ConversationBase):
    """Conversation creation schema."""
    pass


class ConversationUpdate(BaseModel):
    """Conversation update schema."""
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None


class MessageBase(BaseModel):
    """Base message schema."""
    role: MessageRole
    content: str
    metadata: Optional[Dict[str, Any]] = None


class MessageCreate(MessageBase):
    """Message creation schema."""
    pass


class MessageResponse(BaseModel):
    """Message response schema."""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    conversation_id: UUID
    role: MessageRole
    content: str
    metadata: Optional[Dict[str, Any]]
    created_at: datetime


class ConversationResponse(BaseModel):
    """Conversation response schema."""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    title: str
    description: Optional[str]
    settings: Optional[Dict[str, Any]]
    message_count: Optional[int]
    created_at: datetime
    updated_at: datetime
    
    # Optional included data
    messages: Optional[List[MessageResponse]] = None


class ChatRequest(BaseModel):
    """Chat request schema."""
    message: str = Field(..., min_length=1)
    resource_ids: Optional[List[UUID]] = None
    model: Optional[str] = None
    temperature: Optional[float] = Field(None, ge=0, le=2)
    max_tokens: Optional[int] = Field(None, ge=1, le=8192)
    top_k: Optional[int] = Field(None, ge=1, le=20)
    metadata: Optional[Dict[str, Any]] = None


class ChatResponse(BaseModel):
    """Chat response schema."""
    user_message: MessageResponse
    assistant_message: MessageResponse
    sources: Optional[List[Dict[str, Any]]] = None