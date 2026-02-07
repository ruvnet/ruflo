#!/bin/bash
# Claude-Flow CLI Commands Test Suite
# Strict CLI command behavior checks

set -euo pipefail

echo "=== CLI COMMANDS TEST SUITE ==="
echo ""

PASSED=0
FAILED=0
TOTAL=0

run_test_contains() {
    local test_name="$1"
    local command="$2"
    local expected_pattern="$3"

    TOTAL=$((TOTAL + 1))
    echo -n "  Testing: ${test_name}... "

    set +e
    output=$(eval "$command" 2>&1)
    exit_code=$?
    set -e

    if [ "$exit_code" -eq 0 ] && echo "$output" | grep -Eq "$expected_pattern"; then
        echo "✓ PASSED"
        PASSED=$((PASSED + 1))
    else
        echo "✗ FAILED (exit: $exit_code, expected pattern: $expected_pattern)"
        echo "    Output: ${output:0:200}"
        FAILED=$((FAILED + 1))
    fi
}

run_negative_test() {
    local test_name="$1"
    local command="$2"

    TOTAL=$((TOTAL + 1))
    echo -n "  Testing: ${test_name}... "

    set +e
    output=$(eval "$command" 2>&1)
    exit_code=$?
    set -e

    if [ "$exit_code" -ne 0 ]; then
        echo "✓ PASSED"
        PASSED=$((PASSED + 1))
    else
        echo "✗ FAILED (expected non-zero exit)"
        echo "    Output: ${output:0:200}"
        FAILED=$((FAILED + 1))
    fi
}

# ============================================================================
# 1. BASIC CLI COMMANDS
# ============================================================================
echo "── Basic CLI Commands ──"

run_test_contains "Version check" "npx claude-flow --version" "claude-flow"
run_test_contains "Help command" "npx claude-flow --help" "USAGE:|COMMANDS:"

# ============================================================================
# 2. CORE COMMAND SURFACES (JSON MODE)
# ============================================================================
echo ""
echo "── Core Command Surfaces ──"

run_test_contains "MCP tools list" "npx claude-flow mcp tools --format json" "\\[|\\{"
run_test_contains "Hooks list" "npx claude-flow hooks list --format json" "hooks|total"
run_test_contains "Config show" "npx claude-flow config show --format json" "\\{|\\["

# ============================================================================
# 3. FAILURE INJECTION (MUST FAIL)
# ============================================================================
echo ""
echo "── Failure Injection ──"

run_negative_test "Invalid command exits non-zero" "npx claude-flow this-command-does-not-exist"
run_negative_test "Missing required pre-edit file exits non-zero" "npx claude-flow hooks pre-edit"

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "=== CLI Commands Summary ==="
echo "Total: $TOTAL | Passed: $PASSED | Failed: $FAILED"

if [ "$FAILED" -gt 0 ]; then
    exit 1
fi
exit 0
