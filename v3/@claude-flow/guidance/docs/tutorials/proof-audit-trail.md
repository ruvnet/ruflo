# Tutorial: Proof Chain and Audit Trails

This tutorial shows how to create tamper-evident audit trails for agent sessions using the ProofChain.

## The Problem

An agent runs for 30 minutes, makes 50 tool calls, and writes to shared memory 20 times. Afterwards, you need to verify: did the agent actually do what it claims? Was the log tampered with? Can you trace every memory write back to a specific tool call?

The ProofChain solves this by producing hash-chained, HMAC-signed envelopes for every event.

## Step 1: Create a Proof Chain

```ts
import { createProofChain } from '@claude-flow/guidance/proof';

// The HMAC key should be a secret known only to the auditing system
const chain = createProofChain('audit-hmac-secret-key');
```

## Step 2: Record Events

After each run event (a task execution), append it to the chain with its tool calls and memory operations:

```ts
import type { RunEvent } from '@claude-flow/guidance';

// Record tool calls that happened during this event
const toolCalls = [
  {
    callId: 'call-1',
    toolName: 'Read',
    params: { file_path: '/src/auth.ts' },
    result: { content: '...' },
    timestamp: Date.now(),
    durationMs: 45,
  },
  {
    callId: 'call-2',
    toolName: 'Edit',
    params: { file_path: '/src/auth.ts', old_string: 'foo', new_string: 'bar' },
    result: { success: true },
    timestamp: Date.now(),
    durationMs: 12,
  },
];

// Record memory operations
const memOps = [
  {
    key: 'auth-status',
    namespace: 'task-results',
    operation: 'write' as const,
    valueHash: chain.hashContent('fix applied'),
    timestamp: Date.now(),
  },
];

// Append to chain
chain.appendEvent(runEvent, toolCalls, memOps);
```

## Step 3: What's Inside an Envelope

Each envelope contains:

```ts
const envelope = chain.getEnvelope(0);

envelope.id;             // Unique envelope UUID
envelope.contentHash;    // SHA-256 of the run event
envelope.previousHash;   // Hash of the previous envelope (genesis = '0' x 64)
envelope.chainIndex;     // Position in chain (0, 1, 2, ...)
envelope.timestamp;      // When the envelope was created
envelope.signature;      // HMAC-SHA256 over the entire envelope body

envelope.toolCallHashes; // SHA-256 of each individual tool call
envelope.memoryLineage;  // Read/write trail with value hashes

envelope.metadata;       // Task ID, intent, violation count, etc.
```

## Step 4: Verify the Chain

```ts
// Verify the entire chain — checks hash links and HMAC signatures
const valid = chain.verify();

if (!valid) {
  console.error('Chain has been tampered with!');
  // Find which envelope was modified:
  for (let i = 0; i < chain.length; i++) {
    const env = chain.getEnvelope(i);
    if (!chain.verifyEnvelope(i)) {
      console.error(`Envelope ${i} (${env.id}) is invalid`);
    }
  }
}
```

### What Verification Checks

1. **Genesis envelope** has `previousHash` = `'0'.repeat(64)`
2. Each envelope's `previousHash` matches the computed hash of the prior envelope
3. Each envelope's `signature` is a valid HMAC-SHA256 using the chain's key
4. The `contentHash` matches a recomputation from the envelope's data

Breaking any single envelope invalidates the chain from that point forward.

## Step 5: Serialize for Storage

```ts
// Export the chain for persistence
const serialized = chain.serialize();
// serialized is a JSON-serializable object

// Later, restore it
import { ProofChain } from '@claude-flow/guidance/proof';
const restored = ProofChain.deserialize(serialized, 'audit-hmac-secret-key');
const stillValid = restored.verify(); // true if nothing was modified
```

## Step 6: Memory Lineage Tracing

Track exactly which agent wrote what, and when:

```ts
// Each envelope records memory operations
const envelope = chain.getEnvelope(5);
for (const entry of envelope.memoryLineage) {
  console.log(`${entry.operation}: ${entry.namespace}/${entry.key}`);
  console.log(`  Value hash: ${entry.valueHash}`);
  console.log(`  At: ${new Date(entry.timestamp)}`);
}
```

## Step 7: WASM-Accelerated Hashing

For large chains, use the WASM kernel for faster hash computation:

```ts
import { getKernel } from '@claude-flow/guidance/wasm-kernel';

const k = getKernel();

// Use WASM for individual hashes
const hash = k.sha256(JSON.stringify(runEvent));
const mac = k.hmacSha256('key', envelopeBody);

// Verify a serialized chain via WASM
const valid = k.verifyChain(JSON.stringify(serializedChain), 'audit-hmac-secret-key');
```

At 10,000 events, WASM completes chain verification in ~61ms vs ~76ms for JS.

## Complete Example

```ts
import { createProofChain } from '@claude-flow/guidance/proof';
import { createGuidanceControlPlane } from '@claude-flow/guidance';

const plane = createGuidanceControlPlane();
await plane.initialize();

const chain = createProofChain('audit-key');

// Task 1
const event1 = plane.startRun('task-1', 'bug-fix');
// ... agent works ...
const evals1 = await plane.finalizeRun(event1);
chain.appendEvent(event1, toolCallsFromTask1, memOpsFromTask1);

// Task 2
const event2 = plane.startRun('task-2', 'feature');
// ... agent works ...
const evals2 = await plane.finalizeRun(event2);
chain.appendEvent(event2, toolCallsFromTask2, memOpsFromTask2);

// End of session — verify and persist
console.log(`Chain length: ${chain.length}`);
console.log(`Valid: ${chain.verify()}`);

const serialized = chain.serialize();
// Store serialized to disk, database, or external audit system
```

## Integration with Truth Anchors

Pin critical audit facts so they can't be overridden:

```ts
import { createTruthAnchorStore } from '@claude-flow/guidance/truth-anchors';

const anchors = createTruthAnchorStore('anchor-signing-key');

// After verifying a chain, create a truth anchor for the root hash
anchors.create({
  kind: 'system',
  claim: `Proof chain root hash: ${chain.getRootHash()}`,
  attester: 'audit-system',
  tags: ['audit', 'proof-chain', sessionId],
});
```
