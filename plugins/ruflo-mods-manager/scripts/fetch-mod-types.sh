#!/usr/bin/env bash
# Has Claude Code write its function-hooks declarations into .claude-plugin/types/
# (gitignored there), where tsconfig.json reads them: it does so each time it loads
# a mod from a folder. Needs Claude Code >= 2.1.287 on PATH. Regenerate, never edit.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$(mktemp -d)"
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir "$ROOT" -p 'reply with just ok' >/dev/null
head -1 "$ROOT/.claude-plugin/types/claude-code/index.d.ts"
