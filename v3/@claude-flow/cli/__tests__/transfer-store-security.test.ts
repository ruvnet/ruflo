/**
 * #4750 — pattern-store download hardening: trusted signature verification,
 * path-traversal prevention, and download size/timeout limits.
 *
 * Network is stubbed via globalThis.fetch so the tests are hermetic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ed from '@noble/ed25519';
import { PatternDownloader } from '../src/transfer/store/download.js';
import { sanitizeName, assertInside } from '../src/transfer/store/security.js';
import type { PatternEntry } from '../src/transfer/store/types.js';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

async function makeSigned(cid: string, content: Buffer) {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const sig = await ed.signAsync(content, priv);
  return { publicKey: 'ed25519:' + hex(pub), signature: 'ed25519:' + hex(sig) };
}

function makeEntry(overrides: Partial<PatternEntry> = {}): PatternEntry {
  return {
    id: 'p1',
    name: 'good-name',
    displayName: 'Good',
    description: 'd',
    version: '1.0.0',
    cid: 'bafycontent',
    size: 4,
    checksum: '',
    author: { id: 'a1', verified: true, patterns: 1, totalDownloads: 0 },
    license: 'MIT',
    categories: [],
    tags: [],
    downloads: 0,
    rating: 0,
    ratingCount: 0,
    lastUpdated: '2026-01-01',
    createdAt: '2026-01-01',
    minClaudeFlowVersion: '3.0.0',
    verified: true,
    trustLevel: 'verified',
    ...overrides,
  };
}

function stubFetch(content: Buffer, opts: { status?: number; headers?: Record<string, string> } = {}) {
  const status = opts.status ?? 200;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(content));
      controller.close();
    },
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers({ 'content-length': String(content.length), ...(opts.headers ?? {}) }),
    body,
    arrayBuffer: async () => content.buffer.slice(content.byteOffset, content.byteOffset + content.length),
  })) as unknown as typeof fetch);
}

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ruflo-4750-')); });
afterEach(() => { vi.unstubAllGlobals(); fs.rmSync(tmp, { recursive: true, force: true }); });

describe('#4750 pattern download security', () => {
  it('happy path: valid signature verifies and writes inside cache dir', async () => {
    const content = Buffer.from('hello');
    const { publicKey, signature } = await makeSigned('bafycontent', content);
    stubFetch(content);
    const dl = new PatternDownloader({ cacheDir: tmp, trustedRegistryPublicKeys: { a1: publicKey } });
    const res = await dl.downloadPattern(makeEntry({ signature, publicKey }));
    expect(res.success).toBe(true);
    expect(res.outputPath && res.outputPath.startsWith(path.resolve(tmp))).toBe(true);
    expect(fs.existsSync(res.outputPath!)).toBe(true);
  });

  it('bad signature: refused and nothing written', async () => {
    const content = Buffer.from('hello');
    const { publicKey, signature } = await makeSigned('bafycontent', Buffer.from('tampered'));
    stubFetch(content);
    const dl = new PatternDownloader({ cacheDir: tmp, trustedRegistryPublicKeys: { a1: publicKey } });
    const res = await dl.downloadPattern(makeEntry({ signature, publicKey }));
    expect(res.success).toBe(false);
    expect(fs.readdirSync(tmp).filter((f) => f.endsWith('.cfp.json')).length).toBe(0);
  });

  it('traversal name: sanitized and stays inside cache dir', async () => {
    const content = Buffer.from('hello');
    const { publicKey, signature } = await makeSigned('bafycontent', content);
    stubFetch(content);
    const dl = new PatternDownloader({ cacheDir: tmp, trustedRegistryPublicKeys: { a1: publicKey } });
    const res = await dl.downloadPattern(makeEntry({ name: '../../evil', signature, publicKey }));
    // Either refused (throws -> success false) or written inside tmp; never outside.
    expect(fs.existsSync(path.resolve(tmp, '..', '..', 'evil-1.0.0.cfp.json'))).toBe(false);
    if (res.success) {
      expect(res.outputPath!.startsWith(path.resolve(tmp))).toBe(true);
    }
  });

  it('self-declared key: requireVerification on but no pinned key refuses a self-signed entry', async () => {
    // The exact gap the maintainer flagged on #4750: the entry brings its own
    // key and a matching self-signature, no trustedRegistryPublicKeys is set,
    // and requireVerification is on. It must be refused, not accepted.
    const content = Buffer.from('hello');
    const { publicKey, signature } = await makeSigned('bafycontent', content);
    stubFetch(content);
    const dl = new PatternDownloader({ cacheDir: tmp, requireVerification: true });
    const res = await dl.downloadPattern(makeEntry({ signature, publicKey }));
    expect(res.success).toBe(false);
    expect(fs.readdirSync(tmp).filter((f) => f.endsWith('.cfp.json')).length).toBe(0);
  });

  it('self-declared key: requireVerification off still accepts a well-formed self-signed entry', async () => {
    // Documented default: without requireVerification and without a pinned key,
    // a self-declared key is still accepted (unchanged behavior).
    const content = Buffer.from('hello');
    const { publicKey, signature } = await makeSigned('bafycontent', content);
    stubFetch(content);
    const dl = new PatternDownloader({ cacheDir: tmp });
    const res = await dl.downloadPattern(makeEntry({ signature, publicKey }));
    expect(res.success).toBe(true);
  });

  it('oversized content: aborts and does not persist', async () => {
    const big = Buffer.alloc(64);
    stubFetch(big);
    const dl = new PatternDownloader({ cacheDir: tmp, maxBytes: 16 });
    const res = await dl.downloadPattern(makeEntry());
    expect(res.success).toBe(false);
    expect(fs.readdirSync(tmp).filter((f) => f.endsWith('.cfp.json')).length).toBe(0);
  });

  it('timeout: hangs then aborts', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch);
    const dl = new PatternDownloader({ cacheDir: tmp, timeout: 50 });
    const res = await dl.downloadPattern(makeEntry());
    expect(res.success).toBe(false);
  });

  it('regression: no signature + requireVerification false still downloads', async () => {
    const content = Buffer.from('hello');
    stubFetch(content);
    const dl = new PatternDownloader({ cacheDir: tmp });
    const res = await dl.downloadPattern(makeEntry());
    expect(res.success).toBe(true);
  });

  it('requireVerification on + no signature: refused', async () => {
    const content = Buffer.from('hello');
    stubFetch(content);
    const dl = new PatternDownloader({ cacheDir: tmp, requireVerification: true });
    const res = await dl.downloadPattern(makeEntry());
    expect(res.success).toBe(false);
  });
});

describe('#4750 helpers', () => {
  it('sanitizeName strips unsafe chars and rejects traversal', () => {
    expect(sanitizeName('a/b c!d')).toBe('abcd');
    expect(sanitizeName('pkg-1.2.3')).toBe('pkg-1.2.3');
    expect(() => sanitizeName('..')).toThrow();
    expect(() => sanitizeName('a/../b')).toThrow();
    expect(() => sanitizeName('/')).toThrow();
  });
  it('assertInside rejects escape', () => {
    expect(() => assertInside('/tmp/x', '/tmp/x/../../etc/passwd')).toThrow();
    expect(assertInside('/tmp/x', '/tmp/x/ok.json')).toBe(path.resolve('/tmp/x/ok.json'));
  });
});
