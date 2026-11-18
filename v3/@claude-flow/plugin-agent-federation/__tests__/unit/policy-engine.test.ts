/**
 * PolicyEngine Tests — SecurityPolicy trust-level thresholds
 *
 * `SecurityPolicy.minTrustLevelForWrite/Memory/Spawn` were declared,
 * defaulted, and accepted as constructor overrides, but `evaluateMessage()`
 * never read them — the only trust-level gate was the hardcoded
 * `CAPABILITY_GATES` table in trust-level.ts. By default that table allows
 * the `query-redacted` operation (used by `memory-query`/`memory-response`)
 * at TrustLevel.ATTESTED, one level below the policy's own stated
 * `minTrustLevelForMemory: TrustLevel.TRUSTED` — a live default-config gap,
 * not dependent on any caller override. These tests pin the expected
 * behavior once the policy thresholds are actually enforced.
 */

import { describe, expect, it } from 'vitest';
import { PolicyEngine, type SecurityPolicy } from '../../src/application/policy-engine.js';
import { TrustLevel } from '../../src/domain/entities/trust-level.js';

function allowAllClaims() {
  return { checkClaim: () => true };
}

describe('PolicyEngine — SecurityPolicy trust-level enforcement', () => {
  describe('default policy', () => {
    it('rejects memory-query at ATTESTED even though CAPABILITY_GATES allows query-redacted there', () => {
      const engine = new PolicyEngine(allowAllClaims());
      const result = engine.evaluateMessage('memory-query', TrustLevel.ATTESTED, 10, 'node-a');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/memory/i);
    });

    it('allows memory-query at TRUSTED (matches minTrustLevelForMemory default)', () => {
      const engine = new PolicyEngine(allowAllClaims());
      const result = engine.evaluateMessage('memory-query', TrustLevel.TRUSTED, 10, 'node-b');
      expect(result.allowed).toBe(true);
    });

    it('allows memory-response at TRUSTED, rejects at ATTESTED', () => {
      const engine = new PolicyEngine(allowAllClaims());
      expect(engine.evaluateMessage('memory-response', TrustLevel.TRUSTED, 10, 'node-c').allowed).toBe(true);
      expect(engine.evaluateMessage('memory-response', TrustLevel.ATTESTED, 10, 'node-c').allowed).toBe(false);
    });

    it('still allows task-assignment (write) at ATTESTED — matches minTrustLevelForWrite default', () => {
      const engine = new PolicyEngine(allowAllClaims());
      const result = engine.evaluateMessage('task-assignment', TrustLevel.ATTESTED, 10, 'node-d');
      expect(result.allowed).toBe(true);
    });

    it('still rejects agent-spawn below PRIVILEGED — matches minTrustLevelForSpawn default', () => {
      const engine = new PolicyEngine(allowAllClaims());
      const result = engine.evaluateMessage('agent-spawn', TrustLevel.TRUSTED, 10, 'node-e');
      expect(result.allowed).toBe(false);
    });

    it('allows agent-spawn at PRIVILEGED', () => {
      const engine = new PolicyEngine(allowAllClaims());
      const result = engine.evaluateMessage('agent-spawn', TrustLevel.PRIVILEGED, 10, 'node-f');
      expect(result.allowed).toBe(true);
    });

    it('leaves message types with no policy category (e.g. status-broadcast) gated only by CAPABILITY_GATES', () => {
      const engine = new PolicyEngine(allowAllClaims());
      const result = engine.evaluateMessage('status-broadcast', TrustLevel.VERIFIED, 10, 'node-g');
      expect(result.allowed).toBe(true);
    });
  });

  describe('admin-plane messages (trust-change / topology-change)', () => {
    it('rejects trust-change at ATTESTED — previously fell through to the generic "send" operation', () => {
      const engine = new PolicyEngine(allowAllClaims());
      const result = engine.evaluateMessage('trust-change', TrustLevel.ATTESTED, 10, 'node-k');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/admin/i);
    });

    it('allows trust-change at TRUSTED (matches minTrustLevelForAdmin default)', () => {
      const engine = new PolicyEngine(allowAllClaims());
      const result = engine.evaluateMessage('trust-change', TrustLevel.TRUSTED, 10, 'node-l');
      expect(result.allowed).toBe(true);
    });

    it('rejects topology-change at ATTESTED — same admin-plane gap as trust-change', () => {
      const engine = new PolicyEngine(allowAllClaims());
      const result = engine.evaluateMessage('topology-change', TrustLevel.ATTESTED, 10, 'node-m');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/admin/i);
    });

    it('allows topology-change at TRUSTED', () => {
      const engine = new PolicyEngine(allowAllClaims());
      const result = engine.evaluateMessage('topology-change', TrustLevel.TRUSTED, 10, 'node-n');
      expect(result.allowed).toBe(true);
    });

    it('honors a tightened minTrustLevelForAdmin override (PRIVILEGED) by rejecting TRUSTED', () => {
      const override: Partial<SecurityPolicy> = { minTrustLevelForAdmin: TrustLevel.PRIVILEGED };
      const engine = new PolicyEngine(allowAllClaims(), override);
      const result = engine.evaluateMessage('trust-change', TrustLevel.TRUSTED, 10, 'node-o');
      expect(result.allowed).toBe(false);
    });

    it('does not let a loosened minTrustLevelForAdmin override bypass the hardcoded CAPABILITY_GATES floor (defense in depth)', () => {
      const override: Partial<SecurityPolicy> = { minTrustLevelForAdmin: TrustLevel.VERIFIED };
      const engine = new PolicyEngine(allowAllClaims(), override);
      // CAPABILITY_GATES (trust-level.ts) only grants 'admin-change' from
      // TRUSTED, regardless of how permissive the SecurityPolicy override is.
      const result = engine.evaluateMessage('trust-change', TrustLevel.ATTESTED, 10, 'node-p');
      expect(result.allowed).toBe(false);
    });

    it('still rejects trust-change/topology-change at VERIFIED/UNTRUSTED regardless of override', () => {
      const override: Partial<SecurityPolicy> = { minTrustLevelForAdmin: TrustLevel.UNTRUSTED };
      const engine = new PolicyEngine(allowAllClaims(), override);
      expect(engine.evaluateMessage('trust-change', TrustLevel.VERIFIED, 10, 'node-q').allowed).toBe(false);
      expect(engine.evaluateMessage('topology-change', TrustLevel.UNTRUSTED, 10, 'node-q').allowed).toBe(false);
    });
  });

  describe('constructor override actually takes effect', () => {
    it('honors a tightened minTrustLevelForMemory override (PRIVILEGED) by rejecting TRUSTED', () => {
      const override: Partial<SecurityPolicy> = { minTrustLevelForMemory: TrustLevel.PRIVILEGED };
      const engine = new PolicyEngine(allowAllClaims(), override);
      const result = engine.evaluateMessage('memory-query', TrustLevel.TRUSTED, 10, 'node-h');
      expect(result.allowed).toBe(false);
    });

    it('honors a loosened minTrustLevelForMemory override (ATTESTED) by allowing ATTESTED', () => {
      const override: Partial<SecurityPolicy> = { minTrustLevelForMemory: TrustLevel.ATTESTED };
      const engine = new PolicyEngine(allowAllClaims(), override);
      const result = engine.evaluateMessage('memory-query', TrustLevel.ATTESTED, 10, 'node-i');
      expect(result.allowed).toBe(true);
    });

    it('does not let a loosened minTrustLevelForSpawn override bypass the hardcoded CAPABILITY_GATES floor (defense in depth)', () => {
      const override: Partial<SecurityPolicy> = { minTrustLevelForSpawn: TrustLevel.VERIFIED };
      const engine = new PolicyEngine(allowAllClaims(), override);
      // CAPABILITY_GATES (trust-level.ts) only grants 'remote-spawn' at PRIVILEGED,
      // regardless of how permissive the SecurityPolicy override is.
      const result = engine.evaluateMessage('agent-spawn', TrustLevel.TRUSTED, 10, 'node-j');
      expect(result.allowed).toBe(false);
    });
  });
});
