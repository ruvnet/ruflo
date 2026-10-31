/**
 * Config defaults under zod 4
 *
 * zod 4 returns a `.default()` value without parsing it, so the old
 * `CoherenceConfigSchema.default({})` produced `{}` and dropped every nested
 * field default. These run against the real schema, not a mock.
 */

import { describe, it, expect } from 'vitest';
import { validateConfig } from '../src/schemas.js';

describe('PrimeRadiantConfigSchema defaults', () => {
  it('fills nested field defaults when a section is omitted', () => {
    const config = validateConfig({});

    expect(config.coherence).toEqual({
      warnThreshold: 0.3,
      rejectThreshold: 0.7,
      cacheEnabled: true,
      cacheTTL: 60000,
    });
    expect(config.spectral.stabilityThreshold).toBe(0.1);
    expect(config.spectral.maxMatrixSize).toBe(1000);
    expect(config.causal).toEqual({ maxBackdoorPaths: 10, confidenceThreshold: 0.8 });
  });

  it('keeps a provided value and fills the rest of its section', () => {
    const config = validateConfig({ causal: { maxBackdoorPaths: 3 } });

    expect(config.causal).toEqual({ maxBackdoorPaths: 3, confidenceThreshold: 0.8 });
  });
});
