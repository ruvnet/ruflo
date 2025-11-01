# ReasoningBank Dual-Terminal Setup Guide

**Use this guide to set up new projects with clean memory while accessing ReasoningBank for code reviews.**

---

## 🎯 Strategy: Separate Contexts

**Terminal 1:** Your project (builds project-specific memory)
**Terminal 2:** `/workspaces/claude-flow` (uses ReasoningBank for reviews)

**Why?** Keep project learnings separate from universal code patterns. Prevents pattern contamination.

---

## 📦 What's in the ReasoningBank?

**Current Setup (if you followed the main guide):**
- **Model:** `code-reasoning`
- **Location:** `/workspaces/claude-flow/.swarm/memory.db`
- **Patterns:** 2,600 programming best practices
- **Size:** 15 MB

**Categories (500 patterns each):**
1. Design Patterns & Architecture (SOLID, microservices, clean architecture)
2. Algorithm Optimization (time/space complexity, caching, parallelization)
3. Code Quality & Refactoring (clean code, DRY, code smells)
4. Language-Specific (JavaScript/TypeScript, Python, Go, Rust, Java)
5. Debugging & Error Handling (common bugs, edge cases, logging)

---

## 🏗️ Install a ReasoningBank (If You Haven't Already)

**⚠️ Models are NOT pre-built. You must train them (30-90 seconds).**

### Quick Install: Code-Reasoning (Recommended)

```bash
cd /workspaces/claude-flow

# Download training scripts
git clone --depth 1 --filter=blob:none --sparse https://github.com/ruvnet/claude-flow.git temp-models
cd temp-models
git sparse-checkout set docs/reasoningbank/models

# Copy and run training script
cp docs/reasoningbank/models/code-reasoning/train-code.js /workspaces/claude-flow/
cd /workspaces/claude-flow
node train-code.js

# Verify
sqlite3 .swarm/memory.db "SELECT COUNT(*) FROM patterns;"
# Should show: 2600

# Cleanup
rm train-code.js
rm -rf temp-models
```

### All 5 Available Models

| Model | Patterns | Specialty | Training Time |
|-------|----------|-----------|---------------|
| **code-reasoning** ⭐ | 2,600 | Programming, SOLID, algorithms | ~30 sec |
| **problem-solving** | 2,000 | Cognitive thinking patterns | ~45 sec |
| **google-research** | 3,000 | ReasoningBank paper (arXiv:2509.25140) | ~60 sec |
| **safla** | 2,000 | Self-learning, feedback loops | ~45 sec |
| **domain-expert** | 1,500 | DevOps, ML, security, APIs | ~40 sec |

**To install a different model:**
```bash
# Replace <MODEL> with: problem-solving, google-research, safla, or domain-expert
cd /workspaces/claude-flow
git clone --depth 1 --filter=blob:none --sparse https://github.com/ruvnet/claude-flow.git temp-models
cd temp-models && git sparse-checkout set docs/reasoningbank/models
cp docs/reasoningbank/models/<MODEL>/train-*.js /workspaces/claude-flow/train-model.js
cd /workspaces/claude-flow

# Fix database path
sed -i "s|join(__dirname, 'memory.db')|'/workspaces/claude-flow/.swarm/memory.db'|g" train-model.js
sed -i "s|join(__dirname, '.swarm', 'memory.db')|'/workspaces/claude-flow/.swarm/memory.db'|g" train-model.js

# Train
node train-model.js

# Cleanup
rm train-model.js
rm -rf temp-models
```

**See:** `/workspaces/claude-flow/docs/binto-labs/guides/effective-claude-flow.md` Step 3 for detailed model descriptions.

---

## 🚀 Quick Setup for New Projects

### Step 1: Create Project Memory Structure

```bash
cd /path/to/your-project

# Create .swarm directory
mkdir -p .swarm

# Create README for future reference
cat > .swarm/README.md << 'EOF'
# Memory Strategy

## Current Setup
- **Project Memory:** `.swarm/memory.db` (learns from THIS project)
- **ReasoningBank:** `/workspaces/claude-flow/.swarm/memory.db` (2,600 universal patterns)

## Usage

### Terminal 1: Development (Use This)
```bash
cd /path/to/this-project
# Claude builds project-specific memory:
# - Your architecture decisions
# - Bugs you fixed and how
# - Project-specific patterns
```

### Terminal 2: Code Review (SAME Directory - In-Place!)
```bash
cd /path/to/this-project
export CLAUDE_FLOW_DB_PATH=/workspaces/claude-flow/.swarm/memory.db

# Claude uses ReasoningBank (2,600 patterns):
# - SOLID principles
# - Design patterns
# - Algorithm optimizations
# - Best practices (unbiased by your project decisions)

# Review files in-place (no copying needed):
# "Review src/component.tsx for SOLID violations, bugs, and optimizations"
# "Analyze src/api/auth.ts for security issues"

# Switch back to project memory:
unset CLAUDE_FLOW_DB_PATH
```

## Don't Merge (Yet)
Keep project memory clean for first 3-6 months.
After project matures, consider selective pattern import.
EOF

echo "✅ Project memory setup complete!"
```

### Step 2: Add to .gitignore

```bash
# Ignore large memory databases
cat >> .swarm/.gitignore << 'EOF'
# Memory databases (project-specific, don't commit)
*.db
*.db-shm
*.db-wal
*.backup

# Keep documentation
!README.md
EOF
```

---

## 🔄 Switching Between ReasoningBanks

**You can install multiple ReasoningBanks and switch between them using environment variables:**

### Quick Switch (Environment Variable)

```bash
# Terminal 2: Code Review with different ReasoningBanks
cd /path/to/your-project

# Use code-reasoning (programming, SOLID, algorithms)
export CLAUDE_FLOW_DB_PATH=/workspaces/claude-flow/.swarm/code-reasoning.db
# "Review src/auth.ts for SOLID violations"

# Use problem-solving (cognitive thinking, brainstorming)
export CLAUDE_FLOW_DB_PATH=/workspaces/claude-flow/.swarm/problem-solving.db
# "Help me brainstorm alternative architectures"

# Use google-research (academic research methods)
export CLAUDE_FLOW_DB_PATH=/workspaces/claude-flow/.swarm/google-research.db
# "Analyze this approach using research methodology"

# Back to project memory
unset CLAUDE_FLOW_DB_PATH
```

### Shell Aliases (Recommended)

Add to `~/.bashrc` or `~/.zshrc`:

```bash
# ReasoningBank switching aliases
export RB_DIR=/workspaces/claude-flow/.swarm
alias rb-code='export CLAUDE_FLOW_DB_PATH=$RB_DIR/code-reasoning.db'
alias rb-think='export CLAUDE_FLOW_DB_PATH=$RB_DIR/problem-solving.db'
alias rb-research='export CLAUDE_FLOW_DB_PATH=$RB_DIR/google-research.db'
alias rb-learn='export CLAUDE_FLOW_DB_PATH=$RB_DIR/safla.db'
alias rb-domain='export CLAUDE_FLOW_DB_PATH=$RB_DIR/domain-expert.db'
alias rb-off='unset CLAUDE_FLOW_DB_PATH'
```

**Usage:**
```bash
cd /path/to/your-project

rb-code      # Switch to code-reasoning
# "Review this file for bugs"

rb-think     # Switch to problem-solving
# "Help me brainstorm solutions"

rb-off       # Back to project memory
# Continue development
```

### Managing Multiple Models

**Install multiple ReasoningBanks:**
```bash
cd /workspaces/claude-flow

# Train code-reasoning
# (follow instructions from Step 3 above)
mv .swarm/memory.db .swarm/code-reasoning.db

# Train problem-solving
# (train and rename)
mv .swarm/memory.db .swarm/problem-solving.db

# Train google-research
# (train and rename)
mv .swarm/memory.db .swarm/google-research.db

# Set default symlink
ln -s code-reasoning.db .swarm/memory.db
```

**Result:**
```
/workspaces/claude-flow/.swarm/
├── code-reasoning.db (2,600 patterns)
├── problem-solving.db (2,000 patterns)
├── google-research.db (3,000 patterns)
└── memory.db → code-reasoning.db (symlink)
```

---

## 💡 Daily Workflow

### Scenario 1: Building a Feature

**Terminal 1 (Development):**
```bash
cd /path/to/your-project
# Ask Claude: "Build user authentication with JWT"
# Claude learns and remembers:
# ✅ "This project uses JWT with 7-day refresh tokens"
# ✅ "We store tokens in httpOnly cookies for security"
# ✅ "Auth routes are in /api/auth/"
```

### Scenario 2: Code Review (In-Place)

**Terminal 2 (Review - SAME directory):**
```bash
cd /path/to/your-project
export CLAUDE_FLOW_DB_PATH=/workspaces/claude-flow/.swarm/memory.db

# Ask Claude: "Review src/auth/jwt.ts for security issues and SOLID principles"
# Claude uses ReasoningBank (unbiased):
# ✅ "Consider adding rate limiting (429 responses)"
# ✅ "Extract token validation into separate class (SRP violation)"
# ✅ "Use constant-time comparison for tokens (timing attack prevention)"
```

**Why separate?**
Terminal 1 remembers YOUR decisions. Terminal 2 provides objective best practices without bias.

---

## 🔧 Advanced: Read-Only Reference (Optional)

If you want ReasoningBank **visible** in your project (but not mixed):

```bash
cd /path/to/your-project

# Create symbolic link to ReasoningBank
ln -s /workspaces/claude-flow/.swarm/memory.db \
      .swarm/reasoningbank-reference.db

# Now you have:
# .swarm/memory.db              <- Project memory (Claude writes here)
# .swarm/reasoningbank-reference.db <- Read-only reference (symlink)
```

**Note:** SQLite doesn't enforce read-only, so use the dual-terminal approach to keep them truly separate.

---

## 📊 When to Merge ReasoningBank

**After 3-6 months**, when your project patterns are stable:

```bash
# Backup first!
cp .swarm/memory.db .swarm/memory.db.backup-before-merge

# Option A: Copy entire ReasoningBank
cp /workspaces/claude-flow/.swarm/memory.db .swarm/memory.db

# Option B: Selective merge (advanced, requires SQLite knowledge)
# TODO: Create merge script for selective pattern import
```

---

## 🎯 Quick Reference

| Context | Terminal | Memory Used | Purpose |
|---------|----------|-------------|---------|
| **Development** | Project directory | `.swarm/memory.db` | Learns YOUR decisions |
| **Code Review** | `/workspaces/claude-flow` | ReasoningBank | Universal best practices |
| **Architecture Review** | `/workspaces/claude-flow` | ReasoningBank | Design patterns, SOLID |
| **Optimization Review** | `/workspaces/claude-flow` | ReasoningBank | Algorithm improvements |

---

## ❓ FAQ

**Q: Why not just copy ReasoningBank to every project?**
A: Project-specific learnings are more valuable than generic patterns. Let Claude learn your architecture, your bug patterns, your edge cases first.

**Q: Can I use both memories at once?**
A: Technically yes (merge databases), but it's better to keep them separate. Use dual terminals for clean separation.

**Q: What if I want ReasoningBank patterns NOW?**
A: Use Terminal 2 (code review terminal). Copy your file to /tmp and ask for review.

**Q: Will my project memory eventually have code patterns?**
A: Yes! As you code, Claude learns patterns specific to YOUR project. These are often more valuable than generic patterns.

**Q: What's in domain-expert ReasoningBank?**
A: 1,500 domain-specific patterns (the only pre-built model). We trained code-reasoning instead (2,600 programming patterns).

---

## 🚀 One-Liner Setup

```bash
cd /path/to/your-project && mkdir -p .swarm && echo "# Memory Strategy: Use dual terminals (dev + review). See /workspaces/claude-flow/docs/binto-labs/REASONINGBANK-DUAL-TERMINAL-SETUP.md" > .swarm/README.md && echo "*.db" > .swarm/.gitignore && echo "✅ Setup complete!"
```

---

**Created:** 2025-10-31
**ReasoningBank Version:** code-reasoning (2,600 patterns)
**Strategy:** Dual-terminal separation of concerns
