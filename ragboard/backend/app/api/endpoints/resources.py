"""
Resource management endpoints.
"""

from typing import Annotated, List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func
from sqlalchemy.orm import selectinload
import aiofiles
import hashlib
from pathlib import Path

from app.core.config import settings
from app.db.base import get_async_session
from app.models.resource import Resource, ResourceType, ProcessingStatus, Collection
from app.models.user import User
from app.api.dependencies.auth import get_current_active_user
from app.schemas.resource import (
    ResourceCreate,
    ResourceUpdate,
    ResourceResponse,
    ResourceListResponse,
    CollectionCreate,
    CollectionResponse
)
from app.services.processing import ProcessingService
from app.services.vector_db import VectorDBService

router = APIRouter(prefix="/resources", tags=["resources"])

# Initialize services
processing_service = ProcessingService()
vector_service = VectorDBService()


@router.post("/upload", response_model=ResourceResponse)
async def upload_resource(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    collection_id: Optional[UUID] = Form(None),
    tags: Optional[List[str]] = Form(None),
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Upload a new resource file.
    """
    # Validate file size
    if file.size > settings.max_upload_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File size exceeds maximum allowed size of {settings.max_upload_size} bytes"
        )
    
    # Validate file extension
    file_ext = Path(file.filename).suffix.lower().lstrip('.')
    if file_ext not in settings.allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type '{file_ext}' not allowed. Allowed types: {', '.join(settings.allowed_extensions)}"
        )
    
    # Determine resource type
    resource_type = _get_resource_type(file_ext, file.content_type)
    
    # Generate file path and hash
    file_path = settings.upload_dir / str(current_user.id) / file.filename
    file_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Save file and calculate hash
    hasher = hashlib.sha256()
    async with aiofiles.open(file_path, 'wb') as f:
        while chunk := await file.read(8192):
            await f.write(chunk)
            hasher.update(chunk)
    
    file_hash = hasher.hexdigest()
    
    # Check for duplicate
    result = await db.execute(
        select(Resource).where(
            Resource.file_hash == file_hash,
            Resource.user_id == current_user.id
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This file has already been uploaded"
        )
    
    # Create resource record
    resource = Resource(
        name=name or file.filename,
        description=description,
        resource_type=resource_type,
        mime_type=file.content_type,
        file_path=str(file_path),
        file_size=file.size,
        file_hash=file_hash,
        user_id=current_user.id,
        collection_id=collection_id,
        tags=tags or [],
        processing_status=ProcessingStatus.PENDING
    )
    
    db.add(resource)
    await db.commit()
    await db.refresh(resource)
    
    # Queue for processing
    await processing_service.queue_resource(resource.id)
    
    return ResourceResponse.model_validate(resource)


@router.post("/url", response_model=ResourceResponse)
async def add_url_resource(
    resource_data: ResourceCreate,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Add a URL-based resource (webpage, social media, etc.).
    """
    if not resource_data.source_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="source_url is required for URL resources"
        )
    
    # Check for duplicate URL
    result = await db.execute(
        select(Resource).where(
            Resource.source_url == resource_data.source_url,
            Resource.user_id == current_user.id
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This URL has already been added"
        )
    
    # Create resource
    resource = Resource(
        name=resource_data.name,
        description=resource_data.description,
        resource_type=ResourceType.WEBPAGE,
        source_url=resource_data.source_url,
        source_metadata=resource_data.source_metadata,
        user_id=current_user.id,
        collection_id=resource_data.collection_id,
        tags=resource_data.tags or [],
        processing_status=ProcessingStatus.PENDING
    )
    
    db.add(resource)
    await db.commit()
    await db.refresh(resource)
    
    # Queue for processing
    await processing_service.queue_resource(resource.id)
    
    return ResourceResponse.model_validate(resource)


@router.get("", response_model=ResourceListResponse)
async def list_resources(
    skip: int = 0,
    limit: int = 20,
    resource_type: Optional[ResourceType] = None,
    collection_id: Optional[UUID] = None,
    search: Optional[str] = None,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    List user's resources with filtering and pagination.
    """
    query = select(Resource).where(Resource.user_id == current_user.id)
    
    # Apply filters
    if resource_type:
        query = query.where(Resource.resource_type == resource_type)
    if collection_id:
        query = query.where(Resource.collection_id == collection_id)
    if search:
        query = query.where(
            Resource.name.ilike(f"%{search}%") |
            Resource.description.ilike(f"%{search}%")
        )
    
    # Get total count
    count_result = await db.execute(
        select(func.count()).select_from(query.subquery())
    )
    total = count_result.scalar()
    
    # Get paginated results with eager loading
    query = query.options(selectinload(Resource.chunks)).offset(skip).limit(limit).order_by(Resource.created_at.desc())
    result = await db.execute(query)
    resources = result.scalars().all()
    
    return ResourceListResponse(
        resources=[ResourceResponse.model_validate(r) for r in resources],
        total=total,
        skip=skip,
        limit=limit
    )


@router.get("/{resource_id}", response_model=ResourceResponse)
async def get_resource(
    resource_id: UUID,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Get a specific resource by ID.
    """
    result = await db.execute(
        select(Resource)
        .where(Resource.id == resource_id, Resource.user_id == current_user.id)
        .options(selectinload(Resource.chunks))
    )
    resource = result.scalar_one_or_none()
    
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found"
        )
    
    return ResourceResponse.model_validate(resource)


@router.put("/{resource_id}", response_model=ResourceResponse)
async def update_resource(
    resource_id: UUID,
    resource_update: ResourceUpdate,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Update resource metadata.
    """
    result = await db.execute(
        select(Resource).where(
            Resource.id == resource_id,
            Resource.user_id == current_user.id
        )
    )
    resource = result.scalar_one_or_none()
    
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found"
        )
    
    # Update fields
    update_data = resource_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(resource, field, value)
    
    await db.commit()
    await db.refresh(resource)
    
    return ResourceResponse.model_validate(resource)


@router.delete("/{resource_id}")
async def delete_resource(
    resource_id: UUID,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Delete a resource and its associated data.
    """
    result = await db.execute(
        select(Resource).where(
            Resource.id == resource_id,
            Resource.user_id == current_user.id
        )
    )
    resource = result.scalar_one_or_none()
    
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found"
        )
    
    # Delete from vector database
    await vector_service.delete_resource_chunks(resource_id)
    
    # Delete file if exists
    if resource.file_path and Path(resource.file_path).exists():
        Path(resource.file_path).unlink()
    
    # Delete from database
    await db.delete(resource)
    await db.commit()
    
    return {"message": "Resource deleted successfully"}


@router.get("/{resource_id}/download")
async def download_resource(
    resource_id: UUID,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Download the original resource file.
    """
    result = await db.execute(
        select(Resource).where(
            Resource.id == resource_id,
            Resource.user_id == current_user.id
        )
    )
    resource = result.scalar_one_or_none()
    
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found"
        )
    
    if not resource.file_path or not Path(resource.file_path).exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource file not found"
        )
    
    return FileResponse(
        path=resource.file_path,
        filename=resource.name,
        media_type=resource.mime_type
    )


@router.post("/{resource_id}/reprocess")
async def reprocess_resource(
    resource_id: UUID,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Reprocess a resource (re-extract text, regenerate embeddings).
    """
    result = await db.execute(
        select(Resource).where(
            Resource.id == resource_id,
            Resource.user_id == current_user.id
        )
    )
    resource = result.scalar_one_or_none()
    
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found"
        )
    
    # Reset processing status
    resource.processing_status = ProcessingStatus.PENDING
    resource.processing_error = None
    await db.commit()
    
    # Queue for reprocessing
    await processing_service.queue_resource(resource_id, force=True)
    
    return {"message": "Resource queued for reprocessing"}


def _get_resource_type(file_ext: str, mime_type: str) -> ResourceType:
    """Determine resource type from file extension and MIME type."""
    if file_ext in ['pdf']:
        return ResourceType.PDF
    elif file_ext in ['doc', 'docx', 'txt', 'rtf']:
        return ResourceType.DOCUMENT
    elif file_ext in ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']:
        return ResourceType.IMAGE
    elif file_ext in ['mp4', 'avi', 'mov', 'wmv', 'webm']:
        return ResourceType.VIDEO
    elif file_ext in ['mp3', 'wav', 'ogg', 'flac', 'm4a']:
        return ResourceType.AUDIO
    else:
        # Fallback to MIME type
        if mime_type.startswith('image/'):
            return ResourceType.IMAGE
        elif mime_type.startswith('video/'):
            return ResourceType.VIDEO
        elif mime_type.startswith('audio/'):
            return ResourceType.AUDIO
        else:
            return ResourceType.DOCUMENT