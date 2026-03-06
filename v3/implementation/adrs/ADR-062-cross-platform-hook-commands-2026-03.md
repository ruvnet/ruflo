# ADR-062: Cross-Platform Hook Command Generation

**Date:** 2026-03-05
**Status:** Accepted
**Context:** Settings.json hook commands failed on Windows due to `node -e` quoting issues.

## Problem

The `hookCmd()` function in `settings-generator.ts` generated complex `node -e "..."` one-liners for hook commands:

```
node -e "var c=require('child_process'),p=require('path'),r;try{r=c.execSync('git rev-parse --show-toplevel',{encoding:'utf8'}).trim()}catch(e){r=process.cwd()}var s=p.join(r,'.claude/helpers/hook-handler.cjs');process.argv.splice(1,0,s);require(s)" pre-bash
```

This broke on Windows because:
- **cmd.exe**: Single quotes inside double-quoted `node -e` arguments are treated as literal characters, not JavaScript string delimiters. Parentheses in `catch(e)`, `.trim()`, `process.cwd()` may be interpreted as cmd.exe grouping operators in certain contexts.
- **PowerShell**: Different quoting semantics for `$` variables and escape characters.
- **Complexity**: The one-liner mixed shell quoting, JavaScript string literals, and `execSync` shell commands in a fragile chain.

## Decision

Replace `node -e "..."` one-liners with direct script invocation:

```typescript
// Before (broken on Windows):
function hookCmd(script: string, subcommand: string): string {
  const scriptLiteral = `'${script}'`;
  const resolver = [
    "var c=require('child_process'),p=require('path'),r;",
    "try{r=c.execSync('git rev-parse --show-toplevel',{encoding:'utf8'}).trim()}",
    'catch(e){r=process.cwd()}',
    `var s=p.join(r,${scriptLiteral});`,
    'process.argv.splice(1,0,s);',
    'require(s)',
  ].join('');
  return `node -e "${resolver}" ${subcommand}`.trim();
}

// After (works on all platforms):
function hookCmd(script: string, subcommand: string): string {
  return `node ${script} ${subcommand}`.trim();
}
```

**Generated command example:**
```
node .claude/helpers/hook-handler.cjs pre-bash
```

### Why This Works

The `node -e` one-liner existed to resolve the git root at runtime, ensuring hooks worked regardless of CWD. However, **Claude Code always runs hooks from the project root directory**, making git-root resolution redundant. Direct invocation with relative paths works identically on Windows, macOS, and Linux.

### Platform Detection

Added `detectPlatform()` integration to `generateSettings()`. The detected platform (OS, architecture, shell type) is now stored in `claudeFlow.platform` within settings.json:

```json
{
  "claudeFlow": {
    "platform": {
      "os": "windows",
      "arch": "x64",
      "shell": "powershell"
    }
  }
}
```

Platform detection was already implemented in `types.ts` (`PlatformInfo` interface, `detectPlatform()` function) but was not being used in settings generation.

## Capabilities Preserved

All 12 hook types, auto-memory, learning bridge, memory graph, agent scopes, neural training, PreCompact context preservation, Stop sync, statusline, and all 10 daemon workers remain fully functional. Only the invocation mechanism changed.

| Before | After |
|--------|-------|
| `node -e "var c=require('child_process')..." pre-bash` | `node .claude/helpers/hook-handler.cjs pre-bash` |
| `node -e "...import(u.pathToFileURL(f)...)" import` | `node .claude/helpers/auto-memory-hook.mjs import` |
| `node -e "..." (statusline)` | `node .claude/helpers/statusline.cjs` |

## Files Changed

| File | Change |
|------|--------|
| `src/init/settings-generator.ts` | Simplified `hookCmd()` and `hookCmdEsm()` to direct invocation; imported `detectPlatform()`; added platform info to generated settings |

## Consequences

- Hook commands now work on Windows (cmd.exe, PowerShell), macOS, and Linux without quoting issues
- Generated settings.json is smaller and more readable (no minified JS in command strings)
- Platform information stored in settings enables future platform-specific behavior
- No capability loss — all hooks, memory, learning, and coordination features preserved
- Users on Windows must re-run `init --force` to regenerate settings.json with fixed commands
