# Changelog: ruflo-agent

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.4.2 — 2026-11-04
- feat: `nested-leaf` and `nested-queen-leaf` run with `effort: low` and `omitClaudeMd: true`. Their prompts are self-contained, so they no longer load user, project and local CLAUDE.md files; managed policy files still load. On Claude Code 2.1.318 this measured about 64k fewer input tokens per leaf spawn in this repository, and a one-leaf run cost $0.081 instead of $0.153

## 0.4.1 — 2026-10-25
- fix: the dynamic-workflow guard now reads call arguments wrapped as `tool_input`, `params`, `args` or `parameters` (as well as `input` and `arguments`), and refuses a wrapper that is not an object or two competing wrappers; before, an unrecognised wrapper was read as a flat envelope with no policy fields and the call was allowed
- fix: a session, thread or environment id of `.` or `..` is refused before any request is sent (`encodeURIComponent` leaves it unchanged, so `/v1/sessions/..` would have resolved to `/v1/`)

## 0.4.0 — 2026-10-24
- feat: verified feedback cycles, independent host verification, atomic admission and isolated native memory with replay and policy checks
- fix: `managed_agent_prompt` could report the previous turn's answer as finished on a later poll while the new turn was still running; only events from the acknowledged message onward are tracked
- fix: `managed_agent_interrupt` now goes through the same host policy, session allowlist and fresh provider-state check as `managed_agent_control` (it had no gate); `managed_agent_terminate` obeys the allowlist, and deletes only the session's own environment, once `RUFLO_MANAGED_CONTROL=1` (default behaviour unchanged)
- fix: verifier receipts must use the canonical base64 spelling of the signature; other spellings of the same bytes verified yet were stored as separate records, which could fill the 500-record ledger
- fix: a failed local snapshot write no longer fails a successful provider read or a completed session deletion, and a prompt that fails after it was sent now reports its `messageId` so a retry does not send it twice
- chore: the API-key scope marker is a keyed digest under a per-process random key, never a bare hash of the key
- fix: hydrate native memory search previews before authenticating recalled managed workflow receipts; verified through ruOS process restart
- feat: shared managed run collection, policy checked controls and verified advisory learning with native evidence memory bridge
- feat: managed workflow capability discovery, bounded local mod policy and console policy metadata
- fix: ship the managed workflow integration through a versioned plugin update

## 0.3.4 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.3.3 — 2026-10-11
- fix: the four nested-queen agents passed `content:`/`namespace:` to `aidefence_scan` and `aidefence_is_safe`, whose required parameter is `input`; the screen would have failed validation instead of scanning. Now `input:`, and a failed or unavailable scan is treated as unsafe
- fix: nested-queen agents documented a `ruflo cost` command, a `queen` role for `hive-mind_spawn`, `scope`/`depth_remaining` parameters on the claims tools and `byzantine` as a `hive-mind_consensus` strategy; none exist. Added a verified call-shape table and a note that scope reduction and the depth cap are not enforced by the claims tools
- docs: README tool count corrected (27 WASM tools, 6 managed-agent tools)

## 0.3.2 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.3.1 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.3.0 — 2026-10-04
- feat: mod (guard/status/command) as function hooks, ADR-445 pattern

## 0.2.1 — 2026-07-16
- feat: ADR-147 nested subagent (depth=5) infrastructure + P2 stage 1
- fix: harden hooks, statusline, security, and plugin MCP integration
- chore: darwin-plugins iter 2 — ruflo-agent: document nested-subagents skill in README
- chore: bring README up to date for the managed (cloud) runtime

## 0.2.0 — 2026-05-12
- feat: rename ruflo-wasm → ruflo-agent + Claude Managed Agents (cloud) runtime — ADR-115 (proposed→accepted, implemented)
