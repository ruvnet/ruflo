"""
Board schemas for API requests and responses.
"""

from typing import List, Optional, Any, Dict
from datetime import datetime
from pydantic import BaseModel, Field
from uuid import UUID


class BoardCreate(BaseModel):
    """Schema for creating/updating a board."""
    name: str = Field(..., description="Board name")
    resources: List[Dict[str, Any]] = Field(default_factory=list, description="List of resources")
    connections: List[Dict[str, Any]] = Field(default_factory=list, description="List of connections")
    aiChats: List[Dict[str, Any]] = Field(default_factory=list, description="List of AI chats")
    
    class Config:
        json_schema_extra = {
            "example": {
                "name": "My Board",
                "resources": [],
                "connections": [],
                "aiChats": []
            }
        }


class BoardUpdate(BaseModel):
    """Schema for updating a board."""
    name: Optional[str] = None
    resources: Optional[List[Dict[str, Any]]] = None
    connections: Optional[List[Dict[str, Any]]] = None
    aiChats: Optional[List[Dict[str, Any]]] = None


class BoardListResponse(BaseModel):
    """Schema for board list response."""
    id: str
    name: str
    updatedAt: datetime
    
    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat() if v else None
        }


class BoardResponse(BaseModel):
    """Schema for full board response."""
    id: str
    name: str
    resources: List[Dict[str, Any]]
    connections: List[Dict[str, Any]]
    aiChats: List[Dict[str, Any]]
    createdAt: datetime
    updatedAt: datetime
    
    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat() if v else None
        }