/**
 * #4549 plugins scan: SecurityPolicy.minTrustLevelForWrite/ForMemory/ForSpawn
 * were declared, defaulted and exported, but evaluateMessage() only consulted
 * the hardcoded CAPABILITY_GATES table. In particular memory-query was allowed
 * at ATTESTED despite the documented TRUSTED floor.
 */
import { describe, expect, it } from 'vitest';
import { PolicyEngine } from '../../src/application/policy-engine.js';
import { TrustLevel } from '../../src/domain/entities/trust-level.js';

function engine(securityPolicy?: ConstructorParameters<typeof PolicyEngine>[1]): PolicyEngine {
  return new PolicyEngine({ checkClaim: () => true }, securityPolicy);
}

describe('PolicyEngine configured trust floors', () => {
  it('enforces the default TRUSTED floor for memory queries', () => {
    const policy = engine();

    const below = policy.evaluateMessage('memory-query', TrustLevel.ATTESTED, 128, 'peer-a');
    expect(below.allowed).toBe(false);
    expect(below.trustLevelSufficient).toBe(false);
    expect(below.reason).toMatch(/below the configured minimum/i);

    const atFloor = policy.evaluateMessage('memory-query', TrustLevel.TRUSTED, 128, 'peer-a');
    expect(atFloor.allowed).toBe(true);
  });

  it('honors a lower minTrustLevelForMemory override', () => {
    const policy = engine({ minTrustLevelForMemory: TrustLevel.ATTESTED });

    expect(policy.evaluateMessage('memory-query', TrustLevel.ATTESTED, 128, 'peer-a').allowed).toBe(true);
    expect(policy.evaluateMessage('memory-query', TrustLevel.VERIFIED, 128, 'peer-b').allowed).toBe(false);
  });

  it('enforces the default ATTESTED floor for writes', () => {
    const policy = engine();

    expect(policy.evaluateMessage('task-assignment', TrustLevel.VERIFIED, 128, 'peer-a').allowed).toBe(false);
    expect(policy.evaluateMessage('task-assignment', TrustLevel.ATTESTED, 128, 'peer-b').allowed).toBe(true);
  });

  it('enforces the default PRIVILEGED floor for remote spawn and handoff', () => {
    const policy = engine({ allowedMessageTypes: ['agent-spawn', 'agent-handoff'] });

    expect(policy.evaluateMessage('agent-spawn', TrustLevel.TRUSTED, 128, 'peer-a').allowed).toBe(false);
    expect(policy.evaluateMessage('agent-spawn', TrustLevel.PRIVILEGED, 128, 'peer-b').allowed).toBe(true);

    expect(policy.evaluateMessage('agent-handoff', TrustLevel.TRUSTED, 128, 'peer-c').allowed).toBe(false);
    expect(policy.evaluateMessage('agent-handoff', TrustLevel.PRIVILEGED, 128, 'peer-d').allowed).toBe(true);
  });

  it('does not impose a write floor on heartbeat/status traffic', () => {
    const policy = engine();
    expect(policy.evaluateMessage('heartbeat', TrustLevel.VERIFIED, 128, 'peer-a').allowed).toBe(true);
    expect(policy.evaluateMessage('status-broadcast', TrustLevel.ATTESTED, 128, 'peer-b').allowed).toBe(true);
  });
});
