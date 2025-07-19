#!/usr/bin/env bash
# Gemini-Flow local wrapper
# This script ensures gemini-flow runs from your project directory
# Compatible with both CommonJS and ES Module projects

# Save the current directory
PROJECT_DIR="${PWD}"

# Set environment to ensure correct working directory
export PWD="${PROJECT_DIR}"
export CLAUDE_WORKING_DIR="${PROJECT_DIR}"

# Try to find gemini-flow binary
# Check common locations for npm/npx installations

# 1. Local node_modules (npm install gemini-flow)
if [ -f "${PROJECT_DIR}/node_modules/.bin/gemini-flow" ]; then
  cd "${PROJECT_DIR}"
  exec "${PROJECT_DIR}/node_modules/.bin/gemini-flow" "$@"

# 2. Parent directory node_modules (monorepo setup)
elif [ -f "${PROJECT_DIR}/../node_modules/.bin/gemini-flow" ]; then
  cd "${PROJECT_DIR}"
  exec "${PROJECT_DIR}/../node_modules/.bin/gemini-flow" "$@"

# 3. Global installation (npm install -g gemini-flow)
elif command -v gemini-flow &> /dev/null; then
  cd "${PROJECT_DIR}"
  exec gemini-flow "$@"

# 4. Fallback to npx (will download if needed)
else
  cd "${PROJECT_DIR}"
  exec npx gemini-flow@latest "$@"
fi