---
name: lora-learning
description: "Train and use ruflo's on-device learning: MicroLoRA adapters on @ruvector/learning-wasm (microsecond-scale WASM adaptation), trajectory recording and pattern learning. Use when the user wants ruflo to learn from successful tasks, adapt routing to a project, or check whether WASM learning is active. Skip for one-off tasks with no feedback signal."
---

# LoRA Learning

ruflo adapts small low-rank (LoRA) weights from task outcomes. The fast path is `@ruvector/learning-wasm`, which ships with `@claude-flow/cli`. It provides `WasmMicroLoRA`, `WasmScopedLoRA` (per-operator adapters) and `WasmTrajectoryBuffer`. Without it the same code runs on a slower JS fallback.

## Check the backend

```bash
npx @claude-flow/cli neural benchmark -i 1000     # MicroLoRA table: average adaptation time in microseconds
npx @claude-flow/cli neural status
```

The benchmark's MicroLoRA table only appears when the WASM module loads. Measured: about 2 µs per 256-dim adaptation. If you see `RuVector JS fallback (install @ruvector/learning-wasm ...)`, the optional dependency was skipped. Reinstall without `--omit=optional`.

## Learn from work

1. Record the task as a trajectory: `mcp__claude-flow__hooks_intelligence_trajectory-start`, then `..._trajectory-step` for each decision, then `..._trajectory-end` with the outcome.
2. Store a reusable pattern: `mcp__claude-flow__hooks_intelligence_pattern-store`.
3. Train: `mcp__claude-flow__neural_train`, or on the CLI `npx @claude-flow/cli neural train -p coordination`.
4. Reuse: `mcp__claude-flow__hooks_intelligence_pattern-search` before the next similar task.

## Good practice

- Only record outcomes you have verified (tests passed, user accepted). Training on unverified successes teaches the wrong thing.
- Keep one namespace per project so adapters do not mix domains.
- `neural optimize` quantizes stored patterns to Int8 (about 4x smaller) once the set is stable.
