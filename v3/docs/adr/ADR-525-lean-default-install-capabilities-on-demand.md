# ADR-525: Lean default install, heavy capabilities on demand

- **Status:** Proposed
- **Date:** 2026-11-06
- **Related:** #2561 (optional-dependency budget), ADR-150 (MetaHarness must stay removable), ADR-309 (operational telemetry: measures activation)

## Context

Earlier measurement, 2026-11-06, in a fresh `node:22` container with an empty npm cache, on a fast network. Rows A and B are estimates that did **not** reproduce once phase 1 was implemented (see the next table):

| Install | Time | Size | Packages |
|---|---|---|---|
| `npm install ruflo@3.72.2` today | 31 s | **1.5 GB** | 383 |
| Same, minus `agentic-flow` (A, not reproduced) | 16 s | 887 MB | 283 |
| A, plus agentdb no longer pulling `@huggingface/transformers` (B, not reproduced) | 12 s | 411 MB | 264 |
| `--omit=optional` (floor) | 12 s | 166 MB | 231 |

`ruflo init` succeeds at the floor.

Phase 1 as implemented (PR #4866), measured 2026-11-06. Each install ran one after another in a fresh `node:22` container with an empty npm cache. "After" is the CLI packed from the branch; for `ruflo`, it is `ruflo@3.72.2` with an `overrides` entry pointing `@claude-flow/cli` at that tarball. Package counts are npm's "added N packages".

| Install | Before (registry 3.72.2) | After phase 1 |
|---|---|---|
| `@claude-flow/cli` | 26.5 s / 1450 MB / 637 pkgs | 21.2 s / 1172 MB / 449 pkgs |
| `ruflo` | 25.6 s / 1460 MB / 638 pkgs | 24.0 s / 1181 MB / 450 pkgs |

Removing `agentic-flow` saves about 280 MB and 188 packages, not the ~600 MB that row A implied. Most of the remaining weight is about 690 MB of ONNX runtime: `onnxruntime-node` (547 MB) plus `onnxruntime-web` (140 MB). Both come in through `agentdb` → `@huggingface/transformers`. Removing them is the upstream agentdb ask below (phase 2), not a ruflo change.

Three things cause the weight:

1. **`agentic-flow` is an optional dependency of the CLI, and it hard-depends on four SDKs and transformers.** It pulls the Anthropic, Google, Supabase and Claude Agent SDKs, `tiktoken`, Express and `@huggingface/transformers`. The CLI uses it in only three places, and each catches a failed import:
   - autopilot learning (`tryLoadLearning` returns `null`);
   - one ReasoningBank memory retrieval path in `hooks`;
   - an embedding fallback that sits *behind* ruvector's bundled ONNX model.

   `services/agentic-flow-bridge.ts` is imported nowhere.
2. **`agentdb` declares `@huggingface/transformers` as an optional dependency.** npm installs optional dependencies by default, which brings in `onnxruntime-node` (548 MB) and `onnxruntime-web` (140 MB). ruflo's memory embeds with ruvector's ONNX or the wasm embedder, not transformers.
3. On npm 10 / Node 20, `@ruvector/ruvllm-gpu-loop` (engines node >=22) fails as an optional install, and npm then drops `ruvllm` and `ruvector`. That makes the install *incomplete* rather than heavy (found during the 3.72.2 release).

The adoption data (BigQuery `ruflo_funnel`, Oct 7 – Nov 5) shows 59% of weekly active clients appear only once. A 1.5 GB first install is the most likely single cause of that drop-off that we control.

## Decision

The default install contains what `init`, memory, swarm, hooks and MCP need. Capabilities that need heavy runtimes are installed on first use.

1. **Remove `agentic-flow` from the CLI's `optionalDependencies`.** Its call sites already degrade.
2. **Add `ruflo add <capability>`.** It installs into the user-level add-on root `~/.ruflo/addons` with `npm install --prefix`, using the exact range the CLI was tested with. It must work for `npx ruflo`, whose own `node_modules` is a throwaway npx cache.
   - A `resolveAddon(name)` helper tries normal module resolution first, then the add-on root.
   - The add-on call sites import through that helper.
   - When a feature needs a missing add-on, it prints one line, for example `autopilot learning needs agentic-flow: run \`ruflo add learning\``. It never installs silently.
3. **`ruflo doctor`** lists the add-ons available and installed, with the install command for each missing one.
4. **Upstream asks** (not ruflo code):
   - `agentdb` moves `@huggingface/transformers` and the OpenTelemetry SDK to optional *peer* dependencies, which npm does not auto-install. That takes us from A to B.
   - `agentic-flow` moves the vendor SDKs to optional peers.
   - `@ruvector/ruvllm` stops depending on `ruvllm-gpu-loop`, or that package lowers its engines floor.

## Consequences

- Measured: ruflo's change alone takes a cold install from about 1.45 GB to about 1.17 GB, and from 637 to 449 packages (see Context). The remaining ~690 MB of ONNX runtime goes only when agentdb ships its change (phase 2). The 0.9 GB and 0.4 GB projections did not reproduce.
- Users who rely on autopilot learning or ReasoningBank retrieval run `ruflo add learning` once. Their features are otherwise unchanged.
- **`ruflo add learning` costs more than it saves.** Measured in the same container: 29 s and 1842 MB in `~/.ruflo/addons`. A standalone `--prefix` install pulls its own copies of agentdb and the ONNX runtime. Installing with `--omit=optional` cut this to 16 s, 1024 MB and 371 packages, but broke the feature. agentic-flow's ReasoningBank imports `better-sqlite3`, which agentic-flow declares as optional, so the import fails with `ERR_MODULE_NOT_FOUND`. Autopilot learning then reports "AgentDB not initialized" and token-optimize falls back. Naming `better-sqlite3` explicitly (`npm install --omit=optional agentic-flow better-sqlite3`) took 17 s, 1050 MB and 373 packages, and still broke the feature. ReasoningBank then fails on `chalk`, which `agentdb/dist/src/controllers/QUICServer.js` imports but agentdb's manifest does not list as a required dependency. `AutopilotLearning.initialize()` returns false. Each optional package that the import graph actually needs would have to be named, so this approach does not hold up. The add-on therefore installs with optional dependencies, and the CLI prints the ~1.8 GB estimate before installing. Shrinking it depends on the upstream agentic-flow ask (vendor SDKs as optional peers), with better-sqlite3 kept as a real dependency of its ReasoningBank entry point.
- The #2561 optional-dependency budget goes down by one. The `no-cli-optdep-bloat` guard should put `agentic-flow` on its FORBIDDEN list so it cannot quietly come back.
- Activation is measurable through the opt-in funnel (ADR-309 / #4860). The success metric is the share of weekly clients seen on more than one day, which was 41% before this change.

## Verification

- Repeat the cold-install measurement above in CI for the packed tarball, as a size and time budget gate.
- Smoke `init`, `memory store/search`, `swarm init`, `hooks route` and `mcp start` with no add-ons installed.
- Smoke `ruflo add learning`, then autopilot learning, from both a global install and `npx`.
