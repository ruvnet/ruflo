import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Existing debt outside #4721. The related command fixes (#4716–4723)
// can remove these entries; they do not exempt new files or flag names.
const existing: Record<string, string[]> = {
  'autopilot.ts': ['max-iterations', 'task-sources'],
  'guidance.ts': ['bundle-id', 'config-a', 'config-b', 'context-size', 'max-iterations', 'max-shards', 'mod-projection', 'target-score', 'work-dir'],
  'hooks.ts': ['auto-dispatch', 'critical-only', 'group-by-agent', 'min-confidence', 'no-ruvector', 'prefer-cost', 'prefer-quality'],
  'neural.ts': ['batch-size', 'cold-threshold', 'learning-rate', 'quality-bar', 'strip-pii', 'val-split'],
  'process.ts': ['log-file', 'pid-file'],
  'ruvector/backup.ts': ['include-indexes'],
  'ruvector/benchmark.ts': ['batch-size'],
  'ruvector/import.ts': ['batch-size', 'from-memory'],
  'ruvector/init.ts': ['index-type'],
  'task.ts': ['reset-state'],
  'tui.ts': ['convo-targets', 'max-spend-usd'],
};

function invalidReads(text: string): string[] {
  const file = ts.createSourceFile('command.ts', text, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)
      && node.argumentExpression.text.includes('-') && /(?:^|\.)flags$/.test(node.expression.getText(file))) {
      const key = node.argumentExpression.text;
      let expression: ts.Node = node;
      while (expression.parent && !ts.isStatement(expression.parent)) expression = expression.parent;
      const normalized = (key.startsWith('no-') ? key.slice(3) : key)
        .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      // --no-foo is represented by flags.foo === false.
      const fallback = new RegExp(`flags\\.${normalized}\\b|flags\\[["']${normalized}["']\\]`);
      if (!fallback.test(expression.getText(file))) violations.push(key);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return violations;
}

describe('command flag key lint', () => {
  it('rejects new kebab-only reads and accepts normalized fallbacks', () => {
    expect(invalidReads("const value = ctx.flags['new-flag'];")).toEqual(['new-flag']);
    expect(invalidReads('const value = flags["new-flag"];')).toEqual(['new-flag']);
    expect(invalidReads("const value = ctx.flags.newFlag ?? ctx.flags['new-flag'];")).toEqual([]);
    expect(invalidReads("const value = flags['no-distill'] === true || flags.distill === false;")).toEqual([]);
    expect(invalidReads("// ctx.flags['not-a-read']")).toEqual([]);
  });

  it('has no new kebab-only reads under src/commands', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../src/commands');
    const violations: string[] = [];
    function scan(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name);
        if (entry.isDirectory()) scan(file);
        else if (entry.name.endsWith('.ts')) {
          const name = relative(root, file).replaceAll('\\', '/');
          for (const key of invalidReads(readFileSync(file, 'utf8'))) {
            if (!existing[name]?.includes(key)) violations.push(`${name}: ${key}`);
          }
        }
      }
    }
    scan(root);
    expect(violations).toEqual([]);
  });
});
