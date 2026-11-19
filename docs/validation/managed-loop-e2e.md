# Managed feedback cycle validation

Date: 2026-10-25. Extends [ADR 0004](../../plugins/ruflo-agent/docs/adrs/0004-verified-learning-and-console.md)
and the [previous native ruOS checks](managed-ruos-e2e.md).

## Local evidence

| Check | Result |
| --- | --- |
| Backend provider, learning, cycle, worker and adjacent regressions | 199 tests passed across 11 files |
| Console managed palette, permissions, rendering and actions | 150 passed across eight files |
| Executable verifier and feedback E2E | 86 assertions passed; 18 signed outcomes from real verifier subprocesses |
| Replay and revoked admission | 18 duplicate outcomes, no added rows; denied cycle made zero ledger writes |
| Paired holdout | Six complete pairs eligible on explicitly synthetic costs; no promotion |
| Actual child process lifecycle | Exit 134, SIGKILL, timeout, malformed responses, capacity, warm reuse and grant revocation covered |
| Strict TypeScript boundaries | Adapter, worker and executable scripts passed |
| Agent/workflows smoke | 16/18 checks passed |
| Registration/discoverability | 415 tools, zero dangling; 413 descriptions, all gates pass |
| Pinned Ruflo 3.25.6 scoped deep code scan | Zero heuristic findings |

The verifier runs separate acceptance, safety, replay and adversarial commands,
then measured metric checks, rehashes source/artifact/spec/cost inputs and signs
the closed observation. Tests include failed checks, timeouts, mutated source,
cost mismatch, unsafe paths/key modes, signatures and key rotation. Check programs
are host-reviewed trusted code, not sandboxed arbitrary agent instructions.

One atomic batch replaces repeated ledger transactions in a cycle. At most 24
outcomes are admitted; an indexing cycle accepts at most six training outcomes
and rejects a larger training batch before writes. Later native failure leaves
the signed batch durable and resumable. Native replay authenticates the exact
existing row instead of overwriting immutable evidence. Empty cycles can read
existing evidence and return advisory recommendations.

Fresh host callbacks guard import boundaries, native readiness and the append
grant. Revocation after a granted append may arrive too late to undo that write;
the result reports ambiguity rather than success. A single reusable child has
a 15 second operation timeout and five second idle expiry. Its environment
excludes provider credentials and startup hooks; model download is disabled.
Native/system OOM still needs host memory controls; a process boundary is not
an OS sandbox. Windows/macOS durability and POSIX verifier behavior remain
unqualified.

## ruOS runtime evidence

[Source-bound ruOS receipt](managed-loop-ruos.json) records Node 20.20.2 with
native memory 3.0.9: 199 backend tests and 150 console tests passed. The compiled
verifier loop passed all 86 assertions. Source and emitted JavaScript workers
each durably indexed three rows, replayed all three without replacement and
recalled all three from another process. The real MCP cycle indexed and recalled
three outcomes and replayed them without changing defaults.

The first Node 20 test run exposed a harness assumption about Node 24 TypeScript
support. The test now emits the fixed worker as JavaScript before forking and
rejects early process exit. CI covers Node 20 and 22. The verifier E2E stages an owner-only copy of the
fixture Node executable so tool-cache permissions cannot weaken or invalidate
the production executable policy. A group-writable copy is explicitly rejected.
The deliberately slower synthetic baseline waits one second to keep scheduling
noise from determining fixture eligibility; these timings do not measure model
performance.

Offline hardening configures the exact Transformers.js module identities loaded
by AgentDB before registry initialization; Python-style offline environment flags
alone do not enforce that setting. A fresh native source write/replay and compiled
restart recall passed with this configuration. This verifies the exercised Linux
runtime and emitted entry, not a full monorepo build or OS network sandbox.

## Measured optimization

[Benchmark receipt](../benchmarks/managed-cycle-admission.json) compares identical
18 signed rows with seven rounds, verifying identical persisted evidence:

| Admission | Median local time | Transactions |
| --- | --- | --- |
| Existing individual record calls | 185.28 ms | 18 |
| Atomic batch | 25.40 ms | 1 |

The measured speedup was 7.29 times. This is temporary-filesystem CPU/durability
overhead on one machine, not task intelligence, native indexing performance,
provider savings or statistical evidence of a better model strategy.

## Reproduction

With the pinned test tooling installed as in the dedicated CI workflow:

```sh
node node_modules/typescript/lib/tsc.js --target es2022 --module nodenext \
  --moduleResolution nodenext --strict --skipLibCheck --types node \
  --outDir /tmp/managed-e2e scripts/e2e-managed-loop.mts \
  scripts/managed-outcome-verifier.mts scripts/bench-managed-cycle.mts \
  v3/@claude-flow/cli/src/services/managed-memory-worker.ts
node /tmp/managed-e2e/scripts/e2e-managed-loop.mjs
node /tmp/managed-e2e/scripts/bench-managed-cycle.mjs
```

The live provider runner is separate: it exits 3 with a blocked JSON result and
zero provider calls without explicit opt-in, an executor key and one or two
predefined worker IDs. It never infers entitlement from a Claude subscription.
Unknown creation outcomes require inspection; dependent cleanup stops if session
deletion is unconfirmed. Confirmed completion remains unverified correctness.

Keep PR #4471 draft pending actual provider canary, production verifier operation,
platform qualification and the relevant CI results. The JSON receipts bind the exercised source and
ruOS native child measurements; provider quality and spend remain unmeasured.
