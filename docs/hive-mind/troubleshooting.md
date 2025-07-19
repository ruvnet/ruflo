# 🔧 Hive Mind Troubleshooting Guide

## Overview

This guide helps you resolve common issues with the Hive Mind system. Each issue includes symptoms, causes, and step-by-step solutions.

## Table of Contents

1. [Installation Issues](#installation-issues)
2. [Wizard Problems](#wizard-problems)
3. [Agent Coordination Issues](#agent-coordination-issues)
4. [Performance Problems](#performance-problems)
5. [Memory Issues](#memory-issues)
6. [Task Execution Errors](#task-execution-errors)
7. [Integration Problems](#integration-problems)
8. [Environment-Specific Issues](#environment-specific-issues)

## Installation Issues

### Issue: Command Not Found

**Symptoms**:
```bash
$ npx gemini-flow@2.0.0 hive-mind
Command not found: gemini-flow
```

**Solutions**:

1. **Ensure npm is installed**:
```bash
node --version  # Should show v20+
npm --version   # Should show v9+
```

2. **Clear npm cache**:
```bash
npm cache clean --force
```

3. **Try direct execution**:
```bash
npx --yes gemini-flow@2.0.0 hive-mind
```

4. **Global installation**:
```bash
npm install -g gemini-flow@2.0.0
gemini-flow hive-mind
```

### Issue: Permission Denied

**Symptoms**:
```
Error: EACCES: permission denied
```

**Solutions**:

1. **Use npm prefix**:
```bash
npm config set prefix ~/.npm-global
export PATH=~/.npm-global/bin:$PATH
npm install -g gemini-flow@2.0.0
```

2. **Fix npm permissions**:
```bash
sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}
```

3. **Use npx (recommended)**:
```bash
npx gemini-flow@2.0.0 hive-mind
```

## Wizard Problems

### Issue: Wizard Not Starting

**Symptoms**:
- Blank screen after command
- No interactive prompts
- Hangs at "Loading..."

**Solutions**:

1. **Check terminal compatibility**:
```bash
echo $TERM  # Should not be "dumb"
```

2. **Use non-interactive mode**:
```bash
npx gemini-flow@2.0.0 hive-mind --non-interactive \
  --task "Your task here" \
  --complexity medium
```

3. **Try web UI**:
```bash
npx gemini-flow@2.0.0 start --ui
# Navigate to http://localhost:3000
```

4. **Reset terminal**:
```bash
reset
clear
stty sane
```

### Issue: Input Not Recognized

**Symptoms**:
- Arrow keys show `^[[A` characters
- Can't select options
- Enter key doesn't work

**Solutions**:

1. **Use number keys**:
   - Press `1`, `2`, `3` instead of arrows
   - Type full text instead of selecting

2. **Fix terminal settings**:
```bash
export TERM=xterm-256color
```

3. **Use Git Bash on Windows**:
```bash
# Run in Git Bash, not cmd.exe
winpty npx gemini-flow@2.0.0 hive-mind
```

## Agent Coordination Issues

### Issue: Agents Not Working Together

**Symptoms**:
- Agents working on same tasks
- No knowledge sharing
- Duplicate outputs
- Sequential instead of parallel execution

**Solutions**:

1. **Check swarm status**:
```bash
npx gemini-flow@2.0.0 hive-mind swarm status
```

2. **Force synchronization**:
```bash
npx gemini-flow@2.0.0 hive-mind swarm sync
```

3. **Verify memory system**:
```bash
npx gemini-flow@2.0.0 hive-mind memory status
```

4. **Reset swarm**:
```bash
npx gemini-flow@2.0.0 hive-mind swarm reset
npx gemini-flow@2.0.0 hive-mind init --topology mesh
```

### Issue: Agent Spawn Failures

**Symptoms**:
```
Error: Failed to spawn agent: coordinator-001
```

**Solutions**:

1. **Check agent limits**:
```bash
npx gemini-flow@2.0.0 hive-mind config get max-agents
# Increase if needed
npx gemini-flow@2.0.0 hive-mind config set max-agents 12
```

2. **Verify resources**:
```bash
npx gemini-flow@2.0.0 hive-mind monitor --metrics "resources"
```

3. **Manual spawn**:
```bash
npx gemini-flow@2.0.0 hive-mind agents spawn \
  --type coordinator \
  --name "Manual-Coord"
```

## Performance Problems

### Issue: Slow Task Execution

**Symptoms**:
- Tasks taking longer than estimated
- Progress stuck at certain percentage
- High memory/CPU usage

**Solutions**:

1. **Analyze bottlenecks**:
```bash
npx gemini-flow@2.0.0 hive-mind monitor \
  --metrics "bottlenecks,performance"
```

2. **Optimize topology**:
```bash
npx gemini-flow@2.0.0 hive-mind swarm optimize
```

3. **Adjust agent count**:
```bash
# Reduce for simpler tasks
npx gemini-flow@2.0.0 hive-mind swarm scale --target 4

# Increase for complex tasks
npx gemini-flow@2.0.0 hive-mind swarm scale --target 10
```

4. **Enable caching**:
```bash
npx gemini-flow@2.0.0 hive-mind config set cache.enabled true
npx gemini-flow@2.0.0 hive-mind config set cache.ttl 3600
```

### Issue: High Token Usage

**Symptoms**:
- Excessive API costs
- Token limit warnings
- Incomplete results due to limits

**Solutions**:

1. **Monitor token usage**:
```bash
npx gemini-flow@2.0.0 hive-mind report performance \
  --metrics "token-usage" \
  --timeframe 24h
```

2. **Set token limits**:
```bash
npx gemini-flow@2.0.0 hive-mind config set \
  limits.maxTokensPerAgent 5000
```

3. **Use efficient strategies**:
```bash
npx gemini-flow@2.0.0 hive-mind orchestrate \
  --strategy adaptive \
  --share-memory true
```

## Memory Issues

### Issue: Memory Full

**Symptoms**:
```
Error: Memory limit exceeded (27.3 MB)
```

**Solutions**:

1. **Clear old entries**:
```bash
npx gemini-flow@2.0.0 hive-mind memory clear \
  --older-than 7d
```

2. **Increase memory size**:
```bash
npx gemini-flow@2.0.0 hive-mind config set \
  memory.size 64
```

3. **Enable compression**:
```bash
npx gemini-flow@2.0.0 hive-mind config set \
  memory.compress true
```

4. **Backup and reset**:
```bash
npx gemini-flow@2.0.0 hive-mind memory backup \
  --path ./backup.json
npx gemini-flow@2.0.0 hive-mind memory clear --all
```

### Issue: Memory Corruption

**Symptoms**:
- Agents can't access shared data
- Inconsistent results
- "Memory key not found" errors

**Solutions**:

1. **Verify memory integrity**:
```bash
npx gemini-flow@2.0.0 hive-mind memory verify
```

2. **Restore from backup**:
```bash
npx gemini-flow@2.0.0 hive-mind memory restore \
  --path ./last-good-backup.json
```

3. **Rebuild memory index**:
```bash
npx gemini-flow@2.0.0 hive-mind memory rebuild-index
```

## Task Execution Errors

### Issue: Task Analysis Failure

**Symptoms**:
```
Error: Unable to analyze task complexity
```

**Solutions**:

1. **Provide more detail**:
```bash
npx gemini-flow@2.0.0 hive-mind --task \
  "Build REST API with user auth, PostgreSQL database, and JWT tokens" \
  --context "Using Express.js framework"
```

2. **Use templates**:
```bash
npx gemini-flow@2.0.0 hive-mind template use rest-api
```

3. **Manual complexity**:
```bash
npx gemini-flow@2.0.0 hive-mind \
  --task "Your task" \
  --complexity medium \
  --no-analysis
```

### Issue: Incomplete Results

**Symptoms**:
- Missing files
- Partial implementation
- Tests not created

**Solutions**:

1. **Check task status**:
```bash
npx gemini-flow@2.0.0 hive-mind task status
```

2. **Review agent logs**:
```bash
npx gemini-flow@2.0.0 hive-mind agents list --with-logs
```

3. **Re-run failed tasks**:
```bash
npx gemini-flow@2.0.0 hive-mind task retry --failed-only
```

4. **Generate report**:
```bash
npx gemini-flow@2.0.0 hive-mind report tasks \
  --format detailed \
  --include-errors
```

## Integration Problems

### Issue: MCP Tools Not Available

**Symptoms**:
```
Error: MCP tool 'swarm_init' not found
```

**Solutions**:

1. **Verify MCP setup**:
```bash
claude mcp list
# Should show gemini-flow with 87 tools
```

2. **Re-add MCP server**:
```bash
claude mcp remove gemini-flow
claude mcp add gemini-flow npx gemini-flow@2.0.0 mcp start --stdio
```

3. **Check permissions**:
```bash
ls -la ~/.claude/
# Should have write permissions
```

### Issue: GitHub Integration Failing

**Symptoms**:
- Can't access repositories
- PR creation fails
- Authentication errors

**Solutions**:

1. **Verify GitHub token**:
```bash
npx gemini-flow@2.0.0 hive-mind integrate github \
  --test-connection
```

2. **Update credentials**:
```bash
npx gemini-flow@2.0.0 hive-mind config set \
  github.token "your-new-token"
```

3. **Check permissions**:
   - Token needs: repo, workflow, read:org

## Environment-Specific Issues

### Issue: VS Code Terminal Problems

**Symptoms**:
- No interactive prompts
- Output panel errors
- "Manual UI agreement needed"

**Solutions**:

1. **Use integrated terminal**:
   - Press `Ctrl+` ` (backtick)
   - NOT the output panel

2. **Non-interactive mode**:
```bash
npx gemini-flow@2.0.0 hive-mind \
  --non-interactive \
  --dangerously-skip-permissions
```

3. **Environment variable**:
```bash
export CLAUDE_NON_INTERACTIVE=1
npx gemini-flow@2.0.0 hive-mind
```

### Issue: Docker Container Issues

**Symptoms**:
- TTY errors
- No color output
- Input not working

**Solutions**:

1. **Run with TTY**:
```bash
docker run -it gemini-flow:2.0.0 hive-mind
```

2. **Without TTY**:
```bash
docker run gemini-flow:2.0.0 hive-mind \
  --non-interactive \
  --no-color \
  --task "Your task"
```

3. **Docker Compose**:
```yaml
services:
  hive-mind:
    image: gemini-flow:2.0.0
    tty: true
    stdin_open: true
```

### Issue: CI/CD Pipeline Failures

**Symptoms**:
- Hangs waiting for input
- "Not a TTY" errors
- Timeout in pipelines

**Solutions**:

1. **CI mode**:
```bash
npx gemini-flow@2.0.0 hive-mind \
  --ci \
  --non-interactive \
  --task "$BUILD_TASK"
```

2. **GitHub Actions**:
```yaml
- name: Run Hive Mind
  env:
    CI: true
    CLAUDE_NON_INTERACTIVE: 1
  run: |
    npx gemini-flow@2.0.0 hive-mind \
      --task "${{ github.event.inputs.task }}" \
      --timeout 600000
```

## Debug Mode

### Enable Comprehensive Debugging

```bash
# Set debug environment
export HIVE_MIND_DEBUG=true
export DEBUG=gemini-flow:*

# Run with verbose output
npx gemini-flow@2.0.0 hive-mind \
  --verbose \
  --log-level debug \
  --task "Your task"
```

### Debug Output Files

```bash
# Check debug logs
ls ~/.gemini-flow/logs/
cat ~/.gemini-flow/logs/hive-mind-debug.log

# Agent specific logs
cat ~/.gemini-flow/logs/agents/*.log
```

### Performance Profiling

```bash
# Enable profiling
npx gemini-flow@2.0.0 hive-mind \
  --profile \
  --task "Your task"

# View profile results
npx gemini-flow@2.0.0 hive-mind report profile \
  --last-run
```

## Getting Help

### 1. Built-in Help

```bash
npx gemini-flow@2.0.0 hive-mind --help
npx gemini-flow@2.0.0 hive-mind <command> --help
```

### 2. Diagnostics

```bash
npx gemini-flow@2.0.0 hive-mind diagnostic run
```

### 3. Support Channels

- GitHub Issues: https://github.com/ruvnet/gemini-flow/issues
- Documentation: https://github.com/ruvnet/gemini-flow/docs
- Discord: https://discord.gg/gemini-flow

### 4. Report Template

When reporting issues, include:

```markdown
**Environment:**
- OS: [e.g., macOS 14.0]
- Node: [e.g., v20.10.0]
- npm: [e.g., 10.2.3]
- Gemini Flow: [e.g., 2.0.0]

**Command Run:**
```bash
npx gemini-flow@2.0.0 hive-mind --task "..."
```

**Expected Behavior:**
What should have happened

**Actual Behavior:**
What actually happened

**Error Messages:**
```
Paste any error messages here
```

**Debug Log:**
```
Attach relevant portions of debug log
```
```

## Prevention Tips

1. **Keep Updated**:
```bash
npm update -g gemini-flow
```

2. **Regular Backups**:
```bash
# Automated daily backups
npx gemini-flow@2.0.0 hive-mind config set \
  backup.auto true \
  backup.interval 24h
```

3. **Monitor Resources**:
```bash
# Set up alerts
npx gemini-flow@2.0.0 hive-mind monitor \
  --alert-on "memory>80%,errors>5"
```

4. **Use Templates**:
   - Start with proven patterns
   - Customize as needed
   - Share successful configs

Remember: Most issues have simple solutions. Start with the basics before trying complex fixes!