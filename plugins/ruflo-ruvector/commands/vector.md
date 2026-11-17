---
name: vector
description: RuVector operations via npx ruvector@0.3.13 — embedding, search, RVF cognitive containers, GNN, attention, hooks, brain, sona, edge, identity
---

$ARGUMENTS
Vector operations via the `ruvector` npm package (pinned to 0.3.3). Parse subcommand from $ARGUMENTS.

Pinned version: `ruvector@0.3.13` — every command below uses `npx -y ruvector@0.3.13 ...`.

Usage: /vector <subcommand> [options]

## Embedding

1. **embed `<text>`** — `npx -y ruvector@0.3.13 embed text "TEXT"`
   384-dim ONNX vector. If `ONNX WASM files not bundled`, run `/vector setup`.
2. **embed-adaptive `<text>`** — `npx -y ruvector@0.3.13 embed text "TEXT" --adaptive --domain code`
   LoRA-adapted embedding tuned to a domain.
3. **embed-file `<path>`** — Read file, then `npx -y ruvector@0.3.13 embed text "$(cat <path>)" -o <path>.vec.json`
4. **embed-benchmark** — `npx -y ruvector@0.3.13 embed benchmark` (compares base vs adaptive).

## Database lifecycle

5. **db create `<path>`** — `npx -y ruvector@0.3.13 create <path> -d 384 -m cosine`
6. **db stats `<path>`** — `npx -y ruvector@0.3.13 stats <path>`
7. **insert `<database>` `<json-file>`** — `npx -y ruvector@0.3.13 insert <database> <json-file>`
8. **search `<database>` `<vector-json>` [-k N]** — `npx -y ruvector@0.3.13 search <database> -v '[0.1,...]' -k N`
9. **export `<database>` [-o file] [-f json|binary|parquet] [--compress]** — `npx -y ruvector@0.3.13 export <database> -o backup.json`
10. **import `<file>` [-d database]** — `npx -y ruvector@0.3.13 import <file> -d <database> [--merge|--replace]`

## RVF (cognitive containers)

11. **rvf create `<path>`** — `npx -y ruvector@0.3.13 rvf create <path>`
12. **rvf ingest `<path>`** — `npx -y ruvector@0.3.13 rvf ingest <path>`
13. **rvf query `<path>`** — `npx -y ruvector@0.3.13 rvf query <path>` (nearest neighbors)
14. **rvf status `<path>`** — `npx -y ruvector@0.3.13 rvf status <path>`
15. **rvf segments `<path>`** — `npx -y ruvector@0.3.13 rvf segments <path>`
16. **rvf derive `<parent>` `<child>`** — `npx -y ruvector@0.3.13 rvf derive <parent> <child>` (lineage tracking)
17. **rvf compact `<path>`** — `npx -y ruvector@0.3.13 rvf compact <path>` (reclaim deleted space)
18. **rvf examples** — `npx -y ruvector@0.3.13 rvf examples` (45 reference stores)
19. **rvf download `<name>`** — `npx -y ruvector@0.3.13 rvf download <name>` (e.g. `agent_memory`, `swarm_knowledge`)

## GNN (Graph Neural Networks)

20. **gnn info** — `npx -y ruvector@0.3.13 gnn info`
21. **gnn layer** — `npx -y ruvector@0.3.13 gnn layer` (build/test a multi-head attention GNN layer)
22. **gnn search** — `npx -y ruvector@0.3.13 gnn search` (differentiable soft-attention search)
23. **gnn compress** — `npx -y ruvector@0.3.13 gnn compress` (5-level adaptive tensor compression)

## Attention mechanisms

24. **attention list** — `npx -y ruvector@0.3.13 attention list`
    Lists ALL available mechanisms: DotProduct, MultiHead, Flash, Hyperbolic, Linear, MoE, GraphRoPe, EdgeFeatured, DualSpace, LocalGlobal.
25. **attention compute** — `npx -y ruvector@0.3.13 attention compute`
26. **attention benchmark** — `npx -y ruvector@0.3.13 attention benchmark`
27. **attention hyperbolic** — `npx -y ruvector@0.3.13 attention hyperbolic` (Poincare-ball geometry ops; the real hyperbolic surface in 0.3.3)
28. **attention info** — `npx -y ruvector@0.3.13 attention info`

## Code intelligence (hooks)

29. **hooks init** — `npx -y ruvector@0.3.13 hooks init --pretrain --build-agents quality`
30. **hooks stats** — `npx -y ruvector@0.3.13 hooks stats` (Q-learning patterns, vector memories, trajectories)
31. **hooks route `<task>`** — `npx -y ruvector@0.3.13 hooks route "DESCRIPTION"` (positional)
32. **hooks route-enhanced `<task>`** — `npx -y ruvector@0.3.13 hooks route-enhanced "DESCRIPTION"`
33. **hooks suggest-context** — `npx -y ruvector@0.3.13 hooks suggest-context`
34. **hooks ast-analyze `<file>`** — `npx -y ruvector@0.3.13 hooks ast-analyze <file>` (positional)
35. **hooks ast-complexity `<files...>`** — `npx -y ruvector@0.3.13 hooks ast-complexity <files...>`
36. **hooks diff-analyze [commit]** — `npx -y ruvector@0.3.13 hooks diff-analyze HEAD`
37. **hooks diff-classify [commit]** — `npx -y ruvector@0.3.13 hooks diff-classify HEAD`
38. **hooks diff-similar** — `npx -y ruvector@0.3.13 hooks diff-similar`
39. **hooks coverage-route `<file>`** — `npx -y ruvector@0.3.13 hooks coverage-route <file>`
40. **hooks coverage-suggest `<files...>`** — `npx -y ruvector@0.3.13 hooks coverage-suggest <files...>`
41. **hooks graph-cluster `<files...>`** — `npx -y ruvector@0.3.13 hooks graph-cluster <files...>` (spectral/Louvain)
42. **hooks rag-context `<query>`** — `npx -y ruvector@0.3.13 hooks rag-context "QUERY"`
43. **hooks security-scan `<files...>`** — `npx -y ruvector@0.3.13 hooks security-scan <files...>` (run `hooks init` first)
44. **hooks remember `<content>`** — `npx -y ruvector@0.3.13 hooks remember "CONTENT"`
45. **hooks recall `<query>`** — `npx -y ruvector@0.3.13 hooks recall "QUERY"`
46. **hooks coedit-record / coedit-suggest** — record + retrieve files edited together.
47. **hooks error-record / error-suggest** — learn error→fix pairs and retrieve.
48. **hooks trajectory-begin / trajectory-step / trajectory-end** — record an execution trajectory.
49. **hooks pre-edit / post-edit / pre-command / post-command / session-start / session-end** — Claude Code hook lifecycle.

> **Known bugs in 0.3.3 hooks:** `force-learn` reports `skipped: no trajectories to process` until one is recorded; `graph-mincut` raises `Cannot read properties of undefined`; `git-churn` fails outside a git repo. Avoid these or run inside a git repo with seeded intelligence state.

## Native + workers (background analysis)

50. **native list** — `npx -y ruvector@0.3.13 native list` (worker types: security, analysis, learning)
51. **native run `<type>`** — `npx -y ruvector@0.3.13 native run security` (or analysis|learning)
52. **native benchmark** — `npx -y ruvector@0.3.13 native benchmark`
53. **native compare** — `npx -y ruvector@0.3.13 native compare`
54. **workers triggers / presets / phases / dispatch / status / stats / cleanup / cancel / run / create / init-config** — all available via `npx -y ruvector@0.3.13 workers <subcmd>`. First invocation auto-installs `agentic-flow` (slow).

## Collective knowledge (brain) — needs `@ruvector/pi-brain`

55. **brain status** — `npx -y ruvector@0.3.13 brain status`
56. **brain search `<query>`** — `npx -y ruvector@0.3.13 brain search "QUERY"`
57. **brain share `<title>`** — `npx -y ruvector@0.3.13 brain share "TITLE"`
58. **brain list / get / vote / delete / drift / partition / transfer / sync / page** — full Brainpedia + LoRA-weight management.

## SONA (Self-Optimizing Neural Architecture) — needs `@ruvector/ruvllm`

59. **sona status / info / stats** — `npx -y ruvector@0.3.13 sona status`
60. **sona patterns `<query>`** — `npx -y ruvector@0.3.13 sona patterns "QUERY"`
61. **sona train `<data>`** — `npx -y ruvector@0.3.13 sona train <data>` (record a training trajectory)
62. **sona export** — `npx -y ruvector@0.3.13 sona export` (export learned weights)

## LLM orchestration — needs `@ruvector/ruvllm`

63. **llm models** — `npx -y ruvector@0.3.13 llm models`
64. **llm embed `<text>`** — `npx -y ruvector@0.3.13 llm embed "TEXT"` (RuvLLM-backed embeddings)
65. **llm benchmark** — `npx -y ruvector@0.3.13 llm benchmark`
66. **llm info** — `npx -y ruvector@0.3.13 llm info`

## Identity (pi key for brain/edge/MCP)

67. **identity generate** — `npx -y ruvector@0.3.13 identity generate` (creates a 64-hex-char pi key)
68. **identity show** — `npx -y ruvector@0.3.13 identity show`
69. **identity export `-o file`** — `npx -y ruvector@0.3.13 identity export -o key.enc` (encrypted backup)
70. **identity import `<file>`** — `npx -y ruvector@0.3.13 identity import <file>`

## Edge compute network

71. **edge status** — `npx -y ruvector@0.3.13 edge status`
72. **edge balance [nodeId]** — `npx -y ruvector@0.3.13 edge balance` (rUv balance)
73. **edge tasks** — `npx -y ruvector@0.3.13 edge tasks`
74. **edge join** — `npx -y ruvector@0.3.13 edge join` (join the network as a node)
75. **edge dashboard** — `npx -y ruvector@0.3.13 edge dashboard` (opens in browser)

## Server / Decompile / Demo

76. **server [-p 8080] [-g 50051] [-d data-dir]** — `npx -y ruvector@0.3.13 server -p 8080`
77. **decompile `<target>` [-o dir] [-f modules|single|json]** — `npx -y ruvector@0.3.13 decompile <npm-pkg-or-file-or-url>`
78. **demo --basic | --gnn | --graph** — `npx -y ruvector@0.3.13 demo --basic` (interactive tutorial)

## System

79. **doctor** — `npx -y ruvector@0.3.13 doctor` (Node, npm, bindings, Rust)
80. **info** — `npx -y ruvector@0.3.13 info`
81. **benchmark** — `npx -y ruvector@0.3.13 benchmark` (known issue: fails with `Missing field 'dimensions'` on some installs; use `gnn search` or `attention benchmark` as alternatives)
82. **install [pkg|--all]** — `npx -y ruvector@0.3.13 install --all` (lists/installs optional add-ons)
83. **setup** — `npx -y ruvector@0.3.13 setup` (Setup Guide)

## Setup helper

For first-run users hitting `ONNX WASM files not bundled`, `Brain commands require @ruvector/pi-brain`, or `SONA not available`, ask the user to run `/ruflo-ruvector:vector-setup` (it installs packages, so it is user-invoked: ADR-507).

## MCP server (91 tools)

- Register once: `claude mcp add ruvector -- npx -y ruvector@0.3.13 mcp start`
- Verify: `claude mcp list | grep ruvector`
- Then call MCP tools directly (e.g. `hooks_route`, `hooks_ast_analyze`, `hooks_rag_context`, `brain_search`, `vectordb_search`, `diskann_search`).

## Not in 0.3.3 (do not invoke)

`compare`, top-level `index`, `embed --file`, `embed --batch --glob`, `cluster --namespace --k` (top-level `cluster` is "Coming Soon"), `embed --model poincare`, `brain agi *` (use `brain status` directly).
