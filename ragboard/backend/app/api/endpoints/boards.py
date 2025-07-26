"""
Board management endpoints.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.board import BoardCreate, BoardUpdate, BoardResponse, BoardListResponse
from app.services.board import BoardService

router = APIRouter(prefix="/boards", tags=["boards"])


@router.post("/save", response_model=BoardResponse)
async def save_board(
    board_data: BoardCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save or update a board."""
    service = BoardService(db)
    board = await service.save_board(
        user_id=current_user.id,
        board_data=board_data
    )
    return board


@router.get("", response_model=List[BoardListResponse])
async def list_boards(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all boards for the current user."""
    service = BoardService(db)
    boards = await service.list_boards(user_id=current_user.id)
    return boards


@router.get("/{board_id}/load", response_model=BoardResponse)
async def load_board(
    board_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Load a specific board."""
    service = BoardService(db)
    board = await service.load_board(
        board_id=board_id,
        user_id=current_user.id
    )
    if not board:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Board not found"
        )
    return board


@router.delete("/{board_id}")
async def delete_board(
    board_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a board."""
    service = BoardService(db)
    success = await service.delete_board(
        board_id=board_id,
        user_id=current_user.id
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Board not found"
        )
    return {"message": "Board deleted successfully"}