import { test } from 'vitest';
import assert from 'node:assert/strict';
import { retry, RetryableErrors } from '../v3/@claude-flow/shared/src/resilience/retry.ts';

test('HTTP retry predicates do not mistake longer numeric identifiers for status codes', () => {
  for (const message of ['Job 1429 not found', 'Invalid token 4290123', 'Resource 15003 missing', 'Unknown code 5037']) {
    const error = new Error(message);
    assert.equal(RetryableErrors.rateLimit(error), false, message);
    assert.equal(RetryableErrors.serverError(error), false, message);
    assert.equal(RetryableErrors.transient(error), false, message);
  }
});

test('HTTP retry predicates retain complete status tokens and named errors', () => {
  for (const message of ['HTTP 429 Too Many Requests', 'HTTP429', 'status=429: quota exceeded']) {
    assert.equal(RetryableErrors.rateLimit(new Error(message)), true, message);
  }
  for (const message of ['HTTP 500', 'HTTP503', 'status=599: unavailable', 'Internal Server Error']) {
    assert.equal(RetryableErrors.serverError(new Error(message)), true, message);
  }
  assert.equal(RetryableErrors.rateLimit(new Error('Rate Limit exceeded')), true);
  assert.equal(RetryableErrors.transient(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })), true);
});

test('transient retry does not repeat a permanent error containing a numeric identifier', async () => {
  let calls = 0;
  const result = await retry(async () => {
    calls++;
    throw new Error('Resource 15003 missing');
  }, { maxAttempts: 3, initialDelay: 0, jitter: 0, retryableErrors: RetryableErrors.transient });
  assert.equal(result.success, false);
  assert.equal(calls, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.errors.length, 1);
});
