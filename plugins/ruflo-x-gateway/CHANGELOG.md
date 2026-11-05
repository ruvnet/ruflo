# Changelog: ruflo-x-gateway

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-x-gateway`.

## 0.10.3 — 2026-11-04
- fix: every per-IP limit (MCP rate limit, Seraphina hourly allowance, GitHub hourly allowance) now keys on the trusted end of the forwarding chain, the same address registration uses, instead of the caller-supplied leftmost `X-Forwarded-For` entry. `RUFLO_PROXY_HOPS` (falling back to `RUFLO_REGISTRATION_PROXY_HOPS`) sets the trusted hop count (gateway 0.9.2)

## 0.10.2 — 2026-10-24
- fix: a `tools/call` without an `arguments` field (allowed by MCP, and what clients send for tools that take none) failed with `-32602 expected object, received undefined` on every path; an absent or null `arguments` is now treated as `{}` (gateway 0.9.1)
- fix: `POST /` on the bare host now serves the directory-safe profile instead of a 404, so a connector added as `https://x.ruv.io` (no path) works; its OAuth challenge points at the root metadata
- chore: the gateway log now records why a bearer was denied (`why=`) and one `mcp-reject` line per 4xx/5xx MCP response (path, status, JSON-RPC method, protocol-version header, client name); no body or token is logged

## 0.10.1 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.10.0 — 2026-10-09
- feat: `ruv_github_search`, `ruv_github_repo`, `ruv_github_file` and `ruv_registry_latest` on the legacy `/mcp` surface (gateway 0.9.0, ADR-485): read-only queries of an allowlisted owner's public GitHub repositories and npm latest versions, SSRF-pinned, size/time capped, cached with ETag revalidation, fenced as untrusted GitHub data
- chore: the `/chatgpt/mcp` and `/claude/mcp` directory profiles are unchanged (twelve tools); adding the GitHub tools there would need a directory re-review

## 0.9.5 — 2026-10-09
- fix: the directory bundle (0.8.2) documentationUrl points at the main branch path, not the feat/ruflo-ai-team branch

## 0.9.4 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.9.3 — 2026-10-04
- feat: guard secret-bearing MCP tools named in ADR-450 T6
- chore: bump the six plugins whose version collided with main after merge

## 0.9.2 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.9.1 — 2026-10-04
- fix: live-check W5 — guards read key names and every field; trader gates the package's real order tools

## 0.9.0 — 2026-10-04
- feat: function-hook mod (guard, status file, local slash command)
- feat: add multi-tenant RuFlo AI Team service
- fix: make Claude tool descriptions directory compliant

## 0.8.1 — 2026-09-28
- feat: add Claude directory MCP profile
- feat: add guarded public registration and release 3.47.0

## 0.7.3 — 2026-09-28
- feat: OAuth 2.1 on x.ruv.io/mcp, and no credentials as tool arguments
- fix: align ChatGPT tool annotations with behavior
- fix: verified event identity must win over publisher-controlled content
- fix: align review hints with irreversible sends
- fix: tools declared themselves destructive, and relay text reached the model unlabelled
- fix: a refused write names the cause instead of blaming the admin token
- fix: tool descriptions that tell the truth about authorisation
- fix: three bugs that made ChatGPT connector setup fail after sign-in
- chore: and 1 more changes (git log -- plugins/ruflo-x-gateway)

## 0.7.1 — 2026-09-11
- fix: claims reducer honours ttlSeconds — expired leases free the resource
- chore: 0.7.1 — version label for the claims TTL fix
