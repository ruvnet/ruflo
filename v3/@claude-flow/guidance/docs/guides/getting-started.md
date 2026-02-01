# Getting Started with @claude-flow/guidance

The Guidance Control Plane sits beside Claude Code (not inside it) to compile, retrieve, enforce, and evolve the rules that govern agent behavior.

## Installation

```bash
npm install @claude-flow/guidance@v3alpha
```

Requires Node.js 20+.

## Minimal Setup

```ts
import { createGuidanceControlPlane } from '@claude-flow/guidance';

const plane = createGuidanceControlPlane({
  rootGuidancePath: './CLAUDE.md',
});
await plane.initialize();
```

This reads your `CLAUDE.md`, compiles it into a policy bundle (constitution + rule shards + manifest), and prepares all subsystems.

## What Happens at Initialization

1. **Compile** — `CLAUDE.md` is parsed into structured rules. Each rule gets an ID, risk class, domain tags, tool class tags, and intent tags.
2. **Shard** — Rules are broken into task-scoped shards. The always-loaded invariants form the constitution (first ~30-60 lines). Everything else becomes retrievable shards.
3. **Index** — Shards are loaded into the retriever for similarity-based lookup.
4. **Activate gates** — Enforcement gates are configured from the compiled rules.

## Core Loop

Every agent task follows this pattern:

```ts
// 1. Retrieve relevant rules for this task
const guidance = await plane.retrieveForTask({
  taskDescription: 'Fix the login timeout bug',
  intent: 'bug-fix',
});
// guidance.constitution — always-loaded invariants
// guidance.shards — task-relevant rules

// 2. Gate commands before execution
const gateResults = plane.evaluateCommand('git reset --hard');
for (const result of gateResults) {
  if (result.decision === 'deny') {
    console.error(`Blocked: ${result.reason}`);
    // Don't execute the command
  }
}

// 3. Track the run
const event = plane.startRun('task-123', 'bug-fix');
// ... agent does work ...
const evaluations = await plane.finalizeRun(event);
```

## Using Individual Modules

You don't have to use the all-in-one control plane. Each module is independently importable:

```ts
// Just the gates
import { createGates } from '@claude-flow/guidance/gates';
const gates = createGates({ destructiveOps: true, secrets: true });

// Just the proof chain
import { createProofChain } from '@claude-flow/guidance/proof';
const chain = createProofChain('my-hmac-key');

// Just the trust system
import { createTrustSystem } from '@claude-flow/guidance/trust';
const trust = createTrustSystem();
```

All 20 modules are available as separate entry points. See the [API Reference](../reference/api-quick-reference.md) for the full list.

## Local Overrides

`CLAUDE.local.md` acts as an experiment sandbox. Rules defined there overlay the root constitution and can be promoted to root by the optimizer:

```ts
const plane = createGuidanceControlPlane({
  rootGuidancePath: './CLAUDE.md',
  localGuidancePath: './CLAUDE.local.md',
});
```

## WASM Acceleration

If the pre-built WASM binary is available, hot-path operations (hashing, secret scanning, destructive detection) run 1.25-1.96x faster automatically:

```ts
import { getKernel, isWasmAvailable } from '@claude-flow/guidance/wasm-kernel';

console.log(isWasmAvailable()); // true if WASM loaded
const k = getKernel(); // WASM or JS fallback — same API either way
```

No configuration needed. The bridge detects WASM availability at load time.

## File Organization

```
@claude-flow/guidance/
  src/
    index.ts            # Control plane + re-exports
    compiler.ts         # CLAUDE.md → PolicyBundle
    retriever.ts        # Shard similarity retrieval
    gates.ts            # Enforcement gates (4 built-in)
    gateway.ts          # Tool gateway (idempotency + schema + budget)
    proof.ts            # Hash-chained proof envelopes
    continue-gate.ts    # Step-level agent control
    memory-gate.ts      # Memory write authorization
    capabilities.ts     # Typed permission algebra
    trust.ts            # Trust score accumulation
    authority.ts        # Authority levels + irreversibility
    adversarial.ts      # Threat/collusion detection + quorum
    meta-governance.ts  # Governance over governance
    coherence.ts        # Coherence scoring + economic budgets
    uncertainty.ts      # Probabilistic belief tracking
    temporal.ts         # Bitemporal assertions
    truth-anchors.ts    # Immutable external facts
    ledger.ts           # Run logging + evaluators
    optimizer.ts        # Rule evolution
    headless.ts         # Automated compliance testing
    wasm-kernel.ts      # WASM host bridge
  wasm-kernel/          # Rust source for WASM kernel
  wasm-pkg/             # Pre-built WASM binary
  tests/                # 1088 tests across 24 files
  docs/
    guides/             # Conceptual guides
    tutorials/          # Step-by-step walkthroughs
    reference/          # API reference
    diagrams/           # Architecture diagrams
    adrs/               # Architecture Decision Records (G001-G025)
```

## Next Steps

- [Architecture Overview](./architecture-overview.md) — How the 7 layers connect
- [Enforcement Gates Tutorial](../tutorials/enforcement-gates.md) — Wire gates into hooks
- [Multi-Agent Security](./multi-agent-security.md) — Threat detection, collusion, quorum
- [WASM Kernel Guide](./wasm-kernel.md) — Building and benchmarking
