# /swarm-orchestrate

Main swarm orchestration command for Claude Flow V3.

## 🚨 CRITICAL: Background Execution Pattern

**When spawning a swarm, Claude Code MUST:**

1. **Spawn ALL agents in background** using `run_in_background: true`
2. **Put ALL Task calls in ONE message** for parallel execution
3. **Display status board** with ASCII table and emojis
4. **STOP and WAIT** - don't add more tool calls or poll status

## ✅ CORRECT Spawn Pattern

```javascript
// Spawn ALL agents IN BACKGROUND in ONE message
Task({ prompt: "Research...", subagent_type: "researcher", run_in_background: true })
Task({ prompt: "Design...", subagent_type: "architect", run_in_background: true })
Task({ prompt: "Implement...", subagent_type: "coder", run_in_background: true })
Task({ prompt: "Test...", subagent_type: "tester", run_in_background: true })
Task({ prompt: "Review...", subagent_type: "reviewer", run_in_background: true })
```

## 📊 Required Status Display (ASCII Table)

**After spawning, Claude Code MUST display this status board:**

```
╔══════════════════════════════════════════════════════════════╗
║  🐝 SWARM LAUNCHED                                           ║
╠══════════════════════════════════════════════════════════════╣
║  📋 Task: [user's task description]                          ║
║  🔄 Topology: hierarchical  │  👥 Agents: 5/15               ║
╠══════════════════════════════════════════════════════════════╣
║  AGENT           │  STATUS     │  TASK                       ║
╠══════════════════════════════════════════════════════════════╣
║  🔍 Researcher   │  🟢 ACTIVE  │  Analyzing requirements     ║
║  🏗️ Architect    │  🟢 ACTIVE  │  Designing approach         ║
║  💻 Coder        │  🟢 ACTIVE  │  Implementing solution      ║
║  🧪 Tester       │  🟢 ACTIVE  │  Writing tests              ║
║  👀 Reviewer     │  🟢 ACTIVE  │  Code review & security     ║
╠══════════════════════════════════════════════════════════════╣
║  ⏳ Working in parallel... Results will arrive automatically ║
╚══════════════════════════════════════════════════════════════╝
```

## ❌ DO NOT

```
TaskOutput({ task_id: "..." })     // ❌ Don't poll
"Should I check on agents?"        // ❌ Don't ask
swarm status                       // ❌ Don't check repeatedly
```

## 📋 Agent Types by Task

```
╔═══════════════════╦═════════════════════════════════════════════╗
║  TASK TYPE        ║  AGENTS                                     ║
╠═══════════════════╬═════════════════════════════════════════════╣
║  🆕 New Feature   ║  researcher, architect, coder, tester, rev  ║
║  🐛 Bug Fix       ║  researcher, coder, tester                  ║
║  ♻️ Refactor      ║  architect, coder, reviewer                 ║
║  🔒 Security      ║  security-architect, auditor, reviewer      ║
║  ⚡ Performance   ║  researcher, perf-engineer, coder           ║
║  📚 Documentation ║  researcher, api-docs                       ║
╚═══════════════════╩═════════════════════════════════════════════╝
```

## Usage
```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical
npx @claude-flow/cli@latest swarm status  # Only after completion
```

## Options
```
╔════════════════════════╦═══════════════════════════════════════╗
║  OPTION                ║  DESCRIPTION                          ║
╠════════════════════════╬═══════════════════════════════════════╣
║  --strategy <type>     ║  research, development, analysis      ║
║  --topology <type>     ║  hierarchical, mesh, ring, star       ║
║  --max-agents <n>      ║  Maximum agents (default: 15)         ║
║  --background          ║  Run in background (default: true)    ║
╚════════════════════════╩═══════════════════════════════════════╝
```
