# Migration Guide: Gemini Flow v1 to v2.0.0

## Overview

Gemini Flow v2.0.0 introduces significant improvements to environment handling, particularly for non-interactive environments like VS Code integrated terminal, CI/CD systems, and Docker containers. This guide will help you migrate from v1 to v2 smoothly.

## Key Changes in v2.0.0

### 1. Automatic Environment Detection

**v1 Behavior:**
- Manual flag specification required
- Errors when `--dangerously-skip-permissions` wasn't enough
- No smart defaults based on environment

**v2 Enhancement:**
- Automatic detection of VS Code, CI/CD, Docker, SSH, etc.
- Smart application of appropriate flags
- Automatic retry with non-interactive mode on failure

### 2. New CLI Flags

**New in v2:**
- `--non-interactive`: Full automation without any prompts
- `--auto-approve`: Auto-approve all confirmations (use with caution)
- `--prompt-defaults`: Supply JSON defaults for prompts
- `--ci`: Optimized for CI/CD environments
- `--vscode-compat`: VS Code compatibility mode
- `--batch`: Batch processing mode for scripts

### 3. Environment Variables

**New Environment Variables:**
```bash
# Enable non-interactive mode globally
export CLAUDE_NON_INTERACTIVE=1

# Auto-approve all confirmations
export CLAUDE_AUTO_APPROVE=1

# Supply prompt defaults
export CLAUDE_PROMPT_DEFAULTS='{"model":"claude-3-opus-20240229","region":"us-east-1"}'

# Set default model
export CLAUDE_DEFAULT_MODEL="claude-3-opus-20240229"

# Set default region
export CLAUDE_DEFAULT_REGION="us-east-1"
```

## Migration Steps

### Step 1: Update Your Installation

```bash
# Uninstall v1 (if globally installed)
npm uninstall -g gemini-flow

# Install v2.0.0
npm install -g gemini-flow@2.0.0

# Or use directly with npx
npx gemini-flow@2.0.0 --version
```

### Step 2: Update Your Scripts

#### VS Code Tasks (tasks.json)

**v1 Configuration:**
```json
{
  "label": "Initialize Gemini Flow",
  "type": "shell",
  "command": "npx gemini-flow init --dangerously-skip-permissions",
  "problemMatcher": []
}
```

**v2 Configuration:**
```json
{
  "label": "Initialize Gemini Flow",
  "type": "shell",
  "command": "npx gemini-flow@2.0.0 init",
  "problemMatcher": [],
  "presentation": {
    "reveal": "always",
    "panel": "dedicated"
  }
}
```

> Note: v2 automatically detects VS Code and applies appropriate flags!

#### CI/CD Workflows

**v1 GitHub Actions:**
```yaml
- name: Run Gemini Flow
  run: |
    npx gemini-flow init --dangerously-skip-permissions
    npx gemini-flow swarm "build project" --dangerously-skip-permissions
```

**v2 GitHub Actions:**
```yaml
- name: Run Gemini Flow
  run: |
    # v2 auto-detects CI environment
    npx gemini-flow@2.0.0 init
    npx gemini-flow@2.0.0 swarm "build project"
```

#### Docker Deployments

**v1 Dockerfile:**
```dockerfile
RUN npx gemini-flow init --dangerously-skip-permissions --force
```

**v2 Dockerfile:**
```dockerfile
# v2 auto-detects Docker environment
RUN npx gemini-flow@2.0.0 init

# Or explicitly set for consistency
ENV CLAUDE_NON_INTERACTIVE=1
RUN npx gemini-flow@2.0.0 init
```

### Step 3: Update Package.json Scripts

**v1 scripts:**
```json
{
  "scripts": {
    "claude:init": "gemini-flow init --dangerously-skip-permissions",
    "claude:swarm": "gemini-flow swarm --dangerously-skip-permissions"
  }
}
```

**v2 scripts:**
```json
{
  "scripts": {
    "claude:init": "gemini-flow init",
    "claude:swarm": "gemini-flow swarm",
    "claude:env-check": "gemini-flow env-check",
    "claude:init:force": "gemini-flow init --non-interactive"
  }
}
```

### Step 4: Handle Breaking Changes

#### 1. Flag Name Changes
- `--force` → `--force` (no change, but now smarter)
- `--skip-prompts` → `--non-interactive` (more descriptive)
- `--yes` → `--auto-approve` (clearer intent)

#### 2. Default Behavior Changes
- v2 automatically applies `--dangerously-skip-permissions` in non-TTY environments
- v2 automatically retries with `--non-interactive` on interactive errors
- v2 provides sensible defaults for common prompts in non-interactive mode

#### 3. Error Messages
- v2 provides clearer error messages with actionable solutions
- v2 includes environment detection info in error reports

### Step 5: Test Your Migration

1. **Check Environment Detection:**
   ```bash
   npx gemini-flow@2.0.0 env-check
   ```

2. **Test in Your Environment:**
   ```bash
   # VS Code Terminal
   npx gemini-flow@2.0.0 init --dry-run
   
   # CI/CD (simulate)
   CI=true npx gemini-flow@2.0.0 init --dry-run
   
   # Docker (simulate)
   DOCKER_CONTAINER=true npx gemini-flow@2.0.0 init --dry-run
   ```

3. **Verify Prompt Defaults:**
   ```bash
   # Set defaults
   export CLAUDE_PROMPT_DEFAULTS='{"projectName":"my-project"}'
   npx gemini-flow@2.0.0 init --non-interactive
   ```

## Common Issues and Solutions

### Issue 1: "Manual UI agreement needed" Error

**v1 Workaround:**
```bash
# Often didn't work completely
gemini-flow init --dangerously-skip-permissions
```

**v2 Solution:**
```bash
# Automatic detection and retry
gemini-flow init

# Or force non-interactive
gemini-flow init --non-interactive
```

### Issue 2: VS Code Extension Commands Failing

**v1 Problem:**
- Extension commands run in output panel (no TTY)
- Manual flags required but not always sufficient

**v2 Solution:**
- Automatic VS Code detection
- Smart defaults applied
- Automatic retry on failure

### Issue 3: CI/CD Pipeline Hanging

**v1 Problem:**
```yaml
# Would hang waiting for input
run: npx gemini-flow init
```

**v2 Solution:**
```yaml
# Auto-detects CI and runs non-interactively
run: npx gemini-flow@2.0.0 init
```

### Issue 4: Docker Build Failures

**v1 Problem:**
```dockerfile
# Would fail without proper flags
RUN npx gemini-flow init
```

**v2 Solution:**
```dockerfile
# Auto-detects Docker environment
RUN npx gemini-flow@2.0.0 init
```

## Advanced Configuration

### Custom Prompt Defaults

Create `~/.gemini-flow/prompt-defaults.json`:
```json
{
  "global": [
    {
      "id": "projectName",
      "type": "text",
      "defaultValue": "my-default-project"
    }
  ],
  "command": {
    "init": [
      {
        "id": "includeDocker",
        "type": "confirm",
        "defaultValue": true
      }
    ]
  },
  "environment": {
    "ci": [
      {
        "id": "deploy",
        "type": "confirm",
        "defaultValue": false
      }
    ]
  }
}
```

### Environment-Specific Settings

```bash
# Development
NODE_ENV=development npx gemini-flow@2.0.0 init

# Production (more conservative defaults)
NODE_ENV=production npx gemini-flow@2.0.0 init

# Custom environment
CLAUDE_ENVIRONMENT=staging npx gemini-flow@2.0.0 init
```

## Best Practices for v2

1. **Let Auto-Detection Work:**
   - Don't add flags unless necessary
   - Trust the environment detection
   - Use `env-check` to verify detection

2. **Use Environment Variables for Consistency:**
   ```bash
   # .env.ci
   CLAUDE_NON_INTERACTIVE=1
   CLAUDE_AUTO_APPROVE=1
   CLAUDE_DEFAULT_MODEL=claude-3-opus-20240229
   ```

3. **Test Before Production:**
   ```bash
   # Test with dry-run
   npx gemini-flow@2.0.0 init --dry-run
   
   # Check what flags would be applied
   npx gemini-flow@2.0.0 env-check
   ```

4. **Use Specific Flags When Needed:**
   ```bash
   # Force interactive even in CI
   CI=true npx gemini-flow@2.0.0 init --interactive
   
   # Force non-interactive even with TTY
   npx gemini-flow@2.0.0 init --non-interactive
   ```

## Rollback Plan

If you need to rollback to v1:

```bash
# Downgrade
npm install -g gemini-flow@1.0.0

# Add back manual flags
export CLAUDE_V1_MODE=1
alias gemini-flow='gemini-flow --dangerously-skip-permissions'
```

## Getting Help

1. **Check Environment:**
   ```bash
   npx gemini-flow@2.0.0 env-check
   ```

2. **Enable Debug Mode:**
   ```bash
   DEBUG=gemini-flow:* npx gemini-flow@2.0.0 init
   ```

3. **Report Issues:**
   - Include output of `env-check`
   - Include error messages
   - Specify your environment (VS Code, CI, Docker, etc.)

## Summary

Gemini Flow v2.0.0 makes working in non-interactive environments much easier:

- ✅ Automatic environment detection
- ✅ Smart flag application
- ✅ Automatic retry on errors
- ✅ Sensible defaults for automation
- ✅ Better error messages
- ✅ No more manual flag guessing

The migration is designed to be backward compatible where possible, with most improvements happening automatically. Update to v2.0.0 and enjoy a smoother experience across all environments!