/**
 * federation_bbs_watch paging: a watcher that resumes after sinceEnvelopeId
 * must get the envelopes right after it, so that passing the last returned id
 * walks the whole room when hasMore is set. Returning the newest `limit`
 * envelopes instead skips everything between the cursor and that window.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The watch handler only checks that the agentbbs CLI answers `--version`;
// node does, so these tests run without the optional dependency installed.
process.env.AGENTBBS_BIN = process.execPath;

const { agentbbsTools } = await import('../src/mcp-tools/agentbbs-tools.js');

const watch = agentbbsTools.find(t => t.name === 'federation_bbs_watch')!;
const roomId = 'sales-12345678';

describe('federation_bbs_watch paging', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bbs-watch-paging-'));
    const lines = Array.from({ length: 10 }, (_, i) => JSON.stringify({
      envelopeId: `env-${i + 1}`, roomId, seq: i + 1, msgType: 'task-result', payload: { n: i + 1 },
    }));
    writeFileSync(join(dir, `room-${roomId}.jsonl`), lines.join('\n') + '\n');
  });

  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('without a cursor returns the most recent window', async () => {
    const r: any = await watch.handler({ basePath: dir, roomId, limit: 3 });
    expect(r.envelopes.map((e: any) => e.seq)).toEqual([8, 9, 10]);
    expect(r.hasMore).toBe(true);
  });

  it('after sinceEnvelopeId returns the envelopes that follow it, oldest first', async () => {
    const r: any = await watch.handler({ basePath: dir, roomId, sinceEnvelopeId: 'env-2', limit: 3 });
    expect(r.envelopes.map((e: any) => e.seq)).toEqual([3, 4, 5]);
    expect(r.hasMore).toBe(true);
  });

  it('paging with the last returned id visits every envelope once', async () => {
    const seen: number[] = [];
    let since = 'env-1';
    for (;;) {
      const r: any = await watch.handler({ basePath: dir, roomId, sinceEnvelopeId: since, limit: 4 });
      seen.push(...r.envelopes.map((e: any) => e.seq));
      if (!r.hasMore) break;
      since = r.envelopes[r.envelopes.length - 1].envelopeId;
    }
    expect(seen).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
