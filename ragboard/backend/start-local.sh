#!/bin/bash
# Local development startup script for RAGBOARD backend

echo "🚀 Starting RAGBOARD backend in local development mode..."

# Check if .env.local exists, if not copy from .env.local
if [ ! -f .env ]; then
    if [ -f .env.local ]; then
        echo "📋 Creating .env from .env.local..."
        cp .env.local .env
    else
        echo "⚠️  No .env file found. Please create one from .env.example or .env.local"
        exit 1
    fi
fi

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "🐍 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Install requirements
echo "📦 Installing requirements for local development..."
if [ -f "requirements-local.txt" ]; then
    pip install -r requirements-local.txt
else
    # Fallback to main requirements but skip problematic packages
    pip install -r requirements.txt --no-deps chromadb aiosqlite
fi

# Create necessary directories
echo "📁 Creating necessary directories..."
mkdir -p ./uploads
mkdir -p ./logs
mkdir -p ./chroma_db

# Initialize database
echo "🗄️  Initializing SQLite database..."
python -c "
import asyncio
from app.db.base import init_db
asyncio.run(init_db())
print('✅ Database initialized successfully!')
"

# Start the server
echo "🎯 Starting FastAPI server..."
echo "📍 API docs will be available at: http://localhost:8000/api/v1/docs"
echo "🔗 Frontend can connect to: http://localhost:8000"
echo ""
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000