#!/bin/bash

# RAGBoard Local Development Startup Script (No Docker)
# This script runs everything locally using SQLite instead of PostgreSQL

echo "🚀 Starting RAGBoard Local Development Environment..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to kill processes on specific ports
kill_port() {
    local port=$1
    local pid=$(lsof -ti:$port 2>/dev/null)
    if [ ! -z "$pid" ]; then
        echo -e "${YELLOW}Killing process on port $port (PID: $pid)${NC}"
        kill -9 $pid 2>/dev/null || true
    fi
}

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

if ! command_exists python3; then
    echo -e "${RED}❌ Python 3 is not installed${NC}"
    exit 1
fi

if ! command_exists node; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    exit 1
fi

if ! command_exists npm; then
    echo -e "${RED}❌ npm is not installed${NC}"
    exit 1
fi

# Clean up any existing processes
echo -e "${BLUE}Cleaning up existing processes...${NC}"
kill_port 8000
kill_port 5173
pkill -f uvicorn 2>/dev/null || true
pkill -f vite 2>/dev/null || true

# Backend setup
echo -e "${BLUE}Setting up backend...${NC}"
cd backend

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment and install dependencies
echo "Installing backend dependencies..."
source venv/bin/activate

# Install aiosqlite in addition to existing requirements
pip install aiosqlite

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo -e "${BLUE}Creating .env file...${NC}"
    cat > .env << 'EOF'
# Application Settings
APP_NAME=RAGBOARD
APP_VERSION=1.0.0
DEBUG=True
ENVIRONMENT=development
API_V1_PREFIX=/api/v1

# Security
SECRET_KEY=your-secret-key-change-this-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# Database - SQLite for local development
DATABASE_URL=sqlite+aiosqlite:///./ragboard.db

# Redis URL (optional for local dev)
REDIS_URL=

# Vector Database
CHROMA_PERSIST_DIRECTORY=./chroma_db
CHROMA_COLLECTION_NAME=ragboard_vectors

# AI Providers (add your keys here)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# CORS Settings
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# File Upload
MAX_UPLOAD_SIZE=104857600
UPLOAD_DIR=./uploads
EOF
    echo -e "${GREEN}✓ Created .env file - Please add your API keys${NC}"
fi

# Create a startup script that patches the database configuration
cat > run_local.py << 'EOF'
"""
Local development runner that patches database configuration for SQLite.
"""
import os
import sys
import uvicorn
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import String
from sqlalchemy.dialects.postgresql import UUID

# Set environment variable
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./ragboard.db"

# Monkey-patch UUID and JSONB types for SQLite
def patch_types_for_sqlite():
    """Patch UUID and JSONB types to work with SQLite."""
    import sqlalchemy.dialects.sqlite.base as sqlite_base
    
    # Override UUID to use String for SQLite
    def visit_UUID(self, type_, **kw):
        return "CHAR(36)"
    
    # Override JSONB to use JSON for SQLite
    def visit_JSONB(self, type_, **kw):
        return "JSON"
    
    sqlite_base.SQLiteTypeCompiler.visit_UUID = visit_UUID
    sqlite_base.SQLiteTypeCompiler.visit_JSONB = visit_JSONB

# Monkey-patch the database module before importing the app
def patch_database():
    """Patch database configuration for SQLite."""
    import app.db.base as db_base
    
    # Create new engine without pool settings
    db_base.engine = create_async_engine(
        os.environ["DATABASE_URL"],
        echo=False,  # Less verbose logging
        future=True,
    )
    
    # Create new session factory
    db_base.async_session_maker = async_sessionmaker(
        db_base.engine,
        class_=db_base.AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

# Apply patches
patch_types_for_sqlite()
patch_database()

# Import and run the app
from app.main import app

if __name__ == "__main__":
    # Create database tables
    import asyncio
    from app.db.base import engine, Base
    
    async def init_tables():
        async with engine.begin() as conn:
            # Check if tables exist first
            from sqlalchemy import text
            result = await conn.execute(text("SELECT name FROM sqlite_master WHERE type='table';"))
            tables = result.fetchall()
            if not tables or len(tables) < 5:  # If tables don't exist or incomplete
                await conn.run_sync(Base.metadata.drop_all)
                await conn.run_sync(Base.metadata.create_all)
                print("✓ Database tables created")
            else:
                print("✓ Database tables already exist")
    
    # Initialize tables
    asyncio.run(init_tables())
    
    # Run the server
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
EOF

# Start backend server
echo -e "${BLUE}Starting backend server...${NC}"
nohup python run_local.py > backend.log 2>&1 &
BACKEND_PID=$!
echo -e "${GREEN}✓ Backend started on port 8000 (PID: $BACKEND_PID)${NC}"

cd ..

# Frontend setup
echo -e "${BLUE}Setting up frontend...${NC}"

# Install frontend dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
else
    echo "Frontend dependencies already installed"
fi

# Update the API configuration to use local backend
if [ -f "src/config/api.ts" ]; then
    cat > src/config/api.ts << 'EOF'
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
export const API_V1_PREFIX = '/api/v1';
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

export const API_ENDPOINTS = {
  // Auth
  LOGIN: `${API_V1_PREFIX}/auth/login`,
  REGISTER: `${API_V1_PREFIX}/auth/register`,
  REFRESH: `${API_V1_PREFIX}/auth/refresh`,
  LOGOUT: `${API_V1_PREFIX}/auth/logout`,
  ME: `${API_V1_PREFIX}/auth/me`,
  
  // Resources
  RESOURCES: `${API_V1_PREFIX}/resources`,
  UPLOAD: `${API_V1_PREFIX}/resources/upload`,
  
  // Collections
  COLLECTIONS: `${API_V1_PREFIX}/collections`,
  
  // Conversations
  CONVERSATIONS: `${API_V1_PREFIX}/conversations`,
  
  // Processing
  PROCESS: `${API_V1_PREFIX}/processing/process`,
  
  // Vector Search
  SEARCH: `${API_V1_PREFIX}/search`,
};
EOF
fi

# Start frontend server
echo -e "${BLUE}Starting frontend server...${NC}"
export NODE_OPTIONS="--max-old-space-size=2048"
npm run dev &
FRONTEND_PID=$!

# Wait a moment for servers to start
sleep 5

# Check if services are running
if ps -p $BACKEND_PID > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend is running${NC}"
else
    echo -e "${RED}❌ Backend failed to start - check backend.log${NC}"
fi

if ps -p $FRONTEND_PID > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Frontend is running${NC}"
else
    echo -e "${RED}❌ Frontend failed to start${NC}"
fi

# Display startup information
echo -e "\n${GREEN}✨ RAGBoard Local Development is ready!${NC}"
echo -e "${GREEN}====================================${NC}"
echo -e "Frontend: ${BLUE}http://localhost:5173${NC}"
echo -e "Backend API: ${BLUE}http://localhost:8000${NC}"
echo -e "API Docs: ${BLUE}http://localhost:8000/api/v1/docs${NC}"
echo -e "Database: ${BLUE}SQLite (./backend/ragboard.db)${NC}"
echo -e "${GREEN}====================================${NC}"
echo -e "\n${YELLOW}Note: Add your OpenAI/Anthropic API keys to backend/.env${NC}"
echo -e "${BLUE}Press Ctrl+C to stop all services${NC}\n"

# Save PIDs to a file for easy cleanup
echo "BACKEND_PID=$BACKEND_PID" > .pids
echo "FRONTEND_PID=$FRONTEND_PID" >> .pids

# Function to cleanup on exit
cleanup() {
    echo -e "\n${BLUE}Stopping services...${NC}"
    
    # Kill backend process
    if [ ! -z "$BACKEND_PID" ] && ps -p $BACKEND_PID > /dev/null 2>&1; then
        kill $BACKEND_PID 2>/dev/null || true
    fi
    
    # Kill frontend process
    if [ ! -z "$FRONTEND_PID" ] && ps -p $FRONTEND_PID > /dev/null 2>&1; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    
    # Additional cleanup
    kill_port 8000
    kill_port 5173
    pkill -f "python run_local.py" 2>/dev/null || true
    pkill -f vite 2>/dev/null || true
    
    # Remove PID file
    rm -f .pids
    
    echo -e "${GREEN}✓ All services stopped${NC}"
    
    # Notify Claude Flow hooks
    npx claude-flow@alpha hooks post-task --task-id "ragboard-local-start" --analyze-performance true
    
    exit 0
}

# Register cleanup function
trap cleanup SIGINT SIGTERM EXIT

# Notify Claude Flow hooks that setup is complete
npx claude-flow@alpha hooks notify --message "RAGBoard local environment started successfully" --level "success"

# Keep script running
wait $FRONTEND_PID