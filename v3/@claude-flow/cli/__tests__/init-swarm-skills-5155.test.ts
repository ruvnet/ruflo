import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registeredToolNames, skillToolRefs } from '../../../../scripts/audit-skill-mcp-tools.mjs';
import { extractInvocations, findUnknown, loadCommandTree } from '../../../../scripts/audit-skill-cli-commands.mjs';

const SKILLS_ROOT = join(fileURLToPath(new URL('..', import.meta.url)), '.claude', 'skills');
const ADVANCED_SKILL = join(SKILLS_ROOT, 'swarm-advanced', 'SKILL.md');
const ORCHESTRATION_SKILL = join(SKILLS_ROOT, 'swarm-orchestration', 'SKILL.md');

function readSkill(file: string): string {
  expect(existsSync(file)).toBe(true);
  const text = readFileSync(file, 'utf8');
  expect(text.length).toBeGreaterThan(0);
  return text;
}

describe('init-installed swarm skills use shipped interfaces (#5155)', () => {
  it('does not mention the removed MCP tools or agentic-flow hooks', () => {
    const advanced = readSkill(ADVANCED_SKILL);
    const orchestration = readSkill(ORCHESTRATION_SKILL);
    const skills = `${advanced}\n${orchestration}`;

    for (const tool of ['task_orchestrate', 'swarm_monitor', 'task_results', 'swarm_scale']) {
      expect(skills).not.toContain(tool);
    }
    expect(skills).not.toContain('agentic-flow hooks');
  });

  it('uses registered MCP replacements in swarm-advanced', () => {
    const refs = skillToolRefs(readSkill(ADVANCED_SKILL));
    expect(refs.length).toBeGreaterThan(0);

    const registered = registeredToolNames();
    for (const tool of ['task_create', 'swarm_status', 'task_status', 'agent_spawn']) {
      expect(refs.some((ref) => ref.tool === tool)).toBe(true);
      expect(registered.has(tool)).toBe(true);
    }
  });

  it('uses real ruflo CLI commands in swarm-orchestration', async () => {
    const invocations = extractInvocations(readSkill(ORCHESTRATION_SKILL));
    expect(invocations.length).toBeGreaterThan(0);

    const tree = await loadCommandTree();
    expect(findUnknown(tree, ORCHESTRATION_SKILL, invocations)).toEqual([]);
  }, 120_000);
});
