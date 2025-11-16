#!/bin/bash
# Setup A/B Testing Directories

echo "🔧 Setting up A/B test directories..."

# Create baseline directory (Control - no claude-flow)
mkdir -p ~/checkout-baseline
cd ~/checkout-baseline
npm init -y
npm install express pg react typescript jest cypress stripe @types/express @types/node @types/react

echo "✅ Baseline directory ready: ~/checkout-baseline"

# Create claude-flow directory (Treatment - with claude-flow)
mkdir -p ~/checkout-claude-flow
cd ~/checkout-claude-flow
npm init -y
npm install express pg react typescript jest cypress stripe @types/express @types/node @types/react

# Initialize claude-flow with clean memory
npx claude-flow@alpha init --force
rm -rf .swarm/memory.db .hive-mind/hive.db  # Clean memory databases
npx claude-flow@alpha init --force  # Reinitialize with clean state

echo "✅ Claude-flow directory ready: ~/checkout-claude-flow"
echo ""
echo "📋 Next steps:"
echo "  1. Run baseline test in: ~/checkout-baseline"
echo "  2. Run claude-flow test in: ~/checkout-claude-flow"
