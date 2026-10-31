/**
 * Zod 4 compatibility for the security input validator.
 *
 * Under zod 4, `z.string().ip()` no longer exists, so importing this module
 * threw at load time and took down every consumer (memory_store via
 * @claude-flow/memory degraded silently). The module also installs a global
 * error map; a zod 3 style map reads `ctx.defaultError`, and zod 4 calls the
 * map without a ctx, so any unmapped issue raised a TypeError instead of a
 * ZodError, process-wide.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  IPv4Schema,
  IPSchema,
  IdentifierSchema,
  TaskInputSchema,
  SpawnAgentSchema,
  UUIDSchema,
} from '../src/input-validator.js';

describe('input-validator under zod 4', () => {
  it('accepts IPv4 addresses and rejects others with the schema message', () => {
    expect(IPv4Schema.parse('192.168.0.1')).toBe('192.168.0.1');
    for (const bad of ['999.1.1.1', '::1', 'localhost']) {
      const r = IPv4Schema.safeParse(bad);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe('Invalid IPv4 address');
    }
  });

  it('accepts IPv4 and IPv6 for IPSchema and rejects non-addresses', () => {
    expect(IPSchema.parse('10.0.0.1')).toBe('10.0.0.1');
    expect(IPSchema.parse('::1')).toBe('::1');
    expect(IPSchema.parse('2001:db8::8a2e:370:7334')).toBe('2001:db8::8a2e:370:7334');
    const r = IPSchema.safeParse('not-an-ip');
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain('Invalid IP address');
  });

  it('returns a ZodError, not a TypeError, for issues the global map does not handle', () => {
    expect(() => IdentifierSchema.parse(42)).toThrow(z.ZodError);
    const r = TaskInputSchema.safeParse({});
    expect(r.success).toBe(false);
    expect(r.error).toBeInstanceOf(z.ZodError);
  });

  it('keeps the security messages from the global error map', () => {
    expect(z.string().max(1).safeParse('ab').error?.issues[0]?.message)
      .toBe('Input exceeds maximum allowed size');
    expect(z.string().min(3).safeParse('a').error?.issues[0]?.message)
      .toBe('Input below minimum required size');
    expect(z.string().email().safeParse('nope').error?.issues[0]?.message)
      .toBe('Invalid email format');
    expect(z.string().url().safeParse('nope').error?.issues[0]?.message)
      .toBe('Invalid URL format');
    expect(z.string().uuid().safeParse('nope').error?.issues[0]?.message)
      .toBe('Invalid UUID format');
    expect(z.string().regex(/^a$/).safeParse('b').error?.issues[0]?.message)
      .toBe('Invalid string format');
  });

  it('keeps the zod 3 UUID acceptance (8-4-4-4-12 hex, any version nibble)', () => {
    expect(UUIDSchema.safeParse('00000000-0000-0000-0000-000000000001').success).toBe(true);
    expect(UUIDSchema.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(true);
    const bad = UUIDSchema.safeParse('550e8400e29b41d4a716446655440000');
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe('Invalid UUID format');
  });

  it('accepts string-keyed metadata records', () => {
    const parsed = SpawnAgentSchema.safeParse({
      type: 'coder',
      config: { retries: 2, nested: { ok: true } },
    });
    expect(parsed.success).toBe(true);
  });
});
