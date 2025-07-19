#!/bin/bash

# CLI Test Results Reporter
# Generates comprehensive test results for GitHub issue

set -e

# Test execution and result collection
run_basic_tests() {
    echo "## 🧪 CLI Test Results Report"
    echo ""
    echo "**Date:** $(date)"
    echo "**Environment:** Docker Container"
    echo "**Node Version:** $(node --version)"
    echo "**NPM Version:** $(npm --version)"
    echo ""
    
    echo "### ✅ Successful Tests"
    echo ""
    
    # Test 1: Basic CLI functionality
    if timeout 10 node cli.js --help >/dev/null 2>&1; then
        echo "- ✅ CLI help command works"
    else
        echo "- ❌ CLI help command failed"
    fi
    
    # Test 2: Version command
    if timeout 10 node cli.js --version >/dev/null 2>&1; then
        echo "- ✅ CLI version command works ($(node cli.js --version))"
    else
        echo "- ❌ CLI version command failed"
    fi
    
    # Test 3: Commands available
    if timeout 10 node cli.js --help | grep -E 'init|start|agent|swarm' >/dev/null 2>&1; then
        echo "- ✅ Core commands available (init, start, agent, swarm)"
    else
        echo "- ❌ Core commands not found"
    fi
    
    # Test 4: Error handling
    if timeout 10 node cli.js invalid-command 2>&1 | grep -i error >/dev/null 2>&1; then
        echo "- ✅ Error handling works for invalid commands"
    else
        echo "- ❌ Error handling not working"
    fi
    
    # Test 5: Package structure
    if [ -f package.json ] && [ -f cli.js ]; then
        echo "- ✅ Package structure is valid"
    else
        echo "- ❌ Package structure invalid"
    fi
    
    # Test 6: Dependencies
    if [ -d node_modules ]; then
        echo "- ✅ Dependencies are installed"
    else
        echo "- ❌ Dependencies not installed"
    fi
    
    # Test 7: ruv-swarm integration
    if timeout 10 npx ruv-swarm --version >/dev/null 2>&1; then
        echo "- ✅ ruv-swarm integration works ($(npx ruv-swarm --version))"
    else
        echo "- ❌ ruv-swarm integration failed"
    fi
    
    # Test 8: Binary files
    if [ -f bin/gemini-flow ]; then
        echo "- ✅ Binary files exist in bin/"
    else
        echo "- ❌ Binary files missing"
    fi
    
    echo ""
    echo "### 📁 Package Information"
    echo ""
    echo "```json"
    node -e "
    const pkg = JSON.parse(require('fs').readFileSync('package.json', 'utf8'));
    console.log(JSON.stringify({
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        main: pkg.main,
        bin: pkg.bin,
        scripts: Object.keys(pkg.scripts || {}),
        dependencies: Object.keys(pkg.dependencies || {}),
        devDependencies: Object.keys(pkg.devDependencies || {})
    }, null, 2));
    "
    echo "```"
    
    echo ""
    echo "### 🔧 Command Help Output"
    echo ""
    echo "<details>"
    echo "<summary>CLI Help Output</summary>"
    echo ""
    echo "```"
    timeout 10 node cli.js --help
    echo "```"
    echo ""
    echo "</details>"
    
    echo ""
    echo "### 📊 Test Summary"
    echo ""
    
    # Count successful tests
    local total_tests=8
    local passed_tests=0
    
    timeout 10 node cli.js --help >/dev/null 2>&1 && ((passed_tests++))
    timeout 10 node cli.js --version >/dev/null 2>&1 && ((passed_tests++))
    timeout 10 node cli.js --help | grep -E 'init|start|agent|swarm' >/dev/null 2>&1 && ((passed_tests++))
    timeout 10 node cli.js invalid-command 2>&1 | grep -i error >/dev/null 2>&1 && ((passed_tests++))
    [ -f package.json ] && [ -f cli.js ] && ((passed_tests++))
    [ -d node_modules ] && ((passed_tests++))
    timeout 10 npx ruv-swarm --version >/dev/null 2>&1 && ((passed_tests++))
    [ -f bin/gemini-flow ] && ((passed_tests++))
    
    echo "- **Total Tests:** $total_tests"
    echo "- **Passed:** $passed_tests"
    echo "- **Failed:** $((total_tests - passed_tests))"
    echo "- **Success Rate:** $(( passed_tests * 100 / total_tests ))%"
    
    if [ $passed_tests -eq $total_tests ]; then
        echo "- **Overall Status:** ✅ All tests passed"
    else
        echo "- **Overall Status:** ⚠️ Some tests failed"
    fi
    
    echo ""
    echo "### 🐳 Docker Environment Details"
    echo ""
    echo "```bash"
    echo "# System Information"
    uname -a
    echo ""
    echo "# Docker Environment"
    if [ -f /.dockerenv ]; then
        echo "Running in Docker container"
    else
        echo "Not running in Docker"
    fi
    echo ""
    echo "# File Permissions"
    ls -la cli.js
    ls -la bin/gemini-flow 2>/dev/null || echo "bin/gemini-flow not found"
    echo "```"
    
    echo ""
    echo "### 🔗 Integration Status"
    echo ""
    
    # MCP integration
    if [ -f mcp_config/mcp.json ] || [ -f .claude/mcp.json ]; then
        echo "- ✅ MCP configuration found"
    else
        echo "- ❌ MCP configuration not found"
    fi
    
    # ruv-swarm hooks
    if command -v ruv-swarm >/dev/null 2>&1 || npx ruv-swarm --version >/dev/null 2>&1; then
        echo "- ✅ ruv-swarm CLI accessible"
    else
        echo "- ❌ ruv-swarm CLI not accessible"
    fi
    
    echo ""
    echo "---"
    echo ""
    echo "**Test completed at:** $(date)"
    echo "**Tester:** CLI Testing Agent"
    echo "**Task Force:** 3-agent integration testing"
}

# Store results in swarm memory and generate report
main() {
    echo "Generating CLI test results report..."
    
    # Store start in swarm memory
    npx ruv-swarm hook post-edit --file "test-cli/results-reporter.sh" --memory-key "swarm-1751574161255/results/start" 2>/dev/null || true
    
    # Generate report
    local report_file="test-cli/test-results-report.md"
    run_basic_tests > "$report_file"
    
    echo "Report generated: $report_file"
    
    # Display the report
    cat "$report_file"
    
    # Store completion in swarm memory
    npx ruv-swarm hook notification --message "CLI test results report generated" --telemetry true 2>/dev/null || true
    npx ruv-swarm hook post-task --task-id "cli-testing" --analyze-performance true 2>/dev/null || true
    
    echo ""
    echo "✅ Test results report generated successfully!"
    echo "📄 Report saved to: $report_file"
}

main "$@"