/**
 * #4492: on Windows, `atomicWriteJson` opened the parent directory and fsynced that handle. NTFS cannot flush a directory handle, so the call threw
 * EPERM and `flywheel run` aborted at the first write ("ran": false) while `flywheel status` kept saying the ledger was valid with 0 commits.
 *
 * The rule the CLI already follows elsewhere (policy-runtime.ts `syncDirectory`, #3398): skip the directory fsync on win32 only, and let a POSIX
 * failure reach the caller, because there it means the rename may not be durable. So this must NOT swallow EPERM on Linux or macOS.
 *
 * The test host is not Windows, so NTFS is simulated: `process.platform` reports win32 and an fsync on a directory descriptor throws EPERM.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sim = vi.hoisted(() => ({ dirFsyncFails: false, dirFsyncs: 0 }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    fsyncSync: (fd: number) => {
      if (actual.fstatSync(fd).isDirectory()) {
        sim.dirFsyncs += 1;
        if (sim.dirFsyncFails) throw Object.assign(new Error('EPERM: operation not permitted, fsync'), { code: 'EPERM' });
      }
      return actual.fsyncSync(fd);
    },
  };
});

import { createFlywheelReceipt, policyCandidateId } from '../src/services/flywheel-receipt.js';
import { readFlywheelReceipt, readFlywheelTransactionState, registerFlywheelReceipt } from '../src/services/flywheel-transaction.js';

const HELD_DELTAS = [0.1, 0.12, 0.2, 0.08, 0.15, 0.11, 0.09, 0.14, 0.13, 0.1];

function receipt() {
  const pair = generateKeyPairSync('ed25519');
  return createFlywheelReceipt({
    baselineRef: policyCandidateId({ alpha: 0.5 }),
    candidatePolicy: { alpha: 0.3 },
    safetyEnvelopeRef: 'sha256:safety-envelope-v1',
    corpusVersion: 'corpus-v1',
    corpusHash: 'sha256:corpus-v1',
    baselineScore: 0.5,
    candidateScore: 0.65,
    heldOutDeltas: HELD_DELTAS,
    pairedOutcomes: HELD_DELTAS.map((delta, i) => ({ taskId: `t${i}`, baselineScore: 0.5, candidateScore: 0.5 + delta })),
    frozenAnchorRegression: 0,
    gates: { heldOut: true, redblue: true, replay: true },
    termVerification: ['heldOut', 'redblue', 'replay'].map((term) => ({ term, verification: 'recomputed' as const, evidenceRef: `sha256:${term}` })),
    now: 1_700_000_000_000,
    ttlMs: 1_000_000,
    bootstrapIterations: 500,
    privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  });
}

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const as = (platform: NodeJS.Platform) => Object.defineProperty(process, 'platform', { ...realPlatform, value: platform });

afterEach(() => {
  Object.defineProperty(process, 'platform', realPlatform);
  sim.dirFsyncFails = false;
  sim.dirFsyncs = 0;
});

describe('atomicWriteJson directory fsync (#4492)', () => {
  it('on Windows, a directory fsync that throws EPERM does not stop the write: the receipt and the ledger state are committed', async () => {
    as('win32');
    sim.dirFsyncFails = true;
    const root = mkdtempSync(join(tmpdir(), 'flywheel-win-'));
    const r = receipt();

    const state = await registerFlywheelReceipt(root, r, 1_700_000_000_001);

    expect(state.status).toBe('evaluated');
    expect(readFlywheelReceipt(root, r.payload.receiptId)).not.toBeNull();
    expect(readFlywheelTransactionState(root).receiptStates[r.payload.receiptId]?.status).toBe('evaluated');
  });

  it('on Windows the directory is not fsynced at all (nothing to flush there)', async () => {
    as('win32');
    const root = mkdtempSync(join(tmpdir(), 'flywheel-win-'));

    await registerFlywheelReceipt(root, receipt(), 1_700_000_000_001);

    expect(sim.dirFsyncs).toBe(0);
  });

  it('on POSIX the directory IS still fsynced, so the rename stays durable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'flywheel-posix-'));

    await registerFlywheelReceipt(root, receipt(), 1_700_000_000_001);

    expect(sim.dirFsyncs).toBeGreaterThan(0);
  });

  it('on POSIX a failing directory fsync still reaches the caller (it means the rename may not be durable)', async () => {
    sim.dirFsyncFails = true;
    const root = mkdtempSync(join(tmpdir(), 'flywheel-posix-'));

    await expect(registerFlywheelReceipt(root, receipt(), 1_700_000_000_001)).rejects.toThrow('EPERM');
  });
});
