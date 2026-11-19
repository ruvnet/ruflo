# Managed learning and console validation

Date: 2026-10-25. Extends the initial managed adapter on PR #4471.
Follow-up: [actual ruOS integration checks and recall fix](managed-ruos-e2e.md).
Decision: [ADR 0004](../../plugins/ruflo-agent/docs/adrs/0004-verified-learning-and-console.md).
No runtime dependencies or lockfiles changed.

## Results

| Check | Observed result |
| --- | --- |
| Backend adapter, collector, controls, learning and adjacent workflow regressions | 167 tests passed across nine files |
| Focused console managed/workflow/mod/render/action regressions | 101 tests passed across five files |
| Strict adapter TypeScript boundary | Passed, TypeScript 5.9.3 |
| Agent / workflows plugin smoke | 16 / 18 checks passed |
| CLI/MCP registration | 415 tools, zero dangling references |
| Tool discoverability | 413 scanned, zero missing guidance, short or duplicate descriptions |
| Ruflo 3.25.6 deep code scan of changed integration sources | Zero scanner findings |
| Independent source review | No remaining blockers in the reviewed paths |
| Warm console view rendering | Median below 16 ms in the bounded fixture test |

The console checks use the actual view functions with a fixture rendering kit.
They do not measure native terminal/GPU rendering. The full console smoke suite
is not a clean validation result: an earlier concurrent run encountered timing
and temporary-file races and was stopped. The focused action suite passed in
isolation and again within the five-file run. The full monorepo suite was not run.
The scanner is scoped heuristic evidence, not a proof of security or a dependency
advisory audit. No live provider or native memory backend was exercised.

## Acceptance coverage

Collector tests replay 1,000 workers with duplicates, reordered reconnects,
budget and permission pauses, failures and conflicting event IDs. They check
aggregate counts, bounded pages, one in-process collection and an exclusive
cross-process OS lease. Snapshot reads have no provider transport and no timers.
Provider completion never sets worker inspection or acceptance verification.

Controls reject unknown fields and caller approval flags, check current host
policy and exact session allowlists, fetch provider state, and recheck policy
before dispatch. Tests cover changed policy, unknown provider state, failed
deletion and credential rotation during observation. Per-session timestamps
prevent one refresh from freshening another session.

Learning tests cover Ed25519 receipts, strict metadata, unsigned quarantine
poisoning, mutable input isolation, verifier rotation, forged cached advice,
training/holdout leakage, complete paired trials, equal admitted budgets,
source identity, safety/quality/latency regression, replay/adversarial gates,
failed native insertion and forged semantic recall. Recommendations remain
advisory; defaults and capability grants never change. The native memory API
contract is mocked; actual embedding/index performance remains unmeasured.

Durable ledger writes preflight directory fsync before mutation, then use an
exclusive lock, bounded reads, atomic replacement and file/directory fsync.
Linux behavior was tested; Windows durability was not. Unsupported directory
durability must fail instead of claiming a durable write. Same-user adversarial
filesystem races remain outside the directory-check guarantee.

## Reproducible synthetic benchmark

Receipt: [managed-learning-console.json](../benchmarks/managed-learning-console.json).
It includes source hashes and Node version. Compile the three service entry
points, then run:

```sh
node node_modules/typescript/lib/tsc.js --target es2022 --module nodenext \
  --moduleResolution nodenext --strict --skipLibCheck --types node \
  --outDir /tmp/managed-integration-build \
  v3/@claude-flow/cli/src/services/managed-learning.ts \
  v3/@claude-flow/cli/src/services/managed-run-collector.ts \
  v3/@claude-flow/cli/src/services/managed-run-store.ts
node scripts/bench-managed-integration.mjs /tmp/managed-integration-build
```

The recorded run retained 3,003 unique events from 6,006 supplied events for
1,000 workers, with one event read, one session read and zero inactive reads.
Collection took 51.25 ms; cached worker page median was 0.053 ms. Verifying 60
signed training receipts took 15.95 ms; recommendation median was 0.897 ms.
These single-machine fixture measurements are not a before/after performance
claim. Fixture cost and success outcomes cannot establish real model quality,
dollar savings, statistical significance or production routing improvement.

The dedicated CI workflow repeats the nine backend files, five console files,
strict type check, plugin smoke and registration audit using isolated pinned
test tooling. A live bounded provider run, trusted verifier deployment and an
actual native memory index/recall round trip remain release validation gates.
