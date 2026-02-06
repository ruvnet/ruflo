import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

const sourcePath = new URL('../src/memory/memory-initializer.ts', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf-8');

function getFunctionBlock(functionName: string): string {
  const startToken = `export async function ${functionName}`;
  const start = source.indexOf(startToken);
  if (start === -1) return '';

  // Find next exported async function or end of file.
  const nextExport = source.indexOf('\nexport async function ', start + startToken.length);
  const end = nextExport === -1 ? source.length : nextExport;
  return source.slice(start, end);
}

describe('memory-initializer SQL injection hardening', () => {
  it('should remove SQL string interpolation patterns for key/namespace and limit/offset', () => {
    expect(source).not.toContain("namespace.replace(/'/g, \"''\")");
    expect(source).not.toContain("key.replace(/'/g, \"''\")");
    expect(source).not.toContain('LIMIT ${');
    expect(source).not.toContain('OFFSET ${');
  });

  it('should use prepared statements in all vulnerable functions', () => {
    const searchBlock = getFunctionBlock('searchEntries');
    const listBlock = getFunctionBlock('listEntries');
    const getBlock = getFunctionBlock('getEntry');
    const deleteBlock = getFunctionBlock('deleteEntry');

    expect(searchBlock).toContain('db.prepare(');
    expect(searchBlock).toContain('.bind(');

    expect(listBlock).toContain('db.prepare(');
    expect(listBlock).toContain('.bind(');

    expect(getBlock).toContain('db.prepare(');
    expect(getBlock).toContain('.bind(');
    expect(getBlock).toContain('updateStmt.run([');

    expect(deleteBlock).toContain('db.prepare(');
    expect(deleteBlock).toContain('.bind(');
    expect(deleteBlock).toContain('deleteStmt.run([');
  });

  it('should sanitize SQL errors before returning them to callers', () => {
    expect(source).toContain('function sanitizeMemoryError(');
    expect(source).toContain("sanitizeMemoryError(error, 'Failed to search memory entries')");
    expect(source).toContain("sanitizeMemoryError(error, 'Failed to list memory entries')");
    expect(source).toContain("sanitizeMemoryError(error, 'Failed to retrieve memory entry')");
    expect(source).toContain("sanitizeMemoryError(error, 'Failed to delete memory entry')");
  });
});
