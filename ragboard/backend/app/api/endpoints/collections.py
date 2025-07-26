"""
Collection management endpoints.
"""

from typing import Annotated, List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db.base import get_async_session
from app.models.resource import Collection, Resource
from app.models.user import User
from app.api.dependencies.auth import get_current_active_user
from app.schemas.resource import (
    CollectionCreate,
    CollectionUpdate,
    CollectionResponse
)

router = APIRouter(prefix="/collections", tags=["collections"])


@router.post("", response_model=CollectionResponse)
async def create_collection(
    collection_data: CollectionCreate,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Create a new collection.
    """
    # Check for duplicate name
    result = await db.execute(
        select(Collection).where(
            Collection.name == collection_data.name,
            Collection.user_id == current_user.id
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Collection with this name already exists"
        )
    
    # Create collection
    collection = Collection(
        **collection_data.model_dump(),
        user_id=current_user.id
    )
    
    db.add(collection)
    await db.commit()
    await db.refresh(collection)
    
    return CollectionResponse.model_validate(collection)


@router.get("", response_model=List[CollectionResponse])
async def list_collections(
    skip: int = 0,
    limit: int = 20,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    List user's collections.
    """
    # Get collections with resource count
    query = (
        select(
            Collection,
            func.count(Resource.id).label('resource_count')
        )
        .outerjoin(Resource)
        .where(Collection.user_id == current_user.id)
        .group_by(Collection.id)
        .offset(skip)
        .limit(limit)
        .order_by(Collection.created_at.desc())
    )
    
    result = await db.execute(query)
    collections_with_count = result.all()
    
    # Format response
    response = []
    for collection, count in collections_with_count:
        collection_dict = CollectionResponse.model_validate(collection).model_dump()
        collection_dict['resource_count'] = count
        response.append(CollectionResponse(**collection_dict))
    
    return response


@router.get("/{collection_id}", response_model=CollectionResponse)
async def get_collection(
    collection_id: UUID,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Get a specific collection.
    """
    # Get collection with resource count
    query = (
        select(
            Collection,
            func.count(Resource.id).label('resource_count')
        )
        .outerjoin(Resource)
        .where(
            Collection.id == collection_id,
            Collection.user_id == current_user.id
        )
        .group_by(Collection.id)
    )
    
    result = await db.execute(query)
    row = result.first()
    
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found"
        )
    
    collection, count = row
    collection_dict = CollectionResponse.model_validate(collection).model_dump()
    collection_dict['resource_count'] = count
    
    return CollectionResponse(**collection_dict)


@router.put("/{collection_id}", response_model=CollectionResponse)
async def update_collection(
    collection_id: UUID,
    collection_update: CollectionUpdate,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Update collection information.
    """
    result = await db.execute(
        select(Collection).where(
            Collection.id == collection_id,
            Collection.user_id == current_user.id
        )
    )
    collection = result.scalar_one_or_none()
    
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found"
        )
    
    # Check for duplicate name if updating
    if collection_update.name and collection_update.name != collection.name:
        result = await db.execute(
            select(Collection).where(
                Collection.name == collection_update.name,
                Collection.user_id == current_user.id,
                Collection.id != collection_id
            )
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Collection with this name already exists"
            )
    
    # Update fields
    update_data = collection_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(collection, field, value)
    
    await db.commit()
    await db.refresh(collection)
    
    return CollectionResponse.model_validate(collection)


@router.delete("/{collection_id}")
async def delete_collection(
    collection_id: UUID,
    move_resources_to: Optional[UUID] = None,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Delete a collection. Optionally move resources to another collection.
    """
    result = await db.execute(
        select(Collection).where(
            Collection.id == collection_id,
            Collection.user_id == current_user.id
        )
    )
    collection = result.scalar_one_or_none()
    
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found"
        )
    
    # If moving resources, verify target collection exists
    if move_resources_to:
        target_result = await db.execute(
            select(Collection).where(
                Collection.id == move_resources_to,
                Collection.user_id == current_user.id
            )
        )
        if not target_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Target collection not found"
            )
        
        # Move resources
        await db.execute(
            update(Resource)
            .where(Resource.collection_id == collection_id)
            .values(collection_id=move_resources_to)
        )
    else:
        # Remove collection reference from resources
        await db.execute(
            update(Resource)
            .where(Resource.collection_id == collection_id)
            .values(collection_id=None)
        )
    
    # Delete collection
    await db.delete(collection)
    await db.commit()
    
    return {"message": "Collection deleted successfully"}


@router.post("/{collection_id}/resources/{resource_id}")
async def add_resource_to_collection(
    collection_id: UUID,
    resource_id: UUID,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Add a resource to a collection.
    """
    # Verify collection ownership
    collection_result = await db.execute(
        select(Collection).where(
            Collection.id == collection_id,
            Collection.user_id == current_user.id
        )
    )
    if not collection_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found"
        )
    
    # Verify resource ownership
    resource_result = await db.execute(
        select(Resource).where(
            Resource.id == resource_id,
            Resource.user_id == current_user.id
        )
    )
    resource = resource_result.scalar_one_or_none()
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found"
        )
    
    # Add to collection
    resource.collection_id = collection_id
    await db.commit()
    
    return {"message": "Resource added to collection"}


@router.delete("/{collection_id}/resources/{resource_id}")
async def remove_resource_from_collection(
    collection_id: UUID,
    resource_id: UUID,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Remove a resource from a collection.
    """
    # Verify resource ownership and collection membership
    result = await db.execute(
        select(Resource).where(
            Resource.id == resource_id,
            Resource.user_id == current_user.id,
            Resource.collection_id == collection_id
        )
    )
    resource = result.scalar_one_or_none()
    
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found in this collection"
        )
    
    # Remove from collection
    resource.collection_id = None
    await db.commit()
    
    return {"message": "Resource removed from collection"}