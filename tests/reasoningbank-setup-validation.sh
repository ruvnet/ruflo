#!/bin/bash
# ReasoningBank Setup Commands Validation Test Suite
# Purpose: Validate all ReasoningBank setup instructions work end-to-end
# Version: 1.0.0
# Last Updated: 2025-10-31

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results tracking
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Logging functions
log_test() {
    echo -e "\n${YELLOW}[TEST $((TESTS_TOTAL + 1))]${NC} $1"
    ((TESTS_TOTAL++))
}

log_success() {
    echo -e "${GREEN}✅ PASS:${NC} $1"
    ((TESTS_PASSED++))
}

log_failure() {
    echo -e "${RED}❌ FAIL:${NC} $1"
    ((TESTS_FAILED++))
}

log_info() {
    echo -e "${YELLOW}ℹ️  INFO:${NC} $1"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up test artifacts..."
    rm -f backend-expert.json frontend-expert.json full-stack.json
    rm -f test-memory-export.json
}

trap cleanup EXIT

# Test 1: Verify claude-flow installation
log_test "Verify claude-flow installation and version"
VERSION_OUTPUT=$(npx claude-flow@alpha --version 2>&1 || echo "not found")
if echo "$VERSION_OUTPUT" | grep -q -E '(v[0-9]+\.[0-9]+|[0-9]+\.[0-9]+)'; then
    VERSION=$(echo "$VERSION_OUTPUT" | grep -oE '(v[0-9]+\.[0-9]+\.[0-9]+|[0-9]+\.[0-9]+\.[0-9]+)' | head -1)
    log_success "claude-flow is installed: $VERSION"
else
    log_failure "claude-flow@alpha is not accessible via npx"
    log_info "Output: $VERSION_OUTPUT"
fi

# Test 2: Test memory command help output
log_test "Verify memory command help includes ReasoningBank options"
HELP_OUTPUT=$(npx claude-flow@alpha memory --help 2>&1 || true)
if echo "$HELP_OUTPUT" | grep -q "reasoningbank"; then
    log_success "Memory command includes --reasoningbank flag"
else
    log_failure "Memory command help missing ReasoningBank documentation"
fi

# Test 3: Test memory detect command
log_test "Verify memory detect shows available modes"
DETECT_OUTPUT=$(npx claude-flow@alpha memory detect 2>&1 || true)
if echo "$DETECT_OUTPUT" | grep -q -E "(ReasoningBank|Basic|AUTO)"; then
    log_success "Memory detect shows available storage modes"
    log_info "Available modes: $(echo "$DETECT_OUTPUT" | grep -oE '(ReasoningBank|Basic|AUTO Mode)')"
else
    log_failure "Memory detect command not showing modes correctly"
fi

# Test 4: Test memory mode command
log_test "Verify memory mode shows current configuration"
MODE_OUTPUT=$(npx claude-flow@alpha memory mode 2>&1 || true)
if echo "$MODE_OUTPUT" | grep -q -E "(Current|Mode|Configuration)"; then
    log_success "Memory mode command shows configuration"
else
    log_failure "Memory mode command not working"
fi

# Test 5: Test memory init --reasoningbank
log_test "Test ReasoningBank initialization command"
INIT_OUTPUT=$(npx claude-flow@alpha memory init --reasoningbank 2>&1 || true)
if echo "$INIT_OUTPUT" | grep -q -E "(initialized|success|complete)"; then
    log_success "ReasoningBank initialization completed"

    # Verify database was created
    if [ -f ".swarm/memory.db" ]; then
        log_success "SQLite database created at .swarm/memory.db"
        DB_SIZE=$(du -h .swarm/memory.db | cut -f1)
        log_info "Database size: $DB_SIZE"
    else
        log_failure "Database file not created at .swarm/memory.db"
    fi
else
    log_failure "ReasoningBank initialization failed"
fi

# Test 6: Test memory status --reasoningbank
log_test "Verify memory status command shows ReasoningBank statistics"
STATUS_OUTPUT=$(npx claude-flow@alpha memory status --reasoningbank 2>&1 || true)
if echo "$STATUS_OUTPUT" | grep -q -E "(Total memories|Database|confidence)"; then
    log_success "Memory status command working"
    log_info "Status output includes: $(echo "$STATUS_OUTPUT" | grep -oE 'Total memories: [0-9]+')"
else
    log_failure "Memory status command not showing correct information"
fi

# Test 7: Test basic memory store operation
log_test "Test storing a pattern in ReasoningBank"
STORE_OUTPUT=$(npx claude-flow@alpha memory store test_pattern "This is a test pattern for validation" --namespace testing --reasoningbank 2>&1 || true)
if echo "$STORE_OUTPUT" | grep -q -E "(stored|success|Confidence)"; then
    log_success "Pattern stored successfully"
else
    log_failure "Failed to store pattern in ReasoningBank"
fi

# Test 8: Test semantic query
log_test "Test semantic query retrieval"
QUERY_OUTPUT=$(npx claude-flow@alpha memory query "test pattern" --reasoningbank 2>&1 || true)
if echo "$QUERY_OUTPUT" | grep -q -E "(test_pattern|Found|result)"; then
    log_success "Semantic query retrieved stored pattern"
else
    log_failure "Semantic query failed to retrieve pattern"
fi

# Test 9: Test memory stats command
log_test "Verify memory stats command"
STATS_OUTPUT=$(npx claude-flow@alpha memory stats 2>&1 || true)
if echo "$STATS_OUTPUT" | grep -q -E "(memories|patterns|namespaces)"; then
    log_success "Memory stats command working"
else
    log_failure "Memory stats command failed"
fi

# Test 10: Test memory export functionality
log_test "Test memory export command"
EXPORT_OUTPUT=$(npx claude-flow@alpha memory export test-memory-export.json 2>&1 || true)
if [ -f "test-memory-export.json" ]; then
    log_success "Memory export created file successfully"
    EXPORT_SIZE=$(wc -c < test-memory-export.json)
    log_info "Export file size: $EXPORT_SIZE bytes"

    # Verify JSON is valid
    if python3 -m json.tool test-memory-export.json >/dev/null 2>&1; then
        log_success "Exported JSON is valid"
    else
        log_failure "Exported JSON is invalid"
    fi
else
    log_failure "Memory export failed to create file"
fi

# Test 11: Test memory import syntax (documented commands)
log_test "Test documented memory import command syntax"
# The correct syntax based on the help output
IMPORT_TEST=$(npx claude-flow@alpha memory import test-memory-export.json --reasoningbank 2>&1 || true)
if echo "$IMPORT_TEST" | grep -q -E "(imported|success|complete|memories)"; then
    log_success "Memory import command syntax is correct"
else
    log_failure "Memory import command syntax failed"
    log_info "Command tested: npx claude-flow@alpha memory import test-memory-export.json --reasoningbank"
fi

# Test 12: Verify model download URLs are accessible
log_test "Verify pre-trained model URLs are accessible"
BACKEND_URL="https://raw.githubusercontent.com/ruvnet/claude-flow/main/docs/reasoningbank/models/backend-expert.json"
if curl -f -s -I "$BACKEND_URL" >/dev/null 2>&1; then
    log_success "Backend expert model URL is accessible"
else
    log_failure "Backend expert model URL returns 404 or is inaccessible"
    log_info "URL: $BACKEND_URL"
fi

FRONTEND_URL="https://raw.githubusercontent.com/ruvnet/claude-flow/main/docs/reasoningbank/models/frontend-expert.json"
if curl -f -s -I "$FRONTEND_URL" >/dev/null 2>&1; then
    log_success "Frontend expert model URL is accessible"
else
    log_failure "Frontend expert model URL returns 404 or is inaccessible"
    log_info "URL: $FRONTEND_URL"
fi

FULLSTACK_URL="https://raw.githubusercontent.com/ruvnet/claude-flow/main/docs/reasoningbank/models/full-stack-complete.json"
if curl -f -s -I "$FULLSTACK_URL" >/dev/null 2>&1; then
    log_success "Full-stack model URL is accessible"
else
    log_failure "Full-stack model URL returns 404 or is inaccessible"
    log_info "URL: $FULLSTACK_URL"
fi

# Test 13: Test model download (small file for speed)
log_test "Test downloading a pre-trained model"
if curl -f -s -o backend-expert.json "$BACKEND_URL" 2>&1; then
    if [ -f "backend-expert.json" ] && [ -s "backend-expert.json" ]; then
        log_success "Model download completed"
        FILE_SIZE=$(du -h backend-expert.json | cut -f1)
        log_info "Downloaded model size: $FILE_SIZE"

        # Verify JSON validity
        if python3 -m json.tool backend-expert.json >/dev/null 2>&1; then
            log_success "Downloaded model is valid JSON"
        else
            log_failure "Downloaded model is invalid JSON"
        fi
    else
        log_failure "Model file empty or not created"
    fi
else
    log_failure "Model download failed"
fi

# Test 14: Verify namespace operations
log_test "Test namespace management commands"
NAMESPACE_LIST=$(npx claude-flow@alpha memory list 2>&1 || true)
if echo "$NAMESPACE_LIST" | grep -q -E "(testing|namespace)"; then
    log_success "Namespace list command working"
else
    log_failure "Namespace list command failed"
fi

# Test 15: Test confidence threshold filtering
log_test "Test confidence-based query filtering"
CONFIDENCE_QUERY=$(npx claude-flow@alpha memory query "*" --min-confidence 0.5 --reasoningbank 2>&1 || true)
if echo "$CONFIDENCE_QUERY" | grep -q -E "(confidence|Found|result)"; then
    log_success "Confidence filtering works"
else
    log_failure "Confidence filtering not working"
fi

# Test Summary
echo -e "\n${YELLOW}═══════════════════════════════════════════${NC}"
echo -e "${YELLOW}         TEST SUMMARY${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════${NC}"
echo -e "Total tests run:    ${TESTS_TOTAL}"
echo -e "${GREEN}Tests passed:       ${TESTS_PASSED}${NC}"
echo -e "${RED}Tests failed:       ${TESTS_FAILED}${NC}"
echo -e "Pass rate:          $(awk "BEGIN {printf \"%.1f\", ($TESTS_PASSED/$TESTS_TOTAL)*100}")%"
echo -e "${YELLOW}═══════════════════════════════════════════${NC}\n"

# Exit with failure if any tests failed
if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "${RED}❌ Some tests failed. Please review the output above.${NC}"
    exit 1
else
    echo -e "${GREEN}✅ All tests passed successfully!${NC}"
    exit 0
fi
