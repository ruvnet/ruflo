#!/bin/bash
# Gas Town Bridge - WASM Build Script
#
# Builds all WASM modules for the Gas Town Bridge plugin.
# Requires: rustup, wasm-pack
#
# Usage: ./scripts/build-wasm.sh [--release]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
WASM_DIR="$PLUGIN_DIR/wasm"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Gas Town Bridge - WASM Build${NC}"
echo "=============================="
echo ""

# Check for wasm-pack
if ! command -v wasm-pack &> /dev/null; then
    echo -e "${YELLOW}wasm-pack not found. Installing...${NC}"
    cargo install wasm-pack
fi

# Check for rustup
if ! command -v rustup &> /dev/null; then
    echo -e "${RED}Error: rustup not found. Please install Rust from https://rustup.rs${NC}"
    exit 1
fi

# Add wasm32 target if not present
if ! rustup target list --installed | grep -q "wasm32-unknown-unknown"; then
    echo -e "${YELLOW}Adding wasm32-unknown-unknown target...${NC}"
    rustup target add wasm32-unknown-unknown
fi

# Build mode
BUILD_MODE="--dev"
if [[ "$1" == "--release" ]]; then
    BUILD_MODE="--release"
    echo -e "${GREEN}Building in release mode${NC}"
else
    echo -e "${YELLOW}Building in development mode (use --release for production)${NC}"
fi

echo ""

# Build gastown-formula-wasm
echo -e "${GREEN}Building gastown-formula-wasm...${NC}"
cd "$WASM_DIR/gastown-formula-wasm"
wasm-pack build --target web $BUILD_MODE
echo -e "${GREEN}  Done!${NC}"

# Build ruvector-gnn-wasm
echo -e "${GREEN}Building ruvector-gnn-wasm...${NC}"
cd "$WASM_DIR/ruvector-gnn-wasm"
wasm-pack build --target web $BUILD_MODE
echo -e "${GREEN}  Done!${NC}"

echo ""
echo -e "${GREEN}WASM build complete!${NC}"
echo ""
echo "Output:"
echo "  - $WASM_DIR/gastown-formula-wasm/pkg/"
echo "  - $WASM_DIR/ruvector-gnn-wasm/pkg/"
echo ""

# Show bundle sizes
if [[ "$BUILD_MODE" == "--release" ]]; then
    echo "Bundle sizes (release):"
    echo "  - gastown-formula-wasm: $(du -h "$WASM_DIR/gastown-formula-wasm/pkg/gastown_formula_wasm_bg.wasm" 2>/dev/null | cut -f1 || echo 'N/A')"
    echo "  - ruvector-gnn-wasm: $(du -h "$WASM_DIR/ruvector-gnn-wasm/pkg/ruvector_gnn_wasm_bg.wasm" 2>/dev/null | cut -f1 || echo 'N/A')"
fi
