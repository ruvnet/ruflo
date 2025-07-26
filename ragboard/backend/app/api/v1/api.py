"""
API v1 router aggregation.
"""

from fastapi import APIRouter

from app.api.endpoints import auth, resources, collections, conversations, processing

api_router = APIRouter()

# Include all endpoint routers
api_router.include_router(auth.router)
api_router.include_router(resources.router)
api_router.include_router(collections.router)
api_router.include_router(conversations.router)
api_router.include_router(processing.router)