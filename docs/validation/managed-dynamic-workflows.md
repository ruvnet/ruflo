# Managed dynamic workflows validation

This records the initial adapter stage. See the [console and verified learning validation](managed-learning-console.md) for the latest expanded integration results.

Date: 2026-10-24. Baseline: `973d0ab497c9138d7bee1dc3c7a4d3985e37bf9e`.
Scope: existing Managed Agents REST adapter, incremental event reducer,
plugin guidance, and isolated CI contract. No dependency or lockfile changes.

## Results

| Check | Result |
| --- | --- |
| Provider fixtures and existing no-key tool contract | 87 tests passed |
| Adjacent persisted workflow validation/resume/ownership | 21 tests passed |
| Strict TypeScript check of adapter and imported service | Passed |
| ruflo-agent plugin smoke | 16 passed |
| ruflo-workflows plugin smoke | 18 passed |
| CLI/MCP registration audit | 413 registered, zero dangling references |
| Tool discoverability audit | 411 scanned, zero missing guidance/short/duplicate descriptions |
| Ruflo 3.25.6 deep code security scan, adapter and seven hook files | Zero scanner findings |
| Independent source review | Six confirmed defects corrected and covered by fixtures |
| Whitespace/diff integrity | Passed |

Scanner coverage is heuristic and scoped. It is not a dependency advisory audit
or proof of security. No dependency changes were introduced. Existing whole
repository dependency exposure is outside this patch's assessment. Advisory
feeds were not queried. The threat model and specific attack regressions are
in [ADR 0003](../../plugins/ruflo-agent/docs/adrs/0003-managed-dynamic-workflows.md).

The independent reviewer identified stale final-idle completion, interruption
completion, valid confirmation result unions, historical-run contamination,
missing run IDs and nested usage accounting. All six have regression fixtures.

## Reproduction

With repository development dependencies installed, from `v3/@claude-flow/cli`:

```sh
npx vitest run --config vitest.config.ts \
  __tests__/managed-agent-tools.test.ts \
  __tests__/managed-workflows.test.ts \
  __tests__/managed-mod-integration.test.ts \
  __tests__/workflow-validation-runtime.test.ts \
  __tests__/workflow-resume-dispatch-r50.test.ts \
  __tests__/workflow-progress-ownership-r50.test.ts
```

From the repository root:

```sh
npx tsc --target es2022 --module nodenext --moduleResolution nodenext \
  --strict --skipLibCheck --types node --noEmit \
  v3/@claude-flow/cli/src/mcp-tools/managed-agent-tools.ts
bash plugins/ruflo-agent/scripts/smoke.sh
bash plugins/ruflo-workflows/scripts/smoke.sh
node scripts/audit-cli-mcp-tools.mjs
node scripts/audit-tool-descriptions.mjs
git diff --check
```

Actual local tooling: Node 24.22.1, Vitest 3.2.6, TypeScript 5.9.3, and the
Ruflo security scanner pinned to 3.25.6. The GitHub workflow installs isolated
Vitest 3.2.6, TypeScript 5.9.3, Node 22 types and cli-core 3.7.5 with lifecycle
scripts disabled. No provider key is needed by CI.

The scanner was run read-only against copies of
`managed-agent-tools.ts`, `managed-workflows.ts`, and the seven changed hook
files in the agent and workflow mods, using:

```sh
npx -y @claude-flow/cli@3.25.6 security scan \
  --target /tmp/ruflo-managed-audit --depth deep --type code
```

## Measured optimization

Run on Node >=22.18, with the baseline commit available locally:

```sh
node scripts/bench-managed-workflows.mjs
```

The benchmark executes the exact original summarizer extracted from the frozen
baseline source, compares incremental reduction with repeated full-history
summarization, verifies equal assistant text and alternates timing order after
warmup. Both timings include output assembly. Nine measured repetitions, 5,001
events, 51 observations. The source hashes are in the
[JSON receipt](../benchmarks/managed-dynamic-workflows.json).

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| Median local processing | 10.287 ms | 6.097 ms |
| Events visited | 132,501 | 5,001 |

This sample is 1.69 times faster with 96.2% fewer event visits. It does not
measure provider latency, tokens, billing, model quality or bug-finding recall.
Inclusive watermarks can replay multiple events sharing a timestamp; those
events are deduplicated rather than counted twice.

## Limits and next adoption gate

The live Anthropic API was not invoked. All provider tests use deterministic
HTTP fixtures. The full monorepo suite was not run; the focused boundary and
adjacent workflows were tested. Hosted GitHub CI is a separate observation.

Before broad adoption, the maintainer should validate one live session with a
small cents budget, minimal network access and a non-sensitive fixture, inspect
every worker transcript, independently reproduce results, and explicitly delete
the session and owned resources. Then compare single agent, current Ruflo swarm
and managed workflows on the same frozen corpus at equal dollar budgets over
three runs. Suggested adoption gate: at least 10% more reproducible findings per
dollar, no higher false-positive rate, and verified interruption/deletion.

No claim of improved model quality or production readiness follows from the
synthetic optimization. Keep the PR in draft until live validation is recorded.

## Mod and plugin refinement

The follow-up adds 27 tests exercising real registered hook functions, policy
settings, local capability discovery, no-network runtime introspection, workflow
mod routing and compatibility with the existing console parser. Combined focused
and adjacent suite: 108 passing tests. The original hosted Managed dynamic workflows
contract passed before this refinement; new hosted checks must run on the updated
commit. Plugin versions are raised to agent 0.4.0 and workflows 0.7.0 so installed
copies receive the shipped behavior.

The native Claude plugin test runner was not invoked. Hook execution is covered
by a deterministic test harness using the existing hook call pattern; the real
host remains a separate compatibility check. Console parser integration is tested
without changing the console plugin. The mod is a local admission constraint, not
an organization-wide spend controller.
