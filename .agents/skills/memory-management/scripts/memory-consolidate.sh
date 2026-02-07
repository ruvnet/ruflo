#!/bin/bash
# Memory Management - Consolidate Script
# Optimize and consolidate memory

set -e

echo "Running memory consolidation..."
npx @claude-flow/cli hooks worker dispatch --trigger consolidate

echo "Memory consolidation complete"
npx @claude-flow/cli memory stats
