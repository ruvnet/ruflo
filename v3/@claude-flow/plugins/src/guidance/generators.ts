/**
 * CLAUDE.md Generator
 *
 * Generates a structured CLAUDE.md file optimized for the Guidance Control Plane.
 * The output is designed so that when compiled by GuidanceCompiler, it produces
 * a clean constitution (always-loaded invariants) and well-tagged shards
 * (task-scoped rules retrievable by intent).
 *
 * Structure conventions:
 * - Lines 1-60: Constitution (always loaded into every task)
 * - Remaining: Tagged shards (retrieved by intent classification)
 * - Headings map to shard boundaries
 * - Keywords in headings drive intent tagging: "test", "build", "security", etc.
 *
 * @module @claude-flow/guidance/generators
 */

// ============================================================================
// Types
// ============================================================================

export interface ProjectProfile {
  /** Project name */
  name: string;
  /** Short description */
  description?: string;
  /** Primary language(s) */
  languages: string[];
  /** Frameworks in use */
  frameworks?: string[];
  /** Package manager */
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';
  /** Monorepo? */
  monorepo?: boolean;
  /** Build command */
  buildCommand?: string;
  /** Test command */
  testCommand?: string;
  /** Lint command */
  lintCommand?: string;
  /** Source directory */
  srcDir?: string;
  /** Test directory */
  testDir?: string;
  /** Domain-specific rules */
  domainRules?: string[];
  /** Architecture notes */
  architecture?: string;
  /** Team conventions */
  conventions?: string[];
  /** Forbidden patterns */
  forbidden?: string[];
  /** Required patterns */
  required?: string[];
  /** Import paths for personal instructions */
  imports?: string[];
  /** Enable guidance control plane integration */
  guidanceControlPlane?: boolean;
  /** Enable WASM kernel for hot paths */
  wasmKernel?: boolean;
  /** Agent swarm configuration */
  swarm?: {
    topology?: 'hierarchical' | 'mesh' | 'adaptive';
    maxAgents?: number;
    strategy?: 'specialized' | 'balanced';
  };
}

export interface LocalProfile {
  /** Developer name or identifier */
  developer?: string;
  /** Local API URLs */
  localUrls?: Record<string, string>;
  /** Local database connection strings */
  databases?: Record<string, string>;
  /** Personal preferences */
  preferences?: string[];
  /** Machine-specific notes */
  machineNotes?: string[];
  /** Editor / IDE */
  editor?: string;
  /** OS */
  os?: string;
  /** Custom environment variables */
  envVars?: Record<string, string>;
  /** Debug settings */
  debug?: string[];
}

export interface SkillDefinition {
  /** Skill name (kebab-case) */
  name: string;
  /** Version */
  version?: string;
  /** Description */
  description: string;
  /** Category */
  category: 'core' | 'github' | 'testing' | 'security' | 'deployment' | 'analysis' | 'custom';
  /** Tags */
  tags?: string[];
  /** Required tools */
  requires?: string[];
  /** Capabilities list */
  capabilities?: string[];
  /** Skill instructions (markdown body) */
  instructions: string;
}

export interface AgentDefinition {
  /** Agent name (kebab-case) */
  name: string;
  /** Agent type */
  type: 'coordinator' | 'developer' | 'tester' | 'reviewer' | 'security-specialist' | 'researcher' | 'architect' | 'devops' | 'custom';
  /** Description */
  description: string;
  /** Category subdirectory */
  category?: string;
  /** Color for UI */
  color?: string;
  /** Capabilities */
  capabilities?: string[];
  /** Focus areas */
  focus?: string[];
  /** Temperature (0.0-1.0) */
  temperature?: number;
  /** Priority */
  priority?: 'high' | 'medium' | 'low';
  /** System prompt */
  systemPrompt?: string;
  /** Pre-execution hook */
  preHook?: string;
  /** Post-execution hook */
  postHook?: string;
  /** Detailed instructions (markdown body) */
  instructions?: string;
}

// ============================================================================
// CLAUDE.md Generator
// ============================================================================

export function generateClaudeMd(profile: ProjectProfile): string {
  const sections: string[] = [];

  // --- Constitution (lines 1-60, always loaded) ---
  sections.push(`# ${profile.name}`);
  sections.push('');
  if (profile.description) {
    sections.push(profile.description);
    sections.push('');
  }

  // Core invariants
  sections.push('## Core Invariants');
  sections.push('');
  sections.push('These rules are always active regardless of task type.');
  sections.push('');

  // Language-specific invariants
  for (const lang of profile.languages) {
    const invariants = getLanguageInvariants(lang);
    if (invariants.length > 0) {
      for (const inv of invariants) {
        sections.push(`- ${inv}`);
      }
    }
  }

  // Forbidden patterns
  if (profile.forbidden && profile.forbidden.length > 0) {
    sections.push('');
    for (const f of profile.forbidden) {
      sections.push(`- NEVER: ${f}`);
    }
  }

  // Required patterns
  if (profile.required && profile.required.length > 0) {
    for (const r of profile.required) {
      sections.push(`- ALWAYS: ${r}`);
    }
  }

  sections.push('');

  // --- Build & Test (tagged shard) ---
  sections.push('## Build & Test');
  sections.push('');
  const pm = profile.packageManager || 'npm';
  if (profile.buildCommand) {
    sections.push(`Build: \`${profile.buildCommand}\``);
  } else {
    sections.push(`Build: \`${pm} run build\``);
  }
  if (profile.testCommand) {
    sections.push(`Test: \`${profile.testCommand}\``);
  } else {
    sections.push(`Test: \`${pm} test\``);
  }
  if (profile.lintCommand) {
    sections.push(`Lint: \`${profile.lintCommand}\``);
  }
  sections.push('');
  sections.push('Run tests before committing. Run the build to catch type errors.');
  sections.push('');

  // --- Project Structure ---
  sections.push('## Project Structure');
  sections.push('');
  if (profile.monorepo) {
    sections.push('This is a monorepo. Each package has its own CLAUDE.md that layers on top of this root file.');
  }
  if (profile.srcDir) {
    sections.push(`Source code: \`${profile.srcDir}/\``);
  }
  if (profile.testDir) {
    sections.push(`Tests: \`${profile.testDir}/\``);
  }
  if (profile.architecture) {
    sections.push('');
    sections.push(profile.architecture);
  }
  sections.push('');

  // --- Coding Standards ---
  if (profile.conventions && profile.conventions.length > 0) {
    sections.push('## Coding Standards');
    sections.push('');
    for (const c of profile.conventions) {
      sections.push(`- ${c}`);
    }
    sections.push('');
  }

  // --- Domain Rules ---
  if (profile.domainRules && profile.domainRules.length > 0) {
    sections.push('## Domain Rules');
    sections.push('');
    for (const rule of profile.domainRules) {
      sections.push(`- ${rule}`);
    }
    sections.push('');
  }

  // --- Framework-specific shards ---
  if (profile.frameworks && profile.frameworks.length > 0) {
    for (const fw of profile.frameworks) {
      const fwRules = getFrameworkRules(fw);
      if (fwRules.length > 0) {
        sections.push(`## ${fw} Conventions`);
        sections.push('');
        for (const rule of fwRules) {
          sections.push(`- ${rule}`);
        }
        sections.push('');
      }
    }
  }

  // --- Security ---
  sections.push('## Security');
  sections.push('');
  sections.push('- Never commit secrets, API keys, or credentials to git');
  sections.push('- Never run destructive commands (`rm -rf /`, `DROP TABLE`, `git push --force`) without explicit confirmation');
  sections.push('- Validate all external input at system boundaries');
  sections.push('- Use parameterized queries for database operations');
  sections.push('');

  // --- Guidance Control Plane integration ---
  if (profile.guidanceControlPlane) {
    sections.push('## Guidance Control Plane');
    sections.push('');
    sections.push('This project uses `@claude-flow/guidance` to enforce these rules programmatically.');
    sections.push('The constitution (this section and above) is always loaded. Sections below are');
    sections.push('retrieved by intent classification — only relevant rules are injected per task.');
    sections.push('');
    sections.push('Gates enforce: destructive ops, secrets detection, diff size limits, tool allowlist.');
    sections.push('The optimizer watches violations and promotes winning CLAUDE.local.md experiments here.');
    sections.push('');
    if (profile.wasmKernel) {
      sections.push('WASM kernel: hot-path operations (hashing, secret scanning) use the Rust WASM kernel');
      sections.push('for 1.25-1.96x speedup. Falls back to JS automatically if WASM is unavailable.');
      sections.push('');
    }
  }

  // --- Swarm configuration ---
  if (profile.swarm) {
    sections.push('## Swarm Configuration');
    sections.push('');
    sections.push(`Topology: ${profile.swarm.topology || 'hierarchical'}`);
    sections.push(`Max agents: ${profile.swarm.maxAgents || 8}`);
    sections.push(`Strategy: ${profile.swarm.strategy || 'specialized'}`);
    sections.push('');
  }

  // --- Imports ---
  if (profile.imports && profile.imports.length > 0) {
    sections.push('## Individual Preferences');
    sections.push('');
    for (const imp of profile.imports) {
      sections.push(`@${imp}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

// ============================================================================
// CLAUDE.local.md Generator
// ============================================================================

export function generateClaudeLocalMd(local: LocalProfile): string {
  const sections: string[] = [];

  sections.push('# Local Development Notes');
  sections.push('');
  sections.push('> This file is auto-gitignored by Claude Code. It stays on this machine only.');
  sections.push('');

  if (local.developer) {
    sections.push(`Developer: ${local.developer}`);
    sections.push('');
  }

  // Local URLs
  if (local.localUrls && Object.keys(local.localUrls).length > 0) {
    sections.push('## Local URLs');
    sections.push('');
    for (const [name, url] of Object.entries(local.localUrls)) {
      sections.push(`- ${name}: ${url}`);
    }
    sections.push('');
  }

  // Databases
  if (local.databases && Object.keys(local.databases).length > 0) {
    sections.push('## Local Databases');
    sections.push('');
    for (const [name, conn] of Object.entries(local.databases)) {
      sections.push(`- ${name}: \`${conn}\``);
    }
    sections.push('');
  }

  // Environment
  if (local.envVars && Object.keys(local.envVars).length > 0) {
    sections.push('## Environment Variables');
    sections.push('');
    sections.push('```bash');
    for (const [key, val] of Object.entries(local.envVars)) {
      sections.push(`export ${key}="${val}"`);
    }
    sections.push('```');
    sections.push('');
  }

  // Preferences
  if (local.preferences && local.preferences.length > 0) {
    sections.push('## Preferences');
    sections.push('');
    for (const p of local.preferences) {
      sections.push(`- ${p}`);
    }
    sections.push('');
  }

  // Machine notes
  if (local.machineNotes && local.machineNotes.length > 0) {
    sections.push('## Machine Notes');
    sections.push('');
    if (local.os) {
      sections.push(`OS: ${local.os}`);
    }
    if (local.editor) {
      sections.push(`Editor: ${local.editor}`);
    }
    for (const note of local.machineNotes) {
      sections.push(`- ${note}`);
    }
    sections.push('');
  }

  // Debug
  if (local.debug && local.debug.length > 0) {
    sections.push('## Debug Settings');
    sections.push('');
    for (const d of local.debug) {
      sections.push(`- ${d}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

// ============================================================================
// Skills Generator
// ============================================================================

export function generateSkillMd(skill: SkillDefinition): string {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`name: ${skill.name}`);
  lines.push(`version: ${skill.version || '1.0.0'}`);
  lines.push(`description: ${skill.description}`);
  lines.push(`category: ${skill.category}`);
  if (skill.tags && skill.tags.length > 0) {
    lines.push(`tags: [${skill.tags.join(', ')}]`);
  }
  if (skill.requires && skill.requires.length > 0) {
    lines.push('requires:');
    for (const r of skill.requires) {
      lines.push(`  - ${r}`);
    }
  }
  if (skill.capabilities && skill.capabilities.length > 0) {
    lines.push('capabilities:');
    for (const c of skill.capabilities) {
      lines.push(`  - ${c}`);
    }
  }
  lines.push('---');
  lines.push('');

  // Skill title and instructions
  lines.push(`# ${formatTitle(skill.name)} Skill`);
  lines.push('');
  lines.push(skill.instructions);

  return lines.join('\n');
}

// ============================================================================
// Agent Definition Generator
// ============================================================================

export function generateAgentMd(agent: AgentDefinition): string {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`name: ${agent.name}`);
  lines.push(`type: ${agent.type}`);
  if (agent.color) {
    lines.push(`color: "${agent.color}"`);
  }
  lines.push(`description: ${agent.description}`);
  if (agent.capabilities && agent.capabilities.length > 0) {
    lines.push('capabilities:');
    for (const c of agent.capabilities) {
      lines.push(`  - ${c}`);
    }
  }
  if (agent.focus && agent.focus.length > 0) {
    lines.push('focus:');
    for (const f of agent.focus) {
      lines.push(`  - ${f}`);
    }
  }
  lines.push(`temperature: ${agent.temperature ?? 0.2}`);
  if (agent.priority) {
    lines.push(`priority: ${agent.priority}`);
  }
  if (agent.preHook || agent.postHook) {
    lines.push('hooks:');
    if (agent.preHook) {
      lines.push('  pre: |');
      lines.push(`    ${agent.preHook}`);
    }
    if (agent.postHook) {
      lines.push('  post: |');
      lines.push(`    ${agent.postHook}`);
    }
  }
  lines.push('---');
  lines.push('');

  // Agent title
  lines.push(`# ${formatTitle(agent.name)} Agent`);
  lines.push('');
  lines.push(agent.description);
  lines.push('');

  // System prompt
  if (agent.systemPrompt) {
    lines.push('## System Prompt');
    lines.push('');
    lines.push(agent.systemPrompt);
    lines.push('');
  }

  // Instructions
  if (agent.instructions) {
    lines.push('## Instructions');
    lines.push('');
    lines.push(agent.instructions);
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Agent Index Generator
// ============================================================================

export function generateAgentIndex(agents: AgentDefinition[]): string {
  const lines: string[] = [];
  lines.push('# Generated Agent Index');
  lines.push('');
  lines.push('agents:');
  for (const a of agents) {
    lines.push(`  - ${a.name}`);
  }
  lines.push('');

  // Group by type
  const byType = new Map<string, string[]>();
  for (const a of agents) {
    const list = byType.get(a.type) || [];
    list.push(a.name);
    byType.set(a.type, list);
  }

  lines.push('types:');
  for (const [type, names] of byType) {
    lines.push(`  ${type}:`);
    for (const n of names) {
      lines.push(`    - ${n}`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Scaffold Generator (creates full .claude/ directory structure)
// ============================================================================

export interface ScaffoldOptions {
  /** Project profile for CLAUDE.md */
  project: ProjectProfile;
  /** Local profile for CLAUDE.local.md (optional) */
  local?: LocalProfile;
  /** Skills to generate */
  skills?: SkillDefinition[];
  /** Agents to generate */
  agents?: AgentDefinition[];
  /** Include default agents based on project profile */
  includeDefaultAgents?: boolean;
  /** Include default skills based on project profile */
  includeDefaultSkills?: boolean;
}

export interface ScaffoldResult {
  /** Map of relative file path → content */
  files: Map<string, string>;
}

export function scaffold(options: ScaffoldOptions): ScaffoldResult {
  const files = new Map<string, string>();

  // CLAUDE.md
  files.set('CLAUDE.md', generateClaudeMd(options.project));

  // CLAUDE.local.md
  if (options.local) {
    files.set('CLAUDE.local.md', generateClaudeLocalMd(options.local));
  }

  // Default agents based on project
  const agents = [...(options.agents || [])];
  if (options.includeDefaultAgents) {
    agents.push(...getDefaultAgents(options.project));
  }

  // Default skills based on project
  const skills = [...(options.skills || [])];
  if (options.includeDefaultSkills) {
    skills.push(...getDefaultSkills(options.project));
  }

  // Generate agent files
  for (const agent of agents) {
    const category = agent.category || 'core';
    const path = `.claude/agents/${category}/${agent.name}.md`;
    files.set(path, generateAgentMd(agent));
  }

  // Generate agent index
  if (agents.length > 0) {
    files.set('.claude/agents/index.yaml', generateAgentIndex(agents));
  }

  // Generate skill files
  for (const skill of skills) {
    const path = `.claude/skills/${skill.name}/SKILL.md`;
    files.set(path, generateSkillMd(skill));
  }

  return { files };
}

// ============================================================================
// Helpers
// ============================================================================

function formatTitle(kebab: string): string {
  return kebab
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getLanguageInvariants(lang: string): string[] {
  const lower = lang.toLowerCase();
  const map: Record<string, string[]> = {
    typescript: [
      'No `any` types. Use `unknown` if the type is truly unknown.',
      'Prefer `const` over `let`. Never use `var`.',
      'All public functions and exported types require JSDoc.',
      'Use strict TypeScript (`strict: true` in tsconfig).',
    ],
    javascript: [
      'Prefer `const` over `let`. Never use `var`.',
      'Use strict mode (`"use strict"` or ES modules).',
    ],
    python: [
      'Follow PEP 8 style guide.',
      'Use type hints for all function signatures.',
      'Prefer f-strings over `.format()` or `%` formatting.',
    ],
    rust: [
      'Run `cargo clippy` before committing.',
      'No `unwrap()` in production code. Use `?` or proper error handling.',
      'All public items require doc comments (`///`).',
    ],
    go: [
      'Run `go vet` and `golangci-lint` before committing.',
      'Always handle errors. Never use `_` for error returns.',
      'Follow Effective Go conventions.',
    ],
    java: [
      'Follow Google Java Style Guide.',
      'All public classes and methods require Javadoc.',
      'Prefer immutable objects where possible.',
    ],
  };
  return map[lower] || [`Follow established ${lang} conventions.`];
}

function getFrameworkRules(framework: string): string[] {
  const lower = framework.toLowerCase();
  const map: Record<string, string[]> = {
    react: [
      'Prefer functional components with hooks over class components.',
      'Use `useMemo`/`useCallback` only when profiling shows a need.',
      'Keep components small and focused. Extract custom hooks for shared logic.',
    ],
    nextjs: [
      'Use the App Router unless there is a specific reason for Pages Router.',
      'Prefer Server Components by default. Add `"use client"` only when needed.',
      'Use `next/image` for all images.',
    ],
    express: [
      'Use async error handling middleware.',
      'Validate all request bodies with a schema validator (zod, joi, etc.).',
      'Never expose stack traces in production error responses.',
    ],
    fastify: [
      'Use JSON Schema for request/response validation.',
      'Register plugins in a consistent order.',
    ],
    django: [
      'Use class-based views for CRUD, function-based for custom logic.',
      'Always use the ORM. Never write raw SQL unless performance-critical.',
      'Run `manage.py check` before deploying.',
    ],
    flask: [
      'Use blueprints for modular organization.',
      'Never use `app.run()` in production.',
    ],
    prisma: [
      'Run `prisma generate` after schema changes.',
      'Never edit generated client code.',
      'Use transactions for multi-table operations.',
    ],
    vitest: [
      'Use `describe` blocks to group related tests.',
      'Prefer `expect().toBe()` for primitives, `expect().toEqual()` for objects.',
      'Use `beforeEach` for shared setup, not `beforeAll` (test isolation).',
    ],
    jest: [
      'Use `describe` blocks to group related tests.',
      'Prefer `expect().toBe()` for primitives, `expect().toEqual()` for objects.',
      'Mock external dependencies, never internal implementation details.',
    ],
  };
  return map[lower] || [];
}

function getDefaultAgents(profile: ProjectProfile): AgentDefinition[] {
  const agents: AgentDefinition[] = [];

  // Every project gets a coordinator and coder
  agents.push({
    name: 'coordinator',
    type: 'coordinator',
    description: `Coordinates multi-agent workflows for ${profile.name}`,
    category: 'core',
    color: '#4A90D9',
    capabilities: ['task-decomposition', 'agent-routing', 'context-management', 'progress-tracking'],
    temperature: 0.2,
    priority: 'high',
    instructions: [
      'Break complex tasks into subtasks and assign to specialized agents.',
      'Track progress across all active agents.',
      'Resolve conflicts when agents produce contradictory outputs.',
      'Ensure all subtasks align with the original goal.',
    ].join('\n'),
  });

  agents.push({
    name: 'coder',
    type: 'developer',
    description: `Implementation specialist for ${profile.name}`,
    category: 'core',
    color: '#FF6B35',
    capabilities: ['code-generation', 'refactoring', 'optimization', 'api-design', 'error-handling'],
    focus: profile.languages,
    temperature: 0.2,
    priority: 'high',
    instructions: [
      `Write clean, idiomatic ${profile.languages.join('/')} code.`,
      'Follow the coding standards defined in CLAUDE.md.',
      'Prefer editing existing files over creating new ones.',
      'Run tests after making changes.',
    ].join('\n'),
  });

  agents.push({
    name: 'tester',
    type: 'tester',
    description: `Test specialist for ${profile.name}`,
    category: 'core',
    color: '#2ECC71',
    capabilities: ['unit-testing', 'integration-testing', 'test-coverage', 'edge-cases'],
    temperature: 0.2,
    priority: 'high',
    instructions: [
      'Write tests that cover the happy path and meaningful edge cases.',
      'Use descriptive test names that explain the expected behavior.',
      'Keep tests isolated — no shared mutable state between tests.',
      `Run: \`${profile.testCommand || (profile.packageManager || 'npm') + ' test'}\``,
    ].join('\n'),
  });

  agents.push({
    name: 'reviewer',
    type: 'reviewer',
    description: `Code review specialist for ${profile.name}`,
    category: 'core',
    color: '#9B59B6',
    capabilities: ['code-review', 'quality-analysis', 'security-review', 'performance-review'],
    temperature: 0.3,
    priority: 'medium',
    instructions: [
      'Review for correctness, readability, and maintainability.',
      'Check for security issues: injection, XSS, hardcoded secrets.',
      'Flag unnecessary complexity and suggest simpler alternatives.',
      'Verify test coverage for changed code.',
    ].join('\n'),
  });

  // Security agent if guidance control plane is enabled
  if (profile.guidanceControlPlane) {
    agents.push({
      name: 'security-auditor',
      type: 'security-specialist',
      description: 'Security analysis integrated with guidance control plane',
      category: 'security',
      color: '#E74C3C',
      capabilities: ['threat-detection', 'secret-scanning', 'input-validation', 'dependency-audit'],
      temperature: 0.1,
      priority: 'high',
      instructions: [
        'Scan all code changes for secrets and credentials.',
        'Check for OWASP Top 10 vulnerabilities.',
        'Validate that enforcement gates are wired for all external inputs.',
        'Report findings through the guidance proof chain for audit trail.',
      ].join('\n'),
    });
  }

  return agents;
}

function getDefaultSkills(profile: ProjectProfile): SkillDefinition[] {
  const skills: SkillDefinition[] = [];

  // Build & test skill
  skills.push({
    name: 'build-and-test',
    description: `Build and test ${profile.name}`,
    category: 'core',
    tags: ['build', 'test', 'ci'],
    capabilities: ['Run build', 'Run tests', 'Fix build errors', 'Fix test failures'],
    instructions: [
      `## Build`,
      '',
      '```bash',
      profile.buildCommand || `${profile.packageManager || 'npm'} run build`,
      '```',
      '',
      '## Test',
      '',
      '```bash',
      profile.testCommand || `${profile.packageManager || 'npm'} test`,
      '```',
      '',
      '## Workflow',
      '',
      '1. Run the build first to catch type errors',
      '2. Run tests to verify correctness',
      '3. If either fails, fix the issue and re-run',
      '4. Never commit with failing tests or build errors',
    ].join('\n'),
  });

  // Code review skill
  skills.push({
    name: 'code-review',
    description: 'Review code for quality, security, and correctness',
    category: 'core',
    tags: ['review', 'quality', 'security'],
    capabilities: ['Security scanning', 'Quality analysis', 'Performance review', 'Style checking'],
    instructions: [
      '## Review Checklist',
      '',
      '1. **Correctness**: Does the code do what it claims?',
      '2. **Security**: Any secrets, injection vectors, or unsafe patterns?',
      '3. **Tests**: Are changes covered by tests?',
      '4. **Readability**: Can another developer understand this without context?',
      '5. **Performance**: Any obvious O(n^2) loops or unnecessary allocations?',
      '6. **Style**: Does it follow the project coding standards?',
    ].join('\n'),
  });

  // Guidance control plane skill
  if (profile.guidanceControlPlane) {
    skills.push({
      name: 'guidance-enforcement',
      description: 'Enforce guidance rules through the control plane',
      category: 'security',
      tags: ['guidance', 'enforcement', 'gates', 'policy'],
      requires: ['@claude-flow/plugins/guidance'],
      capabilities: [
        'Gate enforcement for commands, edits, and tool calls',
        'Proof chain generation for audit trails',
        'Memory write authorization',
        'Trust score tracking',
      ],
      instructions: [
        '## Guidance Control Plane',
        '',
        'This project uses `@claude-flow/guidance` to enforce CLAUDE.md rules programmatically.',
        '',
        '### Before executing commands:',
        '```typescript',
        "const results = plane.evaluateCommand('rm -rf /tmp/build');",
        "if (results.some(r => r.decision === 'deny')) { /* blocked */ }",
        '```',
        '',
        '### Before editing files:',
        '```typescript',
        "const results = plane.evaluateEdit('config.ts', content, lineCount);",
        '```',
        '',
        '### Track every run:',
        '```typescript',
        "const event = plane.startRun('task-id', 'feature');",
        '// ... work ...',
        'await plane.finalizeRun(event);',
        '```',
      ].join('\n'),
    });
  }

  return skills;
}
