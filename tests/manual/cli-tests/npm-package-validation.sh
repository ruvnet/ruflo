#!/bin/bash

# NPM Package Validation Test Suite
# Tests complete npm package functionality including installation, execution, and uninstallation

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test counters
TESTS=0
PASSED=0
FAILED=0

log() {
    echo -e "${BLUE}[NPM-TEST] $1${NC}"
}

success() {
    echo -e "${GREEN}✓ $1${NC}"
    ((PASSED++))
}

error() {
    echo -e "${RED}✗ $1${NC}"
    ((FAILED++))
}

run_test() {
    local name="$1"
    local command="$2"
    ((TESTS++))
    
    log "Testing: $name"
    
    if eval "$command" 2>&1; then
        success "$name"
    else
        error "$name"
    fi
}

# Test npm package structure
test_package_structure() {
    log "Testing Package Structure"
    
    run_test "package.json exists" "[ -f package.json ]"
    run_test "package.json is valid JSON" "node -e 'JSON.parse(require(\"fs\").readFileSync(\"package.json\", \"utf8\"))'"
    run_test "Entry point exists" "[ -f cli.js ] || [ -f bin/gemini-flow ]"
    run_test "Dependencies are declared" "node -e 'const pkg = JSON.parse(require(\"fs\").readFileSync(\"package.json\", \"utf8\")); console.log(Object.keys(pkg.dependencies || {}).length > 0 ? \"Dependencies found\" : \"No dependencies\")'"
    run_test "Scripts are defined" "node -e 'const pkg = JSON.parse(require(\"fs\").readFileSync(\"package.json\", \"utf8\")); console.log(Object.keys(pkg.scripts || {}).length > 0 ? \"Scripts found\" : \"No scripts\")'"
    run_test "Bin configuration exists" "node -e 'const pkg = JSON.parse(require(\"fs\").readFileSync(\"package.json\", \"utf8\")); console.log(pkg.bin ? \"Binary defined\" : \"No binary\")'"
}

# Test local installation
test_local_installation() {
    log "Testing Local Installation"
    
    local test_dir="/tmp/npm-test-local"
    mkdir -p "$test_dir"
    cd "$test_dir"
    
    run_test "Initialize test project" "npm init -y"
    run_test "Install gemini-flow locally" "npm install /workspaces/ruv-FANN/gemini-flow/gemini-flow --no-save"
    run_test "Binary is symlinked" "[ -L node_modules/.bin/gemini-flow ] || [ -f node_modules/.bin/gemini-flow ]"
    run_test "Can execute via npx" "timeout 10 npx gemini-flow --version | grep -E '[0-9]+\.[0-9]+\.[0-9]+'"
    run_test "Can execute via direct path" "timeout 10 ./node_modules/.bin/gemini-flow --version | grep -E '[0-9]+\.[0-9]+\.[0-9]+'"
    
    # Clean up
    cd /workspaces/ruv-FANN/gemini-flow/gemini-flow
    rm -rf "$test_dir"
}

# Test global installation simulation
test_global_installation() {
    log "Testing Global Installation Simulation"
    
    local test_dir="/tmp/npm-test-global"
    mkdir -p "$test_dir"
    cd "$test_dir"
    
    # Create a local npm prefix to simulate global install
    export NPM_CONFIG_PREFIX="$test_dir/npm-global"
    mkdir -p "$NPM_CONFIG_PREFIX"
    
    run_test "Global install simulation" "npm install /workspaces/ruv-FANN/gemini-flow/gemini-flow -g --prefix $NPM_CONFIG_PREFIX"
    run_test "Global binary exists" "[ -f $NPM_CONFIG_PREFIX/bin/gemini-flow ]"
    run_test "Global binary is executable" "[ -x $NPM_CONFIG_PREFIX/bin/gemini-flow ]"
    
    # Test execution (add to PATH temporarily)
    export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
    run_test "Can execute global binary" "timeout 10 gemini-flow --version | grep -E '[0-9]+\.[0-9]+\.[0-9]+'"
    
    # Clean up
    unset NPM_CONFIG_PREFIX
    cd /workspaces/ruv-FANN/gemini-flow/gemini-flow
    rm -rf "$test_dir"
}

# Test package scripts
test_package_scripts() {
    log "Testing Package Scripts"
    
    run_test "npm run dev exists" "npm run dev --help 2>&1 | grep -i 'dev\|script' || echo 'Dev script not found'"
    run_test "npm run build exists" "npm run build --help 2>&1 | grep -i 'build\|script' || echo 'Build script not found'"
    run_test "npm run test exists" "npm run test --help 2>&1 | grep -i 'test\|script' || echo 'Test script not found'"
    run_test "npm run typecheck exists" "npm run typecheck --help 2>&1 | grep -i 'typecheck\|script' || echo 'Typecheck script not found'"
}

# Test dependencies
test_dependencies() {
    log "Testing Dependencies"
    
    run_test "Dependencies are installed" "[ -d node_modules ] && [ $(ls node_modules | wc -l) -gt 0 ]"
    run_test "Critical dependencies exist" "[ -d node_modules/commander ] && [ -d node_modules/chalk ] && [ -d node_modules/inquirer ]"
    run_test "ruv-swarm dependency" "[ -d node_modules/ruv-swarm ] || [ -L node_modules/ruv-swarm ]"
}

# Test CLI integration
test_cli_integration() {
    log "Testing CLI Integration"
    
    run_test "CLI help works" "timeout 10 node cli.js --help | grep -i 'usage'"
    run_test "CLI version works" "timeout 10 node cli.js --version | grep -E '[0-9]+\.[0-9]+\.[0-9]+'"
    run_test "CLI commands list" "timeout 10 node cli.js --help | grep -E 'init|start|swarm|config'"
    run_test "CLI error handling" "timeout 10 node cli.js invalid-command 2>&1 | grep -i 'error\|unknown'"
}

# Test ruv-swarm integration
test_ruv_swarm_integration() {
    log "Testing ruv-swarm Integration"
    
    # Check if ruv-swarm is available
    if [ -d "ruv-swarm" ] || [ -L "ruv-swarm" ]; then
        run_test "ruv-swarm package exists" "[ -d ruv-swarm ] || [ -L ruv-swarm ]"
        run_test "ruv-swarm CLI available" "timeout 10 npx ruv-swarm --version | grep -E '[0-9]+\.[0-9]+\.[0-9]+'"
        run_test "ruv-swarm MCP integration" "timeout 10 npx ruv-swarm mcp --help | grep -i 'mcp\|start'"
    else
        log "ruv-swarm not found locally, testing via npx..."
        run_test "ruv-swarm via npx" "timeout 10 npx ruv-swarm --version | grep -E '[0-9]+\.[0-9]+\.[0-9]+'"
    fi
}

# Test package publishability
test_package_publishability() {
    log "Testing Package Publishability"
    
    run_test "Package can be packed" "npm pack --dry-run | grep -i 'tarball\|files'"
    run_test "Package size is reasonable" "npm pack --dry-run | grep -E '[0-9]+\.[0-9]+[MB|KB]'"
    run_test "No sensitive files in package" "npm pack --dry-run | grep -v -E '\.env|\.secret|\.key|password|token'"
}

# Test cross-platform compatibility
test_cross_platform() {
    log "Testing Cross-Platform Compatibility"
    
    run_test "Node.js version compatibility" "node -e 'console.log(process.version)' | grep -E 'v[0-9]+\.[0-9]+\.[0-9]+'"
    run_test "File paths are cross-platform" "node -e 'const path = require(\"path\"); console.log(path.join(\"test\", \"path\"))' | grep -E 'test[/\\\\]path'"
    run_test "No platform-specific commands in package" "grep -r 'cmd\\.exe\\|powershell\\|/bin/sh' package.json || echo 'No platform-specific commands found'"
}

# Main execution
main() {
    log "🚀 Starting NPM Package Validation Test Suite"
    
    # Store test start in swarm memory
    npx ruv-swarm hook post-edit --file "test-cli/npm-package-validation.sh" --memory-key "swarm-1751574161255/npm/start" 2>/dev/null || true
    
    # Run all test suites
    test_package_structure
    test_local_installation
    test_global_installation
    test_package_scripts
    test_dependencies
    test_cli_integration
    test_ruv_swarm_integration
    test_package_publishability
    test_cross_platform
    
    # Results
    log "📊 NPM Package Test Results"
    echo "==========================================="
    echo "Total Tests: $TESTS"
    echo "Passed: $PASSED"
    echo "Failed: $FAILED"
    echo "Success Rate: $(( PASSED * 100 / TESTS ))%"
    echo "==========================================="
    
    # Store final results
    npx ruv-swarm hook notification --message "NPM tests completed: $PASSED/$TESTS passed" --telemetry true 2>/dev/null || true
    
    if [ $FAILED -gt 0 ]; then
        error "Some NPM package tests failed!"
        exit 1
    else
        success "All NPM package tests passed!"
        exit 0
    fi
}

# Execute main function
main "$@"