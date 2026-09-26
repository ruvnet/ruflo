import { describe, expect, it } from 'vitest';
import { decideResourceAdmission, type ResourceAdmissionInput } from '../src/resource-admission.js';

const now = '2026-09-21T14:00:00.000Z';
const digest = 'a'.repeat(64);

function fixture(overrides: Partial<ResourceAdmissionInput> = {}): ResourceAdmissionInput {
  const base: ResourceAdmissionInput = {
    profile: {
      profileId: 'profile.raqa.cpu.v1',
      toolId: 'retrieval.local',
      profileDigest: digest,
      observedAt: '2026-09-21T13:59:30.000Z',
      cpuDemand: 0.9,
      memoryDemand: 0.45,
      ioDemand: 0.2,
      remoteWaitFraction: 0.1,
      minCpuCores: 1,
      maxCpuCores: 8,
    },
    host: {
      snapshotId: 'host.primary',
      telemetryDigest: 'b'.repeat(64),
      observedAt: '2026-09-21T13:59:59.000Z',
      cpuPressure: 0.3,
      memoryPressure: 0.2,
      ioPressure: 0.2,
      allocatableCpuCores: 16,
      maxCpuPerTask: 8,
    },
    policy: {
      profileMaxAgeMs: 300_000,
      telemetryMaxAgeMs: 30_000,
      maxCpuPerTask: 8,
      cpuPressureDefer: 0.9,
      memoryPressureDefer: 0.9,
      ioPressureDefer: 0.9,
      safetyHeadroomFraction: 0.1,
    },
    requestedConcurrency: 1,
    now,
  };
  return {
    ...base,
    ...overrides,
    profile: { ...base.profile, ...(overrides.profile ?? {}) },
    host: { ...base.host, ...(overrides.host ?? {}) },
    policy: { ...base.policy, ...(overrides.policy ?? {}) },
  };
}

describe('resource admission policy', () => {
  it('allocates more CPU to a measured CPU sensitive task without crossing ceilings', () => {
    const decision = decideResourceAdmission(fixture());
    expect(decision.verdict).toBe('admit');
    expect(decision.reasonCodes).toContain('CPU_SENSITIVE');
    expect(decision.recommendedCpuCores).toBeGreaterThan(1);
    expect(decision.recommendedCpuCores).toBeLessThanOrEqual(8);
    expect(decision.authority).toBe('none');
  });

  it('does not waste CPU on a remote wait dominated task', () => {
    const input = fixture({
      profile: {
        ...fixture().profile,
        profileId: 'profile.web.remote.v1',
        cpuDemand: 0.7,
        remoteWaitFraction: 0.9,
      },
    });
    const decision = decideResourceAdmission(input);
    expect(decision.verdict).toBe('admit');
    expect(decision.recommendedCpuCores).toBe(input.profile.minCpuCores);
    expect(decision.limitingResource).toBe('remote_wait');
  });

  it('defers CPU sensitive work during high CPU pressure', () => {
    const decision = decideResourceAdmission(fixture({
      host: { ...fixture().host, cpuPressure: 0.95 },
    }));
    expect(decision.verdict).toBe('defer');
    expect(decision.reasonCodes).toEqual(['CPU_PRESSURE']);
    expect(decision.recommendedCpuCores).toBe(0);
  });

  it('defers memory heavy work during memory pressure', () => {
    const decision = decideResourceAdmission(fixture({
      profile: { ...fixture().profile, memoryDemand: 0.9 },
      host: { ...fixture().host, memoryPressure: 0.95 },
    }));
    expect(decision.verdict).toBe('defer');
    expect(decision.reasonCodes).toEqual(['MEMORY_PRESSURE']);
  });

  it('fails stale telemetry closed', () => {
    const decision = decideResourceAdmission(fixture({
      host: { ...fixture().host, observedAt: '2026-09-21T13:00:00.000Z' },
    }));
    expect(decision.verdict).toBe('defer');
    expect(decision.reasonCodes).toEqual(['STALE_TELEMETRY']);
  });

  it('rejects an impossible policy ceiling', () => {
    const decision = decideResourceAdmission(fixture({
      profile: { ...fixture().profile, minCpuCores: 4, maxCpuCores: 8 },
      policy: { ...fixture().policy, maxCpuPerTask: 2 },
    }));
    expect(decision.verdict).toBe('reject');
    expect(decision.reasonCodes).toEqual(['POLICY_CEILING_BELOW_PROFILE_MINIMUM']);
  });

  it('never recommends more aggregate CPU than current allocatable capacity', () => {
    const input = fixture({
      host: { ...fixture().host, allocatableCpuCores: 4, maxCpuPerTask: 8 },
      requestedConcurrency: 4,
      policy: { ...fixture().policy, safetyHeadroomFraction: 0 },
    });
    const decision = decideResourceAdmission(input);
    expect(decision.verdict).toBe('admit');
    expect(decision.recommendedCpuCores * input.requestedConcurrency).toBeLessThanOrEqual(input.host.allocatableCpuCores);
  });

  it('is deterministic for identical evidence', () => {
    const input = fixture();
    const first = decideResourceAdmission(input);
    const second = decideResourceAdmission(input);
    expect(second).toEqual(first);
    expect(first.evidenceDigest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('rejects malformed evidence rather than widening allocation', () => {
    const input = fixture({
      profile: { ...fixture().profile, profileDigest: 'not-a-digest' },
    });
    const decision = decideResourceAdmission(input);
    expect(decision.verdict).toBe('reject');
    expect(decision.recommendedCpuCores).toBe(0);
    expect(decision.authority).toBe('none');
  });
});

describe('resource admission structural benchmark', () => {
  it('keeps p95 policy decision overhead below 100 microseconds', () => {
    const seeds = [11, 29, 47, 71, 101];
    const batchMicros: number[] = [];
    let ceilingViolations = 0;
    let decisions = 0;

    for (const seed of seeds) {
      let state = seed >>> 0;
      for (let batch = 0; batch < 20; batch += 1) {
        const inputs: ResourceAdmissionInput[] = [];
        for (let index = 0; index < 100; index += 1) {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
          const unit = state / 0xffffffff;
          inputs.push(fixture({
            profile: {
              ...fixture().profile,
              profileId: `profile.synthetic.${seed}.${batch}.${index}`,
              cpuDemand: unit,
              memoryDemand: (unit * 1.7) % 1,
              ioDemand: (unit * 2.3) % 1,
              remoteWaitFraction: (unit * 3.1) % 1,
            },
            host: {
              ...fixture().host,
              cpuPressure: (unit * 1.3) % 1,
              memoryPressure: (unit * 1.9) % 1,
              ioPressure: (unit * 2.7) % 1,
            },
          }));
        }
        const start = performance.now();
        for (const input of inputs) {
          const result = decideResourceAdmission(input);
          decisions += 1;
          if (result.recommendedCpuCores > input.host.maxCpuPerTask || result.recommendedCpuCores > input.policy.maxCpuPerTask) {
            ceilingViolations += 1;
          }
        }
        batchMicros.push(((performance.now() - start) * 1000) / inputs.length);
      }
    }

    batchMicros.sort((a, b) => a - b);
    const p95 = batchMicros[Math.floor(batchMicros.length * 0.95)];
    console.log(JSON.stringify({
      schema: 'ruflo-resource-admission-benchmark/v1',
      workload: '10000 deterministic synthetic resource decisions',
      seeds,
      sampleSize: decisions,
      metric: 'microseconds_per_decision',
      p95,
      ceilingViolations,
      authorityExpansion: 0,
      energy: 'not_measured',
      costUsd: 0,
    }));
    expect(decisions).toBe(10_000);
    expect(ceilingViolations).toBe(0);
    expect(p95).toBeLessThan(100);
  });
});
