#!/bin/bash
# CI Environment Setup Script

set -e

echo "🚀 Setting up CI environment..."

# Set environment variables
export NODE_ENV=test
export CLAUDE_FLOW_ENV=test
export CI=true
export NODE_OPTIONS="--max-old-space-size=2048"

# Create necessary directories
mkdir -p logs
mkdir -p coverage
mkdir -p test-results
mkdir -p .claude

# Platform detection
PLATFORM="unknown"
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    PLATFORM="linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    PLATFORM="macos"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
    PLATFORM="windows"
fi

echo "Platform detected: $PLATFORM"

# Function to install dependencies with retries
install_deps() {
    local retries=3
    local count=0
    
    while [ $count -lt $retries ]; do
        echo "Installing dependencies (attempt $((count + 1))/$retries)..."
        
        if npm ci --ignore-scripts --no-audit --no-fund; then
            echo "✅ Dependencies installed successfully"
            return 0
        fi
        
        count=$((count + 1))
        
        if [ $count -lt $retries ]; then
            echo "⚠️  Installation failed, retrying in 5 seconds..."
            sleep 5
            # Clear npm cache on retry
            npm cache clean --force || true
        fi
    done
    
    echo "❌ Failed to install dependencies after $retries attempts"
    return 1
}

# Function to setup test environment
setup_test_env() {
    echo "Setting up test environment..."
    
    # Create default config if not exists
    if [ ! -f ".claude/settings.json" ]; then
        mkdir -p .claude
        cat > .claude/settings.json <<EOF
{
  "version": "2.0.0",
  "environment": "ci",
  "testMode": true,
  "hooks": {
    "enabled": false
  },
  "memory": {
    "backend": "json",
    "path": "./memory/test-memory.json"
  }
}
EOF
    fi
    
    # Create jest setup if needed
    if [ ! -f "jest.setup.js" ]; then
        cat > jest.setup.js <<EOF
// CI-specific Jest setup
process.env.NODE_ENV = 'test';
process.env.CLAUDE_FLOW_ENV = 'test';
process.env.CI = 'true';

// Increase test timeout for CI
jest.setTimeout(30000);

// Mock console methods to reduce noise
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};
EOF
    fi
}

# Function to validate environment
validate_env() {
    echo "Validating CI environment..."
    
    # Check Node.js version
    node_version=$(node -v)
    echo "Node.js version: $node_version"
    
    # Check npm version
    npm_version=$(npm -v)
    echo "npm version: $npm_version"
    
    # Check for required files
    required_files=("package.json" "package-lock.json")
    for file in "${required_files[@]}"; do
        if [ ! -f "$file" ]; then
            echo "❌ Missing required file: $file"
            exit 1
        fi
    done
    
    echo "✅ Environment validation passed"
}

# Main execution
echo "================================"
echo "CI Setup for claude-flow"
echo "================================"

# Validate environment first
validate_env

# Install dependencies
if ! install_deps; then
    echo "Failed to install dependencies"
    exit 1
fi

# Setup test environment
setup_test_env

# Platform-specific setup
case $PLATFORM in
    windows)
        echo "Running Windows-specific setup..."
        # Fix line endings
        find . -name "*.js" -o -name "*.json" -o -name "*.ts" | xargs dos2unix 2>/dev/null || true
        ;;
    macos)
        echo "Running macOS-specific setup..."
        # Ensure proper permissions
        chmod -R 755 scripts/ 2>/dev/null || true
        ;;
    linux)
        echo "Running Linux-specific setup..."
        # Set proper permissions
        chmod -R 755 scripts/ 2>/dev/null || true
        ;;
esac

# Final validation
echo "Running final checks..."

# Check if basic commands work
if node -e "console.log('Node.js works')"; then
    echo "✅ Node.js runtime OK"
else
    echo "❌ Node.js runtime failed"
    exit 1
fi

# Try to run a simple test
if npm run test:unit -- --listTests > /dev/null 2>&1; then
    echo "✅ Test framework OK"
else
    echo "⚠️  Test framework may have issues"
fi

echo ""
echo "✅ CI environment setup complete!"
echo "================================"