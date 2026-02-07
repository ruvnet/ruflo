# ADR-027 Supplement: Codex Template Specifications

> **Branding Note**: This package is published as `@claude-flow/codex` and is the first step in transitioning to the `coflow` brand. The future umbrella package will be `npm/npx coflow`.

## Overview

This document provides the complete template specifications for all Codex-generated artifacts, including AGENTS.md, SKILL.md files, and config.toml configurations.

## Package Information

| Property | Value |
|----------|-------|
| Package Name | `@claude-flow/codex` |
| Location | `v3/@claude-flow/codex/` |
| Future Umbrella | `coflow` |
| CLI Command | `npx @claude-flow/codex init` |
| Integration | Works with `@claude-flow/cli` via `--codex` flag |

## AGENTS.md Templates

### Default Template (Full)

```markdown
# Claude Flow V3

> Multi-agent orchestration framework for agentic coding

## Project Overview

{{PROJECT_DESCRIPTION}}

**Tech Stack**: {{TECH_STACK}}
**Architecture**: Domain-Driven Design with bounded contexts

## Quick Start

### Installation
```bash
npm install
```

### Build
```bash
{{BUILD_COMMAND}}
```

### Test
```bash
{{TEST_COMMAND}}
```

### Development
```bash
{{DEV_COMMAND}}
```

## Agent Coordination

### Swarm Configuration

This project uses hierarchical swarm coordination for complex tasks:

| Setting | Value | Purpose |
|---------|-------|---------|
| Topology | `hierarchical` | Queen-led coordination (anti-drift) |
| Max Agents | 8 | Optimal team size |
| Strategy | `specialized` | Clear role boundaries |
| Consensus | `raft` | Leader-based consistency |

### When to Use Swarms

**Invoke swarm for:**
- Multi-file changes (3+ files)
- New feature implementation
- Cross-module refactoring
- API changes with tests
- Security-related changes
- Performance optimization

**Skip swarm for:**
- Single file edits
- Simple bug fixes (1-2 lines)
- Documentation updates
- Configuration changes

### Available Skills

Use `$skill-name` syntax to invoke:

| Skill | Use Case |
|-------|----------|
| `$swarm-orchestration` | Multi-agent task coordination |
| `$memory-management` | Pattern storage and retrieval |
| `$sparc-methodology` | Structured development workflow |
| `$security-audit` | Security scanning and CVE detection |
| `$performance-analysis` | Profiling and optimization |
| `$github-automation` | CI/CD and PR management |

### Agent Types

| Type | Role | Use Case |
|------|------|----------|
| `researcher` | Requirements analysis | Understanding scope |
| `architect` | System design | Planning structure |
| `coder` | Implementation | Writing code |
| `tester` | Test creation | Quality assurance |
| `reviewer` | Code review | Security and quality |

## Code Standards

### File Organization
- **NEVER** save to root folder
- `/src` - Source code files
- `/tests` - Test files
- `/docs` - Documentation
- `/config` - Configuration files

### Quality Rules
- Files under 500 lines
- No hardcoded secrets
- Input validation at boundaries
- Typed interfaces for public APIs
- TDD London School (mock-first) preferred

### Commit Messages
```
<type>(<scope>): <description>

[optional body]

Co-Authored-By: claude-flow <ruv@ruv.net>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

## Security

### Critical Rules
- NEVER commit secrets, credentials, or .env files
- NEVER hardcode API keys
- Always validate user input
- Use parameterized queries for SQL
- Sanitize output to prevent XSS

### Path Security
- Validate all file paths
- Prevent directory traversal (../)
- Use absolute paths internally

### CVE Remediation
Active monitoring for:
- CVE-1: Command injection prevention
- CVE-2: Path traversal protection
- CVE-3: Input validation enforcement

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| HNSW Search | 150x-12,500x faster | Vector operations |
| Memory Reduction | 50-75% | Int8 quantization |
| MCP Response | <100ms | API latency |
| CLI Startup | <500ms | Cold start |

## Testing

### Running Tests
```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# Coverage
npm run test:coverage
```

### Test Philosophy
- TDD London School (mock-first)
- Unit tests for business logic
- Integration tests for boundaries
- E2E tests for critical paths

## Memory System

### Storing Patterns
```bash
npx claude-flow@v3alpha memory store \
  --key "pattern-name" \
  --value "pattern description" \
  --namespace patterns
```

### Searching Memory
```bash
npx claude-flow@v3alpha memory search \
  --query "search terms" \
  --namespace patterns
```

### Learning Protocol
1. **Before task**: Search memory for similar patterns
2. **During task**: Use retrieved patterns
3. **After task**: Store successful patterns for future use

## MCP Integration

Claude Flow exposes tools via MCP:

```bash
# Start MCP server
npx claude-flow@v3alpha mcp start
```

### Available Tools
- `swarm_init` - Initialize swarm coordination
- `agent_spawn` - Spawn new agents
- `memory_store` - Store in AgentDB
- `memory_search` - Semantic search
- `task_orchestrate` - Task coordination

## Hooks System

Claude Flow uses hooks for automation:

| Hook | Purpose |
|------|---------|
| `pre-task` | Get context before starting |
| `post-task` | Record completion for learning |
| `pre-edit` | Validate before file changes |
| `post-edit` | Train neural patterns |

### Example
```bash
npx claude-flow@v3alpha hooks pre-task \
  --description "implementing authentication"
```

## Links

- Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues
```

### Minimal Template

```markdown
# {{PROJECT_NAME}}

## Setup
```bash
npm install && npm run build
```

## Test
```bash
npm test
```

## Code Standards
- Files under 500 lines
- No hardcoded secrets
- Input validation at boundaries

## Skills
- `$swarm-orchestration` - Multi-agent tasks
- `$memory-management` - Pattern storage

## Security
- Never commit .env files
- Validate all inputs
- Prevent path traversal
```

### AGENTS.override.md Template (Local Overrides)

```markdown
# Local Development Overrides

## Environment
- Development mode: full-auto
- Sandbox: workspace-write
- Web search: live

## Personal Preferences
[User can add their specific preferences here]

## Debug Settings
Enable verbose logging for development.

## Notes
This file is gitignored and contains local-only settings.
```

## SKILL.md Templates

### swarm-orchestration/SKILL.md

```yaml
---
name: swarm-orchestration
description: >
  Multi-agent swarm coordination for complex tasks.
  Use when: 3+ files need changes, new features, refactoring.
  Skip when: single file edits, simple fixes, documentation.
---

# Swarm Orchestration Skill

## Purpose
Coordinate multiple specialized agents to work on complex tasks in parallel.

## When to Trigger
- Multi-file changes (3+ files)
- New feature implementation
- Cross-module refactoring
- Performance optimization
- Security audits

## Agent Routing

| Task Type | Agents |
|-----------|--------|
| Bug Fix | researcher, coder, tester |
| Feature | architect, coder, tester, reviewer |
| Refactor | architect, coder, reviewer |
| Performance | perf-engineer, coder |
| Security | security-architect, auditor |

## Execution Steps

### 1. Initialize Swarm
```bash
npx claude-flow@v3alpha swarm init \
  --topology hierarchical \
  --max-agents 8 \
  --strategy specialized
```

### 2. Route Task
```bash
npx claude-flow@v3alpha hooks route --task "[task description]"
```

### 3. Monitor Status
```bash
npx claude-flow@v3alpha swarm status
```

## Memory Integration

### Before Starting
```bash
npx claude-flow@v3alpha memory search --query "[task keywords]"
```

### After Completion
```bash
npx claude-flow@v3alpha memory store \
  --key "[pattern-name]" \
  --value "[what worked]" \
  --namespace patterns
```

## Anti-Drift Configuration

Use these settings to prevent agent drift:

```toml
topology = "hierarchical"
max_agents = 8
strategy = "specialized"
consensus = "raft"
```

## Best Practices
1. Start with memory search for existing patterns
2. Use hierarchical topology for tight coordination
3. Keep team size to 6-8 agents
4. Store successful patterns after completion
```

### memory-management/SKILL.md

```yaml
---
name: memory-management
description: >
  AgentDB memory system with HNSW vector search.
  Use when: need to store/retrieve patterns, search semantically.
  Skip when: no learning or pattern matching needed.
---

# Memory Management Skill

## Purpose
Interact with the AgentDB memory system for pattern storage, retrieval, and semantic search.

## Capabilities

| Operation | Performance |
|-----------|-------------|
| Store | ~1ms |
| Retrieve | ~0.5ms |
| Search (HNSW) | 150x-12,500x faster than brute force |

## Commands

### Store Data
```bash
npx claude-flow@v3alpha memory store \
  --key "unique-key" \
  --value "data to store" \
  --namespace patterns \
  --tags "tag1,tag2"
```

### Search Data
```bash
npx claude-flow@v3alpha memory search \
  --query "semantic search terms" \
  --namespace patterns \
  --limit 10
```

### Retrieve Specific Entry
```bash
npx claude-flow@v3alpha memory retrieve \
  --key "unique-key" \
  --namespace patterns
```

### List All Entries
```bash
npx claude-flow@v3alpha memory list \
  --namespace patterns \
  --limit 50
```

## Namespaces

| Namespace | Purpose |
|-----------|---------|
| `patterns` | Successful code patterns |
| `solutions` | Bug fix solutions |
| `architectures` | Design decisions |
| `optimizations` | Performance improvements |

## Learning Protocol

### Before Task
1. Search for similar past tasks
2. Retrieve relevant patterns
3. Apply learned optimizations

### After Task
1. Store successful patterns
2. Record any new learnings
3. Update optimization strategies

## HNSW Indexing

The memory system uses HNSW (Hierarchical Navigable Small World) indexing:

- **150x faster** for small datasets
- **12,500x faster** for large datasets
- Approximate nearest neighbor search
- Configurable accuracy/speed tradeoff

## Best Practices
1. Use descriptive keys
2. Organize with namespaces
3. Add tags for categorization
4. Search before creating new patterns
```

### sparc-methodology/SKILL.md

```yaml
---
name: sparc-methodology
description: >
  SPARC development workflow (Specification, Pseudocode, Architecture, Refinement, Completion).
  Use when: starting new features, complex implementations.
  Skip when: simple fixes, documentation.
---

# SPARC Methodology Skill

## Purpose
Structured development workflow ensuring thorough planning before implementation.

## Phases

### 1. Specification
Define requirements and acceptance criteria.

```bash
npx claude-flow@v3alpha hooks route --task "specification: [requirements]"
```

### 2. Pseudocode
Design algorithm in plain language.

```bash
npx claude-flow@v3alpha hooks route --task "pseudocode: [algorithm design]"
```

### 3. Architecture
Plan system structure and components.

```bash
npx claude-flow@v3alpha hooks route --task "architecture: [system design]"
```

### 4. Refinement
Iterate and improve implementation.

```bash
npx claude-flow@v3alpha hooks route --task "refinement: [improvements]"
```

### 5. Completion
Final validation and documentation.

```bash
npx claude-flow@v3alpha hooks route --task "completion: [validation]"
```

## Agent Mapping

| Phase | Primary Agent | Support |
|-------|---------------|---------|
| Specification | researcher | architect |
| Pseudocode | architect | coder |
| Architecture | architect | security-architect |
| Refinement | coder | reviewer |
| Completion | tester | documenter |

## Workflow Example

```
1. SPECIFICATION
   └─ Define: "User authentication with JWT"
   └─ Criteria: Secure, Scalable, <100ms latency

2. PSEUDOCODE
   └─ Login flow algorithm
   └─ Token refresh mechanism
   └─ Session management

3. ARCHITECTURE
   └─ Component diagram
   └─ API contracts
   └─ Security boundaries

4. REFINEMENT
   └─ TDD implementation
   └─ Security hardening
   └─ Performance optimization

5. COMPLETION
   └─ Integration tests
   └─ Documentation
   └─ Deployment checklist
```

## Best Practices
1. Complete each phase before moving on
2. Document decisions at each stage
3. Store patterns in memory for reuse
4. Use TDD during refinement
```

### security-audit/SKILL.md

```yaml
---
name: security-audit
description: >
  Security scanning and vulnerability detection.
  Use when: security review needed, handling sensitive data.
  Always trigger for: authentication, authorization, payment processing.
---

# Security Audit Skill

## Purpose
Comprehensive security analysis including vulnerability scanning, CVE detection, and code review.

## Automatic Triggers
Always invoke for:
- Authentication systems
- Authorization/permissions
- Payment processing
- User data handling
- External API integrations
- File uploads

## Security Checks

### 1. Input Validation
```bash
npx claude-flow@v3alpha security scan --check input-validation
```

### 2. Path Security
```bash
npx claude-flow@v3alpha security scan --check path-traversal
```

### 3. Command Injection
```bash
npx claude-flow@v3alpha security scan --check command-injection
```

### 4. Full Audit
```bash
npx claude-flow@v3alpha security scan --depth full
```

## CVE Monitoring

| CVE | Risk | Mitigation |
|-----|------|------------|
| CVE-1 | Command Injection | Input sanitization |
| CVE-2 | Path Traversal | Path validation |
| CVE-3 | Input Validation | Zod schemas |

## Security Patterns

### Input Validation (Zod)
```typescript
const userSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
```

### Path Validation
```typescript
const safePath = await validatePath(userInput);
if (!safePath.isValid) throw new PathTraversalError();
```

### Command Safety
```typescript
const safeExec = new SafeExecutor();
await safeExec.run(command, { sanitize: true });
```

## Best Practices
1. Validate all inputs at boundaries
2. Never trust user data
3. Use parameterized queries
4. Sanitize output for XSS prevention
5. Log security events
6. Regular dependency audits
```

## config.toml Templates

### Default Configuration

```toml
# Claude Flow V3 - Codex Configuration
# Generated by: claude-flow init --codex
# Documentation: https://github.com/ruvnet/claude-flow

# =============================================================================
# Core Settings
# =============================================================================

# Model selection
model = "gpt-5.3-codex"

# Approval policy: untrusted | on-failure | on-request | never
approval_policy = "on-request"

# Sandbox mode: read-only | workspace-write | danger-full-access
sandbox_mode = "workspace-write"

# Web search: disabled | cached | live
web_search = "cached"

# =============================================================================
# Project Documentation
# =============================================================================

# Maximum bytes to read from AGENTS.md files
project_doc_max_bytes = 65536

# Fallback filenames if AGENTS.md not found
project_doc_fallback_filenames = [
  "AGENTS.md",
  "TEAM_GUIDE.md",
  ".agents.md"
]

# =============================================================================
# Features
# =============================================================================

[features]
# Enable child AGENTS.md guidance
child_agents_md = true

# Cache shell environment for faster repeated commands
shell_snapshot = true

# Smart approvals based on request context
request_rule = true

# Enable remote compaction for large histories
remote_compaction = true

# =============================================================================
# MCP Servers
# =============================================================================

[mcp_servers.claude-flow]
command = "npx"
args = ["-y", "@claude-flow/cli@latest"]
enabled = true
tool_timeout_sec = 120

[mcp_servers.ruv-swarm]
command = "npx"
args = ["-y", "ruv-swarm", "mcp", "start"]
enabled = true
tool_timeout_sec = 120

# =============================================================================
# Skills Configuration
# =============================================================================

[[skills.config]]
path = ".agents/skills/swarm-orchestration"
enabled = true

[[skills.config]]
path = ".agents/skills/memory-management"
enabled = true

[[skills.config]]
path = ".agents/skills/sparc-methodology"
enabled = true

[[skills.config]]
path = ".agents/skills/security-audit"
enabled = true

[[skills.config]]
path = ".agents/skills/performance-analysis"
enabled = true

[[skills.config]]
path = ".agents/skills/github-automation"
enabled = true

# =============================================================================
# Profiles
# =============================================================================

# Development profile - more permissive for local work
[profiles.dev]
approval_policy = "never"
sandbox_mode = "danger-full-access"
web_search = "live"

# Safe profile - maximum restrictions
[profiles.safe]
approval_policy = "untrusted"
sandbox_mode = "read-only"
web_search = "disabled"

# CI profile - for automated pipelines
[profiles.ci]
approval_policy = "never"
sandbox_mode = "workspace-write"
web_search = "cached"

# =============================================================================
# History
# =============================================================================

[history]
# Save all session transcripts
persistence = "save-all"

# Maximum history file size (optional)
# max_bytes = 10485760

# =============================================================================
# Shell Environment
# =============================================================================

[shell_environment_policy]
# Inherit environment variables
inherit = "core"

# Exclude sensitive variables
exclude = ["*_KEY", "*_SECRET", "*_TOKEN", "*_PASSWORD"]

# =============================================================================
# Sandbox Workspace Write Settings
# =============================================================================

[sandbox_workspace_write]
# Additional writable paths beyond workspace
writable_roots = []

# Allow network access
network_access = true

# Exclude temp directories
exclude_slash_tmp = false
```

### Minimal Configuration

```toml
# Claude Flow V3 - Minimal Codex Configuration

model = "gpt-5.3-codex"
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[mcp_servers.claude-flow]
command = "npx"
args = ["-y", "@claude-flow/cli@latest"]
enabled = true
```

### CI/CD Configuration

```toml
# Claude Flow V3 - CI/CD Pipeline Configuration

model = "gpt-5.3-codex"
approval_policy = "never"
sandbox_mode = "workspace-write"
web_search = "disabled"

[features]
shell_snapshot = false
remote_compaction = false

[mcp_servers.claude-flow]
command = "npx"
args = ["-y", "@claude-flow/cli@latest"]
enabled = true

[history]
persistence = "none"
```

## Directory Structure Generated

```
project/
├── AGENTS.md                          # Main project instructions
├── .agents/
│   ├── config.toml                    # Project-level Codex config
│   └── skills/
│       ├── swarm-orchestration/
│       │   ├── SKILL.md
│       │   ├── scripts/
│       │   │   └── init-swarm.sh
│       │   └── references/
│       │       └── topology-guide.md
│       ├── memory-management/
│       │   ├── SKILL.md
│       │   └── references/
│       │       └── hnsw-guide.md
│       ├── sparc-methodology/
│       │   ├── SKILL.md
│       │   └── references/
│       │       └── sparc-phases.md
│       ├── security-audit/
│       │   ├── SKILL.md
│       │   └── scripts/
│       │       └── security-scan.sh
│       ├── performance-analysis/
│       │   ├── SKILL.md
│       │   └── scripts/
│       │       └── benchmark.sh
│       └── github-automation/
│           ├── SKILL.md
│           └── scripts/
│               ├── create-pr.sh
│               └── run-ci.sh
├── .codex/                            # User-local overrides (gitignored)
│   ├── config.toml                    # Personal config overrides
│   └── AGENTS.override.md             # Local instruction overrides
└── .claude-flow/                      # Runtime data (shared)
    ├── config.yaml
    ├── data/
    └── logs/
```

## openai.yaml for Skills (Optional)

```yaml
# .agents/skills/swarm-orchestration/agents/openai.yaml

interface:
  display_name: "Swarm Orchestration"
  short_description: "Multi-agent task coordination"
  icon_small: "./assets/swarm-icon-sm.svg"
  icon_large: "./assets/swarm-icon-lg.png"
  brand_color: "#7C3AED"
  default_prompt: "Coordinate multiple agents to work on this task"

dependencies:
  tools:
    - type: "mcp"
      value: "claude-flow"
      description: "Claude Flow MCP server for swarm coordination"
      transport: "stdio"
      command: "npx"
      args: ["-y", "@claude-flow/cli@latest"]
```

## Generation API

```typescript
// Usage in claude-flow CLI or standalone
// Package: @claude-flow/codex (first step toward coflow rebranding)

import {
  generateAgentsMd,
  generateSkillMd,
  generateConfigToml,
  CodexInitializer
} from '@claude-flow/codex';

// Or via the CLI
// npx @claude-flow/codex init
// npx @claude-flow/codex generate-skill --name my-skill

// Generate AGENTS.md
const agentsMd = await generateAgentsMd({
  projectName: 'my-project',
  description: 'Project description',
  buildCommand: 'npm run build',
  testCommand: 'npm test',
  template: 'default' // 'default' | 'minimal' | 'full'
});

// Generate a skill
const skill = await generateSkillMd({
  name: 'custom-skill',
  description: 'Custom skill description',
  triggers: ['when to use'],
  skipWhen: ['when to skip']
});

// Generate config.toml
const config = await generateConfigToml({
  model: 'gpt-5.3-codex',
  approvalPolicy: 'on-request',
  sandboxMode: 'workspace-write',
  mcpServers: [
    { name: 'claude-flow', command: 'npx', args: ['-y', '@claude-flow/cli@latest'] }
  ],
  skills: [
    { path: '.agents/skills/swarm-orchestration', enabled: true }
  ]
});

// Full initialization
const initializer = new CodexInitializer();
const result = await initializer.initialize({
  projectPath: '/path/to/project',
  template: 'default',
  skills: ['swarm', 'memory', 'sparc', 'security'],
  force: false
});
```

This completes the template specifications for the Codex integration.

## CLI Commands

The `@claude-flow/codex` package provides the following commands:

```bash
# Initialize a new Codex project
npx @claude-flow/codex init

# Initialize with specific template
npx @claude-flow/codex init --template minimal

# Generate a new skill
npx @claude-flow/codex generate-skill --name custom-skill

# Migrate from Claude Code to Codex
npx @claude-flow/codex migrate --from claude.md

# Validate AGENTS.md and skills
npx @claude-flow/codex validate

# Generate dual-platform setup (Claude Code + Codex)
npx @claude-flow/codex init --dual
```

## Integration with @claude-flow/cli

When using the main CLI, Codex support is available via:

```bash
# Initialize with Codex support
npx claude-flow@v3alpha init --codex

# Initialize with dual-platform support
npx claude-flow@v3alpha init --dual

# Future (after coflow rebrand)
npx coflow init --codex
npx coflow init --dual
```
