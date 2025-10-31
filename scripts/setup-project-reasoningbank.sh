#!/bin/bash
# Setup ReasoningBank dual-terminal strategy for a project
# Usage: ./setup-project-reasoningbank.sh /path/to/your-project

set -e

PROJECT_PATH="${1:-.}"

if [ ! -d "$PROJECT_PATH" ]; then
  echo "❌ Error: Directory does not exist: $PROJECT_PATH"
  exit 1
fi

cd "$PROJECT_PATH" || exit 1

echo "🚀 Setting up ReasoningBank strategy for: $PROJECT_PATH"
echo ""

# Create .swarm directory
mkdir -p .swarm

# Copy the concise project guide
cp /workspaces/claude-flow/docs/binto-labs/PROJECT-REASONINGBANK-README.md \
   .swarm/REASONINGBANK-GUIDE.md

echo "✅ Copied ReasoningBank guide to .swarm/REASONINGBANK-GUIDE.md"

# Create .gitignore for memory files
if [ ! -f .swarm/.gitignore ]; then
  cat > .swarm/.gitignore << 'EOF'
# Memory databases (project-specific, don't commit)
*.db
*.db-shm
*.db-wal
*.backup*

# Keep documentation
!REASONINGBANK-GUIDE.md
!README.md
EOF
  echo "✅ Created .swarm/.gitignore"
fi

# Create project memory README
cat > .swarm/README.md << 'EOF'
# Memory Strategy for This Project

## Current Setup
- **Project Memory:** `.swarm/memory.db` (learns from THIS project)
- **ReasoningBank:** `/workspaces/claude-flow/.swarm/memory.db` (universal patterns)

## Usage

### Terminal 1: Development (Use This Terminal)
Work normally in this project. Claude builds project-specific memory.

### Terminal 2: Code Review (Use `/workspaces/claude-flow`)
Copy files to `/tmp/` and ask Claude for reviews using ReasoningBank patterns.

## Full Guide
See: `.swarm/REASONINGBANK-GUIDE.md`

## Don't Merge (Yet)
Keep project memory clean for first 3-6 months.
After project stabilizes, consider selective pattern import.
EOF

echo "✅ Created .swarm/README.md"

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 ReasoningBank Setup Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Files Created:"
echo "  📄 .swarm/REASONINGBANK-GUIDE.md   (Full installation & usage guide)"
echo "  📄 .swarm/README.md                (Quick reference)"
echo "  📄 .swarm/.gitignore               (Ignore .db files)"
echo ""
echo "Next Steps:"
echo "  1. Read: .swarm/README.md"
echo "  2. Work in THIS terminal (builds project memory)"
echo "  3. Use /workspaces/claude-flow for code reviews"
echo ""
echo "ReasoningBank Location: /workspaces/claude-flow/.swarm/memory.db"
echo "Project Memory Location: $PROJECT_PATH/.swarm/memory.db (will be created)"
echo ""
