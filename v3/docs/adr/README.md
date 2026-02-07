# Claude Flow V3 ADR Index (Truth-Synced)

## Implementation Status

- Status: `Partially Implemented`.
- ADR files are present in `v3/implementation/adrs/`.
- This index does not mark ADRs as "complete" unless runtime evidence is available in code.

## Location

- ADR directory: `v3/implementation/adrs/`

## Selected ADRs (Declared Decisions)

| ADR | Topic | File |
|---|---|---|
| ADR-001 | Agent implementation | `v3/implementation/adrs/ADR-001-AGENT-IMPLEMENTATION.md` |
| ADR-004 | Plugin architecture | `v3/implementation/adrs/ADR-004-PLUGIN-ARCHITECTURE.md` |
| ADR-005 | MCP-first API | `v3/implementation/adrs/ADR-005-implementation-summary.md` |
| ADR-006 | Unified memory | `v3/implementation/adrs/ADR-006-UNIFIED-MEMORY.md` |
| ADR-011 | LLM provider system | `v3/implementation/adrs/ADR-011-llm-provider-system.md` |
| ADR-017 | RuVector integration | `v3/implementation/adrs/ADR-017-ruvector-integration.md` |
| ADR-018 | Claude Code integration | `v3/implementation/adrs/ADR-018-claude-code-integration.md` |
| ADR-030 | agentic-qe integration | `v3/implementation/adrs/ADR-030-agentic-qe-integration.md` |
| ADR-031 | prime-radiant integration | `v3/implementation/adrs/ADR-031-prime-radiant-integration.md` |
| ADR-045 | Guidance system integration | `v3/implementation/adrs/ADR-045-guidance-system-v31-integration.md` |

## Related Runtime Anchors

- CLI command registry: `v3/@claude-flow/cli/src/commands/index.ts`
- MCP command and server management: `v3/@claude-flow/cli/src/commands/mcp.ts`, `v3/@claude-flow/cli/src/mcp-server.ts`
- Provider system: `v3/@claude-flow/providers/src/provider-manager.ts`
- Plugin SDK: `v3/@claude-flow/plugins/src/index.ts`
- QE plugin: `v3/plugins/agentic-qe/src/plugin.ts`
- Coherence plugin: `v3/plugins/prime-radiant/src/plugin.ts`

## Evidence

- ADR files exist: `v3/implementation/adrs/ADR-001-AGENT-IMPLEMENTATION.md:1`, `v3/implementation/adrs/ADR-045-guidance-system-v31-integration.md:1`
- ADR status summary file exists: `v3/implementation/adrs/ADR-STATUS-SUMMARY.md:1`
- Existing index location reference: `v3/docs/adr/README.md:3` (pre-sync source)

## Known Limitations

- ADR text can describe target architecture ahead of current runtime behavior.
- Use code files as source of truth for "implemented now" statements.
