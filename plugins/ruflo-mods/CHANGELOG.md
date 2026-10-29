# Changelog: ruflo-mods

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-mods`.

## 0.8.0 — 2026-10-29
- feat: option `learningLoop` (default on, #4581, ADR-502; set `false` to turn it off): the verified-outcome learning loop. Each main-loop turn becomes a trajectory (tool names and success flags); its outcome is `verified-success` or `verified-failure` only when a recognised test/build/typecheck/lint command ran after the turn's last edit and the shell's exit status said so, else `unknown`. A masked status (`|| true`, a pipe, `;`, background, substitution) verifies nothing; subagent calls, aborted turns and slash commands never verify. Records go to `.claude-flow/data/verified-trajectories.jsonl`; the CLI trains SONA on verified records only. At most three cited lessons (`[lesson L-… conf …, n passed / m failed]`) learned at or above the 0.6 gate are added to a prompt they match; a hostile lessons file adds nothing. `/ruflo-mods` gains a `loop:` row and the status line `loop ✓n ✗n ?n`. Observe-only; no process, model or MCP call.

## 0.7.1 — 2026-10-25
- fix: ruflo-mods 0.7.0 did not load in Claude Code (#4485): the hooks module was refused with `on("session.start") is registered twice without a matcher`, so no hook ran and `/ruflo mods` answered "not loaded". The ruRE offer registered a second bare `session.start`, `tool.call` and `turn.complete`. Its session work now runs inside the one `session.start` handler (the pure `hasRure` takes the tool list; Claude Code follows `$` only inside the file that spells it), and its two other hooks carry a match-all matcher, as the session rollup's do. It was refused even with `rureOffer` off, because the loader checks registrations statically.
- chore: the test host now refuses the same thing the loader does, and a test loads the mod with every boolean option from the manifest turned on, so an optional module cannot break the mod unseen again

## 0.7.0 — 2026-10-23
- feat: option `rureOffer` (default off, ADR-498): when the model reads or writes a binary, library, `.asar` or CUDA file inside the project, one line beneath the answer says ruRE can look inside it without running it, and how (`/ruflo run dt-re-auto <path>`, or `rure_analyze_binary` / `rure_analyze_cuda`). Offer only: it never runs ruRE, never denies or edits a call, shows at most three files a turn and twelve a session once each, only validated project-relative paths, and nothing from the file. Inert without a ruRE tool and on subagent answers

## 0.6.2 — 2026-10-14
- fix: the mod's route context uses the same query-coverage scoring as hook-handler.cjs (inflection variants, IDF weights, coverage >= 0.15), so a short prompt finds a long memory entry and "migrations" finds "migration" (#4136, #4172); the ADR-404 parity test holds again

## 0.6.1 — 2026-10-12
- fix: root-delete guard expands brace lists (`rm -rf {/*,}`), judges deep nesting by tokens instead of a literal phrase, catches fork-bomb definitions in any spacing or name, and keeps its option checks linear (#4093, thanks @proffesor-for-testing)
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)
- docs: `refuse-risky` refuses nearly every ruflo mod unless `modTrustAllow` names it; the README now says so and how to build the list from `observe` (#4095)

## 0.6.0 — 2026-10-11
- feat: option `selfCheck` (default on): once per session, a toast when an enabled ruflo plugin (ruflo-console, ruflo-swarm) is missing from the ruflo marketplace clone and has no cached install, which makes Claude Code skip it without a word. The line is fixed text with the repair (`claude plugin marketplace update ruflo`); read-only, fail-open, nothing for the model.
- chore: smoke checks that `/ruflo-mods` stays an alias of `/ruflo mods` (ADR-406) and that the self-check cannot write or echo repository text.

## 0.5.1 — 2026-10-10
- fix: the attention row says STALE when the console's summary is older than 15 minutes (three missed 5-minute heartbeats) or carries no believable time, so a closed console or a turned-off session workspace no longer shows its last counts as current (#3981)

## 0.5.0 — 2026-10-09
- feat: option `grounding` (default off): `/ruflo-mods` shows whether the optional third-party ruvnet-brain plugin is on, not installed, installed but disabled, or unknown; detect-only, no event hooked, nothing blocked or written (ADR-487)

## 0.4.0 — 2026-10-09
- feat: sessionAttention option (default off): one attention row in /ruflo-mods with the console's four counts (to approve, questions, failed, finished unread). Counts only; no gating behaviour changed (ADR-486).

## 0.3.16 — 2026-10-07
- feat: shared toast system with levels, dedupe, persistence and Settings (ADR-477)
- fix: a toast needs no engine.create (bind at session.start too), a throwing clock falls back to the wall clock; update the cost ladder expectati…

## 0.3.15 — 2026-10-07
- fix: decode $'...' escapes as bash does; adversarial and benign tables for the root-delete guard
- fix: trust gate judges a glob or a negation by what it selects
- fix: trust gate treats process.spawn, mcp.call/connect, session.send, config.set, prompt.submit and agent.spawn as risky; names a reload that ga…
- fix: capabilityProbe counts session.measure, agent.spawn and plugin.register only where the options hook them
- fix: stand down for legacy CLI `hooks route|post-edit` settings and check the %USERPROFILE% helper
- fix: keep main's Google-key and JWT matches when glued to a dash; no ^ at mid-line window starts
- fix: screen three readings so stripping or folding never glues a phrase to the word before it
- fix: screens stay linear on blank lines and repeated token starts; whitespace padding cannot straddle a window
- chore: and 15 more changes (git log -- plugins/ruflo-mods)

## 0.3.14 — 2026-10-05
- feat: Project Anatole plugin, tests, corpus gate, bench, fleet registration

## 0.3.13 — 2026-10-05
- fix: trust gate counts prompt.submit and agent.spawn as risky; ranked context drops control and bidi characters (0.3.13)

## 0.3.12 — 2026-10-05
- fix: reject a legacy or unknown-mode policy projection as unreadable; report shows the mode (ADR-450 T10), 0.3.12
- fix: print the probe label once in the /ruflo-mods report (0.3.10)
- chore: README rows cite the live options run and the source of the 76% figure

## 0.3.11 — 2026-10-05
- feat: sessionRollup ledger, one bounded counters record per session (ADR-451 item 6), 0.3.8
- chore: complete the option table, one row per userConfig key, with a smoke guard (0.3.11)

## 0.3.9 — 2026-10-05
- feat: compactCarry option carries swarm and claims state through compaction (ADR-451 item 7, 0.3.9)

## 0.3.8 — 2026-10-05
- feat: sessionRollup ledger, one bounded counters record per session (ADR-451 item 6), 0.3.8
