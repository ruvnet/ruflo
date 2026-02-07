/**
 * Test migrations and validators
 */

import { parseClaudeMd, convertSkillSyntax, performFullMigration } from './src/migrations/index.js';
import { validateAgentsMd, validateSkillMd, validateConfigToml } from './src/validators/index.js';

const testContent = `# My Project

## Behavioral Rules

- Do what has been asked
- NEVER create files unless necessary

## Setup

\`\`\`bash
npm install && npm run build
\`\`\`

## Skills

Use /swarm-orchestration to coordinate agents.
Use /memory-management for storage.

## Security

- NEVER commit secrets
`;

async function test() {
  console.log('Testing parseClaudeMd...');
  const parsed = await parseClaudeMd(testContent);
  console.log('Title:', parsed.title);
  console.log('Sections:', parsed.sections.map(s => s.title));
  console.log('Skills:', parsed.skills.map(s => s.name));
  console.log('Custom Instructions:', parsed.customInstructions.slice(0, 2));

  console.log('\nTesting convertSkillSyntax...');
  const converted = convertSkillSyntax(testContent);
  console.log('Converted skills:', converted.includes('$swarm-orchestration') ? 'OK' : 'FAIL');

  console.log('\nTesting performFullMigration...');
  const migration = await performFullMigration(testContent);
  console.log('AGENTS.md generated:', migration.agentsMd.includes('## Setup') ? 'OK' : 'FAIL');
  console.log('config.toml generated:', migration.configToml.includes('approval_policy') ? 'OK' : 'FAIL');
  console.log('Skills to create:', migration.skillsToCreate);

  console.log('\nTesting validators...');
  const agentsResult = await validateAgentsMd('# Test Project\n' + testContent);
  console.log('AGENTS.md validation errors:', agentsResult.errors.length);
  console.log('AGENTS.md validation warnings:', agentsResult.warnings.length);

  const skillContent = `---
name: test-skill
description: A test skill
version: 1.0.0
---

## Purpose

This is a test skill.

## When to Trigger

- When testing
`;

  const skillResult = await validateSkillMd(skillContent);
  console.log('SKILL.md valid:', skillResult.valid);
  console.log('SKILL.md warnings:', skillResult.warnings.length);

  const configContent = `
model = "gpt-5.3-codex"
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[features]
child_agents_md = true

[mcp_servers.claude_flow]
command = "npx"
args = ["-y", "@claude-flow/cli@latest"]
enabled = true
`;

  const configResult = await validateConfigToml(configContent);
  console.log('config.toml valid:', configResult.valid);
  console.log('config.toml warnings:', configResult.warnings.length);

  console.log('\nAll tests passed!');
}

test().catch(console.error);
