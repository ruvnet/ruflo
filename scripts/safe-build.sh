#!/bin/bash
# Safe build script that preserves the existing binary

echo "🔨 Safe Build Script for Gemini Flow"
echo "===================================="

# Create bin directory if it doesn't exist
mkdir -p bin

# Backup existing binary if it exists
if [ -f "bin/gemini-flow" ]; then
    echo "📦 Backing up existing binary..."
    cp bin/gemini-flow bin/gemini-flow.backup
fi

# Set Deno path
export PATH="/home/codespace/.deno/bin:$PATH"

# Build to a temporary file first
echo "🏗️  Building Gemini Flow..."
if deno compile --allow-all --no-check --output=bin/gemini-flow.tmp src/cli/main.ts 2>/dev/null; then
    echo "✅ Build successful!"
    
    # Remove old binary and move new one
    if [ -f "bin/gemini-flow.tmp" ]; then
        mv -f bin/gemini-flow.tmp bin/gemini-flow
        chmod +x bin/gemini-flow
        echo "✅ Binary updated successfully!"
        
        # Remove backup since build was successful
        rm -f bin/gemini-flow.backup
    fi
else
    echo "❌ Build failed!"
    
    # Restore backup if build failed
    if [ -f "bin/gemini-flow.backup" ]; then
        echo "🔄 Restoring backup..."
        mv bin/gemini-flow.backup bin/gemini-flow
        echo "✅ Backup restored!"
    fi
    
    exit 1
fi

# Build prompt copier CLI
echo "🏗️  Building Prompt Copier CLI..."
if deno compile --allow-all --no-check --output=bin/prompt-copier.tmp src/swarm/prompt-cli.ts 2>/dev/null; then
    echo "✅ Prompt copier build successful!"
    
    if [ -f "bin/prompt-copier.tmp" ]; then
        mv -f bin/prompt-copier.tmp bin/prompt-copier
        chmod +x bin/prompt-copier
        echo "✅ Prompt copier binary updated successfully!"
    fi
else
    echo "⚠️  Prompt copier build failed - continuing without it"
fi

echo ""
echo "✅ Build complete!"
echo "   Gemini Flow binary: bin/gemini-flow"
echo "   Prompt Copier binary: bin/prompt-copier"