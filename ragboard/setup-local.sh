#!/bin/bash

# RAGBOARD Local Development Setup Script
# This script sets up the local development environment with minimal dependencies

echo "🚀 Setting up RAGBOARD for local development..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check for required tools
echo -e "${YELLOW}Checking dependencies...${NC}"

if ! command_exists node; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js 18+ first.${NC}"
    exit 1
fi

if ! command_exists python3; then
    echo -e "${RED}❌ Python 3 is not installed. Please install Python 3.8+ first.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Dependencies check passed${NC}"

# Setup frontend
echo -e "\n${YELLOW}Setting up frontend...${NC}"

# Copy frontend env file if it doesn't exist
if [ ! -f ".env.local" ]; then
    echo "Creating .env.local for frontend..."
    cp .env.example .env.local
    echo -e "${GREEN}✅ Created .env.local${NC}"
else
    echo -e "${YELLOW}⚠️  .env.local already exists, skipping...${NC}"
fi

# Install frontend dependencies
echo "Installing frontend dependencies..."
npm install

# Setup backend
echo -e "\n${YELLOW}Setting up backend...${NC}"
cd backend || exit

# Copy backend env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "Creating .env for backend..."
    cp .env.example .env
    echo -e "${GREEN}✅ Created .env${NC}"
else
    echo -e "${YELLOW}⚠️  .env already exists, skipping...${NC}"
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
    echo -e "${GREEN}✅ Created virtual environment${NC}"
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Create requirements-local.txt if it doesn't exist
if [ ! -f "requirements-local.txt" ]; then
    echo "Creating requirements-local.txt for SQLite setup..."
    cat > requirements-local.txt << 'EOF'
fastapi==0.109.0
uvicorn[standard]==0.27.0
python-multipart==0.0.6
pydantic==2.5.3
pydantic-settings==2.1.0
sqlalchemy==2.0.25
alembic==1.13.1
aiosqlite==0.20.0
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
python-dotenv==1.0.0
httpx==0.27.0
aiofiles==23.2.1
openai==1.8.0
anthropic==0.8.1
Pillow==10.2.0
PyPDF2==3.0.1
beautifulsoup4==4.12.2
requests==2.31.0
numpy==1.26.3
pandas==2.1.4
scikit-learn==1.4.0
email-validator==2.1.0
chromadb==0.4.22
EOF
fi

# Install backend dependencies
echo "Installing backend dependencies..."
pip install -r requirements-local.txt

# Create necessary directories
echo -e "\n${YELLOW}Creating directories...${NC}"
mkdir -p uploads
mkdir -p logs
mkdir -p chroma_db

# Initialize database
echo -e "\n${YELLOW}Initializing database...${NC}"
alembic upgrade head

# Go back to root directory
cd ..

# Create start script
echo -e "\n${YELLOW}Creating start script...${NC}"
cat > start-dev.sh << 'EOF'
#!/bin/bash

# Start RAGBOARD in development mode

echo "🚀 Starting RAGBOARD in development mode..."

# Function to cleanup on exit
cleanup() {
    echo -e "\n🛑 Shutting down services..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit
}

trap cleanup EXIT INT TERM

# Start backend
echo "Starting backend server..."
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

# Wait a bit for backend to start
sleep 3

# Start frontend
echo "Starting frontend server..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "✅ RAGBOARD is running!"
echo "   Frontend: http://localhost:5173"
echo "   Backend:  http://localhost:8000"
echo "   API Docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for both processes
wait
EOF

chmod +x start-dev.sh

# Summary
echo -e "\n${GREEN}✅ Setup complete!${NC}"
echo -e "\n${YELLOW}Next steps:${NC}"
echo "1. (Optional) Add your AI API keys to:"
echo "   - Frontend: .env.local (VITE_OPENAI_API_KEY, VITE_CLAUDE_API_KEY)"
echo "   - Backend: backend/.env (OPENAI_API_KEY, ANTHROPIC_API_KEY)"
echo ""
echo "2. Start the development servers:"
echo "   ${GREEN}./start-dev.sh${NC}"
echo ""
echo "3. Open your browser to:"
echo "   - Frontend: http://localhost:5173"
echo "   - API Docs: http://localhost:8000/docs"
echo ""
echo -e "${YELLOW}Note:${NC} AI features will work without API keys but with limited functionality."
echo "The app uses SQLite (no setup needed) and ChromaDB (local vector storage)."