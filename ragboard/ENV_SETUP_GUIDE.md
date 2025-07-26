# RAGBOARD Environment Setup Guide

## Quick Start

The environment files have been configured with working defaults that require minimal setup:

```bash
# Run the setup script
./setup-local.sh

# Start the application
./start-dev.sh
```

## Environment Files Created

### 1. Frontend: `.env.local`
- **Location**: `/ragboard/.env.local`
- **Purpose**: Frontend configuration for Vite/React
- **Key Features**:
  - Pre-configured API URLs for local development
  - Optional AI API keys (can be left empty)
  - Feature flags for easy feature toggling
  - Debug helpers enabled for development

### 2. Backend: `backend/.env`
- **Location**: `/ragboard/backend/.env`
- **Purpose**: Backend configuration for FastAPI
- **Key Changes**:
  - ✅ **SQLite** instead of PostgreSQL (no setup required)
  - ✅ **ChromaDB** instead of Pinecone (local, no API key)
  - ✅ **Optional Redis** (can be disabled)
  - ✅ **Optional AI Services** (works without API keys)
  - ✅ **Proper CORS** configuration for local development

## Key Configuration Changes

### Database
- **From**: PostgreSQL (requires installation and setup)
- **To**: SQLite (file-based, automatic)
- **Benefit**: Zero configuration needed

### Vector Storage
- **From**: Pinecone (requires API key)
- **To**: ChromaDB (runs locally)
- **Benefit**: No external dependencies

### CORS Configuration
```python
CORS_ORIGINS=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "http://127.0.0.1:3000"]
```
- Properly configured for local development
- Includes both localhost and 127.0.0.1

### Optional Services

All external services are now optional:
- **Redis**: Leave `REDIS_URL` empty to disable
- **AI Services**: Leave API keys empty to disable
- **AWS S3**: Leave credentials empty to use local storage

## Development Features

### Frontend (.env.local)
- `VITE_DEBUG=true` - Enable debug mode
- `VITE_SHOW_DEBUG_INFO=true` - Show debug panels
- `VITE_MOCK_API=false` - Use real API (set to true for mock data)

### Backend (.env)
- `DEBUG=true` - FastAPI debug mode
- `RELOAD=true` - Auto-reload on code changes
- `RATE_LIMIT_ENABLED=false` - No rate limiting in dev
- `ENABLE_REQUEST_LOGGING=true` - Log all requests

## Adding Optional Services

### Enable AI Features
1. Get API keys from:
   - OpenAI: https://platform.openai.com/api-keys
   - Anthropic: https://console.anthropic.com/api-keys

2. Add to environment files:
   ```bash
   # Backend (.env)
   OPENAI_API_KEY=your-key-here
   ANTHROPIC_API_KEY=your-key-here
   
   # Frontend (.env.local) - Optional
   VITE_OPENAI_API_KEY=your-key-here
   VITE_CLAUDE_API_KEY=your-key-here
   ```

### Enable Redis (for caching)
1. Install Redis: `brew install redis` or `sudo apt install redis`
2. Start Redis: `redis-server`
3. Update backend `.env`:
   ```bash
   REDIS_URL=redis://localhost:6379/0
   ```

### Enable S3 (for cloud storage)
1. Get AWS credentials
2. Update backend `.env`:
   ```bash
   AWS_ACCESS_KEY_ID=your-key
   AWS_SECRET_ACCESS_KEY=your-secret
   S3_BUCKET_NAME=your-bucket
   ```

## Troubleshooting

### Port Conflicts
If ports 5173 or 8000 are in use:
```bash
# Frontend: Edit vite.config.ts
server: { port: 5174 }

# Backend: Edit .env
PORT=8001

# Update frontend .env.local
VITE_API_BASE_URL=http://localhost:8001/api/v1
VITE_WS_URL=ws://localhost:8001/ws
```

### Database Issues
SQLite database will be created automatically at `backend/ragboard.db`. If you have issues:
```bash
cd backend
rm ragboard.db  # Remove existing database
alembic upgrade head  # Recreate schema
```

### CORS Errors
Make sure the frontend URL is included in backend CORS_ORIGINS. Add any additional URLs as needed.

## Production Deployment

For production, remember to:
1. Change `SECRET_KEY` to a secure random value
2. Set `DEBUG=false` and `ENVIRONMENT=production`
3. Use PostgreSQL instead of SQLite
4. Configure proper CORS origins
5. Enable rate limiting and security features
6. Use environment-specific API keys