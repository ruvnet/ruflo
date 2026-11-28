# ADR-532: Governed adaptive execution graph and measured scheduling optimization

**Status:** Proposed (P0 implementation available for review)  
**Date:** 2026-11-15  
**Owner:** Ruflo maintainers  
**Tracking:** [#5000](https://github.com/ruvnet/ruflo/issues/5000), [#4998](https://github.com/ruvnet/ruflo/issues/4998)  
**Related:** ADR-150, ADR-153, ADR-322, ADR-324, ADR-404, ADR-526, ADR-529, ADR-530, ADR-531.

## Decision

Introduce an **opt-in, host-bound, read-only adaptive DAG executor**, integrated with Ruflo's CLI behind `ruflo adaptive plan` and `ruflo adaptive bench`. Keep Ruflo's current swarm, MCP, Claude Code settings and production execution unchanged. Do **not** enable Claude Code experimental Code Mode: it is terminal-only and incompatible with the repository's default agent-team configuration. Code Mode is a separate proposed evaluation in ADR-531.

There is no general-purpose generated-code executor. A submitted plan is data only. Every step names a **trusted, previously registered** handler whose declared effect and capability must exactly match the plan. No untrusted script or callback is constructed from plan arguments.

```text
Declarative JSON plan
    |
    v
validate schema / size / ids / deps / cycles / budget
    |
    v
resolve exact trusted handler binding (effect + capability)
    |
    v
per-operation authorization (no inherited program-wide approval)
    |
    v
dependency-aware ready queue + critical-path priority
    |
    +--> serial deterministic reference
    |
    +--> bounded read-only parallel workers (max 8)
    |
    v
results + per-operation status + SHA256 receipt chain
    |
    v
MetaHarness evaluation / separately approved promotion (future)
```

## Trust boundaries

1. **Plan data:** The public API `compilePlan(unknown)` rejects unknown fields, invalid identifiers, cycles, missing dependencies, excessive graphs, oversized or prototype-polluting argument objects and nonsensical numeric estimates. Limit: 64 steps, 16 KiB per args value.
2. **Handler registry:** The host provides `{effect, capability, run}` for each exact handler name. A plan cannot relabel a `write` handler as `compute`, because mismatched metadata is refused *before* execution. Only registered `read` or `compute` handlers are usable in P0.
3. **Authorization:** `authorize(step)` is invoked for **each** operation immediately before its handler. A missing authorizer is a denial. The wall-clock deadline includes the authorization call.
4. **Execution:** Independent side-effect-free operations may overlap within 1..8 workers. Dependencies must complete before dependents begin. Any denial or failure stops subsequent dispatch, aborts already active cooperative work and drains its outcome.
5. **Sensitive effects:** `write`, `network`, `shell`, `secret` cannot run in P0. There is no bypass flag.
6. **CLI:** `adaptive` is marked observe-only to skip Ruflo's startup migrations, update/refresh or daemon writes. `plan` reads a regular, non-symlinked <=32 KiB manifest within the resolved project boundary; symlinked parent escape is refused. `bench` performs local timers only.
7. **Receipts:** Each operation records id, effect, individual policy decision, status, duration and output hash, never raw inputs/results. The receipt chains SHA256 from the canonicalized plan to each event. It is **tamper-evident only** and neither signed nor an external audit witness. ADR-322 signed Flywheel anchoring is mandatory before promotion.

### Important limitations

P0 is **not a security sandbox**. It trusts the host's handler implementations and cannot prove that a function labelled `compute` has no side effects. It cannot forcibly stop a hostile JavaScript callback ignoring AbortSignal, and timing a callback out cannot roll back effects it already caused. The production integration must use independently enforced tool permissions, operating-system sandboxing, an allow-listed adapter registry and transaction semantics before privileged effects are added.

The `maxEstimatedCostUsd` planning check is not a real provider-spend circuit breaker. P0 does not call paid models; cost is zero for *this* synthetic evaluator only.

## Scheduler algorithm

Acyclic directed graph; a stable ready queue picks available steps by descending estimated longest remaining path, then original input order. Running tasks occupy a bounded worker pool; newly unblocked dependencies may start without a full wave barrier. `serial` executes one at a time. `parallel` uses configured concurrency. `auto` requires multiple independent roots and meaningful estimated latency, otherwise serial.

The benchmark assesses concurrency `{1,2,4,8}` on a DEV set. To limit resource use and overfitting to tiny timing differences, selection chooses the **lowest concurrency within 10% of the best DEV median**, and never uses holdout results for selection. There is no WSP self-promotion.

## Synthetic benchmark: actual ruOS measurement

Environment: ruOS **Software Factory** desktop `815601f9e17de8`, Node **20.20.2**, isolated sparse checkout. Versioned code at **657e3c54970cdc86d5354418394c645f4e262847**. `vitest` runner from an existing local development install (v2.1.9), TypeScript compiler from that install; the `@claude-flow/cli-core` compatibility dependency was resolved locally from v3.7.4 while the target package lists 3.7.7. Exact clean-install CI remains unverified.

Corpus SHA256: `4f20582204e36ee702aa825a50e6505df72a19d99c653d8fde6f48b87d293b10`.

50 generated, reproducible six-operation DAGs, with fixed work durations and three dependency shapes. 20 DEV cases per candidate for concurrency selection; 30 **separate paired holdout** cases for evaluation. Both arms run the same tasks and identical host handlers in the same process. No API keys, network calls or inference spending. The results were recorded from an audited ruOS execution, not extrapolated from a marketing benchmark.

| Metric | Serial baseline | Adaptive P0 |
|---|---:|---:|
| DEV median (concurrency 1/2/4/8) | 32.999 ms | 16.955 / 13.140 / 12.645 ms |
| Selected concurrency | 1 | 4 (within 10% of fastest) |
| Holdout median | 31.700 ms | **12.413 ms** |
| Holdout p95 | 34.090 ms | **18.353 ms** |
| Holdout result parity | 30/30 | **30/30** |
| Policy reviews | 180 | **180** |
| Verified local receipts | 30 | **30** |

Median throughput-latency ratio: **2.554x**; p95 ratio: **1.857x**. Paired bootstrap 95% interval for the *ratio of medians* conditional on this synthetic corpus: **[2.258x, 3.110x]**, 400 seeded resamples. This measures scheduler latency on artificial timer workloads, **not** Claude Code, real repo edits, model quality, dollars per verified software fix, or comparative SOTA.

Test gate after optimizations: **22/22** Vitest tests passed in ruOS, including CLI invocation, ten adversarial manifest categories, denied privileged effects, exact handler metadata, timeout and hung policy checks, symlink escape, dependency and cancellation cases, receipt verification and holdout parity. Independent TypeScript checks of the new command and services returned zero diagnostics. Full monorepo CI / Node 22 and 24 package matrix have not run yet.

## MetaHarness lifecycle

Existing Ruflo `metaharness_bench`, `metaharness_mcp_scan`, `metaharness_threat_model`, Darwin `evolve` and signed Flywheel receipt/promotion entry points should be **reused**, not recreated. In P0 the new benchmark is deterministic and performs a DEV-only search, but it does **not** claim Darwin or signed Flywheel executed. Those integrations remain a review-gated P1 task.

P1 must construct frozen real software task suites with human verifiers, run the same frozen input on baseline and candidates, independently audit per-tool permissions and prove no privilege laundering. Include rejected adversarial programs, nested symlink paths, unauthorized writes, hidden subprocess or network activity, prompt injections and abort-ignoring handlers. The evaluator must bind source commit, dependency lock, task corpus, policy state and receipt signature.

## Reproduction

```bash
# In a clean checkout with @claude-flow/cli dev dependencies installed
cd v3/@claude-flow/cli
npm run build
npx vitest run __tests__/adaptive-execution-adr532.test.ts __tests__/adaptive-cli-adr532.test.ts

# After building CLI dist (no API calls, no write operations):
node bin/cli.js adaptive bench --dev 20 --holdout 30 --json
node bin/cli.js adaptive plan --path tests/fixtures/plan.json --json
```

The plan example requires a user-supplied JSON manifest at that path; it is not an included test fixture. API clients may call `executePlan` only with registered host functions and a per-step authorizer.

## Rollout and rollback

**P0:** Draft PR only. Keep every default route unchanged. Merging should require clean install, full CLI package build, security review and independent CI. No npm release or activation in this PR.

**P1:** 100+ real, paired software tasks and 20+ adversarial cases on clean isolated worktrees with a frozen holdout, independent judge, provider spend limits and operating-system effect confinement. Proposed gates: no unauthorized side effects, no more than 1 percentage-point absolute correctness loss (with uncertainty), p95 no more than 10% slower, and at least 20% better cost per verified success. Those thresholds are targets, not results.

**Rollback:** Delete/disable the optional `adaptive` CLI entry point. No production tasks, settings, memory or persistent scheduler configuration have been migrated; the existing serial and swarm execution paths stay unchanged.

## Security review questions

- Can each host adapter prove its effect class and attach the original tool policy decision, not merely trust a string label?
- Can cancellation be made enforceable through a process/container boundary for untrusted plugins?
- Will parallel read operations produce stable answers against mutable repos? Adopt commit/worktree snapshots.
- How are receipt chains sealed with ADR-322 signatures and replay verified against immutable code and policy?
- Are task subsets truly held out from Darwin/WSP tuning, and what is the cost per *verified solve* rather than timer throughput?

**Decision requested:** Review P0 as a **bounded execution substrate**, not a claim of beating current SOTA. Retain explicit human authority over privilege and promotion.
