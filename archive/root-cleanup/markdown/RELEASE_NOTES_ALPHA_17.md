# Release Notes - v2.0.0-alpha.17

## 🎯 Fix: Auto-create settings.local.json (Issue #162)

### Problem Solved
The `init` command now automatically creates `.claude/settings.local.json` with pre-approved MCP permissions, eliminating repetitive permission prompts during first-time use.

### What's New
- **Automatic Permission Configuration**: No more manual approval for every MCP tool usage
- **Zero-friction Onboarding**: New users can immediately explore Claude Flow capabilities
- **Secure by Default**: Only trusted MCP servers (claude-flow, ruv-swarm) are pre-approved

### Implementation Details
- Added `settings.local.json` generation in `enhancedClaudeFlowInit` function
- Creates default permissions for `mcp__ruv-swarm` and `mcp__claude-flow`
- Respects `--dry-run` flag and overwrites with `--force`
- Full test coverage with 4 comprehensive test cases

### Usage
```bash
# Initialize with auto-configured permissions
npx claude-flow@alpha init

# The following file is now created automatically:
# .claude/settings.local.json
{
  "permissions": {
    "allow": [
      "mcp__ruv-swarm",
      "mcp__claude-flow"
    ],
    "deny": []
  }
}
```

### Credits
This fix was implemented by **Queen Seraphina** and the Claude Flow Hive Mind Collective 🐝

---

**Full Changelog**: https://github.com/ruvnet/claude-flow/compare/v2.0.0-alpha.16...v2.0.0-alpha.17