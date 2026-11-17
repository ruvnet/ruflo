# ADR 515: move ruflo to agentic-flow 3.0.0, the reconciled stable line

Status: Accepted (ruflo 3.67.0)

Date: 2026-10-31

Builds on: ADR-513 (stable versions), ADR-514 (agentdb 3.0.0). Upstream record: agentic-flow ADR-079.

## 1. Context

The CLI declared `agentic-flow: ^3.0.0-alpha.1`, which resolved to **3.0.0-alpha.2** (March 2026). That release was not agentic-flow's main line.

- Main had moved on to 2.1.5 (October 2026), and `^3.0.0-alpha.1` can never select it.
- alpha.2 was built from commit `0d7a9cf4` plus uncommitted files, including `dist/coordination/autopilot-learning.js`, the module ruflo's autopilot `learn`/`predict`/`recall` load.
- It pulled `@xenova/transformers` → `onnxruntime-web@1.14` → `onnx-proto` → `protobufjs@6.11.6`: the one critical advisory in a fresh ruflo install.
- It also pulled `agentdb@1.6.1`.

What ruflo imports from agentic-flow (`reasoningbank`: `computeEmbedding`, `retrieveMemories`, `formatMemoriesForPrompt`; `router`; `orchestration`; `transport/loader`; `embeddings`) was checked symbol by symbol against main. Every symbol exists with a compatible signature. `transport/loader` and `embeddings` exist only on main, so the move gains them. The only loss was `AutopilotLearning`.

Main itself had problems, from reviews of security and of integration and self-learning:
- The proxies were open on the LAN.
- A `bypassPermissions` agent tool was auto-approved by `init`.
- A cloned repo's `.env` or router config could redirect API keys.
- `statusline.sh` executed code from repo data.
- ReasoningBank rewarded memories for being retrieved.
- agent-booster rewarded its own cache hits.
- `computeEmbedding` kept processes alive for an hour, and silently used hash vectors under `npx`.
- Transformers 3.8 pinned an `onnxruntime-node` whose install fails on CUDA 13.

## 2. Decision

1. **Publish main as agentic-flow 3.0.0**, with the fixes in agentic-flow ADR-079. It is a major release because agents lose `bypassPermissions` by default and proxies need a token. 3.0.0 gives the 3.x line a stable head, so every existing ruflo 3.66.x install (`^3.0.0-alpha.1`) moves to it on its next fresh install and drops the critical `protobufjs@6`. 2.2.0 was considered and rejected: it would deliver breaking defaults to `^2.1` users and leave ruflo pinned to the March alpha.
2. **Restore AutopilotLearning.** The alpha.2 tarball's source map embeds the original TypeScript, which is restored verbatim on main. Its services now load the real `agentdb`. Under alpha.2 they imported `packages/agentdb/src` by relative path, which never resolved from an install, so ruflo users always got an in-memory fallback. `isAvailable()` now reports the truth.
3. **ruflo follows.** The CLI declares `agentic-flow ^3.0.0`. The update validator's minimum is 3.0.0. `neural-tools` converts `computeEmbedding`'s `Float32Array` to an array before storing it, because `JSON.stringify` wrote it as `{"0":…}`.

## 3. Verification

- **ruflo against the candidate** (fresh `ruflo@3.66.2` with root `overrides`): see ADR-514 §3. The autopilot module loads and reports `available: true` on real AgentDB.
- **Offline behaviour of the removed npx heuristic:** with no model cache and the network blocked, `computeEmbedding` falls back to hash vectors in about 150 ms and `isSemanticEmbedding()` returns false. Existing offline installs keep working; online installs download about 23 MB of MiniLM on first use.
- **agentic-flow tests:** all new tests pass, including the 122 security tests. Three ReasoningBank suites fail 68 tests on the base commit and identically after the changes; that predates this release.

## 4. Not done

- Gemini and Requesty streaming have the same chunk-split bug fixed in the OpenRouter proxy.
- The http2, http3 and websocket proxies were not audited.
- `zod` 3 → 4, `@anthropic-ai/sdk` 1.x and `@google/genai` 2.x are left to their own upgrade.
