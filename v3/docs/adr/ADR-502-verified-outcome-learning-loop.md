# ADR 502: a verified-outcome learning loop as a ruflo mod

Status: Accepted for stages 1–4 (built, tested against the mod harness and a live Claude Code 2.1.289 run; ships in ruflo-mods 0.8.0 and `@claude-flow/cli` 3.64.0, option off by default). Stages 5–7 of #4581 are deferred (section 7).

Date: 2026-10-29

Issue: [#4581](https://github.com/ruvnet/ruflo/issues/4581). Builds on: ADR-404 (ruflo as a Claude Code mod), ADR-075 (unified learning stats), ADR-150 (MetaHarness as a removable augmentation), #4134 (SONA routing gate).

## 1. Context

Ruflo's learner works when it is fed. One manual `trajectory-start` → `trajectory-step` → `trajectory-end(success)` produces a SONA pattern, EWC++ consolidation and a routing-gate status. On a default install it is starved of outcomes. Nothing calls `trajectory-*`. The feeders that exist record success without checking it:

- `post-edit` and `post-command` feed SONA whether the edit or command succeeded, never whether the task did.
- The `ruflo-autopilot` and `ruflo-loop-workers` coordinator prompts call `hooks post-task --success true` with success hard-coded (`autopilot-coordinator.md:40`, `loop-worker-coordinator.md:51`).
- `ruflo-mods` `guidanceLearning` records unverified observations and, by design, never trains.

None of these say whether the work actually passed. Neither the autopilot nor the loop-workers plugin records outcomes of any kind, so a fourth scheduler is not needed. The missing piece is a source of verified outcomes. This was the stage-1 audit, read-only.

## 2. Decision

An opt-in mod option, `learningLoop` (default off), and a CLI ingest step, split by what each side is allowed to do.

### 2.1 Mod side (`plugins/ruflo-mods/hooks/loop/`): observe and record

ruflo-mods may not run processes or call MCP tools, models or the network (smoke step 4). The loop therefore cannot run a verifier. It observes the verifiers the model runs:

- **`prompt.submit`**: opens a trajectory for the main loop's turn (task text cut to 300 characters, e-mail addresses replaced, and stored as `[redacted]` if it carries a secret shape; agent = the turn's route). It skips slash commands and projects without `.claude-flow/`.
- **`tool.call`**, after `next`, main loop only: records one step per finished call (tool name and success flag). A Bash command recognised as a verifier records its verdict:
  - Recognised commands include `npm|pnpm|yarn|bun test/build/typecheck/lint`, `vitest`, `jest`, `tsc`, `eslint`, `cargo test|build|check|clippy`, `go test|build|vet`, `pytest`, `dotnet`, `make test`, `mvn`/`gradle`.
  - The verdict is `passed` when Claude Code reported no error, i.e. the shell's exit status was 0.
  - An interrupted, backgrounded or timed-out run has no verdict.
- **`turn.complete`**, main loop only: decides the outcome.
  - `verified-success` when every verifier run after the turn's last edit passed.
  - `verified-failure` when any of them failed.
  - `unknown` when none ran after the last edit, the turn was aborted, or the turn edited nothing. A verifier verifies a change; "ran the tests and they passed" with no edit is not a task outcome, so it never trains.
  - The record is appended to `.claude-flow/data/verified-trajectories.jsonl`, capped at 500 lines. An unreadable file is never overwritten.

It never denies, rewrites or delays a call, and it adds no text to an answer.

**A masked exit status verifies nothing.** If the command contains a pipe, `||`, `;`, a background `&`, command substitution, a newline, or any segment other than `cd`, `export` or another verifier, it is not a verifier. So `npm test || true`, `npm test | tail` and `npm test && rm -rf dist` all leave the turn `unknown`. This is the rule against reward hacking. The model's words, including "all tests pass", are never read.

### 2.2 CLI side (`v3/@claude-flow/cli/src/memory/verified-outcomes.ts`): train and teach

- **`ruflo hooks verified-ingest`** and the MCP tool **`hooks_intelligence_verified-ingest`** read the records. `hooks_route` and `hooks_session-end` run the same ingest automatically. On an unchanged file this costs one `stat`.
- **Validation:** each record must have a fixed shape. A verified record must also carry the verifier that decided it, and that verifier must agree with the outcome. Unknown fields never survive.
- **Training:**
  - Only `verified-*` records train SONA (`processTrajectoryOutcome`).
  - `unknown` records are counted and never train.
  - Each record id is ingested once. A ledger in `verified-ingest.json` holds the last 2000 ids. The mod's file is never rewritten, because the mod appends to it concurrently.
  - Task text is PII-redacted before SONA's keyword store sees it.
  - Without SONA, verified records stay un-ingested for the next call rather than being marked done.
- **Lessons:** the ingest writes `.claude-flow/data/learned-lessons.json`.
  - It lists only patterns that verified outcomes trained.
  - Patterns at or above the 0.6 routing gate become `lesson`s.
  - Patterns with at least two verified failures, and more failures than passes, become `caution`s.
  - Each is cited as `L-<10 hex>`, a hash of the SONA pattern key, so the key's own text never reaches a prompt.
  - Each carries the verifier command as evidence.
- **Routing:** `hooks_route` already consults SONA patterns above the gate (#4134), so verified patterns reach routing with no further change.
- **Doctor:** `ruflo doctor --component learning-loop` reports turns recorded and verified, and what has been trained. It warns when verified outcomes are waiting to be ingested.

### 2.3 Lessons back into the prompt

On `prompt.submit` the mod reads `learned-lessons.json` (cached by size and mtime). It adds at most three lessons that share a keyword with the prompt, as one `[RUFLO_LESSONS]` context block. Each lesson carries its id, confidence, and passed/failed counts.

The file is project-writable, so it is untrusted:

- Every field is validated to a fixed shape.
- A `lesson` below 0.6 is dropped whatever `gate` the file claims; a file cannot lower the gate.
- A block that fails the shared secret or injection screen is dropped whole.

The injection point is `prompt.submit` context, the same place the route block uses. The issue proposed `prompt.compose`, but `prompt.compose` is not among the mod's hooked events (smoke step 5), and `modTrust` names it risky. Reusing the existing point adds no new capability.

## 3. Deviations from the issue's sketch, and why

| Issue | Here | Why |
|---|---|---|
| Verify with `$.process` (tests/build) and `metaharness_score` | Observe the model's own verifier runs; MetaHarness not called | ruflo-mods may not run processes or call MCP tools (smoke step 4). The exit status is still the shell's, not the model's. MetaHarness stays removable (ADR-150) and can be added CLI-side at ingest later. |
| Lessons via `prompt.compose` | `prompt.submit` context | Same injection point as routing; no new risky event. |
| "SONA trained only from verified outcomes" | Only the loop's records are gated | `post-edit`, `post-command` and the coordinators' `post-task --success true` still feed SONA unverified (section 1). Changing them changes default behaviour for every install and is left to a follow-up. The loop's lessons are built only from patterns verified records trained. |
| Live pane, band, toasts | A `loop ✓n ✗n ?n` status-line part and a `/ruflo-mods` `loop:` row | Smallest useful surface; a pane is stage 5. |

## 4. Safety

- Default off.
- Inert outside a ruflo project.
- Main loop only.
- Observe-only on tool calls.
- Bounded:
  - 64 steps per trajectory;
  - 50 records waiting for a write;
  - a 500-line file;
  - 3 lessons per prompt;
  - a 2 MiB file read limit in the CLI.
- Local only; nothing is shared.

**Privacy limit.** The jsonl keeps the prompt's first 300 characters. Before writing, the mod replaces e-mail addresses with `[email]` and stores a prompt that carries a secret shape as `[redacted]`. The CLI's broader PII redaction (`detectPII`/`redactPII`) runs at ingest, before SONA sees the text, not before the mod writes the file. The issue asked for a PII scan before persisting; the mod cannot call `aidefence_has_pii` (an MCP tool), so other PII in a prompt can sit in that local file until the 500-line cap drops it.

## 5. Verification

- `v3/@claude-flow/cli/__tests__/mods/mods-learning-loop.test.ts` (19 tests), which CI runs in `mod-guidance.yml`:
  - verifier recognition and refusal of masked statuses;
  - outcome decided on runs after the last edit;
  - off by default and inert outside a project;
  - subagent, aborted and tool-less turns;
  - calls never changed;
  - an unreadable file kept and the 500-line cap;
  - the lessons gate, hostile files and the three-lesson cap;
  - the CLI ingest: verified-only training, once only, malformed and inconsistent records rejected, SONA unavailable, dry run, PII redaction, cautions;
  - an end-to-end run through the real `SONAOptimizer`: three verified passes cross the gate and come back as a cited lesson on the next prompt, while an unverified turn on the same task moves nothing.
- `mods-all-options-load.test.ts` loads the mod with every boolean option on, including `learningLoop`, so the #4485 double-registration failure cannot recur.
- A live run in Claude Code 2.1.289 with `--plugin-dir` is recorded in [ruflo-mods-learning-loop-2026-10.md](../validation/ruflo-mods-learning-loop-2026-10.md).

## 6. Not yet shown

Issue §7 asks for evidence before this ships on by default: a baseline against loop-enabled runs over 30 or more comparable tasks, measuring verified success rate, routing accuracy, cost per verified success, and pattern hit-rate. That has **not** been run. The option stays default-off until it is.

## 7. Deferred (follow-ups on #4581)

- Stage 5: a console pane and band (stage, iteration, spend, confidence against the gate).
- Stage 6: an autonomous `/loop-run` with max iterations, spend cap, no-improvement window, approvals and rollback.
- Stage 7: self-tuning, i.e. MetaHarness `drift_from_history` monitoring and human-approved GEPA proposals.
- Gating the existing unverified feeders (section 3).
- A cleanup tool for benchmark/test memory entries.
