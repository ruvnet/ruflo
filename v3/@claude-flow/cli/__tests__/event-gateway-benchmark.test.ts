/**
 * Deterministic load replay. Real filesystem + MissionService, no LLM or
 * remote GitHub: these results measure ingestion and durable event delivery.
 * Run: vitest run __tests__/event-gateway-benchmark.test.ts --reporter=verbose
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { EventIntelligenceGateway, type GitHubEnvelope } from '../src/missions/event-gateway.js';

const secret = 'test-webhook-secret-long-enough';
function webhook(i: number, thread = i % 20): GitHubEnvelope {
  const body = Buffer.from(JSON.stringify({
    action: 'created', repository: { full_name: 'ruvnet/ruflo' },
    sender: { login: 'reviewer' },
    issue: { number: thread + 1, pull_request: { url: 'https://api.github.com/pulls/' + (thread + 1) } },
    comment: { id: i + 1, body: 'Follow up ' + i },
  }));
  return {
    deliveryId: 'bench' + i, eventType: 'issue_comment', body,
    signature256: 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'),
  };
}
function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return +sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)].toFixed(3);
}
describe('Event gateway replay benchmark', () => {
  it('processes 300 real durable deliveries with 20 missions, duplicate suppression and inbox reads', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-gateway-bench-'));
    try {
      const gateway = new EventIntelligenceGateway(root, {
        mode: 'enforce', repositories: ['ruvnet/ruflo'], actors: ['reviewer'], createDrafts: true,
      }, secret);
      const events = Array.from({ length: 300 }, (_, i) => webhook(i));
      const latencies: number[] = [];
      const owners = new Set<string>();
      let created = 0, attached = 0, duplicates = 0;
      const t0 = performance.now();
      for (const e of events) {
        const start = performance.now();
        const result = await gateway.ingest(e);
        latencies.push(performance.now() - start);
        if (result.receipt.disposition === 'created') created++;
        if (result.receipt.disposition === 'attached') attached++;
        if (result.receipt.missionId) owners.add(result.receipt.missionId);
      }
      for (const e of events.slice(0, 30)) {
        const again = await gateway.ingest(e);
        if (again.duplicate) duplicates++;
      }
      const ingestMs = performance.now() - t0;
      const inboxT0 = performance.now();
      let inboxTotal = 0;
      for (const owner of owners) inboxTotal += (await gateway.inbox(owner)).length;
      const inboxMs = performance.now() - inboxT0;
      const report = {
        workload: '300 signed events, 20 PR threads, 30 delivery replays, durable local MissionService',
        created, attached, duplicates, owners: owners.size, inboxTotal,
        ingestMs: +ingestMs.toFixed(1),
        eventsPerSecond: +(300 / (ingestMs / 1000)).toFixed(1),
        p50Ms: percentile(latencies, .50), p95Ms: percentile(latencies, .95),
        p99Ms: percentile(latencies, .99),
        inboxScanMs: +inboxMs.toFixed(1),
      };
      console.log('RUFLO_EVENT_GATEWAY_BENCHMARK ' + JSON.stringify(report));
      expect(report).toMatchObject({ created: 20, attached: 280, duplicates: 30, owners: 20, inboxTotal: 300 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120000);
});
