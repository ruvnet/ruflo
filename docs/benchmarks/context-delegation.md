# Bounded context delegation: before and after evidence

This report measures the new core delegation protocol with an explicitly deterministic extractive worker. It makes no claim about live model accuracy, billed savings, token counts or inference latency.

## Scope

The before reference sends the entire source snapshot and question to the coordinator. The after path runs the production `delegateContextRead` service with a fixture adapter, then sends its complete cited result and receipt to the coordinator. This baseline is a reconstructed transport reference, not an instrumented historical Ruflo or Claude Code session.

Sources are three public, tracked Ruflo files pinned to commit `3667ba6573ef811383881f8a887978798bf2113d`: the global AI budget, headless worker executor and worker queue. Thirty fixed declaration lookup questions run ten times each. The oracle worker uses the expected target line, solely to isolate transport fidelity and validation. It does not solve the questions with a model. Questions do not provide line offsets, but these simple lookups could also be answered using local search; no claim of optimal routing follows from this corpus.

The measured source manifests bind the production service, public and hook integration, tests, typecheck configuration, corpus, benchmark and verifier. An independent reviewer replayed the benchmark and checked arithmetic and hashes. The current recorded evidence must be verified against the exact source bytes; changing a bound file requires rerunning it.

## Recorded results

See the exact metrics and raw samples in [results.json](../../v3/@claude-flow/cli/benchmarks/context-delegation/results.json). Rounded aggregate observations:

| Metric across 300 paired samples | Before | After |
|---|---|---|
| Coordinator payload | About 9.31 MB | About 0.23 MB |
| Coordinator payload reduction | Baseline | About 97.6% |
| Worker input | None | About 9.36 MB |
| Worker output | None | About 0.09 MB |
| Total boundary bytes | About 9.31 MB | About 9.67 MB |
| Total boundary increase | Baseline | About 3.8% |
| Exact facts and quote provenance | Fixed fixture | 300 of 300 matched |

Local processing overhead is submillisecond at the median in the recorded run. See raw p50/p95 timing and cold module import separately in results. This timing omits inference and network work and cannot forecast end to end production latency. There are 30 independent cases with 10 repetitions, not 300 independent questions. Receipt duration changes serialized lengths slightly across runs; percentage claims are rounded and results are not bit identical.

The primary result is reduced coordinator payload accompanied by increased aggregate transport. A cheaper worker may make this economically useful, but provider tokenization, cache behavior, output charges, retries and omissions determine the real result.

## Reproduce and verify

Use Node 24 for native TypeScript stripping in the benchmark. The production source is ordinary TypeScript targeting the existing Node runtime. Install the repository's locked development dependencies for tests and type checking. A shallow clone must first fetch the pinned baseline commit; CI uses a full checkout.

```bash
git fetch origin 3667ba6573ef811383881f8a887978798bf2113d
npm ci --ignore-scripts --legacy-peer-deps
node_modules/.bin/tsc -p v3/@claude-flow/cli/tsconfig.context-delegation.json
cd v3/@claude-flow/cli
../../../node_modules/.bin/vitest run __tests__/context-delegation.test.ts
cd ../../..
node v3/@claude-flow/cli/benchmarks/context-delegation/verify.mjs
node v3/@claude-flow/cli/benchmarks/context-delegation/run.mjs /tmp/context-delegation-results.json
node v3/@claude-flow/cli/benchmarks/context-delegation/verify.mjs /tmp/context-delegation-results.json
```

The benchmark alternates baseline/candidate order, excludes 30 warmup runs, records 300 paired timing samples, verifies each exact quote and requires at least 70% coordinator byte reduction. That threshold is a protocol regression gate for this fixed corpus. It is not a deployment target.

Files:

1. [Frozen corpus](../../v3/@claude-flow/cli/benchmarks/context-delegation/corpus.json)
2. [Benchmark executable](../../v3/@claude-flow/cli/benchmarks/context-delegation/run.mjs)
3. [Recorded raw results](../../v3/@claude-flow/cli/benchmarks/context-delegation/results.json)
4. [Evidence verifier](../../v3/@claude-flow/cli/benchmarks/context-delegation/verify.mjs)
5. [Acceptance tests](../../v3/@claude-flow/cli/__tests__/context-delegation.test.ts)
6. [Architecture decision](../../v3/docs/adr/ADR-521-bounded-context-delegation.md)

## Host integration example

```ts
import { delegateContextRead } from '@claude-flow/cli';

// trustedHostAdapter must enforce source permissions, provider destination,
// model budget, no tools/MCP, transport size limits and cancellation.
const result = await delegateContextRead({
  read: { mode: 'enforce', intent: 'analysis' },
  question: 'Which declarations define the launch limits?',
  sources: authorizedSnapshots,
  adapter: trustedHostAdapter,
  signal: callerAbortSignal,
});
if (result.status === 'delegated') presentAsUntrustedEvidence(result);
else if (result.status === 'escalate') requestAuthorizedTargetedRead(result.reason);
else preserveDirectRead();
```

Planning can be inspected without reading source or invoking inference:

```bash
ruflo hooks context-plan --bytes 52000 --files 1 --mode observe --worker-available
```

This command returns an advisory plan. Automatic tool interception remains disabled. An optional fixed destination Anthropic adapter is available to an explicitly configured trusted host; it is never activated implicitly. Code generation and automatic writes are outside this implementation.

## Remaining evidence gate

Before enabling host interception, run a held out analysis corpus through a real governed adapter and coordinator. Record actual billed input/output/cache usage for both models, answer quality, fallback rate, retries and complete latency. Preserve the existing global launch fuse; its default limits must not be silently relaxed for a benchmark. Proposed acceptance: at least 30% lower total billed cost, no critical omissions, and no more than 20% median latency increase.


## Optional provider adapter and resumable live pilot

`createAnthropicContextAdapter` implements an actual fixed destination HTTP transport. Its policy descriptor discloses both token counting and generation endpoints. The corpus is transmitted twice per successful invocation. The earlier deterministic byte table measures the core protocol boundary and excludes these provider wrappers, token counting traffic and provider response envelopes. Do not use that table as an actual HTTP network saving claim.

The adapter omits tools, MCP and containers, rejects redirects and handles real chunk limits, timeouts, launch reservations and quota circuit updates. It preserves provider usage even when output is rejected. Captured cache categories are priced from the exact supplied model price snapshot; generated usage is discarded. Supplied prices are an operator assertion. Calculated usage priced cost is not a reconciled bill. Preflight ceilings and overrun detection do not undo a provider charge.

[Provider tests](../../v3/@claude-flow/cli/__tests__/anthropic-context-adapter.test.ts) and [runner integration tests](../../v3/@claude-flow/cli/__tests__/context-provider-pilot.test.ts) use mocked transports and policy decisions, with no provider calls. Runner tests exercise all three phases, an enforce to observe change, changed runtime bytes, quota pause/resume, uncertain charges and failed fsync before dispatch.

Run the zero network preflight on Node 24:

```bash
node v3/@claude-flow/cli/benchmarks/context-delegation/provider-pilot.mjs
```

[Recorded preflight](../../v3/@claude-flow/cli/benchmarks/context-delegation/provider-preflight.json) reports the observed missing runtime credential binding and unchanged launch limits. The stored vault key was not read or exported. A working Claude subscription login was not used as a substitute for API cost evidence. No HTTP API inference was performed. A later separate subscription attempt timed out with unknown cost, as recorded below.

An authorized operator with an existing API key binding, a normally built CLI and enforce mode policy can run the same command with `--execute --config /owned/pricing.json --state /owned/private/checkpoint.json`. The checkpoint directory must already be private and owned by the executing user. No new policy permission is granted by the script. Its policy resource is `context.read.delegate`, action `context.read.delegate`, with `network: true`, concurrency one and the stated cost/token bounds.

The config must provide `coordinator` and `worker` price snapshots, each with `model`, `inputUsdPerMillion`, `outputUsdPerMillion`, `cacheReadUsdPerMillion`, `cacheWrite5mUsdPerMillion`, `cacheWrite1hUsdPerMillion`, `source` and `observedAt`, plus `maxCostUsdPerCall`. Verify the exact available model IDs and current prices first. There are no built in prices or guessed model defaults. The requested aggregate ceiling is three times the per call ceiling, before any detected provider usage overrun.

Each phase is durably checkpointed with file and directory fsync before dispatch. Resumes bind configuration, fixed public fixture, question, runner, all built CLI files, core source and lockfile hashes. Runtime dependencies and OS binaries are outside this manifest. Failed or uncertain potentially charged calls cannot automatically repeat. Confirmed budget blocks can resume in a later window. The default two launches per hour means a three call comparison cannot finish in one hourly window; quotas are never raised. The checkpoint retains attempts and marks missing late usage as charge uncertain, requiring reconciliation before a new pilot.

The completed pilot reports baseline usage priced cost against worker plus routed coordinator cost, active processing time and elapsed wall time including resume waits. The frozen question tests six budget behavior facts and still requires human semantic review. A single pilot cannot satisfy the held out deployment acceptance gate. Live API economics, semantic quality and latency remain unmeasured until the credential and policy prerequisites are met.

## CI compatibility and first subscription attempt

The first full CI run exposed two runner test fixture errors. Root CI uses Node 20, which cannot directly import the pilot's TypeScript dependency. The native runner suites now run only on Node 24 or newer, and the dedicated Node 24 workflow always runs them. Core and HTTP adapter contracts remain active on Node 20. The second failure came from a shallow checkout missing the historical corpus commit. Mock runner fixtures now create their own local Git repository and fixture commit. Seven tests also passed independently in a temporary tree with no parent `.git` or historical objects. The production corpus remains unchanged.

A separate [manual ruOS subscription experiment](../../v3/@claude-flow/cli/benchmarks/context-delegation/subscription-pilot.mjs) exercises the production core with the existing native Claude Max login. This is not a replacement for the enforce mode HTTP pilot. It records the host's actual policy mode and both observed/enforced outcomes without changing them. The observed host was in legacy mode; a denial in either outcome blocks the experiment.

The helper verifies subscription authentication metadata, rejects competing provider environment routes, binds the selected executable's realpath/hash/version, disables customizations, tools and MCP, and requires empty capabilities in the streamed initialization. It uses the existing global fuse, an exclusive checkpoint lock, durable intent, a maximum 55 second process deadline and the CLI's $0.05 API equivalent budget flag. That flag is not an invoice guarantee. Actual reported cost must be finite, and overruns fail the result. Process termination is confirmed before permit release. Failed or uncertain phases block every later phase. Streamed usage is retained even if the native CLI hangs after returning a result. Seventeen mocked native contracts cover these controls.

The [first live attempt](../../v3/@claude-flow/cli/benchmarks/context-delegation/subscription-live-attempt.json) launched one baseline process at 18:26 UTC on November 1. It reached its 55 second process deadline, was killed, and termination was confirmed. No successful completion or usage receipt was retained. The attempted runner only attached initialization metadata after successful process completion, so this evidence cannot establish whether initialization or other stream events were emitted before termination. The revised runner retains those events as they arrive.

Actual model call count, API equivalent cost and any quota consumption remain unknown. The attempt was not repeated. Its exact attempted runner source and hashes are archived in the JSON evidence; the revised helper is deliberately a different source identity and cannot resume that checkpoint. The global launch ledger subsequently reported one launch and zero active reservations. This proves bounded process cleanup, not successful inference, live tool isolation or savings.

Reapplying the same existing ruOS Anthropic route returned success but did not export the API key into the shell. Unauthenticated connectivity checks reached the API root with HTTP 404 and the public Claude website with HTTP 403; these do not establish the cause of the native timeout. No credential values were read, copied or printed.

Root CI also reported a stored pattern/search assertion outside this change. An unchanged baseline passed that focused suite under Node 24 with sql.js, while failing CI used Node 20 and a native SQLite backend. That is not sufficient to attribute the failure or call it flaky. The runner test repairs are verified separately; whole repository CI status must still be checked.
