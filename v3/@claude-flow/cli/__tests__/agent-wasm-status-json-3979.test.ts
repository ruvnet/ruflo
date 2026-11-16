// #3979 / ADR-532: `agent wasm-status --format json` must print exactly one JSON document on stdout
// (the console parses it), with or without @ruvector/rvagent-wasm installed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = { available: false };
vi.mock('../src/ruvector/agent-wasm.js', () => ({
  AGENT_WASM_NOT_INSTALLED_MESSAGE: 'NOT-INSTALLED-HINT\nInstall it with: npm install @ruvector/rvagent-wasm (or -g)',
  isAgentWasmAvailable: async () => state.available,
  initAgentWasm: async () => undefined,
  listWasmAgents: () => [],
  getGalleryCount: async () => 3,
  getGalleryCategories: async () => ({ a: 3 }),
}));

import { wasmStatusCommand } from '../src/commands/agent-wasm.js';

let out = '';
let err = '';
beforeEach(() => {
  out = '';
  err = '';
  vi.spyOn(process.stdout, 'write').mockImplementation(((s: any) => { out += String(s); return true; }) as any);
  vi.spyOn(process.stderr, 'write').mockImplementation(((s: any) => { err += String(s); return true; }) as any);
});
afterEach(() => vi.restoreAllMocks());

const run = (format?: string) =>
  wasmStatusCommand.action!({ args: [], flags: format ? { format } : {}, cwd: process.cwd() } as any);

describe('agent wasm-status --format json (#3979)', () => {
  it('package missing: stdout is exactly one JSON doc with the install hint, exit success', async () => {
    state.available = false;
    const r = await run('json');
    expect(r?.success).toBe(true);
    expect(out.trim().startsWith('{')).toBe(true);
    expect(out).toBe(out.trim() + '\n'); // no stray blank line / text around the document
    const doc = JSON.parse(out);
    expect(doc.available).toBe(false);
    expect(doc.install).toMatch(/npm install @ruvector\/rvagent-wasm/);
    expect(err).not.toMatch(/WARN/);
  });

  it('package present: stdout is one JSON doc with available=true', async () => {
    state.available = true;
    await run('json');
    expect(out).toBe(out.trim() + '\n');
    const doc = JSON.parse(out);
    expect(doc.available).toBe(true);
    expect(doc.gallery.templates).toBe(3);
  });

  it('human mode still prints the warning (on stderr) when missing', async () => {
    state.available = false;
    await run();
    expect(err).toMatch(/NOT-INSTALLED-HINT/);
    expect(out).not.toMatch(/^\s*\{/);
  });
});
