import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeTools } from '../src/mcp-tools/analyze-tools.js';
import { clearAllDiffCaches } from '../src/ruvector/diff-classifier.js';

const gitFixtures: Record<string, Record<string, string>> = {
  'base..bugfix': {
    '--numstat': '1\t1\tsrc/formatter.ts\n',
    '--name-status': 'M\tsrc/formatter.ts\n',
    '--no-ext-diff': [
      'diff --git a/src/formatter.ts b/src/formatter.ts',
      '--- a/src/formatter.ts',
      '+++ b/src/formatter.ts',
      '@@ -1 +1 @@',
      '-export const separator = ",";',
      '+export const separator = ";";',
      '',
    ].join('\n'),
    '-2': 'fix: correct the formatter separator\n',
  },
  'mixed-diff': {
    '--numstat': [
      '-\t-\tassets/logo.png',
      '2\t0\tdocs/guide.md',
      '3\t1\tsrc/auth/session.ts',
      '0\t7\tsrc/database/legacy.ts',
      '',
    ].join('\n'),
    '--name-status': [
      'A\tassets/logo.png',
      'A\tdocs/guide.md',
      'M\tsrc/auth/session.ts',
      'D\tsrc/database/legacy.ts',
      '',
    ].join('\n'),
  },
  'low-risk': {
    '--numstat': '2\t0\tdocs/guide.md\n',
    '--name-status': 'A\tdocs/guide.md\n',
  },
  'medium-risk': {
    '--numstat': '1\t1\tsrc/config/settings.ts\n',
    '--name-status': 'M\tsrc/config/settings.ts\n',
  },
  'high-risk': {
    '--numstat': '3\t1\tsrc/auth/session.ts\n',
    '--name-status': 'M\tsrc/auth/session.ts\n',
  },
  'critical-risk': {
    '--numstat': '0\t101\tsrc/auth/legacy.ts\n',
    '--name-status': 'D\tsrc/auth/legacy.ts\n',
  },
};

function gitOutput(command: string, args: string[]): string {
  const ref = args[args.length - 1];
  const output = gitFixtures[ref]?.[args[1]];
  if (command !== 'git' || output === undefined) {
    throw new Error(`Unexpected fixture command: ${command} ${args.join(' ')}`);
  }
  return output;
}

vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return {
    execFileSync: (command: string, args: string[]) => gitOutput(command, args),
    execFile: Object.assign(vi.fn(), {
      [promisify.custom]: async (command: string, args: string[]) => ({
        stdout: gitOutput(command, args),
        stderr: '',
      }),
    }),
  };
});

async function callTool(name: string, input: Record<string, unknown>) {
  const tool = analyzeTools.find(candidate => candidate.name === name);
  if (!tool) throw new Error(`Missing MCP tool: ${name}`);
  return tool.handler(input);
}

function expectAscendingScores(scores: number[]) {
  for (let i = 1; i < scores.length; i++) {
    expect(scores[i]).toBeGreaterThan(scores[i - 1]);
  }
}

describe('analyze MCP tools (#4761)', () => {
  beforeEach(() => clearAllDiffCaches());

  it('analyze_diff-classify classifies a one-commit bugfix', async () => {
    const ref = 'base..bugfix';
    expect(await callTool('analyze_diff-classify', { ref })).toMatchObject({
      ref,
      classification: { primary: 'bugfix' },
      files: 1,
    });
  });

  it('analyze_diff-reviewers suggests relevant roles and honors the limit', async () => {
    const ref = 'mixed-diff';
    const reviewers = ['security-team', 'dba', 'tech-lead', 'senior-developer'];
    expect(await callTool('analyze_diff-reviewers', { ref })).toEqual({
      ref,
      recommendedReviewers: reviewers,
      filesAnalyzed: 4,
    });
    expect(await callTool('analyze_diff-reviewers', { ref, limit: 2 })).toEqual({
      ref,
      recommendedReviewers: reviewers.slice(0, 2),
      filesAnalyzed: 4,
    });
  });

  it('analyze_diff-risk ranks low, medium, high, and critical diffs in order', async () => {
    const scores: number[] = [];
    for (const level of ['low', 'medium', 'high', 'critical']) {
      const ref = `${level}-risk`;
      const result = await callTool('analyze_diff-risk', { ref }) as { risk: { score: number } };
      expect(result).toMatchObject({ ref, risk: { overall: level, breakdown: { [level]: 1 } } });
      scores.push(result.risk.score);
    }
    expectAscendingScores(scores);
  });

  it('analyze_diff-stats counts text changes, file statuses, and binary files', async () => {
    const ref = 'mixed-diff';
    expect(await callTool('analyze_diff-stats', { ref })).toEqual({
      ref,
      totalFiles: 4,
      totalAdditions: 5,
      totalDeletions: 8,
      totalChanges: 13,
      byStatus: { added: 2, modified: 1, deleted: 1, renamed: 0 },
      binaryFiles: 1,
    });
  });

  it('analyze_file-risk ranks individual changes and explains the elevated risks', async () => {
    const changes = [
      { path: 'docs/guide.md', additions: 2, deletions: 0, status: 'added', risk: 'low', reasons: [] },
      { path: 'src/config/settings.ts', additions: 1, deletions: 1, status: 'modified', risk: 'medium',
        reasons: ['Configuration file'] },
      { path: 'src/auth/session.ts', additions: 3, deletions: 1, status: 'modified', risk: 'high',
        reasons: ['Security-sensitive file'] },
      { path: 'src/auth/legacy.ts', additions: 0, deletions: 101, status: 'deleted', risk: 'critical',
        reasons: ['Medium change size (>100 lines)', 'Security-sensitive file', 'File deleted'] },
    ];
    const scores: number[] = [];
    for (const { risk, reasons, ...input } of changes) {
      const result = await callTool('analyze_file-risk', input) as { score: number };
      expect(result).toMatchObject({ file: input.path, risk, reasons });
      scores.push(result.score);
    }
    expectAscendingScores(scores);
  });
});
