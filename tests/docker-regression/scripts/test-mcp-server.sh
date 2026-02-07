#!/bin/bash
# Claude-Flow MCP Server Test Suite
# Strict MCP connectivity and JSON-RPC behavior checks

set -euo pipefail

echo "=== MCP SERVER TEST SUITE ==="
echo ""

PASSED=0
FAILED=0
TOTAL=0

MCP_HOST="${MCP_SERVER_HOST:-localhost}"
MCP_PORT="${MCP_SERVER_PORT:-3000}"
MCP_URL="http://${MCP_HOST}:${MCP_PORT}"
RPC_URL="${MCP_URL}/rpc"
INVALID_MCP_URL="http://127.0.0.1:65530"

run_test() {
    local test_name="$1"
    local command="$2"

    TOTAL=$((TOTAL + 1))
    echo -n "  Testing: ${test_name}... "

    set +e
    output=$(eval "$command" 2>&1)
    exit_code=$?
    set -e

    if [ "$exit_code" -eq 0 ]; then
        echo "✓ PASSED"
        PASSED=$((PASSED + 1))
    else
        echo "✗ FAILED (exit: $exit_code)"
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

json_rpc() {
    local payload="$1"
    curl -fsS --max-time 5 \
      -H 'Content-Type: application/json' \
      -d "$payload" \
      "$RPC_URL"
}

# ============================================================================
# 1. SERVER CONNECTIVITY
# ============================================================================
echo "── Server Connectivity ──"

run_test "MCP port reachable" "nc -z ${MCP_HOST} ${MCP_PORT}"
run_test "Health endpoint returns ok" \
  "curl -fsS --max-time 5 ${MCP_URL}/health | node -e \"const r=JSON.parse(require('fs').readFileSync(0,'utf8')); if(r.status!=='ok') process.exit(1);\""

# ============================================================================
# 2. MCP JSON-RPC PROTOCOL
# ============================================================================
echo ""
echo "── MCP JSON-RPC ──"

run_test "initialize returns server info" \
  "json_rpc '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}' | node -e \"const r=JSON.parse(require('fs').readFileSync(0,'utf8')); if(r.error||!r.result||!r.result.serverInfo) process.exit(1);\""

run_test "tools/list returns non-empty tools array" \
  "json_rpc '{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}' | node -e \"const r=JSON.parse(require('fs').readFileSync(0,'utf8')); const tools=r.result&&r.result.tools; if(r.error||!Array.isArray(tools)||tools.length===0) process.exit(1);\""

run_test "tools/call hooks_list returns content" \
  "json_rpc '{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"hooks_list\",\"arguments\":{}}}' | node -e \"const r=JSON.parse(require('fs').readFileSync(0,'utf8')); const content=r.result&&r.result.content; if(r.error||!Array.isArray(content)||content.length===0) process.exit(1);\""

# ============================================================================
# 3. NEGATIVE CHECKS
# ============================================================================
echo ""
echo "── Negative Checks ──"

run_negative_test "Invalid MCP endpoint fails" "curl -fsS --max-time 3 ${INVALID_MCP_URL}/health >/dev/null"

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "=== MCP Server Summary ==="
echo "Total: $TOTAL | Passed: $PASSED | Failed: $FAILED"

if [ "$FAILED" -gt 0 ]; then
    exit 1
fi
exit 0
