"""
Conversation and chat endpoints.
"""

from typing import Annotated, List, Optional
from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db.base import get_async_session
from app.models.conversation import Conversation, Message, MessageRole
from app.models.user import User
from app.api.dependencies.auth import get_current_active_user
from app.schemas.conversation import (
    ConversationCreate,
    ConversationUpdate,
    ConversationResponse,
    MessageCreate,
    MessageResponse,
    ChatRequest,
    ChatResponse
)
from app.services.ai_chat import AIChatService
from app.services.rag_pipeline import RAGPipeline

router = APIRouter(prefix="/conversations", tags=["conversations"])

# Initialize services
ai_service = AIChatService()
rag_pipeline = RAGPipeline()


@router.post("", response_model=ConversationResponse)
async def create_conversation(
    conversation_data: ConversationCreate,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Create a new conversation.
    """
    conversation = Conversation(
        title=conversation_data.title,
        description=conversation_data.description,
        settings=conversation_data.settings or {},
        user_id=current_user.id
    )
    
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    
    return ConversationResponse.model_validate(conversation)


@router.get("", response_model=List[ConversationResponse])
async def list_conversations(
    skip: int = 0,
    limit: int = 20,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    List user's conversations.
    """
    query = (
        select(Conversation)
        .where(Conversation.user_id == current_user.id)
        .offset(skip)
        .limit(limit)
        .order_by(Conversation.updated_at.desc())
    )
    
    result = await db.execute(query)
    conversations = result.scalars().all()
    
    return [ConversationResponse.model_validate(conv) for conv in conversations]


@router.get("/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(
    conversation_id: UUID,
    include_messages: bool = False,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Get a specific conversation.
    """
    query = select(Conversation).where(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    )
    
    if include_messages:
        query = query.options(selectinload(Conversation.messages))
    
    result = await db.execute(query)
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found"
        )
    
    response = ConversationResponse.model_validate(conversation)
    if include_messages:
        response.messages = [
            MessageResponse.model_validate(msg) 
            for msg in conversation.messages
        ]
    
    return response


@router.put("/{conversation_id}", response_model=ConversationResponse)
async def update_conversation(
    conversation_id: UUID,
    conversation_update: ConversationUpdate,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Update conversation metadata.
    """
    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.user_id == current_user.id
        )
    )
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found"
        )
    
    # Update fields
    update_data = conversation_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(conversation, field, value)
    
    conversation.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(conversation)
    
    return ConversationResponse.model_validate(conversation)


@router.delete("/{conversation_id}")
async def delete_conversation(
    conversation_id: UUID,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Delete a conversation and all its messages.
    """
    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.user_id == current_user.id
        )
    )
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found"
        )
    
    await db.delete(conversation)
    await db.commit()
    
    return {"message": "Conversation deleted successfully"}


@router.get("/{conversation_id}/messages", response_model=List[MessageResponse])
async def get_messages(
    conversation_id: UUID,
    skip: int = 0,
    limit: int = 50,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Get messages from a conversation.
    """
    # Verify conversation ownership
    conv_result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.user_id == current_user.id
        )
    )
    if not conv_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found"
        )
    
    # Get messages
    query = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .offset(skip)
        .limit(limit)
        .order_by(Message.created_at.asc())
    )
    
    result = await db.execute(query)
    messages = result.scalars().all()
    
    return [MessageResponse.model_validate(msg) for msg in messages]


@router.post("/{conversation_id}/chat", response_model=ChatResponse)
async def chat(
    conversation_id: UUID,
    chat_request: ChatRequest,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Send a message and get AI response with RAG context.
    """
    # Verify conversation ownership
    conv_result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.user_id == current_user.id
        )
    )
    conversation = conv_result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found"
        )
    
    # Create user message
    user_message = Message(
        conversation_id=conversation_id,
        role=MessageRole.USER,
        content=chat_request.message,
        metadata=chat_request.metadata
    )
    db.add(user_message)
    
    try:
        # Get RAG context if resource IDs provided
        context = None
        sources = []
        if chat_request.resource_ids:
            context, sources = await rag_pipeline.get_context(
                query=chat_request.message,
                resource_ids=chat_request.resource_ids,
                user_id=current_user.id,
                top_k=chat_request.top_k or 5
            )
        
        # Get conversation history
        history_result = await db.execute(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc())
            .limit(10)
        )
        history = history_result.scalars().all()
        history.reverse()  # Chronological order
        
        # Generate AI response
        ai_response = await ai_service.generate_response(
            message=chat_request.message,
            context=context,
            history=history,
            model=chat_request.model or settings.default_ai_model,
            temperature=chat_request.temperature,
            max_tokens=chat_request.max_tokens
        )
        
        # Create assistant message
        assistant_message = Message(
            conversation_id=conversation_id,
            role=MessageRole.ASSISTANT,
            content=ai_response.content,
            metadata={
                "model": ai_response.model,
                "tokens": ai_response.usage,
                "sources": sources
            }
        )
        db.add(assistant_message)
        
        # Update conversation timestamp
        conversation.updated_at = datetime.utcnow()
        conversation.message_count = (conversation.message_count or 0) + 2
        
        await db.commit()
        await db.refresh(user_message)
        await db.refresh(assistant_message)
        
        return ChatResponse(
            user_message=MessageResponse.model_validate(user_message),
            assistant_message=MessageResponse.model_validate(assistant_message),
            sources=sources
        )
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generating response: {str(e)}"
        )


@router.post("/{conversation_id}/messages")
async def add_message(
    conversation_id: UUID,
    message_data: MessageCreate,
    current_user: Annotated[User, Depends(get_current_active_user)] = None,
    db: AsyncSession = Depends(get_async_session)
):
    """
    Add a message to conversation (for manual message addition).
    """
    # Verify conversation ownership
    conv_result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.user_id == current_user.id
        )
    )
    conversation = conv_result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found"
        )
    
    # Create message
    message = Message(
        conversation_id=conversation_id,
        role=message_data.role,
        content=message_data.content,
        metadata=message_data.metadata
    )
    
    db.add(message)
    
    # Update conversation
    conversation.updated_at = datetime.utcnow()
    conversation.message_count = (conversation.message_count or 0) + 1
    
    await db.commit()
    await db.refresh(message)
    
    return MessageResponse.model_validate(message)