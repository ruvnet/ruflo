---
description: Initialize .gitignore with Claude Code specific patterns
allowed-tools: Read, Edit, Write, Bash(echo:*), Bash(cat:*), Bash(test:*)
category: workflow
---

# Initialize .gitignore for Claude Code

Set up or update the project's .gitignore file with Claude Code specific patterns.

## Core Claude Code Files to Ignore

Ensure these Claude Code local configuration files are ignored:
- `CLAUDE.local.md` - Local AI assistant instructions (root)
- `.claude/settings.local.json` - Personal Claude Code settings
- `.mcp.local.json` - Local MCP server configuration (root)

## Development Patterns

These common development artifacts will also be added:
- `temp/` - Temporary working directory
- `temp-*/` - Temporary directories with prefix
- `test-*/` - Test directories with prefix
- `debug-*.js` - Debug scripts
- `test-*.js` - Test scripts
- `*-test.js` - Test files with suffix
- `*-debug.js` - Debug files with suffix

## Current .gitignore Status

!`[ -f .gitignore ] && echo "EXISTS: .gitignore found" && echo "---CONTENTS---" && cat .gitignore || echo "MISSING: No .gitignore file found"`

## Task

Based on the above status:
1. Create `.gitignore` if it doesn't exist
2. Add all patterns that aren't already present
3. Preserve existing entries and comments
4. Report what was added

## Patterns to Add

```gitignore
# Claude Code local files
CLAUDE.local.md
.claude/settings.local.json
.mcp.local.json

# Temporary and debug files
temp/
temp-*/
test-*/
debug-*.js
test-*.js
*-test.js
*-debug.js
```

Implement this by:
1. Using the gitignore status above to determine what's missing
2. Adding missing patterns with appropriate comments
3. Preserving the existing file structure and entries