#!/bin/bash
cd /workspaces/claude-flow/ragboard

# Kill any existing processes
pkill -f vite || true
pkill -f "python.*run_local" || true

echo "Starting RAGBOARD development servers..."

# Start backend
cd backend
python run_local.py > ../backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend started with PID: $BACKEND_PID"

# Start frontend
cd ..
npm run dev &
FRONTEND_PID=$!
echo "Frontend started with PID: $FRONTEND_PID"

echo ""
echo "Services running:"
echo "Frontend: http://localhost:3000"
echo "Backend: http://localhost:8000"
echo ""
echo "Waiting for services to be ready..."
sleep 5

# Keep script running
echo "Press Ctrl+C to stop all services"
wait