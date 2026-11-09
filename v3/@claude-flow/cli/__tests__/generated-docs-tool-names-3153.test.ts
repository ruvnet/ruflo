/**
 * #3153 — the AGENTS.md (codex) and CLAUDE.md (init) templates told agents to
 * call MCP tools that are not registered (`task_orchestrate`, `benchmark_run`).
 * An agent following that guidance gets "tool not found".
 *
 * This renders every template of both generators, pulls out every backticked
 * snake_case tool-like name (bare `name` or call form `name(`), and checks it
 * against the CLI's live MCP registry (`listMCPTools()`), so a renamed or
 * removed tool fails here instead of in a user's session.
 */
import { describe, it, expect } from 'vitest';
import { listMCPTools } from '../src/mcp-client.js';
import { generateClaudeMd, CLAUDE_MD_TEMPLATES } from '../src/init/claudemd-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';
// Source import (not the published dist) so the test sees the code under change.
import { generateAgentsMd } from '../../codex/src/generators/agents-md.js';

const AGENTS_MD_TEMPLATES = ['minimal', 'default', 'full', 'enterprise'] as const;

/**
 * Backticked identifiers containing an underscore, either bare (`memory_store`)
 * or in call form (`memory_store({...})`). Hyphens are allowed on both sides
 * of the underscore because registered names include `hive-mind_init` and
 * `hooks_post-task`.
 */
const TOOL_NAME_RE = /`([a-z][a-z0-9-]*_[a-z0-9_-]*[a-z0-9])(?=`|\()/g;

function extractToolNames(markdown: string): string[] {
  const names = new Set<string>();
  for (const match of markdown.matchAll(TOOL_NAME_RE)) names.add(match[1]);
  return [...names].sort();
}

const registered = new Set(listMCPTools().map((tool) => tool.name));

describe('#3153 generated agent docs only name registered MCP tools', () => {
  it('the registry is populated (guards against a vacuous pass)', () => {
    expect(registered.size).toBeGreaterThan(50);
    expect(registered.has('performance_benchmark')).toBe(true);
    expect(registered.has('hooks_post-task')).toBe(true);
  });

  it('the extractor sees hyphenated and call-form names', () => {
    expect(extractToolNames('`hooks_post-task` and `memory_store({key})` but not `ABC_DEF`')).toEqual([
      'hooks_post-task',
      'memory_store',
    ]);
  });

  for (const template of AGENTS_MD_TEMPLATES) {
    it(`AGENTS.md "${template}" template names only registered tools`, async () => {
      const md = await generateAgentsMd({ projectName: 'demo', template });
      const names = extractToolNames(md);
      const unknown = names.filter((name) => !registered.has(name));
      expect(unknown).toEqual([]);
    });
  }

  for (const { name: template } of CLAUDE_MD_TEMPLATES) {
    it(`CLAUDE.md "${template}" template names only registered tools`, () => {
      const md = generateClaudeMd(DEFAULT_INIT_OPTIONS, template);
      const names = extractToolNames(md);
      expect(names.length).toBeGreaterThan(0);
      const unknown = names.filter((name) => !registered.has(name));
      expect(unknown).toEqual([]);
    });
  }
});
