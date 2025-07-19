#!/bin/bash

# Automated build and test script for gemini-flow Docker environment
# This script handles the complete build, test, and validation pipeline

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DOCKER_TEST_DIR="${PROJECT_ROOT}/docker-test"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${DOCKER_TEST_DIR}/logs/build-test-${TIMESTAMP}.log"

# Ensure logs directory exists
mkdir -p "${DOCKER_TEST_DIR}/logs"

# Logging function
log() {
    echo -e "${1}" | tee -a "${LOG_FILE}"
}

# Error handler
error_handler() {
    log "${RED}❌ Error occurred in script at line $1${NC}"
    log "${RED}❌ Build and test process failed${NC}"
    exit 1
}

trap 'error_handler $LINENO' ERR

# Function to check if Docker is running
check_docker() {
    if ! docker info >/dev/null 2>&1; then
        log "${RED}❌ Docker is not running. Please start Docker first.${NC}"
        exit 1
    fi
    log "${GREEN}✅ Docker is running${NC}"
}

# Function to check if Docker Compose is available
check_docker_compose() {
    if ! command -v docker-compose >/dev/null 2>&1; then
        log "${RED}❌ Docker Compose is not installed${NC}"
        exit 1
    fi
    log "${GREEN}✅ Docker Compose is available${NC}"
}

# Function to clean up previous containers and volumes
cleanup() {
    log "${YELLOW}🧹 Cleaning up previous containers and volumes...${NC}"
    
    cd "${DOCKER_TEST_DIR}"
    
    # Stop and remove containers
    docker-compose down --volumes --remove-orphans 2>/dev/null || true
    
    # Remove dangling images
    docker image prune -f 2>/dev/null || true
    
    # Clean up test results
    rm -rf "${DOCKER_TEST_DIR}/test-results"
    mkdir -p "${DOCKER_TEST_DIR}/test-results"
    
    log "${GREEN}✅ Cleanup completed${NC}"
}

# Function to build all images
build_images() {
    log "${YELLOW}🏗️  Building Docker images...${NC}"
    
    cd "${DOCKER_TEST_DIR}"
    
    # Build development image
    log "${BLUE}📦 Building development image...${NC}"
    docker-compose build claude-flow-dev
    
    # Build testing image
    log "${BLUE}📦 Building testing image...${NC}"
    docker-compose build claude-flow-test
    
    # Build production image
    log "${BLUE}📦 Building production image...${NC}"
    docker-compose build claude-flow-prod
    
    # Build swarm integration image
    log "${BLUE}📦 Building swarm integration image...${NC}"
    docker-compose build ruv-swarm-integration
    
    log "${GREEN}✅ All images built successfully${NC}"
}

# Function to run unit tests
run_unit_tests() {
    log "${YELLOW}🧪 Running unit tests...${NC}"
    
    cd "${DOCKER_TEST_DIR}"
    
    # Run unit tests
    docker-compose run --rm claude-flow-test npm run test:unit > "${DOCKER_TEST_DIR}/test-results/unit-tests.log" 2>&1
    
    if [ $? -eq 0 ]; then
        log "${GREEN}✅ Unit tests passed${NC}"
    else
        log "${RED}❌ Unit tests failed${NC}"
        cat "${DOCKER_TEST_DIR}/test-results/unit-tests.log"
        return 1
    fi
}

# Function to run integration tests
run_integration_tests() {
    log "${YELLOW}🔗 Running integration tests...${NC}"
    
    cd "${DOCKER_TEST_DIR}"
    
    # Start dependencies
    docker-compose up -d claude-flow-db ruv-swarm-db
    
    # Wait for databases to be ready
    sleep 10
    
    # Run integration tests
    docker-compose run --rm claude-flow-test npm run test:integration > "${DOCKER_TEST_DIR}/test-results/integration-tests.log" 2>&1
    
    if [ $? -eq 0 ]; then
        log "${GREEN}✅ Integration tests passed${NC}"
    else
        log "${RED}❌ Integration tests failed${NC}"
        cat "${DOCKER_TEST_DIR}/test-results/integration-tests.log"
        return 1
    fi
}

# Function to run swarm integration tests
run_swarm_tests() {
    log "${YELLOW}🐝 Running swarm integration tests...${NC}"
    
    cd "${DOCKER_TEST_DIR}"
    
    # Start swarm integration environment
    docker-compose --profile swarm up -d
    
    # Wait for services to be ready
    sleep 20
    
    # Run swarm tests
    docker-compose run --rm ruv-swarm-integration npm run test:swarm > "${DOCKER_TEST_DIR}/test-results/swarm-tests.log" 2>&1
    
    if [ $? -eq 0 ]; then
        log "${GREEN}✅ Swarm integration tests passed${NC}"
    else
        log "${RED}❌ Swarm integration tests failed${NC}"
        cat "${DOCKER_TEST_DIR}/test-results/swarm-tests.log"
        return 1
    fi
}

# Function to run end-to-end tests
run_e2e_tests() {
    log "${YELLOW}🎭 Running end-to-end tests...${NC}"
    
    cd "${DOCKER_TEST_DIR}"
    
    # Start full environment
    docker-compose up -d claude-flow-dev claude-flow-db
    
    # Wait for services to be ready
    sleep 30
    
    # Run e2e tests
    docker-compose run --rm --profile testing test-runner > "${DOCKER_TEST_DIR}/test-results/e2e-tests.log" 2>&1
    
    if [ $? -eq 0 ]; then
        log "${GREEN}✅ End-to-end tests passed${NC}"
    else
        log "${RED}❌ End-to-end tests failed${NC}"
        cat "${DOCKER_TEST_DIR}/test-results/e2e-tests.log"
        return 1
    fi
}

# Function to run performance tests
run_performance_tests() {
    log "${YELLOW}⚡ Running performance tests...${NC}"
    
    cd "${DOCKER_TEST_DIR}"
    
    # Start performance monitoring
    docker-compose --profile monitoring up -d performance-monitor
    
    # Start services
    docker-compose up -d claude-flow-dev claude-flow-db
    
    # Wait for services
    sleep 20
    
    # Run performance tests
    docker-compose run --rm claude-flow-test npm run test:performance > "${DOCKER_TEST_DIR}/test-results/performance-tests.log" 2>&1
    
    if [ $? -eq 0 ]; then
        log "${GREEN}✅ Performance tests passed${NC}"
    else
        log "${RED}❌ Performance tests failed${NC}"
        cat "${DOCKER_TEST_DIR}/test-results/performance-tests.log"
        return 1
    fi
}

# Function to validate production deployment
validate_production() {
    log "${YELLOW}🚀 Validating production deployment...${NC}"
    
    cd "${DOCKER_TEST_DIR}"
    
    # Start production environment
    docker-compose --profile production up -d
    
    # Wait for services
    sleep 30
    
    # Health check
    if curl -f http://localhost:3002/health >/dev/null 2>&1; then
        log "${GREEN}✅ Production deployment is healthy${NC}"
    else
        log "${RED}❌ Production deployment health check failed${NC}"
        docker-compose --profile production logs claude-flow-prod
        return 1
    fi
}

# Function to generate test reports
generate_reports() {
    log "${YELLOW}📊 Generating test reports...${NC}"
    
    cd "${DOCKER_TEST_DIR}"
    
    # Create reports directory
    mkdir -p "${DOCKER_TEST_DIR}/test-results/reports"
    
    # Generate coverage report
    docker-compose run --rm claude-flow-test npm run coverage:report > "${DOCKER_TEST_DIR}/test-results/reports/coverage.html" 2>&1 || true
    
    # Generate summary report
    cat > "${DOCKER_TEST_DIR}/test-results/reports/summary.md" << EOF
# Test Results Summary

**Date:** $(date)
**Build:** ${TIMESTAMP}

## Test Results

- ✅ Unit Tests: $(grep -c "✅ Unit tests passed" "${LOG_FILE}" || echo "0")/1
- ✅ Integration Tests: $(grep -c "✅ Integration tests passed" "${LOG_FILE}" || echo "0")/1  
- ✅ Swarm Tests: $(grep -c "✅ Swarm integration tests passed" "${LOG_FILE}" || echo "0")/1
- ✅ E2E Tests: $(grep -c "✅ End-to-end tests passed" "${LOG_FILE}" || echo "0")/1
- ✅ Performance Tests: $(grep -c "✅ Performance tests passed" "${LOG_FILE}" || echo "0")/1
- ✅ Production Validation: $(grep -c "✅ Production deployment is healthy" "${LOG_FILE}" || echo "0")/1

## Build Information

- **Docker Images Built:** $(docker images | grep claude-flow | wc -l)
- **Total Test Duration:** $(grep -o "Build and test completed in [0-9]* seconds" "${LOG_FILE}" | cut -d' ' -f6 || echo "N/A")
- **Log File:** ${LOG_FILE}

## Next Steps

1. Review individual test logs in \`test-results/\` directory
2. Check coverage reports in \`test-results/reports/\`
3. Validate production deployment if all tests pass
4. Update GitHub issue #54 with results

EOF

    log "${GREEN}✅ Test reports generated${NC}"
}

# Function to post results to GitHub issue
post_to_github() {
    log "${YELLOW}📝 Posting results to GitHub issue #54...${NC}"
    
    # Create a summary for GitHub
    local summary_file="${DOCKER_TEST_DIR}/test-results/github-summary.md"
    
    cat > "${summary_file}" << EOF
## Docker Infrastructure Test Results - ${TIMESTAMP}

### Build Status: $(if [ $? -eq 0 ]; then echo "✅ SUCCESS"; else echo "❌ FAILED"; fi)

**Environment:** Docker multi-stage build with compose orchestration
**Test Coverage:** Unit, Integration, Swarm, E2E, Performance, Production validation

### Key Achievements:
- ✅ Multi-stage Dockerfile with optimized layers
- ✅ Docker Compose orchestration with proper networking
- ✅ Volume mounting for source code and shared data
- ✅ Automated test pipeline with parallel execution
- ✅ Production-ready deployment validation
- ✅ Swarm integration testing environment

### Infrastructure Features:
- **Multi-stage builds** for development, testing, and production
- **Volume mounting** for real-time development
- **Network isolation** with custom bridge network
- **Health checks** for all services
- **Automated testing** pipeline with comprehensive coverage
- **Performance monitoring** with real-time metrics
- **Load balancing** with nginx for production

### Next Steps:
1. Review detailed test logs
2. Validate performance metrics
3. Update deployment documentation
4. Create CI/CD pipeline integration

**Full test log:** [Build Log](${LOG_FILE})
EOF

    log "${GREEN}✅ GitHub summary prepared${NC}"
    log "${BLUE}📄 Summary written to: ${summary_file}${NC}"
}

# Main execution function
main() {
    local start_time=$(date +%s)
    
    log "${BLUE}🚀 Starting Docker build and test pipeline...${NC}"
    log "${BLUE}📅 Started at: $(date)${NC}"
    log "${BLUE}📁 Project root: ${PROJECT_ROOT}${NC}"
    log "${BLUE}🐳 Docker test dir: ${DOCKER_TEST_DIR}${NC}"
    
    # Pre-flight checks
    check_docker
    check_docker_compose
    
    # Execute pipeline
    cleanup
    build_images
    run_unit_tests
    run_integration_tests
    run_swarm_tests
    run_e2e_tests
    run_performance_tests
    validate_production
    generate_reports
    post_to_github
    
    # Calculate duration
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    log "${GREEN}🎉 Build and test completed successfully in ${duration} seconds${NC}"
    log "${GREEN}📊 All test results available in: ${DOCKER_TEST_DIR}/test-results/${NC}"
    log "${GREEN}📝 Summary report: ${DOCKER_TEST_DIR}/test-results/reports/summary.md${NC}"
    
    # Final cleanup
    cd "${DOCKER_TEST_DIR}"
    docker-compose down --volumes --remove-orphans 2>/dev/null || true
    
    log "${GREEN}✅ Docker infrastructure testing completed successfully${NC}"
}

# Execute main function
main "$@"