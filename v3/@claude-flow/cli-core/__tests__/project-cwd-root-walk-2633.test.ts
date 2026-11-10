/**
 * ruvnet/ruflo#2633 — getProjectCwd() must anchor to the Ruflo project root
 * when the process cwd has drifted into a subdirectory (the agent Bash tool's
 * cwd is sticky across calls, and MCP servers/hooks inherit it).
 *
 * Each fixture root carries an empty `.git/` so the walk stops there and the
 * result never depends on markers elsewhere on this machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getProjectCwd } from '../src/mcp-tools/types.js';

const SAVED_ENV = { ...process.env };

describe('#2633 getProjectCwd project-root walk', () => {
  let base: string;
  let proj: string;
  let deep: string;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'cli-core-2633-')));
    proj = join(base, 'proj');
    deep = join(proj, 'src', 'deep');
    mkdirSync(deep, { recursive: true });
    mkdirSync(join(proj, '.git'));
    delete process.env.CLAUDE_FLOW_CWD;
    vi.spyOn(process, 'cwd').mockReturnValue(deep);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...SAVED_ENV };
    rmSync(base, { recursive: true, force: true });
  });

  it('walks up from a drifted cwd to the initialized project root', () => {
    mkdirSync(join(proj, '.claude-flow'));
    writeFileSync(join(proj, '.claude-flow', 'config.yaml'), 'version: 3\n');
    expect(getProjectCwd()).toBe(proj);
  });

  it('falls back to process.cwd() when no marker exists (unchanged behaviour)', () => {
    expect(getProjectCwd()).toBe(deep);
  });

  it('does not walk past the .git repository boundary', () => {
    writeFileSync(join(base, 'claude-flow.config.json'), '{}');
    expect(getProjectCwd()).toBe(deep);
  });

  it('nearest marker wins', () => {
    writeFileSync(join(proj, 'claude-flow.config.json'), '{}');
    writeFileSync(join(proj, 'src', 'claude-flow.config.json'), '{}');
    expect(getProjectCwd()).toBe(join(proj, 'src'));
  });

  it('CLAUDE_FLOW_CWD keeps precedence', () => {
    writeFileSync(join(proj, 'claude-flow.config.json'), '{}');
    process.env.CLAUDE_FLOW_CWD = base;
    expect(getProjectCwd()).toBe(base);
  });

  it('never creates directories while walking', () => {
    writeFileSync(join(proj, 'claude-flow.config.json'), '{}');
    getProjectCwd();
    expect(existsSync(join(deep, '.claude-flow'))).toBe(false);
    expect(existsSync(join(proj, '.claude-flow'))).toBe(false);
    expect(existsSync(join(proj, '.swarm'))).toBe(false);
  });
});
