# ReasoningBank Setup for This Project

**Strategy:** Keep project memory separate from ReasoningBank universal patterns.

---

## 🎯 Two-Terminal Approach

### **Terminal 1: Project Work (This Terminal)**
```bash
cd /path/to/this-project
# Claude builds project-specific memory in .swarm/memory.db
# Learns YOUR architecture decisions, bug patterns, edge cases
```

### **Terminal 2: Code Review (Separate Terminal)**
```bash
cd /workspaces/claude-flow
# Claude uses ReasoningBank (2,600+ universal patterns)
# Provides objective best practices without project bias

# Copy file for review:
cp /path/to/this-project/src/component.tsx /tmp/review.tsx

# Ask: "Review /tmp/review.tsx for SOLID violations, bugs, optimizations"
```

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
# Terminal 1 (Project)
cd /path/to/this-project
# "Build user authentication with JWT"
# Claude learns: "This project uses 7-day refresh tokens in httpOnly cookies"
```

**Code review:**
```bash
# Terminal 2 (Review)
cd /workspaces/claude-flow
cp /path/to/this-project/src/auth/jwt.ts /tmp/review.ts
# "Review /tmp/review.ts for security and SOLID principles"
# Claude suggests: "Add rate limiting, extract validation (SRP)"
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
