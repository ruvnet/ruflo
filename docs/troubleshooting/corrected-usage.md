# Claude Flow v2.0.0 - Correct Command Usage Guide

## ✅ CORRECT COMMAND USAGE

All commands must be prefixed with `claude-flow`:

### 🧠 Swarm Commands
```bash
# CORRECT:
claude-flow swarm "Build a REST API with authentication"
claude-flow swarm "Research cloud patterns" --strategy research
claude-flow swarm "Optimize performance" --max-agents 3 --parallel

# INCORRECT:
swarm "Build a REST API"  # ❌ Won't work
```

### 🐙 GitHub Commands
```bash
# CORRECT:
claude-flow github pr-manager "create feature PR with tests"
claude-flow github gh-coordinator "setup CI/CD pipeline"
claude-flow github release-manager "prepare v2.0.0 release"

# INCORRECT:
github pr-manager "create PR"  # ❌ Won't work
```

### 🤖 Agent Commands
```bash
# CORRECT:
claude-flow agent spawn researcher --name "DataBot"
claude-flow agent list --verbose
claude-flow agent terminate agent-123

# INCORRECT:
agent spawn researcher  # ❌ Won't work
spawn researcher  # ❌ Won't work
```

### 💾 Memory Commands
```bash
# CORRECT:
claude-flow memory store architecture "microservices pattern"
claude-flow memory get architecture
claude-flow memory query "API design"

# INCORRECT:
memory store key value  # ❌ Won't work
```

### 🚀 SPARC Commands
```bash
# CORRECT:
claude-flow sparc "design authentication system"
claude-flow sparc architect "design microservices"
claude-flow sparc tdd "user registration feature"

# INCORRECT:
sparc architect "design"  # ❌ Won't work
```

### 📋 Other Commands
```bash
# CORRECT:
claude-flow init --sparc
claude-flow start --ui --swarm
claude-flow status --verbose
claude-flow task create research "Market analysis"
claude-flow config set terminal.poolSize 15
claude-flow mcp status
claude-flow monitor --watch
claude-flow batch create-config my-batch.json

# INCORRECT:
init --sparc  # ❌ Won't work
start --ui  # ❌ Won't work
status  # ❌ Won't work
```

## 🔍 GET HELP

### Main Help
```bash
claude-flow --help
claude-flow help
claude-flow  # (no arguments also shows help)
```

### Command-Specific Help
```bash
claude-flow swarm --help
claude-flow github --help
claude-flow agent --help
claude-flow memory --help
claude-flow sparc --help
claude-flow init --help
claude-flow help swarm
claude-flow help github
# ... etc for any command
```

## 🚀 QUICK START

```bash
# 1. Initialize with SPARC
npx claude-flow@2.0.0 init --sparc

# 2. Start orchestration
claude-flow start --ui --swarm

# 3. Deploy a swarm
claude-flow swarm "Build REST API" --strategy development --parallel

# 4. Use GitHub automation
claude-flow github pr-manager "coordinate release"

# 5. Check status
claude-flow status --verbose
```

## 📝 IMPORTANT NOTES

1. **Always prefix with `claude-flow`** - The commands won't work without it
2. **Use quotes for objectives** - Especially with spaces: `"Build REST API"`
3. **Check help for options** - Each command has specific options
4. **Use --help liberally** - Detailed help is available for every command

## 🎯 INSTALLATION

### Global Installation (Recommended)
```bash
npm install -g claude-flow@2.0.0
claude-flow init --sparc
```

### Local Installation
```bash
npm install claude-flow@2.0.0
npx claude-flow init --sparc
```

### Direct NPX Usage
```bash
npx claude-flow@2.0.0 init --sparc
npx claude-flow@2.0.0 swarm "Build app"
```

---

Remember: All commands require the `claude-flow` prefix. When in doubt, use `claude-flow --help` or `claude-flow <command> --help` for guidance!