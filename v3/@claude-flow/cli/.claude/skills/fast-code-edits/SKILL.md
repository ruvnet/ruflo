---
name: fast-code-edits
description: "Apply code edits locally in milliseconds with no LLM call: deterministic codemods (var-to-const, remove-console, add-logging) via hooks_codemod, and snippet merges into large files via hooks_fast-apply (agent-booster). Use for mechanical transforms across many files, or when you already have the replacement code for one function in a big file. Skip when the change needs reasoning; route that to a model."
---

# Fast Code Edits

Two engines, for two different jobs:

| You have | Use | Engine |
|---|---|---|
| An intent with a fixed rule: `var-to-const`, `remove-console`, `add-logging` | `mcp__claude-flow__hooks_codemod` | TypeScript compiler, formatting-preserving |
| The new code for part of a file, such as a rewritten function | `mcp__claude-flow__hooks_fast-apply` | agent-booster (Morph-style fast apply) |
| A change that needs judgement (add types, error handling, refactors) | `mcp__claude-flow__hooks_model-route`, then edit normally | a model |

## hooks_codemod

```json
{ "intent": "remove-console", "glob": "src/**/*.ts", "dryRun": true }
```

It accepts `code`, `file`, `files[]` or `glob`. Paths must be inside the project. Run a `dryRun` first, then again without it.

## hooks_fast-apply

`edit` must be code, not an instruction:

```json
{ "file": "src/math.ts",
  "edit": "export function add(a: number, b: number): number {\n  return a + b;\n}",
  "dryRun": true }
```

The result reports `confidence` (0-1) and `strategy` (for example `exact_replace`, `fuzzy_replace`, `insert`). Nothing is written below `minConfidence` (default 0.5). An instruction such as "make add typed" returns `success: false`. agent-booster places code. It does not write it.

## Routing first

`mcp__claude-flow__hooks_model-route` with `{"task": "..."}` returns `[CODEMOD_AVAILABLE]` when a codemod can do the whole job. Then call `hooks_codemod` instead of spending a model call.

## CLI equivalents

```bash
npx @claude-flow/cli mcp exec -t hooks_codemod -p '{"intent":"var-to-const","file":"src/a.js","dryRun":true}'
npx @claude-flow/cli mcp exec -t hooks_fast-apply -p '{"file":"src/math.ts","edit":"<new function code>"}'
```
