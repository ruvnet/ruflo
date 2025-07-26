#!/bin/bash

# RAGBoard Development Startup Script

echo "🚀 Starting RAGBoard Development Environment..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

if ! command_exists docker; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    exit 1
fi

if ! command_exists node; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    exit 1
fi

if ! command_exists python3; then
    echo -e "${RED}❌ Python 3 is not installed${NC}"
    exit 1
fi

# Start Docker containers
echo -e "${BLUE}Starting Docker containers...${NC}"
docker-compose up -d

# Wait for PostgreSQL to be ready
echo -e "${BLUE}Waiting for PostgreSQL to be ready...${NC}"
until docker exec ragboard_postgres pg_isready -U ragboard_user -d ragboard_db > /dev/null 2>&1; do
    sleep 1
    echo -n "."
done
echo -e "\n${GREEN}✓ PostgreSQL is ready${NC}"

# Backend setup
echo -e "${BLUE}Setting up backend...${NC}"
cd backend

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment and install dependencies
source venv/bin/activate
pip install -r requirements.txt > /dev/null 2>&1

# Run migrations
echo -e "${BLUE}Running database migrations...${NC}"
alembic upgrade head

# Initialize database with seed data
echo -e "${BLUE}Initializing database...${NC}"
python -m app.db.init_db

# Start backend server in the background
echo -e "${BLUE}Starting backend server...${NC}"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

cd ..

# Frontend setup
echo -e "${BLUE}Setting up frontend...${NC}"

# Install frontend dependencies
echo "Installing frontend dependencies..."
npm install > /dev/null 2>&1

# Start frontend server
echo -e "${BLUE}Starting frontend server...${NC}"
npm run dev &
FRONTEND_PID=$!

# Wait a moment for servers to start
sleep 3

# Display startup information
echo -e "${GREEN}✨ RAGBoard is starting up!${NC}"
echo -e "${GREEN}===========================${NC}"
echo -e "Frontend: ${BLUE}http://localhost:5173${NC}"
echo -e "Backend API: ${BLUE}http://localhost:8000${NC}"
echo -e "API Docs: ${BLUE}http://localhost:8000/api/v1/docs${NC}"
echo -e "PostgreSQL: ${BLUE}localhost:5432${NC}"
echo -e "Redis: ${BLUE}localhost:6379${NC}"
echo -e "${GREEN}===========================${NC}"
echo -e "\n${BLUE}Press Ctrl+C to stop all services${NC}\n"

# Function to cleanup on exit
cleanup() {
    echo -e "\n${BLUE}Stopping services...${NC}"
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    docker-compose down
    echo -e "${GREEN}✓ All services stopped${NC}"
    exit 0
}

# Register cleanup function
trap cleanup SIGINT SIGTERM

# Keep script running
wait