/**
 * Pattern store signatures must be real Ed25519 and a bad signature must
 * stop the download. Previously verification was an HMAC keyed with the
 * public key (forgeable by anyone) with a length-check fallback, and a
 * failed check was only logged.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as ed from '@noble/ed25519';
import { PatternDownloader } from '../src/transfer/store/download.js';
import { PatternPublisher } from '../src/transfer/store/publish.js';

const content = Buffer.from(JSON.stringify({ magic: 'CFP1', patterns: [] }));
const checksum = crypto.createHash('sha256').update(content).digest('hex');

async function realKeyPair() {
  const seed = crypto.randomBytes(32);
  const pub = await ed.getPublicKeyAsync(seed);
  const sig = await ed.signAsync(content, seed);
  return {
    seed,
    publicKey: 'ed25519:' + Buffer.from(pub).toString('hex'),
    signature: 'ed25519:' + Buffer.from(sig).toString('hex'),
  };
}

function verify(d: PatternDownloader, sig: string, pub: string): Promise<boolean> {
  return Promise.resolve((d as any).verifySignature(content, sig, pub));
}

let tmp: string | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe('transfer store signature verification', () => {
  it('accepts a genuine Ed25519 signature', async () => {
    const { publicKey, signature } = await realKeyPair();
    expect(await verify(new PatternDownloader(), signature, publicKey)).toBe(true);
  });

  it('rejects an HMAC "signature" anyone can compute from the public key', async () => {
    const { publicKey } = await realKeyPair();
    const keyHex = publicKey.slice('ed25519:'.length);
    const forged = 'ed25519:' + crypto.createHmac('sha256', keyHex).update(content).digest('hex');
    expect(await verify(new PatternDownloader(), forged, publicKey)).toBe(false);
  });

  it('rejects arbitrary long strings (no length-check fallback)', async () => {
    const junk = 'ed25519:' + 'ab'.repeat(20);
    expect(await verify(new PatternDownloader(), junk, 'ed25519:' + 'cd'.repeat(16))).toBe(false);
  });

  it('rejects a signature made by a different key', async () => {
    const a = await realKeyPair();
    const b = await realKeyPair();
    expect(await verify(new PatternDownloader(), a.signature, b.publicKey)).toBe(false);
  });

  it('does not write a pattern whose signature fails', async () => {
    const { publicKey } = await realKeyPair();
    const other = await realKeyPair();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-store-sig-'));
    const out = path.join(tmp, 'p.cfp.json');
    const d = new PatternDownloader();
    vi.spyOn(d as any, 'fetchFromIPFS').mockResolvedValue(content);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await d.downloadPattern(
      {
        id: 'p', name: 'p', displayName: 'p', description: '', version: '1.0.0',
        cid: 'bafytestcid', size: content.length, checksum,
        signature: other.signature, publicKey,
      } as any,
      { output: out } as any,
    );
    expect(result.success).toBe(false);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('publisher signatures verify against the publisher public key', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-store-sig-'));
    const keyPath = path.join(tmp, 'key.hex');
    fs.writeFileSync(keyPath, crypto.randomBytes(32).toString('hex'));
    const pub = new PatternPublisher();
    const { signature, publicKey } = await (pub as any).signContent(content, keyPath);
    expect(await verify(new PatternDownloader(), signature, publicKey)).toBe(true);
  });

  it('publisher refuses a key file that is not a 32-byte hex seed', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-store-sig-'));
    const keyPath = path.join(tmp, 'key.txt');
    fs.writeFileSync(keyPath, 'not-a-seed');
    await expect((new PatternPublisher() as any).signContent(content, keyPath)).rejects.toThrow(/32-byte hex seed/);
  });
});
