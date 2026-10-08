# Changelog: ruflo-ai-team

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-ai-team`.

## 0.2.2 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.2.1 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.2.0 — 2026-10-04
- feat: mod (guard/status/command) as function hooks, ADR-445 pattern

## 0.1.6 — 2026-09-30
- chore: version the #3556 fix as 0.1.6

## 0.1.5 — 2026-09-30
- fix: explicit CORS allowlist and documented public discovery

## 0.1.4 — 2026-09-29
- fix: enlarge workspace rail and restore evidence view

## 0.1.3 — 2026-09-29
- feat: unify ChatGPT workspace navigation

## 0.1.2 — 2026-09-29
- feat: style board as ruOS desktop workspace
