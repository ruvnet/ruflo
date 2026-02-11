/**
 * CLAUDE.md Generator
 * Generates enforceable, analyzer-optimized Claude Code configuration
 * with template variants for different usage patterns.
 *
 * Templates: minimal | standard | full | security | performance | solo
 * All templates use bullet-format rules with imperative keywords for enforceability.
 */

import type { InitOptions, ClaudeMdTemplate } from './types.js';

// --- Section Generators (each returns enforceable markdown) ---

function behavioralRules(): string {
  return `## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- Never continuously check status after spawning a swarm — wait for results
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files`;
}

function fileOrganization(): string {
  return `## File Organization

- NEVER save to root folder — use the directories below
- Use \`/src\` for source code files
- Use \`/tests\` for test files
- Use \`/docs\` for documentation and markdown files
- Use \`/config\` for configuration files
- Use \`/scripts\` for utility scripts
- Use \`/examples\` for example code`;
}

function projectArchitecture(options: InitOptions): string {
  return `## Project Architecture

- Follow Domain-Driven Design with bounded contexts
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Prefer TDD London School (mock-first) for new code
- Use event sourcing for state changes
- Ensure input validation at system boundaries

### Project Config

- **Topology**: ${options.runtime.topology}
- **Max Agents**: ${options.runtime.maxAgents}
- **Memory**: ${options.runtime.memoryBackend}
- **HNSW**: ${options.runtime.enableHNSW ? 'Enabled' : 'Disabled'}
- **Neural**: ${options.runtime.enableNeural ? 'Enabled' : 'Disabled'}`;
}

function concurrencyRules(): string {
  return `## Concurrency: 1 MESSAGE = ALL RELATED OPERATIONS

- All operations MUST be concurrent/parallel in a single message
- Use Claude Code's Task tool for spawning agents, not just MCP
- ALWAYS batch ALL todos in ONE TodoWrite call (5-10+ minimum)
- ALWAYS spawn ALL agents in ONE message with full instructions via Task tool
- ALWAYS batch ALL file reads/writes/edits in ONE message
- ALWAYS batch ALL Bash commands in ONE message`;
}

function swarmOrchestration(): string {
  return `## Swarm Orchestration

- MUST initialize the swarm using CLI tools when starting complex tasks
- MUST spawn concurrent agents using Claude Code's Task tool
- Never use CLI tools alone for execution — Task tool agents do the actual work
- MUST call CLI tools AND Task tool in ONE message for complex work

### 3-Tier Model Routing (ADR-026)

| Tier | Handler | Latency | Cost | Use Cases |
|------|---------|---------|------|-----------|
| **1** | Agent Booster (WASM) | <1ms | $0 | Simple transforms (var→const, add types) — Skip LLM |
| **2** | Haiku | ~500ms | $0.0002 | Simple tasks, low complexity (<30%) |
| **3** | Sonnet/Opus | 2-5s | $0.003-0.015 | Complex reasoning, architecture, security (>30%) |

- Always check for \`[AGENT_BOOSTER_AVAILABLE]\` or \`[TASK_MODEL_RECOMMENDATION]\` before spawning agents
- Use Edit tool directly when \`[AGENT_BOOSTER_AVAILABLE]\``;
}

function antiDriftConfig(): string {
  return `## Swarm Configuration & Anti-Drift

- ALWAYS use hierarchical topology for coding swarms
- Keep maxAgents at 6-8 for tight coordination
- Use specialized strategy for clear role boundaries
- Use \`raft\` consensus for hive-mind (leader maintains authoritative state)
- Run frequent checkpoints via \`post-task\` hooks
- Keep shared memory namespace for all agents

\`\`\`bash
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
\`\`\``;
}

function autoStartProtocol(): string {
  return `## Swarm Protocols & Routing

### Auto-Start Swarm Protocol

When the user requests a complex task, spawn agents in background and WAIT:

\`\`\`javascript
// STEP 1: Initialize swarm coordination
Bash("npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized")

// STEP 2: Spawn ALL agents IN BACKGROUND in a SINGLE message
Task({prompt: "Research requirements...", subagent_type: "researcher", run_in_background: true})
Task({prompt: "Design architecture...", subagent_type: "system-architect", run_in_background: true})
Task({prompt: "Implement solution...", subagent_type: "coder", run_in_background: true})
Task({prompt: "Write tests...", subagent_type: "tester", run_in_background: true})
Task({prompt: "Review code quality...", subagent_type: "reviewer", run_in_background: true})
\`\`\`

### Agent Routing

| Code | Task | Agents |
|------|------|--------|
| 1 | Bug Fix | coordinator, researcher, coder, tester |
| 3 | Feature | coordinator, architect, coder, tester, reviewer |
| 5 | Refactor | coordinator, architect, coder, reviewer |
| 7 | Performance | coordinator, perf-engineer, coder |
| 9 | Security | coordinator, security-architect, auditor |

### Task Complexity Detection

- AUTO-INVOKE SWARM when task involves: 3+ files, new features, cross-module refactoring, API changes, security, or performance work
- SKIP SWARM for: single file edits, simple bug fixes (1-2 lines), documentation updates, configuration changes`;
}

function executionRules(): string {
  return `## Swarm Execution Rules

- ALWAYS use \`run_in_background: true\` for all agent Task calls
- ALWAYS put ALL agent Task calls in ONE message for parallel execution
- After spawning, STOP — do NOT add more tool calls or check status
- Never poll TaskOutput or check swarm status — trust agents to return
- When agent results arrive, review ALL results before proceeding`;
}

function cliCommandsTable(): string {
  return `## V3 CLI Commands

### Core Commands

| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`init\` | 4 | Project initialization |
| \`agent\` | 8 | Agent lifecycle management |
| \`swarm\` | 6 | Multi-agent swarm coordination |
| \`memory\` | 11 | AgentDB memory with HNSW search |
| \`task\` | 6 | Task creation and lifecycle |
| \`session\` | 7 | Session state management |
| \`hooks\` | 17 | Self-learning hooks + 12 workers |
| \`hive-mind\` | 6 | Byzantine fault-tolerant consensus |

### Quick CLI Examples

\`\`\`bash
npx @claude-flow/cli@latest init --wizard
npx @claude-flow/cli@latest agent spawn -t coder --name my-coder
npx @claude-flow/cli@latest swarm init --v3-mode
npx @claude-flow/cli@latest memory search --query "authentication patterns"
npx @claude-flow/cli@latest doctor --fix
\`\`\``;
}

function agentTypes(): string {
  return `## Available Agents (60+ Types)

### Core Development
\`coder\`, \`reviewer\`, \`tester\`, \`planner\`, \`researcher\`

### Specialized
\`security-architect\`, \`security-auditor\`, \`memory-specialist\`, \`performance-engineer\`

### Swarm Coordination
\`hierarchical-coordinator\`, \`mesh-coordinator\`, \`adaptive-coordinator\`

### GitHub & Repository
\`pr-manager\`, \`code-review-swarm\`, \`issue-tracker\`, \`release-manager\`

### SPARC Methodology
\`sparc-coord\`, \`sparc-coder\`, \`specification\`, \`pseudocode\`, \`architecture\``;
}

function hooksSystem(): string {
  return `## Hooks System (27 Hooks + 12 Workers)

### Essential Hooks

| Hook | Description |
|------|-------------|
| \`pre-task\` / \`post-task\` | Task lifecycle with learning |
| \`pre-edit\` / \`post-edit\` | File editing with pattern training |
| \`session-start\` / \`session-end\` | Session state persistence |
| \`route\` | Route task to optimal agent |
| \`intelligence\` | RuVector intelligence system |
| \`worker\` | Background worker management |

### 12 Background Workers

| Worker | Priority | Description |
|--------|----------|-------------|
| \`optimize\` | high | Performance optimization |
| \`audit\` | critical | Security analysis |
| \`testgaps\` | normal | Test coverage analysis |
| \`map\` | normal | Codebase mapping |
| \`deepdive\` | normal | Deep code analysis |
| \`document\` | normal | Auto-documentation |

\`\`\`bash
npx @claude-flow/cli@latest hooks pre-task --description "[task]"
npx @claude-flow/cli@latest hooks post-task --task-id "[id]" --success true
npx @claude-flow/cli@latest hooks worker dispatch --trigger audit
\`\`\``;
}

function learningProtocol(): string {
  return `## Auto-Learning Protocol

### Before Starting Any Task
\`\`\`bash
npx @claude-flow/cli@latest memory search --query "[task keywords]" --namespace patterns
npx @claude-flow/cli@latest hooks route --task "[task description]"
\`\`\`

### After Completing Any Task Successfully
\`\`\`bash
npx @claude-flow/cli@latest memory store --namespace patterns --key "[pattern-name]" --value "[what worked]"
npx @claude-flow/cli@latest hooks post-task --task-id "[id]" --success true --store-results true
\`\`\`

- ALWAYS check memory before starting new features, debugging, or refactoring
- ALWAYS store patterns in memory after solving bugs, completing features, or finding optimizations`;
}

function memoryCommands(): string {
  return `## Memory Commands Reference

\`\`\`bash
# Store (REQUIRED: --key, --value; OPTIONAL: --namespace, --ttl, --tags)
npx @claude-flow/cli@latest memory store --key "pattern-auth" --value "JWT with refresh" --namespace patterns

# Search (REQUIRED: --query; OPTIONAL: --namespace, --limit, --threshold)
npx @claude-flow/cli@latest memory search --query "authentication patterns"

# List (OPTIONAL: --namespace, --limit)
npx @claude-flow/cli@latest memory list --namespace patterns --limit 10

# Retrieve (REQUIRED: --key; OPTIONAL: --namespace)
npx @claude-flow/cli@latest memory retrieve --key "pattern-auth" --namespace patterns
\`\`\``;
}

function securityRulesLight(): string {
  return `## Security Rules

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries
- Always sanitize file paths to prevent directory traversal
- Run \`npx @claude-flow/cli@latest security scan\` after security-related changes`;
}

function buildAndTest(): string {
  return `## Build & Test

\`\`\`bash
# Build
npm run build

# Test
npm test

# Lint
npm run lint
\`\`\`

- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing`;
}

function securitySection(): string {
  return `## Security Protocol

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate all user input at system boundaries using Zod schemas
- Always sanitize file paths to prevent directory traversal attacks
- Always use parameterized queries — never concatenate SQL strings
- Run security audit after any authentication or authorization changes

### Security Scanning
\`\`\`bash
npx @claude-flow/cli@latest security scan --depth full
npx @claude-flow/cli@latest security audit --report
npx @claude-flow/cli@latest security cve --check
\`\`\`

### Security Agents
- \`security-architect\` — threat modeling, architecture review
- \`security-auditor\` — code audit, vulnerability detection
- Use agent routing code 9 (hierarchical/specialized) for security tasks`;
}

function performanceSection(): string {
  return `## Performance Optimization Protocol

- Always run benchmarks before and after performance changes
- Always profile before optimizing — never guess at bottlenecks
- Prefer algorithmic improvements over micro-optimizations
- Keep HNSW search within optimized target
- Keep memory reduction within 50-75% target with quantization

### Performance Tooling
\`\`\`bash
npx @claude-flow/cli@latest performance benchmark --suite all
npx @claude-flow/cli@latest performance profile --target "[component]"
npx @claude-flow/cli@latest performance metrics --format table
\`\`\`

### Performance Agents
- \`performance-engineer\` — profiling, benchmarking, optimization
- \`perf-analyzer\` — bottleneck detection, analysis
- Use agent routing code 7 (hierarchical/specialized) for performance tasks`;
}

function intelligenceSystem(): string {
  return `## Intelligence System (RuVector)

- **Pattern**: Self-Optimizing Pattern Architecture (pattern caching)
- **HNSW**: optimized pattern search
- **EWC++**: Elastic Weight Consolidation (prevents forgetting)
- **Flash Attention**: CPU-optimized

The 4-step intelligence pipeline:
1. **RETRIEVE** - Fetch relevant patterns via HNSW
2. **JUDGE** - Evaluate with verdicts (success/failure)
3. **DISTILL** - Extract key learnings via LoRA
4. **CONSOLIDATE** - Prevent catastrophic forgetting via EWC++`;
}

function envVars(): string {
  return `## Environment Variables

\`\`\`bash
CLAUDE_FLOW_CONFIG=./claude-flow.config.json
CLAUDE_FLOW_LOG_LEVEL=info
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_FLOW_MEMORY_BACKEND=hybrid
CLAUDE_FLOW_MEMORY_PATH=./data/memory
\`\`\``;
}

function setupAndBoundary(): string {
  return `## Quick Setup

\`\`\`bash
claude mcp add claude-flow -- npx -y @claude-flow/cli@latest
npx @claude-flow/cli@latest daemon start
npx @claude-flow/cli@latest doctor --fix
\`\`\`

## Claude Code vs CLI Tools

- Claude Code's Task tool handles ALL execution: agents, file ops, code generation, git
- CLI tools handle coordination via Bash: swarm init, memory, hooks, routing
- NEVER use CLI tools as a substitute for Task tool agents

## Support

- Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues`;
}

// --- Template Composers ---

/**
 * Template section map — defines which sections are included per template.
 */
const TEMPLATE_SECTIONS: Record<ClaudeMdTemplate, Array<(opts: InitOptions) => string>> = {
  minimal: [
    behavioralRules,
    fileOrganization,
    projectArchitecture,
    (_opts) => buildAndTest(),
    (_opts) => securityRulesLight(),
    concurrencyRules,
    (_opts) => antiDriftConfig(),
    executionRules,
    (_opts) => cliCommandsTable(),
    (_opts) => setupAndBoundary(),
  ],
  standard: [
    behavioralRules,
    fileOrganization,
    projectArchitecture,
    (_opts) => buildAndTest(),
    (_opts) => securityRulesLight(),
    concurrencyRules,
    (_opts) => swarmOrchestration(),
    (_opts) => antiDriftConfig(),
    executionRules,
    (_opts) => cliCommandsTable(),
    (_opts) => agentTypes(),
    (_opts) => memoryCommands(),
    (_opts) => setupAndBoundary(),
  ],
  full: [
    behavioralRules,
    fileOrganization,
    projectArchitecture,
    (_opts) => buildAndTest(),
    (_opts) => securityRulesLight(),
    concurrencyRules,
    (_opts) => swarmOrchestration(),
    (_opts) => antiDriftConfig(),
    (_opts) => autoStartProtocol(),
    executionRules,
    (_opts) => cliCommandsTable(),
    (_opts) => agentTypes(),
    (_opts) => hooksSystem(),
    (_opts) => learningProtocol(),
    (_opts) => memoryCommands(),
    (_opts) => intelligenceSystem(),
    (_opts) => envVars(),
    (_opts) => setupAndBoundary(),
  ],
  security: [
    behavioralRules,
    fileOrganization,
    projectArchitecture,
    (_opts) => buildAndTest(),
    concurrencyRules,
    (_opts) => swarmOrchestration(),
    (_opts) => antiDriftConfig(),
    executionRules,
    (_opts) => securitySection(),
    (_opts) => cliCommandsTable(),
    (_opts) => agentTypes(),
    (_opts) => memoryCommands(),
    (_opts) => setupAndBoundary(),
  ],
  performance: [
    behavioralRules,
    fileOrganization,
    projectArchitecture,
    (_opts) => buildAndTest(),
    (_opts) => securityRulesLight(),
    concurrencyRules,
    (_opts) => swarmOrchestration(),
    (_opts) => antiDriftConfig(),
    executionRules,
    (_opts) => performanceSection(),
    (_opts) => cliCommandsTable(),
    (_opts) => agentTypes(),
    (_opts) => memoryCommands(),
    (_opts) => intelligenceSystem(),
    (_opts) => setupAndBoundary(),
  ],
  solo: [
    behavioralRules,
    fileOrganization,
    projectArchitecture,
    (_opts) => buildAndTest(),
    (_opts) => securityRulesLight(),
    concurrencyRules,
    executionRules,
    (_opts) => cliCommandsTable(),
    (_opts) => memoryCommands(),
    (_opts) => setupAndBoundary(),
  ],
};

// --- Public API ---

/**
 * Generate CLAUDE.md content based on init options and template.
 * Template is determined by: options.runtime.claudeMdTemplate > explicit param > 'standard'
 */
export function generateClaudeMd(options: InitOptions, template?: ClaudeMdTemplate): string {
  const tmpl = template ?? options.runtime.claudeMdTemplate ?? 'standard';
  const sections = TEMPLATE_SECTIONS[tmpl] ?? TEMPLATE_SECTIONS.standard;

  const header = `# Claude Code Configuration - Claude Flow V3\n`;
  const body = sections.map(fn => fn(options)).join('\n\n');

  return `${header}\n${body}\n`;
}

/**
 * Generate minimal CLAUDE.md content (backward-compatible alias).
 */
export function generateMinimalClaudeMd(options: InitOptions): string {
  return generateClaudeMd(options, 'minimal');
}

/** Available template names for CLI wizard */
export const CLAUDE_MD_TEMPLATES: Array<{ name: ClaudeMdTemplate; description: string }> = [
  { name: 'minimal', description: 'Quick start — behavioral rules, anti-drift config, CLI reference (~120 lines)' },
  { name: 'standard', description: 'Recommended — swarm orchestration, agents, memory commands (~250 lines)' },
  { name: 'full', description: 'Everything — hooks, learning protocol, intelligence system (~400 lines)' },
  { name: 'security', description: 'Security-focused — adds security scanning, audit protocols, CVE checks' },
  { name: 'performance', description: 'Performance-focused — adds benchmarking, profiling, optimization protocols' },
  { name: 'solo', description: 'Solo developer — no swarm, simple agent usage, memory commands (~150 lines)' },
];

export default generateClaudeMd;
