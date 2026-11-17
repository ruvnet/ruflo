import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentFederationPlugin } from '../../src/plugin.js';
import { canonicalizeEnvelopeForVerify } from '../../src/application/inbound-dispatcher.js';
import { FederationEnvelope } from '../../src/domain/entities/federation-envelope.js';
import { FederationNode } from '../../src/domain/entities/federation-node.js';
import type { AgentMessage } from '../../src/transport/midstream-aware-loader.js';

const wire = vi.hoisted(() => ({ receive: undefined as undefined | ((address: string, message: AgentMessage) => Promise<void>) }));
vi.mock('../../src/transport/midstream-aware-loader.js', () => ({
  loadFederationTransport: async () => ({
    source: 'test-transport',
    transport: {
      send: async () => {},
      close: async () => {},
      onMessage: (receive: typeof wire.receive) => { wire.receive = receive; },
    },
  }),
}));

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const now = Date.parse('2026-11-06T12:00:00.000Z');
let plugin: AgentFederationPlugin;
let directory: string;
let events: ReturnType<typeof vi.fn>;

function envelope(target = 'local', timestamp = now): AgentMessage {
  const payload = new FederationEnvelope({
    envelopeId: 'message-1', sourceNodeId: 'remote', targetNodeId: target,
    sessionId: 'session', messageType: 'heartbeat', payload: {},
    timestamp: new Date(timestamp), nonce: 'nonce', hmacSignature: 'fixture-hmac',
    piiScanResult: FederationEnvelope.emptyScanResult(),
  }).toJSON();
  const message: AgentMessage = {
    id: 'message-1', type: 'heartbeat', payload,
    metadata: { sourceNodeId: 'remote', targetNodeId: target, sessionId: 'session', signatureVersion: 'jcs-v1' },
  };
  message.metadata!.signature = sign(null, Buffer.from(canonicalizeEnvelopeForVerify(message)), keys.privateKey).toString('hex');
  return message;
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'federation-replay-'));
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
  vi.spyOn(Date, 'now').mockReturnValue(now);
  events = vi.fn();
  const services = new Map<string, any>();
  plugin = new AgentFederationPlugin();
  await plugin.initialize({
    config: { nodeId: 'local', endpoint: 'ws://localhost:9100', staticPeers: [] },
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    eventBus: { emit: events, on: vi.fn() },
    services: { register: (name: string, service: any) => services.set(name, service), get: (name: string) => services.get(name) },
  } as any);
  const peer = FederationNode.create({
    nodeId: 'remote', publicKey, endpoint: 'ws://remote:9100',
    capabilities: { agentTypes: [], maxConcurrentSessions: 1, supportedProtocols: [], complianceModes: [] },
    metadata: {},
  });
  vi.spyOn(services.get('federation:discovery'), 'getPeer').mockImplementation((id) => id === 'remote' ? peer : undefined);
  events.mockClear();
});

afterEach(async () => {
  await plugin?.shutdown();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

function deliveries() {
  return events.mock.calls.filter(([name]) => name === 'federation:inbound:heartbeat');
}

describe('plugin authenticated inbound envelope safety', () => {
  it('delivers a fresh correctly addressed Ed25519-signed JSON envelope', async () => {
    await wire.receive!('remote:9100', envelope());
    expect(deliveries()).toHaveLength(1);
  });

  it('does not deliver the same signed envelope twice across transport callbacks', async () => {
    const message = envelope();
    await wire.receive!('remote:9100', message);
    await wire.receive!('remote:9100', message);
    expect(deliveries()).toHaveLength(1);
  });

  it('admits at most one concurrent delivery of a signed envelope', async () => {
    const message = envelope();
    await Promise.all([wire.receive!('remote:9100', message), wire.receive!('remote:9100', message)]);
    expect(deliveries()).toHaveLength(1);
  });

  it('rejects an envelope signed for another recipient', async () => {
    await wire.receive!('remote:9100', envelope('other-node'));
    expect(deliveries()).toHaveLength(0);
  });

  it.each([now - 300_001, now + 30_001])('rejects an out-of-window signed timestamp %s', async (timestamp) => {
    await wire.receive!('remote:9100', envelope('local', timestamp));
    expect(deliveries()).toHaveLength(0);
  });
});
