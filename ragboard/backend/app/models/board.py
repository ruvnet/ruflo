"""
Board model for storing board configurations.
"""

from sqlalchemy import Column, String, Text, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid
from datetime import datetime

from app.db.base import Base
from app.db.mixins import TimestampMixin


class Board(Base, TimestampMixin):
    __tablename__ = "boards"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    
    # JSON data for board state
    resources_data = Column(Text, nullable=True)  # JSON string
    connections_data = Column(Text, nullable=True)  # JSON string
    ai_chats_data = Column(Text, nullable=True)  # JSON string
    
    # Relationships
    user = relationship("User", back_populates="boards")