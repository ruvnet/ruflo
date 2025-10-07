# Azure Integration Tests

End-to-end integration tests for Azure agent workflows.

## Overview

Integration tests validate complete workflows that span multiple Azure services and operations. These tests ensure that all components work together correctly in realistic scenarios.

## Test Suites

### 1. Complete Deployment Workflow
Tests the full lifecycle from deployment to monitoring:
- Deploy ARM template with multiple resources
- Configure security policies
- Set up monitoring and alerts
- Assign RBAC permissions
- Handle deployment failures and rollback

### 2. Security and Compliance Workflow
Tests security baseline implementation:
- Create resources
- Run security scans
- Apply security policies
- Verify compliance through audit logs
- Handle security incident response

### 3. Monitoring and Debugging Workflow
Tests performance diagnosis and resolution:
- Create application resources
- Detect performance issues via metrics
- Start debug sessions
- Collect diagnostic logs
- Execute remote commands
- Configure alerts

### 4. Multi-Service Integration
Tests complex architectures:
- Deploy API Gateway and microservices
- Configure networking and security
- Set up distributed monitoring
- Implement disaster recovery (multi-region)

### 5. Administrative Workflows
Tests admin operations:
- User onboarding with role assignments
- Cost optimization workflows
- Budget alerts and recommendations

### 6. Error Recovery Scenarios
Tests resilience and recovery:
- Transient failure recovery
- Partial deployment failures
- Graceful degradation

### 7. Performance at Scale
Tests high-load scenarios:
- Large-scale deployments (50+ resources)
- High-frequency monitoring (100+ requests)
- Concurrent operations

## Running Integration Tests

```bash
# Run all integration tests
npm test tests/integration/azure

# Run with verbose output
npm test -- --verbose tests/integration/azure

# Run specific test suite
npm test tests/integration/azure/azure-integration.test.ts

# Run with coverage
npm test -- --coverage tests/integration/azure
```

## Test Environment Setup

Integration tests use the mock Azure MCP server to simulate real Azure API behavior without requiring actual Azure credentials or resources.

```typescript
beforeAll(() => {
  console.log('Setting up Azure integration test environment...');
  // Environment setup
});

afterAll(() => {
  console.log('Cleaning up Azure integration test environment...');
  // Environment cleanup
});
```

## Test Patterns

### End-to-End Workflow Pattern
```typescript
it('should complete full deployment lifecycle', async () => {
  // 1. Deploy resources
  const deployResult = await azureMock.deploy({...});
  expect(deployResult.success).toBe(true);

  // 2. Configure security
  const securityResult = await azureMock.applySecurityPolicy({...});
  expect(securityResult.success).toBe(true);

  // 3. Set up monitoring
  const monitoringResult = await azureMock.setAlert({...});
  expect(monitoringResult.success).toBe(true);

  // 4. Verify complete workflow
  // ... additional verification
});
```

### Multi-Service Pattern
```typescript
it('should deploy and integrate microservices', async () => {
  // Deploy multiple services in parallel
  const services = await Promise.all([
    azureMock.createResource({name: 'auth-service', ...}),
    azureMock.createResource({name: 'user-service', ...}),
    azureMock.createResource({name: 'order-service', ...})
  ]);

  // Configure networking
  const networkConfig = await azureMock.applySecurityPolicy({...});

  // Set up distributed monitoring
  const monitoringTasks = services.map(s =>
    azureMock.setAlert({resourceId: s.data.id, ...})
  );
  await Promise.all(monitoringTasks);
});
```

### Error Recovery Pattern
```typescript
it('should recover from transient failures', async () => {
  // Simulate failure
  azureMock.setShouldFail(true, 'Transient error');
  const failedAttempt = await azureMock.deploy({...});
  expect(failedAttempt.success).toBe(false);

  // Recover
  azureMock.setShouldFail(false);
  const successfulRetry = await azureMock.deploy({...});
  expect(successfulRetry.success).toBe(true);
});
```

## Performance Expectations

| Test Type | Expected Duration | Resource Count |
|-----------|------------------|----------------|
| Simple Workflow | < 1s | 1-3 resources |
| Complex Workflow | < 3s | 5-10 resources |
| Multi-Service | < 5s | 10-20 resources |
| Large Scale | < 5s | 50+ resources |
| High Frequency | < 3s | 100+ requests |

## Coverage Goals

- **Workflow Coverage**: 100% of critical workflows
- **Service Coverage**: All Azure services used by agent
- **Scenario Coverage**: Happy path + error scenarios
- **Integration Points**: All service-to-service interactions

## CI/CD Integration

Integration tests run in CI/CD pipeline:
- ✅ On pull requests
- ✅ Before deployments
- ✅ Nightly regression tests
- ✅ Performance benchmarking

## Debugging Integration Tests

### Enable Verbose Logging
```bash
LOG_LEVEL=debug npm test tests/integration/azure
```

### Run Single Test
```bash
npm test -- -t "should complete full deployment lifecycle"
```

### Increase Timeout
```typescript
it('long running test', async () => {
  // ...
}, 60000); // 60 second timeout
```

## Best Practices

1. **Test Real Workflows**: Mirror actual usage patterns
2. **Validate State**: Check intermediate states, not just final result
3. **Test Failure Paths**: Include error scenarios
4. **Performance Benchmarks**: Track execution time
5. **Clean Isolation**: Each test is independent
6. **Meaningful Assertions**: Verify business logic, not just technical success

## Common Issues

### Timeout Errors
- Increase test timeout
- Check for unresolved promises
- Verify async/await usage

### State Pollution
- Ensure mock reset between tests
- Use `beforeEach`/`afterEach` properly
- Avoid shared state

### Flaky Tests
- Remove timing dependencies
- Use proper synchronization
- Avoid race conditions

## Extending Integration Tests

When adding new workflows:

1. Create test in appropriate suite
2. Use existing patterns
3. Document workflow steps
4. Add to this README
5. Verify CI/CD integration

## Test Data

Integration tests use realistic test data:
- Resource names follow Azure conventions
- Templates use valid ARM syntax
- Regions are valid Azure locations
- Sizes and SKUs are realistic

## Monitoring Test Health

Track test metrics:
- Execution time trends
- Failure rates
- Coverage changes
- Flakiness indicators

---

**Total Integration Tests**: 35
**Average Runtime**: ~10 seconds
**Success Rate Target**: 100%
