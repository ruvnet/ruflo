# 🚀 Claude Flow v2.0.0 Setup Guide

## 📋 Table of Contents
1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Installation Methods](#installation-methods)
4. [Initial Configuration](#initial-configuration)
5. [Environment Setup](#environment-setup)
6. [Verification](#verification)
7. [Advanced Setup](#advanced-setup)
8. [Troubleshooting](#troubleshooting)

## ✅ Prerequisites

### System Requirements
- **Node.js**: v20.0.0 or higher (v22 recommended)
- **NPM**: v10.0.0 or higher
- **Operating System**: Windows 10+, macOS 11+, or Linux
- **Memory**: 4GB RAM minimum (8GB recommended)
- **Disk Space**: 500MB free space

### Check Prerequisites
```bash
# Check Node.js version
node --version  # Should be v20.0.0 or higher

# Check NPM version
npm --version  # Should be v10.0.0 or higher

# Check available disk space
df -h .  # Linux/macOS
# or use File Explorer on Windows
```

## 🚀 Quick Start

The fastest way to get started with Claude Flow v2.0.0:

```bash
# One-command setup with full enterprise features
npx claude-flow@2.0.0 init --sparc

# Start orchestration immediately
./claude-flow start --ui --port 3000
```

This creates a complete enterprise environment with:
- ✅ Local `./claude-flow` wrapper script
- ✅ `.claude/` configuration directory
- ✅ `CLAUDE.md` with ruv-swarm integration docs
- ✅ 27 MCP tools for swarm intelligence
- ✅ Docker support files
- ✅ GitHub workflow automation

## 📦 Installation Methods

### Method 1: NPX Quick Start (Recommended)
```bash
# Initialize with enterprise features and ruv-swarm
npx claude-flow@2.0.0 init --sparc

# Or minimal setup
npx claude-flow@2.0.0 init --minimal

# With Docker support
npx claude-flow@2.0.0 init --docker
```

### Method 2: Global Installation
```bash
# Install globally
npm install -g claude-flow@2.0.0

# Verify installation
claude-flow --version

# Initialize in any directory
claude-flow init --sparc
```

### Method 3: Project Installation
```bash
# Add to existing project
npm install claude-flow@2.0.0 --save-dev

# Add to package.json scripts
npm pkg set scripts.flow="claude-flow"
npm pkg set scripts.flow:start="claude-flow start --ui"
npm pkg set scripts.flow:swarm="claude-flow swarm"

# Initialize
npx claude-flow init --sparc
```

### Method 4: Docker Installation
```bash
# Pull official image
docker pull ruvnet/claude-flow:2.0.0

# Run with volume mapping
docker run -it -v $(pwd):/app -p 3000:3000 ruvnet/claude-flow:2.0.0 init --sparc
```

## ⚙️ Initial Configuration

### 1. Run Initialization
```bash
./claude-flow init --sparc
```

You'll be prompted for:
- **Project name**: Your project identifier
- **MCP integration**: Enable Model Context Protocol (recommended: Yes)
- **GitHub integration**: Enable workflow automation (recommended: Yes)
- **Docker support**: Add Docker configuration (optional)
- **Memory persistence**: Enable cross-session memory (recommended: Yes)

### 2. Configuration Structure
After initialization, your project will have:
```
your-project/
├── claude-flow          # Executable wrapper script
├── .claude/             # Configuration directory
│   ├── config.json      # Main configuration
│   ├── settings.json    # User preferences
│   ├── commands/        # Custom commands
│   └── templates/       # Project templates
├── CLAUDE.md           # Integration documentation
├── memory/             # Persistent memory storage
└── logs/               # System logs
```

### 3. Customize Configuration
Edit `.claude/config.json`:
```json
{
  "version": "2.0.0",
  "features": {
    "mcp": true,
    "swarm": true,
    "github": true,
    "docker": false,
    "monitoring": true
  },
  "ui": {
    "port": 3000,
    "theme": "dark",
    "autoOpen": true
  },
  "swarm": {
    "defaultTopology": "hierarchical",
    "maxAgents": 8,
    "parallelExecution": true
  }
}
```

## 🌍 Environment Setup

### 1. Environment Variables
Create `.env` file:
```bash
# Claude Flow Configuration
CLAUDE_FLOW_PORT=3000
CLAUDE_FLOW_UI_THEME=dark
CLAUDE_FLOW_LOG_LEVEL=info

# MCP Configuration
MCP_SERVER_PORT=3001
MCP_TIMEOUT=30000

# Swarm Configuration
SWARM_MAX_AGENTS=8
SWARM_DEFAULT_TOPOLOGY=hierarchical
SWARM_PARALLEL_EXECUTION=true

# Memory Configuration
MEMORY_PERSISTENCE=true
MEMORY_BACKUP_INTERVAL=3600000

# Optional: API Keys
GITHUB_TOKEN=your_github_token
OPENAI_API_KEY=your_openai_key
```

### 2. Shell Configuration

#### Bash/Zsh
Add to `~/.bashrc` or `~/.zshrc`:
```bash
# Claude Flow aliases
alias cf="./claude-flow"
alias cfs="./claude-flow start --ui"
alias cfswarm="./claude-flow swarm"
alias cfsparc="./claude-flow sparc"

# Add current directory to PATH for claude-flow
export PATH="$PATH:."
```

#### PowerShell (Windows)
Add to PowerShell profile:
```powershell
# Claude Flow aliases
Set-Alias cf ".\claude-flow"
Set-Alias cfs ".\claude-flow start --ui"
Set-Alias cfswarm ".\claude-flow swarm"
Set-Alias cfsparc ".\claude-flow sparc"
```

### 3. IDE Configuration

#### VS Code
Create `.vscode/settings.json`:
```json
{
  "claude-flow.enable": true,
  "claude-flow.ui.port": 3000,
  "claude-flow.swarm.autoStart": true,
  "terminal.integrated.env.linux": {
    "CLAUDE_FLOW_CONFIG": "${workspaceFolder}/.claude"
  }
}
```

## ✅ Verification

### 1. Check Installation
```bash
# Verify version
./claude-flow --version
# Expected: claude-flow/2.0.0 darwin-arm64 node-v22.11.0

# Check system status
./claude-flow status
# Should show all components as "Ready"
```

### 2. Test Core Features
```bash
# Start UI
./claude-flow start --ui
# Visit http://localhost:3000

# Spawn test agent
./claude-flow agent spawn researcher --name "TestBot"

# Run simple SPARC command
./claude-flow sparc run code "create hello world function"
```

### 3. Verify MCP Integration
```bash
# Check MCP server
./claude-flow mcp status

# List available tools
./claude-flow mcp tools

# Should show 27+ tools including:
# - swarm_init
# - agent_spawn
# - task_orchestrate
# - memory_usage
# - neural_train
```

### 4. Test Swarm Features
```bash
# Initialize swarm
./claude-flow swarm init --topology mesh --max-agents 3

# Run test swarm
./claude-flow swarm "analyze this codebase" --monitor
```

## 🔧 Advanced Setup

### 1. Custom Command Directory
```bash
# Create custom commands
mkdir -p .claude/commands

# Add custom command
cat > .claude/commands/my-workflow.js << 'EOF'
module.exports = {
  name: 'my-workflow',
  description: 'Custom development workflow',
  action: async (args) => {
    console.log('Running custom workflow...');
    // Your custom logic here
  }
};
EOF
```

### 2. Memory Bank Configuration
```bash
# Initialize memory with custom settings
./claude-flow memory init --size 100mb --compression gzip

# Configure auto-backup
./claude-flow memory config --auto-backup --interval 1h
```

### 3. Performance Optimization
```bash
# Enable performance features
./claude-flow config set performance.cache true
./claude-flow config set performance.parallelAgents 8
./claude-flow config set performance.tokenOptimization true
```

### 4. Security Configuration
```bash
# Set up access control
./claude-flow security init

# Configure audit logging
./claude-flow audit config --enable --retention 90d

# Set up API key encryption
./claude-flow security encrypt-keys
```

### 5. CI/CD Integration

#### GitHub Actions
```yaml
# .github/workflows/claude-flow.yml
name: Claude Flow CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npx claude-flow@2.0.0 init --ci
      - run: ./claude-flow test
      - run: ./claude-flow swarm "run tests" --parallel
```

## 🔍 Troubleshooting

### Common Issues

#### 1. Permission Denied
```bash
# Solution: Make wrapper executable
chmod +x claude-flow

# Or use npm/npx
npx claude-flow start
```

#### 2. Port Already in Use
```bash
# Change port
./claude-flow start --ui --port 3001

# Or kill existing process
lsof -ti:3000 | xargs kill -9  # macOS/Linux
netstat -ano | findstr :3000   # Windows
```

#### 3. MCP Connection Failed
```bash
# Check MCP server
./claude-flow mcp diagnose

# Restart MCP
./claude-flow mcp restart

# Check logs
tail -f logs/mcp-server.log
```

#### 4. Memory Issues
```bash
# Clear memory cache
./claude-flow memory clear --cache

# Rebuild memory index
./claude-flow memory rebuild

# Check memory usage
./claude-flow memory stats
```

### Diagnostic Commands
```bash
# Full system diagnostic
./claude-flow diagnose --full

# Component-specific checks
./claude-flow diagnose --mcp
./claude-flow diagnose --swarm
./claude-flow diagnose --memory

# Generate diagnostic report
./claude-flow diagnose --report > diagnostic-report.txt
```

## 📚 Next Steps

1. **Read the Documentation**
   - [Migration Guide](./MIGRATION_GUIDE.md) - If upgrading from Deno
   - [API Reference](./API_REFERENCE.md) - Complete command list
   - [GitHub Integration](./GITHUB_INTEGRATION.md) - Workflow automation

2. **Try Example Workflows**
   ```bash
   # Development workflow
   ./claude-flow sparc run architect "design REST API"
   
   # Testing workflow
   ./claude-flow swarm "comprehensive test suite" --strategy testing
   
   # Deployment workflow
   ./claude-flow sparc run devops "setup CI/CD pipeline"
   ```

3. **Join the Community**
   - [GitHub Discussions](https://github.com/ruvnet/claude-code-flow/discussions)
   - [Discord Server](https://discord.gg/claude-flow)
   - [YouTube Tutorials](https://youtube.com/@claude-flow)

## 🎯 Quick Reference Card

```bash
# Essential Commands
./claude-flow init --sparc        # Initialize with all features
./claude-flow start --ui          # Start with web interface
./claude-flow status              # Check system health
./claude-flow swarm "task"        # Run multi-agent task
./claude-flow sparc run code      # SPARC code generation
./claude-flow agent spawn type    # Create new agent
./claude-flow memory store/query  # Memory operations
./claude-flow monitor             # Real-time monitoring

# Keyboard Shortcuts (in UI)
Ctrl/Cmd + K    # Command palette
Ctrl/Cmd + P    # Quick file search
Ctrl/Cmd + T    # New terminal
Ctrl/Cmd + S    # Save current state
```

---

**🎉 Setup Complete! You're ready to use Claude Flow v2.0.0**

For additional help, run: `./claude-flow help` or visit our [documentation](https://github.com/ruvnet/claude-code-flow/docs).