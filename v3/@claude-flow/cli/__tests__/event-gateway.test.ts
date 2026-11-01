import { afterEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EventIntelligenceGateway, verifyGitHubSignature, type EventPolicy, type GitHubEnvelope,
} from '../src/missions/event-gateway.js';

const SECRET = 'test-webhook-secret-long-enough';
const enforce: EventPolicy = {
  mode: 'enforce', repositories: ['ruvnet/ruflo'], actors: ['reviewer'], createDrafts: true,
};
const observe: EventPolicy = {
  mode: 'observe', repositories: ['ruvnet/ruflo'], actors: ['reviewer'], createDrafts: true,
};
const dirs: string[] = [];
const root = () => { const dir = mkdtempSync(join(tmpdir(), 'ruflo-event-e2e-')); dirs.push(dir); return dir; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function delivery(id: string, number = 128, actor = 'reviewer', eventType = 'issue_comment', action = 'created'): GitHubEnvelope {
  const payload = {
    action, repository: { full_name: 'ruvnet/ruflo' }, sender: { login: actor },
    issue: { number, pull_request: { url: 'https://api.github.com/repos/ruvnet/ruflo/pulls/' + number } },
    pull_request: { number }, comment: { id: Number(id.replace(/\D/g, '')) || 1, body: 'Test comment' },
  };
  const body = Buffer.from(JSON.stringify(payload));
  const signature256 = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
  return { deliveryId: id, eventType, body, signature256 };
}
describe('Event Intelligence Gateway: signed receipt to durable mission inbox', () => {
  it('authenticates exact bytes and rejects forgery, short secrets and malformed signatures', () => {
    const e = delivery('e1');
    expect(verifyGitHubSignature(e, SECRET)).toBe(true);
    expect(verifyGitHubSignature({ ...e, body: Buffer.concat([e.body, Buffer.from(' ')]) }, SECRET)).toBe(false);
    expect(verifyGitHubSignature({ ...e, signature256: 'sha256=' + '0'.repeat(64) }, SECRET)).toBe(false);
    expect(verifyGitHubSignature(e, 'short')).toBe(false);
    expect(verifyGitHubSignature({ ...e, signature256: 'garbage' }, SECRET)).toBe(false);
  });
  it('defaults to observe only, never creating or executing missions', async () => {
    const gateway = new EventIntelligenceGateway(root(), observe, SECRET);
    const e = delivery('e2');
    const first = await gateway.ingest(e);
    const repeat = await gateway.ingest(e);
    expect(first.receipt.disposition).toBe('ignored');
    expect(first.receipt.missionId).toBeNull();
    expect(first.receipt.reason).toMatch(/observe/);
    expect(repeat.duplicate).toBe(true);
  });
  it('creates one draft, attaches later events and survives restart with ack continuity', async () => {
    const d = root();
    const gateway = new EventIntelligenceGateway(d, enforce, SECRET);
    const initial = await gateway.ingest(delivery('p1'));
    expect(initial.receipt.disposition).toBe('created');
    const missionId = initial.receipt.missionId!;
    expect(missionId).toMatch(/^msn_[a-f0-9]{24}$/);
    const second = await gateway.ingest(delivery('p2'));
    expect(second.receipt.disposition).toBe('attached');
    expect(second.receipt.missionId).toBe(missionId);
    const restarted = new EventIntelligenceGateway(d, enforce, SECRET);
    const pending = await restarted.inbox(missionId);
    expect(pending).toHaveLength(2);
    expect(await restarted.acknowledge(missionId, second.receipt.eventKey)).toBe(true);
    expect(await restarted.acknowledge(missionId, second.receipt.eventKey)).toBe(true);
    expect((await restarted.inbox(missionId)).map(e => e.deliveryId)).toEqual(['p1']);
    expect((await restarted.ingest(delivery('p1'))).duplicate).toBe(true);
  });
  it('rejects actors outside authorization and non-actionable events without starting work', async () => {
    const gateway = new EventIntelligenceGateway(root(), enforce, SECRET);
    expect((await gateway.ingest(delivery('a1', 10, 'stranger'))).receipt.disposition).toBe('ignored');
    expect((await gateway.ingest(delivery('a2', 11, 'reviewer', 'issue_comment', 'edited'))).receipt.disposition).toBe('ignored');
  });
  it('refuses delivery replay collisions with altered payload', async () => {
    const gateway = new EventIntelligenceGateway(root(), enforce, SECRET);
    await gateway.ingest(delivery('same', 11));
    await expect(gateway.ingest(delivery('same', 12))).rejects.toThrow(/collision/);
  });
  it('cannot attach a forged event or acknowledge a foreign mission', async () => {
    const gateway = new EventIntelligenceGateway(root(), enforce, SECRET);
    const created = await gateway.ingest(delivery('auth'));
    await expect(gateway.ingest({ ...delivery('evil', 999), signature256: delivery('auth').signature256 })).rejects.toThrow(/unauthenticated/);
    expect(await gateway.acknowledge('msn_' + '1'.repeat(24), created.receipt.eventKey)).toBe(false);
  });
  it('coalesces concurrent deliveries to one thread owner under a cross-request lock', async () => {
    const d = root();
    const gateway = new EventIntelligenceGateway(d, enforce, SECRET);
    const all = await Promise.all(Array.from({ length: 16 }, (_, i) => gateway.ingest(delivery('batch' + i))));
    expect(all.filter(v => v.receipt.disposition === 'created')).toHaveLength(1);
    expect(new Set(all.map(v => v.receipt.missionId)).size).toBe(1);
    expect((await gateway.inbox(all[0].receipt.missionId!)).length).toBe(16);
  });
  it('requires explicit opt-in for draft creation even in enforce mode', async () => {
    const gateway = new EventIntelligenceGateway(root(), { ...enforce, createDrafts: false }, SECRET);
    const out = await gateway.ingest(delivery('no-create'));
    expect(out.receipt.disposition).toBe('ignored');
    expect(out.receipt.reason).toMatch(/disabled/);
  });
  it('rejects unsupported and malformed source events before side effects', async () => {
    const gateway = new EventIntelligenceGateway(root(), enforce, SECRET);
    await expect(gateway.ingest(delivery('bad', 7, 'reviewer', 'ping'))).rejects.toThrow(/unsupported/);
    await expect(gateway.ingest(delivery('bad-number', 0))).rejects.toThrow(/number/);
  });
});
