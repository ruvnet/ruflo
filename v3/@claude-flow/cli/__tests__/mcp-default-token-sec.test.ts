import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureDefaultMcpToken } from '../src/mcp-server.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const home = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ruflo-token-')); dirs.push(d); return d; };

describe('the per-user MCP token used when none is given', () => {
  it('is created once, readable only by the user, and reused', () => {
    const h = home();
    const first = ensureDefaultMcpToken(h);
    expect(first.token).toMatch(/^[0-9a-f]{64}$/);
    expect(first.file).toBe(path.join(h, '.claude-flow', 'mcp-http-token'));
    if (process.platform !== 'win32') expect(fs.statSync(first.file).mode & 0o777).toBe(0o600);
    expect(ensureDefaultMcpToken(h).token).toBe(first.token);
  });

  it('replaces a file that does not hold a usable token', () => {
    const h = home();
    fs.mkdirSync(path.join(h, '.claude-flow'));
    fs.writeFileSync(path.join(h, '.claude-flow', 'mcp-http-token'), 'short\n');
    expect(ensureDefaultMcpToken(h).token).toMatch(/^[0-9a-f]{64}$/);
  });
});
