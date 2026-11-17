---
name: fast-code-edits
description: >
  Local, millisecond code edits with no LLM call: deterministic codemods (hooks_codemod) and snippet merges into large files (hooks_fast-apply, agent-booster).
  Use when: mechanical transforms across many files (var-to-const, remove-console, add-logging), or merging a rewritten function into a big file.
  Skip when: the change needs reasoning (types, error handling, refactors).
---

# Fast Code Edits Skill

## Purpose
Two engines for two jobs. `hooks_codemod` applies fixed-rule transforms with the TypeScript compiler and keeps formatting. `hooks_fast-apply` merges a code snippet you already have into a file with agent-booster (Morph-style fast apply).

## When to Trigger
- the same mechanical change across many files
- you have the new code for one function and the file is large

## When to Skip
- anything that needs judgement: route it to a model

## Commands

### Deterministic codemod (dry run first)
```bash
npx @claude-flow/cli mcp exec -t hooks_codemod -p '{"intent":"remove-console","glob":"src/**/*.ts","dryRun":true}'
```

### Merge a snippet
```bash
npx @claude-flow/cli mcp exec -t hooks_fast-apply -p '{"file":"src/math.ts","edit":"export function add(a: number, b: number): number {\n  return a + b;\n}","dryRun":true}'
```
`edit` must be code. An instruction such as "make add typed" returns `success: false`. Nothing is written below `minConfidence` (default 0.5).

### Check whether a codemod fits
```bash
npx @claude-flow/cli hooks model-route -t "convert var to const in src/"
```
Look for `[CODEMOD_AVAILABLE]` in the output.

## Best Practices
1. Always dry-run, then apply
2. Run tests after a batch codemod
