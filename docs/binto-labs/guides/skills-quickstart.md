
> **Essential Claude Flow skills that activate automatically with natural language**

**Last Updated:** 2025-10-20 | **Version:** claude-flow v2.7.0-alpha.14

---

## What This Is

A practical guide to the **10 most essential skills** in Claude Flow. These activate automatically when you describe tasks in natural language - no commands to memorize.

**Philosophy:** Just talk normally. Claude picks the right skills.

---

## 🚀 Prerequisites

```bash
# Install skills in your project
npx claude-flow@alpha init --force

# Initialize memory (optional but recommended)
npx claude-flow@alpha memory init --reasoningbank

# Load expert patterns (optional but powerful)
curl -o full-stack-expert.json https://raw.githubusercontent.com/ruvnet/claude-flow/main/docs/reasoningbank/models/full-stack-complete.json
npx claude-flow@alpha memory import full-stack-expert.json --reasoningbank
```

**Verify:**
```bash
ls -la .claude/skills/  # Should show 25 skill directories
```

---

## 📚 Complete Skills Catalog

Claude Flow includes **25 specialized skills**. This guide covers the 10 most essential. For the complete catalog with all 25 skills, see:

👉 **[Complete Skills Tutorial](../../skills-tutorial.md)** (upstream documentation)

---

## The Essential 10 Skills

### 1. `sparc-methodology` - Build Features Systematically

**What it does:** Five-phase development (Specification → Pseudocode → Architecture → Refinement → Completion) with validation gates at each step.

**When to use:** Building new features, complex refactors, anything requiring planning before coding.

**Natural language activation:**
```
"Build user authentication with JWT tokens using TDD"
"Create checkout flow with SPARC methodology"
"Refactor payment service using systematic approach"
```

**What happens:**
1. **Specification** - Analyzes requirements
2. **Pseudocode** - Designs algorithms
3. **Architecture** - Plans system structure
4. **Refinement** - Implements with TDD
5. **Completion** - Integrates and validates

**Natural Language (Recommended):**
```
"Build shopping cart feature using SPARC with TDD"
"Design architecture for user authentication"
"Specify and pseudocode the payment flow"
```

**Legacy CLI (still works):**
```bash
# Full SPARC workflow
npx claude-flow sparc tdd "shopping cart feature"

# Individual phases
npx claude-flow sparc run spec-pseudocode "task description"
npx claude-flow sparc run architect "task description"

# List all SPARC modes
npx claude-flow sparc modes
```

**Quality gates:**
- ✅ Requirements completeness (0.90 threshold)
- ✅ Architecture validation
- ✅ Test coverage ≥ 90%
- ✅ Code quality score ≥ 0.90

**Learn more:** [../../reference/SPARC.md](../../reference/SPARC.md)

---

### 2. `agentdb-vector-search` - Semantic Code Search

**What it does:** Find similar code patterns using semantic search (understands meaning, not just keywords).

**When to use:** Finding similar implementations, code reuse, learning from existing patterns, duplicate detection.

**Natural language activation:**
```
"Find similar authentication code in this project"
"Search for database connection patterns"
"Show me code that handles file uploads"
"Find duplicate implementations of user validation"
```

**What you get:**
- Semantic similarity ranking (not keyword matching)
- Context-aware results (understands what code does)
- Fast retrieval (<100µs for most queries)
- Works across languages (TypeScript, Python, Go, etc.)

**Example workflow:**
```bash
# The skill activates automatically when you say:
"Find similar code to this authentication function"

# Claude will:
# 1. Activate agentdb-vector-search skill
# 2. Vectorize the target function
# 3. Search memory for similar patterns
# 4. Return ranked results with explanations
```

**Technical details:**
- Uses HNSW indexing for fast search
- 150x faster than legacy ChromaDB
- Supports hybrid search (vector + metadata filtering)

---

### 3. `reasoningbank-agentdb` - Self-Learning Memory

**What it does:** Learns from every task execution, building persistent intelligence that improves over time. Based on Google DeepMind's SAFLA algorithm.

**When to use:** Always! Enable with `--reasoningbank-enabled` flag. Especially valuable for recurring tasks and bug fixes.

**Natural language activation:**
```bash
# Just add the flag to any swarm command:
npx claude-flow@alpha swarm "task description" --reasoningbank-enabled

# Or use in natural language:
"Build authentication with learning enabled"
"Fix this bug and remember the solution"
```

**Self-learning in action:**
- **First time:** Analyzes, solves, stores solution (confidence: 50%)
- **Second time:** Recognizes pattern, applies learned fix (confidence: 68%, 47% faster)
- **Fifth time:** Expert-level application (confidence: 85%, 65% faster)

**Real metrics from production:**
- 150x faster pattern retrieval vs legacy ReasoningBank
- 32.3% token reduction through learned patterns
- 60-70% faster resolution of similar bugs after 10 iterations

**Example - Bug Fix Learning:**
```bash
# First CSRF bug fix
npx claude-flow@alpha swarm "Fix CSRF token missing in checkout" \
  --strategy maintenance --reasoningbank-enabled
# → Investigates, fixes, stores solution

# Second CSRF bug (different location)
npx claude-flow@alpha swarm "Fix CSRF error in user profile update" \
  --strategy maintenance --reasoningbank-enabled
# → Recognizes pattern, applies learned solution 47% faster

# Fifth CSRF bug
# → Nearly instant application of expert-level solution
```

**Architecture:**
- **Trajectory tracking** - Records decision paths
- **Verdict judgment** - Validates solution quality
- **Memory distillation** - Compresses patterns to essentials
- **Pattern recognition** - Identifies similar scenarios

**Learn more:** [../technical-reference/reasoning-bank-overview.md](../technical-reference/reasoning-bank-overview.md)

---

### 4. `swarm-orchestration` - Multi-Agent Coordination

**What it does:** Coordinates 2-10 agents working in parallel on different aspects of a task.

**When to use:** Complex features requiring multiple specialties (backend + frontend + tests + docs), parallel independent work.

**Natural language activation:**
```
"Spawn 4 agents to build: API endpoints, React UI, tests, and docs"
"Use mesh topology to refactor 3 microservices in parallel"
"Coordinate agents to build full-stack authentication"
```

**Topologies:**
- **Mesh** (default) - Peer-to-peer, best for 3-8 agents
- **Hierarchical** - Coordinator + workers, scales to 20+ agents
- **Ring** - Sequential processing with feedback loops
- **Star** - Centralized coordination, good for standardization

**CLI usage:**
```bash
# Initialize swarm with topology
npx claude-flow@alpha swarm "task description" \
  --topology mesh \
  --agents 5

# Or let it auto-select topology
npx claude-flow@alpha swarm "build 3 microservices" \
  --strategy development
```

**Performance:**
- 2.8-4.4x faster than sequential execution
- Sweet spot: 3-8 agents (mesh), 5-20 agents (hierarchical)
- Automatic load balancing across agents

**Example:**
```bash
npx claude-flow@alpha swarm \
  "Build e-commerce checkout: payment API, React UI, Stripe integration, tests" \
  --topology mesh \
  --agents 4 \
  --reasoningbank-enabled

# What happens:
# Agent 1: Payment API (Express endpoints)
# Agent 2: React checkout UI
# Agent 3: Stripe integration
# Agent 4: Integration tests
# All work in parallel, coordinate via shared memory
```

---

### 5. `github-code-review` - AI-Powered PR Reviews

**What it does:** Comprehensive multi-agent code review checking quality, security, performance, and best practices.

**When to use:** Pull request reviews, pre-merge checks, security audits, code quality gates.

**Natural language activation:**
```
"Review PR #42 for security issues"
"Check this pull request for performance bottlenecks"
"Comprehensive review of authentication changes"
```

**What gets checked:**
- ✅ Code quality and maintainability (SOLID, DRY, readability)
- ✅ Security vulnerabilities (OWASP Top 10, input validation)
- ✅ Performance bottlenecks (N+1 queries, memory leaks)
- ✅ Test coverage adequacy (≥80% recommended)
- ✅ Best practices compliance (language-specific idioms)

**Output format:**
- Severity levels: **Critical**, **High**, **Medium**, **Low**
- Actionable recommendations with code examples
- Line-specific comments for GitHub
- Summary report with metrics

**Example:**
```bash
# Natural language (skill activates automatically):
"Review PR #42: Add user notification system"

# Or CLI:
npx claude-flow@alpha swarm "Review PR #42" \
  --strategy review \
  --agents reviewer,security-analyst,performance-analyst
```

**Review agents:**
- `reviewer` - Code quality and maintainability
- `security-analyst` - Security vulnerabilities
- `performance-analyst` - Performance issues
- `tester` - Test coverage and quality

---

### 6. `hive-mind-advanced` - Queen-Led Coordination

**What it does:** Hierarchical swarm with a "queen" coordinator managing 5-20 worker agents in parallel.

**When to use:** 3+ independent tasks, large-scale refactoring, microservices development, when standard swarms aren't enough.

**Natural language activation:**
```
"Initialize hive-mind to build 3 microservices: auth, payments, notifications"
"Use queen-led coordination to refactor 5 legacy services"
```

**Architecture:**
- **Queen** - Orchestrates work, resolves conflicts, maintains state
- **Workers** - Execute tasks independently
- **Consensus** - Byzantine, Raft, or gossip protocols
- **Memory** - Persistent coordination via ReasoningBank

**CLI usage:**
```bash
# Initialize hive-mind
npx claude-flow hive-mind init --topology mesh --agents 8

# Orchestrate task
npx claude-flow hive-mind task \
  "Build 3 microservices: auth-service, payment-service, notification-service"

# Check status
npx claude-flow hive-mind status

# Resume session
npx claude-flow hive-mind resume <session-id>
```

**Performance:**
- 2.8-4.4x faster than sequential (same as standard swarm)
- O(log n) communication overhead (scales better than mesh)
- Sweet spot: 5-20 agents
- Best for: Independent tasks with minimal shared state

**When NOT to use:**
- ❌ Sequential workflows (use SPARC instead)
- ❌ Single complex task (use standard swarm)
- ❌ Tasks requiring validation gates (use SPARC)

**Learn more:** [./HIVE-MIND-REFERENCE.md](./HIVE-MIND-REFERENCE.md)

---

### 7. `github-workflow-automation` - CI/CD Pipeline Generation

**What it does:** Creates GitHub Actions workflows for build, test, lint, security scanning, and deployment.

**When to use:** Setting up CI/CD, automating releases, deployment pipelines, infrastructure as code.

**Natural language activation:**
```
"Create GitHub Actions workflow for: build, test, lint, security scan, deploy to staging"
"Setup CI/CD pipeline with Docker build and K8s deployment"
"Automate releases with version bumping and changelog generation"
```

**What you get:**
- `.github/workflows/*.yml` files
- Multi-stage builds with caching
- Security scanning (Snyk, npm audit, etc.)
- Deployment strategies (blue-green, canary, rolling)
- Rollback procedures

**Example:**
```bash
# Natural language:
"Setup CI/CD for Node.js app with Docker deployment"

# CLI:
npx claude-flow@alpha swarm \
  "Create GitHub Actions: build, test, deploy to staging on PR" \
  --strategy devops \
  --agents cicd-engineer,security-analyst
```

**Common patterns:**
```bash
# Docker containerization
"Dockerize Node.js app with multi-stage build"

# Kubernetes deployment
"Create K8s manifests: deployment, service, ingress"

# Automated releases
"Setup release workflow with semantic versioning"
```

---

### 8. `pair-programming` - Driver/Navigator Mode

**What it does:** Interactive pair programming with role switching, real-time verification, and quality monitoring.

**When to use:** Learning new tech, debugging complex issues, TDD sessions, code reviews while coding.

**Natural language activation:**
```
"Let's pair program on this React component - you drive first"
"Switch to navigator mode and guide me through testing"
"Debug this authentication flow together"
```

**Modes:**
- **Driver** - Claude writes code while you observe and guide
- **Navigator** - Claude guides while you write code
- **Switch** - Automatic role switching based on task phase

**Features:**
- Real-time code verification
- Quality monitoring (test coverage, complexity)
- Continuous code review
- Security scanning (OWASP checks)
- Performance optimization suggestions

**Example session:**
```bash
# Start pair programming
"Let's build user authentication together - you drive, I'll navigate"

# Claude activates pair-programming skill and:
# 1. Enters driver mode
# 2. Writes authentication code
# 3. Explains decisions as it codes
# 4. Asks for feedback at decision points
# 5. Switches to navigator mode when you want to code
```

**Truth-score verification:**
- Tracks accuracy of suggestions (0-1 score)
- Automatic rollback if quality drops below 0.95
- Learns from corrections to improve

---

### 9. `agentdb-optimization` - Performance Tuning

**What it does:** Optimizes vector search and memory performance through quantization, HNSW indexing, and caching.

**When to use:** Large codebases (>10k files), slow pattern retrieval, memory constraints, production deployment.

**Natural language activation:**
```
"Optimize vector search performance for large codebase"
"Enable quantization to reduce memory usage"
"Setup HNSW indexing for faster pattern matching"
```

**Optimization techniques:**

**1. Quantization (4-32x memory reduction):**
```bash
# Binary quantization: 32x compression, ~2-5% accuracy loss
npx claude-flow@alpha memory optimize --quantize binary

# Scalar quantization: 4x compression, ~1-2% accuracy loss
npx claude-flow@alpha memory optimize --quantize scalar
```

**2. HNSW Indexing (150x faster search):**
```bash
# Enable HNSW for sub-100µs searches
npx claude-flow@alpha memory optimize --index hnsw
```

**3. Caching:**
```bash
# Enable in-memory caching
npx claude-flow@alpha memory optimize --cache enable
```

**Performance gains:**
- **Binary quantization:** 3GB → 96MB (32x reduction)
- **Scalar quantization:** 3GB → 768MB (4x reduction)
- **HNSW indexing:** 15ms → <100µs (150x faster)
- **Batch operations:** 1s → 2ms for 100 vectors (500x faster)

**Trade-offs:**
- Binary quantization: Highest compression, ~2-5% accuracy loss
- Scalar quantization: Balanced, ~1-2% accuracy loss
- HNSW indexing: Fast search, larger index size

---

### 10. `verification-quality` - Truth Scoring & Rollback

**What it does:** Continuous quality verification with automatic rollback when accuracy drops below threshold (default: 0.95).

**When to use:** Production-critical code, financial/healthcare systems, high-reliability requirements, preventing regressions.

**Natural language activation:**
```
"Build this with verification and auto-rollback enabled"
"Use quality gates with 0.98 threshold"
"Ensure high reliability with truth scoring"
```

**How it works:**
1. **Truth scoring** - Validates each operation (0-1 accuracy)
2. **Threshold checking** - Compares score to threshold (default: 0.95)
3. **Automatic rollback** - Reverts changes if quality drops
4. **Learning** - Improves from failures via ReasoningBank

**Example:**
```bash
# Enable verification
npx claude-flow@alpha swarm "refactor payment service" \
  --quality-threshold 0.95 \
  --reasoningbank-enabled

# What happens:
# ✅ Each refactor step is verified (truth score: 0.97) → Proceed
# ✅ Test coverage checked (96%) → Proceed
# ✅ Security scan passed → Proceed
# ❌ Performance regression detected (truth score: 0.89) → Auto-rollback
# → System reverts to last known good state
# → Logs failure pattern to ReasoningBank for learning
```

**Quality checks:**
- ✅ Code quality metrics
- ✅ Test coverage percentage
- ✅ Security vulnerabilities
- ✅ Performance benchmarks
- ✅ Behavioral correctness

**Thresholds:**
```bash
# Development: 0.85 (good for experimentation)
--quality-threshold 0.85

# Production: 0.90 (recommended minimum)
--quality-threshold 0.90

# Critical: 0.95 (financial, healthcare, security)
--quality-threshold 0.95
```

---

## 🎯 Skill Combinations (Real Workflows)

### Workflow 1: Feature Development with Learning

**Goal:** Build new feature systematically while building permanent intelligence.

```bash
npx claude-flow@alpha swarm "Build user notification system with email and SMS" \
  --sparc \
  --strategy development \
  --reasoningbank-enabled \
  --quality-threshold 0.90
```

**Skills activated:**
1. `sparc-methodology` - Five-phase systematic development
2. `reasoningbank-agentdb` - Learn patterns for future use
3. `verification-quality` - Quality gates at each phase

**Result:** Feature built with 90%+ test coverage, patterns stored for reuse.

---

### Workflow 2: Intelligent Bug Fix

**Goal:** Fix bug and remember solution for similar issues.

```bash
npx claude-flow@alpha swarm "Fix CSRF token missing error in checkout flow" \
  --strategy maintenance \
  --reasoningbank-enabled
```

**Skills activated:**
1. `agentdb-vector-search` - Find similar past fixes
2. `reasoningbank-agentdb` - Apply learned patterns or learn new
3. `verification-quality` - Ensure fix doesn't introduce regressions

**Result:** Bug fixed, solution stored. Next similar bug: 47% faster fix.

---

### Workflow 3: Large-Scale Refactor

**Goal:** Refactor multiple services in parallel safely.

```bash
npx claude-flow hive-mind init --topology mesh --agents 8

npx claude-flow hive-mind task \
  "Refactor 3 microservices to use TypeScript: auth-service, payment-service, notification-service"
```

**Skills activated:**
1. `hive-mind-advanced` - Queen-led parallel coordination
2. `verification-quality` - Test each refactor before proceeding
3. `reasoningbank-agentdb` - Learn refactoring patterns

**Result:** 3 services refactored in parallel, 2.8-4.4x faster than sequential.

---

### Workflow 4: Code Review with Security Focus

**Goal:** Comprehensive PR review emphasizing security.

```bash
"Review PR #42 for security vulnerabilities and OWASP compliance"
```

**Skills activated:**
1. `github-code-review` - Multi-agent review coordination
2. `verification-quality` - Validate review completeness

**Result:** Detailed review with severity levels, actionable fixes.

---

### Workflow 5: Performance Optimization

**Goal:** Speed up slow API with data-driven optimization.

```bash
npx claude-flow@alpha swarm \
  "Optimize API response time (currently 800ms, target <200ms)" \
  --strategy optimization \
  --agents performance-analyst,optimizer
```

**Skills activated:**
1. `performance-analysis` - Identify bottlenecks first
2. `agentdb-vector-search` - Find similar optimization patterns
3. `reasoningbank-agentdb` - Apply learned optimizations

**Result:** Data-driven optimizations applied, performance tracked.

---

## 💡 Pro Tips

### Tip 1: Skills Activate Automatically

**Don't overthink invocation.** Just describe what you want:

```bash
# ❌ Don't do this:
"Use the agentdb-vector-search skill to find authentication patterns"

# ✅ Do this:
"Find similar authentication code"
# → Skill activates automatically
```

---

### Tip 2: Combine Skills + Flags

**Most powerful pattern:** Natural skill activation + CLI flags for control:

```bash
npx claude-flow@alpha swarm "build user dashboard" \
  --sparc \                    # Activates SPARC skill
  --reasoningbank-enabled \    # Activates ReasoningBank skill
  --quality-threshold 0.92     # Configures verification skill
```

---

### Tip 3: Always Enable ReasoningBank

**Add `--reasoningbank-enabled` to every swarm command** for continuous learning:

```bash
# Development
npx claude-flow@alpha swarm "task" --sparc --reasoningbank-enabled

# Bug fixes
