# ReasoningBank Setup for Serve Project

**Strategy:** Keep project memory separate from ReasoningBank universal patterns.

---

## 🎯 Self-Contained Setup (Recommended)

**ReasoningBank is installed in `.reasoningbank/` directory** - persists across codespace restarts!

```
/workspaces/serve/
  .swarm/
    memory.db              ← 512KB - Project memory (learns YOUR decisions)
  .reasoningbank/
    .swarm/
      memory.db            ← 2.6MB - Universal patterns (2,600 code-reasoning patterns)
    train-code.js          ← 64KB - Training script (rebuilds in 30 seconds)
    init-schema.js         ← 3KB - Schema initialization
    package.json           ← 1KB - Dependencies (better-sqlite3)
```

---

## ✅ Installation Status

**Check if installed:**
```bash
ls -lh .reasoningbank/.swarm/memory.db
# Should show: 2.6MB

# Verify pattern count
sqlite3 .reasoningbank/.swarm/memory.db "SELECT COUNT(*) FROM patterns;"
# Should show: 2600
```

**If file exists (2.6MB) and pattern count is 2600**: ✅ Already installed, skip to [Usage](#usage)

**If not found**: Follow [First-Time Setup](#first-time-setup) below

---

## 🚀 First-Time Setup

**Only needed once** (or after codespace rebuild):

```bash
cd /workspaces/serve/.reasoningbank
npm install                # Installs better-sqlite3 (~10 seconds)
node init-schema.js        # Creates database schema (~1 second)
node train-code.js         # Trains 2,600 patterns (~20 seconds)
```

### What Each Step Does:

**1. `npm install`** - Installs dependencies:
```json
{
  "dependencies": {
    "better-sqlite3": "^9.2.2"
  }
}
```

**2. `node init-schema.js`** - Creates SQLite schema:
- `patterns` table (stores 2,600 programming patterns)
- `pattern_links` table (428 connections between patterns)
- `metadata` table (versioning, timestamps)
- Indexes for fast queries (<5ms lookup)

**3. `node train-code.js`** - Inserts patterns:

**Output:**
```
✅ Database schema initialized
🧠 Code Reasoning ReasoningBank Training
📊 Target: 2500 patterns
...
🎉 Training Complete!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Total Patterns: 2600
🔗 Total Links: 428
💾 Database Size: 2.55 MB
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Total Time**: ~30 seconds (npm install: 10s, init: 1s, training: 20s)
**Result**: 2,600 programming patterns ready

### Quick Setup (One-Liner)

```bash
cd .reasoningbank && npm install && node init-schema.js && node train-code.js
```

---

## 💡 Usage

### Two-Terminal Workflow

**Terminal 1: Normal Development** (uses project memory)
```bash
cd /workspaces/serve
# Work normally
# "Implement Phase 1 CSV upload feature"
# Claude learns YOUR project decisions
```

**Terminal 2: Code Review** (uses ReasoningBank)
```bash
cd /workspaces/serve
export CLAUDE_FLOW_DB_PATH=/workspaces/serve/.reasoningbank/.swarm/memory.db

# Review with universal patterns
# "Review web/src/components/FileUploader.tsx for SOLID violations"
# "Analyze api/src/services/csv_parser.py for bugs"
# "Check docs/phase1-architecture.md for design flaws"

# Done reviewing? Switch back
unset CLAUDE_FLOW_DB_PATH
```

### Shell Aliases (Recommended)

Add to `~/.bashrc` or `~/.zshrc`:

```bash
# ReasoningBank shortcuts
alias rb-on='export CLAUDE_FLOW_DB_PATH=/workspaces/serve/.reasoningbank/.swarm/memory.db && echo "✅ ReasoningBank active"'
alias rb-off='unset CLAUDE_FLOW_DB_PATH && echo "✅ Back to project memory"'
alias rb-check='env | grep CLAUDE_FLOW_DB_PATH || echo "❌ ReasoningBank not active"'

# Usage:
rb-on    # Switch to ReasoningBank
rb-off   # Back to project memory
rb-check # Check current state
```

---

## 📦 What's in the ReasoningBank?

**Location:** `/workspaces/serve/.reasoningbank/.swarm/memory.db`
**Model:** code-reasoning
**Patterns:** 2,600 universal programming patterns

**Pattern Categories:**
- **Design Patterns & Architecture** (500) - SOLID, DRY, microservices, etc.
- **Algorithm Optimization** (500) - Big O, caching, parallelization
- **Code Quality & Refactoring** (500) - Clean code, maintainability
- **Language-Specific Best Practices** (500) - Python, JavaScript, TypeScript, etc.
- **Debugging & Error Handling** (500) - Common bugs, anti-patterns

---

## 🔄 Daily Workflow Example

### Building a Feature (Terminal 1)

```bash
cd /workspaces/serve
# "Build CSV upload with progress tracking"
# Claude learns: "This project uses XHR for progress, stores in /tmp/uploads"
# Project memory updated with YOUR decisions
```

### Code Review (Terminal 2 - Same Directory!)

```bash
cd /workspaces/serve
rb-on

# "Review web/src/components/FileUploader.tsx for SOLID violations"

# Claude identifies issues using 2,600 universal patterns:
# - SRP violation: validation logic should be extracted
# - Magic numbers: 100MB limit hardcoded
# - Missing error boundaries
# - Accessibility issues

rb-off
```

---

## 🎯 Use Cases

### 1. Objective Code Review
```bash
rb-on
# "Review api/src/services/quality_checker.py for bugs and optimizations"
# Unbiased review using universal patterns
rb-off
```

### 2. Architecture Validation
```bash
rb-on
# "Analyze docs/phase1-architecture.md for design flaws"
# Checks against 500 architecture patterns
rb-off
```

### 3. SOLID Principles Check
```bash
rb-on
# "Check web/src/components/*.tsx for SOLID violations"
# Identifies SRP, OCP, LSP, ISP, DIP issues
rb-off
```

### 4. Bug Detection
```bash
rb-on
# "Find potential bugs in api/src/services/csv_parser.py"
# Uses 500 debugging patterns
rb-off
```

### 5. Performance Analysis
```bash
rb-on
# "Review api/src/services/data_recognizer.py for performance issues"
# Checks algorithm complexity, suggests optimizations
rb-off
```

---

## 🔧 Maintenance

### Verify Installation

```bash
sqlite3 .reasoningbank/.swarm/memory.db "SELECT COUNT(*) FROM patterns;"
# Should show: 2600
```

### Rebuild (if database corrupted)

```bash
cd .reasoningbank
rm .swarm/memory.db
node init-schema.js
node train-code.js
```

### Check Pattern Distribution

```bash
sqlite3 .reasoningbank/.swarm/memory.db "
SELECT type, COUNT(*) as count
FROM patterns
GROUP BY type
ORDER BY count DESC;
"
```

---

## ⚠️ Important Rules

### DO:
- ✅ Use for objective code reviews
- ✅ Let project memory learn YOUR decisions
- ✅ Keep databases separate
- ✅ Commit `train-code.js` to git (rebuilds in 30 seconds)

### DON'T:
- ❌ Commit `.swarm/memory.db` files (2.6MB binary)
- ❌ Merge ReasoningBank with project memory
- ❌ Use ReasoningBank for normal development
- ❌ Expect ReasoningBank to learn your project

---

## 📊 Git Configuration

**What's Committed:**
```
.reasoningbank/
  train-code.js              ✅ Committed (64KB, rebuilds database)
  init-schema.js             ✅ Committed (schema definition)
  package.json               ✅ Committed (dependencies)
  README.md                  ✅ Committed (documentation)
  _scripts/                  ✅ Committed (utility scripts)
  .swarm/memory.db           ❌ NOT committed (2.6MB, regeneratable)
```

**.gitignore:**
```
# ReasoningBank databases (regeneratable)
.reasoningbank/.swarm/*.db
.reasoningbank/node_modules/
.reasoningbank/package-lock.json
```

---

## 🚀 Advanced: Other Models

Want different reasoning patterns? Install additional models:

### Problem-Solving (2,000 patterns)
```bash
cd .reasoningbank
# Get train script from claude-flow repo
# docs/reasoningbank/models/problem-solving/train-problem.js
node train-problem.js
# Creates .swarm/problem-solving.db

# Use it:
export CLAUDE_FLOW_DB_PATH=/workspaces/serve/.reasoningbank/.swarm/problem-solving.db
```

### Domain-Expert (1,500 patterns)
- DevOps, ML, security, API design patterns

### Google-Research (3,000 patterns)
- Academic research methods, ReasoningBank paper implementation

### SAFLA (2,000 patterns)
- Self-learning, feedback loops, meta-cognitive patterns

**See:** `.reasoningbank/_scripts/README.md` for management tools

---

## 🐛 Troubleshooting

### "Database not found" after codespace restart

**Cause**: Database file lost (shouldn't happen with new setup)

**Solution**: Rebuild in 30 seconds
```bash
cd .reasoningbank
npm install
node init-schema.js
node train-code.js
```

### "Module not found: better-sqlite3"

**Solution**: Install dependencies
```bash
cd .reasoningbank
npm install
```

### Tests failing after using ReasoningBank

**Cause**: Environment variable still set

**Solution**: Clear the variable
```bash
unset CLAUDE_FLOW_DB_PATH
rb-check  # Verify it's off
```

---

## 📈 Performance

**Training Time**: ~30 seconds
**Database Size**: 2.6 MB
**Query Performance**: <5ms per pattern lookup
**Pattern Links**: 428 connections
**Confidence Scores**: Avg 0.75-0.95

**Storage Efficiency**: ~1KB per pattern

---

## 🎓 How It Works

### Project Memory (Normal Work)
```
You: "Build CSV upload with FastAPI"
Claude: Uses .swarm/memory.db
→ Learns: "serve uses FastAPI, stores in /tmp/uploads"
→ Future tasks adapt to YOUR project decisions
```

### ReasoningBank (Code Review)
```bash
rb-on
You: "Review FileUploader.tsx for SOLID violations"
Claude: Uses .reasoningbank/.swarm/memory.db (2,600 patterns)
→ Checks: SRP, OCP, LSP, ISP, DIP
→ Identifies: Magic numbers, validation coupling, missing error boundaries
→ Objective review, no project bias
rb-off
```

---

## 📚 Additional Resources

- **Detailed Guide**: `.reasoningbank/README.md`
- **Utility Scripts**: `.reasoningbank/_scripts/README.md`
- **Training Models**: https://github.com/ruvnet/claude-flow

---

**Setup Date**: 2025-11-01
**Model Installed**: code-reasoning (2,600 patterns)
**Database Location**: `.reasoningbank/.swarm/memory.db`
**Status**: ✅ Ready for use

---

## Quick Reference Card

```bash
# Install (first time only)
cd .reasoningbank && npm install && node init-schema.js && node train-code.js

# Use for code review
rb-on    # or: export CLAUDE_FLOW_DB_PATH=...
# Ask Claude to review code
rb-off   # or: unset CLAUDE_FLOW_DB_PATH

# Verify
sqlite3 .reasoningbank/.swarm/memory.db "SELECT COUNT(*) FROM patterns;"  # → 2600

# Rebuild (if needed)
cd .reasoningbank && rm .swarm/memory.db && node init-schema.js && node train-code.js
```

---

**Remember:** ReasoningBank = objective code review with 2,600 universal patterns 🧠
