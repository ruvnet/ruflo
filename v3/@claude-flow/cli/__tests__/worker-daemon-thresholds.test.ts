import { describe, expect, it } from 'vitest';
import { getDefaultResourceThresholds } from '../src/services/worker-daemon.js';

describe('worker daemon resource thresholds', () => {
  it('scales CPU threshold with core count', () => {
    const thresholds = getDefaultResourceThresholds('linux', 8);
    expect(thresholds.maxCpuLoad).toBe(24);
  });

  it('uses macOS-friendly free memory threshold', () => {
    const thresholds = getDefaultResourceThresholds('darwin', 8);
    expect(thresholds.minFreeMemoryPercent).toBe(1);
  });

  it('keeps stricter free memory threshold on non-macOS', () => {
    const thresholds = getDefaultResourceThresholds('linux', 8);
    expect(thresholds.minFreeMemoryPercent).toBe(20);
  });
});
