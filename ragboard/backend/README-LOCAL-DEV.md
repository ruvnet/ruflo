# RAGBOARD Backend - Local Development Setup

This guide explains how to run RAGBOARD backend locally with SQLite (no PostgreSQL required).

## Quick Start

1. **Use the startup script:**
   ```bash
   ./start-local.sh
   ```

   This script will:
   - Create a Python virtual environment
   - Install dependencies (including SQLite support)
   - Set up the database
   - Start the development server

2. **Access the application:**
   - API Documentation: http://localhost:8000/api/v1/docs
   - Backend API: http://localhost:8000
   - Frontend should connect to: http://localhost:8000

## Manual Setup

If you prefer to set up manually:

1. **Create virtual environment:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements-local.txt
   ```

3. **Set up environment:**
   ```bash
   cp .env.local .env
   ```

4. **Start the server:**
   ```bash
   uvicorn app.main:app --reload
   ```

## Configuration Changes

### Database
- **SQLite** is now the default for local development
- No PostgreSQL installation required
- Database file: `./ragboard.db`
- Automatic database creation on first run

### Vector Database
- **ChromaDB** is the default vector store
- No Pinecone API key required
- Local storage in `./chroma_db` directory
- Fully functional vector search without external services

### AI Providers
- OpenAI and Anthropic API keys are **optional**
- Application starts without AI keys configured
- AI features show warnings but don't block startup
- Add keys to `.env` when ready to use AI features

### Optional Services
- Redis is optional (caching disabled in local mode)
- AWS S3 is optional (local file storage used)
- External APIs are optional

## Environment Variables

Key settings in `.env.local`:

```env
# SQLite database (local development)
DATABASE_URL=sqlite+aiosqlite:///./ragboard.db

# AI keys (optional - uncomment to enable)
# OPENAI_API_KEY=your-key-here
# ANTHROPIC_API_KEY=your-key-here

# Feature flags
ENABLE_AI_FEATURES=true  # Shows warnings if no keys
ENABLE_PINECONE=false    # Uses ChromaDB instead
```

## Differences from Production

| Feature | Local Development | Production |
|---------|------------------|------------|
| Database | SQLite | PostgreSQL |
| Vector DB | ChromaDB (local) | Pinecone/ChromaDB |
| Redis | Optional/Disabled | Required |
| AI Keys | Optional | Required |
| Workers | 1 (reload mode) | 4+ |
| Debug | Enabled | Disabled |

## Troubleshooting

1. **Import errors:** Make sure you're using the virtual environment
2. **Database errors:** Delete `ragboard.db` and restart to recreate
3. **Permission errors:** Check file permissions on directories
4. **AI features not working:** Add API keys to `.env`

## Next Steps

1. Add your AI API keys to `.env` when ready
2. Test file uploads and processing
3. Use the API docs to explore endpoints
4. Connect your frontend to `http://localhost:8000`