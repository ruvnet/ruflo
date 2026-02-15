# V3 Module Development

This directory contains the V3 monorepo packages. Root CLAUDE.md rules apply here.

## Build & Test

```bash
# From v3/@claude-flow/<package>
npm install && npm run build && npm test
```

## Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@claude-flow/core` | `@claude-flow/core/` | Shared types, security, auth, providers, AI defence |
| `@claude-flow/cli` | `@claude-flow/cli/` | CLI entry point |
| `@claude-flow/agents` | `@claude-flow/agents/` | Swarm coordination, patterns, lifecycle hooks |
| `@claude-flow/memory` | `@claude-flow/memory/` | AgentDB + HNSW vector search + embeddings |
| `@claude-flow/integrations` | `@claude-flow/integrations/` | Codex, MCP server, browser, deployment |
| `@claude-flow/plugins` | `@claude-flow/plugins/` | Plugin SDK, guidance, testing framework |

## Code Quality

- Files under 500 lines
- No hardcoded secrets
- Input validation at system boundaries
- Typed interfaces for all public APIs
- TDD London School (mock-first) preferred
- Event sourcing for state changes

## Performance Targets

| Metric | Target | Status |
|--------|--------|--------|
| HNSW Search | optimized | Implemented |
| Memory Reduction | 50-75% (Int8 quantization) | Implemented |
| MCP Response | <100ms | Achieved |
| CLI Startup | <500ms | Achieved |
| Flash Attention | CPU-optimized | In progress |
