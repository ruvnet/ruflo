---
name: ruvllm-runtime
description: Tell apart and check the RuVLLM packages — the WASM add-on behind ruvllm_* tools, the @ruvector/ruvllm 4.1 native runtime and the GPU-loop harness. Use when ruvllm_status shows a backend unavailable or an install resolved the broken 4.0.x.
argument-hint: "[status|install|gpu]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__ruvllm_status Bash Read
---

# RuVLLM runtime packages

Three packages share the RuVLLM name and do different jobs. `ruvllm_status` reports the first two separately.

| Package | Version | What it gives you | Shown in `ruvllm_status` as |
|---|---|---|---|
| `@ruvector/ruvllm-wasm` | 2.x | WASM chat templates, MicroLoRA, SONA instant loop, HNSW router behind the `ruvllm_*` MCP tools | `wasm.available` |
| `@ruvector/ruvllm` | `^4.1.0` | Native runtime: `SonaCoordinator`, `TrainingPipeline`, `ContrastiveTrainer`, `LoraAdapter`, `LoraManager`, `ReasoningBank`, `EwcManager`, SafeTensors export, plus the `ruvllm` CLI (`route`, `embed`, `query`/`generate`/`serve` with a GGUF model) | `native.available`, `native.contrastiveTrainer`, `native.trainingBackend` |
| `@ruvector/ruvllm-gpu-loop` | `^1.1.1` | Bounded GPU weight-edit experiments, a scheduled job loop and adapter archives. Node 22+. `@ruvector/ruvllm` 4.1 pulls it in and forwards `ruvllm gpu …` to it | not reported |

**Avoid `@ruvector/ruvllm` 4.0.0 and 4.0.1.** They were published from the wrong repository: an ESM-only GPU-loop harness with none of the runtime classes. Anything that loads the runtime with `require('@ruvector/ruvllm')` then silently falls back to JS. 4.1.0 restores the dual CJS/ESM runtime and keeps the GPU loop under `ruvllm gpu` and the `./gpu-loop` subpath.

## Steps

1. **Status**: call `mcp__plugin_ruflo-core_ruflo__ruvllm_status`. Read `wasm.available` (MCP tools) and `native.available` (`coordinator: "active"` means `SonaCoordinator` loaded).
2. **Check the installed runtime version**:
   ```bash
   npm ls @ruvector/ruvllm @ruvector/ruvllm-wasm @ruvector/ruvllm-gpu-loop 2>/dev/null
   node -e "const m=require('@ruvector/ruvllm');console.log(require('@ruvector/ruvllm/package.json').version, typeof m.SonaCoordinator, typeof m.LoraAdapter)"
   ```
   `4.1.0 function function` means the runtime is real. An `ERR_REQUIRE_ESM` or `undefined` means 4.0.x: reinstall.
3. **Install** only what the job needs (add `-g` for a global ruflo install):
   ```bash
   npm i @ruvector/ruvllm-wasm        # the ruvllm_* MCP tools
   npm i @ruvector/ruvllm@^4.1.0      # native SONA / LoRA / training runtime
   ```
4. **Local routing and embeddings** need no model file:
   ```bash
   npx -y @ruvector/ruvllm@4.1.0 route "write unit tests for the auth module"
   npx -y @ruvector/ruvllm@4.1.0 embed "hello"
   ```
   `query`, `generate` and `serve <gguf>` need a loadable GGUF model (`ruvllm models list|download`).
5. **GPU experiments** take absolute paths and a config; nothing runs without one:
   ```bash
   npx -y @ruvector/ruvllm@4.1.0 gpu loop status --config /abs/path/loop.json
   npx -y @ruvector/ruvllm@4.1.0 gpu run --config /abs/path/run.json --plan /abs/path/plan.json
   ```

## Related

- `lora-learning` (installed by `ruflo init`): how ruflo's own MicroLoRA learning uses `@ruvector/learning-wasm` and when the backend is `wasm` vs the JS fallback.
- `llm-config` (this plugin): create and adapt in-process MicroLoRA/SONA instances through MCP.
- `ruflo-intelligence`: owns SONA and MicroLoRA in the learning pipeline.
