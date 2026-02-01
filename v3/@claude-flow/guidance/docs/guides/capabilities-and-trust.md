# Capabilities and Trust Guide

This guide covers three related modules that control what agents can do and how much latitude they earn over time:

- **CapabilityAlgebra** — Typed, composable permissions
- **TrustSystem** — Accumulated trust from gate outcomes
- **AuthorityGate** — Authority levels and human-in-the-loop escalation

## Capability Algebra

### The Problem

Simple role-based access (admin/user/guest) is too coarse for multi-agent systems. An agent might need to read files in `/src/` but not `/secrets/`, write to memory namespace `tasks` but not `config`, and call `Edit` but not `Bash` — all simultaneously, with different time windows.

### Creating Capabilities

```ts
import { createCapabilityAlgebra } from '@claude-flow/guidance/capabilities';

const algebra = createCapabilityAlgebra();

// Grant: coder-1 can read and write files under /src/
const cap1 = algebra.grant({
  scope: 'file',
  resource: '/src/**',
  actions: ['read', 'write'],
  grantedTo: 'coder-1',
  grantedBy: 'coordinator',
});

// Grant: coder-1 can execute Edit and Read tools
const cap2 = algebra.grant({
  scope: 'tool',
  resource: 'Edit',
  actions: ['execute'],
  grantedTo: 'coder-1',
  grantedBy: 'coordinator',
});
```

### Checking Capabilities

```ts
// Can coder-1 read /src/auth.ts?
const check = algebra.check('coder-1', 'file', '/src/auth.ts', 'read');
// check.allowed: true
// check.capability: the matching capability object

// Can coder-1 delete /src/auth.ts?
const deleteCheck = algebra.check('coder-1', 'file', '/src/auth.ts', 'delete');
// deleteCheck.allowed: false — 'delete' is not in the granted actions
```

### Attenuating Capabilities

Narrow a capability without revoking it entirely:

```ts
// Remove write access, add a time window
const readOnly = algebra.attenuate(cap1.id, {
  removeActions: ['write'],
  addConstraints: [{
    type: 'time-window',
    params: { expiresAt: Date.now() + 3600_000 }, // 1 hour
  }],
});
// readOnly now allows only 'read' on /src/**, expires in 1 hour
```

### Delegating Capabilities

An agent can delegate a subset of its capabilities to another agent:

```ts
// coder-1 delegates read access on /src/** to reviewer-1
const delegated = algebra.delegate(cap1.id, 'reviewer-1', {
  limitActions: ['read'], // Can only delegate a subset
});
// reviewer-1 now has read access to /src/**
// The delegation chain is tracked: coordinator → coder-1 → reviewer-1
```

### Revoking Capabilities

```ts
algebra.revoke(cap1.id);
// All capabilities delegated from cap1 are also revoked (cascade)
```

### Composing Capabilities

Combine two capabilities using set theory:

```ts
// Intersection: only actions present in BOTH capabilities
const intersection = algebra.intersect(capA, capB);

// Union of constraints: combined restrictions from both
const merged = algebra.merge(capA, capB);
```

### Constraint Types

| Type | Parameters | Effect |
|------|-----------|--------|
| `rate-limit` | `maxPerMinute: number` | Limits how often the capability can be used |
| `budget` | `maxTokens: number` | Limits cumulative token spending |
| `time-window` | `expiresAt: number` | Capability expires at the given timestamp |
| `condition` | `predicate: string` | Custom condition that must be met |
| `scope-restriction` | `pattern: string` | Further restricts the resource pattern |

## Trust System

### How Trust Accumulates

Every time an agent's action passes or fails a gate, the trust system records the outcome:

```ts
import { createTrustSystem } from '@claude-flow/guidance/trust';

const trust = createTrustSystem({
  initialTrust: 0.5,    // New agents start at 0.5
  allowDelta: 0.01,     // Each 'allow' adds 0.01
  denyDelta: 0.05,      // Each 'deny' subtracts 0.05
  warnDelta: 0.02,      // Each 'warn' subtracts 0.02
  decayRate: 0.01,      // Decays toward initial when idle
  decayIntervalMs: 60000, // Apply decay after 1 minute of inactivity
});

// Agent does good work — trust increases slowly
trust.recordOutcome('agent-1', 'allow');  // 0.51
trust.recordOutcome('agent-1', 'allow');  // 0.52
trust.recordOutcome('agent-1', 'allow');  // 0.53

// Agent triggers a deny — trust drops faster
trust.recordOutcome('agent-1', 'deny');   // 0.48
```

### Trust Tiers

```ts
const snapshot = trust.getSnapshot('agent-1');

// snapshot.tier is computed from score:
// >= 0.8  → 'trusted'     — full privileges
// >= 0.5  → 'standard'    — normal operation
// >= 0.3  → 'probation'   — restricted, requires additional checks
// <  0.3  → 'untrusted'   — read-only, blocked from writes
```

### Trust-Based Rate Limiting

```ts
import { getTrustBasedRateLimit } from '@claude-flow/guidance/trust';

const rateLimit = getTrustBasedRateLimit(snapshot.score);
// Higher trust → higher rate limit
// score 0.9 → 100 calls/min
// score 0.5 → 50 calls/min
// score 0.2 → 10 calls/min
```

### Trust Ledger

Every trust change is recorded with full context:

```ts
const ledger = trust.getLedger();
const records = ledger.getRecords('agent-1');
for (const record of records) {
  console.log(`${record.timestamp}: ${record.outcome} → ${record.newScore} (${record.tier})`);
}

// Export for persistence
const exported = ledger.export();
// Later: ledger.import(exported);
```

### Combining Trust with Capabilities

```ts
// Adjust capability constraints based on trust
const snapshot = trust.getSnapshot('agent-1');

if (snapshot.tier === 'trusted') {
  // Grant broader capabilities
  algebra.grant({
    scope: 'tool',
    resource: '*',
    actions: ['execute'],
    grantedTo: 'agent-1',
    grantedBy: 'trust-system',
  });
} else if (snapshot.tier === 'probation') {
  // Restrict to read-only
  for (const cap of algebra.getCapabilities('agent-1')) {
    algebra.attenuate(cap.id, { removeActions: ['write', 'delete', 'execute'] });
  }
}
```

## Authority Gate

### Authority Levels

```
regulatory > institutional > human > agent
```

Each action can require a minimum authority level:

```ts
import { createAuthorityGate, createIrreversibilityClassifier } from '@claude-flow/guidance/authority';

const auth = createAuthorityGate('signing-key');

// Register required authority for specific actions
auth.registerScope({ action: 'read-file', requiredLevel: 'agent' });
auth.registerScope({ action: 'edit-file', requiredLevel: 'agent' });
auth.registerScope({ action: 'deploy-production', requiredLevel: 'human' });
auth.registerScope({ action: 'delete-database', requiredLevel: 'institutional' });
auth.registerScope({ action: 'change-compliance-rules', requiredLevel: 'regulatory' });
```

### Checking Authority

```ts
const check = auth.check('agent', 'deploy-production');
// check.allowed: false
// check.escalationRequired: true
// check.requiredLevel: 'human'
// check.currentLevel: 'agent'
```

### Recording Human Interventions

When a human approves an escalated action, record the intervention:

```ts
const intervention = auth.recordIntervention({
  action: 'deploy-production',
  approvedBy: 'alice@company.com',
  reason: 'Reviewed deployment plan, all tests pass, approved for production.',
  timestamp: Date.now(),
});
// intervention.signature — HMAC-SHA256 signature for audit trail
```

### Irreversibility Classification

```ts
const irrev = createIrreversibilityClassifier();

irrev.classify('git commit -m "fix"');
// { class: 'reversible', proofLevel: 'standard', requiresSimulation: false }

irrev.classify('DROP TABLE users');
// { class: 'irreversible', proofLevel: 'maximum', requiresSimulation: true }

irrev.classify('npm publish');
// { class: 'costly-reversible', proofLevel: 'elevated', requiresSimulation: true }
```

| Class | Proof Level | Simulation Required | Examples |
|-------|-------------|---------------------|----------|
| `reversible` | `standard` | No | git commit, file edit, memory write |
| `costly-reversible` | `elevated` | Yes | npm publish, deploy, schema migration |
| `irreversible` | `maximum` | Yes | DROP TABLE, delete production data, revoke certificates |

### Custom Patterns

Add your own irreversibility patterns:

```ts
irrev.addPattern('irreversible', /\bterraform\s+destroy\b/i);
irrev.addPattern('costly-reversible', /\bnpm\s+deprecate\b/i);
```

Note: patterns are validated against ReDoS (nested quantifiers and excessive length are rejected).

## Putting It All Together

```ts
// Before executing any tool call:
function authorizeToolCall(agentId: string, toolName: string, command: string) {
  // 1. Check capability
  const capCheck = algebra.check(agentId, 'tool', toolName, 'execute');
  if (!capCheck.allowed) return { blocked: true, reason: 'No capability' };

  // 2. Check trust tier
  const snap = trust.getSnapshot(agentId);
  if (snap.tier === 'untrusted') return { blocked: true, reason: 'Untrusted' };

  // 3. Classify irreversibility
  const irrevResult = irrev.classify(command);
  if (irrevResult.class === 'irreversible') {
    // 4. Check authority level
    const authCheck = auth.check('agent', `execute-${toolName}`);
    if (authCheck.escalationRequired) {
      return { blocked: true, reason: `Requires ${authCheck.requiredLevel} approval` };
    }
  }

  // 5. Record outcome for trust
  trust.recordOutcome(agentId, 'allow');
  return { blocked: false };
}
```
