# 🧪 CLI Testing Suite for gemini-flow

This directory contains comprehensive testing scripts for the gemini-flow CLI and its integration with ruv-swarm.

## 📁 Test Scripts

### Core Test Scripts

1. **`comprehensive-cli-test.sh`** - Complete CLI functionality testing
   - Environment setup validation
   - Basic CLI functionality
   - NPM package installation
   - Command-specific testing
   - Error handling validation
   - ruv-swarm integration
   - Performance testing
   - Docker environment compatibility
   - Cross-package integration
   - Edge case testing

2. **`npm-package-validation.sh`** - NPM package specific testing
   - Package structure validation
   - Local installation testing
   - Global installation simulation
   - Package scripts testing
   - Dependencies validation
   - CLI integration testing
   - Publishability checks
   - Cross-platform compatibility

3. **`ci-cd-automation.sh`** - Automated CI/CD testing
   - JUnit XML output
   - Coverage reporting
   - Retry logic for flaky tests
   - Environment setup
   - Security auditing
   - Performance benchmarking

4. **`automated-test-runner.sh`** - Production-ready test automation
   - Pre-flight checks
   - Core functionality tests
   - Security and quality tests
   - Performance tests
   - Comprehensive reporting
   - JUnit XML generation

### Utility Scripts

5. **`quick-validation.sh`** - Fast validation for development
6. **`simple-test.sh`** - Basic test execution with reporting
7. **`results-reporter.sh`** - GitHub-ready test results generation

## 🚀 Usage

### Quick Validation
```bash
./test-cli/quick-validation.sh
```

### Comprehensive Testing
```bash
./test-cli/comprehensive-cli-test.sh
```

### NPM Package Testing
```bash
./test-cli/npm-package-validation.sh
```

### CI/CD Testing
```bash
./test-cli/ci-cd-automation.sh
```

### Automated Testing (Production)
```bash
./test-cli/automated-test-runner.sh
```

## 📊 Test Output

All tests generate output in the following formats:

- **Console Output**: Colored terminal output with pass/fail status
- **Log Files**: Detailed logs in `test-results/logs/`
- **JUnit XML**: Machine-readable test results in `test-results/junit.xml`
- **HTML Reports**: Human-readable reports in `test-results/report.html`
- **Markdown Reports**: GitHub-compatible reports for issues

## 🧠 Swarm Integration

All test scripts integrate with ruv-swarm for coordination:

- **Pre-task hooks**: Initialize test coordination
- **Progress tracking**: Store test progress in swarm memory
- **Result notification**: Share test results across agents
- **Performance analysis**: Analyze test execution efficiency

### Swarm Memory Keys Used
- `swarm-1751574161255/cli/*` - CLI testing progress
- `swarm-1751574161255/npm/*` - NPM testing progress
- `swarm-1751574161255/ci/*` - CI/CD testing progress

## 🔧 Test Categories

### 1. Core Functionality Tests
- CLI help command
- Version checking
- Command availability
- Error handling
- Basic execution

### 2. Package Structure Tests
- package.json validation
- File structure verification
- Binary availability
- Dependencies installation

### 3. Integration Tests
- ruv-swarm CLI integration
- MCP configuration
- Cross-package functionality

### 4. Environment Tests
- Docker compatibility
- Node.js version compatibility
- File permissions
- Terminal capabilities

### 5. Performance Tests
- CLI startup time
- Command response time
- Memory usage
- Error handling performance

### 6. Security Tests
- NPM audit
- Sensitive file detection
- Package vulnerability scanning

## 📋 Test Results Format

### Console Output
```bash
✅ CLI help command works
✅ CLI version command works
✅ Core commands available
❌ Error handling test (if failed)

📊 Summary
Total: 8 | Passed: 7 | Failed: 1
Success Rate: 87%
```

### JUnit XML
```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="gemini-flow-cli-tests" tests="8" failures="1" time="15">
  <testsuite name="CLI Tests" tests="8" failures="1" time="15">
    <testcase name="CLI Help" classname="Core" time="1.0"/>
    <testcase name="Error Handling" classname="Core" time="1.0">
      <failure message="Error handling failed"/>
    </testcase>
  </testsuite>
</testsuites>
```

## 🚦 CI/CD Integration

### GitHub Actions Example
```yaml
- name: Run CLI Tests
  run: |
    chmod +x test-cli/automated-test-runner.sh
    ./test-cli/automated-test-runner.sh

- name: Upload Test Results
  uses: actions/upload-artifact@v3
  with:
    name: test-results
    path: test-results/
```

### Docker Integration
```dockerfile
# Add test execution to Docker build
COPY test-cli/ /app/test-cli/
RUN chmod +x /app/test-cli/*.sh
RUN /app/test-cli/automated-test-runner.sh
```

## 🔍 Troubleshooting

### Common Issues

1. **Permission Denied**
   ```bash
   chmod +x test-cli/*.sh
   ```

2. **Timeout Issues**
   - Increase timeout values in scripts
   - Check system performance
   - Verify network connectivity

3. **Missing Dependencies**
   ```bash
   npm ci
   npm install -g tsx
   ```

4. **ruv-swarm Not Found**
   ```bash
   npm install ruv-swarm
   # or
   npx ruv-swarm --version
   ```

### Debug Mode
Set `DEBUG=1` environment variable for verbose output:
```bash
DEBUG=1 ./test-cli/comprehensive-cli-test.sh
```

## 📈 Performance Expectations

### Acceptable Performance Thresholds
- CLI startup time: < 3 seconds
- Help command response: < 2 seconds
- Version command response: < 1 second
- Error handling response: < 2 seconds

### Test Suite Execution Times
- Quick validation: ~30 seconds
- Comprehensive testing: ~3-5 minutes
- NPM validation: ~2-3 minutes
- CI/CD automation: ~1-2 minutes

## 🤝 Contributing

When adding new tests:

1. Follow the existing script structure
2. Include swarm coordination hooks
3. Add proper error handling
4. Generate appropriate output formats
5. Update this README with new test descriptions

### Test Script Template
```bash
#!/bin/bash
set -e

# Colors and logging functions
# ... (standard setup)

# Swarm coordination
npx ruv-swarm hook pre-task --description "Test description" 2>/dev/null || true

# Test execution
# ... (your tests)

# Store results
npx ruv-swarm hook notification --message "Test completed" 2>/dev/null || true
npx ruv-swarm hook post-task --task-id "test-id" 2>/dev/null || true
```

## 📝 License

These test scripts are part of the gemini-flow project and follow the same MIT license.