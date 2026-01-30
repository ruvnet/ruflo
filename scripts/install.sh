#!/usr/bin/env bash
#
# Claude Flow Installer
# https://github.com/ruvnet/claude-flow
#
# Usage:
#   curl -fsSL https://cdn.jsdelivr.net/gh/ruvnet/claude-flow@main/scripts/install.sh | bash
#   curl -fsSL https://cdn.jsdelivr.net/gh/ruvnet/claude-flow@main/scripts/install.sh | bash -s -- --global
#   curl -fsSL https://cdn.jsdelivr.net/gh/ruvnet/claude-flow@main/scripts/install.sh | bash -s -- --minimal
#
# Options (via arguments):
#   --global              Global install (npm install -g)
#   --minimal             Minimal install (no optional deps)
#   --version=X.X.X       Specific version
#
# Options (via environment - requires export):
#   export CLAUDE_FLOW_VERSION=3.0.0-alpha.183
#   export CLAUDE_FLOW_MINIMAL=1
#   export CLAUDE_FLOW_GLOBAL=1
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Default configuration (can be overridden by env vars)
VERSION="${CLAUDE_FLOW_VERSION:-alpha}"
MINIMAL="${CLAUDE_FLOW_MINIMAL:-0}"
GLOBAL="${CLAUDE_FLOW_GLOBAL:-0}"
SETUP_MCP="${CLAUDE_FLOW_SETUP_MCP:-0}"
RUN_DOCTOR="${CLAUDE_FLOW_DOCTOR:-0}"
RUN_INIT="${CLAUDE_FLOW_INIT:-1}"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --global|-g)
            GLOBAL="1"
            shift
            ;;
        --minimal|-m)
            MINIMAL="1"
            shift
            ;;
        --setup-mcp|--mcp)
            SETUP_MCP="1"
            shift
            ;;
        --doctor|-d)
            RUN_DOCTOR="1"
            shift
            ;;
        --init|-i)
            RUN_INIT="1"
            shift
            ;;
        --no-init)
            RUN_INIT="0"
            shift
            ;;
        --full|-f)
            GLOBAL="1"
            SETUP_MCP="1"
            RUN_DOCTOR="1"
            RUN_INIT="1"
            shift
            ;;
        --version=*)
            VERSION="${1#*=}"
            shift
            ;;
        --help|-h)
            echo "Claude Flow Installer"
            echo ""
            echo "Usage: curl -fsSL .../install.sh | bash -s -- [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --global, -g     Install globally (npm install -g)"
            echo "  --minimal, -m    Minimal install (skip optional deps)"
            echo "  --setup-mcp      Auto-configure MCP server for Claude Code"
            echo "  --doctor, -d     Run diagnostics after install"
            echo "  --no-init        Skip project initialization (enabled by default)"
            echo "  --full, -f       Full setup (global + mcp + doctor)"
            echo "  --version=X.X.X  Install specific version"
            echo "  --help, -h       Show this help"
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

PACKAGE="claude-flow@${VERSION}"

# Progress animation
SPINNER_CHARS="⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
SPINNER_INDEX=0

spinner() {
    printf "\r${CYAN}${SPINNER_CHARS:SPINNER_INDEX++:1}${NC} $1"
    SPINNER_INDEX=$((SPINNER_INDEX % 10))
}

print_banner() {
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}  ${BOLD}🌊 Claude Flow${NC} - Enterprise AI Agent Orchestration    ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_step() {
    echo -e "${GREEN}▸${NC} $1"
}

print_substep() {
    echo -e "  ${DIM}├─${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

check_requirements() {
    print_step "Checking requirements..."

    # Check Node.js
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | sed 's/v//')
        NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
        if [ "$NODE_MAJOR" -ge 20 ]; then
            print_substep "Node.js ${GREEN}v${NODE_VERSION}${NC} ✓"
        else
            print_error "Node.js 20+ required (found v${NODE_VERSION})"
            echo ""
            echo "Install Node.js 20+:"
            echo "  curl -fsSL https://fnm.vercel.app/install | bash"
            echo "  fnm install 20"
            exit 1
        fi
    else
        print_error "Node.js not found"
        echo ""
        echo "Install Node.js 20+:"
        echo "  curl -fsSL https://fnm.vercel.app/install | bash"
        echo "  fnm install 20"
        exit 1
    fi

    # Check npm
    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm -v)
        print_substep "npm ${GREEN}v${NPM_VERSION}${NC} ✓"
    else
        print_error "npm not found"
        exit 1
    fi

    # Check Claude Code CLI
    if command -v claude &> /dev/null; then
        CLAUDE_VERSION=$(claude --version 2>/dev/null | head -1 || echo "installed")
        print_substep "Claude Code ${GREEN}${CLAUDE_VERSION}${NC} ✓"
    else
        print_warning "Claude Code CLI not found"
        print_substep "Installing Claude Code CLI via npm..."
        if npm install -g @anthropic-ai/claude-code 2>/dev/null; then
            if command -v claude &> /dev/null; then
                CLAUDE_VERSION=$(claude --version 2>/dev/null | head -1 || echo "installed")
                print_substep "Claude Code ${GREEN}${CLAUDE_VERSION}${NC} ✓"
            else
                print_substep "Installed. Restart terminal to use 'claude' command"
            fi
        else
            print_warning "npm install failed. Try manually:"
            print_substep "${BOLD}npm install -g @anthropic-ai/claude-code${NC}"
        fi
    fi

    echo ""
}

show_install_options() {
    print_step "Installation options:"
    print_substep "Package: ${BOLD}${PACKAGE}${NC}"
    if [ "$GLOBAL" = "1" ]; then
        print_substep "Mode: ${BOLD}Global${NC} (npm install -g)"
    else
        print_substep "Mode: ${BOLD}npx${NC} (on-demand)"
    fi
    if [ "$MINIMAL" = "1" ]; then
        print_substep "Profile: ${BOLD}Minimal${NC} (--omit=optional)"
    else
        print_substep "Profile: ${BOLD}Full${NC} (all features)"
    fi
    echo ""
}

install_package() {
    local START_TIME=$(date +%s)

    if [ "$GLOBAL" = "1" ]; then
        print_step "Installing globally..."

        if [ "$MINIMAL" = "1" ]; then
            npm install -g "$PACKAGE" --omit=optional 2>&1 | while read -r line; do
                if [[ "$line" == *"added"* ]]; then
                    print_substep "$line"
                fi
            done
        else
            npm install -g "$PACKAGE" 2>&1 | while read -r line; do
                if [[ "$line" == *"added"* ]]; then
                    print_substep "$line"
                fi
            done
        fi
    else
        print_step "Installing for npx usage..."
        # Actually run npx to pre-install the package
        npx -y "$PACKAGE" --version >/dev/null 2>&1 || true
        print_substep "Package installed for npx"
    fi

    local END_TIME=$(date +%s)
    local DURATION=$((END_TIME - START_TIME))

    echo ""
    print_success "Installed in ${BOLD}${DURATION}s${NC}"
}

verify_installation() {
    print_step "Verifying installation..."

    local VERSION_OUTPUT
    if [ "$GLOBAL" = "1" ]; then
        VERSION_OUTPUT=$(claude-flow --version 2>/dev/null || echo "")
        if [ -z "$VERSION_OUTPUT" ]; then
            print_warning "Global command not found in PATH"
            print_substep "Try: ${BOLD}npm install -g claude-flow@${VERSION}${NC}"
            return 0  # Don't fail - npm might need PATH refresh
        fi
    else
        # For npx mode, package was already installed during install_package
        VERSION_OUTPUT=$(npx "$PACKAGE" --version 2>/dev/null || echo "")
    fi

    if [ -n "$VERSION_OUTPUT" ]; then
        print_substep "Version: ${GREEN}${VERSION_OUTPUT}${NC}"
        echo ""
        return 0
    else
        print_error "Installation verification failed"
        return 1
    fi
}

show_quickstart() {
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}  ${BOLD}🚀 Quick Start${NC}                                          ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    if [ "$GLOBAL" = "1" ]; then
        echo -e "  ${DIM}# Initialize project${NC}"
        echo -e "  ${BOLD}claude-flow init --wizard${NC}"
        echo ""
        echo -e "  ${DIM}# Run system diagnostics${NC}"
        echo -e "  ${BOLD}claude-flow doctor${NC}"
        echo ""
        echo -e "  ${DIM}# Add as MCP server to Claude Code${NC}"
        echo -e "  ${BOLD}claude mcp add claude-flow -- claude-flow mcp start${NC}"
    else
        echo -e "  ${DIM}# Initialize project${NC}"
        echo -e "  ${BOLD}npx claude-flow@alpha init --wizard${NC}"
        echo ""
        echo -e "  ${DIM}# Run system diagnostics${NC}"
        echo -e "  ${BOLD}npx claude-flow@alpha doctor${NC}"
        echo ""
        echo -e "  ${DIM}# Add as MCP server to Claude Code${NC}"
        echo -e "  ${BOLD}claude mcp add claude-flow -- npx -y claude-flow@alpha mcp start${NC}"
    fi

    echo ""
    echo -e "${DIM}Documentation: https://github.com/ruvnet/claude-flow${NC}"
    echo -e "${DIM}Issues: https://github.com/ruvnet/claude-flow/issues${NC}"
    echo ""
}

setup_mcp_server() {
    if [ "$SETUP_MCP" != "1" ]; then
        return 0
    fi

    print_step "Setting up MCP server..."

    if ! command -v claude &> /dev/null; then
        print_warning "Claude CLI not found, skipping MCP setup"
        return 0
    fi

    # Check if already configured
    if claude mcp list 2>/dev/null | grep -q "claude-flow"; then
        print_substep "MCP server already configured ✓"
        return 0
    fi

    # Add MCP server
    if [ "$GLOBAL" = "1" ]; then
        claude mcp add claude-flow -- claude-flow mcp start 2>/dev/null && \
            print_substep "MCP server configured ✓" || \
            print_warning "MCP setup failed - run manually: claude mcp add claude-flow -- claude-flow mcp start"
    else
        claude mcp add claude-flow -- npx -y claude-flow@${VERSION} mcp start 2>/dev/null && \
            print_substep "MCP server configured ✓" || \
            print_warning "MCP setup failed - run manually: claude mcp add claude-flow -- npx -y claude-flow@alpha mcp start"
    fi
    echo ""
}

run_doctor() {
    if [ "$RUN_DOCTOR" != "1" ]; then
        return 0
    fi

    print_step "Running diagnostics..."
    echo ""

    if [ "$GLOBAL" = "1" ]; then
        claude-flow doctor 2>&1 || true
    else
        npx claude-flow@${VERSION} doctor 2>&1 || true
    fi
    echo ""
}

run_init() {
    if [ "$RUN_INIT" != "1" ]; then
        return 0
    fi

    print_step "Initializing project..."
    echo ""

    if [ "$GLOBAL" = "1" ]; then
        claude-flow init --yes 2>&1 || true
    else
        npx claude-flow@${VERSION} init --yes 2>&1 || true
    fi
    echo ""
}

# Main
main() {
    print_banner
    check_requirements
    show_install_options
    install_package
    verify_installation
    setup_mcp_server
    run_doctor
    run_init
    show_quickstart

    print_success "${BOLD}Claude Flow is ready!${NC} 🎉"
    echo ""
}

main "$@"
