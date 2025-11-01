# ReasoningBank Setup for This Project

**Strategy:** Keep project memory separate from ReasoningBank universal patterns.

---

## 🎯 In-Place Review Strategy (Recommended)

**No file copying needed!** Use environment variable to switch databases.

### **Terminal 1: Project Work**
```bash
cd /path/to/this-project
# Default: uses .swarm/memory.db (project memory)
# Work normally - Claude learns YOUR decisions
```

### **Terminal 2: Code Review (SAME Directory!)**
```bash
cd /path/to/this-project
export CLAUDE_FLOW_DB_PATH=/workspaces/claude-flow/.swarm/memory.db

# Review files in-place:
# "Review src/auth.ts for SOLID violations and security issues"
# "Analyze src/api/users.ts for bugs and optimizations"

# Switch back to project memory:
unset CLAUDE_FLOW_DB_PATH
```

**Why this is better:**
- ✅ No file copying needed
- ✅ Review files in actual location
- ✅ See full project context
- ✅ Switch ReasoningBanks instantly
- ✅ No temp files to clean up

---

## 📦 What's in the ReasoningBank?

**Location:** `/workspaces/claude-flow/.swarm/memory.db`
**Model:** code-reasoning (or whichever you installed)
**Patterns:** 1,500-3,000 depending on model

**Available Models:**
- **code-reasoning** (2,600) - SOLID, algorithms, debugging ⭐ Recommended
- **problem-solving** (2,000) - Cognitive thinking patterns
- **google-research** (3,000) - ReasoningBank paper implementation
- **safla** (2,000) - Self-learning, feedback loops
- **domain-expert** (1,500) - DevOps, ML, security, APIs

---

## 🚀 Install ReasoningBank (If Not Already)

**Quick Install (code-reasoning):**
```bash
cd /workspaces/claude-flow
git clone --depth 1 --filter=blob:none --sparse https://github.com/ruvnet/claude-flow.git temp-models
cd temp-models && git sparse-checkout set docs/reasoningbank/models
cp docs/reasoningbank/models/code-reasoning/train-code.js /workspaces/claude-flow/
cd /workspaces/claude-flow && node train-code.js
sqlite3 .swarm/memory.db "SELECT COUNT(*) FROM patterns;"  # Should show: 2600
rm train-code.js && rm -rf temp-models
```

**Time:** ~30 seconds
**Result:** 2,600 programming patterns ready

**Other models:** See `/workspaces/claude-flow/docs/binto-labs/REASONINGBANK-DUAL-TERMINAL-SETUP.md`

---

## 💡 Daily Workflow Example

**Building a feature:**
```bash
# Terminal 1 (Development)
cd /path/to/this-project
# "Build user authentication with JWT"
# Claude learns: "This project uses 7-day refresh tokens in httpOnly cookies"
```

**Code review:**
```bash
# Terminal 2 (Review - SAME directory)
cd /path/to/this-project
export CLAUDE_FLOW_DB_PATH=/workspaces/claude-flow/.swarm/memory.db

# "Review src/auth/jwt.ts for security and SOLID principles"
# Claude suggests: "Add rate limiting, extract validation (SRP)"
# File stays in place - no copying!

# Done reviewing? Switch back
unset CLAUDE_FLOW_DB_PATH
```

---

## 🔄 Switching Between ReasoningBanks

**You can have multiple ReasoningBanks and switch between them:**

```bash
# Use code-reasoning (SOLID, algorithms, debugging)
export CLAUDE_FLOW_DB_PATH=/workspaces/claude-flow/.swarm/code-reasoning.db

# Use problem-solving (cognitive thinking, brainstorming)
export CLAUDE_FLOW_DB_PATH=/workspaces/claude-flow/.swarm/problem-solving.db

# Use google-research (academic, research methods)
export CLAUDE_FLOW_DB_PATH=/workspaces/claude-flow/.swarm/google-research.db

# Back to project memory
unset CLAUDE_FLOW_DB_PATH
```

**Pro tip - Add shell aliases:**
```bash
# Add to ~/.bashrc or ~/.zshrc:
alias rb-code='export CLAUDE_FLOW_DB_PATH=/workspaces/claude-flow/.swarm/code-reasoning.db'
alias rb-think='export CLAUDE_FLOW_DB_PATH=/workspaces/claude-flow/.swarm/problem-solving.db'
alias rb-off='unset CLAUDE_FLOW_DB_PATH'

# Usage:
rb-code   # Switch to code-reasoning
rb-think  # Switch to problem-solving
rb-off    # Back to project memory
```

---

## ⚠️ Important

- **DON'T** copy ReasoningBank to this project
- **DON'T** merge databases (yet - wait 3-6 months)
- **DO** let this project build its own memory
- **DO** use Terminal 2 for objective reviews

**Full Guide:** `/workspaces/claude-flow/docs/binto-labs/REASONINGBANK-DUAL-TERMINAL-SETUP.md`

---

**Setup Date:** 2025-10-31
**ReasoningBank Model:** code-reasoning (2,600 patterns)
