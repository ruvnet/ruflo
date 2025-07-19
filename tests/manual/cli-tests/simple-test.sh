#!/bin/bash

# Simple CLI Test and Report Generator

echo "## 🧪 CLI Test Results Report"
echo ""
echo "**Date:** $(date)"
echo "**Environment:** Docker Container"
echo "**Node Version:** $(node --version)"
echo "**NPM Version:** $(npm --version)"
echo ""

# Store test start
npx ruv-swarm hook post-edit --file "test-cli/simple-test.sh" --memory-key "swarm-1751574161255/simple/start" 2>/dev/null || true

echo "### ✅ Test Results"
echo ""

# Test counters
TOTAL=0
PASSED=0

# Test function
test_command() {
    local name="$1"
    local cmd="$2"
    ((TOTAL++))
    
    if eval "$cmd" >/dev/null 2>&1; then
        echo "- ✅ $name"
        ((PASSED++))
    else
        echo "- ❌ $name"
    fi
}

# Run tests
test_command "CLI help command works" "timeout 10 node cli.js --help"
test_command "CLI version command works" "timeout 10 node cli.js --version"
test_command "Core commands available" "timeout 10 node cli.js --help | grep -E 'init|start|agent|swarm'"
test_command "Error handling works" "timeout 10 node cli.js invalid-command 2>&1 | grep -i error"
test_command "Package structure valid" "[ -f package.json ] && [ -f cli.js ]"
test_command "Dependencies installed" "[ -d node_modules ]"
test_command "ruv-swarm integration" "timeout 10 npx ruv-swarm --version"
test_command "Binary files exist" "[ -f bin/gemini-flow ]"

echo ""
echo "### 📊 Summary"
echo ""
echo "- **Total Tests:** $TOTAL"
echo "- **Passed:** $PASSED"
echo "- **Failed:** $((TOTAL - PASSED))"
echo "- **Success Rate:** $(( PASSED * 100 / TOTAL ))%"

if [ $PASSED -eq $TOTAL ]; then
    echo "- **Overall Status:** ✅ All tests passed"
    status="success"
else
    echo "- **Overall Status:** ⚠️ Some tests failed"
    status="partial"
fi

echo ""
echo "### 📋 Package Info"
echo ""
echo "**Name:** $(node -pe 'JSON.parse(require("fs").readFileSync("package.json")).name')"
echo "**Version:** $(node -pe 'JSON.parse(require("fs").readFileSync("package.json")).version')"
echo "**Main:** $(node -pe 'JSON.parse(require("fs").readFileSync("package.json")).main')"

echo ""
echo "### 🔧 CLI Help Sample"
echo ""
echo '```'
timeout 10 node cli.js --help | head -20
echo '```'

echo ""
echo "---"
echo "**Test completed:** $(date)"
echo "**Agent:** CLI Testing Agent"

# Store results in swarm memory
npx ruv-swarm hook notification --message "CLI tests completed: $PASSED/$TOTAL passed ($status)" --telemetry true 2>/dev/null || true
npx ruv-swarm hook post-task --task-id "cli-testing" --analyze-performance true 2>/dev/null || true

# Exit with appropriate code
if [ $PASSED -eq $TOTAL ]; then
    exit 0
else
    exit 1
fi