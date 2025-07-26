"""
Processing schemas for API requests and responses.
"""

from typing import Optional, Dict, Any, List
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field

from app.models.resource import ProcessingStatus


class ProcessingStatusResponse(BaseModel):
    """Processing status response."""
    resource_id: UUID
    status: ProcessingStatus
    error: Optional[str] = None
    processed_at: Optional[datetime] = None
    chunk_count: Optional[int] = None
    extracted_text_length: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None


class ExtractTextRequest(BaseModel):
    """Text extraction request."""
    resource_id: UUID
    async_process: bool = True
    ocr_enabled: bool = True
    language: str = "eng"


class ExtractTextResponse(BaseModel):
    """Text extraction response."""
    resource_id: UUID
    status: str  # "queued", "processing", "completed", "failed"
    message: Optional[str] = None
    extracted_text: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class GenerateEmbeddingsRequest(BaseModel):
    """Embedding generation request."""
    resource_id: UUID
    embedding_model: str = "text-embedding-3-small"
    chunk_size: int = Field(default=1000, ge=100, le=4000)
    chunk_overlap: int = Field(default=200, ge=0, le=1000)
    async_process: bool = True


class GenerateEmbeddingsResponse(BaseModel):
    """Embedding generation response."""
    resource_id: UUID
    status: str  # "queued", "processing", "completed", "failed"
    message: Optional[str] = None
    chunk_count: Optional[int] = None
    embedding_model: Optional[str] = None


class BatchProcessRequest(BaseModel):
    """Batch processing request."""
    resource_ids: List[UUID]
    extract_text: bool = True
    generate_embeddings: bool = True
    embedding_model: str = "text-embedding-3-small"