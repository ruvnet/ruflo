# RAGBoard Local Development Guide

This guide explains how to run RAGBoard locally without Docker, using SQLite instead of PostgreSQL.

## Prerequisites

- Python 3.8+
- Node.js 16+
- npm or yarn

## Quick Start

1. **Start the application:**
   ```bash
   ./start-local.sh
   ```

2. **Stop the application:**
   ```bash
   ./stop-local.sh
   ```

## What the Scripts Do

### `start-local.sh`

This script:
- Checks for required dependencies (Python, Node.js, npm)
- Creates a Python virtual environment and installs backend dependencies
- Installs `aiosqlite` for SQLite async support
- Creates a `.env` file with SQLite configuration
- Patches the database configuration to work with SQLite
- Starts both backend (port 8000) and frontend (port 5173) servers
- Uses Claude Flow hooks for coordination and monitoring

### `stop-local.sh`

This script:
- Gracefully stops both frontend and backend servers
- Cleans up any remaining processes
- Notifies Claude Flow hooks of shutdown

## Configuration

### Database
- Uses SQLite instead of PostgreSQL
- Database file: `backend/ragboard.db`
- Automatically created on first run

### Environment Variables
- Configuration stored in `backend/.env`
- Add your OpenAI/Anthropic API keys to enable AI features:
  ```
  OPENAI_API_KEY=your-key-here
  ANTHROPIC_API_KEY=your-key-here
  ```

### Ports
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Documentation: http://localhost:8000/api/v1/docs

## Troubleshooting

### Backend fails to start
- Check `backend/backend.log` for errors
- Ensure Python 3.8+ is installed
- Try removing `backend/venv` and running again

### Frontend fails to start
- Check if port 5173 is already in use
- Ensure Node.js 16+ is installed
- Try removing `node_modules` and running again

### Database errors
- Delete `backend/ragboard.db` to reset the database
- The script will recreate it on next run

### Port conflicts
- The script automatically kills processes on ports 8000 and 5173
- If issues persist, manually check: `lsof -i :8000` and `lsof -i :5173`

## Features

### SQLite Adaptations
- UUID columns are stored as CHAR(36) in SQLite
- Pool settings are removed (SQLite doesn't support connection pooling)
- Single worker mode for SQLite compatibility

### Development Features
- Hot reload enabled for both frontend and backend
- Debug mode enabled
- Automatic database initialization
- Claude Flow hooks integration for monitoring

## Manual Setup (Alternative)

If you prefer to set up manually:

1. **Backend setup:**
   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   pip install aiosqlite
   # Create .env file with SQLite configuration
   python run_local.py
   ```

2. **Frontend setup:**
   ```bash
   cd ragboard
   npm install
   npm run dev
   ```

## Notes

- This setup is for local development only
- For production, use the Docker setup with PostgreSQL
- Vector search uses ChromaDB with local storage
- Redis features are disabled in local mode