/**
 * #4549 automation scan: the daemon's default-on, critical-priority local
 * audit worker hardcoded noHardcodedSecrets:true and riskLevel:'low' without
 * scanning anything. That is a believable false-negative security claim.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkerDaemon } from '../src/services/worker-daemon.js';

let dir: string;
let daemon: WorkerDaemon;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worker-daemon-audit-honesty-'));
  daemon = new WorkerDaemon(dir, { aiWorkersEnabled: false });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGHUP');
});

describe('WorkerDaemon local audit report honesty (#4549)', () => {
  it('does not claim a secret scan or a low risk level when none was performed', async () => {
    const audit = await (daemon as unknown as {
      runAuditWorkerLocal(): Promise<{
        scanned: boolean;
        riskLevel: string;
        checks: { noHardcodedSecrets: boolean | null };
        note: string;
      }>;
    }).runAuditWorkerLocal();

    expect(audit.scanned).toBe(false);
    expect(audit.riskLevel).toBe('unknown');
    expect(audit.checks.noHardcodedSecrets).toBeNull();
    expect(audit.note).toMatch(/does not scan source contents/i);

    const persisted = JSON.parse(readFileSync(
      join(dir, '.claude-flow', 'metrics', 'security-audit.json'),
      'utf-8',
    ));
    expect(persisted).toEqual(audit);
  });
});
