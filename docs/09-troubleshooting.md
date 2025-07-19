# Troubleshooting Guide

This comprehensive troubleshooting guide covers common issues, diagnostic procedures, and solutions for Claude-Flow system problems. Use this guide to quickly identify and resolve issues in your Claude-Flow deployment.

## Common Installation and Setup Issues

### Installation Problems

**Issue: Command not found after installation**
```bash
# Diagnosis
which gemini-flow
echo $PATH
npm list -g gemini-flow

# Solutions
# For NPM global installation
npm install -g gemini-flow
npm bin -g  # Check global bin directory

# For Deno installation
deno info gemini-flow
export PATH="$HOME/.deno/bin:$PATH"
echo 'export PATH="$HOME/.deno/bin:$PATH"' >> ~/.bashrc

# Verify installation
gemini-flow --version
gemini-flow help
```

**Issue: Permission denied errors**
```bash
# Diagnosis
ls -la $(which gemini-flow)
id
groups

# Solutions
# Fix executable permissions
chmod +x $(which gemini-flow)

# For NPM permission issues
npm config set prefix ~/.npm-global
export PATH=~/.npm-global/bin:$PATH

# Use sudo for global installation (not recommended)
sudo npm install -g gemini-flow

# Alternative: Use npx without global installation
npx gemini-flow --version
```

**Issue: Deno compilation failures**
```bash
# Diagnosis
deno --version
deno check src/cli/index.ts
deno info

# Solutions
# Update Deno to latest version
curl -fsSL https://deno.land/x/install/install.sh | sh

# Clear Deno cache
deno cache --reload src/cli/index.ts

# Manual compilation
deno compile --allow-all --output bin/gemini-flow src/cli/index.ts

# Check dependencies
deno info src/cli/index.ts
```

### Configuration Issues

**Issue: Configuration file not found or invalid**
```bash
# Diagnosis
gemini-flow config show
ls -la gemini-flow.config.json
gemini-flow config validate

# Solutions
# Initialize default configuration
gemini-flow config init

# Validate existing configuration
gemini-flow config validate --fix-issues

# Use custom configuration path
gemini-flow --config /path/to/config.json start

# Reset to defaults
gemini-flow config init --force --backup-existing
```

**Issue: Environment variable conflicts**
```bash
# Diagnosis
env | grep CLAUDE_FLOW
printenv | grep -i claude

# Solutions
# Clear conflicting environment variables
unset CLAUDE_FLOW_CONFIG
unset CLAUDE_FLOW_DEBUG

# Set proper environment variables
export CLAUDE_FLOW_CONFIG_PATH=/path/to/config.json
export CLAUDE_FLOW_LOG_LEVEL=debug

# Verify environment
gemini-flow config show --include-env
```

## Agent Management Issues

### Agent Spawning Problems

**Issue: Agents fail to spawn**
```bash
# Diagnosis
gemini-flow agent list --all
gemini-flow system resources
gemini-flow logs --component orchestrator --level error

# Check system limits
ulimit -a
free -h
df -h

# Solutions
# Increase resource limits
gemini-flow config set orchestrator.maxConcurrentAgents 5
gemini-flow config set memory.cacheSizeMB 256

# Clear stuck agent processes
gemini-flow agent cleanup --force
gemini-flow system reset --soft

# Check for resource constraints
gemini-flow system optimize --free-memory
```

**Issue: Agent communication failures**
```bash
# Diagnosis
gemini-flow agent health --all
gemini-flow network diagnose
gemini-flow coordination queue status

# Solutions
# Restart coordination manager
gemini-flow coordination restart

# Clear message queues
gemini-flow coordination queue clear --confirm

# Reset agent communication
gemini-flow agent reset-communication --all

# Check network connectivity
gemini-flow network test --internal --external
```

**Issue: Agents consuming excessive resources**
```bash
# Diagnosis
gemini-flow agent resources --top 10
gemini-flow agent monitor <agent-id> --metrics memory,cpu
top -p $(pgrep -f gemini-flow)

# Solutions
# Set resource limits
gemini-flow agent update <agent-id> --memory-limit 1GB --cpu-limit 2

# Enable agent recycling
gemini-flow config set orchestrator.agentRecycling true
gemini-flow config set orchestrator.recycleThreshold 100

# Restart resource-heavy agents
gemini-flow agent restart <agent-id> --graceful
```

### Agent Performance Issues

**Issue: Agents responding slowly**
```bash
# Diagnosis
gemini-flow agent performance-analysis --all
gemini-flow task queue-analysis
gemini-flow system performance --detailed

# Solutions
# Optimize task distribution
gemini-flow task rebalance --strategy performance
gemini-flow coordination optimize

# Increase parallelism
gemini-flow config set coordination.maxConcurrentTasks 10

# Clear performance bottlenecks
gemini-flow performance optimize --focus agents
```

## Task Coordination Problems

### Task Queue Issues

**Issue: Tasks stuck in pending state**
```bash
# Diagnosis
gemini-flow task list --status pending --detailed
gemini-flow coordination deadlock-check
gemini-flow task dependencies --check-cycles

# Solutions
# Resolve deadlocks automatically
gemini-flow coordination deadlock-resolve --auto

# Manual task intervention
gemini-flow task force-assign <task-id> --agent <agent-id>
gemini-flow task clear-dependencies <task-id> --unsafe

# Reset task queue
gemini-flow coordination queue reset --type pending --backup
```

**Issue: Task execution timeouts**
```bash
# Diagnosis
gemini-flow task logs <task-id> --tail 100
gemini-flow agent info <agent-id> --current-task
gemini-flow coordination timeout-analysis

# Solutions
# Increase timeouts
gemini-flow config set coordination.resourceTimeout 300000
gemini-flow task update <task-id> --timeout 600s

# Optimize task execution
gemini-flow task optimize <task-id> --strategy speed
gemini-flow task split <task-id> --subtasks 3

# Force task completion
gemini-flow task force-complete <task-id> --with-partial-results
```

**Issue: Dependency resolution failures**
```bash
# Diagnosis
gemini-flow task dependencies <task-id> --validate
gemini-flow task dependency-graph --check-cycles
gemini-flow coordination dependency-analysis

# Solutions
# Fix circular dependencies
gemini-flow task fix-dependencies <task-id> --break-cycles

# Manual dependency override
gemini-flow task clear-dependencies <task-id> --selective
gemini-flow task add-dependency <task-id> --depends-on <other-task-id>

# Reset dependency graph
gemini-flow coordination reset-dependencies --rebuild
```

### Workflow Execution Issues

**Issue: Workflows failing to start**
```bash
# Diagnosis
gemini-flow task workflow validate <workflow-file>
gemini-flow task workflow simulate <workflow-file> --dry-run
gemini-flow coordination workflow-analysis

# Solutions
# Fix workflow definition
gemini-flow task workflow fix <workflow-file> --auto-correct
gemini-flow task workflow validate <workflow-file> --strict

# Manual workflow execution
gemini-flow task workflow execute <workflow-file> --force --ignore-warnings

# Workflow debugging
gemini-flow task workflow debug <workflow-id> --step-by-step
```

## Memory System Issues

### Memory Synchronization Problems

**Issue: Memory conflicts between agents**
```bash
# Diagnosis
gemini-flow memory conflicts --check-all
gemini-flow memory integrity-check --detailed
gemini-flow memory sync-status

# Solutions
# Resolve conflicts automatically
gemini-flow memory resolve-conflicts --strategy crdt
gemini-flow memory rebuild-index --force

# Manual conflict resolution
gemini-flow memory conflicts list --unresolved
gemini-flow memory resolve-conflict <conflict-id> --manual

# Reset memory synchronization
gemini-flow memory sync-reset --full-rebuild
```

**Issue: Memory usage growing unchecked**
```bash
# Diagnosis
gemini-flow memory stats --detailed --breakdown
gemini-flow memory analyze --size-distribution
du -sh ~/.gemini-flow/memory/*

# Solutions
# Immediate cleanup
gemini-flow memory cleanup --aggressive
gemini-flow memory compact --force

# Configure retention
gemini-flow config set memory.retentionDays 14
gemini-flow config set memory.compressionEnabled true

# Archive old data
gemini-flow memory archive --older-than 30d --compress
```

**Issue: Memory corruption or data loss**
```bash
# Diagnosis
gemini-flow memory integrity-check --full
gemini-flow memory validate --all-entries
gemini-flow memory backup-status

# Solutions
# Restore from backup
gemini-flow memory restore --backup latest --verify
gemini-flow memory rebuild-from-logs --since last-good-backup

# Repair corrupted data
gemini-flow memory repair --fix-corruption --backup-first
gemini-flow memory rebuild-index --verify-integrity

# Emergency data recovery
gemini-flow memory emergency-recovery --from-fragments
```

### Memory Performance Issues

**Issue: Slow memory operations**
```bash
# Diagnosis
gemini-flow memory performance-analysis
gemini-flow memory cache-analysis
gemini-flow memory index-analysis

# Solutions
# Optimize cache settings
gemini-flow config set memory.cacheSizeMB 512
gemini-flow memory cache-optimize --preload frequently-accessed

# Rebuild indexes
gemini-flow memory rebuild-indexes --parallel
gemini-flow memory optimize-queries --create-missing-indexes

# Database optimization
gemini-flow memory vacuum --full
gemini-flow memory analyze-statistics
```

## Terminal Management Issues

### Terminal Session Problems

**Issue: Terminal sessions not starting**
```bash
# Diagnosis
gemini-flow terminal pool status
gemini-flow terminal diagnose --all
gemini-flow system check --terminal

# Solutions
# Reset terminal pool
gemini-flow terminal pool reset --force
gemini-flow terminal pool initialize --rebuild

# Check shell availability
which bash zsh sh
echo $SHELL

# Fix terminal configuration
gemini-flow config set terminal.type auto
gemini-flow config set terminal.shellPreference '["bash","zsh","sh"]'
```

**Issue: Commands hanging or timing out**
```bash
# Diagnosis
gemini-flow terminal logs <session-id> --tail 50
gemini-flow terminal performance <session-id>
ps aux | grep gemini-flow

# Solutions
# Increase command timeout
gemini-flow config set terminal.commandTimeout 600000

# Kill hanging processes
gemini-flow terminal kill-hanging --force
pkill -f "gemini-flow.*terminal"

# Restart terminal session
gemini-flow terminal restart <session-id> --clean-state
```

**Issue: Terminal pool exhaustion**
```bash
# Diagnosis
gemini-flow terminal pool stats --utilization
gemini-flow terminal list --status all
gemini-flow system resources --terminals

# Solutions
# Increase pool size
gemini-flow config set terminal.poolSize 20

# Clean up idle sessions
gemini-flow terminal cleanup --idle-timeout 30m
gemini-flow terminal pool recycle --force

# Optimize session reuse
gemini-flow config set terminal.recycleAfter 50
```

### Multi-Terminal Coordination Issues

**Issue: Multi-terminal workflows failing**
```bash
# Diagnosis
gemini-flow terminal multi-status <workflow-name>
gemini-flow terminal dependency-check <workflow-name>
gemini-flow terminal logs-aggregate <workflow-name>

# Solutions
# Fix dependency issues
gemini-flow terminal multi-fix-dependencies <workflow-name>
gemini-flow terminal restart-failed <workflow-name>

# Manual workflow recovery
gemini-flow terminal multi-recover <workflow-name> --from-checkpoint
gemini-flow terminal multi-restart <workflow-name> --selective

# Simplify workflow
gemini-flow terminal multi-optimize <workflow-name> --reduce-dependencies
```

## MCP Integration Issues

### MCP Server Problems

**Issue: MCP server not starting**
```bash
# Diagnosis
gemini-flow mcp status --detailed
gemini-flow mcp logs --tail 100
netstat -tulpn | grep 3000

# Solutions
# Change MCP port
gemini-flow config set mcp.port 3001
gemini-flow mcp restart

# Fix port conflicts
lsof -i :3000
kill -9 $(lsof -t -i:3000)

# Validate MCP configuration
gemini-flow mcp validate-config --fix-issues
```

**Issue: Tools not responding or timing out**
```bash
# Diagnosis
gemini-flow mcp tools list --health
gemini-flow mcp tools test <tool-name> --verbose
gemini-flow mcp monitor --tools all

# Solutions
# Restart MCP tools
gemini-flow mcp tools restart <tool-name>
gemini-flow mcp tools refresh-registry

# Increase timeouts
gemini-flow config set mcp.requestTimeout 60000

# Tool debugging
gemini-flow mcp tools debug <tool-name> --trace
```

**Issue: Tool authentication failures**
```bash
# Diagnosis
gemini-flow mcp auth status
gemini-flow mcp tools permissions check <tool-name>
gemini-flow mcp audit --auth-failures

# Solutions
# Regenerate tokens
gemini-flow mcp auth regenerate-tokens --all
gemini-flow mcp auth refresh-permissions

# Fix permission issues
gemini-flow mcp permissions repair <tool-name>
gemini-flow mcp auth validate --fix-invalid

# Reset authentication
gemini-flow mcp auth reset --confirm
```

### Tool Integration Issues

**Issue: Custom tools not loading**
```bash
# Diagnosis
gemini-flow mcp tools validate <tool-path>
gemini-flow mcp tools registry status
ls -la /path/to/tools/

# Solutions
# Reinstall tools
gemini-flow mcp tools reinstall <tool-name>
gemini-flow mcp tools register --force <tool-path>

# Fix tool permissions
chmod +x /path/to/tools/*
gemini-flow mcp tools fix-permissions --all

# Rebuild tool registry
gemini-flow mcp tools rebuild-registry
```

## Network and Connectivity Issues

### Network Diagnostics

**Issue: Network connectivity problems**
```bash
# Diagnosis
gemini-flow network test --comprehensive
ping -c 4 8.8.8.8
curl -I https://api.github.com

# Solutions
# Configure proxy settings
gemini-flow config set network.proxy "http://proxy.company.com:8080"
export HTTP_PROXY=http://proxy.company.com:8080
export HTTPS_PROXY=http://proxy.company.com:8080

# DNS resolution issues
echo "nameserver 8.8.8.8" | sudo tee -a /etc/resolv.conf
systemctl restart systemd-resolved

# Firewall issues
sudo ufw allow 3000/tcp
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
```

**Issue: SSL/TLS certificate problems**
```bash
# Diagnosis
openssl s_client -connect api.example.com:443
curl -v https://api.example.com

# Solutions
# Update CA certificates
sudo apt-get update && sudo apt-get install ca-certificates
sudo update-ca-certificates

# Disable SSL verification (development only)
gemini-flow config set network.verifySSL false
export NODE_TLS_REJECT_UNAUTHORIZED=0

# Custom certificate handling
gemini-flow config set network.customCA "/path/to/ca-cert.pem"
```

## Performance and Resource Issues

### System Performance Problems

**Issue: High CPU or memory usage**
```bash
# Diagnosis
gemini-flow system resources --detailed
top -p $(pgrep -f gemini-flow)
htop

# Solutions
# Optimize performance settings
gemini-flow performance optimize --profile production
gemini-flow config set orchestrator.resourceAllocationStrategy memory-optimized

# Limit resource usage
gemini-flow config set orchestrator.maxConcurrentAgents 5
gemini-flow config set memory.cacheSizeMB 128

# Enable resource monitoring
gemini-flow monitoring enable --alerts true
```

**Issue: Slow response times**
```bash
# Diagnosis
gemini-flow performance analyze --duration 5m
gemini-flow benchmark --comprehensive
gemini-flow bottleneck-analysis

# Solutions
# Performance tuning
gemini-flow performance tune --aggressive
gemini-flow cache optimize --preload

# Parallel processing optimization
gemini-flow config set coordination.maxConcurrentTasks 8
gemini-flow config set terminal.maxConcurrentCommands 10

# Database optimization
gemini-flow memory optimize --rebuild-indexes
```

### Resource Exhaustion

**Issue: Out of memory errors**
```bash
# Diagnosis
free -h
gemini-flow memory usage --breakdown
dmesg | grep -i "out of memory"

# Solutions
# Free memory immediately
gemini-flow memory cleanup --emergency
gemini-flow cache clear --all

# Increase swap space
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Optimize memory settings
gemini-flow config set memory.cacheSizeMB 64
gemini-flow config set orchestrator.maxConcurrentAgents 3
```

**Issue: Disk space exhaustion**
```bash
# Diagnosis
df -h
du -sh ~/.gemini-flow/*
gemini-flow disk-usage --analyze

# Solutions
# Clean up immediately
gemini-flow cleanup --aggressive --logs --cache --temp
gemini-flow memory archive --compress --older-than 7d

# Configure retention policies
gemini-flow config set logging.maxFileSize "5MB"
gemini-flow config set logging.maxFiles 3
gemini-flow config set memory.retentionDays 7

# Move data to larger disk
gemini-flow migrate --data-directory /mnt/large-disk/gemini-flow
```

## Debugging and Diagnostic Tools

### System Diagnostics

**Comprehensive System Check:**
```bash
# Full system diagnostic
gemini-flow diagnose --comprehensive --output diagnostic-report.json

# Component-specific diagnostics
gemini-flow diagnose --component orchestrator --verbose
gemini-flow diagnose --component memory --include-performance
gemini-flow diagnose --component terminal --check-compatibility
gemini-flow diagnose --component mcp --test-tools
```

**Performance Diagnostics:**
```bash
# Performance profiling
gemini-flow profile --duration 10m --output performance-profile.json
gemini-flow benchmark --save-baseline baseline-$(date +%Y%m%d).json

# Resource monitoring
gemini-flow monitor --real-time --all-components
gemini-flow resources --continuous --alert-thresholds "cpu:80,memory:90"
```

### Log Analysis

**Centralized Log Analysis:**
```bash
# View all system logs
gemini-flow logs --all-components --since 1h
gemini-flow logs --level error --grep "failed\|timeout\|error"

# Export logs for analysis
gemini-flow logs export --format json --output logs-$(date +%Y%m%d).json
gemini-flow logs aggregate --time-range 24h --analysis true

# Search and filter logs
gemini-flow logs search "memory" --component orchestrator --time-range 6h
gemini-flow logs pattern-analysis --detect-anomalies
```

### Debug Information Collection

**Collecting Debug Information:**
```bash
# Generate comprehensive debug package
gemini-flow debug-info collect \
  --include-system \
  --include-logs \
  --include-configs \
  --include-performance \
  --output debug-package-$(date +%Y%m%d).tar.gz

# Privacy-safe debug collection
gemini-flow debug-info collect \
  --sanitize-sensitive \
  --exclude-data \
  --include-structure-only \
  --output safe-debug-package.tar.gz
```

## Recovery Procedures

### Emergency Recovery

**System Recovery Procedures:**
```bash
# Safe mode startup
gemini-flow start --safe-mode --minimal-agents --read-only-memory

# System reset (soft)
gemini-flow reset --soft --backup-data --preserve-config

# System reset (hard) - use with caution
gemini-flow reset --hard --confirm --backup-location /tmp/gemini-flow-backup

# Restore from backup
gemini-flow restore --backup gemini-flow-backup-20241215.tar.gz --verify
```

**Data Recovery:**
```bash
# Memory data recovery
gemini-flow memory recover --from-logs --since last-backup
gemini-flow memory rebuild --verify-integrity

# Configuration recovery
gemini-flow config restore --from-backup --merge-with-current
gemini-flow config repair --fix-corruption

# Emergency data export
gemini-flow export --emergency --all-data --output emergency-export.json
```

## Getting Additional Help

### Built-in Help and Documentation

**Interactive Help:**
```bash
# General help
gemini-flow help
gemini-flow <command> --help

# Interactive troubleshooting wizard
gemini-flow troubleshoot --interactive --guided

# Self-diagnostic with auto-fix
gemini-flow self-check --fix-issues --report-problems
```

### Support Resources

**Community Support:**
- **GitHub Issues**: https://github.com/ruvnet/gemini-flow/issues
- **Discussions**: https://github.com/ruvnet/gemini-flow/discussions
- **Discord Community**: https://discord.gg/gemini-flow

**Professional Support:**
- **Enterprise Support**: support@gemini-flow.dev
- **Consulting Services**: consulting@gemini-flow.dev
- **Training Programs**: training@gemini-flow.dev

### Reporting Issues

**Issue Reporting:**
```bash
# Generate issue report
gemini-flow report-issue \
  --title "Agent communication failures" \
  --description "Detailed problem description" \
  --include-diagnostics \
  --include-logs \
  --output issue-report.json

# Submit to GitHub (requires gh CLI)
gh issue create \
  --title "Claude-Flow Issue Report" \
  --body-file issue-report.json \
  --label "bug,needs-triage"
```

**Best Practices for Issue Reporting:**
1. Include Claude-Flow version: `gemini-flow --version`
2. Provide system information: `gemini-flow system-info`
3. Include relevant logs and error messages
4. Describe steps to reproduce the issue
5. Mention any recent configuration changes
6. Include diagnostic output when possible

This troubleshooting guide should help resolve most common issues with Claude-Flow. For persistent problems, don't hesitate to reach out to the community or professional support channels.