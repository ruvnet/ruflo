# Knowledge Management Guide

Three modules handle how the system knows what it knows — and how certain it is about it:

- **UncertaintyLedger** — Probabilistic belief tracking with confidence intervals
- **TemporalStore** — Bitemporal assertions with validity windows
- **TruthAnchors** — Immutable externally-signed facts

## When to Use Each

| Need | Module |
|------|--------|
| "How confident are we that X is true?" | UncertaintyLedger |
| "What was true at time T?" / "When does X expire?" | TemporalStore |
| "This fact must never be contradicted by an agent" | TruthAnchors |

## Uncertainty Ledger

### Creating Beliefs

Every piece of knowledge carries explicit uncertainty metadata:

```ts
import { createUncertaintyLedger } from '@claude-flow/guidance/uncertainty';

const ledger = createUncertaintyLedger({
  defaultConfidence: { low: 0.3, mid: 0.5, high: 0.7 },
  decayRatePerHour: 0.01, // Confidence decays 1% per hour
});

// Assert a belief with evidence
const id = ledger.assert('auth', 'Login uses bcrypt for password hashing', {
  confidence: { low: 0.75, mid: 0.88, high: 0.95 },
  evidence: [
    'Found bcrypt import in src/auth.ts line 5',
    'Password comparison uses bcrypt.compare()',
  ],
  tags: ['security', 'authentication'],
});
```

### Belief Lifecycle

Beliefs flow through states based on evidence:

```
confirmed → probable → uncertain → contested → refuted
```

```ts
// Add supporting evidence — confidence increases
ledger.addEvidence(id, {
  supporting: true,
  description: 'Integration test verifies bcrypt output format',
  weight: 0.8,
});

// Add opposing evidence — confidence decreases
ledger.addEvidence(id, {
  supporting: false,
  description: 'Found SHA-256 fallback path in legacy code',
  weight: 0.6,
});

const belief = ledger.get(id);
// belief.status: 'probable' (recomputed from all evidence)
// belief.confidence: { low: 0.65, mid: 0.78, high: 0.90 }
```

### Inference Chains

Beliefs can depend on other beliefs. Child confidence is bounded by parent:

```ts
const parentId = ledger.assert('system', 'Auth service is running', {
  confidence: { low: 0.9, mid: 0.95, high: 0.99 },
});

const childId = ledger.assert('system', 'Login endpoint accepts requests', {
  confidence: { low: 0.85, mid: 0.92, high: 0.97 },
  parentId: parentId, // Depends on auth service running
});

// If parent confidence drops, child is bounded:
ledger.addEvidence(parentId, {
  supporting: false,
  description: 'Health check failed',
  weight: 0.9,
});
// Child confidence is now capped by parent's reduced confidence
```

### Querying

```ts
// All beliefs in a namespace
const authBeliefs = ledger.query({ namespace: 'auth' });

// Only contested beliefs
const contested = ledger.query({ status: 'contested' });

// Beliefs below a confidence threshold
const uncertain = ledger.query({ maxConfidence: 0.5 });

// Beliefs with specific tags
const security = ledger.query({ tags: ['security'] });
```

### Aggregation

```ts
import { createUncertaintyAggregator } from '@claude-flow/guidance/uncertainty';

const agg = createUncertaintyAggregator(ledger);

// Geometric mean confidence across a set of beliefs
const avgConf = agg.aggregateConfidence(['belief-1', 'belief-2', 'belief-3']);

// Worst-case confidence (lowest in the set)
const worst = agg.worstCase(['belief-1', 'belief-2']);

// Are any beliefs contested?
const hasContested = agg.hasContested(['belief-1', 'belief-2', 'belief-3']);
```

## Temporal Store

### The Problem

Knowledge changes over time. The database host was `postgres-1` last week but is `postgres-2` now. An API was v2 until yesterday; now it's v3. Simple key-value storage loses this history.

### Bitemporal Model

Every assertion has two time dimensions:

1. **Assertion time** — when the fact was recorded in the system
2. **Validity time** — when the fact is true in the real world

```ts
import { createTemporalStore, createTemporalReasoner } from '@claude-flow/guidance/temporal';

const store = createTemporalStore();

// Assert: db-host is postgres-1 from Jan 1 to Jan 15
store.assert('config', 'db-host', 'postgres-1.internal', {
  validFrom: new Date('2026-01-01').getTime(),
  validUntil: new Date('2026-01-15').getTime(),
});

// Assert: db-host is postgres-2 from Jan 15 onwards
store.assert('config', 'db-host', 'postgres-2.internal', {
  validFrom: new Date('2026-01-15').getTime(),
  validUntil: null, // No end date — currently valid
});
```

### Querying by Time

```ts
const reasoner = createTemporalReasoner(store);

// What's true right now?
const current = reasoner.whatIsTrue('config');
// [{ key: 'db-host', value: 'postgres-2.internal', ... }]

// What was true on Jan 10?
const past = reasoner.whatWasTrue('config', new Date('2026-01-10').getTime());
// [{ key: 'db-host', value: 'postgres-1.internal', ... }]

// What will be true on Feb 1?
const future = reasoner.whatWillBeTrue('config', new Date('2026-02-01').getTime());
// [{ key: 'db-host', value: 'postgres-2.internal', ... }]
```

### Supersession

When a new fact replaces an old one, the old one is preserved but marked as superseded:

```ts
const oldId = store.assert('api', 'version', 'v2', {
  validFrom: new Date('2025-06-01').getTime(),
});

const newId = store.assert('api', 'version', 'v3', {
  validFrom: new Date('2026-01-01').getTime(),
  supersedes: oldId, // Explicitly links to the old assertion
});

// Old assertion is still queryable for historical analysis
// but its status is now 'superseded'
```

### Retraction

Soft-delete that preserves history:

```ts
store.retract(assertionId);
// The assertion is marked retracted but not deleted
// Historical queries still return it with status 'retracted'
```

### Conflict Detection

```ts
const conflicts = reasoner.findConflicts('config');
// Returns pairs of assertions that are both active for the same key at the same time

const changes = reasoner.changesSince('config', lastCheckTimestamp);
// Returns all assertions created or retracted since the given time
```

## Truth Anchors

### The Problem

Internal beliefs can be wrong. Agents can reason themselves into incorrect conclusions. Some facts need to be pinned by an external authority and never overridden.

### Creating Anchors

```ts
import { createTruthAnchorStore, createTruthResolver } from '@claude-flow/guidance/truth-anchors';

const store = createTruthAnchorStore('anchor-signing-key');

// Human pins a fact
store.create({
  kind: 'human',
  claim: 'Production database is read-only for all agents',
  attester: 'ops-team@company.com',
  tags: ['production', 'database', 'policy'],
});

// External system pins a fact
store.create({
  kind: 'sensor',
  claim: 'API rate limit is 1000 requests per minute',
  attester: 'api-gateway-monitor',
  tags: ['api', 'rate-limit'],
});

// Regulatory requirement
store.create({
  kind: 'authority',
  claim: 'PII must not be stored in agent memory',
  attester: 'compliance-officer',
  tags: ['compliance', 'pii', 'gdpr'],
});
```

### Anchor Properties

- **Immutable** — Once created, an anchor cannot be modified
- **Signed** — HMAC-SHA256 signature over the claim
- **Append-only** — The store only grows (max 50,000 with LRU eviction of expired-only)
- **Verifiable** — Any anchor's signature can be independently verified

### Resolving Conflicts

When an agent's belief contradicts a truth anchor, the anchor wins:

```ts
const resolver = createTruthResolver(store);

// Agent believes it can write to production DB
const resolution = resolver.resolveMemoryConflict(
  'db-access',
  'Agent can write to production database'
);
// resolution.anchorWins: true
// resolution.anchor: the 'read-only' anchor
// resolution.recommendation: 'Override agent belief with truth anchor'
```

### Topic-Based Ground Truth

```ts
// Get all anchors relevant to a topic
const dbAnchors = resolver.getGroundTruth('database');
// Fuzzy matches on tags: finds anchors tagged 'database', 'db', etc.

const complianceAnchors = resolver.getGroundTruth('gdpr compliance');
// Finds anchors tagged 'compliance', 'gdpr', 'pii'
```

### Verification

```ts
// Verify a single anchor's signature
const valid = store.verify(anchorId);

// Verify all anchors in the store
const report = store.verifyAll();
// report.valid: number of valid anchors
// report.invalid: number with broken signatures
// report.details: per-anchor verification results
```

## Using All Three Together

```ts
// 1. Pin critical facts with truth anchors
anchors.create({
  kind: 'human',
  claim: 'Max agent budget is $5.00 per session',
  attester: 'admin',
  tags: ['budget'],
});

// 2. Track beliefs with uncertainty
const beliefId = uncertainty.assert('costs', 'Current session cost is $2.30', {
  confidence: { low: 0.95, mid: 0.98, high: 1.0 },
  evidence: ['Token counter reports 23,000 tokens at $0.01/1k'],
});

// 3. Record temporal validity
temporal.assert('costs', 'session-budget-remaining', '$2.70', {
  validFrom: Date.now(),
  validUntil: Date.now() + 3600_000, // Valid for this session
});

// 4. Before any spending decision, check all three:
const anchor = resolver.getGroundTruth('budget');
// anchor says: max $5.00

const belief = uncertainty.get(beliefId);
// belief says: ~$2.30 spent (98% confidence)

const currentBudget = reasoner.whatIsTrue('costs');
// temporal says: $2.70 remaining

// If belief contradicts anchor, anchor wins
```
