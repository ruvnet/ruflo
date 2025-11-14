# 🌊 Claude-Flow Complete Guide for AI & Humans
**Version**: 2.7.0-alpha.10
**Last Updated**: 2025-11-13
**Audience**: Claude Code AI assistants and human developers

---

## 📖 Table of Contents

1. [Quick Start](#quick-start)
2. [The Core Architecture](#the-core-architecture)
3. [Command Decision Tree](#command-decision-tree)
4. [Workflow Patterns](#workflow-patterns)
5. [Template-Based Execution](#template-based-execution)
6. [Command Reference](#command-reference)
7. [Real-World Examples](#real-world-examples)
8. [Troubleshooting](#troubleshooting)

---

## 🚀 Quick Start

### For AI Assistants (Claude Code)

**Your Role**: Help users create task templates, then execute via `--claude` flag.

**The Pattern**:
1. User describes what they want to build
2. You populate a task template (see [Template-Based Execution](#template-based-execution))
3. You generate the appropriate claude-flow command
4. User executes: `npx claude-flow [command] --claude`
5. New Claude Code instance opens with context
6. You spawn agents via Task tool with hooks integration

**Key Knowledge Sources**:
- This guide (strategic decisions)
- `npx claude-flow [command] --help` (syntax authority)
- `.claude/commands/` (feature details)
- `.claude/skills/` (skill capabilities)

### For Humans

**Prerequisites**:
```bash
# 1. Install Claude Code globally
npm install -g @anthropic-ai/claude-code

# 2. Install claude-flow
npm install -g claude-flow@alpha

# 3. Initialize in your project
cd your-project
npx claude-flow@alpha init --force
```

**First Task**:
```bash
# Simple task execution
npx claude-flow swarm "Build a TODO list component" --claude

# Complex project with persistence
npx claude-flow hive-mind spawn "Build authentication system" --claude
```

---

## 🏗️ The Core Architecture

### The Three-Layer System

**Layer 1: MCP Coordination Infrastructure**
- Creates swarm metadata
- Configures automatic hooks in `.claude/settings.json` (via `npx claude-flow init`)
- Manages shared memory via `.swarm/memory.db`
- Provides topology configuration

**Layer 2: Claude Code Task Tool (Execution)**
- Spawns actual working agents
- Agents have access to all tools (Read, Write, Edit, Bash)
- Real code generation and modification

**Layer 3: Hooks Integration (Two Systems)**
- **Automatic hooks**: Single Claude instance has hooks in `.claude/settings.json` that trigger automatically
- **Manual hooks**: Swarm agents must manually call hooks via Bash for cross-agent coordination
- Agents don't inherit parent's hook configuration, so prompt instructs manual calls
- Available commands: `npx claude-flow hooks <pre-task|post-task|pre-edit|post-edit>`

### How It Actually Works

```
User runs: npx claude-flow swarm "task" --claude
         ↓
Claude-Flow sets up:
  ✅ Swarm infrastructure (topology, memory, hooks system)
  ✅ Opens Claude Code CLI with full context
         ↓
Claude Code (you) spawns agents:
  Task("Backend Dev", "Build API routes. Execute hooks via Bash:
    - npx claude-flow hooks pre-task --description 'build API'
    - [do work]
    - npx claude-flow hooks post-task --task-id 'api-routes'", "backend-dev")
  Task("Tester", "Write tests. Use hooks for coordination.", "tester")
         ↓
Agents execute and coordinate via hooks:
  ✅ Agents call hooks via Bash (memory updates, metrics)
  ✅ Shared state via memory system
  ✅ Performance tracking and pattern learning
```

---

## 🎯 Command Decision Tree

### When to Use What?

```
┌─────────────────────────────────────┐
│    What do you need to build?      │
└──────────────┬──────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
┌───▼────┐          ┌─────▼─────┐
│ Simple │          │  Complex  │
│  Task  │          │  Project  │
└───┬────┘          └─────┬─────┘
    │                     │
    ▼                     ▼
┌────────────┐      ┌──────────────┐
│ Use SWARM  │      │ Use HIVE-MIND│
└────────────┘      └──────────────┘
```

### Detailed Decision Matrix

| Criteria | Use `swarm` | Use `hive-mind` |
|----------|-------------|-----------------|
| **Task Duration** | Single session | Multi-day project |
| **Memory Needs** | Task-scoped | Project-wide persistence |
| **Team Size** | 1-5 agents | 5-15 agents |
| **Coordination** | Simple/parallel | Queen-led hierarchical |
| **Session Resume** | No | Yes (persistent sessions) |
| **Examples** | "Fix bug", "Add feature" | "Build microservices", "Research architecture" |

### Command Selection Flowchart

```
START
  │
  ├─ Need to continue previous work?
  │    YES → hive-mind resume <session-id>
  │    NO  → Continue
  │
  ├─ Complex multi-phase project?
  │    YES → hive-mind spawn --claude
  │    NO  → Continue
  │
  ├─ Just need quick analysis?
  │    YES → swarm "task" --analysis
  │    NO  → Continue
  │
  └─ Single feature/bugfix?
       YES → swarm "task" --claude
```

---

## 📋 Workflow Patterns

### Pattern 1: Single Feature Development

**Use Case**: Adding authentication to existing app

```bash
# Step 1: Initialize once
npx claude-flow init --force

# Step 2: Execute with template
npx claude-flow swarm "$(cat docs/prompts/auth-feature.md)" \
  --strategy development \
  --mode hierarchical \
  --max-agents 6 \
  --claude

# Step 3: Claude Code opens, spawns agents, builds feature
# (All automatic via --claude flag)
```

**Memory**: Task-scoped, cleared after completion

### Pattern 2: Multi-Feature Project

**Use Case**: Building complete application from scratch

```bash
# Step 1: Project initialization
npx claude-flow init --force --project-name "my-app"

# Step 2: Feature 1 - Authentication
npx claude-flow hive-mind spawn "$(cat docs/prompts/auth.md)" \
  --namespace auth \
  --claude

# Step 3: Feature 2 - User Management (reuses hive memory)
npx claude-flow hive-mind spawn "$(cat docs/prompts/users.md)" \
  --namespace users \
  --continue-session \
  --claude

# Step 4: Check learned knowledge
npx claude-flow memory query "auth patterns" --namespace auth
```

**Memory**: Project-wide SQLite, persistent across features

### Pattern 3: Research & Analysis

**Use Case**: Exploring architecture patterns before implementation

```bash
# Step 1: Start research session
npx claude-flow hive-mind spawn "Research microservices patterns" \
  --agents researcher,analyst \
  --strategy research \
  --claude

# Step 2: Check findings
npx claude-flow memory query "microservices" --reasoningbank

# Step 3: Use findings in implementation
npx claude-flow swarm "Implement microservices" \
  --continue-session \
  --claude
```

**Memory**: Research stored in ReasoningBank, queryable later

### Pattern 4: Bug Investigation & Fix

**Use Case**: Complex bug requiring analysis

```bash
# Step 1: Analyze with auto-agent selection
npx claude-flow auto agent \
  --task "Debug performance regression in user service" \
  --strategy minimal \
  --claude

# Step 2: Auto-spawns appropriate agents
# (Likely: analyst, tester, coder)

# Step 3: Fix is implemented with tests
```

**Memory**: Bug investigation recorded, similar issues avoided

---

## 📝 Template-Based Execution

### Why Templates?

**Benefits**:
- ✅ Consistent structure (never forget requirements)
- ✅ Reusable (save templates for similar tasks)
- ✅ Shareable (team uses same templates)
- ✅ AI-readable (Claude knows exactly what you want)
- ✅ Version-controlled (templates in git)

### Template Structure

**File**: `docs/prompts/feature-name.md`

```markdown
# Task: [Feature Name]

## What to Build
[Clear, concise description of the deliverable]

## Requirements
- Specific requirement 1
- Specific requirement 2
- Specific requirement 3

## Technical Details
- **Stack**: [Technologies to use]
- **Methodology**: SPARC + London School TDD
- **Quality**: 90%+ test coverage, rubric ≥85%
- **Constraints**: [Integration points, APIs to use]

## Swarm Configuration
- **Strategy**: [development/research/testing/optimization]
- **Agents needed**: [Number and types]
  - X [agent-type]: [specific role]
  - X [agent-type]: [specific role]
- **Coordination**: [hierarchical/mesh/ring/star]

## Success Criteria
- [ ] Criterion 1 with measurable outcome
- [ ] Criterion 2 with measurable outcome
- [ ] All tests pass with 90%+ coverage
- [ ] Code quality meets rubric (≥85%)
```

### Template to Command Mapping

**AI Assistant Logic**:

```javascript
// Parse template
const template = parseMarkdown("docs/prompts/task.md");

// Determine command
const command = template.isComplexProject || template.needsPersistence
  ? 'hive-mind spawn'
  : 'swarm';

// Build flags
const flags = [
  `--strategy ${template.strategy}`,
  `--mode ${template.coordination}`,
  `--max-agents ${template.agentCount}`,
  '--parallel',  // Always for performance
  '--claude'     // Always for our workflow
];

// Optional flags
if (template.namespace) flags.push(`--namespace ${template.namespace}`);
if (template.continueSession) flags.push('--continue-session');

// Generate command
return `npx claude-flow ${command} "$(cat ${template.path})" ${flags.join(' ')}`;
```

**Example Output**:

```bash
npx claude-flow swarm "$(cat docs/prompts/auth-feature.md)" \
  --strategy development \
  --mode hierarchical \
  --max-agents 6 \
  --parallel \
  --claude
```

### Template Examples

**Quick Feature Template** (`simple-flow-task.md`):
```markdown
# Task: Add Password Reset

## What to Build
Password reset flow with email verification

## Requirements
- Email with reset link (1-hour expiry)
- Secure token generation
- Password strength validation

## Technical Details
- **Stack**: Express + Nodemailer + JWT
- **Quality**: 90% coverage
- **Constraints**: Use existing email service

## Swarm Configuration
- **Strategy**: development
- **Agents needed**: 3 agents (1 backend, 1 test, 1 security)
- **Coordination**: mesh

## Success Criteria
- [ ] Email sent with valid token
- [ ] Token expires after 1 hour
- [ ] Password meets strength requirements
- [ ] 90%+ test coverage
```

**Complex Project Template** (`claude-flow-swarm-task.md`):
```markdown
# Swarm Task Template

Following the claude-flow orchestration guide:

1. Review the objective: [OBJECTIVE]
2. Set up swarm coordination with appropriate topology
3. Spawn parallel agents using Claude Code's Task tool
4. Use MCP tools for coordination infrastructure
5. Execute with hooks for memory sharing and coordination

## Objective:
Build complete e-commerce platform with:
- User authentication & authorization
- Product catalog with search
- Shopping cart & checkout
- Order management
- Admin dashboard

## Constraints:
- Must use existing PostgreSQL database
- Integrate with Stripe for payments
- Support 1000+ concurrent users
- Mobile-responsive design

## Success Criteria:
- All user flows working end-to-end
- 90%+ test coverage
- Load tested for 1000 concurrent users
- Security audit passed
```

---

## 🔧 Command Reference

### Core Commands

#### `swarm` - Quick Task Execution

**Syntax**:
```bash
npx claude-flow swarm <objective> [options]
```

**Options**:
- `--strategy <type>`: research | development | analysis | testing | optimization
- `--mode <type>`: centralized | distributed | hierarchical | mesh | hybrid
- `--max-agents <n>`: Maximum agents (default: 5, max: 100)
- `--parallel`: Enable parallel execution (2.8-4.4x faster)
- `--claude`: Open Claude Code CLI (REQUIRED for our workflow)
- `--monitor`: Real-time swarm monitoring
- `--background`: Run in background with progress tracking
- `--analysis`: Read-only mode (no code changes)

**When to Use**:
- ✅ Single feature implementation
- ✅ Bug fixes
- ✅ Quick prototypes
- ✅ Analysis tasks
- ❌ Multi-day projects (use hive-mind)
- ❌ Needs session resumption (use hive-mind)

**Examples**:
```bash
# Basic feature
npx claude-flow swarm "Add user profile page" --claude

# With template
npx claude-flow swarm "$(cat docs/prompts/feature.md)" \
  --strategy development --parallel --claude

# Analysis only
npx claude-flow swarm "Analyze API performance" \
  --strategy analysis --analysis
```

---

#### `hive-mind spawn` - Complex Project Execution

**Syntax**:
```bash
npx claude-flow hive-mind spawn <objective> [options]
```

**Options**:
- `--claude`: Open Claude Code CLI (REQUIRED)
- `--namespace <name>`: Organize memory by feature/domain
- `--agents <types>`: Comma-separated agent types
- `--continue-session`: Resume from previous hive
- `--queen-type <type>`: strategic | tactical | adaptive
- `--max-workers <n>`: Maximum worker agents

**When to Use**:
- ✅ Multi-day projects
- ✅ Needs persistent memory
- ✅ Complex coordination requirements
- ✅ Session resumption needed
- ✅ Multiple related features
- ❌ Simple one-off tasks (use swarm)

**Examples**:
```bash
# Start complex project
npx claude-flow hive-mind spawn "Build microservices architecture" --claude

# Continue previous session
npx claude-flow hive-mind spawn "Add auth service" \
  --namespace auth \
  --continue-session \
  --claude

# Specific agents
npx claude-flow hive-mind spawn "Research patterns" \
  --agents researcher,analyst,architect \
  --claude
```

---

#### `memory` - Persistent Memory Management

**Syntax**:
```bash
npx claude-flow memory <action> [key] [value] [options]
```

**Actions**:
- `store <key> <value>`: Store memory
- `query <pattern>`: Search memories
- `list`: List all memories
- `export <file>`: Export to JSON/YAML
- `import <file>`: Import from file
- `clear`: Clear namespace
- `vector-search <query>`: Semantic search (AgentDB)
- `store-vector <key> <value>`: Store with embedding

**Options**:
- `--namespace <name>`: Memory namespace (default: default)
- `--ttl <seconds>`: Time to live
- `--reasoningbank`: Use ReasoningBank (legacy)
- `--k <number>`: Results to return (vector search)
- `--threshold <float>`: Similarity threshold (0-1)

**Examples**:
```bash
# Store decision
npx claude-flow memory store api_pattern "REST with pagination" \
  --namespace backend

# Query memories
npx claude-flow memory query "authentication" --namespace backend

# Semantic search (AgentDB)
npx claude-flow memory vector-search "user login flow" \
  --k 10 --threshold 0.7

# Export for analysis
npx claude-flow memory export backup.json
```

---

#### `training` - Neural Pattern Learning

**Syntax**:
```bash
npx claude-flow training <command> [options]
```

**Commands**:
- `neural-train`: Train on historical operations
- `pattern-learn`: Learn from specific outcomes
- `model-update`: Update agent models

**Options (neural-train)**:
- `--data <source>`: recent | historical | swarm-<id>
- `--model <name>`: task-predictor | agent-selector | performance-optimizer
- `--epochs <n>`: Training epochs (default: 50)

**Examples**:
```bash
# Train on all historical data
npx claude-flow training neural-train \
  --data historical \
  --model task-predictor \
  --epochs 100

# Learn from successes
npx claude-flow training pattern-learn \
  --operation "file-creation" \
  --outcome "success"

# Update agent intelligence
npx claude-flow training model-update \
  --agent-type coder \
  --operation-result "efficient"
```

---

#### `auto agent` - Automatic Agent Selection

**Syntax**:
```bash
npx claude-flow auto agent --task <description> [options]
```

**Options**:
- `--task <desc>`: Task description (required)
- `--max-agents <n>`: Maximum agents to spawn
- `--strategy <type>`: optimal | minimal | balanced
- `--no-spawn`: Analysis only

**When to Use**:
- ✅ Unsure which agents to use
- ✅ Want optimal agent selection
- ✅ Complex requirements
- ✅ Want to see recommendations first

**Examples**:
```bash
# Auto-select and spawn
npx claude-flow auto agent \
  --task "Debug performance regression in checkout flow"

# Analysis only
npx claude-flow auto agent \
  --task "Build admin dashboard" \
  --no-spawn
```

---

### Utility Commands

#### Session Management

```bash
# List sessions
npx claude-flow hive-mind sessions

# Resume session
npx claude-flow hive-mind resume session-<id>

# Stop session
npx claude-flow hive-mind stop session-<id>
```

#### Monitoring

```bash
# Swarm status
npx claude-flow swarm status

# Real-time monitoring
npx claude-flow swarm monitor --interval 5

# Performance report
npx claude-flow performance report --timeframe 24h
```

#### Bottleneck Analysis

```bash
# Detect bottlenecks
npx claude-flow bottleneck detect --time-range 24h

# Auto-fix issues
npx claude-flow bottleneck detect --fix --threshold 15
```

---

## 💡 Real-World Examples

### Example 1: E-Commerce Checkout Flow

**User Request**: "Add abandoned cart recovery with email notifications"

**AI Assistant (Claude) Creates Template**:
```markdown
# Task: Abandoned Cart Recovery

## What to Build
Email notification system that detects abandoned carts and sends recovery emails

## Requirements
- Detect cart abandonment (30 min inactivity)
- Send personalized email with cart contents
- Include discount code (10% off)
- Track email opens and clicks
- Record recovery rate metrics

## Technical Details
- **Stack**: Express + Bull (queue) + Nodemailer + PostgreSQL
- **Methodology**: SPARC + London TDD
- **Quality**: 90%+ coverage
- **Constraints**: Use existing email service, integrate with cart table

## Swarm Configuration
- **Strategy**: development
- **Agents needed**: 6 agents
  - 1 backend-dev: Cart monitoring service
  - 1 backend-dev: Email templating + sending
  - 1 database-architect: Schema updates for tracking
  - 2 tester: Unit + integration tests
  - 1 reviewer: Code quality + security
- **Coordination**: hierarchical

## Success Criteria
- [ ] Abandonment detected within 30 min
- [ ] Email sent with cart contents + discount
- [ ] Click tracking operational
- [ ] Recovery metrics dashboard
- [ ] 90%+ test coverage
- [ ] No PII leakage in emails
```

**Generated Command**:
```bash
npx claude-flow swarm "$(cat docs/prompts/abandoned-cart.md)" \
  --strategy development \
  --mode hierarchical \
  --max-agents 6 \
  --parallel \
  --claude
```

**What Happens**:
1. Claude-Flow sets up hierarchical swarm with hooks
2. Opens new Claude Code instance
3. Claude Code spawns 6 agents via Task tool
4. Agents coordinate via hooks (automatic memory sharing)
5. Cart monitoring implemented with tests
6. Email service integrated
7. Metrics dashboard built
8. All success criteria verified

---

### Example 2: Performance Investigation

**User Request**: "The API is slow, figure out why"

**AI Assistant Response**:
```bash
# Using auto-agent for investigation
npx claude-flow auto agent \
  --task "Investigate API performance regression - response times increased 300%" \
  --strategy optimal
```

**What Auto-Agent Does**:
1. Analyzes task: "Needs performance profiling + analysis"
2. Selects agents:
   - 1 analyst: Profile API endpoints
   - 1 coder: Analyze database queries
   - 1 optimizer: Identify bottlenecks
3. Spawns agents automatically
4. Agents discover: N+1 query problem in user endpoint
5. Fix implemented: Add eager loading
6. Performance restored: 300ms → 50ms response time

---

### Example 3: Multi-Feature Application

**User Request**: "Build complete blog platform"

**AI Assistant Creates Namespace Strategy**:

```bash
# Feature 1: Core blog engine
npx claude-flow hive-mind spawn "$(cat docs/prompts/blog-core.md)" \
  --namespace blog-core \
  --claude

# Feature 2: User authentication (reuses hive memory)
npx claude-flow hive-mind spawn "$(cat docs/prompts/blog-auth.md)" \
  --namespace blog-auth \
  --continue-session \
  --claude

# Feature 3: Comments system (knows about core + auth)
npx claude-flow hive-mind spawn "$(cat docs/prompts/blog-comments.md)" \
  --namespace blog-comments \
  --continue-session \
  --claude

# Check what the hive learned
npx claude-flow memory query "blog" --namespace blog-core
npx claude-flow memory query "auth patterns" --namespace blog-auth
```

**Benefits of Hive-Mind Approach**:
- ✅ Shared memory across features
- ✅ Consistent patterns (auth used everywhere)
- ✅ Can resume if interrupted
- ✅ Knowledge accumulates (comments knows about auth)

---

## 🔍 Troubleshooting

### Issue: `--claude` flag doesn't spawn agents

**Symptoms**: Command runs but no Claude Code instance opens

**Solutions**:
```bash
# 1. Verify Claude Code is installed
which claude
# Should show: /usr/local/bin/claude

# 2. Check claude-flow version
npx claude-flow@alpha --version
# Should be v2.7.0-alpha.10+

# 3. Run with explicit npx
npx claude-flow@alpha swarm "task" --claude

# 4. Check for background processes
ps aux | grep claude
```

---

### Issue: Agents not coordinating (no shared memory)

**Symptoms**: Agents work in isolation, duplicate work

**Diagnosis**:
```bash
# Check if hooks are running
npx claude-flow hooks status

# Check memory database
sqlite3 .swarm/memory.db "SELECT COUNT(*) FROM memory_entries;"
# Should show entries > 0
```

**Solutions**:
1. Ensure you used `--claude` flag (sets up hooks infrastructure)
2. Verify agents are calling hooks via Bash commands:
   ```bash
   # Agents must manually execute these via Bash tool
   npx claude-flow hooks pre-task --description "my task"
   npx claude-flow hooks post-edit --file "path/to/file.js"
   npx claude-flow hooks post-task --task-id "task-123"
   ```
3. Verify swarm initialization:
   ```bash
   npx claude-flow swarm status
   ```
4. Check CLAUDE.md for hook coordination patterns

---

### Issue: Template file not found

**Symptoms**: `cat: docs/prompts/task.md: No such file or directory`

**Solutions**:
```bash
# 1. Check file exists
ls -la docs/prompts/task.md

# 2. Use absolute path
npx claude-flow swarm "$(cat $(pwd)/docs/prompts/task.md)" --claude

# 3. Or use inline string
npx claude-flow swarm "Build authentication system with JWT" --claude
```

---

### Issue: Training doesn't improve agent behavior

**Symptoms**: Neural training completes but agents don't seem smarter

**Diagnosis**:
```bash
# Check if patterns were created
sqlite3 .swarm/memory.db "SELECT COUNT(*) FROM patterns;"

# Check training completion
npx claude-flow training status
```

**Solutions**:
1. Ensure sufficient training data:
   ```bash
   sqlite3 .swarm/memory.db "SELECT COUNT(*) FROM memory_entries WHERE namespace LIKE 'hooks:%';"
   # Should have 100+ entries
   ```

2. Train multiple models:
   ```bash
   npx claude-flow training neural-train --data historical --model task-predictor
   npx claude-flow training neural-train --data historical --model agent-selector
   npx claude-flow training neural-train --data historical --model performance-optimizer
   ```

3. Train on successful patterns only:
   ```bash
   npx claude-flow training pattern-learn --operation "file-creation" --outcome "success"
   ```

---

### Issue: Memory queries return 0 results

**Symptoms**: `npx claude-flow memory query "pattern"` returns nothing

**Solutions**:
```bash
# 1. Check which backend is active
npx claude-flow memory status

# 2. Try both backends
npx claude-flow memory query "pattern" --reasoningbank
npx claude-flow memory vector-search "pattern" --k 10

# 3. List all memories to verify storage
npx claude-flow memory list --namespace default

# 4. Check database directly
sqlite3 .swarm/memory.db "SELECT key, namespace FROM memory_entries LIMIT 10;"
```

---

## 📚 Quick Reference

### Agent Types (54 Total)

**Development**: coder, backend-dev, frontend-dev, mobile-dev, ml-developer
**Architecture**: system-architect, code-analyzer, api-docs
**Testing**: tester, production-validator, tdd-london-swarm
**Analysis**: analyst, code-review-swarm, reviewer
**Coordination**: hierarchical-coordinator, mesh-coordinator, adaptive-coordinator
**SPARC**: specification, pseudocode, architecture, refinement, sparc-coder
**GitHub**: pr-manager, issue-tracker, release-manager, workflow-automation
**Specialized**: cicd-engineer, security-manager, performance-benchmarker

### Strategy Types

- **research**: Investigation, analysis, pattern discovery
- **development**: Building features, implementation
- **analysis**: Code review, performance analysis
- **testing**: Test creation, quality assurance
- **optimization**: Performance tuning, refactoring
- **maintenance**: Bug fixes, updates

### Coordination Modes

- **hierarchical**: Queen-led, top-down (best for SPARC)
- **mesh**: Peer-to-peer, equal agents (best for parallel)
- **ring**: Sequential pipeline (best for workflows)
- **star**: Centralized hub (best for simple tasks)
- **hybrid**: Adaptive switching (let system decide)

### Performance Flags

- `--parallel`: 2.8-4.4x speed boost
- `--max-agents <n>`: Control parallelism
- `--background`: Non-blocking execution
- `--monitor`: Real-time progress

---

## 🎓 Best Practices

### For AI Assistants

1. **Always use templates** for non-trivial tasks
2. **Show the command** before user executes
3. **Explain flag choices** (why hierarchical? why 8 agents?)
4. **Include success criteria** in templates
5. **Recommend training** after successful completions

### For Humans

1. **Start with `swarm`** for simple tasks
2. **Upgrade to `hive-mind`** when you need persistence
3. **Use namespaces** to organize multi-feature projects
4. **Train neural patterns** from successful work
5. **Export memories** before major changes

### For Both

1. **One command per task** - use templates + `--claude`
2. **Let hooks run** - don't disable automatic coordination
3. **Check memory** - query what the system learned
4. **Monitor performance** - use bottleneck detection
5. **Resume sessions** - don't restart from scratch

---

## 📈 Performance Benchmarks

From real usage (7,927 hook operations analyzed):

- **Hook Execution**: 2-3ms average latency
- **Memory Queries**: <100ms for 19K+ entries
- **Vector Search**: <10ms with AgentDB (96x faster)
- **Agent Coordination**: 2.8-4.4x faster with --parallel
- **Neural Training**: 100 epochs on 7K entries in ~2 minutes
- **Pattern Recognition**: 90%+ accuracy after training

---

**Built with ❤️ for AI-Human collaboration**
**Claude-Flow v2.7.0-alpha.10**
