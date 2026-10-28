import { beforeAll, describe, expect, it } from 'vitest';
import {
  evaluateAgainstBaseline,
  extractInvocations,
  findUnknown,
  findUnknownRefs,
  loadCommandTree,
  readBaseline,
  resolveCommand,
  shippedSkillFiles,
} from '../audit-skill-cli-commands.mjs';

const fakeTree = new Map([
  ['hooks', { aliases: [], subcommands: new Map([['pre-edit', []], ['session-end', []]]), loadError: null }],
  ['performance', { aliases: ['perf'], subcommands: new Map([['benchmark', []]]), loadError: null }],
  ['version', { aliases: [], subcommands: new Map(), loadError: null }],
]);

describe('skill ↔ CLI command reference audit', () => {
  it('extracts npx invocations anywhere, with an optional subcommand', () => {
    const text = [
      'Run `npx @claude-flow/cli@latest hooks pre-edit --file a.js` first.',
      'npx -y ruflo@latest perf benchmark',
      'npx claude-flow@alpha version',
    ].join('\n');
    expect(extractInvocations(text)).toEqual([
      { command: 'hooks', subcommand: 'pre-edit', line: 1 },
      { command: 'perf', subcommand: 'benchmark', line: 2 },
      { command: 'version', subcommand: null, line: 3 },
    ]);
  });

  it('counts bare ruflo/claude-flow commands only at the start of a fenced code line', () => {
    const text = [
      'ruflo is a harness and claude-flow runs swarms.',
      '```bash',
      '$ ruflo hooks session-end',
      'claude-flow hook pre-task',
      '```',
      'ruflo hook outside a fence',
    ].join('\n');
    expect(extractInvocations(text)).toEqual([
      { command: 'hooks', subcommand: 'session-end', line: 3 },
      { command: 'hook', subcommand: 'pre-task', line: 4 },
    ]);
  });

  it('stops at flags and quoted arguments', () => {
    expect(extractInvocations('npx ruflo@latest hooks --list')).toEqual([{ command: 'hooks', subcommand: null, line: 1 }]);
    expect(extractInvocations('npx ruflo@latest hooks "pre-edit"')).toEqual([{ command: 'hooks', subcommand: null, line: 1 }]);
  });

  it('resolves aliases and flags unknown commands and subcommands', () => {
    expect(resolveCommand(fakeTree, 'perf')).toBe('performance');
    const unknown = findUnknown(fakeTree, 'skills/x/SKILL.md', [
      { command: 'hook', subcommand: 'pre-edit', line: 1 },
      { command: 'hooks', subcommand: 'pre-search', line: 2 },
      { command: 'hooks', subcommand: 'pre-edit', line: 3 },
      { command: 'perf', subcommand: 'benchmark', line: 4 },
      { command: 'version', subcommand: 'extra', line: 5 },
    ]);
    expect(unknown.map((u) => u.key)).toEqual([
      'skills/x/SKILL.md::hook',
      'skills/x/SKILL.md::hooks pre-search',
    ]);
  });

  it('only checks the name of a command whose subcommands could not be loaded', () => {
    const tree = new Map([['memory', { aliases: [], subcommands: null, loadError: 'boom' }]]);
    expect(findUnknown(tree, 'f', [{ command: 'memory', subcommand: 'anything', line: 1 }])).toEqual([]);
  });

  it('fails a new entry even when the total count is unchanged, and reports fixed ones', () => {
    const result = evaluateAgainstBaseline([{ key: 'f::new' }], ['f::old']);
    expect(result.ok).toBe(false);
    expect(result.unexpected).toEqual(['f::new']);
    expect(result.fixed).toEqual(['f::old']);
    expect(evaluateAgainstBaseline([{ key: 'f::old' }], ['f::old']).ok).toBe(true);
  });

});

describe('skill ↔ CLI command references in this repo', () => {
  let tree;
  // Importing every command module takes a few seconds on a cold transform cache.
  beforeAll(async () => {
    tree = await loadCommandTree();
  }, 120_000);

  it('loads the real command tree from the CLI sources', () => {
    expect(tree.get('hooks')?.subcommands?.has('pre-edit')).toBe(true);
    expect(tree.get('analyze')?.subcommands?.has('diff')).toBe(true);
    expect(resolveCommand(tree, 'perf')).toBe('performance');
    expect(resolveCommand(tree, 'hook')).toBe(null);
  });

  it('has no unknown CLI references beyond verification/skill-cli-command-baseline.json', () => {
    expect(shippedSkillFiles().length).toBeGreaterThan(0);
    const result = evaluateAgainstBaseline(findUnknownRefs(tree), readBaseline());
    expect(result.unexpected).toEqual([]);
  });
});
