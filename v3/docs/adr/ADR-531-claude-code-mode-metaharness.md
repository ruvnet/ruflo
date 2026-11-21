# ADR-531: Claude Code experimental Code Mode as a governed MetaHarness evaluation profile

- **Status:** Proposed
- **Date:** 2026-11-15
- **Owner:** Ruflo maintainers
- **Tracking:** [#4998](https://github.com/ruvnet/ruflo/issues/4998)
- **References:** ADR-150, ADR-153, ADR-322, ADR-404, ADR-526, ADR-527, ADR-529, ADR-530
- **Upstream requirements:** https://code.claude.com/docs/en/code-mode

## Decision

Do not turn on Claude Code Code Mode in Ruflo's shared project settings or default agent-team runtime. Treat it as a separate, **user-initiated native terminal experiment**, not a new production orchestration backend. First ship a non-mutating preflight, reproducible evaluation contract and instructions. An interactive maintainer may enable it using **their own** environment or user settings only after inspecting conflicts; a future promotion requires security and benchmark evidence reviewed by a human.

No change to `.claude/settings.json`, managed settings, plugin permissions, MCP routing or release behavior is authorized by this ADR. Do not disable telemetry, safeguards, installed mods, or agent teams for existing projects just to force the experiment to start. Use a dedicated isolated lab project if the current project is incompatible.

## Context and primary-source observations

Claude Code v2.1.323 added experimental Code Mode: the model writes JavaScript executed by a `REPL` tool to orchestrate ordinary Read, Edit, Bash and other tool invocations. A program can batch parallel operations and pass outputs between calls. Individual tool calls still traverse `deny`/`ask` rules and `PreToolUse` hooks, but the **auto-mode classifier reviews the submitted program only once**. The JavaScript may compute arguments after that review; do not mistake a one-time classifier pass for per-operation security validation.

The upstream implementation is restricted to an **interactive native Claude terminal** using eligible Anthropic accounts and models, not `claude -p`, Agent SDK, VS Code panel, Desktop, cloud sessions, or provider gateways. Agent teams and some installed mods that check tool calls are incompatible. Code Mode is off by default, cannot be enabled by project-level settings, and asks for confirmation on first start. Some org-managed settings can block it. The feature may change or be removed without notice.

Current Ruflo `.claude/settings.json` sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, enables function hooks and enables `ruflo-mods@ruflo`. This is **not** a configuration where Code Mode can be assumed to start. The repository also has wide `Bash` allow rules; these are not a security sandbox. PR #4966 proposes isolated MCP workspaces and PR #4991 strengthens helper signing/symlink defenses, but both were open when this ADR was drafted; neither is a reason to claim isolation or helper integrity already shipped.

Ruflo already exposes `ruflo metaharness score`, `genome`, `mcp-scan`, `threat-model`, `bench`, `redblue`, `evolve`, `gepa` and `flywheel`. ADR-526 makes `@metaharness/darwin` available in-process for some benchmark and GEPA operations. Reuse these surfaces; do not create a competing evaluator or promise unimplemented Code Mode MCP APIs.

## Profiles and trust boundaries

| Property | Default Ruflo swarm | Code Mode lab |
| --- | --- | --- |
| Execution host | Existing Claude Code / Codex / MCP and supported headless flows | Interactive native Claude terminal only |
| Agent teams | Preserved and enabled as configured | Not available; maintain a separate lab project/profile |
| Opt-in | Existing explicit permissions | User shell or user-level setting only; never repository settings |
| Policy | Per-tool permission hooks, policy runtime, workspace ownership | The same underlying tool hooks **plus** optional `PreToolUse` `REPL` inspection; neither replaces OS isolation |
| Evaluation | Existing tests, MetaHarness and CI | Matched baseline/candidate corpus, immutable receipts, manual promotion |
| Failure fallback | Current execution behavior | Exit and relaunch ordinary Claude session; never auto-disable security to recover |

Ruflo remains the coordinator and policy ledger; Claude Code remains the tool executor. Code Mode is an alternate scheduling surface owned by Anthropic, not a new privilege. A batch does not inherit authority for commands it composes at runtime. For writes, command launches, network, secrets and publish, enforce authorization **at the underlying tool and OS boundary**, and preserve a separate result/audit event for each operation. `REPL` inspection adds defense in depth only. No silent promotion, self-assigned permissions, budget expansion or file-tree escape.

## MetaHarness integration

1. **Baseline and inventory**: run `ruflo metaharness score --path .`, `genome`, `mcp-scan --fail-on high` and `threat-model`. Snapshot exact git SHA, Node, Claude version, model, mode and plugin versions. An unavailable optional integration is marked **degraded**, never silently counted as a pass.
2. **Threat scenarios**: use `redblue` or deterministic fixtures to test prompt injection in search results, dynamic Bash command construction, symlink traversal, path escape, secret reads, network egress, unauthorized git push, tool timeout, partial failure, and delayed writes. Native OS sandbox and per-tool hooks are required; command-string deny patterns alone do not suffice.
3. **Darwin benchmark**: create/freeze a benchmark corpus through `metaharness bench` with at least 30 paired ordinary tasks and 10 hostile tasks. Use the same exact worktree snapshot, model, authorization, temperature/settings where supported, tool versions and warm-cache protocol. Repeat randomized A/B order to reduce cache and learning effects. No `claude -p` stand-in for Code Mode: the lab is necessarily interactive until Anthropic supports headless automation.
4. **Optimization**: only once baseline and candidate are measured, let `@metaharness/darwin` search scheduling/batch parameters within fixed safe limits. It may propose a variant, never grant authority or decide promotion. Avoid optimizing raw calls/sec at the expense of verified solves.
5. **Flywheel receipts**: record input hash, immutable repo ref, environment and capability profile, paired correctness, per-call denial events, p50/p95 time, tokens, dollar cost, failures and rollback artifact. The existing Flywheel signed/anchor-surviving receipt and explicit policy-gated promote path (ADR-322) is the promotion mechanism; do not build another. Since external Claude REPL events may not yet be exported, receipt and provenance integration is a **follow-up**, not a delivered property of this ADR.

### Measurement contract

Primary outcome: **cost per verified correct task**, with no regression in policy enforcement. Secondary: wall latency p50/p95, total tool calls, tokens, actual paid model cost, failure/retry count, human interventions and full audit coverage. Maintain task-level paired outcomes, not aggregates only.

Proposed promotion gates (unverified design thresholds): zero unauthorized writes/egress/secret disclosures on hostile cases; every relevant denied call has an attributable record; correctness drop no more than 1 percentage point; p95 latency no more than 10% worse; plus either 15% better median end-to-end latency or 20% lower measured tool/LLM cost. Because 30 samples have wide confidence intervals, extend the corpus or decline promotion when the lower confidence bound is inconclusive. Separately cap experiment spend before running paid tasks.

No benchmark, compatibility trial, REPL audit integration or performance improvement is claimed as completed in this decision.

## Implementation phases

**P0: This PR.** Read-only `scripts/claude-code-mode-preflight.mjs`, Node built-in regression tests and a short CLAUDE.md section. Detect installed version, explicit off/on precedence, project-only opt-in, agent teams, some common API/telemetry conflicts and probable mod conflict without writing settings or printing credentials. A green result only means *eligible for a manual attempt*, not that Code Mode is available. CI tests deterministic code only, no Claude invocation or paid API calls.

**P1: Human-supervised lab.** Maintain a separate clean project profile with explicit user opt-in. Run normal Claude baseline and interactive Code Mode on isolated identical snapshots. Verify tool-level hooks, REPL guard, session controls, and MetaHarness receipt quality. Preserve the normal agent-team path as untouched control.

**P2: Protected release option.** If and only if gates pass, implement a distinct opt-in execution profile with feature negotiation, explicit spend/operation ceilings and a user-visible rollback. Only add headless or team support if Anthropic actually ships it and the corresponding tests pass.

## Failure modes and mitigations

| Failure mode | Mitigation / acceptance test |
| --- | --- |
| Single auto review cannot see computed arguments | Per-call deny/ask and pre-tool policy, native sandbox, hostile dynamic-path tests |
| Existing project agent teams prevent startup | Preflight blocks and points to isolated lab, never rewrites default settings |
| Installed tool-checking mods prevent startup | Warn and require explicit compatibility test; never disable protection automatically |
| Unexpected writes from malformed flags or wrapper | Read-only preflight plus regression for no mutation and secret-free output |
| PR #4991 signing not completed | Do not merge unsigned helper path; keep Code Mode work independent |
| Command batching hides partial failures | Operation-level receipts, stop/rollback on first disallowed mutation, explicit status for each call |
| Baseline/candidate environment differs | Pin sha, model, Node, tooling, worktree, prompt corpus; pair tasks |
| Unexpected provider cost | Hard experiment budget and operator permission before any paid run |
| Optional MetaHarness component unavailable | Explicit degraded result; no promotion on missing evidence |

## Alternatives rejected

- **Enable in shared `.claude/settings.json`:** Anthropic ignores repository-scoped Code Mode opt-in; existing agent-team setting is incompatible.
- **Rewrite every MCP tool as JS batches:** creates duplicated authorization/scheduling logic and does not make native Anthropic Code Mode available to SDK/headless hosts.
- **Accept improved token counts as proof:** omits task correctness, host security regressions and actual cost.
- **Disable mods or telemetry globally:** breaks existing governance and observability for an unproven experiment.

## Rollback and review

No data-plane change in P0. Remove the opt-in variable from the user's shell/user settings (or explicitly set `0`) and start a fresh normal session; Code Mode sessions are only resumable with Code Mode on. Remove this PR's documentation/preflight files if needed. Never migrate active project state to a Code Mode-only session without explicit review. Any P2 activation must have a separately reviewed rollback plan.

**Acceptance for P0:** tests pass on Node 20+; current repo's preflight reports blocked because agent teams are on, without printing any secret values or mutating config; docs align with Anthropic's current Code Mode requirements; MetaHarness evaluation remains future work under #4998.
