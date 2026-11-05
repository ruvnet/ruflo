import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  finalizeResponse,
  isValidTraceparent,
  negotiateLegacyVersion,
  protocolPreflight,
  sortToolsDeterministically,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '../src/mcp-protocol.js';

// ADR-524: the three ruflo stdio servers answered `initialize` with a hardcoded 2024-11-05 and had no
// 2026-07-28 support. A modern request carries its version in _meta; a dual-era server must serve it
// statelessly and still answer a legacy initialize handshake.

const CAPS = { tools: { listChanged: true }, resources: {} };
const ID = { name: 'ruflo', version: '9.9.9' };
const modernMeta = (extra: Record<string, unknown> = {}) => ({
  _meta: {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {},
    ...extra,
  },
});
const TRACE = '00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01';

describe('mcp-protocol unit', () => {
  it('echoes a supported legacy initialize version and falls back to the latest legacy one otherwise', () => {
    expect(negotiateLegacyVersion('2024-11-05')).toBe('2024-11-05');
    expect(negotiateLegacyVersion('2025-06-18')).toBe('2025-06-18');
    expect(negotiateLegacyVersion('2026-07-28')).toBe('2025-11-25');
    // 2025-03-26 permitted JSON-RPC batching; the handlers are line-at-a-time, so never agree to it.
    expect(negotiateLegacyVersion('2025-03-26')).toBe('2025-11-25');
    expect(negotiateLegacyVersion('1900-01-01')).toBe('2025-11-25');
    expect(negotiateLegacyVersion(undefined)).toBe('2025-11-25');
  });

  it('answers initialize itself with negotiated version, identity and capabilities', () => {
    const p = protocolPreflight({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, CAPS, ID);
    expect(p.response?.result).toEqual({ protocolVersion: '2025-06-18', serverInfo: ID, capabilities: CAPS });
  });

  it('answers server/discover with or without _meta (stdio probe)', () => {
    for (const params of [{}, modernMeta()]) {
      const r = protocolPreflight({ id: 'd', method: 'server/discover', params }, CAPS, ID).response!;
      expect(r.id).toBe('d');
      expect(r.result).toMatchObject({
        resultType: 'complete',
        supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
        capabilities: CAPS,
        _meta: { 'io.modelcontextprotocol/serverInfo': ID },
        cacheScope: 'private',
      });
      expect(typeof r.result!.ttlMs).toBe('number');
    }
  });

  it('rejects an unknown declared version with UnsupportedProtocolVersionError (-32022)', () => {
    const r = protocolPreflight({ id: 7, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } } }, CAPS, ID).response!;
    expect(r.error).toEqual({
      code: -32022,
      message: 'Unsupported protocol version',
      data: { supported: [...SUPPORTED_PROTOCOL_VERSIONS], requested: '1900-01-01' },
    });
  });

  it('rejects a modern request missing clientCapabilities with -32602', () => {
    const r = protocolPreflight({ id: 2, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }, CAPS, ID).response!;
    expect(r.error?.code).toBe(-32602);
  });

  it('never answers a notification, even with a bad version', () => {
    const p = protocolPreflight({ method: 'notifications/initialized', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': 'bogus' } } }, CAPS, ID);
    expect(p.response).toBeUndefined();
  });

  it('treats a request without _meta as legacy and leaves its response untouched', () => {
    const p = protocolPreflight({ id: 3, method: 'tools/list', params: {} }, CAPS, ID);
    expect(p.context).toEqual({ modern: false, traceparent: undefined, tracestate: undefined });
    const resp = { jsonrpc: '2.0' as const, id: 3, result: { tools: [] } };
    expect(finalizeResponse(resp, 'tools/list', p.context!, ID)).toBe(resp);
  });

  it('adds resultType, serverInfo and cache hints to modern results', () => {
    const ctx = protocolPreflight({ id: 4, method: 'tools/list', params: modernMeta() }, CAPS, ID).context!;
    expect(ctx.modern).toBe(true);
    const out = finalizeResponse({ jsonrpc: '2.0', id: 4, result: { tools: [] } }, 'tools/list', ctx, ID)!;
    expect(out.result).toEqual({
      resultType: 'complete',
      tools: [],
      _meta: { 'io.modelcontextprotocol/serverInfo': ID },
      ttlMs: 300_000,
      cacheScope: 'private',
    });
    const call = finalizeResponse({ jsonrpc: '2.0', id: 5, result: { content: [], isError: false } }, 'tools/call', ctx, ID)!;
    expect(call.result).not.toHaveProperty('ttlMs');
    expect(call.result!.resultType).toBe('complete');
    const err = { jsonrpc: '2.0' as const, id: 6, error: { code: -32601, message: 'x' } };
    expect(finalizeResponse(err, 'tools/call', ctx, ID)).toBe(err);
  });

  it('accepts only well-formed W3C traceparent values', () => {
    expect(isValidTraceparent(TRACE)).toBe(true);
    expect(isValidTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBe(false);
    expect(isValidTraceparent('00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01')).toBe(false);
    expect(isValidTraceparent('ff-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01')).toBe(false);
    expect(isValidTraceparent('00-0AF7651916CD43DD8448EB211C80319C-00f067aa0ba902b7-01')).toBe(false);
    expect(isValidTraceparent(`${TRACE}\nInjected: header`)).toBe(false);
    expect(isValidTraceparent(42)).toBe(false);
    const ctx = protocolPreflight({ id: 1, method: 'tools/call', params: { _meta: { traceparent: 'nope', tracestate: 'a=b' } } }, CAPS, ID).context!;
    expect(ctx.traceparent).toBeUndefined();
    expect(ctx.tracestate).toBeUndefined();
  });

  it('orders tools by name without mutating the input', () => {
    const input = [{ name: 'b' }, { name: 'a_2' }, { name: 'a_1' }];
    expect(sortToolsDeterministically(input).map((t) => t.name)).toEqual(['a_1', 'a_2', 'b']);
    expect(input.map((t) => t.name)).toEqual(['b', 'a_2', 'a_1']);
  });
});

// MCPServerManager (`ruflo mcp start` via the commands path) — driven through its message handler.
const { callMCPTool } = vi.hoisted(() => ({ callMCPTool: vi.fn(async () => ({ ok: true })) }));
vi.mock('../src/mcp-client.js', () => ({
  callMCPTool,
  hasTool: (n: string) => n === 'zeta_tool' || n === 'alpha_tool',
  listMCPTools: () => [
    { name: 'zeta_tool', description: 'z', inputSchema: { type: 'object' } },
    { name: 'alpha_tool', description: 'a', inputSchema: { type: 'object' } },
  ],
}));
vi.mock('../src/mcp-tools/request-tracker.js', () => ({ trackRequest: vi.fn() }));
vi.mock('../src/mcp-tools/policy-enforcer.js', () => ({ isPolicyEnforcementEnabled: () => false }));

describe('MCPServerManager speaks 2026-07-28 and legacy', async () => {
  const { MCPServerManager } = await import('../src/mcp-server.js');
  const manager = new MCPServerManager({ transport: 'stdio' });
  const send = (id: number, method: string, params: unknown = {}) =>
    (manager as any).handleMCPMessage({ jsonrpc: '2.0', id, method, params }, 'test-session');

  it('no longer pins initialize to 2024-11-05', async () => {
    const init = await send(1, 'initialize', { protocolVersion: '2025-11-25' });
    expect(init.result.protocolVersion).toBe('2025-11-25');
    expect(init.result.serverInfo.version).not.toBe('3.0.0');
  });

  it('serves a stateless modern tools/list in name order with cache hints', async () => {
    const r = await send(2, 'tools/list', modernMeta());
    expect(r.result.resultType).toBe('complete');
    expect(r.result.tools.map((t: { name: string }) => t.name)).toEqual(['alpha_tool', 'zeta_tool']);
    expect(r.result.cacheScope).toBe('private');
  });

  it('forwards a valid traceparent into the tool-call context', async () => {
    callMCPTool.mockClear();
    const r = await send(3, 'tools/call', { name: 'alpha_tool', arguments: {}, ...modernMeta({ traceparent: TRACE }) });
    expect(r.result.resultType).toBe('complete');
    expect(callMCPTool).toHaveBeenCalledWith('alpha_tool', {}, expect.objectContaining({ traceparent: TRACE, transport: 'stdio' }));
  });

  it('uses -32602 for an unknown resource under 2026-07-28 and -32002 under legacy', async () => {
    expect((await send(4, 'resources/read', { uri: 'ruflo://x', ...modernMeta() })).error.code).toBe(-32602);
    expect((await send(5, 'resources/read', { uri: 'ruflo://x' })).error.code).toBe(-32002);
  });

  it('answers server/discover', async () => {
    const r = await send(6, 'server/discover', modernMeta());
    expect(r.result.supportedVersions).toContain('2026-07-28');
  });
});

// The bin entries (what `npx ruflo mcp start` actually runs) over real stdio. Needs a built CLI.
const BIN = (f: string) => join(__dirname, '..', 'bin', f);
const built = existsSync(join(__dirname, '..', 'dist', 'src', 'mcp-protocol.js'));

function rpc(entry: string, args: string[], calls: Array<{ method: string; params?: unknown }>): Promise<Array<{ result?: any; error?: any }>> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [BIN(entry), ...args], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, RUFLO_NO_SKILLS_SH: '1' } });
    const out: Array<{ result?: any; error?: any }> = [];
    let buf = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`timeout; got ${out.filter(Boolean).length}/${calls.length}`)); }, 60_000);
    p.stdout.on('data', (d) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { const m = JSON.parse(line); if (typeof m.id === 'number') out[m.id - 1] = m; } catch { /* log line */ }
        if (out.filter(Boolean).length === calls.length) { clearTimeout(timer); p.kill('SIGKILL'); resolve(out); }
      }
    });
    calls.forEach((c, i) => p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: c.method, params: c.params ?? {} })}\n`));
  });
}

describe.skipIf(!built).each([
  ['cli.js', ['mcp', 'start']],
  ['mcp-server.js', []],
])('bin/%s over stdio (ADR-524)', (entry, args) => {
  it('is dual-era: discover probe, modern stateless calls, legacy initialize', async () => {
    const [discover, list, list2, badVersion, init] = await rpc(entry, args, [
      { method: 'server/discover', params: modernMeta() },
      { method: 'tools/list', params: modernMeta() },
      { method: 'tools/list', params: modernMeta() },
      { method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } } },
      { method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    ]);
    expect(discover.result.supportedVersions).toContain('2026-07-28');
    expect(discover.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('ruflo');
    expect(list.result.resultType).toBe('complete');
    const names = list.result.tools.map((t: { name: string }) => t.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toEqual([...names].sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(JSON.stringify(list2.result.tools)).toBe(JSON.stringify(list.result.tools));
    expect(badVersion.error.code).toBe(-32022);
    expect(init.result.protocolVersion).toBe('2025-11-25');
  }, 90_000);
});
