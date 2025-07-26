"""
File processing and content extraction endpoints.
"""

from typing import Annotated, Optional, Dict, Any, List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.db.base import get_async_session
from app.models.resource import Resource, ProcessingStatus
from app.models.user import User
from app.api.dependencies.auth import get_current_active_user
from app.services.processing import ProcessingService
from app.schemas.processing import (
    ProcessingStatusResponse,
    ExtractTextRequest,
    ExtractTextResponse,
    GenerateEmbeddingsRequest,
    GenerateEmbeddingsResponse
)
from datetime import datetime

router = APIRouter(prefix="/processing", tags=["processing"])

# Initialize service
processing_service = ProcessingService()


@router.get("/status/{resource_id}", response_model=ProcessingStatusResponse)
async def get_processing_status(
    resource_id: UUID,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Get the processing status of a resource.
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
    
    return ProcessingStatusResponse(
        resource_id=resource.id,
        status=resource.processing_status,
        error=resource.processing_error,
        processed_at=resource.processed_at,
        chunk_count=resource.chunk_count,
        extracted_text_length=len(resource.extracted_text) if resource.extracted_text else 0,
        metadata=resource.extracted_metadata
    )


@router.post("/extract-text", response_model=ExtractTextResponse)
async def extract_text(
    request: ExtractTextRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Extract text from a resource synchronously or queue for async processing.
    """
    # Verify resource ownership
    result = await db.execute(
        select(Resource).where(
            Resource.id == request.resource_id,
            Resource.user_id == current_user.id
        )
    )
    resource = result.scalar_one_or_none()
    
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found"
        )
    
    if request.async_process:
        # Queue for background processing
        background_tasks.add_task(
            processing_service.process_resource,
            resource_id=resource.id,
            extract_only=True
        )
        
        return ExtractTextResponse(
            resource_id=resource.id,
            status="queued",
            message="Resource queued for text extraction"
        )
    else:
        # Process synchronously
        try:
            extracted_text, metadata = await processing_service.extract_text(resource)
            
            # Update resource
            resource.extracted_text = extracted_text
            resource.extracted_metadata = metadata
            resource.processing_status = ProcessingStatus.COMPLETED
            resource.processed_at = datetime.utcnow()
            
            await db.commit()
            
            return ExtractTextResponse(
                resource_id=resource.id,
                status="completed",
                extracted_text=extracted_text,
                metadata=metadata
            )
        except Exception as e:
            resource.processing_status = ProcessingStatus.FAILED
            resource.processing_error = str(e)
            await db.commit()
            
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Error extracting text: {str(e)}"
            )


@router.post("/generate-embeddings", response_model=GenerateEmbeddingsResponse)
async def generate_embeddings(
    request: GenerateEmbeddingsRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Generate embeddings for a resource and store in vector database.
    """
    # Verify resource ownership
    result = await db.execute(
        select(Resource).where(
            Resource.id == request.resource_id,
            Resource.user_id == current_user.id
        )
    )
    resource = result.scalar_one_or_none()
    
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found"
        )
    
    if not resource.extracted_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Resource has no extracted text. Extract text first."
        )
    
    if request.async_process:
        # Queue for background processing
        background_tasks.add_task(
            processing_service.generate_embeddings,
            resource_id=resource.id,
            model=request.embedding_model,
            chunk_size=request.chunk_size,
            chunk_overlap=request.chunk_overlap
        )
        
        return GenerateEmbeddingsResponse(
            resource_id=resource.id,
            status="queued",
            message="Resource queued for embedding generation"
        )
    else:
        # Process synchronously
        try:
            chunk_count = await processing_service.generate_embeddings(
                resource_id=resource.id,
                model=request.embedding_model,
                chunk_size=request.chunk_size,
                chunk_overlap=request.chunk_overlap
            )
            
            return GenerateEmbeddingsResponse(
                resource_id=resource.id,
                status="completed",
                chunk_count=chunk_count,
                embedding_model=request.embedding_model
            )
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Error generating embeddings: {str(e)}"
            )


@router.post("/batch-process")
async def batch_process_resources(
    resource_ids: List[UUID],
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Queue multiple resources for batch processing.
    """
    # Verify ownership of all resources
    result = await db.execute(
        select(Resource.id).where(
            Resource.id.in_(resource_ids),
            Resource.user_id == current_user.id
        )
    )
    valid_ids = {row[0] for row in result}
    
    invalid_ids = set(resource_ids) - valid_ids
    if invalid_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Resources not found: {', '.join(map(str, invalid_ids))}"
        )
    
    # Queue all resources
    for resource_id in valid_ids:
        background_tasks.add_task(
            processing_service.process_resource,
            resource_id=resource_id
        )
    
    return {
        "message": f"Queued {len(valid_ids)} resources for processing",
        "resource_ids": list(valid_ids)
    }


@router.post("/retry-failed")
async def retry_failed_processing(
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session),
    background_tasks: BackgroundTasks = None
):
    """
    Retry processing for all failed resources.
    """
    # Get failed resources
    result = await db.execute(
        select(Resource).where(
            Resource.user_id == current_user.id,
            Resource.processing_status == ProcessingStatus.FAILED
        )
    )
    failed_resources = result.scalars().all()
    
    if not failed_resources:
        return {"message": "No failed resources to retry"}
    
    # Reset status and queue for reprocessing
    for resource in failed_resources:
        resource.processing_status = ProcessingStatus.PENDING
        resource.processing_error = None
        background_tasks.add_task(
            processing_service.process_resource,
            resource_id=resource.id
        )
    
    await db.commit()
    
    return {
        "message": f"Queued {len(failed_resources)} resources for retry",
        "resource_ids": [str(r.id) for r in failed_resources]
    }


# Add missing import
from datetime import datetime