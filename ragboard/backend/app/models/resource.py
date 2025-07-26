"""
Resource model for storing and managing multimedia content.
"""

from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum
from sqlalchemy import String, Text, Integer, Float, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid

from app.db.base import Base


class ResourceType(str, Enum):
    """Supported resource types."""
    PDF = "pdf"
    DOCUMENT = "document"
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    WEBPAGE = "webpage"
    TEXT = "text"
    
    
class ProcessingStatus(str, Enum):
    """Resource processing status."""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"


class Resource(Base):
    """Model for storing multimedia resources."""
    
    __tablename__ = "resource"
    
    # Basic info
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # File info
    resource_type: Mapped[ResourceType] = mapped_column(
        SQLEnum(ResourceType),
        index=True
    )
    mime_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    file_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    file_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    file_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    
    # Source info
    source_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB, nullable=True
    )
    
    # Processing status
    processing_status: Mapped[ProcessingStatus] = mapped_column(
        SQLEnum(ProcessingStatus),
        default=ProcessingStatus.PENDING,
        index=True
    )
    processing_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    processed_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    
    # Extracted content
    extracted_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extracted_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB, nullable=True
    )
    
    # Vector embedding info
    embedding_model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    embedding_dimension: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    chunk_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    
    # Visibility and sharing
    is_public: Mapped[bool] = mapped_column(default=False)
    tags: Mapped[Optional[List[str]]] = mapped_column(JSONB, nullable=True)
    
    # Foreign keys
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user.id"),
        nullable=False,
        index=True
    )
    collection_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collection.id"),
        nullable=True,
        index=True
    )
    
    # Relationships
    owner: Mapped["User"] = relationship("User", back_populates="resources")
    collection: Mapped[Optional["Collection"]] = relationship(
        "Collection", 
        back_populates="resources"
    )
    chunks: Mapped[List["ResourceChunk"]] = relationship(
        "ResourceChunk",
        back_populates="resource",
        cascade="all, delete-orphan"
    )
    
    def __repr__(self) -> str:
        return f"<Resource {self.name} ({self.resource_type})>"


class Collection(Base):
    """Collection for organizing resources."""
    
    __tablename__ = "collection"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Settings
    is_public: Mapped[bool] = mapped_column(default=False)
    settings: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB, nullable=True
    )
    
    # Foreign keys
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user.id"),
        nullable=False,
        index=True
    )
    
    # Relationships
    resources: Mapped[List["Resource"]] = relationship(
        "Resource",
        back_populates="collection"
    )
    
    def __repr__(self) -> str:
        return f"<Collection {self.name}>"


class ResourceChunk(Base):
    """Chunks of resources for vector storage."""
    
    __tablename__ = "resourcechunk"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    # Chunk info
    chunk_index: Mapped[int] = mapped_column(Integer)
    chunk_text: Mapped[str] = mapped_column(Text)
    chunk_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB, nullable=True
    )
    
    # Vector info
    vector_id: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True, index=True
    )
    embedding_model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    # Position info (for maintaining context)
    start_char: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    end_char: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    page_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    
    # Foreign keys
    resource_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("resource.id"),
        nullable=False,
        index=True
    )
    
    # Relationships
    resource: Mapped["Resource"] = relationship("Resource", back_populates="chunks")
    
    def __repr__(self) -> str:
        return f"<ResourceChunk {self.resource_id}:{self.chunk_index}>)"