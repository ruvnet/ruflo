# ADR-027: OpenAI Codex Integration

## Status
**Proposed** | 2026-02-07

## Branding Note

This ADR introduces the **coflow** branding transition:
- Package: `@claude-flow/codex` (npm)
- Future umbrella: `coflow` (npm/npx coflow)
- Current umbrella: `claude-flow` (maintained for compatibility)

The Codex integration is the first step in the coflow rebranding initiative.

## Context

### The Agentic Coding Landscape

The agentic coding tool landscape has evolved into two major platforms:

1. **Claude Code** (Anthropic) - CLI tool using CLAUDE.md for project instructions
2. **OpenAI Codex** (OpenAI) - CLI tool using AGENTS.md for project instructions

Both tools share similar concepts but with different implementations:

| Concept | Claude Code | OpenAI Codex |
|---------|-------------|--------------|
| Project Instructions | `CLAUDE.md` | `AGENTS.md` |
| Nested Instructions | `CLAUDE.local.md` | `AGENTS.override.md` |
| Skills | `.claude/skills/` | `.agents/skills/` + `SKILL.md` |
| Configuration | `.claude/settings.json` | `~/.codex/config.toml` |
| MCP Integration | `.mcp.json` | `config.toml [mcp_servers]` |
| Agent Types | Task tool with subagent_type | Agents SDK integration |
| Automation | Hooks system | Automations (scheduled tasks) |
| Session Management | Session persistence | `codex resume`, `codex fork` |
| Non-interactive | `claude -p` | `codex exec` |
| Approval Modes | Permission modes | Approval policies |
| Sandbox | Sandboxing settings | Sandbox modes (read-only, workspace-write, full-access) |

### Research Findings

#### AGENTS.md Specification

AGENTS.md is an open standard managed by the [Agentic AI Foundation](https://agents.md/) under the Linux Foundation. Key characteristics:

- **Discovery Precedence**: Global (`~/.codex/AGENTS.md`) → Project root → Current directory
- **Override Mechanism**: `AGENTS.override.md` takes precedence over `AGENTS.md`
- **Byte Limit**: Default 32 KiB combined instruction size (`project_doc_max_bytes`)
- **Fallback Filenames**: Configurable via `project_doc_fallback_filenames`
- **Monorepo Support**: Nested AGENTS.md files per package/directory

#### Skills System

Codex Skills follow the [Open Agent Skills Specification](https://developers.openai.com/codex/skills):

```
my-skill/
├── SKILL.md                 # Required: instructions + metadata
├── scripts/                 # Optional: executable code
├── references/              # Optional: documentation
├── assets/                  # Optional: templates, resources
└── agents/
    └── openai.yaml         # Optional: UI config and dependencies
```

SKILL.md format:
```yaml
---
name: skill-name
description: When this skill should and should not trigger.
---

Skill instructions for Codex to follow.
```

**Progressive Disclosure**: Codex loads only skill metadata initially, full instructions load on-demand.

**Skill Locations**:
| Scope | Path |
|-------|------|
| Repository (CWD) | `.agents/skills` |
| Repository (Root) | `$REPO_ROOT/.agents/skills` |
| User | `$HOME/.agents/skills` |
| Admin | `/etc/codex/skills` |
| System | Bundled with Codex |

#### Config.toml Configuration

Codex configuration is TOML-based with extensive options:

```toml
# Core settings
model = "gpt-5.3-codex"
approval_policy = "on-request"  # untrusted | on-failure | on-request | never
sandbox_mode = "workspace-write"  # read-only | workspace-write | danger-full-access
web_search = "cached"  # disabled | cached | live

# Features
[features]
shell_snapshot = true
child_agents_md = true

# MCP servers
[mcp_servers.my-server]
command = "npx"
args = ["my-mcp-server"]
enabled = true

# Profiles for different workflows
[profiles.dev]
approval_policy = "never"
sandbox_mode = "danger-full-access"
```

#### Automations

Codex Automations enable scheduled background tasks:
- Run on configurable schedules
- Combine with skills via `$skill-name` syntax
- Results appear in triage inbox
- Respect sandbox settings

#### Agents SDK Integration

Codex can run as an MCP server for multi-agent orchestration:
```bash
codex mcp-server
```

Exposes tools: `codex` (start session) and `codex-reply` (continue session).

## Decision

We will create a **parallel Codex integration** in claude-flow that:

1. **Adds `init --codex` flag** to generate Codex-compatible configuration
2. **Generates AGENTS.md** instead of/alongside CLAUDE.md
3. **Creates `.agents/skills/`** with SKILL.md format skills
4. **Generates `config.toml`** for Codex settings
5. **Maps claude-flow concepts** to Codex equivalents
6. **Supports dual-mode** projects (both Claude Code and Codex)

### Architecture

```
claude-flow init --codex
├── AGENTS.md                    # Project instructions (Codex format)
├── .agents/
│   ├── skills/                  # Skills directory
│   │   ├── swarm-orchestration/
│   │   │   ├── SKILL.md
│   │   │   ├── scripts/
│   │   │   └── references/
│   │   ├── memory-management/
│   │   ├── sparc-methodology/
│   │   └── ...
│   └── config.toml             # Project-level Codex config
├── .codex/                      # Local overrides (gitignored)
│   ├── config.toml             # User config overrides
│   └── AGENTS.override.md      # Local instruction overrides
└── .claude-flow/                # Runtime (shared between both)
    ├── config.yaml
    └── data/
```

### Mapping Table

| claude-flow Concept | Claude Code Output | Codex Output |
|---------------------|-------------------|--------------|
| Project instructions | `CLAUDE.md` | `AGENTS.md` |
| Local overrides | `CLAUDE.local.md` | `AGENTS.override.md` |
| Skills directory | `.claude/skills/` | `.agents/skills/` |
| Skill format | `skill-name.md` (YAML frontmatter) | `skill-name/SKILL.md` |
| Settings | `.claude/settings.json` | `.agents/config.toml` |
| MCP config | `.mcp.json` | `config.toml [mcp_servers]` |
| Hooks | `settings.json` hooks | Automations |
| Agent definitions | `.claude/agents/` | Skills with agent-specific SKILL.md |

### Command-Line Interface

```bash
# Initialize for Codex only
claude-flow init --codex

# Initialize for both platforms (dual-mode)
claude-flow init --dual

# Initialize with wizard (auto-detects or asks)
claude-flow init wizard

# Convert existing Claude Code setup to Codex
claude-flow init --codex --from-claude

# Convert existing Codex setup to Claude Code
claude-flow init --from-codex
```

### Generated AGENTS.md Structure

```markdown
# Claude Flow V3

## Project Overview
[Auto-detected project description]

## Quick Start
[Build and test commands]

## Agent Coordination

### Swarm Configuration
- Topology: hierarchical
- Max Agents: 8
- Strategy: specialized

### Available Skills
Use `$skill-name` to invoke:
- `$swarm-orchestration` - Multi-agent coordination
- `$memory-management` - AgentDB integration
- `$sparc-methodology` - SPARC development workflow

## Code Standards
[From CLAUDE.md Code Quality Rules]

## Security
- Never commit secrets
- Input validation at boundaries
- Path traversal prevention

## Performance Targets
[From V3 performance targets]
```

### Generated SKILL.md Example

```yaml
---
name: swarm-orchestration
description: >
  Use when coordinating multiple agents for complex tasks.
  Triggers for: multi-file changes, feature implementation,
  refactoring, performance optimization, security audits.
  Skip for: single file edits, simple fixes, documentation.
---

# Swarm Orchestration Skill

## When to Use
- Complex tasks requiring 3+ agents
- Multi-file changes
- Cross-module refactoring

## Available Agents
| Type | Use Case |
|------|----------|
| researcher | Requirements analysis |
| architect | System design |
| coder | Implementation |
| tester | Test writing |
| reviewer | Code review |

## Execution Pattern

### 1. Initialize Swarm
```bash
npx claude-flow@v3alpha swarm init --topology hierarchical
```

### 2. Spawn Agents
Use Codex to orchestrate via MCP:
```bash
npx claude-flow@v3alpha mcp start
```

### 3. Monitor Progress
```bash
npx claude-flow@v3alpha swarm status
```

## Memory Integration
Store patterns for learning:
```bash
npx claude-flow@v3alpha memory store --key "[pattern]" --value "[learned]"
```
```

### Generated config.toml

```toml
# Claude Flow V3 - Codex Configuration
# Generated by: claude-flow init --codex

model = "gpt-5.3-codex"
approval_policy = "on-request"
sandbox_mode = "workspace-write"
web_search = "cached"

# Project documentation
project_doc_max_bytes = 65536
project_doc_fallback_filenames = ["AGENTS.md", "TEAM_GUIDE.md", ".agents.md"]

[features]
child_agents_md = true
shell_snapshot = true
request_rule = true

# MCP Servers
[mcp_servers.claude-flow]
command = "npx"
args = ["-y", "@claude-flow/cli@latest"]
enabled = true
tool_timeout_sec = 120

[mcp_servers.ruv-swarm]
command = "npx"
args = ["-y", "ruv-swarm", "mcp", "start"]
enabled = true

# Skills configuration
[[skills.config]]
path = ".agents/skills/swarm-orchestration"
enabled = true

[[skills.config]]
path = ".agents/skills/memory-management"
enabled = true

[[skills.config]]
path = ".agents/skills/sparc-methodology"
enabled = true

# Profiles
[profiles.dev]
approval_policy = "never"
sandbox_mode = "danger-full-access"

[profiles.safe]
approval_policy = "untrusted"
sandbox_mode = "read-only"
```

## Consequences

### Positive
1. **Cross-platform support** - Users can use either Claude Code or Codex
2. **Ecosystem reach** - AGENTS.md is supported by 20+ tools (Cursor, Copilot, etc.)
3. **Standard compliance** - Follows AAIF and Open Agent Skills specifications
4. **Migration path** - Easy conversion between platforms
5. **Dual-mode** - Single project can support both tools

### Negative
1. **Maintenance burden** - Two sets of generators to maintain
2. **Sync complexity** - Keeping CLAUDE.md and AGENTS.md in sync
3. **Feature parity** - Some features may not map 1:1

### Risks
1. **Specification drift** - AGENTS.md spec may evolve
2. **Tool differences** - Behavioral differences between platforms
3. **Ecosystem fragmentation** - Users may expect identical behavior

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1-2)
1. Create `@claude-flow/codex` package in `v3/@claude-flow/codex/`
2. Implement AGENTS.md generator
3. Implement SKILL.md generator
4. Implement config.toml generator
5. Set up npm publishing for `@claude-flow/codex`

### Phase 2: Init Integration (Week 3)
1. Add `--codex` flag to init command
2. Add `--dual` flag for both platforms
3. Add `--from-claude` and `--from-codex` conversion
4. Update wizard to support platform selection
5. Wire up `@claude-flow/codex` as dependency

### Phase 3: Skills Library (Week 4)
1. Convert all `.claude/skills/` to `.agents/skills/` format
2. Create skill migration script
3. Test skill discovery and loading
4. Publish skills as part of `@claude-flow/codex`

### Phase 4: Automation Integration (Week 5)
1. Map claude-flow hooks to Codex Automations
2. Create automation templates
3. Document automation patterns

### Phase 5: Coflow Transition (Week 6+)
1. Create `coflow` npm package (umbrella)
2. Update CLI entry points for `npx coflow`
3. Maintain `claude-flow` as alias for compatibility
4. Update documentation for dual branding

## References

### Official Documentation
- [AGENTS.md Specification](https://agents.md/)
- [OpenAI Codex CLI](https://developers.openai.com/codex/cli/)
- [Codex Skills](https://developers.openai.com/codex/skills)
- [Codex Configuration Reference](https://developers.openai.com/codex/config-reference/)
- [Codex Automations](https://developers.openai.com/codex/app/automations/)
- [Agents SDK Integration](https://developers.openai.com/codex/guides/agents-sdk/)

### GitHub Repositories
- [OpenAI Codex](https://github.com/openai/codex)
- [Codex AGENTS.md Example](https://github.com/openai/codex/blob/main/AGENTS.md)

### Related Standards
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [Agentic AI Foundation](https://aaif.org/)

## Appendix A: Complete Feature Mapping

### AGENTS.md Sections (Claude Flow Template)

| Section | Content Source |
|---------|----------------|
| Project Overview | Auto-detected from package.json, README |
| Quick Start | Build/test commands from package.json |
| Agent Coordination | From CLAUDE.md swarm config |
| Code Standards | From CLAUDE.md behavioral rules |
| Security | From @claude-flow/security patterns |
| Performance | From V3 performance targets |
| Testing | From TDD/testing patterns |
| Memory | From AgentDB integration |

### Skill Mapping (Full List)

| Claude Code Skill | Codex Skill Directory |
|-------------------|----------------------|
| `swarm-orchestration.md` | `.agents/skills/swarm-orchestration/` |
| `agentdb-advanced.md` | `.agents/skills/memory-management/` |
| `sparc-methodology.md` | `.agents/skills/sparc-methodology/` |
| `github-workflow-automation.md` | `.agents/skills/github-automation/` |
| `v3-core-implementation.md` | `.agents/skills/v3-core/` |
| `pair-programming.md` | `.agents/skills/pair-programming/` |
| `performance-analysis.md` | `.agents/skills/performance-analysis/` |
| `v3-security-overhaul.md` | `.agents/skills/security-audit/` |
| `hive-mind-advanced.md` | `.agents/skills/hive-mind/` |
| `reasoningbank-intelligence.md` | `.agents/skills/adaptive-learning/` |

### Config.toml Feature Mapping

| Claude Code Feature | Codex config.toml |
|--------------------|--------------------|
| Hooks: PreToolUse | `approval_policy` |
| Hooks: PostToolUse | Automations |
| Hooks: UserPromptSubmit | Skills + Automations |
| Permission modes | `approval_policy` + `sandbox_mode` |
| MCP servers | `[mcp_servers]` table |
| Model selection | `model` |
| Session persistence | `history.persistence` |

## Appendix B: Codex CLI Reference

### Core Commands

| Command | Description |
|---------|-------------|
| `codex` | Interactive terminal UI |
| `codex exec` | Non-interactive execution |
| `codex resume` | Continue previous session |
| `codex fork` | Branch from existing session |
| `codex cloud` | Cloud task management |
| `codex apply` | Apply diffs from cloud tasks |

### MCP Commands

| Command | Description |
|---------|-------------|
| `codex mcp list` | List configured servers |
| `codex mcp add <name>` | Add new server |
| `codex mcp remove <name>` | Remove server |
| `codex mcp-server` | Run Codex as MCP server |

### Feature Commands

| Command | Description |
|---------|-------------|
| `codex features list` | Show feature flags |
| `codex features enable <flag>` | Enable feature |
| `codex features disable <flag>` | Disable feature |

### Approval Policies

| Policy | Behavior |
|--------|----------|
| `untrusted` | Prompt for every command |
| `on-failure` | Prompt only on failures |
| `on-request` | Prompt when agent requests |
| `never` | Never prompt (dangerous) |

### Sandbox Modes

| Mode | Behavior |
|------|----------|
| `read-only` | No file/network modifications |
| `workspace-write` | Write only to workspace |
| `danger-full-access` | Full system access |

## Appendix C: Undocumented Features for Integration

These features were discovered through binary analysis and can be leveraged for deep claude-flow integration.

### Environment Variables

| Variable | Purpose | Integration Use |
|----------|---------|-----------------|
| `CODEX_HOME` | Override config directory | Project-specific configs |
| `CODEX_CI=1` | CI mode | Pipeline optimization |
| `CODEX_SANDBOX_NETWORK_DISABLED=1` | Disable network | Security hardening |
| `CODEX_TUI_RECORD_SESSION=1` | Record session | Debug/learning |
| `CODEX_TUI_SESSION_LOG_PATH` | Session log path | Pattern extraction |
| `CODEX_STARTING_DIFF` | Initial diff | Session preloading |
| `CODEX_GITHUB_PERSONAL_ACCESS_TOKEN` | GitHub PAT | MCP GitHub integration |
| `CODEX_CONNECTORS_TOKEN` | MCP connectors | Auth for MCP servers |

### JSON-RPC Methods (via MCP Server)

#### Thread Management
```javascript
// Start new thread
{ method: "thread/start", params: { prompt, cwd, approval_policy } }

// Fork thread for parallel work
{ method: "thread/fork", params: { threadId, prompt } }

// Resume thread
{ method: "thread/resume", params: { threadId } }

// Rollback thread
{ method: "thread/rollback", params: { threadId, numTurns } }

// List loaded threads
{ method: "thread/loaded/list", params: {} }
```

#### Skills Management
```javascript
// List available skills
{ method: "skills/list", params: {} }

// Read remote skill
{ method: "skills/remote/read", params: { path } }

// Write skill config
{ method: "skills/config/write", params: { path, enabled } }
```

#### Configuration
```javascript
// Batch write config
{ method: "config/batchWrite", params: { values: [...] } }

// Read requirements
{ method: "configRequirements/read", params: {} }

// Read rate limits
{ method: "account/rateLimits/read", params: {} }
```

### Hidden CLI Commands

| Command | Purpose | Usage |
|---------|---------|-------|
| `codex debug-config` | Show config layers | Debug config issues |
| `codex rollout` | Print rollout path | Access rollout files |

### Experimental Features (Enable via config.toml)

```toml
[features]
# Sub-agent spawning for multi-agent workflows
# Not officially documented but functional
experimentalApi = true

# Emit raw response items on event stream
experimentalRawEvents = true

# Enable collaboration modes
collab = true

# Enable app integrations
apps = true
```

### Ghost Snapshots

Codex uses "ghost commits" for state management:
- Creates temporary commits without modifying history
- Enables undo/rollback operations
- Uses `codex snapshot@codex.local` as author

**Integration opportunity**: Use similar pattern for swarm state management.

### Sub-Agent Collaboration

Internal structures support multi-agent collaboration:

```typescript
interface CollabAgentToolCall {
  senderThreadId: string;      // Originating agent
  receiverThreadIds: string[]; // Target agents
  prompt: string;              // Task description
  agentsStates: AgentState[];  // State tracking
}
```

**Integration opportunity**: Map to claude-flow swarm coordination.

### Dynamic Tool Registration

Codex supports runtime tool registration via MCP:

```javascript
// Register tool at runtime
{ method: "tools/register", params: { name, schema, handler } }
```

**Integration opportunity**: Register claude-flow tools dynamically.

### Integration Patterns Using Undocumented Features

#### 1. CI/CD Pipeline Mode
```bash
# Optimized for pipelines
CODEX_CI=1 \
CODEX_SANDBOX_NETWORK_DISABLED=1 \
codex exec --json \
  -c "approval_policy='never'" \
  "run tests and generate report"
```

#### 2. Session Recording for Learning
```bash
# Record session for pattern extraction
CODEX_TUI_RECORD_SESSION=1 \
CODEX_TUI_SESSION_LOG_PATH=/tmp/codex-session.log \
codex
```

#### 3. Project-Specific Configuration
```bash
# Use project-local config
CODEX_HOME=/project/.codex codex
```

#### 4. Programmatic Thread Control
```javascript
// Fork threads for parallel work
const threads = await Promise.all([
  codexRpc({ method: "thread/fork", params: { threadId, prompt: "Task A" }}),
  codexRpc({ method: "thread/fork", params: { threadId, prompt: "Task B" }}),
  codexRpc({ method: "thread/fork", params: { threadId, prompt: "Task C" }})
]);
```

#### 5. Rate Limit Monitoring
```javascript
// Check rate limits before spawning agents
const limits = await codexRpc({ method: "account/rateLimits/read" });
if (limits.remaining > 0) {
  await spawnAgents();
}
```

### Generated config.toml with Undocumented Features

```toml
# Claude Flow V3 - Codex Configuration (Enhanced)
# Includes undocumented features for advanced integration

model = "gpt-5.3-codex"
approval_policy = "on-request"
sandbox_mode = "workspace-write"
web_search = "cached"

# Enable experimental features for integration
[features]
child_agents_md = true
shell_snapshot = true
request_rule = true
# Undocumented but functional
collab = true
apps = true

# MCP Servers with auth
[mcp_servers.claude-flow]
command = "npx"
args = ["-y", "@claude-flow/cli@latest"]
enabled = true
tool_timeout_sec = 120
# Use CODEX_CONNECTORS_TOKEN for auth

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
enabled = true
# Reads CODEX_GITHUB_PERSONAL_ACCESS_TOKEN

# CI Profile with undocumented options
[profiles.ci]
approval_policy = "never"
sandbox_mode = "workspace-write"
# Set CODEX_CI=1 for additional optimizations
```
