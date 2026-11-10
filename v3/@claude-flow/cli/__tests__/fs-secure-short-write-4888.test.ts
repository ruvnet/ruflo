/**
 * #4888: writeFileAtomic called writeSync once and ignored the returned byte
 * count, then fsynced and renamed. A short write (fewer bytes than asked,
 * which POSIX allows) published a truncated file and reported success.
 *
 * writeSync is mocked so each test can cap how many bytes one call writes, or
 * throw after a partial write. Every other node:fs function is the real one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const state = vi.hoisted(() => ({
  maxBytesPerCall: Infinity,
  failAfterCalls: -1, // throw ENOSPC on this call index (0-based); -1 = never
  calls: 0,
}));

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const writeSync = (
    fd: number,
    buf: Buffer,
    offset: number,
    length: number,
    position: number | null,
  ): number => {
    const call = state.calls++;
    if (state.failAfterCalls >= 0 && call >= state.failAfterCalls) {
      const err = new Error('ENOSPC: no space left on device, write') as NodeJS.ErrnoException;
      err.code = 'ENOSPC';
      throw err;
    }
    const capped = Math.min(length, state.maxBytesPerCall);
    return (fs.writeSync as any)(fd, buf, offset, capped, position);
  };
  return { ...fs, default: { ...fs, writeSync }, writeSync };
});

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic } from '../src/fs-secure.js';

describe('writeFileAtomic short writes (#4888)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fs-secure-4888-'));
    state.maxBytesPerCall = Infinity;
    state.failAfterCalls = -1;
    state.calls = 0;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes every byte when each writeSync call writes only 2 bytes', () => {
    const path = join(dir, 'db.bin');
    const data = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz-short-write');
    state.maxBytesPerCall = 2;

    writeFileAtomic(path, data);

    expect(readFileSync(path).equals(data)).toBe(true);
    expect(state.calls).toBe(Math.ceil(data.length / 2));
    expect(readdirSync(dir)).toEqual(['db.bin']);
  });

  it('handles an odd-length payload with a capped writer', () => {
    const path = join(dir, 'odd.bin');
    const data = Buffer.alloc(4097, 0xab);
    state.maxBytesPerCall = 2;

    writeFileAtomic(path, data);

    expect(readFileSync(path).equals(data)).toBe(true);
  });

  it('leaves the original intact and removes the temp file when ENOSPC follows a partial write', () => {
    const path = join(dir, 'db.bin');
    const original = Buffer.from('ORIGINAL-COMPLETE-IMAGE');
    writeFileSync(path, original);

    state.maxBytesPerCall = 2;
    state.failAfterCalls = 3; // three 2-byte writes succeed, the fourth throws

    expect(() => writeFileAtomic(path, Buffer.from('replacement image that never lands'))).toThrow(
      /ENOSPC/,
    );

    expect(readFileSync(path).equals(original)).toBe(true);
    expect(readdirSync(dir)).toEqual(['db.bin']);
  });

  it('writes an empty file for zero-length data without calling writeSync', () => {
    const path = join(dir, 'empty.bin');

    writeFileAtomic(path, Buffer.alloc(0));

    expect(readFileSync(path).length).toBe(0);
    expect(state.calls).toBe(0);
  });

  it('makes exactly one writeSync call when the first write is complete', () => {
    const path = join(dir, 'full.bin');
    const data = Buffer.from('a full write in one call');

    writeFileAtomic(path, data);

    expect(readFileSync(path).equals(data)).toBe(true);
    expect(state.calls).toBe(1);
  });
});
