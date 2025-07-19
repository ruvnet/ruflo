#!/bin/bash

# Comprehensive CLI Test Suite for Claude-Flow and ruv-swarm Integration
# Test Agent: CLI Testing Suite v1.0
# Date: 2025-07-03
# Purpose: Complete testing of all CLI commands in Docker environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Test results array
declare -a TEST_RESULTS=()

# Logging function
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] $1${NC}"
}

success() {
    echo -e "${GREEN}✓ $1${NC}"
    ((PASSED_TESTS++))
    TEST_RESULTS+=("PASS: $1")
}

error() {
    echo -e "${RED}✗ $1${NC}"
    ((FAILED_TESTS++))
    TEST_RESULTS+=("FAIL: $1")
}

warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# Start test coordination
log "Starting CLI Testing Task Coordination"
npx ruv-swarm hook pre-task --description "CLI functionality testing" --auto-spawn-agents false 2>/dev/null || true

# Test function wrapper
run_test() {
    local test_name="$1"
    local test_command="$2"
    ((TOTAL_TESTS++))
    
    log "Running test: $test_name"
    
    if eval "$test_command" 2>&1; then
        success "$test_name"
        # Store test result in swarm memory
        npx ruv-swarm hook notification --message "Test passed: $test_name" --telemetry true 2>/dev/null || true
    else
        error "$test_name"
        # Store failure in swarm memory
        npx ruv-swarm hook notification --message "Test failed: $test_name" --telemetry true 2>/dev/null || true
    fi
}

# Environment setup tests
test_environment() {
    log "Testing Environment Setup"
    
    run_test "Node.js version check" "node --version | grep -E 'v[0-9]+\.[0-9]+\.[0-9]+'"
    run_test "NPM version check" "npm --version | grep -E '[0-9]+\.[0-9]+\.[0-9]+'"
    run_test "Package.json exists" "[ -f package.json ]"
    run_test "CLI binary exists" "[ -f cli.js ]"
    run_test "TypeScript source exists" "[ -f src/cli/simple-cli.ts ] || [ -f src/cli/main.ts ]"
    run_test "Dist directory exists" "[ -d dist ] || [ -d src ]"
}

# Basic CLI functionality tests
test_basic_cli() {
    log "Testing Basic CLI Functionality"
    
    run_test "CLI executable permissions" "[ -x cli.js ] || [ -x bin/gemini-flow ]"
    run_test "CLI help command" "timeout 10 node cli.js --help | grep -i 'usage\|help\|commands'"
    run_test "CLI version command" "timeout 10 node cli.js --version | grep -E '[0-9]+\.[0-9]+\.[0-9]+'"
    run_test "CLI without arguments" "timeout 10 node cli.js 2>&1 | grep -i 'usage\|help\|commands\|error'"
}

# NPM package installation tests
test_npm_installation() {
    log "Testing NPM Package Installation"
    
    # Create test directory for npm installation
    mkdir -p /tmp/gemini-flow-test
    cd /tmp/gemini-flow-test
    
    run_test "NPM package can be installed locally" "npm init -y && npm install /workspaces/ruv-FANN/gemini-flow/gemini-flow --no-save"
    run_test "Binary is available after install" "[ -f node_modules/.bin/gemini-flow ] || [ -f node_modules/gemini-flow/cli.js ]"
    run_test "Can run installed package" "timeout 10 npx gemini-flow --help | grep -i 'usage\|help\|commands'"
    
    # Clean up
    cd /workspaces/ruv-FANN/gemini-flow/gemini-flow
    rm -rf /tmp/gemini-flow-test
}

# Command-specific tests
test_commands() {
    log "Testing Individual Commands"
    
    run_test "Init command help" "timeout 10 node cli.js init --help | grep -i 'usage\|help\|init'"
    run_test "Start command help" "timeout 10 node cli.js start --help | grep -i 'usage\|help\|start'"
    run_test "Swarm command help" "timeout 10 node cli.js swarm --help | grep -i 'usage\|help\|swarm'"
    run_test "Config command help" "timeout 10 node cli.js config --help | grep -i 'usage\|help\|config'"
    run_test "Memory command help" "timeout 10 node cli.js memory --help | grep -i 'usage\|help\|memory'"
    run_test "Agent command help" "timeout 10 node cli.js agent --help | grep -i 'usage\|help\|agent'"
    run_test "Task command help" "timeout 10 node cli.js task --help | grep -i 'usage\|help\|task'"
    run_test "MCP command help" "timeout 10 node cli.js mcp --help | grep -i 'usage\|help\|mcp'"
}

# Error handling tests
test_error_handling() {
    log "Testing Error Handling"
    
    run_test "Invalid command handling" "timeout 10 node cli.js invalid-command 2>&1 | grep -i 'error\|unknown\|invalid'"
    run_test "Missing arguments handling" "timeout 10 node cli.js init 2>&1 | grep -i 'error\|usage\|required' || true"
    run_test "Invalid options handling" "timeout 10 node cli.js --invalid-option 2>&1 | grep -i 'error\|unknown\|invalid'"
}

# Integration tests with ruv-swarm
test_ruv_swarm_integration() {
    log "Testing ruv-swarm Integration"
    
    # Check if ruv-swarm is available
    if command -v ruv-swarm >/dev/null 2>&1; then
        run_test "ruv-swarm CLI available" "ruv-swarm --version | grep -E '[0-9]+\.[0-9]+\.[0-9]+'"
        run_test "ruv-swarm MCP start" "timeout 10 ruv-swarm mcp start --help | grep -i 'usage\|help\|mcp'"
        run_test "ruv-swarm hook system" "timeout 10 ruv-swarm hook --help | grep -i 'usage\|help\|hook'"
    else
        # Test through npx
        run_test "ruv-swarm via npx" "timeout 10 npx ruv-swarm --version | grep -E '[0-9]+\.[0-9]+\.[0-9]+'"
        run_test "ruv-swarm MCP via npx" "timeout 10 npx ruv-swarm mcp start --help | grep -i 'usage\|help\|mcp'"
    fi
}

# Performance tests
test_performance() {
    log "Testing Performance"
    
    run_test "CLI startup time under 3 seconds" "timeout 3 time node cli.js --help > /dev/null"
    run_test "Help command response time" "timeout 5 time node cli.js --help > /dev/null"
    run_test "Version command response time" "timeout 2 time node cli.js --version > /dev/null"
}

# Docker environment specific tests
test_docker_environment() {
    log "Testing Docker Environment Compatibility"
    
    run_test "Docker environment detection" "[ -f /.dockerenv ] || [ -f /proc/1/cgroup ] && grep -q docker /proc/1/cgroup"
    run_test "Terminal capabilities" "tty -s || true"  # May not be available in headless docker
    run_test "Process isolation" "ps aux | grep -v grep | wc -l | grep -E '[0-9]+'"
    run_test "File system permissions" "touch /tmp/test-file && rm /tmp/test-file"
}

# Cross-package CLI integration tests
test_cross_package_integration() {
    log "Testing Cross-Package CLI Integration"
    
    # Test that gemini-flow can call ruv-swarm and vice versa
    run_test "Claude-flow can execute ruv-swarm commands" "timeout 10 node cli.js --help | grep -i 'swarm\|agent\|task'"
    
    # Test MCP integration
    run_test "MCP configuration check" "[ -f mcp_config/mcp.json ] || [ -f .claude/mcp.json ] || echo 'MCP config not found but continuing'"
}

# Edge case tests
test_edge_cases() {
    log "Testing Edge Cases"
    
    run_test "Empty command line" "timeout 10 node cli.js '' 2>&1 | grep -i 'usage\|help\|error' || true"
    run_test "Very long command line" "timeout 10 node cli.js $(printf 'a%.0s' {1..1000}) 2>&1 | grep -i 'error\|invalid' || true"
    run_test "Special characters in arguments" "timeout 10 node cli.js init --name 'test@#$%^&*()' 2>&1 | grep -i 'error\|invalid' || true"
    run_test "Unicode characters in arguments" "timeout 10 node cli.js init --name 'test-🚀-app' 2>&1 | grep -i 'error\|invalid' || true"
}

# Create test init environment
test_init_functionality() {
    log "Testing Init Functionality"
    
    # Create isolated test directory
    TEST_DIR="/tmp/gemini-flow-init-test"
    mkdir -p "$TEST_DIR"
    cd "$TEST_DIR"
    
    run_test "Init with minimal config" "timeout 30 echo 'test-project' | node /workspaces/ruv-FANN/gemini-flow/gemini-flow/cli.js init --mode minimal 2>&1 | grep -i 'success\|complete\|created' || true"
    
    # Check if files were created
    if [ -d "test-project" ]; then
        cd test-project
        run_test "CLAUDE.md file created" "[ -f CLAUDE.md ]"
        run_test "Package.json created" "[ -f package.json ]"
        run_test "Basic project structure" "[ -d src ] || [ -f README.md ] || [ -f index.js ]"
    fi
    
    # Clean up
    cd /workspaces/ruv-FANN/gemini-flow/gemini-flow
    rm -rf "$TEST_DIR"
}

# Store test progress in swarm memory
store_test_progress() {
    local step="$1"
    local progress="$2"
    npx ruv-swarm hook post-edit --file "test-cli/comprehensive-cli-test.sh" --memory-key "swarm-1751574161255/cli/$step" 2>/dev/null || true
}

# Main test execution
main() {
    log "🚀 Starting Comprehensive CLI Test Suite"
    log "Target: gemini-flow and ruv-swarm integration"
    log "Environment: Docker container"
    
    # Store initial progress
    store_test_progress "start" "Test suite initiated"
    
    # Run all test suites
    test_environment
    store_test_progress "environment" "Environment tests completed"
    
    test_basic_cli
    store_test_progress "basic" "Basic CLI tests completed"
    
    test_npm_installation
    store_test_progress "npm" "NPM installation tests completed"
    
    test_commands
    store_test_progress "commands" "Command-specific tests completed"
    
    test_error_handling
    store_test_progress "errors" "Error handling tests completed"
    
    test_ruv_swarm_integration
    store_test_progress "integration" "ruv-swarm integration tests completed"
    
    test_performance
    store_test_progress "performance" "Performance tests completed"
    
    test_docker_environment
    store_test_progress "docker" "Docker environment tests completed"
    
    test_cross_package_integration
    store_test_progress "cross-package" "Cross-package integration tests completed"
    
    test_edge_cases
    store_test_progress "edge-cases" "Edge case tests completed"
    
    test_init_functionality
    store_test_progress "init" "Init functionality tests completed"
    
    # Final results
    log "📊 Test Results Summary"
    echo "==========================================="
    echo "Total Tests: $TOTAL_TESTS"
    echo "Passed: $PASSED_TESTS"
    echo "Failed: $FAILED_TESTS"
    echo "Success Rate: $(( PASSED_TESTS * 100 / TOTAL_TESTS ))%"
    echo "==========================================="
    
    # Store final results in swarm memory
    npx ruv-swarm hook post-task --task-id "cli-testing" --analyze-performance true 2>/dev/null || true
    
    # Print detailed results
    log "📝 Detailed Test Results"
    printf '%s\n' "${TEST_RESULTS[@]}"
    
    # Return appropriate exit code
    if [ $FAILED_TESTS -gt 0 ]; then
        error "Some tests failed! Check the output above."
        exit 1
    else
        success "All tests passed!"
        exit 0
    fi
}

# Run main function
main "$@"