/**
 * SECURITY: the browser tools return page text to the caller, so a navigation
 * target that is not a web page (a `file:` URL, `view-source:`, `chrome:`)
 * would read local files that `http_fetch` never serves. Navigation is now
 * limited to web pages.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const exec = vi.hoisted(() => ({
  execFileSync: vi.fn(() => '{"success":true,"data":{}}'),
  execFile: vi.fn(),
}));
vi.mock('child_process', () => ({ execFileSync: exec.execFileSync, execFile: exec.execFile }));
vi.mock('node:child_process', () => ({ execFileSync: exec.execFileSync, execFile: exec.execFile }));

import { browserTools } from '../src/mcp-tools/browser-tools.js';
import { browserSessionTools } from '../src/mcp-tools/browser-session-tools.js';
import { browserUrlError, commandArgvError } from '../src/mcp-tools/browser-argv.js';

type Result = { isError?: boolean; content: Array<{ text: string }> };
const call = (name: string, input: Record<string, unknown>) =>
  [...browserTools, ...browserSessionTools].find(t => t.name === name)!.handler(input) as Promise<Result>;
const errorOf = (r: Result) => JSON.parse(r.content[0].text).error as string;
/** The argv agent-browser was spawned with (after the launcher prefix). */
const spawnedArgs = () => exec.execFileSync.mock.calls.map(c => (c as unknown as [string, string[]])[1]);

beforeEach(() => { exec.execFileSync.mockClear(); exec.execFile.mockClear(); });

describe('browserUrlError', () => {
  it('accepts web pages and scheme-less hosts', () => {
    for (const ok of [
      'https://example.com', 'http://localhost:3000/app', 'HTTPS://Example.com', 'about:blank',
      'example.com', 'example.com/path?q=1', 'localhost:3000', 'localhost:3000/x', '127.0.0.1:8080', 'api.example.com:8443',
    ]) {
      expect(browserUrlError(ok), ok).toBeNull();
    }
  });

  it('refuses schemes that are not web pages, however they are spelled', () => {
    for (const bad of [
      'file:///etc/hosts', 'FILE:///etc/hosts', '  file:///etc/hosts', '\u0001file:///etc/hosts', 'fi\tle:///etc/hosts',
      'fi\nle:///etc/hosts', 'file:1/../etc/hosts', 'view-source:https://example.com', 'chrome://settings',
      'data:text/html,hi', 'javascript:alert(1)', 'blob:https://example.com/x', 'about:config',
    ]) {
      expect(browserUrlError(bad), JSON.stringify(bad)).toMatch(/scheme not allowed/);
    }
  });

  it('refuses a missing or empty url', () => {
    expect(browserUrlError(undefined)).toMatch(/non-empty/);
    expect(browserUrlError('   ')).toMatch(/non-empty/);
  });

  it('is applied to every `open` command', () => {
    expect(commandArgvError(['open', 'file:///etc/hosts'])).toMatch(/scheme not allowed/);
    expect(commandArgvError(['open', 'https://example.com', '--wait-until', 'load'])).toBeNull();
  });
});

describe('browser navigation tools', () => {
  it('browser_open refuses a file: URL without spawning the browser', async () => {
    const r = await call('browser_open', { url: 'file:///etc/hosts' });
    expect(r.isError).toBe(true);
    expect(errorOf(r)).toMatch(/scheme not allowed/);
    expect(exec.execFileSync).not.toHaveBeenCalled();
  });

  it('browser_open still opens a web page', async () => {
    const r = await call('browser_open', { url: 'https://example.com' });
    expect(r.isError).toBeFalsy();
    const argv = spawnedArgs()[0] ?? [];
    expect(argv[argv.indexOf('open') + 1]).toBe('https://example.com');
  });

  it('browser_session_record refuses a file: URL before doing anything', async () => {
    const r = await call('browser_session_record', { url: 'file:///etc/hosts', task: 'read it' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/scheme not allowed/);
    expect(exec.execFile).not.toHaveBeenCalled();
    expect(exec.execFileSync).not.toHaveBeenCalled();
  });
});
