# ADR 518: agentdb and agentic-flow as external ruflo marketplace plugins

Status: Accepted (marketplace change only; no ruflo npm release)

Date: 2026-10-31

Builds on: ADR-484 (external git-subdir plugins), ADR-445 (Claude Code plugin mods), ADR-504 (real-binary test tier), ADR-513 (stable versions, no alpha tags), ADR-514 and ADR-515 (agentdb and agentic-flow 3.0.0). Upstream: agentdb ADR-015 and PRs #37/#38; agentic-flow ADR-080 and PRs #247/#248.

## 1. Context

agentdb and agentic-flow are ruflo's two largest runtime dependencies, but until now neither shipped a Claude Code plugin of its own. A user who wanted agentdb's own MCP server, rather than the subset ruflo exposes through `ruflo-agentdb`, had to wire `.mcp.json` by hand, and nothing pinned the server version.

Both repositories now ship a plugin at `plugins/<name>/`, released together with the 3.1.0 packages:

| plugin | repo commit (tag `plugin-v3.1.0`) | MCP server | mod |
|---|---|---|---|
| `agentdb` | `401fcb680d3208c461892d21a5d014d0a3b0fee3` | `npx -y agentdb@3.1.0 mcp start` | `/agentdb-guard`: keeps secrets out of stored memory, refuses delete/reset tools unless allowed |
| `agentic-flow` | `2c86073bf55a105282bbdd4476fc18f5b7e6f97d` | `npx -y agentic-flow@3.1.0 mcp start` (readonly profile, nothing pre-approved) | `/agentic-flow-guard`: guard on `agentic_flow_agent` (enforce / notify / off) |

The packages behind them, also 3.1.0:

- agentdb: exact-search fallback below `AGENTDB_EXACT_SEARCH_THRESHOLD` (default 1000) rows; reward-aware rerank (0.7·similarity + 0.2·successRate + 0.1·avgReward, `rerank: false` keeps pure similarity); `agentdb_pattern_feedback`, `agentdb_skill_feedback`, `agentdb_capabilities` tools.
- agentic-flow: sticky embedding kind (no silent switch between ONNX and hash vectors in one process), one shared SSE line parser for the three proxies, statusline runs only the local bin, `hooks init` no longer pre-approves or uses floating dist-tags.

## 2. Decision

List both plugins in `.claude-plugin/marketplace.json` as external `git-subdir` entries, the same shape as `agentic-qe-fleet` (ADR-484):

- `url` is the upstream repository, `path` is `plugins/<name>`, `ref` is `plugin-v3.1.0`, `sha` is the full merge commit. Claude Code installs the exact commit; the tag is for humans.
- The plugin code stays in its own repository. ruflo does not vendor it, so a fix lands upstream and reaches ruflo by bumping `ref` and `sha`.
- Each MCP server is pinned to an exact package version inside the plugin, so a pinned commit always runs the same server.
- `agentdb` and `ruflo-agentdb` are different plugins and can be installed together: `agentdb` runs agentdb's own server; `ruflo-agentdb` reaches AgentDB through ruflo's server. The README says so.
- Each plugin is also offered by its own repository's marketplace. A user should install it from one marketplace only, or Claude Code loads two copies of the same mod and server.

## 3. Verification

1. `scripts/external-plugins.mjs` `externalSourceProblem()` accepts both entries (also enforced by `validate-marketplace.yml`).
2. Real-binary e2e, `v3/@claude-flow/cli/__tests__/real-binary/external-plugins.test.ts`, in the ADR-504 tier:
   - checks out the pinned `sha` with a shallow fetch, so it tests what the marketplace installs, not a working copy;
   - runs the real `claude` binary with the scripted mock model, isolated HOME and `--strict-mcp-config`;
   - asserts the mod answers its own command (`/agentdb-guard`, `/agentic-flow-guard`) with zero model requests;
   - negative control: a copy with a second bare `on('session.start')` (the #4485 shape) is refused by the loader, and the same assertion fails on it. A refused module exits 0 with no error, so without this control the test could pass vacuously.
   Commands a mod registers at session start are not listed in the init event's `slash_commands`; the test therefore reads the result event, not the init event.
3. Each plugin's own CI runs `claude plugin validate`, `claude plugin test` and its mod unit tests (agentdb 21, agentic-flow 40).
4. Fresh-install gate on the 3.1.0 packages under ruflo 3.67.0: `npm audit --omit=dev` 0 critical, `doctor` passes, `autopilot learn` under 1 s, stdio MCP stdout is JSON-only. ruflo's 115 agentdb-related CLI test files pass with agentdb 3.1.0 swapped in.

## 4. Consequences

- First launch is slow. `npx -y` with a cold cache took about 37 s for agentic-flow and 29 s for agentdb on ruvultra, close to Claude Code's 30 s MCP startup timeout, so the server can show "Failed to connect" once. Both READMEs say to warm the cache (`npx -y <pkg>@3.1.0 --version`), reconnect with `/mcp`, or set `MCP_TIMEOUT=90000`. A warm cache connects normally.
- The e2e does not start the MCP servers; their tool surfaces are covered upstream and by ruflo's `smoke-all-plugins` run of each plugin's `smoke.sh` at the pinned commit.
- Bumping either plugin is a two-line marketplace change (`ref`, `sha`) plus a rerun of the e2e.
- Open item, ruflo side: agentic-flow 3.1.0 makes `computeEmbedding` throw instead of silently mixing vector kinds. Both ruflo callers (neural-tools, memory-initializer) catch the throw, but ruflo's own fallback after the catch can still mix ONNX and hash vectors in one store. That is ruflo's bug, not agentic-flow's, and is tracked separately.
