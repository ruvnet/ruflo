---
name: quickstart
description: Interactive onboarding concierge for new Ruflo users. Guides beginners from installation to first productive workflow by mapping their intent to the right command, skill, or swarm topology. Use when user says "get started", "new to ruflo", "how do I use this", "which command should I use", "help me begin", "what can ruflo do", "I'm confused", or "quickstart". Do NOT use for users already running swarms or debugging specific CLI errors — use doctor or troubleshooting instead.
version: 3.5.2
category: onboarding
tags:
  - quickstart
  - onboarding
  - beginner
  - getting-started
  - help
  - first-time
author: Community Contribution
---

# Quickstart — Your First 5 Minutes with Ruflo

## What This Skill Does

Eliminates the "paradox of choice" for new Ruflo users. Instead of memorizing 35+ CLI commands and 38 skills, describe what you want to accomplish and this skill routes you to the exact command, topology, and workflow you need — with a copy-pasteable example.

This skill covers three scenarios:
1. **First-time setup** — verify installation, configure MCP, run diagnostics
2. **Intent routing** — map a goal ("build a feature", "review a PR") to the right Ruflo workflow
3. **Concept clarification** — explain Ruflo's key concepts (swarms, skills, topologies, agents) in plain language

## Prerequisites

- Claude Code installed (`npm install -g @anthropic-ai/claude-code`)
- Node.js 20+ (18 works but 20 recommended)
- A project directory with git initialized

---

## Quick Start

### Verify Your Setup

```bash
npx ruflo@latest doctor
```

Expected output:

```
ok node: v22.x.x
ok npm: 10.x.x
ok git: 2.x.x
ok config: ruflo.config.json found
ok daemon: Running
ok memory: AgentDB initialized
ok agentic-flow: v3.x.x
```

If any checks fail, run:

```bash
npx ruflo@latest doctor --fix
```

### Register Ruflo as an MCP Server

```bash
claude mcp add ruflo -- npx -y ruflo@latest
```

This lets you use Ruflo commands directly inside Claude Code sessions.

### Initialize a Project

```bash
cd your-project
npx ruflo@latest init
```

This creates a `ruflo.config.json` and sets up the skills directory.

---

## Intent Router — What Are You Trying to Do?

### "I want to build a feature"

Use the SPARC methodology with a hierarchical swarm:

```bash
npx ruflo@latest start --sparc --task "describe your feature here"
```

This activates the `sparc-methodology` skill and coordinates agents through Specification, Pseudocode, Architecture, Refinement, and Completion phases.

### "I want to review a PR or code"

Claim a GitHub issue or PR for multi-agent review:

```bash
npx ruflo@latest issues claim #42 --as reviewer
```

This activates the `github-code-review` skill with security scanning, performance analysis, and best-practice enforcement.

### "I want multiple agents working in parallel"

Spawn a coordinated swarm:

```bash
npx ruflo@latest swarm spawn \
  --topology hierarchical \
  --agents 4 \
  --strategy specialized
```

Topology options:
- `hierarchical` — one coordinator, multiple workers (best for most coding tasks)
- `mesh` — all agents communicate equally (best for exploration and research)
- `pipeline` — sequential handoffs (best for staged workflows like build, test, deploy)

### "I want to pair program with AI"

Start an interactive session:

```bash
npx ruflo@latest pair --start --mode driver
```

Modes: `driver` (you lead), `navigator` (Claude leads), `tdd` (test-first), `debug` (fix a specific issue), `mentor` (learning-focused).

### "I want to debug something"

```bash
npx ruflo@latest pair --start --mode debug
```

Claude will ask what's broken and guide you through diagnosis.

### "I want to check system health"

```bash
npx ruflo@latest doctor
npx ruflo@latest status
```

### "I want to store and recall patterns"

Use AgentDB memory:

```bash
npx ruflo@latest memory store \
  --key "auth-pattern" \
  --value "JWT with refresh tokens" \
  --namespace patterns

npx ruflo@latest memory search --query "authentication" --limit 5
```

---

## Key Concepts Explained

### Ruflo vs Claude Flow

Same project. Claude Flow was renamed to Ruflo in v3.5. Legacy aliases (`npx claude-flow@latest`) still work.

### Skills vs Commands

**Skills** auto-activate based on what you say in natural language — you don't invoke them directly. Example: saying "help me plan a sprint" activates the `sparc-methodology` skill automatically.

**Commands** are explicit CLI invocations like `npx ruflo swarm spawn`. Use commands when you know exactly what you want. Use natural language when you want Ruflo to figure it out.

### Swarm Topologies

A swarm is a group of AI agents working together. The topology defines how they communicate:

| Topology | Best For | Agent Count |
|---|---|---|
| `hierarchical` | Coding tasks, feature work | 3-8 |
| `mesh` | Research, exploration | 4-6 |
| `pipeline` | Staged workflows (build/test/deploy) | 3-5 |

### Status Line Indicators

When the daemon is running, you'll see a status line with these indicators:

| Indicator | Meaning |
|---|---|
| Green circle | System healthy |
| Yellow circle | Warning (degraded but functional) |
| Red circle | Error (needs attention) |
| Brain | Memory/AgentDB active |
| Bee | Swarm running |
| Lightning | Agent processing |

### The Learning Loop

Ruflo learns from completed tasks. After agents finish work, successful patterns are stored in AgentDB and reused in future tasks. You don't need to configure this — it happens automatically.

---

## Recommended First Session

If you've never used Ruflo before, do this in order:

1. **Check health**: `npx ruflo@latest doctor --fix`
2. **Initialize project**: `npx ruflo@latest init`
3. **Start small**: `npx ruflo@latest pair --start` — have a conversation about a small task
4. **Try a swarm**: `npx ruflo@latest swarm spawn --topology hierarchical --agents 3 --strategy specialized`
5. **Review what happened**: `npx ruflo@latest status`

---

## Troubleshooting

### "Command not found" when running npx ruflo

Your Node.js or npm may be outdated.

```bash
node --version   # Should be 20+
npm --version    # Should be 10+
```

Fix:

```bash
nvm install 20 && nvm use 20
```

### Skills don't seem to activate

Skills load automatically when Claude detects relevant intent. If a skill isn't activating:

1. Check it's in the right directory: `.claude/skills/[skill-name]/SKILL.md`
2. Restart your Claude Code session
3. Ask Claude directly: "When would you use the [skill-name] skill?"

### Swarm agents seem stuck

```bash
npx ruflo@latest issues load        # Check agent load
npx ruflo@latest issues rebalance   # Redistribute work
```

### MCP connection issues

```bash
claude mcp list                     # Verify ruflo is registered
claude mcp remove ruflo             # Remove and re-add
claude mcp add ruflo -- npx -y ruflo@latest
```

---

## Where to Go Next

| Goal | Skill to Explore |
|---|---|
| Build features with structure | `sparc-methodology` |
| Multi-agent orchestration | `swarm-orchestration` |
| Code review automation | `github-code-review` |
| Release management | `github-release-management` |
| Performance optimization | `performance-analysis` |
| Memory and learning | `agentdb-learning` |
| Build your own skills | `skill-builder` |

---

## Examples

### Example 1: New user, first time

User says: "I just installed Ruflo, what do I do?"

**Actions:**
1. Run `npx ruflo@latest doctor --fix` to verify setup
2. Initialize project with `npx ruflo@latest init`
3. Start a pair programming session: `npx ruflo@latest pair --start`

### Example 2: User knows their goal but not the command

User says: "I want to refactor my authentication module"

**Actions:**
1. Start SPARC workflow: `npx ruflo@latest start --sparc --task "refactor authentication module"`
2. This spawns a hierarchical swarm with architect, coder, reviewer, and tester agents

### Example 3: User is overwhelmed

User says: "There are too many options, I don't know where to start"

**Actions:**
1. Ask one question: "What are you trying to build or fix right now?"
2. Map their answer to the simplest possible command
3. Start with pair programming mode — lowest barrier to entry: `npx ruflo@latest pair --start --mode mentor`
