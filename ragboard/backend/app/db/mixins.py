"""
Database mixins for common model functionality.
"""

from typing import Dict, Any
from datetime import datetime
from sqlalchemy import String, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func


class TimestampMixin:
    """Mixin for automatic timestamp fields."""
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False
    )


class SoftDeleteMixin:
    """Mixin for soft delete functionality."""
    
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True
    )
    
    @property
    def is_deleted(self) -> bool:
        """Check if the record is soft deleted."""
        return self.deleted_at is not None
    
    def soft_delete(self) -> None:
        """Mark the record as deleted."""
        self.deleted_at = datetime.utcnow()
    
    def restore(self) -> None:
        """Restore a soft deleted record."""
        self.deleted_at = None


class AuditMixin:
    """Mixin for audit trail fields."""
    
    created_by: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )
    updated_by: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )
    deleted_by: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )


class SerializerMixin:
    """Mixin for model serialization."""
    
    def to_dict(self, exclude: set = None) -> Dict[str, Any]:
        """
        Convert model instance to dictionary.
        
        Args:
            exclude: Set of field names to exclude from serialization
            
        Returns:
            Dictionary representation of the model
        """
        exclude = exclude or set()
        return {
            column.name: getattr(self, column.name)
            for column in self.__table__.columns
            if column.name not in exclude
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SerializerMixin":
        """
        Create model instance from dictionary.
        
        Args:
            data: Dictionary containing model data
            
        Returns:
            New model instance
        """
        return cls(**data)