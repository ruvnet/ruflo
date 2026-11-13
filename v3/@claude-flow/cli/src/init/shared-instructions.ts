/**
 * Shared Ruflo instruction sections (#2638).
 *
 * The host-neutral half of the project instructions: the text both Claude
 * Code and Codex should read. In a dual project AGENTS.md carries these
 * sections once, and CLAUDE.md pulls them in with Claude Code's `@AGENTS.md`
 * import, adding only Claude-specific guidance.
 *
 * Canonical copy: v3/@claude-flow/codex/src/generators/shared-instructions.ts
 * Mirror:         v3/@claude-flow/cli/src/init/shared-instructions.ts
 *
 * The two files must stay byte-identical (a CLI test compares them). The CLI
 * keeps a mirror instead of importing it because it pins a published
 * @claude-flow/codex release, which cannot see unreleased exports; once the
 * CLI pins a codex release that ships this module, the mirror can go.
 *
 * Pure: no imports, no I/O.
 */

/**
 * How the sections invoke the Ruflo CLI. The default is the codex generators'
 * convention (unversioned, as in AGENTS.md); the CLI passes its own pinned-tag
 * form so its single-host CLAUDE.md is unchanged.
 */
export const DEFAULT_CLI = 'npx @claude-flow/cli';

/** Rules both hosts follow. The Claude-only commit-trailer rule is kept by the CLI. */
export const SHARED_RULE_LINES: readonly string[] = [
  '- Do what has been asked; nothing more, nothing less',
  '- NEVER create files unless absolutely necessary — prefer editing existing files',
  '- NEVER create documentation files unless explicitly requested',
  '- NEVER save working files or tests to root — use `/src`, `/tests`, `/docs`, `/config`, `/scripts`',
  '- ALWAYS read a file before editing it',
  '- NEVER commit secrets, credentials, or .env files',
  '- Keep files under 500 lines',
  '- Validate input at system boundaries',
];

/** Position of the Claude-only commit-trailer rule inside the single-host Rules list. */
export const CLAUDE_RULE_INSERT_AT = 6;

export function sharedRules(): string {
  return `## Rules\n\n${SHARED_RULE_LINES.join('\n')}`;
}

/** Swarm body shared by both hosts: init command, routing table, when to swarm. */
export function swarmRoutingBody(cli: string = DEFAULT_CLI): string {
  return `\`\`\`bash
${cli} swarm init --topology hierarchical --max-agents 8 --strategy specialized
\`\`\`

### Agent Routing

| Task | Agents | Topology |
|------|--------|----------|
| Bug Fix | researcher, coder, tester | hierarchical |
| Feature | architect, coder, tester, reviewer | hierarchical |
| Refactor | architect, coder, reviewer | hierarchical |
| Performance | perf-engineer, coder | hierarchical |
| Security | security-architect, auditor | hierarchical |

### When to Swarm
- **YES**: 3+ files, new features, cross-module refactoring, API changes, security, performance
- **NO**: single file edits, 1-2 line fixes, docs updates, config changes, questions`;
}

export function sharedSwarmRouting(cli: string = DEFAULT_CLI): string {
  return `## Swarm & Routing\n\n${swarmRoutingBody(cli)}`;
}

export function sharedMemoryAndLearning(cli: string = DEFAULT_CLI): string {
  return `## Memory & Learning

### Before Any Task
\`\`\`bash
${cli} memory search --query "[task keywords]" --namespace patterns
${cli} hooks route --task "[task description]"
\`\`\`

### After Success
\`\`\`bash
${cli} memory store --namespace patterns --key "[name]" --value "[what worked]"
${cli} hooks post-task --task-id "[id]" --success true --store-results true
\`\`\`

### MCP Tools (use \`ToolSearch("keyword")\` to discover)

| Category | Key Tools |
|----------|-----------|
| **Memory** | \`memory_store\`, \`memory_search\`, \`memory_search_unified\` |
| **Bridge** | \`memory_import_claude\`, \`memory_bridge_status\` |
| **Swarm** | \`swarm_init\`, \`swarm_status\`, \`swarm_health\` |
| **Agents** | \`agent_spawn\`, \`agent_list\`, \`agent_status\` |
| **Hooks** | \`hooks_route\`, \`hooks_post-task\`, \`hooks_worker-dispatch\` |
| **Security** | \`aidefence_scan\`, \`aidefence_is_safe\`, \`aidefence_has_pii\` |
| **Hive-Mind** | \`hive-mind_init\`, \`hive-mind_consensus\`, \`hive-mind_spawn\` |

### Background Workers

| Worker | When |
|--------|------|
| \`audit\` | After security changes |
| \`optimize\` | After performance work |
| \`testgaps\` | After adding features |
| \`map\` | Every 5+ file changes |
| \`document\` | After API changes |

\`\`\`bash
${cli} hooks worker dispatch --trigger audit
\`\`\``;
}

export function sharedAgentTypes(): string {
  return `## Agents

**Core**: \`coder\`, \`reviewer\`, \`tester\`, \`planner\`, \`researcher\`
**Architecture**: \`system-architect\`, \`backend-dev\`, \`mobile-dev\`
**Security**: \`security-architect\`, \`security-auditor\`
**Performance**: \`performance-engineer\`, \`perf-analyzer\`
**Coordination**: \`hierarchical-coordinator\`, \`mesh-coordinator\`, \`adaptive-coordinator\`
**GitHub**: \`pr-manager\`, \`code-review-swarm\`, \`issue-tracker\`, \`release-manager\`

Any string works as a custom agent type.`;
}

export function sharedBuildAndTest(): string {
  return `## Build & Test

- ALWAYS run tests after code changes
- ALWAYS verify build succeeds before committing

\`\`\`bash
npm run build && npm test
\`\`\``;
}

export function sharedCliQuickRef(cli: string = DEFAULT_CLI): string {
  return `## CLI Quick Reference

\`\`\`bash
${cli} init --wizard           # Setup
${cli} swarm init --v3-mode     # Start swarm
${cli} memory search --query "" # Vector search
${cli} hooks route --task ""    # Route to agent
${cli} doctor --fix             # Diagnostics
${cli} security scan            # Security scan
${cli} performance benchmark    # Benchmarks
\`\`\`

26 commands, 140+ subcommands. Use \`--help\` on any command for details.`;
}

/**
 * Every shared section, in order. AGENTS.md (dual mode) writes all of them;
 * a CLAUDE.md that imports AGENTS.md must not repeat any of them.
 */
export function generateSharedInstructions(cli: string = DEFAULT_CLI): string[] {
  return [
    sharedRules(),
    sharedSwarmRouting(cli),
    sharedMemoryAndLearning(cli),
    sharedAgentTypes(),
    sharedBuildAndTest(),
    sharedCliQuickRef(cli),
  ];
}

/** Claude Code's import line. Must stand on its own line, outside a code block. */
export const AGENTS_MD_IMPORT = '@AGENTS.md';

/** True when the text already pulls AGENTS.md in through Claude Code's import syntax. */
export function importsAgentsMd(text: string): boolean {
  return text.split(/\r?\n/).some((line) => line.trim() === AGENTS_MD_IMPORT);
}
