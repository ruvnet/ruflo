# ruflo-ruvector

Self-learning vector database powered by [`ruvector@0.3.13`](https://www.npmjs.com/package/ruvector) — HNSW, Adaptive LoRA embeddings, hooks-based intelligence, SONA self-optimizing patterns, brain (collective knowledge), exact min-cut, opt-in RaBitQ and DiskANN, and 118 MCP tools (the server's `tools/list`; `ruvector mcp tools` prints 97 of them).

> **Pinned version:** this plugin targets `ruvector@0.3.13`. Earlier 0.1.x versions are missing several commands (`brain`, `route`, `sona`); some legacy docs referenced 2.x features that do not exist on npm. Always invoke with the pin.

## Overview

Wraps the `ruvector` npm package as a Ruflo plugin, providing vector embedding, semantic search, code-graph clustering, hyperbolic projection, self-learning hooks, and SONA / Brain diagnostics. ruvector's Rust backend delivers sub-millisecond queries and 52,000+ inserts/sec.

## Prerequisites

```bash
# Required
npm install ruvector@0.3.13

# Optional add-ons (install as needed)
npm install @ruvector/pi-brain              # required for `brain` subcommands
npm install @ruvector/ruvllm                # required for `sona` subcommands (JS fallback)
```

Run a health check:
```bash
npx -y ruvector@0.3.13 doctor
```

## Installation

```bash
claude --plugin-dir plugins/ruflo-ruvector
```

## MCP Integration (118 Tools)

Register with the pinned version:
```bash
claude mcp add ruvector -- npx -y ruvector@0.3.13 mcp start
```

Key tool categories: hooks routing, AST analysis, diff classification, coverage routing, graph clustering and exact min-cut, security scanning, RAG context, brain knowledge, RVF containers, vector-database CRUD (`vectordb_*`), DiskANN (`diskann_build`, `diskann_search`) and MetaHarness (`metaharness_*`). The count is the server's `tools/list`; `ruvector mcp tools` prints a 97-entry subset. SONA, attention and GNN are CLI-only.

## Agents

| Agent | Model | Role |
|-------|-------|------|
| `vector-engineer` | sonnet | Embedding, HNSW indexing, code-graph clustering, hyperbolic projection, hooks routing, brain/SONA |

## Skills

| Skill | Usage | Description |
|-------|-------|-------------|
| `vector-setup` | `/vector-setup [--full]` | First-run installer: pins `ruvector@0.3.13`, adds ONNX/Brain/SONA/router add-ons, registers MCP, runs `doctor` |
| `vector-embed` | `/vector-embed <text>` | ONNX embeddings (384-dim) via `embed text` |
| `vector-cluster` | `/vector-cluster <files...>` | Spectral/Louvain code-graph clustering via `hooks graph-cluster` |
| `vector-hyperbolic` | `/vector-hyperbolic <text>` | Standard ONNX embed + Poincare projection in user code |

## User-invoked skills (ADR-507)

These skills carry `disable-model-invocation: true`: Claude does not pick them on its own, and they cost nothing in the per-turn skill listing. Type them to run them. First-run setup installs packages, so it waits for you to ask.

| Skill | Run it with |
|---|---|
| vector-setup | `/ruflo-ruvector:vector-setup` |

## Commands (`/vector` slash command)

The full surface is documented in `commands/vector.md` (80+ subcommands). Quick reference:

```bash
# Embedding
/vector embed <text>                 # ruvector embed text "<text>"
/vector embed-adaptive <text>        # ruvector embed text "<text>" --adaptive --domain code
/vector embed-file <path>            # read file, pass content as text
/vector embed-benchmark              # ruvector embed benchmark

# Database lifecycle
/vector db create <path>             # ruvector create <path> -d 384 -m cosine
/vector db stats <path>              # ruvector stats <path>
/vector insert <db> <json>           # ruvector insert <db> <json>
/vector search <db> <vector-json>    # ruvector search <db> -v <json> -k N
/vector export <db>                  # ruvector export <db> -o backup.json
/vector import <file>                # ruvector import <file> -d <database>

# RVF cognitive containers (45 example stores)
/vector rvf create|ingest|query|status|segments|derive|compact|export|examples|download

# GNN + attention (real native bindings)
/vector gnn info|layer|search|compress
/vector attention list|compute|benchmark|hyperbolic|info

# Code intelligence (hooks)
/vector ast <file>                   # ruvector hooks ast-analyze <file>
/vector hooks ast-complexity <files...>
/vector hooks coverage-route <file> | coverage-suggest <files...>
/vector hooks rag-context <query>
/vector hooks route|route-enhanced|suggest-context
/vector cluster <files...>           # ruvector hooks graph-cluster <files>
/vector hooks security-scan <files...>
/vector hooks diff-analyze|diff-classify|diff-similar [commit]
/vector hooks remember|recall <query>
/vector hooks coedit-record|coedit-suggest|error-record|error-suggest
/vector hooks trajectory-begin|trajectory-step|trajectory-end

# Native + workers
/vector native list|run <type>|benchmark|compare
/vector workers triggers|presets|phases|dispatch|status|...

# Collective intelligence
/vector brain status|search|share|list|drift|partition|transfer|sync|page  (needs @ruvector/pi-brain)
/vector sona status|info|stats|patterns|train|export                       (needs @ruvector/ruvllm)
/vector llm models|embed|benchmark|info                                    (needs @ruvector/ruvllm)

# Identity + edge compute (pi network)
/vector identity generate|show|export|import
/vector edge status|balance|tasks|join|dashboard

# Server / decompile / demo / system
/vector server [-p 8080] [-g 50051]
/vector decompile <npm-pkg-or-file-or-url>
/vector demo --basic | --gnn | --graph
/vector doctor | info | benchmark | install | setup
```

## End-to-End Example: store + search project files

```bash
# 0. One-time setup
/vector-setup

# 1. Create a database
npx -y ruvector@0.3.13 create project.db -d 384 -m cosine

# 2. Embed every TypeScript source file (loop — no built-in --batch)
mkdir -p .vec
for f in $(find src -name '*.ts'); do
  npx -y ruvector@0.3.13 embed text "$(cat "$f")" -o ".vec/${f//\//_}.json"
done

# 3. Insert all embeddings (assumes a JSON array of {id, vector, metadata})
jq -s '[.[] | {id: input_filename, vector: .vector}]' .vec/*.json > corpus.json
npx -y ruvector@0.3.13 insert project.db corpus.json

# 4. Search by query embedding
QV=$(npx -y ruvector@0.3.13 embed text "JWT refresh-token rotation" --output -)
npx -y ruvector@0.3.13 search project.db -v "$QV" -k 5

# 5. Inspect index health
npx -y ruvector@0.3.13 stats project.db
```

For an alternative store format with lineage tracking, replace steps 1–3 with:
```bash
npx -y ruvector@0.3.13 rvf create project.rvf
npx -y ruvector@0.3.13 rvf ingest project.rvf < corpus.json
npx -y ruvector@0.3.13 rvf query project.rvf
```

## Capabilities (ruvector@0.3.13, verified)

| Feature | CLI | Notes |
|---------|-----|-------|
| HNSW search | `search <db> -v ... -k N` | ~0.045ms latency |
| Adaptive LoRA embeddings | `embed text "..." --adaptive --domain code` | LoRA-tuned |
| Distance metrics | `create <path> -m cosine\|euclidean\|dot` | set at create time |
| RVF cognitive containers | `rvf create|ingest|query|derive|compact` | 45 example stores via `rvf examples` |
| Attention mechanisms | `attention list` | DotProduct, MultiHead, Flash, Hyperbolic, Linear, MoE, GraphRoPe, EdgeFeatured, DualSpace, LocalGlobal |
| GNN ops | `gnn layer|search|compress` | multi-head attention layers, differentiable search, tensor compression |
| Code-graph clustering | `hooks graph-cluster <files>` | spectral / Louvain |
| Diff embeddings | `hooks diff-analyze|diff-classify|diff-similar` | git-aware |
| Coverage-aware routing | `hooks coverage-route|coverage-suggest` | test-gap-aware |
| RAG context | `hooks rag-context "query"` | works in CLI and MCP |
| AST analysis | `hooks ast-analyze|ast-complexity` | symbols, complexity, parse time |
| Self-learning loop | `hooks remember|recall|coedit-*|error-*|trajectory-*` | persistent intelligence |
| Native workers | `native list|run <security|analysis|learning>` | no external deps |
| Background workers | `workers dispatch|status|presets|phases` | first run installs `agentic-flow` |
| Decompile npm/JS | `decompile <target>` | inspect upstream packages |
| Server | `server -p 8080` | HTTP/gRPC mode |
| Demo | `demo --basic|--gnn|--graph` | interactive tutorial |
| Identity (pi key) | `identity generate|show|export|import` | for brain + edge |
| Edge compute | `edge status|balance|tasks|join` | distributed, rUv currency |

### What changed since 0.3.3

Rows 0.3.4–0.3.8 and 0.3.12 were run against 0.3.12 on 2026-11-06; the 0.3.13 row and `smoke.sh` (14/14) against 0.3.13. Both MCP gates were exercised over stdio: refused without the variable, allowed with it. The 0.3.10 and 0.3.11 rows are from the upstream release notes.

| Version | Change | What to do |
|---------|--------|-----------|
| 0.3.4 | MCP security hardening (RCE, path traversal, SSRF, prototype pollution, ReDoS) | `hooks_init` / `hooks_doctor --fix` over MCP refuse unless the server runs with `RUVECTOR_MCP_ALLOW_INIT=1` (see `/vector-setup`) |
| 0.3.5 | ONNX embeddings 10–40x faster; compact store; a repo without `.ruvector/` gets its own store | older memories in `~/.ruvector` do not follow you into a new project |
| 0.3.6 | Full CRUD: `get`, `update`, `delete` for vectors; `hooks memory-get/memory-list/memory-update` for memories; matching MCP tools | edit in place instead of delete + re-insert |
| 0.3.7 | MCP hooks file tools confined to the working directory | widen with `RUVECTOR_MCP_ROOTS` |
| 0.3.8 | `ruvector add <extra>` (rabitq, diskann, router, graph, rvlite, rvf, tiny-dancer); opt-in RaBitQ index | `add --list` shows what is installed |
| 0.3.10 | moves to `@ruvector/rvf` ^0.4.2 | — |
| 0.3.11 | `rvf` commands release the store lock when they fail | a failed `rvf` call no longer wedges the next one |
| 0.3.12 | `hooks graph-mincut` works (`engine: mincut-wasm`) | use it for code boundaries |
| 0.3.13 | `diskann build/search` CLI and `diskann_build`/`diskann_search` MCP tools; RaBitQ-backed hook recall in long-lived processes above `RUVECTOR_RABITQ_THRESHOLD` (default 5000); `@ruvector/attention` ^2.2.3 (GHSA-p62c-q7fc-qmg9) and `@ruvector/sona` ^0.1.11 | `add diskann` / `add rabitq` to enable; nothing to change for the security fixes |

`hooks rag-context` prints a "recall quality degraded" warning when stored memories were embedded with a different embedder than the query (ADR-210). `hooks reembed` re-embeds them; `--dry-run` reports first.

### Known limitations in 0.3.13

| Issue | Detail | Workaround |
|-------|--------|-----------|
| `hooks force-learn` | Runs, but reports `skipped: insufficient trajectories` until trajectories exist | record some via `trajectory-begin/step/end` first |
| `hooks trajectory-*` | Takes `--context`/`--agent`, `--action`/`--result`, `--quality`/`--success`. There is no `--session-id`, `--task` or `--verdict`, and one trajectory is open per project at a time | fold a session id into `--context` |
| `hooks git-churn` | Fails outside a git repo | run from inside the repo |
| `cluster` (top-level) | `Status: Coming Soon` | use `hooks graph-cluster` |
| `compare`, top-level `index`, `embed --batch/--glob/--model poincare` | Don't exist (`embed text` takes `--input-file` and `--stdin`) | see `commands/vector.md` for replacements |

## Self-Learning Hooks

```bash
# Full pretrain pipeline + agent generation
npx -y ruvector@0.3.13 hooks init --pretrain --build-agents quality

# Smart agent routing (positional task!)
npx -y ruvector@0.3.13 hooks route "implement OAuth flow"
npx -y ruvector@0.3.13 hooks route-enhanced "fix CVE-2025-1234"

# Code analysis (positional file!)
npx -y ruvector@0.3.13 hooks ast-analyze src/module.ts
npx -y ruvector@0.3.13 hooks diff-analyze HEAD
npx -y ruvector@0.3.13 hooks coverage-route src/module.ts
npx -y ruvector@0.3.13 hooks security-scan src/
```

## Brain (Collective Knowledge)

```bash
npm install @ruvector/pi-brain   # required dependency

npx -y ruvector@0.3.13 brain status
npx -y ruvector@0.3.13 brain search "authentication patterns"
npx -y ruvector@0.3.13 brain list
npx -y ruvector@0.3.13 brain drift code   # knowledge drift for a domain
```

## SONA (Self-Optimizing Neural Architecture)

```bash
npx -y ruvector@0.3.13 sona status
npx -y ruvector@0.3.13 sona patterns "auth refactor"
npx -y ruvector@0.3.13 sona stats
```

## Performance

| Operation | Latency | Notes |
|-----------|---------|-------|
| HNSW search | ~0.045ms | 8,800x vs ONNX inference |
| Memory cache | ~0.01ms | 40,000x vs ONNX inference |
| Insert | 52,000+/sec | Rust backend (`@ruvector/core`) |
| Memory per vector | ~50 bytes | Efficient storage |

## Known Caveats

- **ONNX runtime is bundled from 0.3.3** — `embed text` works with no add-on. Older ruvector (0.2.x) reports `ONNX WASM files not bundled`.
- **No `--batch`, `--glob`, `--namespace`, `--k`, `--task`, `--model poincare` flags** (`embed text` does take `--input-file` and `--stdin`) — these were in older docs but are not in 0.3.13. See `agents/vector-engineer.md` for the replacement table.
- **`brain` requires `@ruvector/pi-brain`** — install separately.
- **`sona` requires `@ruvector/ruvllm`** — install separately (the native binding is not always present in the npm tarball).
- **Top-level `cluster` is "Coming Soon"** — for actual clustering use `hooks graph-cluster <files>`.
- **`compare` and top-level `index` subcommands do not exist.**

## Architecture Decisions

- [`ADR-0001` — Pin ruflo-ruvector to ruvector@0.3.13 with optional add-ons](./docs/adrs/0001-pin-ruvector-0.2.25.md)

## Smoke test

```bash
bash plugins/ruflo-ruvector/scripts/smoke.sh
# Expected: "11 passed, 0 failed"
```

## Related Plugins

- `ruflo-agentdb` — HNSW storage backend in AgentDB
- `ruflo-intelligence` — SONA pattern learning integration
- `ruflo-knowledge-graph` — Graph RAG for multi-hop retrieval
- `ruflo-rag-memory` — Simple semantic search via ruvector

## License

MIT

## As a mod

Function-hook mod (ADR-445, pattern of `ruflo-agentdb`). It loads from `hooks/hooks.json` → `hooks/register.ts`.

A write guard for the vector store and shared brain: `hooks_remember`, `hooks_compress_store`, `hooks_learn`, `rvf_ingest`, `brain_share`, `brain_transfer` and `memory_store` refuse secrets (a shared brain is the worst place for one). Calls to any tool of the `ruvector` MCP server are counted.

- **Command**: `/ruvector-mod` answers locally with no model call. Verbs: `status`, `scan <text>`, `tools` (which ruvector tools are connected).
- **Status file**: `.claude-flow/ruvector-mod/status.json` (`{version, updatedMs, ...counters}`), written at session start and as counters change.
- **Safety**: no network, no process spawning; it only uses tools already connected.
- **Option** `guard` (`on` by default, `off` to disable): a tighten-only `tool.call` guard. A call to one of the tools above whose input holds a key, token, private key or password is denied. The reason never repeats the secret.
- **Test**: `claude plugin validate plugins/ruflo-ruvector`, `claude plugin test plugins/ruflo-ruvector`, `bash plugins/ruflo-ruvector/scripts/smoke.sh`.
