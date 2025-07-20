# Agentic Flow Integration Testing Framework

This comprehensive integration testing framework validates all components of Agentic Flow v2.0 working together in production-like scenarios.

## 🎯 Overview

The integration testing framework provides:

- **Real API Integration**: Tests with actual LLM providers (Anthropic, OpenAI, Google)
- **Multi-Agent Coordination**: Validates agent teamwork and communication
- **Workflow Execution**: Tests complex workflow scenarios with state management
- **End-to-End Scenarios**: Complete real-world use cases
- **Performance Testing**: Load testing and scalability validation
- **Security Testing**: Vulnerability scanning and data protection
- **Cross-Component Integration**: Validates all components work together
- **Automated Reporting**: Comprehensive test reports and CI/CD integration

## 🏗️ Test Structure

### Test Categories

1. **Provider Integration** (`provider-integration.test.ts`)
   - Real API calls with fallback scenarios
   - Rate limiting and error handling
   - Multi-provider coordination
   - Cost optimization testing

2. **Agent Coordination** (`agent-coordination.test.ts`)
   - Team formation and management
   - Inter-agent communication
   - Collaborative problem solving
   - Consensus mechanisms

3. **Workflow Execution** (`workflow-execution.test.ts`)
   - Simple and complex workflow scenarios
   - State persistence and recovery
   - Human-in-the-loop tasks
   - Error handling and retries

4. **End-to-End Scenarios** (`end-to-end-scenarios.test.ts`)
   - Software development lifecycle
   - Research and analysis projects
   - Crisis response scenarios
   - Complete real-world use cases

5. **Performance and Load** (`performance-load.test.ts`)
   - Throughput testing
   - Memory management
   - Resource contention
   - Stress testing

6. **Security and Reliability** (`security-reliability.test.ts`)
   - Data protection and encryption
   - Authentication and authorization
   - Injection attack prevention
   - Fault tolerance and recovery

7. **Cross-Component Integration** (`cross-component.test.ts`)
   - Full system integration
   - Data flow between components
   - Failure cascade prevention
   - Component interaction validation

## 🚀 Quick Start

### Basic Usage

```bash
# Run all integration tests
npm run test:integration:all

# Run specific test categories
npm run test:integration:integration  # Core integration tests
npm run test:integration:e2e         # End-to-end scenarios
npm run test:integration:performance # Performance tests
npm run test:integration:security    # Security tests

# Run tests in parallel
npm run test:integration:parallel
```

### With Real API Keys

```bash
# Set environment variables for real API testing
export ANTHROPIC_API_KEY="your_anthropic_key"
export OPENAI_API_KEY="your_openai_key"
export GOOGLE_API_KEY="your_google_key"
export RUN_REAL_API_TESTS="true"

# Run tests with real providers
npm run test:integration:all
```

### Custom Test Runner

```bash
# Use the custom test runner with specific configurations
node -r ts-node/register tests/integration/test-runner.ts \
  --categories integration e2e \
  --parallel \
  --maxParallel 4 \
  --timeout 300000 \
  --generateReport \
  --reportFormat html
```

## 📊 Test Infrastructure

### Core Components

- **IntegrationTestFramework**: Central orchestration and metrics collection
- **TestInfrastructure**: Utilities for creating test contexts and scenarios
- **TestRunner**: Automated test execution with reporting
- **CIIntegration**: CI/CD platform integration

### Test Context Management

Each test gets a complete isolated environment:

```typescript
const testContext = await framework.createTestContext({
  name: 'My Integration Test',
  agents: {
    count: 5,
    types: ['researcher', 'coder', 'analyst', 'reviewer', 'coordinator']
  },
  providers: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
    openai: { apiKey: process.env.OPENAI_API_KEY }
  },
  enableRealProviders: true,
  timeout: 120000
});
```

### Metrics Collection

The framework automatically collects:

- Request latencies and throughput
- Success/failure rates
- Memory and CPU usage
- Component interaction patterns
- Custom business metrics

## 🔧 Configuration

### Environment Variables

```bash
# API Keys (optional - uses mocks if not provided)
ANTHROPIC_API_KEY="your_anthropic_key"
OPENAI_API_KEY="your_openai_key"  
GOOGLE_API_KEY="your_google_key"

# Test Configuration
RUN_REAL_API_TESTS="true"        # Enable real API calls
CI="true"                        # CI environment detection
NODE_ENV="test"                  # Test environment
JEST_WORKER_ID="1"              # Jest worker configuration
```

### Test Runner Configuration

```typescript
const config: TestRunConfig = {
  suites: ['Provider Integration', 'Agent Coordination'],
  categories: ['integration', 'e2e'],
  tags: ['providers', 'agents'],
  parallel: true,
  maxParallel: 4,
  timeout: 300000,
  environment: {
    RUN_REAL_API_TESTS: 'true'
  },
  generateReport: true,
  reportFormat: 'all',  // 'json' | 'html' | 'junit' | 'all'
  outputDir: './test-reports'
};
```

## 📈 Reporting

### Generated Reports

The framework generates multiple report formats:

1. **HTML Report**: Interactive dashboard with metrics and charts
2. **JSON Report**: Machine-readable results for automation
3. **JUnit XML**: CI/CD compatible test results
4. **Coverage Reports**: Code coverage analysis

### Report Location

Reports are generated in `./test-reports/` directory:

```
test-reports/
├── integration-test-report-2024-01-20T10-30-00.html
├── integration-test-report-2024-01-20T10-30-00.json
├── integration-test-report-2024-01-20T10-30-00.xml
└── coverage/
    ├── lcov.info
    ├── cobertura-coverage.xml
    └── index.html
```

### Sample Metrics

```json
{
  "summary": {
    "totalSuites": 7,
    "passedSuites": 7,
    "failedSuites": 0,
    "totalTests": 156,
    "passedTests": 156,
    "overallSuccessRate": 100,
    "totalDuration": 245680,
    "coverage": {
      "statements": 85.4,
      "branches": 82.1,
      "functions": 88.7,
      "lines": 84.9
    }
  }
}
```

## 🔄 CI/CD Integration

### GitHub Actions

```bash
# Generate GitHub Actions workflow
npm run ci:setup github production

# This creates .github/workflows/integration-tests.yml
```

### GitLab CI

```bash
# Generate GitLab CI configuration
npm run ci:setup gitlab staging
```

### Jenkins

```bash
# Generate Jenkinsfile
npm run ci:setup jenkins development
```

### Azure Pipelines

```bash
# Generate Azure Pipelines configuration
npm run ci:setup azure production
```

### Custom CI Integration

```typescript
import { CIIntegration } from './tests/integration/ci-integration';

const ci = new CIIntegration({
  platform: 'custom',
  environment: 'production',
  apiKeys: {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY
  },
  parallelJobs: 4,
  timeoutMinutes: 60,
  notifications: {
    slack: { webhook: process.env.SLACK_WEBHOOK, channel: '#ci-cd' }
  }
});

const results = await ci.runCITests();
```

## 🧪 Writing Integration Tests

### Basic Test Structure

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { IntegrationTestFramework, IntegrationTestContext } from './test-infrastructure';

describe('My Integration Tests', () => {
  let framework: IntegrationTestFramework;
  let testContext: IntegrationTestContext;

  beforeAll(async () => {
    framework = new IntegrationTestFramework();
  });

  afterAll(async () => {
    await framework.cleanup();
  });

  beforeEach(async () => {
    testContext = await framework.createTestContext({
      name: 'My Test Context',
      agents: { count: 3, types: ['researcher', 'coder', 'analyst'] },
      timeout: 60000
    });
  });

  afterEach(async () => {
    await testContext.cleanup();
  });

  it('should validate component integration', async () => {
    const { coordinator, providers, agents } = testContext;
    
    // Your test logic here
    const result = await coordinator.executeTask(/* ... */);
    
    expect(result.success).toBe(true);
    
    // Record custom metrics
    framework.recordMetric(testContext.id, 'custom_metric', result.value);
  });
});
```

### Advanced Patterns

```typescript
// Performance testing
const { result, duration } = await measureTime(async () => {
  return await performOperation();
});

// Event waiting
const completionEvent = await waitForEvent(emitter, 'task:completed', 30000);

// Test data generation
const workflow = TestDataFactory.createWorkflowDefinition('Test Workflow', 'complex');
const goal = TestDataFactory.createGoal('Test goal description', 8);
```

## 🎛️ Test Categories and Tags

### Categories

- `integration`: Core component integration
- `e2e`: End-to-end scenarios
- `performance`: Performance and load testing
- `security`: Security and reliability testing

### Tags

- `providers`: LLM provider related tests
- `agents`: Agent functionality tests
- `workflows`: Workflow engine tests
- `coordination`: Team coordination tests
- `llm`: Large language model tests
- `api`: API integration tests
- `security`: Security related tests
- `reliability`: Reliability and fault tolerance tests

### Filtering Tests

```bash
# Run tests by category
npm run test:integration -- --categories integration performance

# Run tests by tags  
npm run test:integration -- --tags providers agents

# Run specific test suites
npm run test:integration -- --suites "Provider Integration" "Workflow Execution"
```

## 🚨 Troubleshooting

### Common Issues

1. **API Rate Limits**
   ```bash
   # Reduce parallel execution
   npm run test:integration -- --maxParallel 2
   ```

2. **Memory Issues**
   ```bash
   # Increase Node.js memory
   export NODE_OPTIONS="--max-old-space-size=4096"
   npm run test:integration
   ```

3. **Timeout Issues**
   ```bash
   # Increase timeout
   npm run test:integration -- --timeout 600000
   ```

4. **Real API Tests Failing**
   ```bash
   # Run with mock providers
   unset RUN_REAL_API_TESTS
   npm run test:integration
   ```

### Debug Mode

```bash
# Enable verbose logging
DEBUG=agentic-flow:* npm run test:integration

# Run single test file
npx jest tests/integration/provider-integration.test.ts --verbose
```

### Performance Tuning

```bash
# Run subset of tests for faster feedback
npm run test:integration:integration  # Core tests only

# Reduce agent count for faster execution
export TEST_AGENT_COUNT=2
npm run test:integration
```

## 📚 Best Practices

### Test Design

1. **Isolation**: Each test should be independent and cleanup after itself
2. **Deterministic**: Tests should produce consistent results
3. **Meaningful**: Test real-world scenarios, not just happy paths
4. **Fast**: Optimize for quick feedback while maintaining coverage
5. **Robust**: Handle network issues, rate limits, and failures gracefully

### Metrics Collection

1. **Business Metrics**: Collect metrics that matter to users
2. **Performance Metrics**: Track latency, throughput, and resource usage
3. **Quality Metrics**: Measure success rates, error patterns, and reliability
4. **Custom Metrics**: Add domain-specific measurements

### CI/CD Integration

1. **Environment-Specific**: Different test suites for different environments
2. **Fast Feedback**: Quick core tests for PRs, comprehensive tests for main branch
3. **Parallel Execution**: Use parallelization to reduce total test time
4. **Artifact Management**: Save reports and logs for debugging

## 🤝 Contributing

### Adding New Tests

1. Create test file in appropriate category directory
2. Follow existing naming conventions
3. Add proper tags and categories
4. Update test runner configuration
5. Document any new patterns or utilities

### Test Infrastructure

1. Add new utilities to `test-infrastructure.ts`
2. Maintain backward compatibility
3. Add comprehensive documentation
4. Include usage examples

### Reporting

1. Extend existing report formats
2. Add new metrics carefully
3. Ensure cross-platform compatibility
4. Test report generation thoroughly

## 📄 License

This integration testing framework is part of the Agentic Flow project and is licensed under the MIT License.