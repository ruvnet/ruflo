#!/bin/bash

# RAGBoard Local Development Stop Script

echo "🛑 Stopping RAGBoard Local Development Environment..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to kill processes on specific ports
kill_port() {
    local port=$1
    local pid=$(lsof -ti:$port 2>/dev/null)
    if [ ! -z "$pid" ]; then
        echo -e "${YELLOW}Killing process on port $port (PID: $pid)${NC}"
        kill -9 $pid 2>/dev/null || true
    fi
}

# Read PIDs from file if it exists
if [ -f .pids ]; then
    source .pids
    
    # Kill backend process
    if [ ! -z "$BACKEND_PID" ] && ps -p $BACKEND_PID > /dev/null 2>&1; then
        echo -e "${BLUE}Stopping backend (PID: $BACKEND_PID)...${NC}"
        kill $BACKEND_PID 2>/dev/null || true
    fi
    
    # Kill frontend process
    if [ ! -z "$FRONTEND_PID" ] && ps -p $FRONTEND_PID > /dev/null 2>&1; then
        echo -e "${BLUE}Stopping frontend (PID: $FRONTEND_PID)...${NC}"
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    
    rm -f .pids
fi

# Additional cleanup
echo -e "${BLUE}Cleaning up remaining processes...${NC}"
kill_port 8000
kill_port 5173
pkill -f "uvicorn app.main:app" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
pkill -f "npm run dev" 2>/dev/null || true

echo -e "${GREEN}✓ All RAGBoard services stopped${NC}"

# Notify Claude Flow hooks
npx claude-flow@alpha hooks notify --message "RAGBoard local environment stopped" --level "info"