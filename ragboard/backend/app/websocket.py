"""
WebSocket handlers for real-time features.
"""

from typing import Dict, Set, Optional, List
from uuid import UUID
import json
import asyncio
from datetime import datetime
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, status
from fastapi.websockets import WebSocketState
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import logging

from app.core.config import settings
from app.db.base import get_async_session
from app.models.user import User
from app.models.conversation import Conversation, Message, MessageRole
from app.core.security import verify_token
from app.services.ai_chat import AIChatService
from app.services.rag_pipeline import RAGPipeline

logger = logging.getLogger(__name__)

websocket_router = APIRouter()

# Connection manager for handling multiple WebSocket connections
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[UUID, Set[WebSocket]] = {}
        self.user_connections: Dict[UUID, WebSocket] = {}
    
    async def connect(self, websocket: WebSocket, user_id: UUID):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)
        self.user_connections[user_id] = websocket
        logger.info(f"User {user_id} connected via WebSocket")
    
    def disconnect(self, websocket: WebSocket, user_id: UUID):
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
                if user_id in self.user_connections:
                    del self.user_connections[user_id]
        logger.info(f"User {user_id} disconnected from WebSocket")
    
    async def send_personal_message(self, message: dict, user_id: UUID):
        if user_id in self.active_connections:
            disconnected = []
            for connection in self.active_connections[user_id]:
                try:
                    if connection.client_state == WebSocketState.CONNECTED:
                        await connection.send_json(message)
                    else:
                        disconnected.append(connection)
                except Exception as e:
                    logger.error(f"Error sending message to user {user_id}: {e}")
                    disconnected.append(connection)
            
            # Clean up disconnected connections
            for conn in disconnected:
                self.active_connections[user_id].discard(conn)
    
    async def broadcast_to_conversation(self, message: dict, conversation_id: UUID, user_ids: List[UUID]):
        """Broadcast message to all users in a conversation."""
        for user_id in user_ids:
            await self.send_personal_message(message, user_id)


# Global connection manager instance
manager = ConnectionManager()

# Initialize services
ai_service = AIChatService()
rag_pipeline = RAGPipeline()


async def get_current_user_ws(websocket: WebSocket, token: str) -> Optional[User]:
    """Verify WebSocket authentication."""
    try:
        user_id = verify_token(token, token_type="access")
        if not user_id:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return None
        
        async with get_async_session() as db:
            result = await db.execute(
                select(User).where(User.id == user_id)
            )
            user = result.scalar_one_or_none()
            
            if not user or not user.is_active:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return None
            
            return user
    except Exception as e:
        logger.error(f"WebSocket authentication error: {e}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return None


@websocket_router.websocket("/ws/chat/{conversation_id}")
async def websocket_chat(
    websocket: WebSocket,
    conversation_id: UUID,
    token: str
):
    """
    WebSocket endpoint for real-time chat.
    
    Message format:
    {
        "type": "chat_message" | "typing" | "presence" | "ping",
        "data": {
            "message": "user message text",
            "resource_ids": ["uuid1", "uuid2"],
            "metadata": {}
        }
    }
    """
    user = await get_current_user_ws(websocket, token)
    if not user:
        return
    
    await manager.connect(websocket, user.id)
    
    try:
        # Verify conversation access
        async with get_async_session() as db:
            conv_result = await db.execute(
                select(Conversation).where(
                    Conversation.id == conversation_id,
                    Conversation.user_id == user.id
                )
            )
            conversation = conv_result.scalar_one_or_none()
            
            if not conversation:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return
        
        # Send connection confirmation
        await websocket.send_json({
            "type": "connection",
            "data": {
                "status": "connected",
                "conversation_id": str(conversation_id),
                "user_id": str(user.id)
            }
        })
        
        # Handle messages
        while True:
            data = await websocket.receive_json()
            message_type = data.get("type")
            message_data = data.get("data", {})
            
            if message_type == "ping":
                # Heartbeat
                await websocket.send_json({"type": "pong", "data": {}})
                
            elif message_type == "typing":
                # Broadcast typing indicator to other users in conversation
                await manager.broadcast_to_conversation(
                    {
                        "type": "typing",
                        "data": {
                            "user_id": str(user.id),
                            "conversation_id": str(conversation_id),
                            "is_typing": message_data.get("is_typing", False)
                        }
                    },
                    conversation_id,
                    [user.id]  # In real app, get all users in conversation
                )
                
            elif message_type == "chat_message":
                # Process chat message
                user_message_text = message_data.get("message")
                resource_ids = message_data.get("resource_ids", [])
                metadata = message_data.get("metadata", {})
                
                if not user_message_text:
                    await websocket.send_json({
                        "type": "error",
                        "data": {"message": "Message text is required"}
                    })
                    continue
                
                async with get_async_session() as db:
                    # Create user message
                    user_message = Message(
                        conversation_id=conversation_id,
                        role=MessageRole.USER,
                        content=user_message_text,
                        metadata=metadata
                    )
                    db.add(user_message)
                    await db.commit()
                    
                    # Send user message confirmation
                    await websocket.send_json({
                        "type": "message_created",
                        "data": {
                            "message_id": str(user_message.id),
                            "role": "user",
                            "content": user_message_text,
                            "created_at": user_message.created_at.isoformat()
                        }
                    })
                    
                    # Send typing indicator for assistant
                    await websocket.send_json({
                        "type": "assistant_typing",
                        "data": {"is_typing": True}
                    })
                    
                    try:
                        # Get RAG context if needed
                        context = None
                        sources = []
                        if resource_ids:
                            context, sources = await rag_pipeline.get_context(
                                query=user_message_text,
                                resource_ids=[UUID(rid) for rid in resource_ids],
                                user_id=user.id,
                                top_k=5
                            )
                        
                        # Get conversation history
                        history_result = await db.execute(
                            select(Message)
                            .where(Message.conversation_id == conversation_id)
                            .order_by(Message.created_at.desc())
                            .limit(10)
                        )
                        history = history_result.scalars().all()
                        history.reverse()
                        
                        # Stream AI response
                        response_chunks = []
                        async for chunk in ai_service.generate_response_stream(
                            message=user_message_text,
                            context=context,
                            history=history,
                            model=settings.default_ai_model
                        ):
                            response_chunks.append(chunk)
                            await websocket.send_json({
                                "type": "assistant_chunk",
                                "data": {"chunk": chunk}
                            })
                        
                        # Complete response
                        full_response = "".join(response_chunks)
                        
                        # Save assistant message
                        assistant_message = Message(
                            conversation_id=conversation_id,
                            role=MessageRole.ASSISTANT,
                            content=full_response,
                            metadata={
                                "model": settings.default_ai_model,
                                "sources": sources
                            }
                        )
                        db.add(assistant_message)
                        
                        # Update conversation
                        conversation.updated_at = datetime.utcnow()
                        conversation.message_count = (conversation.message_count or 0) + 2
                        
                        await db.commit()
                        
                        # Send completion
                        await websocket.send_json({
                            "type": "assistant_complete",
                            "data": {
                                "message_id": str(assistant_message.id),
                                "content": full_response,
                                "sources": sources,
                                "created_at": assistant_message.created_at.isoformat()
                            }
                        })
                        
                    except Exception as e:
                        logger.error(f"Error generating AI response: {e}")
                        await websocket.send_json({
                            "type": "error",
                            "data": {"message": "Error generating response"}
                        })
                    finally:
                        # Stop typing indicator
                        await websocket.send_json({
                            "type": "assistant_typing",
                            "data": {"is_typing": False}
                        })
            
            else:
                await websocket.send_json({
                    "type": "error",
                    "data": {"message": f"Unknown message type: {message_type}"}
                })
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, user.id)
        logger.info(f"User {user.id} disconnected from chat {conversation_id}")
    except Exception as e:
        logger.error(f"WebSocket error for user {user.id}: {e}")
        manager.disconnect(websocket, user.id)
        if websocket.client_state == WebSocketState.CONNECTED:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)


@websocket_router.websocket("/ws/notifications")
async def websocket_notifications(
    websocket: WebSocket,
    token: str
):
    """
    WebSocket endpoint for real-time notifications.
    """
    user = await get_current_user_ws(websocket, token)
    if not user:
        return
    
    await manager.connect(websocket, user.id)
    
    try:
        # Send connection confirmation
        await websocket.send_json({
            "type": "connection",
            "data": {
                "status": "connected",
                "user_id": str(user.id)
            }
        })
        
        # Keep connection alive and handle messages
        while True:
            data = await websocket.receive_json()
            message_type = data.get("type")
            
            if message_type == "ping":
                await websocket.send_json({"type": "pong", "data": {}})
            else:
                # Handle other notification-related messages
                pass
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, user.id)
    except Exception as e:
        logger.error(f"WebSocket error for user {user.id}: {e}")
        manager.disconnect(websocket, user.id)


