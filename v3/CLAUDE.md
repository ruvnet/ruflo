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
| `@claude-flow/cli` | `@claude-flow/cli/` | CLI entry point (26 commands, 140+ subcommands) |
| `@claude-flow/guidance` | `@claude-flow/guidance/` | Governance control plane (compile, enforce, prove, evolve) |
| `@claude-flow/hooks` | `@claude-flow/hooks/` | 17 hooks + 12 background workers |
| `@claude-flow/memory` | `@claude-flow/memory/` | AgentDB + HNSW vector search |
| `@claude-flow/shared` | `@claude-flow/shared/` | Shared types and utilities |
| `@claude-flow/security` | `@claude-flow/security/` | Input validation, path security, CVE remediation |

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
