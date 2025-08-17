# Claude API Enhanced Error Handling

This document describes the comprehensive error handling implemented for the Claude API client in Claude Flow, addressing Issue #183.

## Overview

The enhanced error handling system provides:
- **Automatic retry logic** with exponential backoff for transient failures
- **Circuit breaker protection** to prevent cascading failures
- **Health check monitoring** for proactive API status detection
- **User-friendly error messages** with actionable suggestions
- **Detailed error logging** for debugging

## Error Types

### Retryable Errors

These errors are automatically retried with exponential backoff:

#### 500 Internal Server Error
- **Class**: `ClaudeInternalServerError`
- **Retry**: Yes (up to 3 times by default)
- **Suggestions**: Wait and retry, check status page, use fallback services

#### 503 Service Unavailable
- **Class**: `ClaudeServiceUnavailableError`
- **Retry**: Yes
- **Suggestions**: Wait 5-10 minutes, check maintenance schedules

#### 429 Rate Limit Exceeded
- **Class**: `ClaudeRateLimitError`
- **Retry**: Yes (respects `retry-after` header)
- **Suggestions**: Implement throttling, batch requests, upgrade plan

#### Network Timeout
- **Class**: `ClaudeTimeoutError`
- **Retry**: Yes
- **Suggestions**: Check connection, simplify request, increase timeout

#### Network Connection Error
- **Class**: `ClaudeNetworkError`
- **Retry**: Yes
- **Suggestions**: Check internet, verify firewall/proxy settings

### Non-Retryable Errors

These errors are not retried as they require user intervention:

#### 401/403 Authentication Error
- **Class**: `ClaudeAuthenticationError`
- **Retry**: No
- **Suggestions**: Verify API key, check expiration, regenerate key

#### 400 Validation Error
- **Class**: `ClaudeValidationError`
- **Retry**: No
- **Suggestions**: Check parameters, verify model name, review API docs

## Configuration

### Basic Configuration

```typescript
const client = new ClaudeAPIClient(logger, configManager, {
  // Basic retry configuration
  retryAttempts: 3,              // Max retry attempts
  retryDelay: 1000,              // Base delay in ms
  retryJitter: true,             // Add randomization to prevent thundering herd
  
  // Health check configuration
  enableHealthCheck: true,        // Enable periodic health checks
  healthCheckInterval: 300000,    // Check every 5 minutes
  
  // Circuit breaker configuration
  circuitBreakerThreshold: 5,     // Open after 5 consecutive failures
  circuitBreakerTimeout: 60000,   // Timeout for each request
  circuitBreakerResetTimeout: 300000, // Try again after 5 minutes
});
```

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=your-api-key

# Optional
CLAUDE_API_URL=https://api.anthropic.com/v1/messages
CLAUDE_MODEL=claude-3-sonnet-20240229
CLAUDE_TEMPERATURE=0.7
CLAUDE_MAX_TOKENS=4096
```

## Usage Examples

### Basic Error Handling

```typescript
try {
  const response = await client.sendMessage([
    { role: 'user', content: 'Hello!' }
  ]);
  console.log(response.content[0].text);
} catch (error) {
  if (error instanceof ClaudeAPIError) {
    const errorInfo = getUserFriendlyError(error);
    console.error(`${errorInfo.title}: ${errorInfo.message}`);
    
    if (errorInfo.retryable) {
      console.log('This error may be temporary. Please try again.');
    }
    
    // Show suggestions to the user
    errorInfo.suggestions.forEach(suggestion => {
      console.log(`• ${suggestion}`);
    });
  }
}
```

### Health Check Monitoring

```typescript
// Perform manual health check
const health = await client.performHealthCheck();
if (!health.healthy) {
  console.warn('Claude API is not healthy:', health.error);
}

// Listen to health check events
client.on('health_check', (result) => {
  if (!result.healthy) {
    // Alert monitoring system or switch to fallback
    alertOps('Claude API unhealthy', result);
  }
});
```

### Error Event Handling

```typescript
client.on('error', ({ error, userFriendly }) => {
  // Log to monitoring system
  logger.error('Claude API error', {
    error: error.message,
    code: error.code,
    statusCode: error.statusCode,
    retryable: error.retryable,
  });
  
  // Show user-friendly message
  showUserNotification(userFriendly.title, userFriendly.message);
});
```

## Retry Logic

The retry mechanism uses exponential backoff with optional jitter:

1. **Base delay**: Starts at `retryDelay` (default 1000ms)
2. **Exponential backoff**: Delay doubles with each attempt
3. **Max delay**: Capped at 30 seconds
4. **Jitter**: Random 0-30% added to prevent thundering herd
5. **Rate limit respect**: Uses `retry-after` header when present

### Retry Calculation

```
delay = min(baseDelay * (2 ^ attempt), maxDelay)
if (jitter) delay = delay + (random() * 0.3 * delay)
```

## Circuit Breaker

The circuit breaker prevents cascading failures:

1. **Closed state**: Normal operation
2. **Open state**: All requests fail fast after threshold exceeded
3. **Half-open state**: Test with single request after reset timeout

### States and Transitions

```
Closed → Open: After 5 consecutive failures
Open → Half-Open: After 5 minute reset timeout
Half-Open → Closed: On successful request
Half-Open → Open: On failed request
```

## Best Practices

### 1. Always Handle Errors

```typescript
// ❌ Bad - Unhandled promise rejection
client.sendMessage(messages);

// ✅ Good - Proper error handling
try {
  await client.sendMessage(messages);
} catch (error) {
  handleError(error);
}
```

### 2. Check Retryable Status

```typescript
if (error instanceof ClaudeAPIError && error.retryable) {
  // Can retry later
  await scheduleRetry(request);
} else {
  // Requires user intervention
  await notifyUser(error);
}
```

### 3. Monitor Health Status

```typescript
// Set up monitoring
const healthInterval = setInterval(async () => {
  const health = await client.performHealthCheck();
  metrics.record('claude.api.health', health.healthy ? 1 : 0);
  
  if (health.latency) {
    metrics.record('claude.api.latency', health.latency);
  }
}, 60000);
```

### 4. Implement Fallbacks

```typescript
async function getAIResponse(prompt: string): Promise<string> {
  try {
    return await claudeClient.complete(prompt);
  } catch (error) {
    if (error instanceof ClaudeServiceUnavailableError) {
      // Try fallback service
      return await fallbackAI.complete(prompt);
    }
    throw error;
  }
}
```

### 5. Log Errors Appropriately

```typescript
client.on('error', ({ error, userFriendly }) => {
  // Detailed logging for debugging
  logger.error('Claude API error', {
    error: error.toJSON(),
    stack: error.stack,
  });
  
  // User-facing logging
  logger.info('AI service temporarily unavailable', {
    title: userFriendly.title,
    retryable: userFriendly.retryable,
  });
});
```

## Testing

Run the error handling tests:

```bash
npm test -- tests/unit/api/claude-client-errors.test.ts
```

Run the example demonstration:

```bash
npm run example -- claude-api-error-handling
```

## Migration Guide

If you're upgrading from the previous error handling:

1. **Update error imports**:
   ```typescript
   // Old
   import { getErrorMessage } from '../utils/error-handler.js';
   
   // New
   import { ClaudeAPIError, getUserFriendlyError } from '../api/claude-api-errors.js';
   ```

2. **Update error handling**:
   ```typescript
   // Old
   } catch (error) {
     console.error(getErrorMessage(error));
   }
   
   // New
   } catch (error) {
     if (error instanceof ClaudeAPIError) {
       const errorInfo = getUserFriendlyError(error);
       console.error(errorInfo.title, errorInfo.message);
     }
   }
   ```

3. **Enable health checks** (optional but recommended):
   ```typescript
   const client = new ClaudeAPIClient(logger, configManager, {
     enableHealthCheck: true,
     healthCheckInterval: 300000, // 5 minutes
   });
   ```

## Troubleshooting

### Circuit Breaker Opens Too Frequently

Increase the threshold or timeout:
```typescript
{
  circuitBreakerThreshold: 10,  // Allow more failures
  circuitBreakerResetTimeout: 600000,  // 10 minutes
}
```

### Retries Taking Too Long

Adjust retry parameters:
```typescript
{
  retryAttempts: 2,      // Fewer retries
  retryDelay: 500,       // Shorter initial delay
  retryJitter: true,     // Prevent synchronized retries
}
```

### Health Checks Failing

Check API key and network:
```bash
# Test API key
curl -X POST https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-sonnet-20240229","messages":[{"role":"user","content":"Hi"}],"max_tokens":1}'
```

## Summary

The enhanced error handling provides a robust foundation for building reliable applications with the Claude API. It handles transient failures gracefully, provides clear feedback to users, and includes protective mechanisms to prevent system overload during API issues.