# Claude Flow V3 — MCP Package

This package shares the same rules as the CLI package. See `v3/@claude-flow/cli/CLAUDE.md` for:
- Behavioral rules
- File organization
- Concurrency rules
- Agent types
- Key packages
- Quick reference

## MCP-Specific Notes

- This package implements the MCP server for Claude Code integration
- Transport modes: stdio (default), SSE, streamable-http
- Tool registry provides agent, memory, swarm, and session tools
- See `/docs/reference/` for detailed MCP configuration
