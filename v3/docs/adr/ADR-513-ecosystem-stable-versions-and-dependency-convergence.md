# ADR 513: stable versions only, and one converged dependency tree across the ruvnet ecosystem

Status: Accepted (ruflo 3.67.0; agentdb 3.0.0, agentic-flow 3.0.0, @claude-flow/aidefence 3.1.0, npm aidefence 3.0.1)

Date: 2026-10-31

Issue: #4625. Related: ADR-514 (agentdb 3.0.0), ADR-515 (agentic-flow line), ADR-516 (aidefence recovery). Supersedes the "alpha/v3alpha dist-tags MUST track latest" rule in CLAUDE.md's publishing section.

## 1. Context

A fresh `npm install ruflo@3.66.1`, audited with `npm audit --omit=dev`, reported **70 advisories (1 critical, 17 high, 52 moderate)**. Almost none came from ruflo's own code. They came from how the ecosystem's packages were versioned against each other.

### 1.1 Prerelease ranges do not converge

ruflo depended on three AgentDB lines at once:

| requester | range | resolved |
|---|---|---|
| `@claude-flow/cli`, `memory`, `neural` | `^3.0.0-alpha.20` | `3.0.0-alpha.20` |
| `@claude-flow/aidefence` (optional peer) | `>=2.0.0-alpha.1` | `2.0.0-alpha.3.7` |
| `agentic-flow@3.0.0-alpha.2` | `^1.4.3` | `1.6.1` |

Under semver, a prerelease only satisfies a range that names a prerelease of the **same** `major.minor.patch`. So `>=2.0.0-alpha.1` does not admit `3.0.0-alpha.20`, and npm installed a second, older AgentDB. That copy brought OpenTelemetry 0.52, sharp 0.32 and their advisories.

The same rule pinned ruflo to a stale agentic-flow. The CLI asked for `^3.0.0-alpha.1`, which resolved to `3.0.0-alpha.2` (March 2026). agentic-flow's main line, `2.1.5` (October 2026), cannot satisfy that range. The March alpha still pulled `@xenova/transformers` → `onnxruntime-web@1.14` → `onnx-proto` → `protobufjs@6.11.6`, the one **critical** advisory.

### 1.2 `overrides` never reached users

`ruflo/package.json` and the CLI manifest carry long `overrides` blocks: `protobufjs >=7.5.6`, `agentdb >=3.0.0-alpha.20`, the OpenTelemetry family and others. npm applies `overrides` only in the **root** project of an install. When a user runs `npx ruflo` or `npm i ruflo`, ruflo is a dependency, so those blocks are ignored. The fresh install above resolved `agentdb@2.0.0-alpha.3.7` and `protobufjs@6.11.6` despite them. They only ever made this repo's own lockfile look clean.

### 1.3 Published artifacts not built from main

Two leaves had a registry `latest` that main could not reproduce: `@claude-flow/embeddings` (known, CLAUDE.md) and `@claude-flow/aidefence@3.0.3` (built from an uncommitted tree, ADR-516). Publishing from main would have regressed both.

## 2. Decision

### 2.1 Stable versions only, in every ruvnet package ruflo depends on

- No new `-alpha.N`, `-beta.N` or `-rc.N` versions are published for `agentdb`, `agentic-flow`, the ruflo release train or any `@claude-flow/*` leaf.
- No new `alpha`, `v3alpha` or `next` dist-tags are added or moved. Existing tags stay where they point, so old `@alpha` install commands keep resolving; they just stop advancing. CLAUDE.md's publishing section changes accordingly.
- `publishConfig.tag` must not be set in any of these packages (aidefence had `alpha`).

### 2.2 Converge on one line per package

| package | was (in ruflo's tree) | now | ADR |
|---|---|---|---|
| `agentdb` | 3.0.0-alpha.20 + 2.0.0-alpha.3.7 + 1.6.1 | **3.0.0** only | 514 |
| `agentic-flow` | 3.0.0-alpha.2 (March, `@xenova/transformers`) | **3.0.0** (main line, first stable 3.x) | 515 |
| `@claude-flow/aidefence` | 3.0.2 | **3.1.0** (source-recovered + AIMDS packs) | 516, 517 |

agentdb 3.0.0 is stable, so every existing range admits it: `^3.0.0-alpha.20`, `>=2.0.0-alpha.1`, `^2.0.0 || ^3.0.0-alpha.1`. That removes the extra copies without touching `memory` or `neural`.

### 2.3 Fix advisories at the source, not in `overrides`

A dependency advisory is fixed by changing the range the **publishing** package declares, and proved with a fresh install. The ruflo `overrides` blocks stay, because they still govern this repo's own lockfile, but no fix may rely on them.

### 2.4 Retroactive reach is gated by a fresh-install check

Caret ranges mean an upstream stable publish reaches existing ruflo installs on their next `npx`, with no ruflo release in between. Before any upstream publish, the candidate is installed under a fresh `ruflo@<current>` through a root `overrides` pointing at the candidate tarball. Then `ruflo --version`, `ruflo doctor` and a memory store/search are run, along with the CLI test files that import the package.

### 2.5 Verify a leaf's `latest` before publishing it

Before a standalone publish, compare the registry `latest` with main: `npm view <pkg>@latest gitHead`, then `git merge-base --is-ancestor`. With no gitHead, diff the `dist/` of `npm pack <pkg>@latest` against a local build. A file that is only in the published copy blocks the publish until it is ported (ADR-516 is the worked example).

## 3. Measurement

| install | prod advisories (critical/high/moderate) | agentdb copies |
|---|---|---|
| `ruflo@3.66.1` | 1 / 17 / 52 (70) | 3 |
| `ruflo@3.66.2` + agentdb 3.0.0 + agentic-flow 3.0.0 (fresh install, before the 3.67.0 publish) | 0 / 8 / 3 (11) | 1 (3.0.0) |

## 4. Not done

- `zod@3` is flagged by `<4.6.6` advisories. Moving agentic-flow and the `@claude-flow` leaves to zod 4 is a major change in schema behaviour and is left to its own ADR.
- `@claude-flow/embeddings` stays on its alpha line until its off-main `latest` is reconciled (same method as ADR-516).
