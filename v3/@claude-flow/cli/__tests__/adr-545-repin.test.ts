/**
 * ADR-545 — `ruflo init repin`: rewrite an existing project's floating refs
 * to ruflo's packages, idempotently, with a dry run and a per-line report,
 * without touching anything else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repinProject, formatRepinReport, isSignedHelper } from '../src/init/repin.js';
import { pinnedVersion } from '../src/init/pinning.js';
import { initCommand } from '../src/commands/init.js';
import type { CommandContext } from '../src/types.js';

const V = pinnedVersion()!;

const SETTINGS = `{
  "hooks": {
    "PostToolUse": [
      { "hooks": [
        { "type": "command", "command": "npx @claude-flow/cli@latest memory store --key x" },
        { "type": "command", "command": "npx @claude-flow/cli@latest hooks post-edit --file x" }
      ] }
    ]
  },
  "permissions": { "allow": ["Bash(npx @claude-flow*)"] }
}
`;

const MCP = `{
  "mcpServers": {
    "claude-flow": {
      "command": "npx",
      "args": ["-y", "ruflo@latest", "mcp", "start"]
    },
    "claude-flow@alpha": {
      "command": "npx",
      "args": ["-y", "claude-flow@alpha", "mcp", "start"]
    },
    "other": { "command": "npx", "args": ["-y", "some-tool@latest"] }
  }
}
`;

const CLAUDE_MD = `# Project

My notes mention my-ruflo@latest and @claude-flow/memory@latest — not ours.
The hooks bug was fixed in ruflo@3.7.0, so we stayed on it.

\`\`\`bash
npx ruflo@latest doctor --fix
npx @claude-flow/cli@v3alpha hooks route --task "x"
npx claude-flow@3.0.0 swarm init
\`\`\`
`;

describe('repinProject', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'adr545-repin-'));
    mkdirSync(join(dir, '.claude', 'helpers'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), SETTINGS);
    writeFileSync(join(dir, '.mcp.json'), MCP);
    writeFileSync(join(dir, 'CLAUDE.md'), CLAUDE_MD);
    writeFileSync(join(dir, '.claude', 'helpers', 'setup-mcp.sh'), '#!/bin/sh\nclaude mcp add claude-flow npx @claude-flow/cli@latest mcp start\n');
    writeFileSync(join(dir, '.claude', 'helpers', 'auto-memory-hook.mjs'), "const l = 'npx ruflo@latest init';\n");
  });

  it('pins untagged runs in helper scripts, not in CLAUDE.md', () => {
    writeFileSync(join(dir, '.claude', 'helpers', 'pre-commit'), '#!/bin/bash\nnpx @claude-flow/cli hooks pre-edit --file x\n');
    writeFileSync(join(dir, 'CLAUDE.md'), 'Run `npx ruflo doctor` when stuck.\n');
    const report = repinProject(dir, { version: V });
    expect(read('.claude/helpers/pre-commit')).toBe(`#!/bin/bash\nnpx @claude-flow/cli@${V} hooks pre-edit --file x\n`);
    expect(read('CLAUDE.md')).toBe('Run `npx ruflo doctor` when stuck.\n');
    expect(report.files.find((f) => f.file === '.claude/helpers/pre-commit')!.changes).toHaveLength(1);
    expect(repinProject(dir, { version: V }).changedLines).toBe(0);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const read = (rel: string) => readFileSync(join(dir, rel), 'utf-8');

  it('rewrites exactly the floating refs to our packages and reports each line', () => {
    const report = repinProject(dir, { version: V });
    expect(report.target).toBe(V);

    const mcp = JSON.parse(read('.mcp.json'));
    expect(mcp.mcpServers['claude-flow'].args).toEqual(['-y', `ruflo@${V}`, 'mcp', 'start']);
    expect(mcp.mcpServers['claude-flow@alpha'].args).toEqual(['-y', `claude-flow@${V}`, 'mcp', 'start']);
    expect(mcp.mcpServers.other.args).toEqual(['-y', 'some-tool@latest']);
    // Only the two version lines changed; key, formatting and everything else are byte-identical.
    expect(read('.mcp.json')).toBe(MCP.replace('"ruflo@latest"', `"ruflo@${V}"`).replace('"claude-flow@alpha", "mcp"', `"claude-flow@${V}", "mcp"`));

    expect(read('CLAUDE.md')).toBe(CLAUDE_MD
      .replace('npx ruflo@latest doctor', `npx ruflo@${V} doctor`)
      .replace('@claude-flow/cli@v3alpha', `@claude-flow/cli@${V}`)
      .replace('claude-flow@3.0.0', `claude-flow@${V}`));

    // settings.json: the sibling CLI command is pinned; the runaway hooks form is left for `init upgrade --settings`.
    const settings = read('.claude/settings.json');
    expect(settings).toContain(`npx @claude-flow/cli@${V} memory store`);
    expect(settings).toContain('npx @claude-flow/cli@latest hooks post-edit');
    expect(settings).toContain('"Bash(npx @claude-flow*)"');

    expect(read('.claude/helpers/setup-mcp.sh')).toContain(`@claude-flow/cli@${V} mcp start`);
    // Signed helper untouched.
    expect(read('.claude/helpers/auto-memory-hook.mjs')).toBe("const l = 'npx ruflo@latest init';\n");

    const byFile = Object.fromEntries(report.files.map((f) => [f.file, f]));
    expect(byFile['.mcp.json'].changes.map((c) => c.line)).toEqual([5, 9]);
    expect(byFile['CLAUDE.md'].changes).toHaveLength(3);
    expect(byFile['.claude/settings.json'].changes).toHaveLength(1);
    expect(byFile['.claude/settings.json'].skippedLines[0].reason).toMatch(/init upgrade --settings/);
    expect(byFile['.claude/helpers/auto-memory-hook.mjs'].status).toBe('skipped');
    expect(byFile['.claude/helpers/auto-memory-hook.mjs'].reason).toMatch(/signed helper/);
    expect(report.changedFiles).toBe(4);
    expect(report.changedLines).toBe(7);

    const lines = formatRepinReport(report).join('\n');
    expect(lines).toContain('.mcp.json:5');
    expect(lines).toContain(`+ "args": ["-y", "ruflo@${V}", "mcp", "start"]`);
  });

  it('never rewrites a ref used as a JSON key', () => {
    writeFileSync(join(dir, '.mcp.json'), '{"mcpServers":{"ruflo@latest":{"command":"npx","args":["ruflo@latest"]}}}\n');
    const report = repinProject(dir, { version: V });
    expect(read('.mcp.json')).toBe('{"mcpServers":{"ruflo@latest":{"command":"npx","args":["ruflo@latest"]}}}\n');
    expect(report.files.find((f) => f.file === '.mcp.json')!.skippedLines[0].reason).toMatch(/JSON key/);
  });

  it('is idempotent', () => {
    repinProject(dir, { version: V });
    const snapshot = ['.mcp.json', 'CLAUDE.md', '.claude/settings.json', '.claude/helpers/setup-mcp.sh'].map(read);
    const again = repinProject(dir, { version: V });
    expect(again.changedLines).toBe(0);
    expect(again.changedFiles).toBe(0);
    expect(['.mcp.json', 'CLAUDE.md', '.claude/settings.json', '.claude/helpers/setup-mcp.sh'].map(read)).toEqual(snapshot);
  });

  it('dry run reports the same changes and writes nothing', () => {
    const dry = repinProject(dir, { version: V, dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.changedLines).toBe(7);
    expect(read('.mcp.json')).toBe(MCP);
    expect(read('CLAUDE.md')).toBe(CLAUDE_MD);
    expect(read('.claude/settings.json')).toBe(SETTINGS);
    expect(formatRepinReport(dry)[0]).toMatch(/would change/);
    const real = repinProject(dir, { version: V });
    expect(real.files.map((f) => f.changes)).toEqual(dry.files.map((f) => f.changes));
  });

  it('--channel latest moves pins back to @latest', () => {
    repinProject(dir, { version: V });
    const back = repinProject(dir, { channel: 'latest' });
    expect(back.target).toBe('latest');
    expect(JSON.parse(read('.mcp.json')).mcpServers['claude-flow'].args).toContain('ruflo@latest');
    expect(read('CLAUDE.md')).not.toContain(`@${V}`);
  });

  it('skips symlinks and missing files', () => {
    rmSync(join(dir, 'CLAUDE.md'));
    symlinkSync('/etc/hostname', join(dir, 'CLAUDE.md'));
    rmSync(join(dir, '.mcp.json'));
    const report = repinProject(dir, { version: V });
    expect(report.files.find((f) => f.file === 'CLAUDE.md')!.status).toBe('skipped');
    expect(report.files.find((f) => f.file === '.mcp.json')!.status).toBe('missing');
  });

  it('refuses to pin without a known version', () => {
    expect(() => repinProject(dir, { version: null })).toThrow(/Cannot determine/);
  });

  it('knows which helpers are signed', () => {
    expect(isSignedHelper('hook-handler.cjs')).toBe(true);
    expect(isSignedHelper('helpers.manifest.json')).toBe(true);
    expect(isSignedHelper('setup-mcp.sh')).toBe(false);
  });
});

describe('ruflo init repin / init --repin', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'adr545-repin-cmd-'));
    writeFileSync(join(dir, '.mcp.json'), MCP);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const ctx = (flags: Record<string, unknown>): CommandContext =>
    ({ args: [], flags, cwd: dir, interactive: false } as unknown as CommandContext);

  it('`init repin --dry-run` reports and writes nothing', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const sub = initCommand.subcommands!.find((c) => c.name === 'repin')!;
    const result = await sub.action!(ctx({ dryRun: true }));
    expect(result?.success).toBe(true);
    expect((result?.data as { changedLines: number }).changedLines).toBe(2);
    expect(readFileSync(join(dir, '.mcp.json'), 'utf-8')).toBe(MCP);
  });

  it('`init --repin` routes to the same action and writes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await initCommand.action!(ctx({ repin: true }));
    expect(result?.success).toBe(true);
    expect(readFileSync(join(dir, '.mcp.json'), 'utf-8')).toContain(`"ruflo@${V}"`);
  });

  it('rejects an unknown --channel', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await initCommand.action!(ctx({ repin: true, channel: 'nightly' }));
    expect(result?.success).toBe(false);
  });
});
