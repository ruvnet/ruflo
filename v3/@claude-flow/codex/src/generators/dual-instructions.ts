/**
 * @claude-flow/codex - dual-host instruction files (#2638)
 *
 * In a project set up for both Claude Code and Codex, AGENTS.md is the single
 * source: the shared sections (shared-instructions.ts) plus the Codex-only
 * ones. Claude Code reads it through the `@AGENTS.md` import in CLAUDE.md, so
 * CLAUDE.md carries only Claude-specific notes and repeats nothing.
 *
 * Single-host AGENTS.md (generateAgentsMd) is untouched by this module.
 */

import type { AgentsMdOptions } from '../types.js';
import { BUILT_IN_SKILLS } from '../templates/index.js';
import { concurrentRufloWorkflow } from './agents-md.js';
import { AGENTS_MD_IMPORT, generateSharedInstructions } from './shared-instructions.js';

const DEFAULT_SKILLS = ['swarm-orchestration', 'memory-management', 'sparc-methodology', 'security-audit'];

function codexOnlySections(options: AgentsMdOptions): string[] {
  const {
    description = 'A Claude Flow powered project',
    techStack = 'TypeScript, Node.js',
    buildCommand = 'npm run build',
    testCommand = 'npm test',
    devCommand = 'npm run dev',
    skills = DEFAULT_SKILLS,
  } = options;

  const skillsTable = skills
    .map((skill) => {
      const info = BUILT_IN_SKILLS[skill as keyof typeof BUILT_IN_SKILLS];
      return info ? `| \`$${skill}\` | ${info.description} |` : `| \`$${skill}\` | Custom skill |`;
    })
    .join('\n');

  return [
    `## Project Overview

${description}

**Tech Stack**: ${techStack}
**Architecture**: Domain-Driven Design with bounded contexts`,
    `## Quick Start

\`\`\`bash
npm install
${buildCommand}
${testCommand}
${devCommand}
\`\`\``,
    `## Codex Execution Model

- **claude-flow** = LEDGER (coordinates: memory, routing, swarm state)
- **Codex** = EXECUTOR (writes code, runs tests, creates files)

**Critical rule:** DON'T STOP after calling claude-flow commands. Coordination commands return instantly — continue immediately with the next implementation step.`,
    concurrentRufloWorkflow().trimEnd(),
    `## Codex Skills

Use \`$skill-name\` syntax to invoke (Claude Code uses \`/skill-name\` for the same skills):

| Skill | Use Case |
|-------|----------|
${skillsTable}`,
    `## Commit Messages

\`\`\`
<type>(<scope>): <description>

[optional body]
\`\`\`

Types: \`feat\`, \`fix\`, \`docs\`, \`style\`, \`refactor\`, \`perf\`, \`test\`, \`chore\`

Do not add a \`Co-Authored-By\` trailer unless the repository explicitly
configures and authorizes that attribution.`,
    `## Path Security

- Validate all file paths
- Prevent directory traversal (../)
- Use absolute paths internally`,
    `## Links

- Documentation: https://github.com/ruvnet/ruflo
- Issues: https://github.com/ruvnet/ruflo/issues`,
  ];
}

/** AGENTS.md for a dual project: shared sections once, then Codex-only sections. */
export function generateDualAgentsMd(options: AgentsMdOptions): string {
  const header = `# ${options.projectName}

> Shared instructions for Claude Code and OpenAI Codex. Codex reads this file
> directly; Claude Code reads it through the \`${AGENTS_MD_IMPORT}\` import in CLAUDE.md.
> Shared sections come first; the Codex-only sections follow.`;
  return `${[header, ...generateSharedInstructions(), ...codexOnlySections(options)].join('\n\n')}\n`;
}

/**
 * CLAUDE.md for a dual project created by the Codex initializer: the import
 * plus Claude Code notes only. (`ruflo init --dual` writes a richer Claude
 * overlay itself; this initializer then leaves that file alone.)
 */
export function generateDualClaudeMdStub(projectName: string, skills: string[]): string {
  return `# ${projectName}

${AGENTS_MD_IMPORT}

> Project instructions live in \`AGENTS.md\`, imported above; OpenAI Codex reads the same
> file. Edit shared rules there. This file holds only Claude Code notes.

## Claude Code

- Skills in \`.agents/skills/\` are invoked as \`/skill-name\` here and \`$skill-name\` in Codex
${skills.map((s) => `  - \`/${s}\``).join('\n')}
- Local overrides: \`CLAUDE.local.md\` (gitignored)
`;
}
