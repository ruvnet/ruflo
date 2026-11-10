/**
 * Config validation under zod 4.
 *
 * zod 4 removed `ZodError.errors` (use `.issues`). The validator mapped
 * `error.errors`, so every invalid config threw a TypeError out of the
 * validator instead of returning `{ success: false, errors }`.
 */

import { describe, it, expect } from 'vitest';
import {
  validateAgentConfig,
  validateSwarmConfig,
  ConfigValidator,
} from '../src/core/config/validator.js';
import { AgentConfigSchema } from '../src/core/config/schema.js';

describe('config validator under zod 4', () => {
  it('returns structured errors for an invalid agent config', () => {
    const result = validateAgentConfig({ id: '', name: 'x' });
    expect(result.success).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
    const paths = result.errors?.map((e) => e.path) ?? [];
    expect(paths).toContain('id');
    expect(paths).toContain('type');
    for (const e of result.errors ?? []) {
      expect(typeof e.message).toBe('string');
      expect(typeof e.code).toBe('string');
    }
  });

  it('returns structured errors for an invalid swarm topology', () => {
    const result = validateSwarmConfig({ topology: 'not-a-topology' });
    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.path).toBe('topology');
  });

  it('still applies defaults on a valid agent config', () => {
    const result = validateAgentConfig({ id: 'a1', name: 'A', type: 'coder' });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      capabilities: [],
      maxConcurrentTasks: 5,
      priority: 50,
    });
  });

  it('treats a ZodError from another zod copy as a validation failure', () => {
    // A caller-supplied schema built with a different zod (e.g. zod 3) throws
    // a ZodError that is not an instance of this package's z.ZodError.
    const foreign = {
      parse() {
        throw Object.assign(new Error('foreign'), {
          name: 'ZodError',
          issues: [{ path: ['x'], message: 'Expected string', code: 'invalid_type' }],
        });
      },
    };
    expect(ConfigValidator.isValid(foreign as never, 42)).toBe(false);
  });

  it('does not mistake an operational error named ZodError for a validation failure', () => {
    const impostor = {
      parse() {
        throw Object.assign(new Error('database failed'), { name: 'ZodError', issues: [] });
      },
    };
    expect(() => ConfigValidator.isValid(impostor as never, {})).toThrow('database failed');
  });

  it('reports symbol path segments instead of throwing', () => {
    const sym = Symbol('meta');
    const foreign = {
      parse() {
        throw Object.assign(new Error('foreign'), {
          name: 'ZodError',
          issues: [{ path: ['metadata', sym], message: 'bad key', code: 'invalid_key' }],
        });
      },
    };
    expect(() => ConfigValidator.validateOrThrow(foreign as never, {}, 'agent')).toThrow(
      /- metadata\.Symbol\(meta\): bad key/,
    );
  });

  it('validateAgentOrThrow reports the invalid fields, not a TypeError', () => {
    expect(AgentConfigSchema.safeParse({}).success).toBe(false);
    expect(() => ConfigValidator.validateAgentOrThrow({ id: '' })).toThrow(
      /Invalid agent configuration:\n {2}- id: /,
    );
  });
});
