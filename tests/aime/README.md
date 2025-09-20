# AIME Testing Framework

Comprehensive testing suite for the AIME (Autonomous Intelligent Multi-Agent Ecosystems) framework, providing validation for dual planning systems, actor factories, tool bundle optimization, and hierarchical progress tracking.

## 🎯 Overview

The AIME Testing Framework ensures the reliability, performance, and production readiness of all AIME components through:

- **Unit Tests**: Component-level validation
- **Integration Tests**: Cross-component interaction testing  
- **Performance Tests**: Scalability and efficiency validation
- **Deployment Tests**: Production readiness verification

## 🏗️ Architecture

```
tests/aime/
├── aime-test-framework.js      # Main testing framework
├── run-aime-tests.js          # Test runner and CLI
├── vitest.config.js           # Test configuration
├── test-setup.js              # Global test setup
├── unit/                      # Unit test suites
│   ├── dual-planner.test.js
│   └── actor-factory.test.js
├── integration/               # Integration tests
│   └── aime-integration.test.js
├── performance/               # Performance tests
│   └── aime-performance.test.js
├── deployment/                # Deployment validation
│   └── aime-deployment.test.js
└── test-results/              # Generated reports
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- At least 2GB RAM for performance tests
- AIME framework installed

### Installation

```bash
# Navigate to test directory
cd tests/aime

# Install dependencies (if not already installed)
npm install vitest @vitest/ui

# Run all tests
node run-aime-tests.js

# Run specific test suites
node run-aime-tests.js --suites unit,integration

# Run with increased timeout
node run-aime-tests.js --timeout 2.0
```

## 📋 Test Suites

### 1. Unit Tests (`unit/`)

**Purpose**: Validate individual AIME components in isolation

**Coverage**:
- ✅ Dual Planning System
  - Plan generation quality
  - Strategic-tactical alignment
  - Parallel execution optimization
- ✅ Actor Factory
  - Agent persona assignment
  - Knowledge base integration
  - Capability validation
- ✅ Tool Bundle Organizer
  - Bundle loading performance
  - Tool selection optimization
- ✅ Progress Tracker
  - Hierarchical consistency
  - Real-time updates

**Run Unit Tests**:
```bash
node run-aime-tests.js --suites unit
```

### 2. Integration Tests (`integration/`)

**Purpose**: Validate component interactions and end-to-end workflows

**Coverage**:
- ✅ Complete AIME workflow execution
- ✅ Component integration verification
- ✅ Data consistency across components
- ✅ Error recovery mechanisms
- ✅ Cross-component communication

**Run Integration Tests**:
```bash
node run-aime-tests.js --suites integration
```

### 3. Performance Tests (`performance/`)

**Purpose**: Validate scalability and performance characteristics

**Coverage**:
- ✅ Plan generation speed (complexity scaling)
- ✅ Concurrent operations handling
- ✅ Memory usage efficiency
- ✅ Agent creation performance
- ✅ Progress tracking throughput
- ✅ Stress testing under load

**Performance Targets**:
- Plan generation: < 10s for high complexity
- Agent creation: < 250ms per agent
- Memory growth: < 1MB per operation cycle
- Concurrent operations: 95%+ success rate

**Run Performance Tests**:
```bash
node run-aime-tests.js --suites performance
```

### 4. Deployment Tests (`deployment/`)

**Purpose**: Validate production readiness and deployment scenarios

**Coverage**:
- ✅ Security audit compliance
- ✅ Performance benchmarks
- ✅ Error handling robustness
- ✅ Monitoring and logging
- ✅ Backup and recovery
- ✅ Multi-platform compatibility
- ✅ Load testing scenarios
- ✅ User acceptance validation

**Production Requirements**:
- Security score: > 90%
- Response time P95: < 500ms
- Uptime capability: 99.9%+
- Error rate: < 0.1%

**Run Deployment Tests**:
```bash
node run-aime-tests.js --suites deployment
```

## 📊 Test Execution and Reporting

### Command Line Interface

```bash
# Full test suite
node run-aime-tests.js

# Specific suites
node run-aime-tests.js --suites unit,integration

# Skip certain suites
node run-aime-tests.js --skip performance

# Increase timeout for slower environments
node run-aime-tests.js --timeout 2.0

# Get help
node run-aime-tests.js --help
```

### Report Generation

The framework automatically generates comprehensive reports:

**Console Output**: Real-time test progress and summary
```
🧪 AIME Testing Framework
=========================

📋 Test Configuration:
   Suites: unit, integration, performance, deployment
   Environment: test
   Output: ./test-results

🔍 Validating environment...
✅ Environment validation passed

🚀 Executing test suites...

📂 Running unit tests...
   ✅ dual-planner: 15/15 passed (2847ms)
   ✅ actor-factory: 12/12 passed (1923ms)

📊 AIME Test Results Summary
============================
Total Tests: 89
Passed: 87 (97.8%)
Failed: 2
Skipped: 0
Duration: 45,362ms

🎉 Tests PASSED
```

**JSON Report** (`test-results/aime-test-results.json`):
```json
{
  "summary": {
    "total": 89,
    "passed": 87,
    "failed": 2,
    "duration": 45362
  },
  "suites": [...],
  "performance": {...},
  "recommendations": [...]
}
```

**HTML Report** (`test-results/aime-test-report.html`):
Interactive dashboard with detailed metrics, charts, and drill-down capabilities.

**Coverage Report** (`test-results/coverage/`):
Code coverage analysis with line-by-line coverage visualization.

## ⚡ Performance Monitoring

The framework includes comprehensive performance monitoring:

### Memory Tracking
- Heap usage monitoring
- Memory leak detection
- Garbage collection impact
- Memory growth analysis

### Execution Timing
- Test duration tracking
- Performance regression detection
- Scalability analysis
- Bottleneck identification

### Resource Utilization
- CPU usage monitoring
- I/O operation tracking
- Network utilization
- Disk space monitoring

## 🛡️ Quality Assurance

### Test Quality Metrics
- **Coverage**: Target > 90% line coverage
- **Reliability**: < 0.1% flaky test rate
- **Performance**: Consistent execution times
- **Maintainability**: Clear test documentation

### Validation Criteria
- All critical paths tested
- Error conditions covered
- Performance benchmarks met
- Security requirements validated
- Cross-platform compatibility verified

## 🔧 Configuration

### Environment Variables

```bash
# Test execution
NODE_ENV=test                    # Test environment
LOG_LEVEL=error                  # Reduce log noise
DEBUG_TESTS=true                 # Enable debug output
SILENT_TESTS=true                # Suppress console output

# Performance tuning
MEMORY_LIMIT=2048                # Memory limit in MB
TIMEOUT_MULTIPLIER=1.0           # Timeout scaling factor
MAX_CONCURRENCY=5                # Concurrent test limit

# CI/CD integration
CI=true                          # CI environment flag
```

### Test Configuration (`vitest.config.js`)

Key configuration options:
- **Timeout**: 30s default, 10min for deployment tests
- **Retry**: 1 retry in CI, 0 locally
- **Coverage**: 80% threshold for all metrics
- **Parallelization**: 50% of CPU cores
- **Isolation**: Thread-based test isolation

## 🚨 Troubleshooting

### Common Issues

**Memory Issues**:
```bash
# Increase memory limit
export MEMORY_LIMIT=4096
node --max-old-space-size=4096 run-aime-tests.js
```

**Timeout Issues**:
```bash
# Increase timeout multiplier
node run-aime-tests.js --timeout 2.0
```

**Flaky Tests**:
```bash
# Run with retries enabled
export CI=true
node run-aime-tests.js
```

### Debug Mode

Enable detailed debug output:
```bash
export DEBUG_TESTS=true
node run-aime-tests.js --suites unit
```

### Performance Analysis

Run performance-focused testing:
```bash
# Performance suite only
node run-aime-tests.js --suites performance

# With memory profiling
node --inspect run-aime-tests.js --suites performance
```

## 📈 Continuous Integration

### GitHub Actions Integration

```yaml
name: AIME Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: cd tests/aime && node run-aime-tests.js
      - uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: tests/aime/test-results/
```

### Pre-commit Hooks

```bash
# Install pre-commit hook
echo "cd tests/aime && node run-aime-tests.js --suites unit" > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

## 💡 Best Practices

### Writing Tests
1. **Clear naming**: Descriptive test names
2. **Single responsibility**: One assertion per test
3. **Isolation**: Tests should not depend on each other
4. **Cleanup**: Proper teardown after each test
5. **Performance**: Monitor test execution time

### Test Organization
1. **Group related tests**: Use describe blocks
2. **Setup/teardown**: Use beforeEach/afterEach
3. **Mock external dependencies**: Avoid real API calls
4. **Data-driven tests**: Use test parameters
5. **Edge cases**: Test boundary conditions

### Performance Testing
1. **Baseline establishment**: Track performance over time
2. **Load simulation**: Test with realistic data volumes
3. **Resource monitoring**: Track memory and CPU usage
4. **Scalability validation**: Test with increasing complexity
5. **Regression detection**: Alert on performance degradation

## 🔄 Contributing

### Adding New Tests

1. **Create test file**: Follow naming convention `*.test.js`
2. **Import framework**: Use the AIMETestFramework class
3. **Write test cases**: Follow existing patterns
4. **Add to suite**: Update test runner configuration
5. **Document coverage**: Update README with new test coverage

### Test Guidelines

- ✅ Use descriptive test names
- ✅ Include setup and teardown
- ✅ Mock external dependencies
- ✅ Test both success and failure paths
- ✅ Include performance considerations
- ✅ Add appropriate assertions
- ✅ Document complex test logic

## 📚 API Reference

### AIMETestFramework Class

```javascript
import AIMETestFramework from './aime-test-framework.js';

const framework = new AIMETestFramework();
await framework.initialize();
const results = await framework.runAllTests();
```

**Key Methods**:
- `initialize()`: Setup test framework
- `runAllTests()`: Execute all test suites
- `runTestSuite(name)`: Execute specific suite
- `generateTestReport()`: Create comprehensive report

### Test Runner CLI

```bash
node run-aime-tests.js [options]

Options:
  --suites <list>     Specific suites to run
  --skip <list>       Suites to skip
  --timeout <factor>  Timeout multiplier
  --help             Show help message
```

## 📞 Support

- **Documentation**: See individual test files for detailed examples
- **Issues**: Report problems via GitHub issues
- **Performance**: Use debug mode for performance analysis
- **Contributing**: Follow the contribution guidelines above

---

**AIME Testing Framework v2.0** - Ensuring reliability, performance, and production readiness for autonomous intelligent multi-agent ecosystems.