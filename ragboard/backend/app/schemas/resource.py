"""
Resource schemas for API requests and responses.
"""

from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict

from app.models.resource import ResourceType, ProcessingStatus


class ResourceBase(BaseModel):
    """Base resource schema."""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    collection_id: Optional[UUID] = None
    tags: Optional[List[str]] = []
    is_public: bool = False


class ResourceCreate(ResourceBase):
    """Resource creation schema."""
    source_url: Optional[str] = None
    source_metadata: Optional[Dict[str, Any]] = None


class ResourceUpdate(BaseModel):
    """Resource update schema."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    collection_id: Optional[UUID] = None
    tags: Optional[List[str]] = None
    is_public: Optional[bool] = None


class ResourceChunkResponse(BaseModel):
    """Resource chunk response."""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    chunk_index: int
    chunk_text: str
    chunk_metadata: Optional[Dict[str, Any]]
    vector_id: Optional[str]
    page_number: Optional[int]


class ResourceResponse(BaseModel):
    """Resource response schema."""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    name: str
    description: Optional[str]
    resource_type: ResourceType
    mime_type: Optional[str]
    file_size: Optional[int]
    source_url: Optional[str]
    source_metadata: Optional[Dict[str, Any]]
    processing_status: ProcessingStatus
    processing_error: Optional[str]
    processed_at: Optional[datetime]
    extracted_text: Optional[str]
    extracted_metadata: Optional[Dict[str, Any]]
    chunk_count: Optional[int]
    is_public: bool
    tags: Optional[List[str]]
    collection_id: Optional[UUID]
    created_at: datetime
    updated_at: datetime
    
    # Optional included data
    chunks: Optional[List[ResourceChunkResponse]] = None


class ResourceListResponse(BaseModel):
    """Paginated resource list response."""
    resources: List[ResourceResponse]
    total: int
    skip: int
    limit: int


class CollectionBase(BaseModel):
    """Base collection schema."""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    is_public: bool = False
    settings: Optional[Dict[str, Any]] = {}


class CollectionCreate(CollectionBase):
    """Collection creation schema."""
    pass


class CollectionUpdate(BaseModel):
    """Collection update schema."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    is_public: Optional[bool] = None
    settings: Optional[Dict[str, Any]] = None


class CollectionResponse(BaseModel):
    """Collection response schema."""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    name: str
    description: Optional[str]
    is_public: bool
    settings: Optional[Dict[str, Any]]
    resource_count: Optional[int] = None
    created_at: datetime
    updated_at: datetime