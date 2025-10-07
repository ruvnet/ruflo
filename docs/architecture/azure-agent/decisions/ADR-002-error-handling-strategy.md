# ADR-002: Error Handling Strategy

## Status
Proposed

## Context
Azure operations can fail for many reasons: network issues, authentication problems, quota limits, configuration errors, etc. We need a comprehensive error handling strategy that:
1. Classifies errors correctly
2. Retries transient failures automatically
3. Provides actionable error messages
4. Supports rollback when needed
5. Prevents cascading failures

## Decision
We will implement a multi-layered error handling strategy with:

### 1. Error Classification
Categorize all errors into:
- **Transient**: Network, throttling, server errors (retryable)
- **User**: Authentication, authorization, validation (not retryable)
- **System**: Configuration, internal, dependency (may need intervention)
- **Unknown**: Unclassified errors

Each error includes:
- Error code and message
- Category and severity
- Recoverable and retryable flags
- Actionable suggestions
- Original Azure error details

### 2. Retry Mechanisms
Multiple retry strategies:
- **Immediate**: No delay, for quick retries
- **Exponential Backoff**: Increasing delays (1s, 2s, 4s, 8s, ...)
- **Linear Backoff**: Fixed increments (1s, 2s, 3s, 4s, ...)
- **Adaptive**: Learns from success/failure patterns

### 3. Circuit Breaker Pattern
Prevent cascading failures:
- **Closed**: Normal operation
- **Open**: Fast-fail when threshold exceeded
- **Half-Open**: Test if service recovered

Configuration:
- Failure threshold: 5 errors in 60 seconds
- Reset timeout: 30 seconds
- Success threshold: 3 successful requests to close

### 4. Rollback Support
Automatic rollback on failure:
- **Full Rollback**: Undo all operations
- **Partial Rollback**: Undo specific operations
- **Manual Rollback**: User-triggered

Checkpoint system:
- Save state before each operation
- Store rollback information
- Execute rollback in reverse order

### 5. Error Recovery
Automatic recovery attempts:
- Token refresh for authentication errors
- Re-authentication for expired credentials
- Backoff for throttling
- Reconnection for network issues
- State resync for conflicts

## Rationale

### Classification Benefits
1. **Appropriate Handling**: Different error types need different strategies
2. **User Guidance**: Clear suggestions for user errors
3. **Automation**: Auto-retry transient errors
4. **Monitoring**: Track error patterns and trends

### Retry Strategy Benefits
1. **Resilience**: Overcome transient failures automatically
2. **Flexibility**: Different strategies for different scenarios
3. **Intelligence**: Adaptive learning improves over time
4. **Rate Limiting**: Respects Azure throttling

### Circuit Breaker Benefits
1. **Stability**: Prevents resource exhaustion
2. **Fast Fail**: Quick feedback when service unavailable
3. **Recovery**: Automatic service discovery
4. **Protection**: Shields Azure from overload

### Rollback Benefits
1. **Safety**: Can undo failed operations
2. **Atomicity**: All-or-nothing transactions
3. **Consistency**: Maintain valid state
4. **Recovery**: Restore previous state

## Consequences

### Positive
1. **Reliability**: Most transient failures resolved automatically
2. **User Experience**: Clear, actionable error messages
3. **System Health**: Circuit breakers prevent cascading failures
4. **Data Integrity**: Rollback maintains consistency
5. **Observability**: Comprehensive error tracking

### Negative
1. **Complexity**: Multiple error handling mechanisms
2. **Latency**: Retries add delay to operations
3. **State Management**: Checkpoints require storage
4. **Debugging**: Multiple retry attempts complicate troubleshooting

### Mitigation Strategies
1. **Logging**: Detailed logs for each retry attempt
2. **Timeouts**: Maximum retry time limits
3. **Metrics**: Track error rates and retry success
4. **Configuration**: Tunable retry parameters

## Error Handling Flow

```
Operation Request
       │
       ▼
Execute Operation
       │
       ├──Success──► Return Result
       │
       └──Error──► Error Classifier
                        │
                        ├──Transient?──Yes──► Retry Executor
                        │                            │
                        │                            ├──Success──► Return Result
                        │                            │
                        │                            └──Max Retries──► Error Response
                        │
                        ├──Recoverable?──Yes──► Recovery Manager
                        │                              │
                        │                              ├──Success──► Retry Operation
                        │                              │
                        │                              └──Failed──► Error Response
                        │
                        └──Not Recoverable──► Error Response
                                                    │
                                                    └──Rollback?──Yes──► Execute Rollback
```

## Error Response Structure

```typescript
{
  success: false,
  error: {
    code: "AuthorizationFailed",
    message: "Principal does not have permission",
    category: "authorization",
    severity: "high",
    recoverable: false,
    retryable: false,
    suggestions: [
      {
        action: "Check RBAC permissions",
        command: "az role assignment list --assignee <id>",
        automated: false
      },
      {
        action: "Contact your Azure administrator",
        automated: false
      }
    ],
    azureError: {
      // Original Azure error details
    }
  },
  metadata: {
    operation: "deploy-webapp",
    timestamp: "2025-10-07T06:00:00Z",
    attempts: 1,
    duration: 1234
  }
}
```

## Retry Configuration Examples

### Production Configuration
```yaml
retry:
  enabled: true
  maxAttempts: 5
  strategy: exponential
  baseDelay: 1000
  maxDelay: 60000
  retryableErrors:
    - network
    - throttling
    - server_error
    - timeout
```

### Development Configuration
```yaml
retry:
  enabled: true
  maxAttempts: 2
  strategy: immediate
  retryableErrors:
    - network
    - server_error
```

### Aggressive Recovery Configuration
```yaml
retry:
  enabled: true
  maxAttempts: 10
  strategy: adaptive
  baseDelay: 500
  maxDelay: 120000
  retryableErrors:
    - network
    - throttling
    - server_error
    - timeout
    - conflict  # Retry conflicts too

circuitBreaker:
  failureThreshold: 10
  resetTimeout: 60000
  successThreshold: 5
```

## Error Monitoring

### Key Metrics
1. **Error Rate**: Errors per minute/hour
2. **Error Distribution**: By category and severity
3. **Retry Success Rate**: Successful retries / total retries
4. **Circuit Breaker Trips**: Frequency of circuit opening
5. **Recovery Success Rate**: Successful recoveries / total attempts

### Alerting Thresholds
- Error rate > 10% for 5 minutes
- Critical errors > 5 per minute
- Circuit breaker open for > 5 minutes
- Retry success rate < 30%

## Testing Strategy

### Unit Tests
- Test error classification for all error types
- Test each retry strategy independently
- Test circuit breaker state transitions
- Test rollback mechanisms

### Integration Tests
- Test with actual Azure error responses
- Test retry behavior with real delays
- Test circuit breaker with multiple requests
- Test rollback with real Azure operations

### Chaos Testing
- Inject random failures
- Test under high error rates
- Test circuit breaker under load
- Test recovery mechanisms

## References
- [Azure Error Codes](https://learn.microsoft.com/en-us/rest/api/azure/)
- [Circuit Breaker Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- [Retry Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/retry)
- [Exponential Backoff](https://en.wikipedia.org/wiki/Exponential_backoff)

## Related ADRs
- ADR-001: Architecture Overview
- ADR-003: Claude Flow Integration
- ADR-006: Observability Strategy
