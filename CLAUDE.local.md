# Local Development Configuration

## Environment Variables

```bash
CLAUDE_FLOW_CONFIG=./claude-flow.config.json
CLAUDE_FLOW_LOG_LEVEL=info
CLAUDE_FLOW_MEMORY_BACKEND=hybrid
CLAUDE_FLOW_MEMORY_PATH=./data/memory
CLAUDE_FLOW_MCP_PORT=3000
CLAUDE_FLOW_MCP_TRANSPORT=stdio
```

## Quick Commands

```bash
npx claude-flow@v3alpha doctor --fix        # Diagnostics
npx claude-flow@v3alpha hooks worker list   # List workers
npx claude-flow@v3alpha hooks pre-task --description "[task]"
npx claude-flow@v3alpha hooks post-task --task-id "[id]" --success true
```

## Reference Docs

Detailed documentation moved to `/docs/reference/`:
- `publishing.md` — npm publishing workflow
- `hooks.md` — hooks system and workers
- `swarm-protocols.md` — swarm configuration and routing
- `plugin-registry.md` — IPFS/Pinata plugin registry
- `headless.md` — headless background instances (claude -p)
