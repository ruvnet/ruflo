# Fix Plan: Issue #249 - Variable Interpolation in Claude Code Hooks

## Problem Summary
Claude Code hooks use `${file}` and `${command}` syntax for variable interpolation, but these variables are not being replaced with actual values during hook execution.

## Investigation Plan

### Phase 1: Research & Documentation Analysis (2 hours)

#### 1.1 Claude Code Documentation Review
- [ ] Search official Claude Code documentation for hook variable syntax
- [ ] Check Claude Code GitHub/Discord for similar issues
- [ ] Review Claude Code changelog for hook-related changes
- [ ] Test with latest Claude Code version

#### 1.2 Environment Variable Testing
```bash
# Test different variable syntaxes in hooks
${file}          # Current syntax (not working)
$file            # Shell variable
${CLAUDE_FILE}   # Environment variable syntax
{{file}}         # Mustache-style template
%(file)s         # Python-style formatting
```

#### 1.3 Hook Context Investigation
- [ ] Determine what data Claude Code passes to hooks
- [ ] Check if hooks receive stdin input
- [ ] Investigate environment variables available during hook execution
- [ ] Test command-line arguments passed to hooks

### Phase 2: Implementation Strategy (4 hours)

#### 2.1 Approach A: Direct Variable Support
If Claude Code supports variable interpolation:
```javascript
// Fix template syntax in enhanced-templates.js
const hookTemplates = {
  "PostToolUse": [{
    "matcher": "Write|Edit|MultiEdit",
    "hooks": [{
      "type": "command",
      "command": "npx claude-flow@alpha hooks post-edit --file \"${CLAUDE_HOOK_FILE}\" --format true"
    }]
  }]
};
```

#### 2.2 Approach B: Wrapper Script Solution
If no native support exists:
```bash
#!/bin/bash
# .claude/hooks/post-edit-wrapper.sh

# Read hook context from environment or stdin
HOOK_DATA=$(cat)
FILE=$(echo "$HOOK_DATA" | jq -r '.file // empty')
COMMAND=$(echo "$HOOK_DATA" | jq -r '.command // empty')

# Execute actual hook with parsed values
if [ -n "$FILE" ]; then
  npx claude-flow@alpha hooks post-edit --file "$FILE" --format true
fi
```

#### 2.3 Approach C: Hook Preprocessor
Implement a preprocessor in Claude Flow:
```javascript
// src/cli/simple-commands/init/hook-preprocessor.js
export function preprocessHookCommand(command, context) {
  // Replace ${variable} with actual values
  return command.replace(/\${(\w+)}/g, (match, varName) => {
    return context[varName] || match;
  });
}
```

### Phase 3: Implementation Tasks (6 hours)

#### 3.1 Core Implementation
```javascript
// src/cli/simple-commands/init/templates/hook-variables.js
export const HOOK_VARIABLE_MAPPINGS = {
  // Map Claude Code variables to our expected format
  'file': ['file', 'path', 'filePath', 'CLAUDE_FILE'],
  'command': ['command', 'cmd', 'CLAUDE_COMMAND'],
  'tool': ['tool', 'toolName', 'CLAUDE_TOOL']
};

export function detectHookVariables(hookEnv) {
  const detected = {};
  
  // Check environment variables
  for (const [key, aliases] of Object.entries(HOOK_VARIABLE_MAPPINGS)) {
    for (const alias of aliases) {
      if (process.env[alias]) {
        detected[key] = process.env[alias];
        break;
      }
    }
  }
  
  // Check stdin if available
  if (process.stdin.isTTY === false) {
    try {
      const stdinData = JSON.parse(fs.readFileSync(0, 'utf8'));
      Object.assign(detected, stdinData);
    } catch (e) {
      // Not JSON, ignore
    }
  }
  
  return detected;
}
```

#### 3.2 Template Updates
```javascript
// Update all hook templates to use discovered syntax
const updateHookTemplates = (syntax) => {
  const templates = [
    'enhanced-templates.js',
    'safe-hook-patterns.js',
    'claude-md.js'
  ];
  
  templates.forEach(file => {
    updateTemplateSyntax(file, syntax);
  });
};
```

#### 3.3 Migration Script Enhancement
```javascript
// scripts/fix-hook-variables.js
#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';

async function fixHookVariables(settingsPath) {
  const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  
  // Update hook commands with correct variable syntax
  if (settings.hooks) {
    settings.hooks = transformHookVariables(settings.hooks);
  }
  
  // Backup and save
  await fs.writeFile(`${settingsPath}.backup`, JSON.stringify(settings, null, 2));
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
}
```

### Phase 4: Testing Strategy (4 hours)

#### 4.1 Unit Tests
```javascript
// tests/unit/hook-variables.test.js
describe('Hook Variable Interpolation', () => {
  test('detects environment variables', () => {
    process.env.CLAUDE_FILE = '/test/file.js';
    const vars = detectHookVariables();
    expect(vars.file).toBe('/test/file.js');
  });
  
  test('detects stdin JSON input', () => {
    const stdin = JSON.stringify({ file: '/test/file.js' });
    const vars = detectHookVariables(stdin);
    expect(vars.file).toBe('/test/file.js');
  });
  
  test('preprocesses hook commands', () => {
    const command = 'echo "File: ${file}"';
    const context = { file: '/test/file.js' };
    const result = preprocessHookCommand(command, context);
    expect(result).toBe('echo "File: /test/file.js"');
  });
});
```

#### 4.2 Integration Tests
```javascript
// tests/integration/claude-code-hooks.test.js
describe('Claude Code Hook Integration', () => {
  test('hook receives file parameter on edit', async () => {
    // 1. Create test file
    // 2. Trigger edit through Claude Code
    // 3. Verify hook was called with correct file path
  });
  
  test('hook receives command parameter on bash execution', async () => {
    // 1. Set up hook for Bash commands
    // 2. Execute command through Claude Code
    // 3. Verify hook received command text
  });
});
```

#### 4.3 Manual Testing Script
```bash
#!/bin/bash
# tests/manual/test-hook-variables.sh

echo "🧪 Testing Claude Code Hook Variables"

# Test 1: File edit hook
cat > .claude/settings.json << 'EOF'
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write",
      "hooks": [{
        "type": "command",
        "command": "echo 'Hook called with file: ${file}' >> hook-test.log"
      }]
    }]
  }
}
EOF

# Test 2: Command execution hook
# Test 3: Different variable syntaxes
# ... more tests
```

### Phase 5: Documentation (2 hours)

#### 5.1 User Documentation
```markdown
# Claude Code Hook Variables

## Supported Variables

Claude Code provides the following variables in hooks:

| Variable | Description | Example |
|----------|-------------|---------|
| `${file}` | File path being edited | `/src/index.js` |
| `${command}` | Command being executed | `npm test` |
| `${tool}` | Tool being used | `Write`, `Bash` |

## Usage Examples

### File Operation Hooks
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "npx prettier --write \"${file}\""
      }]
    }]
  }
}
```

### Command Execution Hooks
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "echo \"Executing: ${command}\" >> commands.log"
      }]
    }]
  }
}
```
```

#### 5.2 Migration Guide
```markdown
# Migrating Hook Variables

If you're experiencing issues with hook variables not working:

1. **Check your Claude Code version**
   ```bash
   claude --version
   ```

2. **Run the variable fix script**
   ```bash
   npx claude-flow@alpha fix-hook-variables
   ```

3. **Verify your syntax**
   - Old: `$file` or `$(file)`
   - New: `${file}`

4. **Test your hooks**
   ```bash
   npx claude-flow@alpha test-hooks
   ```
```

### Phase 6: Rollout Plan (2 hours)

#### 6.1 Alpha Testing
1. Create test branch: `fix/hook-variable-interpolation`
2. Deploy to alpha channel
3. Test with small group of users
4. Gather feedback

#### 6.2 Release Steps
1. [ ] Update all templates with correct syntax
2. [ ] Add fix-hook-variables command
3. [ ] Update documentation
4. [ ] Create migration guide
5. [ ] Add to CHANGELOG
6. [ ] Release as patch version

#### 6.3 Monitoring
- Monitor GitHub issues for hook-related problems
- Track usage of fix-hook-variables command
- Collect telemetry on hook execution failures

## Success Criteria

1. **Variables work correctly**: `${file}` and `${command}` are replaced with actual values
2. **Backward compatibility**: Existing hooks continue to work
3. **Clear documentation**: Users understand how to use variables
4. **Easy migration**: One-command fix for existing users
5. **No regression**: All existing hook functionality remains intact

## Timeline

- **Day 1**: Research & Investigation (Phases 1-2)
- **Day 2-3**: Implementation (Phase 3)
- **Day 4**: Testing (Phase 4)
- **Day 5**: Documentation & Release (Phases 5-6)

## Risk Mitigation

1. **Risk**: Claude Code doesn't support variables
   - **Mitigation**: Implement wrapper script solution

2. **Risk**: Breaking existing hooks
   - **Mitigation**: Extensive testing, gradual rollout

3. **Risk**: Different Claude Code versions behave differently
   - **Mitigation**: Version detection and compatibility layer

## Alternative Solutions

If variable interpolation cannot be made to work:

1. **Static Hooks**: Document that variables aren't supported
2. **Wrapper Scripts**: Provide template wrapper scripts
3. **Hook Proxy**: Create a proxy that intercepts and enhances hooks
4. **Claude Flow Hooks**: Implement our own hook system independent of Claude Code

## Testing Checklist

- [ ] Test with Claude Code 1.0.51+
- [ ] Test with different operating systems (Mac, Linux, Windows)
- [ ] Test with different shells (bash, zsh, fish, PowerShell)
- [ ] Test all hook types (PreToolUse, PostToolUse, Stop)
- [ ] Test all variable types (file, command, tool)
- [ ] Test with special characters in file paths
- [ ] Test with long commands
- [ ] Test error scenarios
- [ ] Performance testing with many hooks
- [ ] Security testing (command injection)

## Resources Needed

1. **Development**: 1 developer for 1 week
2. **Testing**: Access to different OS/shell combinations
3. **Documentation**: Technical writer review
4. **User Testing**: 5-10 beta testers

## Next Steps

1. Get approval for this plan
2. Set up test environment
3. Begin Phase 1 research
4. Create tracking issue for progress
5. Schedule daily standups during implementation