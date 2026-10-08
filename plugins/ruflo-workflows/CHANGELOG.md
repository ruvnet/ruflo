# Changelog: ruflo-workflows

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-workflows`.

## 0.6.4 — 2026-10-07
- feat: workflow-create documents the two ADR steps (requires ADR, records ADR) that use the project's own ADRs through ruflo-console's ADRs page (ADR-480)

## 0.6.3 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.6.2 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.6.1 — 2026-10-04
- fix: live-check W5 — guards read key names and every field; trader gates the package's real order tools

## 0.6.0 — 2026-10-04
- feat: function-hook mod (guard, status file, local slash command)

## 0.5.1 — 2026-07-16
- fix: harden hooks, statusline, security, and plugin MCP integration

## 0.5.0 — 2026-07-03
- feat: pre-submission exploit audit + signed attestation (ADR-167)
- chore: darwin-plugins iter 1 — ruflo-workflows: add 'Use when' trigger to gaia-debugging skill (ADR-112)

## 0.4.0 — 2026-05-29
- fix: stale route cache + --explore false (3.10.8)

## 0.3.0 — 2026-05-27
- fix: #2156 iter 53a — narrow T2 extraction to fix iter 52b regression
- chore: bulk-update plugin contract ADR statuses (sweep)
