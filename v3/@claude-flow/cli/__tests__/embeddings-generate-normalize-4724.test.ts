/**
 * #4724: embeddings_generate accepted `normalize` and then ignored it, so
 * `normalize: false` still came back with norm 1. The flag has to reach the
 * generator: false returns the pre-L2 vector, and the default stays unit length
 * and points the same way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const fail = () => {
  throw new Error('unavailable in test');
};

function l2(v: number[]): number {
  return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
}

describe('#4724 embeddings_generate normalize', () => {
  const prevBridge = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  let originalCwd: string;
  let workdir: string;

  beforeEach(async () => {
    process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
    vi.resetModules();
    vi.doMock('@huggingface/transformers', fail);
    vi.doMock('@xenova/transformers', fail);
    vi.doMock('ruvector', fail);
    vi.doMock('agentic-flow', fail);
    vi.doMock('agentic-flow/reasoningbank', fail);

    originalCwd = process.cwd();
    workdir = mkdtempSync(join(tmpdir(), 'ruflo-emb-norm-4724-'));
    process.chdir(workdir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workdir, { recursive: true, force: true });
    vi.resetModules();
    vi.doUnmock('@huggingface/transformers');
    vi.doUnmock('@xenova/transformers');
    vi.doUnmock('ruvector');
    vi.doUnmock('agentic-flow');
    vi.doUnmock('agentic-flow/reasoningbank');
    if (prevBridge === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
    else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = prevBridge;
  });

  it('returns a non-unit vector when normalize is false and a unit vector by default', async () => {
    const { embeddingsTools } = await import('../src/mcp-tools/embeddings-tools.js');
    const init = embeddingsTools.find(tool => tool.name === 'embeddings_init')!;
    const generate = embeddingsTools.find(tool => tool.name === 'embeddings_generate')!;
    await init.handler({ force: true });

    const raw = await generate.handler({ text: 'hello world', normalize: false }) as {
      success: boolean;
      embedding: number[];
      metadata: { norm: number };
    };
    const unit = await generate.handler({ text: 'hello world' }) as {
      success: boolean;
      embedding: number[];
      metadata: { norm: number };
    };
    const explicit = await generate.handler({ text: 'hello world', normalize: true }) as {
      success: boolean;
      embedding: number[];
      metadata: { norm: number };
    };

    expect(raw.success).toBe(true);
    expect(unit.success).toBe(true);
    expect(explicit.success).toBe(true);

    expect(Math.abs(raw.metadata.norm - 1)).toBeGreaterThan(1e-3);
    expect(Math.abs(l2(raw.embedding) - 1)).toBeGreaterThan(1e-3);
    expect(unit.metadata.norm).toBeCloseTo(1, 5);
    expect(l2(unit.embedding)).toBeCloseTo(1, 5);
    expect(explicit.metadata.norm).toBeCloseTo(1, 5);
    expect(l2(explicit.embedding)).toBeCloseTo(1, 5);

    const dot = raw.embedding.reduce((sum, x, i) => sum + x * unit.embedding[i], 0);
    const cosine = dot / (l2(raw.embedding) * l2(unit.embedding));
    expect(cosine).toBeCloseTo(1, 5);
    expect(explicit.embedding).toEqual(unit.embedding);
  });
});
