---
name: lora-learning
description: >
  On-device learning with MicroLoRA adapters on @ruvector/learning-wasm (microsecond WASM adaptation), trajectories and pattern learning.
  Use when: ruflo should learn from verified task outcomes, adapt routing to a project, or you need to check that WASM learning is active.
  Skip when: one-off tasks with no feedback signal.
---

# LoRA Learning Skill

## Purpose
ruflo adapts small low-rank weights from task outcomes. `@ruvector/learning-wasm` (shipped with @claude-flow/cli) provides `WasmMicroLoRA`, `WasmScopedLoRA` and `WasmTrajectoryBuffer`. Without it the same code runs on a slower JS fallback.

## When to Trigger
- a task succeeded and its approach should be reused
- routing keeps picking the wrong agent or model for this project

## When to Skip
- outcomes you have not verified

## Commands

### Check the backend
```bash
npx @claude-flow/cli neural benchmark -i 1000
npx @claude-flow/cli neural status
```
The MicroLoRA table appears only when the WASM module loads (measured: about 2 µs per 256-dim adaptation).

### Train and reuse
```bash
npx @claude-flow/cli neural train -p coordination
npx @claude-flow/cli mcp exec -t hooks_intelligence_pattern-search -p '{"query":"auth refactor"}'
```

## Best Practices
1. Train only on verified outcomes (tests passed, user accepted)
2. Keep one namespace per project
3. If the JS fallback is reported, reinstall without `--omit=optional`
