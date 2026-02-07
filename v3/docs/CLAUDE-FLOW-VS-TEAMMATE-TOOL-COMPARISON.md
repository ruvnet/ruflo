# Claude Flow vs Teammate Tool Comparison (Evidence-Limited)

## Implementation Status

- Status: `Aspirational / Historical Analysis`.
- This document is intentionally conservative: it keeps only claims that can be traced to files in this repository.
- Previous percentage overlap claims and reverse-engineering conclusions are downgraded because they are not reproducible from local code alone.

## Verified In This Repository

| Area | Local Evidence | Confidence |
|---|---|---|
| Teammate integration plugin package exists | `v3/plugins/teammate-plugin/package.json` | High |
| Bridge API for team/teammate operations exists in source | `v3/plugins/teammate-plugin/src/teammate-bridge.ts` | High |
| CLI includes multi-agent command families (`agent`, `swarm`, `hive-mind`) | `v3/@claude-flow/cli/src/commands/index.ts` | High |
| MCP command management exists (`mcp start/stop/status/...`) | `v3/@claude-flow/cli/src/commands/mcp.ts` | High |

## Comparison Scope You Can Validate Locally

| Dimension | Claude Flow (this repo) | Teammate side in this repo |
|---|---|---|
| CLI swarm-oriented commands | Present | Not applicable |
| Dedicated teammate bridge package | Present (`v3/plugins/teammate-plugin`) | Present as plugin code, not as external runtime binary |
| Team topology and routing structures | Present in teammate plugin source | Present as TypeScript constructs |
| External runtime behavior parity claims | Not proven locally | Not proven locally |

## What Was Removed or Downgraded

- Numeric overlap scores (for example, `92%`) were removed.
- Binary-level assertions were removed.
- Any statement requiring external proprietary runtime inspection is now marked unverified.

## How To Perform A Reproducible Comparison (Future Work)

1. Define fixed scenarios (team spawn, message broadcast, plan approval, cleanup).
2. Execute each scenario against both systems with captured logs and artifacts.
3. Compare observable inputs/outputs only.
4. Publish scripts and raw outputs under version control.

## Evidence

- Teammate plugin package metadata: `v3/plugins/teammate-plugin/package.json:2`, `v3/plugins/teammate-plugin/package.json:68`
- Teammate bridge feature declarations: `v3/plugins/teammate-plugin/src/teammate-bridge.ts:7`, `v3/plugins/teammate-plugin/src/teammate-bridge.ts:247`
- Teammate plugin exports: `v3/plugins/teammate-plugin/src/index.ts:41`, `v3/plugins/teammate-plugin/src/index.ts:68`
- CLI command registry: `v3/@claude-flow/cli/src/commands/index.ts:29`, `v3/@claude-flow/cli/src/commands/index.ts:37`
- MCP command surface: `v3/@claude-flow/cli/src/commands/mcp.ts:747`, `v3/@claude-flow/cli/src/commands/mcp.ts:750`

## Known Limitations

- This repository does not contain authoritative external Teammate runtime outputs.
- Comparison beyond source-level structures requires controlled side-by-side execution and captured evidence.
