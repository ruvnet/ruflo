# Gemini Flow v2.0.0 - Correct Command Usage Guide

## ✅ CORRECT COMMAND USAGE

All commands must be prefixed with `gemini-flow`:

### 🧠 Swarm Commands
```bash
# CORRECT:
gemini-flow swarm "Build a REST API with authentication"
gemini-flow swarm "Research cloud patterns" --strategy research
gemini-flow swarm "Optimize performance" --max-agents 3 --parallel

# INCORRECT:
swarm "Build a REST API"  # ❌ Won't work
```

### 🐙 GitHub Commands
```bash
# CORRECT:
gemini-flow github pr-manager "create feature PR with tests"
gemini-flow github gh-coordinator "setup CI/CD pipeline"
gemini-flow github release-manager "prepare v2.0.0 release"

# INCORRECT:
github pr-manager "create PR"  # ❌ Won't work
```

### 🤖 Agent Commands
```bash
# CORRECT:
gemini-flow agent spawn researcher --name "DataBot"
gemini-flow agent list --verbose
gemini-flow agent terminate agent-123

# INCORRECT:
agent spawn researcher  # ❌ Won't work
spawn researcher  # ❌ Won't work
```

### 💾 Memory Commands
```bash
# CORRECT:
gemini-flow memory store architecture "microservices pattern"
gemini-flow memory get architecture
gemini-flow memory query "API design"

# INCORRECT:
memory store key value  # ❌ Won't work
```

### 🚀 SPARC Commands
```bash
# CORRECT:
gemini-flow sparc "design authentication system"
gemini-flow sparc architect "design microservices"
gemini-flow sparc tdd "user registration feature"

# INCORRECT:
sparc architect "design"  # ❌ Won't work
```

### 📋 Other Commands
```bash
# CORRECT:
gemini-flow init --sparc
gemini-flow start --ui --swarm
gemini-flow status --verbose
gemini-flow task create research "Market analysis"
gemini-flow config set terminal.poolSize 15
gemini-flow mcp status
gemini-flow monitor --watch
gemini-flow batch create-config my-batch.json

# INCORRECT:
init --sparc  # ❌ Won't work
start --ui  # ❌ Won't work
status  # ❌ Won't work
```

## 🔍 GET HELP

### Main Help
```bash
gemini-flow --help
gemini-flow help
gemini-flow  # (no arguments also shows help)
```

### Command-Specific Help
```bash
gemini-flow swarm --help
gemini-flow github --help
gemini-flow agent --help
gemini-flow memory --help
gemini-flow sparc --help
gemini-flow init --help
gemini-flow help swarm
gemini-flow help github
# ... etc for any command
```

## 🚀 QUICK START

```bash
# 1. Initialize with SPARC
npx gemini-flow@2.0.0 init --sparc

# 2. Start orchestration
gemini-flow start --ui --swarm

# 3. Deploy a swarm
gemini-flow swarm "Build REST API" --strategy development --parallel

# 4. Use GitHub automation
gemini-flow github pr-manager "coordinate release"

# 5. Check status
gemini-flow status --verbose
```

## 📝 IMPORTANT NOTES

1. **Always prefix with `gemini-flow`** - The commands won't work without it
2. **Use quotes for objectives** - Especially with spaces: `"Build REST API"`
3. **Check help for options** - Each command has specific options
4. **Use --help liberally** - Detailed help is available for every command

## 🎯 INSTALLATION

### Global Installation (Recommended)
```bash
npm install -g gemini-flow@2.0.0
gemini-flow init --sparc
```

### Local Installation
```bash
npm install gemini-flow@2.0.0
npx gemini-flow init --sparc
```

### Direct NPX Usage
```bash
npx gemini-flow@2.0.0 init --sparc
npx gemini-flow@2.0.0 swarm "Build app"
```

---

Remember: All commands require the `gemini-flow` prefix. When in doubt, use `gemini-flow --help` or `gemini-flow <command> --help` for guidance!