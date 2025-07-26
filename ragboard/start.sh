#!/bin/bash
# RAGBOARD Startup Script

echo "🚀 Starting RAGBOARD services..."

# Kill any existing processes
pkill -f vite 2>/dev/null || true
pkill -f uvicorn 2>/dev/null || true

# Start backend in background
cd /workspaces/claude-flow/ragboard/backend
source venv/bin/activate
nohup uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 > /tmp/backend.log 2>&1 &
echo "✅ Backend started on port 8000"

# Start frontend
cd /workspaces/claude-flow/ragboard
export NODE_OPTIONS="--max-old-space-size=2048"
echo "✅ Starting frontend on port 5173..."
npm run dev