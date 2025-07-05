#!/bin/bash

# Claude Flow Migration Test Runner
# Runs all migration tests and generates a comprehensive report

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test directories
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TEST_RESULTS_DIR="$SCRIPT_DIR/results"

# Create results directory
mkdir -p "$TEST_RESULTS_DIR"

# Function to run a test
run_test() {
    local test_name=$1
    local test_script=$2
    
    echo -e "\n${BLUE}Running $test_name...${NC}"
    
    if node "$test_script"; then
        echo -e "${GREEN}✓ $test_name passed${NC}"
        echo "PASS" > "$TEST_RESULTS_DIR/$test_name.status"
    else
        echo -e "${RED}✗ $test_name failed${NC}"
        echo "FAIL" > "$TEST_RESULTS_DIR/$test_name.status"
    fi
}

# Function to check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        echo -e "${RED}Node.js is not installed${NC}"
        exit 1
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}npm is not installed${NC}"
        exit 1
    fi
    
    # Check Docker (optional)
    if command -v docker &> /dev/null; then
        echo -e "${GREEN}✓ Docker is available${NC}"
        DOCKER_AVAILABLE=true
    else
        echo -e "${YELLOW}⚠ Docker is not available - skipping Docker tests${NC}"
        DOCKER_AVAILABLE=false
    fi
    
    echo -e "${GREEN}✓ Prerequisites check passed${NC}"
}

# Main test execution
main() {
    echo -e "${BLUE}Claude Flow Migration Test Suite${NC}"
    echo -e "${BLUE}================================${NC}"
    
    # Check prerequisites
    check_prerequisites
    
    # Record start time
    START_TIME=$(date +%s)
    
    # Run tests
    run_test "local-execution" "$SCRIPT_DIR/local/test-local-execution.js"
    run_test "remote-npx" "$SCRIPT_DIR/remote/test-remote-npx.js"
    
    if [ "$DOCKER_AVAILABLE" = true ]; then
        run_test "docker-execution" "$SCRIPT_DIR/docker/test-docker-execution.js"
    fi
    
    run_test "integration" "$SCRIPT_DIR/integration/test-integration.js"
    run_test "performance" "$SCRIPT_DIR/performance/test-performance.js"
    
    # Calculate duration
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    
    # Generate summary report
    echo -e "\n${BLUE}Test Summary${NC}"
    echo -e "${BLUE}============${NC}"
    
    TOTAL_TESTS=0
    PASSED_TESTS=0
    FAILED_TESTS=0
    
    for status_file in "$TEST_RESULTS_DIR"/*.status; do
        if [ -f "$status_file" ]; then
            TOTAL_TESTS=$((TOTAL_TESTS + 1))
            STATUS=$(cat "$status_file")
            TEST_NAME=$(basename "$status_file" .status)
            
            if [ "$STATUS" = "PASS" ]; then
                PASSED_TESTS=$((PASSED_TESTS + 1))
                echo -e "${GREEN}✓ $TEST_NAME${NC}"
            else
                FAILED_TESTS=$((FAILED_TESTS + 1))
                echo -e "${RED}✗ $TEST_NAME${NC}"
            fi
        fi
    done
    
    echo -e "\nTotal: $TOTAL_TESTS"
    echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
    echo -e "${RED}Failed: $FAILED_TESTS${NC}"
    echo -e "Duration: ${DURATION}s"
    
    # Generate JSON report
    cat > "$TEST_RESULTS_DIR/summary.json" <<EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "duration": $DURATION,
  "total": $TOTAL_TESTS,
  "passed": $PASSED_TESTS,
  "failed": $FAILED_TESTS,
  "dockerAvailable": $DOCKER_AVAILABLE
}
EOF
    
    echo -e "\n${BLUE}Results saved to: $TEST_RESULTS_DIR${NC}"
    
    # Exit with appropriate code
    if [ $FAILED_TESTS -gt 0 ]; then
        exit 1
    else
        exit 0
    fi
}

# Run main function
main "$@"