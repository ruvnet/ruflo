import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function findArraySchemasMissingItems(source: string): number[] {
  const matches: number[] = [];
  const pattern = /type:\s*['\"]array['\"]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const typeIndex = match.index;

    const objectStart = source.lastIndexOf('{', typeIndex);
    if (objectStart === -1) {
      continue;
    }

    let depth = 0;
    let objectEnd = -1;
    for (let i = objectStart; i < source.length; i += 1) {
      const char = source[i];
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          objectEnd = i;
          break;
        }
      }
    }

    if (objectEnd !== -1) {
      const objectText = source.slice(objectStart, objectEnd + 1);
      if (!/\bitems\s*:/.test(objectText)) {
        const line = source.slice(0, typeIndex).split('\n').length;
        matches.push(line);
      }
    }
  }

  return matches;
}

describe('MCP schema array validation', () => {
  it('ensures every array schema defines items', () => {
    const mcpToolsDir = join(process.cwd(), 'src', 'mcp-tools');
    const files = readdirSync(mcpToolsDir).filter(file => file.endsWith('.ts'));
    const violations: string[] = [];

    for (const file of files) {
      const filePath = join(mcpToolsDir, file);
      const source = readFileSync(filePath, 'utf-8');
      const lines = findArraySchemasMissingItems(source);

      for (const line of lines) {
        violations.push(`src/mcp-tools/${file}:${line}`);
      }
    }

    expect(
      violations,
      `Array schemas missing items:\n${violations.join('\n')}`
    ).toEqual([]);
  });
});
