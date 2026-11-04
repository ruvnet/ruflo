/**
 * #4650 (follow-up from #4580): agent-handoff transfers both work state
 * (write) and ownership/lifecycle authority (spawn). Mapping it to the spawn
 * floor alone let a handoff through when an operator configured a higher write
 * floor. It must require max(write, spawn).
 */
import { describe, expect, it } from 'vitest';
import { PolicyEngine } from '../../src/application/policy-engine.js';
import { TrustLevel } from '../../src/domain/entities/trust-level.js';

function engine(): PolicyEngine {
  return new PolicyEngine(
    { checkClaim: () => true },
    {
      allowedMessageTypes: ['agent-handoff', 'agent-spawn'],
      minTrustLevelForWrite: TrustLevel.PRIVILEGED,
      minTrustLevelForSpawn: TrustLevel.ATTESTED,
    },
  );
}

describe('PolicyEngine agent-handoff dual trust floor (#4650)', () => {
  it('requires the write floor when it is higher than the spawn floor', () => {
    const policy = engine();

    const belowWrite = policy.evaluateMessage('agent-handoff', TrustLevel.TRUSTED, 128, 'peer-a');
    expect(belowWrite.allowed).toBe(false);
    expect(belowWrite.trustLevelSufficient).toBe(false);
    expect(belowWrite.reason).toMatch(/write\+spawn/);

    const atBothFloors = policy.evaluateMessage('agent-handoff', TrustLevel.PRIVILEGED, 128, 'peer-b');
    expect(atBothFloors.allowed).toBe(true);
  });

  it('also requires the spawn floor when it is higher than the write floor', () => {
    const policy = new PolicyEngine(
      { checkClaim: () => true },
      {
        allowedMessageTypes: ['agent-handoff'],
        minTrustLevelForWrite: TrustLevel.ATTESTED,
        minTrustLevelForSpawn: TrustLevel.PRIVILEGED,
      },
    );

    expect(policy.evaluateMessage('agent-handoff', TrustLevel.TRUSTED, 128, 'peer-a').allowed).toBe(false);
    expect(policy.evaluateMessage('agent-handoff', TrustLevel.PRIVILEGED, 128, 'peer-b').allowed).toBe(true);
  });

  it('does not raise the floor for plain agent-spawn (spawn only)', () => {
    const policy = engine();

    expect(policy.evaluateMessage('agent-spawn', TrustLevel.TRUSTED, 128, 'peer-a').allowed).toBe(false);
    expect(policy.evaluateMessage('agent-spawn', TrustLevel.PRIVILEGED, 128, 'peer-b').allowed).toBe(true);
  });
});
