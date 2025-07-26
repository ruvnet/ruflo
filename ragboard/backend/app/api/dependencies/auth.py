"""
Authentication dependencies for FastAPI.
"""

from typing import Optional, Annotated
from fastapi import Depends, HTTPException, status, Security
from fastapi.security import OAuth2PasswordBearer, APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import JWTError, jwt
import hashlib

from app.core.config import settings
from app.core.security import verify_token
from app.db.base import get_async_session
from app.models.user import User, APIKey


# OAuth2 scheme for token authentication
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.api_v1_prefix}/auth/login",
    auto_error=False
)

# API Key header scheme
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

# HTTP Bearer scheme
http_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    token: Annotated[Optional[str], Depends(oauth2_scheme)],
    api_key: Annotated[Optional[str], Depends(api_key_header)],
    bearer: Annotated[Optional[HTTPAuthorizationCredentials], Security(http_bearer)],
    db: AsyncSession = Depends(get_async_session)
) -> User:
    """
    Get current authenticated user from various auth methods.
    
    Supports:
    - OAuth2 Bearer token
    - API Key in header
    - HTTP Bearer token
    
    Args:
        token: OAuth2 token
        api_key: API key from header
        bearer: HTTP Bearer credentials
        db: Database session
        
    Returns:
        Authenticated user
        
    Raises:
        HTTPException: If authentication fails
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    # Try OAuth2 token first
    if token:
        user_id = verify_token(token, token_type="access")
        if user_id:
            result = await db.execute(
                select(User).where(User.id == user_id)
            )
            user = result.scalar_one_or_none()
            if user and user.is_active:
                return user
    
    # Try HTTP Bearer token
    if bearer and bearer.credentials:
        user_id = verify_token(bearer.credentials, token_type="access")
        if user_id:
            result = await db.execute(
                select(User).where(User.id == user_id)
            )
            user = result.scalar_one_or_none()
            if user and user.is_active:
                return user
    
    # Try API key
    if api_key:
        # Extract prefix and hash the key
        if "_" in api_key:
            prefix = api_key.split("_")[0]
            key_hash = hashlib.sha256(api_key.encode()).hexdigest()
            
            result = await db.execute(
                select(APIKey).where(
                    APIKey.prefix == prefix,
                    APIKey.key_hash == key_hash,
                    APIKey.is_active == True
                )
            )
            api_key_obj = result.scalar_one_or_none()
            
            if api_key_obj:
                # Get the user
                result = await db.execute(
                    select(User).where(User.id == api_key_obj.user_id)
                )
                user = result.scalar_one_or_none()
                if user and user.is_active:
                    return user
    
    raise credentials_exception


async def get_current_active_user(
    current_user: Annotated[User, Depends(get_current_user)]
) -> User:
    """
    Get current active user.
    
    Args:
        current_user: Current authenticated user
        
    Returns:
        Active user
        
    Raises:
        HTTPException: If user is inactive
    """
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )
    return current_user


async def get_current_verified_user(
    current_user: Annotated[User, Depends(get_current_active_user)]
) -> User:
    """
    Get current verified user.
    
    Args:
        current_user: Current active user
        
    Returns:
        Verified user
        
    Raises:
        HTTPException: If user is not verified
    """
    if not current_user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User not verified"
        )
    return current_user


async def get_current_superuser(
    current_user: Annotated[User, Depends(get_current_active_user)]
) -> User:
    """
    Get current superuser.
    
    Args:
        current_user: Current active user
        
    Returns:
        Superuser
        
    Raises:
        HTTPException: If user is not a superuser
    """
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough privileges"
        )
    return current_user


def check_user_permissions(
    required_permissions: list[str]
) -> callable:
    """
    Dependency to check user permissions.
    
    Args:
        required_permissions: List of required permissions
        
    Returns:
        Dependency function
    """
    async def permission_checker(
        current_user: Annotated[User, Depends(get_current_active_user)]
    ) -> User:
        """Check if user has required permissions."""
        # Superusers have all permissions
        if current_user.is_superuser:
            return current_user
        
        # Check user roles and permissions
        user_permissions = set()
        for role in current_user.roles:
            if role.permissions:
                user_permissions.update(role.permissions.get("permissions", []))
        
        # Check if user has all required permissions
        if not all(perm in user_permissions for perm in required_permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions"
            )
        
        return current_user
    
    return permission_checker


# Common permission dependencies
require_read = check_user_permissions(["read"])
require_write = check_user_permissions(["write"])
require_delete = check_user_permissions(["delete"])
require_admin = check_user_permissions(["admin"])