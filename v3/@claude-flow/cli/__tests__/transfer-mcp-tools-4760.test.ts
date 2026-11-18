import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transferTools } from '../src/mcp-tools/transfer-tools.js';
import type { MCPToolResult } from '../src/mcp-tools/types.js';
import type { PatternEntry, PatternRegistry } from '../src/transfer/store/types.js';

// Exercise the downloader through checksum verification without touching the checkout's cache.
vi.mock('fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('fs')>(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Discovery can fall back to the GCS SDK, which does not use the fetch stub.
vi.mock('../src/transfer/storage/gcs.js', () => ({
  hasGCSCredentials: () => false,
}));

const registryCid = 'bafy-registry-fixture';
const artifact = JSON.stringify({ magic: 'CFP1', metadata: { name: 'fast-routing' } });
const timestamp = '2026-01-01T00:00:00.000Z';
const author = {
  id: 'fixture-author',
  displayName: 'Fixture author',
  verified: true,
  patterns: 3,
  totalDownloads: 60,
};
const fast: PatternEntry = {
  id: 'fast-routing',
  name: 'fast-routing',
  displayName: 'Fast routing',
  description: 'Route tasks by complexity',
  version: '1.0.0',
  cid: 'bafy-artifact-fixture',
  size: Buffer.byteLength(artifact),
  checksum: createHash('sha256').update(artifact).digest('hex'),
  author,
  license: 'MIT',
  categories: ['routing'],
  tags: ['routing'],
  downloads: 20,
  rating: 5,
  ratingCount: 2,
  lastUpdated: timestamp,
  createdAt: timestamp,
  minClaudeFlowVersion: '3.0.0',
  verified: true,
  trustLevel: 'verified',
};
const simple: PatternEntry = {
  ...fast,
  id: 'simple-routing',
  name: 'simple-routing',
  displayName: 'Simple routing',
  downloads: 10,
};
const unverified: PatternEntry = {
  ...fast,
  id: 'unverified-routing',
  name: 'unverified-routing',
  displayName: 'Unverified routing',
  downloads: 30,
  verified: false,
  trustLevel: 'unverified',
};
const registry: PatternRegistry = {
  version: '1.0.0',
  updatedAt: timestamp,
  ipnsName: 'fixture-registry',
  patterns: [simple, fast, unverified],
  categories: [{ id: 'routing', name: 'Routing', description: 'Routing patterns', patternCount: 3 }],
  authors: [author],
  totalPatterns: 3,
  totalDownloads: 60,
  totalAuthors: 1,
  featured: [fast.id, simple.id],
  trending: [simple.id, fast.id],
  newest: [],
};

const fetchMock = vi.fn<typeof fetch>();

async function runTool(name: string, input: Record<string, unknown>) {
  const tool = transferTools.find((candidate) => candidate.name === `transfer_${name}`);
  if (!tool) throw new Error(`Missing transfer tool: ${name}`);

  const result = await tool.handler(input) as MCPToolResult;
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe('text');
  return { isError: result.isError, data: JSON.parse(result.content[0].text!) };
}

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async (url) => {
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('transfer_detect-pii', () => {
  it('reports both email addresses and their locations', async () => {
    const emails = ['a@example.test', 'b@example.test'];
    expect(await runTool('detect-pii', { content: `Contact ${emails.join(' or ')}.` })).toEqual({
      isError: false,
      data: {
        found: true,
        count: 2,
        types: { email: 2 },
        locations: emails.map((sample) => ({ type: 'email', path: 'content', sample, severity: 'high' })),
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns no detections for clean text', async () => {
    expect(await runTool('detect-pii', { content: 'The build finished successfully.' })).toEqual({
      isError: false,
      data: { found: false, count: 0, types: {}, locations: [] },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // "SSN: 555-12-3456" currently returns found: false and count: 0.
  it.todo('detects a synthetic SSN once the detector has an SSN rule');
});

describe('transfer_ipfs-resolve', () => {
  const name = 'patterns.example.test';

  it('resolves a DNSLink response to a CID', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ Path: `/ipfs/${registryCid}` }));

    expect(await runTool('ipfs-resolve', { name })).toEqual({
      isError: false,
      data: { success: true, cid: registryCid },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v0/name/resolve?arg=/ipns/${name}`),
      expect.any(Object),
    );
  });

  it('returns a null CID when no gateway resolves the name', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 404 }));

    expect(await runTool('ipfs-resolve', { name })).toEqual({
      isError: false,
      data: { success: true, cid: null },
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('rejects a missing name before contacting a gateway', async () => {
    expect(await runTool('ipfs-resolve', {})).toEqual({
      isError: true,
      data: { error: 'name must be a non-empty string' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('transfer_store-*', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (input, init) => {
      const { pathname, searchParams } = new URL(String(input));
      if (init?.method === 'POST' && pathname === '/api/v0/name/resolve' && searchParams.get('arg')) {
        return Response.json({ Path: `/ipfs/${registryCid}` });
      }
      if (pathname === `/ipfs/${registryCid}`) return Response.json(registry);
      if (pathname === `/ipfs/${fast.cid}`) return new Response(artifact);
      throw new Error(`Unexpected fetch: ${input}`);
    });
  });

  it('searches the registry and paginates the verified matches', async () => {
    const query = { query: 'routing', category: 'routing', minRating: 4, verified: true, limit: 1 };
    expect(await runTool('store-search', query)).toEqual({
      isError: false,
      data: { patterns: [fast], total: 2, page: 1, pageSize: 1, hasMore: true, query },
    });
  });

  it('returns registry details for a known ID', async () => {
    expect(await runTool('store-info', { id: simple.id })).toEqual({ isError: false, data: simple });
  });

  it('returns an MCP error for an unknown ID', async () => {
    expect(await runTool('store-info', { id: 'missing-pattern' })).toEqual({
      isError: true,
      data: { error: 'Pattern not found' },
    });
  });

  it.each([true, false])('downloads the artifact with verify=%s', async (verify) => {
    const outputPath = resolve('.claude-flow/patterns/cache', `${fast.name}-${fast.version}.cfp.json`);
    expect(await runTool('store-download', { id: fast.id, verify })).toEqual({
      isError: false,
      data: { success: true, pattern: fast, outputPath, imported: false, verified: verify, size: fast.size },
    });
    expect(writeFileSync).toHaveBeenCalledExactlyOnceWith(outputPath, Buffer.from(artifact));
  });

  it('does not download an unknown pattern', async () => {
    expect(await runTool('store-download', { id: 'missing-pattern' })).toEqual({
      isError: true,
      data: { error: 'Pattern not found: missing-pattern' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // IPNS lookup and registry fetch only
    expect(mkdirSync).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it.each([
    ['store-featured', fast],
    ['store-trending', simple],
  ])('%s respects the registry order and requested limit', async (name, first) => {
    expect(await runTool(name, { limit: 1 })).toEqual({ isError: false, data: [first] });
  });
});
