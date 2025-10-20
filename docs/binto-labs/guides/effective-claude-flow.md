# Effective Claude-Flow

> **The opinionated guide to getting maximum value from claude-flow with minimum friction.**

**Last Updated:** 2025-10-17 | **Version:** claude-flow v2.7.0-alpha.10

---

## 🎯 What This Guide Is

This is your **fast-track to claude-flow mastery**. Instead of exploring every option, we give you the proven patterns that work. Think "Effective Java" but for AI-powered development workflows.

**Philosophy:** Do the right thing by default. Dive deeper only when you need to.

---

## 💬 Two Ways to Use Claude-Flow

### Option 1: Natural Language Prompts (Recommended for Claude Max users)

If you have **Claude Max** (claude.ai subscription), you can use natural language prompts directly in Claude Code without needing an API key:

**Example prompts:**
```
"Use claude-flow to spawn a SPARC swarm with development strategy and quality
threshold 0.95 to build user authentication with JWT tokens"

"Initialize a hive-mind swarm with mesh topology and 8 agents to build
3 microservices: auth, payments, and notifications"

"Run claude-flow in research mode to analyze GraphQL federation patterns"
```

**Why this works:** Claude Code (when used with Claude Max) has built-in access to execute `npx` commands and coordinate swarms automatically based on your natural language description.

---

### Option 2: Direct CLI Commands

All examples in this guide show exact `npx` commands you can copy-paste. You can also run these directly in your terminal.

**When to use CLI directly:**
- You prefer explicit control
- Building automation scripts
- CI/CD integration
- You're using Claude API (not Claude Max)

---

## 📚 Discovering All Options

Before diving in, here's how to explore all available options:

```bash
# View all available SPARC modes
npx claude-flow@alpha sparc modes
# Shows: code, tdd, architect, debug, docs, review, refactor, integration,
#        devops, security, optimize, ask (13 modes)

# View all swarm options
npx claude-flow@alpha swarm --help
# Shows: strategies (research, development, testing, optimization, maintenance)
#        modes (centralized, distributed, hierarchical, mesh, hybrid)
#        all available flags and options

# View all hive-mind options
npx claude-flow@alpha hive-mind --help
# Shows: subcommands (init, spawn, status, wizard, etc.)
#        queen types, consensus algorithms, worker limits

# General help
npx claude-flow@alpha --help
# Shows: all top-level commands and quick start guide
```

**Pro tip:** Use `--help` on any command to see its specific options and examples.

---

## 🚀 Essential Setup (Do This First!)

### Step 1: Install Claude-Flow

```bash
# Install globally
npm install -g @ruvnet/claude-flow@alpha

# Or use npx (no installation needed)
npx claude-flow@alpha --version
```

**Verify:**
```bash
npx claude-flow@alpha --version
# Should show: v2.7.0-alpha.10 or newer
```

---

### Step 2: Initialize Your Project

```bash
# Navigate to your project
cd /path/to/your/project

# Initialize claude-flow (creates .claude-flow/ directory)
npx claude-flow@alpha init --force

# Initialize ReasoningBank for self-learning memory
npx claude-flow@alpha memory init --reasoningbank
```

**What this creates:**
- `.claude-flow/` - Configuration and state
- `.swarm/` - Memory database and swarm coordination
- `.swarm/memory.db` - SQLite database for persistent patterns

---

### Step 3: Load Pre-Trained Intelligence (Highly Recommended!)

**Why:** Start with 11,000+ proven patterns instead of learning from scratch. This is like hiring an expert team on day one.

```bash
# Download full-stack expert model (backend + frontend + devops + testing + security)
curl -o full-stack-expert.json https://raw.githubusercontent.com/ruvnet/claude-flow/main/docs/reasoningbank/models/full-stack-complete.json

# Import into your ReasoningBank
npx claude-flow@alpha memory import full-stack-expert.json --reasoningbank
```

**Verify:**
```bash
npx claude-flow@alpha memory status --reasoningbank
# Should show: Total memories: 11,000+, Average confidence: 85%
```

**Alternative models** (choose based on your stack):
```bash
# Backend only (Node.js, Python, APIs, databases)
curl -o backend.json https://raw.githubusercontent.com/ruvnet/claude-flow/main/docs/reasoningbank/models/backend-expert.json
npx claude-flow@alpha memory import backend.json --reasoningbank

# Frontend only (React, Vue, state management, UX)
curl -o frontend.json https://raw.githubusercontent.com/ruvnet/claude-flow/main/docs/reasoningbank/models/frontend-expert.json
npx claude-flow@alpha memory import frontend.json --reasoningbank
```

---

### Step 4: API Key Setup (Optional for Claude Max users)

**If you have Claude Max:** You can skip this step! Claude Code (via claude.ai) provides API access automatically when you use natural language prompts.

**If using CLI directly or Claude API:** You'll need an API key:

```bash
# Add to your shell profile (~/.bashrc, ~/.zshrc, etc.)
export CLAUDE_API_KEY="your-api-key-here"

# Or create .env file in your project
echo "CLAUDE_API_KEY=your-api-key-here" > .env
```

**Get your API key:** https://console.anthropic.com/

> **Note:** The API key powers the AI agents that generate code, analyze requirements, and coordinate work. If using Claude Max with natural language prompts in Claude Code, the key is handled automatically.

---

✅ **Setup Complete!** You're ready to use the essential patterns below.

---

## 🎯 Skills System Overview

**New in v2.7.0:** Skills replace slash commands with automatic, context-aware activation.

### What Are Skills?

Skills are modular instruction sets that Claude discovers and activates automatically based on your task description. Instead of memorizing `/commands`, just describe what you want in natural language.

**Example:**
```
# Old way (still works, but deprecated):
/sparc tdd "user authentication"

# New way (automatic):
"Build user authentication with tests"
# → SPARC methodology skill activates automatically
```

**Why Skills Are Better:**
- **40% less context pollution** - Only loads relevant skills
- **Natural language activation** - No commands to memorize
- **Automatic discovery** - Claude picks the right skill
- **Composable** - Skills can use other skills internally

### Essential Skills You'll Use Daily

**Development:**
- `sparc-methodology` - Systematic feature building with TDD
- `pair-programming` - Driver/navigator collaborative coding

**Memory & Intelligence:**
- `agentdb-vector-search` - Semantic code search (find similar patterns)
- `reasoningbank-agentdb` - Self-learning memory (150x faster than legacy)

**GitHub Integration:**
- `github-code-review` - AI-powered PR reviews
- `github-workflow-automation` - CI/CD pipeline generation

**Coordination:**
- `swarm-orchestration` - Multi-agent parallel execution
- `hive-mind-advanced` - Queen-led hierarchical coordination

**See all 25 skills:** [docs/skills-tutorial.md](../../skills-tutorial.md) (upstream complete catalog)

### How Skills Activate

Skills have metadata (name, description, tags) that Claude scans at startup. When you describe a task, Claude matches your intent to relevant skills and loads them on-demand.

**Example Activations:**
```
"Find similar authentication code" → agentdb-vector-search
"Review this PR for security" → github-code-review
"Build checkout with TDD" → sparc-methodology
"Spawn 5 agents to refactor services" → swarm-orchestration
```

### Skills vs Patterns (When to Use Each)

**Use Skills directly when:**
- Task requires specialized knowledge (SPARC, GitHub, AgentDB)
- You need automatic tool selection and coordination
- Building complex features with multiple phases

**Use Patterns (from this guide) when:**
- Simple task that doesn't need specialized skills
- Coordinating multiple skills together
- Building custom workflows combining skills + swarms

**Example Combining Both:**
```bash
# Pattern 1 (New Feature) + SPARC Skill + ReasoningBank Skill
npx claude-flow@alpha swarm "Build user authentication with JWT" \
  --sparc \
  --reasoningbank-enabled
# → Activates SPARC + ReasoningBank skills automatically
```

### Installing Skills

```bash
# Initialize skills in your project
npx claude-flow@alpha init --force

# What this creates:
# .claude/skills/         ← All 25 skills installed here
# .claude-flow/          ← Configuration
# .swarm/                ← Memory database

# Verify installation
ls -la .claude/skills/
# Should show 25 skill directories
```

**After installation:** Skills activate automatically - no configuration needed.

### Learn More

- **Complete Skills Catalog:** [docs/skills-tutorial.md](../../skills-tutorial.md) - Full upstream documentation
- **Build Custom Skills:** Use the `skill-builder` skill to create your own
- **Skills Quick Start:** [guides/skills-quickstart.md](./skills-quickstart.md) - Essential skills with examples

---

## 📋 The Essential Patterns

### Pattern 1: New Feature Development → SPARC + ReasoningBank

**When to use:** Building new features, components, or any functionality from requirements.

**Why SPARC:** SPARC (Specification → Pseudocode → Architecture → Refinement → Completion) enforces validation gates at each phase, ensuring quality and catching issues early. Combined with ReasoningBank, it learns from every build and gets smarter over time.

**Just use it:**
```bash
npx claude-flow@alpha swarm "Build user authentication with JWT tokens and password reset" \
  --sparc \
  --strategy development \
  --quality-threshold 0.90 \
  --reasoningbank-enabled
```

**What happens:**
1. **Specification Phase:** Analyzes requirements, retrieves relevant patterns from ReasoningBank
2. **Pseudocode Phase:** Designs algorithms, learns new algorithmic patterns
3. **Architecture Phase:** Plans system structure, validates against best practices
4. **Refinement Phase:** Implements with TDD, writes tests first
5. **Completion Phase:** Integrates and verifies quality

**Quality gates ensure:**
- ✅ Requirements completeness (threshold: 0.90)
- ✅ Architecture validation (threshold: 0.90)
- ✅ Test coverage ≥ 90%
- ✅ Code quality score ≥ 0.90

**Learn more:** [SPARC Methodology Deep Dive](../../reference/SPARC.md)

---

### Pattern 2: Research & Technology Exploration → Research Strategy

**When to use:** Evaluating new libraries, exploring architectural options, learning unfamiliar technologies.

**Why research strategy:** Optimized for information gathering with minimal code generation. Creates comprehensive analysis reports you can review.

**Just use it:**
```bash
npx claude-flow@alpha swarm "Research best practices for GraphQL federation with microservices" \
  --strategy research \
  --agents researcher,analyst \
  --reasoningbank-enabled
```

**What you get:**
- Technology comparison matrix
- Best practices analysis
- Code examples and patterns
- Decision recommendations
- Stored in ReasoningBank for future reference

**Customize:**
```bash
# Focus on specific aspects
--agents researcher,security-analyst  # Security-focused research

# Store findings in specific namespace
--memory-namespace graphql-research
```

---

### Pattern 3: Bug Fixes → Maintenance Strategy + ReasoningBank

**When to use:** Fixing bugs, especially recurring issues or production incidents.

**Why this works:** ReasoningBank learns from each bug fix. First time: analyzes and solves. Second time: applies learned solution automatically. By the 5th similar bug, it's nearly instant.

**Just use it:**
```bash
npx claude-flow@alpha swarm "Fix CSRF token missing error in checkout flow" \
  --strategy maintenance \
  --reasoningbank-enabled
```

**Self-learning in action:**
- **First bug:** Investigates, fixes, stores solution (confidence: 50%)
- **Second similar bug:** Recognizes pattern, applies learned fix (confidence: 68%, 47% faster)
- **Fifth similar bug:** Expert-level application (confidence: 85%, 65% faster)

**Real impact:** After 10 bugs, similar issues are fixed 60-70% faster with higher reliability.

**Learn more:** [Self-Learning Bug Fix Workflow](../examples/reasoningbank-quickstart-examples.md#example-2-self-learning-bug-fix-workflow)

---

### Pattern 4: Code Refactoring → Refinement Mode

**When to use:** Improving code quality, modernizing legacy code, restructuring architecture.

**Why refinement mode:** Focuses on improving existing code while maintaining functionality. Emphasizes testing to prevent regressions.

**Just use it:**
```bash
npx claude-flow@alpha swarm "Refactor user service to use dependency injection and improve testability" \
  --strategy refactoring \
  --quality-threshold 0.92 \
  --reasoningbank-enabled
```

**Safety features:**
- ✅ Creates comprehensive test suite before refactoring
- ✅ Validates behavior preservation
- ✅ Maintains backward compatibility
- ✅ Stores refactoring patterns for future use

**Customize:**
```bash
# Focus on specific aspects
--agents coder,tester,reviewer  # Extra review for safety

# Set stricter quality threshold
--quality-threshold 0.95  # Production-critical code
```

---

### Pattern 5: Parallel Independent Work → Hive-Mind Swarms

**When to use:** 3+ independent tasks, microservices development, multi-repository operations, large-scale refactoring.

**Why hive-mind:** Coordinates 5-20 agents working in parallel with O(log n) scaling. Perfect when tasks don't depend on each other sequentially.

**Just use it:**
```bash
# Initialize hive-mind with mesh topology (peer-to-peer coordination)
npx claude-flow hive-mind init --topology mesh --agents 8

# Orchestrate parallel work
npx claude-flow hive-mind task "Build 3 microservices: auth-service, payment-service, notification-service. Each with REST API, database schema, and tests."
```

**Performance:**
- 2.8-4.4x faster than sequential execution
- Sweet spot: 5-20 agents (O(log n) communication overhead)
- Best for: Independent tasks with minimal shared state

**When NOT to use hive-mind:**
- ❌ Sequential workflows (use SPARC instead)
- ❌ Single complex task (use standard swarm)
- ❌ Tasks requiring validation gates (use SPARC)

**Learn more:** [Hive-Mind Complete Reference](./HIVE-MIND-REFERENCE.md)

---

### Pattern 6: Code Review & Quality Assurance → Review Swarm

**When to use:** Pull request reviews, pre-merge quality checks, security audits.

**Why review swarm:** Multi-agent review catches more issues than single-pass analysis. Combines code quality, security, performance, and best practices checks.

**Just use it:**
```bash
npx claude-flow@alpha swarm "Review PR #42: Add user notification system" \
  --strategy review \
  --agents reviewer,security-analyst,performance-analyst
```

**What gets checked:**
- ✅ Code quality and maintainability
- ✅ Security vulnerabilities (OWASP Top 10)
- ✅ Performance bottlenecks
- ✅ Test coverage adequacy
- ✅ Best practices compliance

**Output:** Detailed review with severity levels (critical, high, medium, low) and actionable recommendations.

---

### Pattern 7: Test Data & Mock Generation → Data Strategy

**When to use:** Creating test fixtures, generating mock APIs, synthetic dataset creation, load testing data.

**Why specialized strategy:** Optimized for data generation with realistic distributions, edge cases, and validation.

**Just use it:**
```bash
npx claude-flow@alpha swarm "Generate 1000 realistic user records with addresses, orders, and payment methods for testing" \
  --strategy testing \
  --agents data-generator,validator
```

**Features:**
- Realistic data distributions (names, addresses, dates)
- Edge cases automatically included (null values, boundary conditions)
- Validation rules enforced
- Export to JSON, CSV, SQL formats

**Customize:**
```bash
# Specify data schema
npx claude-flow@alpha swarm "Generate e-commerce test data: 500 users, 2000 products, 5000 orders with realistic pricing and inventory" \
  --strategy testing \
  --output-format json
```

---

### Pattern 8: CI/CD & DevOps Automation → Workflow Automation

**When to use:** Setting up CI/CD pipelines, deployment automation, infrastructure as code.

**Why workflow automation:** Pre-configured agents for GitHub Actions, Docker, Kubernetes, and cloud platforms. Follows security best practices by default.

**Just use it:**
```bash
npx claude-flow@alpha swarm "Create GitHub Actions workflow for: build, test, lint, security scan, deploy to staging on PR" \
  --strategy devops \
  --agents cicd-engineer,security-analyst
```

**What you get:**
- `.github/workflows/*.yml` files
- Multi-stage builds with caching
- Security scanning integrated
- Deployment strategies (blue-green, canary)
- Rollback procedures

**Common scenarios:**
```bash
# Docker containerization
npx claude-flow@alpha swarm "Dockerize Node.js app with multi-stage build and health checks" --strategy devops

# Kubernetes deployment
npx claude-flow@alpha swarm "Create K8s manifests: deployment, service, ingress, configmap for microservices app" --strategy devops
```

---

### Pattern 9: Multi-Repository Operations → Multi-Repo Coordination

**When to use:** Monorepo management, cross-repo refactoring, dependency updates across repos, organization-wide changes.

**Why multi-repo tools:** Coordinates changes across repositories while maintaining consistency and handling dependencies.

**Just use it:**
```bash
npx claude-flow@alpha swarm "Update all repos to use Node.js 20 LTS and update package.json engines field" \
  --strategy maintenance \
  --multi-repo \
  --repos "org/backend-api,org/frontend-web,org/mobile-app"
```

**Features:**
- Dependency graph analysis
- Sequential or parallel execution based on dependencies
- Atomic commits across repos
- Rollback support

---

### Pattern 10: Performance Optimization → Optimization Strategy

**When to use:** App is slow, high resource usage, need to meet performance SLAs.

**Why optimization strategy:** Profiles first, then optimizes based on data. Prevents premature optimization.

**Just use it:**
```bash
npx claude-flow@alpha swarm "Optimize API response time (currently 800ms, target: <200ms)" \
  --strategy optimization \
  --agents performance-analyst,optimizer
```

**Process:**
1. **Profile:** Identifies bottlenecks (database queries, N+1 problems, etc.)
2. **Analyze:** Calculates impact of each optimization
3. **Optimize:** Implements highest-impact changes first
4. **Verify:** Measures performance improvement

**Common optimizations applied:**
- Database query optimization and indexing
- Caching strategies (Redis, in-memory)
- Code-level improvements (algorithmic complexity)
- Parallelization opportunities

---

## 🧠 Understanding ReasoningBank

ReasoningBank is a **self-improving brain** for AI agents. Unlike basic key-value memory, it uses semantic search (understands meaning, not keywords), Bayesian confidence learning (gets smarter with each use), and pattern linking (builds knowledge graphs). Based on Google DeepMind's SAFLA algorithm, it transforms agents from stateless to persistently intelligent. Start with pre-trained models (11,000+ patterns), let SPARC use it automatically, and watch your system learn from every task—no training required.

**Learn more:**
- **[ReasoningBank Overview](../technical-reference/reasoning-bank-overview.md)** - Complete explanation of how it works
- **[ReasoningBank Article](../technical-reference/reasoning-bank-fungible.md)** - Deep dive by the author
- **[ReasoningBank Quick Start](../examples/reasoningbank-quickstart-examples.md)** - 5 practical examples

**Technical references:**
- **[ReasoningBank Integration](../technical-reference/REASONINGBANK-INTEGRATION.md)** - Neural network & WASM architecture
- **[Architecture Details](../../integrations/reasoningbank/REASONINGBANK_ARCHITECTURE.md)** - System diagrams & data flow

---

## 🎓 Next Steps: Learn More

### Feature Deep Dives (Layer 2)
- **[SPARC Methodology](../../reference/SPARC.md)** - Complete SPARC workflow documentation (upstream)
- **[Hive-Mind Reference](./HIVE-MIND-REFERENCE.md)** - 112+ agent types, 4 topologies, complete CLI reference (upstream)

### More Usage Patterns
- **[Claude-Flow User Guide (2025-10-14)](./claude-flow-user-guide-2025-10-14.md)** - Comprehensive SDLC examples and GitHub workflows

### Technical References (Layer 3)
- **[ReasoningBank Article](../technical-reference/reasoning-bank-fungible.md)** - Deep dive into self-learning memory architecture
- **[Integration Guides](../../integrations/)** - Detailed integration documentation (upstream)
- **[API Reference](../../reference/)** - Complete API documentation (upstream)

---

## 💡 Pro Tips

### Combine Patterns for Maximum Power

**Pattern Composition Example:**
```bash
# 1. Research phase (understand the domain)
npx claude-flow@alpha swarm "Research authentication best practices for fintech apps" \
  --strategy research --reasoningbank-enabled

# 2. Development phase (build with learned patterns)
npx claude-flow@alpha swarm "Build secure authentication system for fintech app" \
  --sparc --strategy development --reasoningbank-enabled

# 3. Review phase (quality assurance)
npx claude-flow@alpha swarm "Review authentication implementation for security and performance" \
  --strategy review --agents security-analyst,performance-analyst
```

**Result:** Research findings inform development, ReasoningBank learns from both phases, review validates everything.

---

### Start with High Quality Thresholds

**Default:** `--quality-threshold 0.85` (good for experimentation)
**Production:** `--quality-threshold 0.90` (recommended minimum)
**Critical systems:** `--quality-threshold 0.95` (financial, healthcare, security)

Higher thresholds mean:
- More validation checks
- Stricter code quality requirements
- Better test coverage
- More thorough reviews

**Trade-off:** Higher quality = more time, but prevents costly bugs.

---

### Use Memory Namespaces for Organization

```bash
# Organize by project
--memory-namespace my-ecommerce-app

# Organize by domain
--memory-namespace backend.authentication
--memory-namespace frontend.checkout

# Organize by team
--memory-namespace platform-team
```

**Why:** Keeps patterns organized, prevents cross-contamination, enables team-specific knowledge bases.

---

### Export and Share Learned Patterns

```bash
# Export your team's learned patterns
npx claude-flow@alpha memory export team-patterns.json --namespace my-project

# Share with team (commit to repo)
git add team-patterns.json
git commit -m "docs: Add learned patterns from authentication work"

# Team members import
npx claude-flow@alpha memory import team-patterns.json --reasoningbank
```

**Result:** Team intelligence accumulates and spreads automatically.

---

## 🆘 Troubleshooting

### "Command not found: claude-flow"
```bash
# Solution 1: Use npx (no installation needed)
npx claude-flow@alpha --version

# Solution 2: Install globally
npm install -g @ruvnet/claude-flow@alpha
```

---

### "ReasoningBank not initialized"
```bash
# Check status
npx claude-flow@alpha memory status --reasoningbank

# Re-initialize if needed
npx claude-flow@alpha memory init --reasoningbank --force
```

---

### "Quality threshold not met"
**Symptom:** Swarm exits with "Quality score 0.87, threshold 0.90"

**Solution:**
```bash
# Option 1: Lower threshold temporarily (for experimentation)
--quality-threshold 0.85

# Option 2: Increase agent count for more thorough work
--agents researcher,coder,tester,reviewer

# Option 3: Let ReasoningBank learn more patterns first
# Run the task a few times, each iteration improves quality
```

---

### "Swarm appears stuck"
```bash
# Check swarm status
npx claude-flow@alpha swarm ps

# View swarm logs
npx claude-flow@alpha swarm status <swarm-id>

# Kill stuck swarm if needed
npx claude-flow@alpha swarm stop <swarm-id>
```

---

## 📊 Success Metrics

**How to know you're using claude-flow effectively:**

✅ **Speed:** Features ship 2-3x faster than manual development
✅ **Quality:** Code reviews find fewer issues (85%+ pass rate)
✅ **Learning:** ReasoningBank confidence scores trend upward (avg >80%)
✅ **Reuse:** Similar tasks complete faster each time (30-50% reduction)
✅ **Coverage:** Test coverage consistently ≥ 90%

**Track your progress:**
```bash
# View ReasoningBank learning metrics
npx claude-flow@alpha memory stats

# View swarm performance history
npx claude-flow@alpha performance-report --timeframe 30d
```

---

## 🤝 Contributing

Found a better pattern? **Share it!**

This is a community-driven guide. Submit improvements via:
- **Issues:** https://github.com/binto-labs/claude-flow/issues
- **PRs:** https://github.com/binto-labs/claude-flow/pulls

**Upstream:** https://github.com/ruvnet/claude-flow

---

**Remember:** The best pattern is the one that works for your team. These are starting points—customize and evolve them based on your experience.

**Happy building!** 🚀
