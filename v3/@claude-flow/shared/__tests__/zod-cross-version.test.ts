import { describe, it, expect } from 'vitest';
import { validateAgentConfig, ConfigValidator } from '../src/core/config/validator.js';

describe('Cross-version Zod validation regression', () => {
  it('returns structured errors for invalid agent config', () => {
    const result = validateAgentConfig({});
    expect(result.success).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
    expect(result.errors?.every((error) =>
      typeof error.path === 'string' && typeof error.message === 'string'
    )).toBe(true);
  });

  it('throws a descriptive validation error instead of TypeError', () => {
    expect(() => ConfigValidator.validateAgentOrThrow({})).toThrow(/Invalid agent configuration/);
  });
});
