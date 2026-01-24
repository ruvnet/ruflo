#!/bin/bash
# Gas Town Bridge - WASM Build Script (Ultra-Optimized)
#
# Builds all WASM modules with aggressive size optimization:
# - wasm-opt with -O4 -Oz for maximum size reduction
# - gzip precompression for instant serving
# - Detailed size reporting with targets
#
# Usage: ./scripts/build-wasm.sh [--release] [--opt-level 3|4]
#
# Targets:
# - Each WASM module: <50KB gzipped
# - Total WASM: <100KB gzipped

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
WASM_DIR="$PLUGIN_DIR/wasm"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Parse arguments
BUILD_MODE="--dev"
OPT_LEVEL="3"
SKIP_OPT=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --release)
            BUILD_MODE="--release"
            shift
            ;;
        --opt-level)
            OPT_LEVEL="$2"
            shift 2
            ;;
        --skip-opt)
            SKIP_OPT=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

echo -e "${GREEN}Gas Town Bridge - Ultra-Optimized WASM Build${NC}"
echo "=============================================="
echo ""

# Check for wasm-pack
if ! command -v wasm-pack &> /dev/null; then
    echo -e "${YELLOW}wasm-pack not found. Installing...${NC}"
    cargo install wasm-pack
fi

# Check for wasm-opt (binaryen)
WASM_OPT_AVAILABLE=false
if command -v wasm-opt &> /dev/null; then
    WASM_OPT_AVAILABLE=true
    echo -e "${GREEN}wasm-opt found: $(wasm-opt --version 2>&1 | head -1)${NC}"
else
    echo -e "${YELLOW}wasm-opt not found. Install binaryen for additional optimization.${NC}"
    echo -e "${YELLOW}  brew install binaryen  # macOS${NC}"
    echo -e "${YELLOW}  apt install binaryen   # Ubuntu/Debian${NC}"
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

echo ""
if [[ "$BUILD_MODE" == "--release" ]]; then
    echo -e "${GREEN}Build mode: RELEASE (optimized)${NC}"
    echo -e "${CYAN}Optimization level: O${OPT_LEVEL}${NC}"
else
    echo -e "${YELLOW}Build mode: DEVELOPMENT (use --release for production)${NC}"
fi
echo ""

# Function to get file size in bytes
get_size() {
    if [[ -f "$1" ]]; then
        stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || echo "0"
    else
        echo "0"
    fi
}

# Function to format size
format_size() {
    local bytes=$1
    if [[ $bytes -lt 1024 ]]; then
        echo "${bytes}B"
    elif [[ $bytes -lt 1048576 ]]; then
        echo "$(echo "scale=1; $bytes/1024" | bc)KB"
    else
        echo "$(echo "scale=2; $bytes/1048576" | bc)MB"
    fi
}

# Function to optimize WASM
optimize_wasm() {
    local wasm_file="$1"
    local output_file="$2"

    if [[ "$WASM_OPT_AVAILABLE" == "true" && "$SKIP_OPT" != "true" && "$BUILD_MODE" == "--release" ]]; then
        echo -e "  ${CYAN}Running wasm-opt -O${OPT_LEVEL} -Oz...${NC}"

        # -O4: Maximum optimization (slow but smallest)
        # -Oz: Optimize for size
        # --strip-debug: Remove debug info
        # --strip-dwarf: Remove DWARF debug info
        # --strip-producers: Remove producer section
        # --vacuum: Remove unused elements
        wasm-opt \
            -O${OPT_LEVEL} \
            -Oz \
            --strip-debug \
            --strip-dwarf \
            --strip-producers \
            --vacuum \
            --dce \
            --remove-unused-names \
            --remove-unused-module-elements \
            --optimize-instructions \
            --precompute \
            --precompute-propagate \
            --merge-locals \
            --reorder-locals \
            --coalesce-locals \
            --simplify-locals \
            --rse \
            --dae \
            "$wasm_file" -o "$output_file"

        return 0
    fi

    # No optimization, just copy
    cp "$wasm_file" "$output_file"
    return 0
}

# Function to build and optimize a WASM module
build_wasm_module() {
    local module_name="$1"
    local module_dir="$WASM_DIR/$module_name"
    local wasm_file="$module_dir/pkg/${module_name//-/_}_bg.wasm"
    local target_size=51200  # 50KB target

    echo -e "${GREEN}Building ${module_name}...${NC}"

    cd "$module_dir"

    # Build with wasm-pack
    RUSTFLAGS="-C opt-level=z -C lto=fat -C codegen-units=1 -C panic=abort" \
    wasm-pack build --target web $BUILD_MODE 2>&1 | sed 's/^/  /'

    if [[ ! -f "$wasm_file" ]]; then
        echo -e "${RED}  Error: WASM file not generated!${NC}"
        return 1
    fi

    # Get pre-optimization size
    local pre_size=$(get_size "$wasm_file")
    echo -e "  ${BLUE}Pre-optimization: $(format_size $pre_size)${NC}"

    # Optimize if in release mode
    if [[ "$BUILD_MODE" == "--release" ]]; then
        local optimized_file="$wasm_file.opt"
        optimize_wasm "$wasm_file" "$optimized_file"

        if [[ -f "$optimized_file" ]]; then
            mv "$optimized_file" "$wasm_file"
            local post_size=$(get_size "$wasm_file")
            local saved=$((pre_size - post_size))
            local pct=$(echo "scale=1; $saved * 100 / $pre_size" | bc)
            echo -e "  ${GREEN}Post-optimization: $(format_size $post_size) (saved ${pct}%)${NC}"
        fi
    fi

    # Gzip precompression
    echo -e "  ${CYAN}Creating gzip precompressed version...${NC}"
    gzip -9 -k -f "$wasm_file"
    local gz_size=$(get_size "${wasm_file}.gz")
    echo -e "  ${GREEN}Gzipped: $(format_size $gz_size)${NC}"

    # Check against target
    if [[ $gz_size -le $target_size ]]; then
        echo -e "  ${GREEN}Target met: $(format_size $gz_size) <= 50KB${NC}"
    else
        echo -e "  ${YELLOW}Warning: $(format_size $gz_size) exceeds 50KB target${NC}"
    fi

    echo ""
    return 0
}

# Build all modules
echo "=============================================="
echo ""

build_wasm_module "gastown-formula-wasm"
build_wasm_module "ruvector-gnn-wasm"

echo "=============================================="
echo -e "${GREEN}WASM build complete!${NC}"
echo ""

# Size report
echo -e "${CYAN}Bundle Size Report:${NC}"
echo "--------------------------------------------"

formula_wasm="$WASM_DIR/gastown-formula-wasm/pkg/gastown_formula_wasm_bg.wasm"
gnn_wasm="$WASM_DIR/ruvector-gnn-wasm/pkg/ruvector_gnn_wasm_bg.wasm"

formula_size=$(get_size "$formula_wasm")
formula_gz_size=$(get_size "${formula_wasm}.gz")
gnn_size=$(get_size "$gnn_wasm")
gnn_gz_size=$(get_size "${gnn_wasm}.gz")

total_size=$((formula_size + gnn_size))
total_gz_size=$((formula_gz_size + gnn_gz_size))

printf "%-30s %10s %10s\n" "Module" "Raw" "Gzipped"
printf "%-30s %10s %10s\n" "------------------------------" "----------" "----------"
printf "%-30s %10s %10s\n" "gastown-formula-wasm" "$(format_size $formula_size)" "$(format_size $formula_gz_size)"
printf "%-30s %10s %10s\n" "ruvector-gnn-wasm" "$(format_size $gnn_size)" "$(format_size $gnn_gz_size)"
printf "%-30s %10s %10s\n" "------------------------------" "----------" "----------"
printf "%-30s %10s %10s\n" "TOTAL" "$(format_size $total_size)" "$(format_size $total_gz_size)"
echo ""

# Target validation
echo -e "${CYAN}Target Validation:${NC}"
TARGET_WASM=102400  # 100KB total WASM target

if [[ $total_gz_size -le $TARGET_WASM ]]; then
    echo -e "  ${GREEN}PASS: Total WASM $(format_size $total_gz_size) <= 100KB target${NC}"
else
    echo -e "  ${RED}FAIL: Total WASM $(format_size $total_gz_size) > 100KB target${NC}"
fi

echo ""
echo "Output:"
echo "  - $WASM_DIR/gastown-formula-wasm/pkg/"
echo "  - $WASM_DIR/ruvector-gnn-wasm/pkg/"
echo ""
