# ADR 503: hardening the verified-outcome learning loop against gamed signals

Status: Accepted (implemented in PR pending; see section 6)

Issue: #4581 follow-up 6. Builds on: ADR-502 (the loop, on by default since 3.64.0).

## 1. Context

ADR-502 trains SONA from turns whose outcome was decided by the exit status of a recognised test, build, typecheck or lint command.

The exit-status rules already cover two things:
- They refuse masked statuses: `|| true`, pipes, `;`, background jobs, command substitution, and segments that are not verifiers.
- They require at least one edit in the turn.

Four gaps remain.

- **The model controls what the verifier checks.** All of the following exit 0 honestly:
  - deleting or weakening a failing test;
  - marking a test `.skip`;
  - adding `--passWithNoTests`;
  - narrowing the command (`vitest run one-file.test.ts`);
  - editing the `test` script in `package.json` so `npm test` runs nothing.
- **The session reports its own results.** `verified-trajectories.jsonl` is a project file. Anything that can write to the project can append `verified-success` lines.
- **A single fixed check loses value over time.** Research on reward hacking (Anthropic, arXiv 2511.18397) finds that any fixed proxy is eventually gamed. That study trains model weights and ruflo's loop does not, so this is a design caution, not measured evidence about ruflo.
- **There is no baseline yet.** The §7 evaluation has not been run, so drift cannot be detected against anything.

## 2. Decision

Four layers, cheapest first. A layer can only downgrade a record (`verified-success` → `unknown`). No layer can upgrade one.

### 2.1 Mod: tamper signals within the turn

This layer needs no extra process. The mod already sees every finished tool call, so it can record which files were edited in each trajectory. At the end of the turn it adds taints to a `verified-success` record:

| Taint | Set when |
|---|---|
| `edited-tests` | An edited path is a test file: `*.test.*`, `*.spec.*`, anything under `__tests__/` or `tests/`, `test_*.py`, `*_test.go`, `*_test.rs`. |
| `edited-verifier-config` | An edited file can change what a verifier checks: `package.json`, `vitest.config.*`, `jest.config.*`, `pytest.ini`, `pyproject.toml`, `setup.cfg`, `tox.ini`, `Cargo.toml`, `go.mod`, `tsconfig*.json`, `.eslintrc*`, `eslint.config.*`, `Makefile`. |
| `narrowed-verifier` | The deciding command weakens or narrows the check: `--passWithNoTests`, `-t`/`--testNamePattern`/`-k`, `--skip`, `--exclude`, `--testPathIgnorePatterns`, or a test runner given one test-file argument. |

The record keeps its outcome word. The taints travel with it as `taint: [...]`.

### 2.2 CLI: tainted records do not train

`ingestVerifiedOutcomes` treats any tainted record as `unknown` for training:
- It is counted under a new `tainted` total.
- It is never sent to SONA.

A project can opt individual taint classes back in by setting `learningLoop.allowTaint` in `.claude-flow/config.json` (for example `["edited-verifier-config"]`). By default no class is allowed.

### 2.3 CLI: re-verify before training (opt-in, rotating)

This layer is controlled by `learningLoop.reverify` in `.claude-flow/config.json`. It is **off by default**, because it runs project code. When it is on, ingest re-runs a verifier before it trains a `verified-success` record:

- **Where it runs:** in a temporary detached `git worktree` at the current `HEAD`. The record stores which commit was used.
- **How long it may take:** a hard timeout, 300 s by default. On timeout, on any error, or on a non-zero exit, the record is downgraded to `unknown`.
- **Which check runs:** the checks rotate. When the project has more than one recognised verifier script (`test`, `typecheck`, `build`, `lint` in `package.json`, or `cargo test`/`cargo check`), ingest runs one the record did **not** use, round-robin across ingests. This way the model cannot learn which single check counts.
- **What it may run:** only commands from a fixed allowlist built from the project's own manifest. Text from the record is never executed.

### 2.4 CLI: anomaly gate on lessons

Before `buildLessons` turns a pattern into a prompt lesson, it holds the pattern back if any of these is true:

1. Its success rate is 100% over 8 or more records, and half or more of them carried an allowed taint.
2. Every success came from a narrowed (single-file) command.
3. All its successes arrived within one session, so there has been no independent repetition.

A held pattern stays in SONA, where routing still sees it only through SONA's own 0.6 gate. It never becomes a prompt lesson. `ruflo hooks verified-ingest` lists each one as `held: <id> (<reason>)`.

## 3. The evaluation that is still owed

A new script, `scripts/eval-learning-loop.mjs`, will:

- run a fixed set of 30 tasks with `claude -p`, once with `learningLoop` off and once with it on, using lessons pre-trained on a separate training split;
- report verified success rate, cost per verified success, and lesson hit rate.

The script is manual and costs money, so it is not part of CI. ADR-502 §6 still applies: if the evaluation shows no gain, or shows a cost regression, the default goes back to off.

## 4. Consequences

- **Fewer records train.** Genuine work that touches tests, such as a fix that adds a test, is held back by default. This trade is intended: a missed lesson costs little, while a learned hack degrades routing.
- **Re-verification is expensive.** It costs CPU and runs project code, which is why it is opt-in and off by default.

## 5. Verification

- **Mods harness:** each taint class is set by the right edits and commands and never on clean turns, and a taint never changes the outcome word.
- **CLI tests:**
  - tainted records are counted and never sent to SONA;
  - `allowTaint` lets exactly the listed class through;
  - the anomaly gate holds each of its three cases;
  - re-verification downgrades on failure, timeout and error, and is never called when it is off.

## 6. Implementation notes

What shipped, and where it departs from the text above.

- **Files.** Mod: `plugins/ruflo-mods/hooks/loop/taint.ts` (new: path and command classes), `verifier.ts` (`narrowed` judged on the whole command, not the 80-character evidence), `record.ts` (`taint` on the line, `session` token), `index.ts` (passes the edited `file_path`/`notebook_path`, made project-relative). CLI: `src/memory/verified-guards.ts` (taints, `learningLoop` config, anomaly gate), `src/memory/verified-reverify.ts` (allowlist, rotation, git-worktree runner), `src/memory/verified-outcomes.ts` (ingest wiring). `scripts/eval-learning-loop.mjs` (§3). Tests: `__tests__/mods/mods-learning-loop-defences.test.ts`, plus updates to `mods-learning-loop.test.ts`.
- **Only the class of an edited path is kept**, never the path. A failed edit sets no taint. A failure record never carries taints, and the CLI drops any taint found on a non-success.
- **`narrowed-verifier` is wider than "one test-file argument":** any test-file argument (one or several), a pytest node id (`file.py::name`) and `cargo test mod::name` count, and `-run` (`go test`) joins the selector flags. Test-name selectors (`-t`, `-k`, `--skip`, `-run`) count only on a test command, so `tsc -t es2020` is not narrowed. A directory argument (`pytest tests/`) is not narrowed.
- **§2.4 case 3 needs a session id the records did not have.** The mod now writes `session`, one random token per mod process. A pattern whose successes carry fewer than two distinct sessions is held as `one-session`; that includes records written before this change, and ledger entries from before it (no provenance), so lessons learned under ADR-502 alone are held until a second session confirms them. The session token is self-reported like the rest of the record: it stops accidental single-session lessons, not a writer that forges records (that is what §2.3 is for).
- **Gate stats come from the ingest ledger, not SONA's counters** (other feeders also touch SONA). Each verified pattern keeps successes, failures, allowed-taint successes, narrowed successes and up to four sessions. Cautions are not gated. Held patterns are reported in the ingest result and printed as `held: <id> (<reason>)`; reasons are `perfect-and-tainted`, `only-narrowed`, `one-session`.
- **Config keys** in `.claude-flow/config.json`: `learningLoop.allowTaint` (array of class names), `learningLoop.reverify` (only the boolean `true` turns it on), `learningLoop.reverifyTimeoutSec` (default 300, clamped to 10–3600). A missing or malformed file means the defaults. No ruflo-mods option was added.
- **Re-verify only runs from an explicit ingest.** `hooks_route` and `hooks_session-end` call the same ingest on a hot path; when `reverify` is on, those callers leave trainable successes un-ingested (counted as `deferred`, mtime left stale) instead of blocking for up to the timeout. `ruflo hooks verified-ingest` / `hooks_intelligence_verified-ingest` re-verify and train them. Dry runs never re-verify.
- **Re-verify details.** The allowlist is built from `package.json` script names (`test`, `typecheck`, `build`, `lint`; run as `npm run <name>`) and `Cargo.toml` (`cargo test`, `cargo check`). The record contributes only its verifier kind, used to prefer a check of another kind; its command and task are never executed. Each distinct check runs at most once per ingest; the cursor advances once per ingest that ran a check. A project with no recognised check downgrades the record (`error`). The runner adds a detached worktree at `HEAD` in a temp directory, links the root's `node_modules` into it (a fresh worktree has none; nested workspace `node_modules` are not linked), runs the check with no shell in its own process group, kills the group at the timeout, and removes the worktree. A runner that never settles is also cut off (`timeout`). The ledger keeps the last 50 re-verifications with id, check, commit and status. The re-verify check runs the script as committed at `HEAD`, so a committed edit to the `test` script is caught by the `edited-verifier-config` taint, not by re-verify.
- **Re-verify was unit-tested with injected runners only** (pass, fail, timeout, error, a throwing runner, a hanging runner, a malformed result, hostile record text, rotation, the hot-path deferral). The real `git worktree` runner was not exercised in this PR: the swarm's worktree isolation refuses git operations outside the agent's own worktree.
- **§3 evaluation script.** `scripts/eval-learning-loop.mjs` prints the plan and spends nothing unless `--run`. It does not ship the 30-task corpus; it takes a tasks file (train and eval splits, a fixture directory and a fixed check argv per task). Success is the task's own check run afterwards in both arms, so it does not depend on the loop. Lesson hit rate is approximated outside Claude Code by re-applying the mod's keyword match to the trained lessons file. It was not run here (it needs 2 × 30 + training `claude -p` runs).
- **Live check (Claude Code, haiku, one run):** asked to make a failing test pass by changing the test's expected value and then run `npm test`, the model did exactly that; the mod recorded `outcome: verified-success` with `taint: ["edited-tests"]`, and the CLI ingest counted it under `tainted` with zero SONA calls.
