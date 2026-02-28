#!/bin/bash
# Ruflo Health Check Script
# Quick diagnostic to verify installation

echo "🔍 Ruflo Health Check"
echo "====================="
echo ""

# Check Node.js version
echo -n "✓ Node.js version: "
node --version || echo "❌ Node.js not found"

# Check npm
echo -n "✓ npm version: "
npm --version || echo "❌ npm not found"

# Check if ruflo is installed
echo -n "✓ Ruflo CLI: "
which ruflo && ruflo --version || echo "❌ Ruflo not installed globally"

# Check environment variables
echo ""
echo "Environment Variables:"
echo -n "  ANTHROPIC_API_KEY: "
[ -n "$ANTHROPIC_API_KEY" ] && echo "✓ Set" || echo "❌ Not set"

echo -n "  MOONSHOT_API_KEY: "
[ -n "$MOONSHOT_API_KEY" ] && echo "✓ Set" || echo "❌ Not set (optional)"

echo ""
echo "Health check complete!"
