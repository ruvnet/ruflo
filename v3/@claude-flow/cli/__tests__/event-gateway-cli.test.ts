import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('../src/output.js', () => ({ output: { writeln: () => undefined } }));
import { eventsCommand } from '../src/commands/events.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const folder = () => { const d = mkdtempSync(join(tmpdir(), 'ruflo-cli-events-')); dirs.push(d); return d; };
const SECRET = 'test-webhook-secret-long-enough';

describe('events CLI end to end', () => {
  it('uses the existing mission store with a signed webhook and durable inbox', async () => {
    const root = folder();
    const body = Buffer.from(JSON.stringify({
      action: 'created',
      repository: { full_name: 'ruvnet/ruflo' },
      sender: { login: 'reviewer' },
      issue: { number: 7, pull_request: { url: 'https://github.com/ruvnet/ruflo/pull/7' } },
      comment: { id: 221, body: 'Please fix the tests' },
    }));
    writeFileSync(join(root, 'payload.json'), body);
    writeFileSync(join(root, 'policy.json'), JSON.stringify({
      mode: 'enforce', repositories: ['ruvnet/ruflo'], actors: ['reviewer'], createDrafts: true,
    }));
    const old = process.env.RUFLO_GITHUB_WEBHOOK_SECRET;
    process.env.RUFLO_GITHUB_WEBHOOK_SECRET = SECRET;
    try {
      const sig = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
      const result = await eventsCommand.action({
        args: ['github'], cwd: root, flags: {
          payloadFile: 'payload.json', policyFile: 'policy.json',
          signature: sig, deliveryId: 'delivery-001', eventType: 'issue_comment',
        },
      } as any);
      expect(result.success).toBe(true);
      const created = result.data as any;
      expect(created.receipt.disposition).toBe('created');
      const mission = created.receipt.missionId;
      const inbox = await eventsCommand.action({
        args: ['inbox'], cwd: root, flags: { mission },
      } as any);
      expect(inbox.success).toBe(true);
      expect(inbox.data as any[]).toHaveLength(1);
      const ack = await eventsCommand.action({
        args: ['ack'], cwd: root, flags: { mission, eventKey: created.receipt.eventKey },
      } as any);
      expect(ack.success).toBe(true);
      expect((ack.data as any).acknowledged).toBe(true);
      const again = await eventsCommand.action({
        args: ['inbox'], cwd: root, flags: { mission },
      } as any);
      expect(again.data as any[]).toHaveLength(0);
    } finally {
      if (old === undefined) delete process.env.RUFLO_GITHUB_WEBHOOK_SECRET;
      else process.env.RUFLO_GITHUB_WEBHOOK_SECRET = old;
    }
  });
  it('denies missing GitHub secret by default', async () => {
    const root = folder();
    const old = process.env.RUFLO_GITHUB_WEBHOOK_SECRET;
    delete process.env.RUFLO_GITHUB_WEBHOOK_SECRET;
    writeFileSync(join(root, 'payload.json'), '{}');
    try {
      const result = await eventsCommand.action({
        args: ['github'], cwd: root, flags: {
          payloadFile: 'payload.json', eventType: 'issue_comment',
          deliveryId: 'request', signature: 'sha256=' + 'a'.repeat(64),
        },
      } as any);
      expect(result.success).toBe(false);
    } finally {
      if (old !== undefined) process.env.RUFLO_GITHUB_WEBHOOK_SECRET = old;
    }
  });
});
