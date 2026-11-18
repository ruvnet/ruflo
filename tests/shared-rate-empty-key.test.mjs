import { test } from 'vitest';
import assert from 'node:assert/strict';
import { SlidingWindowRateLimiter, TokenBucketRateLimiter } from '../v3/@claude-flow/shared/src/resilience/rate-limiter.ts';

for (const Type of [SlidingWindowRateLimiter, TokenBucketRateLimiter]) {
  test(`${Type.name} resets only the explicit empty key`, () => {
    const limiter = new Type({ maxRequests: 1, windowMs: 60_000 });
    try {
      assert.equal(limiter.consume('').allowed, true);
      assert.equal(limiter.consume('other').allowed, true);
      assert.equal(limiter.consume('').allowed, false);
      limiter.reset('');
      assert.equal(limiter.consume('').allowed, true);
      assert.equal(limiter.consume('other').allowed, false);
    } finally { limiter.destroy(); }
  });
  test(`${Type.name} omitted reset key still resets every key`, () => {
    const limiter = new Type({ maxRequests: 1, windowMs: 60_000 });
    try {
      limiter.consume(''); limiter.consume('other');
      limiter.reset();
      assert.equal(limiter.consume('').allowed, true);
      assert.equal(limiter.consume('other').allowed, true);
    } finally { limiter.destroy(); }
  });
}
