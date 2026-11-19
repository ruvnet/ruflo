/**
 * SECURITY: browser_open forwarded caller-supplied Chromium launch flags, and
 * agent-browser reads its own options anywhere in argv, so caller text such as
 * a selector could add an option too. Launch flags are now limited to a fixed
 * list of plain switches, and no caller value may add an option.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const exec = vi.hoisted(() => ({ execFileSync: vi.fn(() => '{"success":true,"data":{}}') }));
vi.mock('child_process', () => ({ execFileSync: exec.execFileSync }));
vi.mock('node:child_process', () => ({ execFileSync: exec.execFileSync }));

import { browserTools } from '../src/mcp-tools/browser-tools.js';
import { ALLOWED_LAUNCH_ARGS, commandArgvError, launchArgsError } from '../src/mcp-tools/browser-argv.js';

const call = (name: string, input: Record<string, unknown>) =>
  browserTools.find(t => t.name === name)!.handler(input) as Promise<{ isError?: boolean; content: Array<{ text: string }> }>;
const errorOf = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text).error as string;

beforeEach(() => exec.execFileSync.mockClear());

describe('launchArgsError', () => {
  it('accepts only exact allowlisted switches', () => {
    expect(launchArgsError(undefined)).toBeNull();
    expect(launchArgsError([...ALLOWED_LAUNCH_ARGS])).toBeNull();
    for (const bad of ['--gpu-launcher=/tmp/x', '--renderer-cmd-prefix=sh', '--disable-gpu=1', '--disable-gpu,--x', 'disable-gpu', '']) {
      expect(launchArgsError([bad]), bad).toMatch(/not allowed/);
    }
    expect(launchArgsError('--disable-gpu')).toMatch(/array/);
    expect(launchArgsError([1])).toMatch(/array/);
  });
});

describe('commandArgvError', () => {
  it('lets ordinary values and the tools\' own options through', () => {
    expect(commandArgvError(['open', 'https://example.com', '--wait-until', 'load'])).toBeNull();
    expect(commandArgvError(['fill', '@e1', '-5'])).toBeNull();
    expect(commandArgvError(['snapshot', '-i', '-c', '-d', '3', '-s', '#main'])).toBeNull();
  });
  it('refuses values that would add an agent-browser option', () => {
    expect(commandArgvError(['click', '--executable-path', '/tmp/x'])).toMatch(/must not start with "--"/);
    expect(commandArgvError(['type', '#q', '--args=--gpu-launcher=x'])).toMatch(/must not start with "--"/);
    expect(commandArgvError(['press', '-p'])).toMatch(/must not be an option/);
  });
});

describe('browser tool handlers', () => {
  it('refuses a launch flag outside the allowlist without spawning anything', async () => {
    const r = await call('browser_open', { url: 'https://example.com', args: ['--gpu-launcher=/tmp/marker.sh'] });
    expect(r.isError).toBe(true);
    expect(errorOf(r)).toMatch(/not allowed/);
    expect(exec.execFileSync).not.toHaveBeenCalled();
  });

  it('refuses caller text that names an agent-browser option', async () => {
    for (const [name, input] of [
      ['browser_click', { target: '--executable-path' }],
      ['browser_type', { target: '#q', text: '--extension=/tmp/x' }],
      ['browser_open', { url: '--profile' }],
      ['browser_eval', { script: '--state=/tmp/x' }],
    ] as const) {
      const r = await call(name, input);
      expect(r.isError, name).toBe(true);
    }
    expect(exec.execFileSync).not.toHaveBeenCalled();
  });

  it('passes allowlisted switches as a single --args value', async () => {
    await call('browser_open', { url: 'https://example.com', args: ['--disable-gpu', '--mute-audio'] });
    expect(exec.execFileSync).toHaveBeenCalledTimes(1);
    const argv = exec.execFileSync.mock.calls[0][1] as string[];
    const at = argv.indexOf('--args');
    expect(argv[at + 1].split(',')).toEqual(expect.arrayContaining(['--disable-gpu', '--mute-audio']));
    expect(at).toBeGreaterThan(-1);
    expect(argv.filter(a => a === '--args')).toHaveLength(1);
  });
});
