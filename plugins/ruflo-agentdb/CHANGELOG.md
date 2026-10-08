# Changelog: ruflo-agentdb

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-agentdb`.

## 0.4.7 — 2026-10-05
- fix: NFKC-fold recalled memories and judge key/value pairs before attaching (ADR-450 T5), 0.4.7

## 0.4.6 — 2026-10-05
- feat: screen the file memory_import reads (0.4.6)

## 0.4.5 — 2026-10-05
- feat: guard four more free-text writers (0.4.5)

## 0.4.4 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.4.3 — 2026-10-04
- fix: guard reads name/value pairs and refuses inputs past the screen budgets (0.4.2)
- chore: bump the six plugins whose version collided with main after merge

## 0.4.2 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)

## 0.4.1 — 2026-10-04
- feat: AgentDB mod section on the Memory page + Help guide (0.31.0)
- fix: live-verified recall (0.4.1) + live harness and validation report
- fix: frame cannot be closed from inside a memory; zero-width chars cannot hide a secret (security review)
- fix: command is /agentdb-mod; reader fallthrough + keyword retry (found by a live run)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.4.0 — 2026-10-04
- feat: AgentDB as a mod (ADR-445)
