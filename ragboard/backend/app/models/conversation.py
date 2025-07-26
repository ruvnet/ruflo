"""
Conversation and message models for chat functionality.
"""

from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum
from sqlalchemy import String, Text, Integer, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid

from app.db.base import Base


class MessageRole(str, Enum):
    """Message sender role."""
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    FUNCTION = "function"


class ConversationType(str, Enum):
    """Type of conversation."""
    CHAT = "chat"
    RAG = "rag"
    ANALYSIS = "analysis"
    SUMMARY = "summary"


class Conversation(Base):
    """Conversation model for chat sessions."""
    
    __tablename__ = "conversation"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    
    # Conversation settings
    conversation_type: Mapped[ConversationType] = mapped_column(
        SQLEnum(ConversationType),
        default=ConversationType.CHAT,
        index=True
    )
    model: Mapped[str] = mapped_column(String(100))
    temperature: Mapped[float] = mapped_column(default=0.7)
    max_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    
    # Context and memory
    system_prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    context_resources: Mapped[Optional[List[uuid.UUID]]] = mapped_column(
        JSONB, nullable=True
    )  # List of resource IDs used as context
    
    # Metadata
    conversation_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB, nullable=True
    )
    tags: Mapped[Optional[List[str]]] = mapped_column(JSONB, nullable=True)
    
    # Usage stats
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_cost: Mapped[float] = mapped_column(default=0.0)
    
    # Foreign keys
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user.id"),
        nullable=False,
        index=True
    )
    
    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="conversations")
    messages: Mapped[List["Message"]] = relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at"
    )
    
    def __repr__(self) -> str:
        return f"<Conversation {self.title}>"


class Message(Base):
    """Individual message within a conversation."""
    
    __tablename__ = "message"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    # Message content
    role: Mapped[MessageRole] = mapped_column(
        SQLEnum(MessageRole),
        index=True
    )
    content: Mapped[str] = mapped_column(Text)
    
    # Function calling
    function_name: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )
    function_args: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB, nullable=True
    )
    function_response: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB, nullable=True
    )
    
    # Attachments and references
    attachments: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(
        JSONB, nullable=True
    )  # List of attachment metadata
    cited_chunks: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(
        JSONB, nullable=True
    )  # RAG citations
    
    # Metadata
    message_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB, nullable=True
    )
    
    # Token usage
    prompt_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    
    # User feedback
    rating: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    feedback: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Foreign keys
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversation.id"),
        nullable=False,
        index=True
    )
    
    # Relationships
    conversation: Mapped["Conversation"] = relationship(
        "Conversation", 
        back_populates="messages"
    )
    
    def __repr__(self) -> str:
        return f"<Message {self.role}: {self.content[:50]}...>"


class SavedPrompt(Base):
    """Saved prompts for reuse."""
    
    __tablename__ = "savedprompt"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Prompt content
    prompt: Mapped[str] = mapped_column(Text)
    variables: Mapped[Optional[List[str]]] = mapped_column(
        JSONB, nullable=True
    )  # List of variable names in the prompt
    
    # Settings
    is_public: Mapped[bool] = mapped_column(default=False)
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    tags: Mapped[Optional[List[str]]] = mapped_column(JSONB, nullable=True)
    
    # Usage stats
    usage_count: Mapped[int] = mapped_column(Integer, default=0)
    
    # Foreign keys
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user.id"),
        nullable=False,
        index=True
    )
    
    def __repr__(self) -> str:
        return f"<SavedPrompt {self.name}>)"