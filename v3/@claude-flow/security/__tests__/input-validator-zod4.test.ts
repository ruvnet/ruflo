/**
 * zod 4 migration (GHSA-mrhx-c7xc-m3w5: zod < 4.6.6 can exhaust memory
 * validating oversized constrained collections).
 *
 * Pins the behaviour that changed API under zod 4: the global security error
 * map (z.setErrorMap -> z.config), IP schemas (string().ip() -> z.ipv4/ipv6),
 * record schemas (z.record now takes a key schema) and the bounded array
 * limits the advisory is about.
 */
import { describe, it, expect } from 'vitest';
import {
  IPSchema,
  IPv4Schema,
  UUIDSchema,
  HttpsUrlSchema,
  TaskInputSchema,
  SpawnAgentSchema,
  InputValidator,
  z,
} from '../src/input-validator.js';

const message = (r: { success: boolean; error?: { issues: Array<{ message: string }> } }) =>
  r.success ? undefined : r.error!.issues[0].message;

describe('input-validator on zod 4', () => {
  it('runs on zod >= 4.6.6', async () => {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const version = req('zod/package.json').version as string;
    const [major, minor, patch] = version.split('.').map(Number);
    expect(major).toBe(4);
    expect(minor > 6 || (minor === 6 && patch >= 6)).toBe(true);
  });

  it('IP schemas accept v4/v6 and keep their messages', () => {
    expect(IPSchema.safeParse('10.0.0.1').success).toBe(true);
    expect(IPSchema.safeParse('::1').success).toBe(true);
    expect(message(IPSchema.safeParse('not-an-ip'))).toBe('Invalid IP address');
    expect(IPv4Schema.safeParse('192.168.1.1').success).toBe(true);
    expect(message(IPv4Schema.safeParse('::1'))).toBe('Invalid IPv4 address');
  });

  it('schema-level messages still win over the global map', () => {
    expect(message(UUIDSchema.safeParse('nope'))).toBe('Invalid UUID format');
    expect(message(HttpsUrlSchema.safeParse('http://example.com'))).toBe('URL must use HTTPS');
  });

  it('the global error map applies where a check has no message', () => {
    expect(message(z.string().max(2).safeParse('abc'))).toBe('Input exceeds maximum allowed size');
    expect(message(z.string().email().safeParse('x'))).toBe('Invalid email format');
  });

  it('record schemas accept string-keyed metadata', () => {
    const task = {
      taskId: '123e4567-e89b-42d3-a456-426614174000',
      content: 'do the thing',
      agentType: 'coder',
      metadata: { a: 1, b: 'two' },
    };
    expect(TaskInputSchema.safeParse(task).success).toBe(true);
    expect(SpawnAgentSchema.safeParse({ type: 'coder', config: { k: 'v' } }).success).toBe(true);
    expect(InputValidator.safeParse(TaskInputSchema, { ...task, metadata: 'x' }).success).toBe(false);
  });
});
