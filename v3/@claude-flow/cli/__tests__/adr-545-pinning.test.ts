/**
 * ADR-545 — `ruflo init` pins ruflo's own packages to the running CLI version.
 *
 * Covers the specifier helpers, every generator that wrote `@latest`, a real
 * executeInit run on both channels, the helper copy path (signed helpers are
 * copied byte for byte, the rest are pinned), and that helper auto-refresh
 * does not undo pins.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';

import {
  copyFilePinned,
  cliDependencySpec,
  isExactVersion,
  npxOurs,
  ourSpec,
  parseReleaseChannel,
  pinnedVersion,
  readCliPackageVersion,
  rewriteOurRefs,
  setPinnedVersionForTesting,
  thirdPartySpec,
  THIRD_PARTY_PINS,
} from '../src/init/pinning.js';
import { generateMCPCommands, generateMCPConfig } from '../src/init/mcp-generator.js';
import { generateClaudeMd } from '../src/init/claudemd-generator.js';
import { generateAutoMemoryHook, generatePostCommitHook, generatePreCommitHook, generateRufloHookCjs } from '../src/init/helpers-generator.js';
import { executeInit } from '../src/init/executor.js';
import { autoRefreshHelpersIfStale, HELPERS_STAMP_FILE } from '../src/init/helper-refresh.js';
import { canonicalManifestBytes, sha256Hex } from '../src/init/helper-signing.js';
import { DEFAULT_INIT_OPTIONS, FULL_INIT_OPTIONS, type ClaudeMdTemplate, type InitOptions } from '../src/init/types.js';

const VERSION = pinnedVersion()!;
const FLOATING_OURS = /(?<![\w@/.-])(?:@claude-flow\/cli|claude-flow|ruflo)@(?:latest|alpha|v3alpha|next|beta)\b/;
const TEMPLATES: ClaudeMdTemplate[] = ['minimal', 'standard', 'full', 'security', 'performance', 'solo'];

describe('pinning helpers', () => {
  afterEach(() => setPinnedVersionForTesting(undefined));

  it('reads the exact version from the CLI package.json', () => {
    expect(isExactVersion(VERSION)).toBe(true);
    expect(readCliPackageVersion()).toBe(VERSION);
  });

  it('ourSpec pins on the default channel and floats on latest', () => {
    expect(ourSpec('ruflo')).toBe(`ruflo@${VERSION}`);
    expect(ourSpec('@claude-flow/cli', 'pinned')).toBe(`@claude-flow/cli@${VERSION}`);
    expect(ourSpec('claude-flow', 'latest')).toBe('claude-flow@latest');
    expect(npxOurs('ruflo')).toBe(`npx ruflo@${VERSION}`);
  });

  it('never invents a pin when the version is unknown', () => {
    setPinnedVersionForTesting(null);
    expect(ourSpec('ruflo')).toBe('ruflo@latest');
  });

  it('pins third-party servers to their recorded versions, floats them on latest', () => {
    expect(thirdPartySpec('flow-nexus')).toBe(`flow-nexus@${THIRD_PARTY_PINS['flow-nexus'].version}`);
    expect(thirdPartySpec('ruv-swarm')).toBe(`ruv-swarm@${THIRD_PARTY_PINS['ruv-swarm'].version}`);
    expect(thirdPartySpec('flow-nexus', 'latest')).toBe('flow-nexus@latest');
    expect(thirdPartySpec('ruv-swarm', 'latest')).toBe('ruv-swarm');
  });

  it('pins the codex adapter to the version the CLI declares', () => {
    const declared = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')).dependencies['@claude-flow/codex'];
    expect(cliDependencySpec('@claude-flow/codex')).toBe(`@claude-flow/codex@${declared}`);
    expect(cliDependencySpec('@claude-flow/codex', 'latest')).toBe('@claude-flow/codex@latest');
  });

  it('parses --channel', () => {
    expect(parseReleaseChannel(undefined)).toBe('pinned');
    expect(parseReleaseChannel('latest')).toBe('latest');
    expect(parseReleaseChannel('pinned')).toBe('pinned');
    expect(parseReleaseChannel('nightly')).toEqual({ error: expect.stringContaining('pinned, latest') });
  });

  it('rewriteOurRefs touches only our specifiers and reports each line', () => {
    const text = [
      'npx ruflo@latest doctor',
      'npx my-ruflo@latest x', // another package
      'npm i @claude-flow/memory@latest', // not one of the three
      '"args": ["-y", "@claude-flow/cli@alpha", "claude-flow@v3alpha"]',
      'unrelated line',
      `npx ruflo@${VERSION} already pinned`,
    ].join('\r\n');
    const { text: out, changes } = rewriteOurRefs(text, VERSION);
    expect(changes.map((c) => c.line)).toEqual([1, 4]);
    expect(out.split('\r\n')).toEqual([
      `npx ruflo@${VERSION} doctor`,
      'npx my-ruflo@latest x',
      'npm i @claude-flow/memory@latest',
      `"args": ["-y", "@claude-flow/cli@${VERSION}", "claude-flow@${VERSION}"]`,
      'unrelated line',
      `npx ruflo@${VERSION} already pinned`,
    ]);
    expect(rewriteOurRefs(out, VERSION).changes).toEqual([]);
  });
});

describe('untagged runs (npx @claude-flow/cli …) float too', () => {
  const script = [
    'npx @claude-flow/cli hooks pre-edit --file "$F"',
    'npx -y ruflo mcp start',
    'npm exec --yes claude-flow -- doctor',
    'npx --prefer-offline --prefix "$ROOT" @claude-flow/cli hooks x',
    'npx ruflo-extra run',
    'echo see claude-flow docs',
  ].join('\n');

  it('are pinned only when asked, and only for an exact target', () => {
    expect(rewriteOurRefs(script, VERSION).changes).toEqual([]);
    expect(rewriteOurRefs(script, 'latest', undefined, 'all', true).changes).toEqual([]);
    const out = rewriteOurRefs(script, VERSION, undefined, 'all', true);
    expect(out.text.split('\n')).toEqual([
      `npx @claude-flow/cli@${VERSION} hooks pre-edit --file "$F"`,
      `npx -y ruflo@${VERSION} mcp start`,
      `npm exec --yes claude-flow@${VERSION} -- doctor`,
      'npx --prefer-offline --prefix "$ROOT" @claude-flow/cli hooks x',
      'npx ruflo-extra run',
      'echo see claude-flow docs',
    ]);
    expect(out.changes.map((c) => c.line)).toEqual([1, 2, 3]);
    expect(rewriteOurRefs(out.text, VERSION, undefined, 'all', true).changes).toEqual([]);
  });

  it('copyFilePinned pins them in scripts but not in docs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr545-bare-'));
    try {
      writeFileSync(join(dir, 'src'), 'npx @claude-flow/cli hooks notify\n');
      copyFilePinned(join(dir, 'src'), join(dir, 'script'), 'pinned', true);
      copyFilePinned(join(dir, 'src'), join(dir, 'doc'));
      expect(readFileSync(join(dir, 'script'), 'utf-8')).toBe(`npx @claude-flow/cli@${VERSION} hooks notify\n`);
      expect(readFileSync(join(dir, 'doc'), 'utf-8')).toBe('npx @claude-flow/cli hooks notify\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('copyFilePinned (skills, commands, agents, non-signed helpers)', () => {
  it('pins floating tags, keeps historical exact versions, copies binaries verbatim', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr545-copy-'));
    try {
      const src = join(dir, 'SKILL.md');
      writeFileSync(src, 'npx @claude-flow/cli@latest hooks route\nRegression fixed in claude-flow@2.7.0.\n');
      copyFilePinned(src, join(dir, 'pinned.md'));
      expect(readFileSync(join(dir, 'pinned.md'), 'utf-8')).toBe(`npx @claude-flow/cli@${VERSION} hooks route\nRegression fixed in claude-flow@2.7.0.\n`);
      copyFilePinned(src, join(dir, 'floating.md'), 'latest');
      expect(readFileSync(join(dir, 'floating.md'), 'utf-8')).toBe(readFileSync(src, 'utf-8'));
      const bin = Buffer.from([0, 1, 2, ...Buffer.from('ruflo@latest')]);
      writeFileSync(join(dir, 'a.bin'), bin);
      copyFilePinned(join(dir, 'a.bin'), join(dir, 'b.bin'));
      expect(readFileSync(join(dir, 'b.bin')).equals(bin)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('generators emit pinned refs by default', () => {
  const opts = (channel?: 'pinned' | 'latest'): InitOptions => ({
    ...structuredClone(FULL_INIT_OPTIONS),
    mcp: { ...FULL_INIT_OPTIONS.mcp, claudeFlow: true, ruvSwarm: true, flowNexus: true },
    channel,
  });

  it('.mcp.json servers', () => {
    const servers = (generateMCPConfig(opts()) as { mcpServers: Record<string, { args: string[] }> }).mcpServers;
    expect(servers['claude-flow'].args).toContain(`ruflo@${VERSION}`);
    expect(servers['ruv-swarm'].args).toContain(thirdPartySpec('ruv-swarm'));
    expect(servers['flow-nexus'].args).toContain(thirdPartySpec('flow-nexus'));
    const floating = (generateMCPConfig(opts('latest')) as { mcpServers: Record<string, { args: string[] }> }).mcpServers;
    expect(floating['claude-flow'].args).toContain('ruflo@latest');
    expect(floating['ruv-swarm'].args).toContain('ruv-swarm');
    expect(floating['flow-nexus'].args).toContain('flow-nexus@latest');
  });

  it('claude mcp add commands', () => {
    for (const cmd of generateMCPCommands(opts())) expect(cmd).not.toMatch(/@latest|ruv-swarm mcp/);
    expect(generateMCPCommands(opts()).join('\n')).toContain(`npx -y ruflo@${VERSION} mcp start`);
    expect(generateMCPCommands(opts('latest')).join('\n')).toContain('npx -y ruflo@latest mcp start');
  });

  for (const template of TEMPLATES) {
    it(`CLAUDE.md (${template}) has no floating ref to our packages`, () => {
      const md = generateClaudeMd(opts(), template);
      expect(md).not.toMatch(FLOATING_OURS);
      expect(generateClaudeMd(opts('latest'), template)).not.toContain(`@${VERSION}`);
    });
  }

  it('the full CLAUDE.md pins the CLI and the ruflo wrapper', () => {
    const md = generateClaudeMd(opts(), 'full');
    expect(md).toContain(`npx @claude-flow/cli@${VERSION} hooks pre-task`);
    expect(md).toContain(`claude mcp add claude-flow -- npx -y ruflo@${VERSION} mcp start`);
  });

  it('generated helper scripts', () => {
    expect(generatePostCommitHook()).toContain(`npx ruflo@${VERSION} hooks notify`);
    expect(generateAutoMemoryHook()).toContain(`npx ruflo@${VERSION} init`);
    expect(generateRufloHookCjs()).toContain(`'ruflo@${VERSION}'`);
    for (const out of [generatePostCommitHook(), generateAutoMemoryHook(), generateRufloHookCjs()]) {
      expect(out).not.toMatch(FLOATING_OURS);
    }
    expect(generatePostCommitHook('latest')).toContain('npx ruflo@latest hooks notify');
    expect(generatePreCommitHook()).toContain(`npx @claude-flow/cli@${VERSION} hooks pre-edit`);
    expect(generatePreCommitHook('latest')).toContain('npx @claude-flow/cli@latest hooks pre-edit');
  });
});

describe('executeInit on both channels', () => {
  let dir: string;
  let configDir: string;
  let savedConfigDir: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'adr545-init-'));
    configDir = mkdtempSync(join(tmpdir(), 'adr545-cfg-'));
    savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
  });
  afterEach(() => {
    if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
    rmSync(dir, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
  });

  const run = async (channel?: 'pinned' | 'latest') => {
    const options: InitOptions = structuredClone(DEFAULT_INIT_OPTIONS);
    options.targetDir = dir;
    options.skipGlobalClaudeMd = true;
    options.components = { ...options.components, skills: false, commands: false, agents: false };
    if (channel) options.channel = channel;
    const result = await executeInit(options);
    expect(result.success).toBe(true);
  };

  /** Every generated text file except the signed helpers (copied verbatim). */
  const generatedFiles = (): string[] => {
    const files = ['.mcp.json', 'CLAUDE.md', '.claude/settings.json'];
    const helpers = join(dir, '.claude', 'helpers');
    if (existsSync(helpers)) {
      const signed = new Set(['auto-memory-hook.mjs', 'hook-handler.cjs', 'intelligence.cjs', 'learning-loop.cjs', 'memory.cjs', 'router.cjs', 'session.cjs', 'statusline.cjs', 'helpers.manifest.json']);
      for (const f of readdirSync(helpers)) if (!signed.has(f)) files.push(`.claude/helpers/${f}`);
    }
    for (const f of ['.claude-flow/CAPABILITIES.md', '.claude-flow/metrics/v3-progress.json', '.claude-flow/security/audit-status.json']) files.push(f);
    return files.filter((f) => existsSync(join(dir, f)));
  };

  it('default (pinned): no generated file floats a ref to our packages', async () => {
    await run();
    const files = generatedFiles();
    expect(files).toContain('.mcp.json');
    expect(files).toContain('CLAUDE.md');
    for (const f of files) {
      expect(readFileSync(join(dir, f), 'utf-8'), f).not.toMatch(FLOATING_OURS);
    }
    const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(mcp.mcpServers['claude-flow'].args).toContain(`ruflo@${VERSION}`);
    expect(readFileSync(join(dir, '.claude-flow', 'CAPABILITIES.md'), 'utf-8')).toContain(`npx @claude-flow/cli@${VERSION}`);
  });

  it('a packaged non-signed helper with @latest is pinned on copy', async () => {
    await run();
    const setup = join(dir, '.claude', 'helpers', 'setup-mcp.sh');
    expect(existsSync(setup)).toBe(true); // copied from the packaged .claude/helpers
    expect(readFileSync(setup, 'utf-8')).toContain(`@claude-flow/cli@${VERSION} mcp start`);
  });

  it('no unsigned helper runs one of our packages untagged', async () => {
    await run();
    const bare = /\b(?:npx|bunx|npm\s+exec)(?:\s+--?\w[\w-]*(?:=\S+)?)*\s+(?:@claude-flow\/cli|claude-flow|ruflo)(?=$|[\s"'`;|&)])/m;
    const helpers = generatedFiles().filter((f) => f.startsWith('.claude/helpers/'));
    expect(helpers).toContain('.claude/helpers/post-commit');
    for (const f of helpers) expect(readFileSync(join(dir, f), 'utf-8'), f).not.toMatch(bare);
  });

  it('--channel latest keeps the floating refs', async () => {
    await run('latest');
    const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(mcp.mcpServers['claude-flow'].args).toContain('ruflo@latest');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).not.toContain(`@${VERSION}`);
  });
});

describe('helper auto-refresh does not undo pins', () => {
  it('re-copies the signed helper and leaves pinned files alone', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'adr545-refresh-'));
    const helpersDir = join(cwd, '.claude', 'helpers');
    mkdirSync(helpersDir, { recursive: true });
    const pinnedFiles: Record<string, string> = {
      '.mcp.json': JSON.stringify({ mcpServers: { 'claude-flow': { command: 'npx', args: ['-y', `ruflo@${VERSION}`, 'mcp', 'start'] } } }, null, 2),
      'CLAUDE.md': `npx @claude-flow/cli@${VERSION} doctor\n`,
      '.claude/helpers/setup-mcp.sh': `claude mcp add claude-flow npx @claude-flow/cli@${VERSION} mcp start\n`,
    };
    for (const [rel, body] of Object.entries(pinnedFiles)) writeFileSync(join(cwd, rel), body);
    writeFileSync(join(helpersDir, 'hook-handler.cjs'), '// OLD\n');
    writeFileSync(join(helpersDir, HELPERS_STAMP_FILE), '0.0.1-old');

    // Signed source whose non-signed helper still says @latest.
    const sourceDir = mkdtempSync(join(tmpdir(), 'adr545-refresh-src-'));
    const content = '// NEW signed handler\n';
    writeFileSync(join(sourceDir, 'hook-handler.cjs'), content);
    writeFileSync(join(sourceDir, 'setup-mcp.sh'), 'claude mcp add claude-flow npx @claude-flow/cli@latest mcp start\n');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const manifest = { version: VERSION, files: { 'hook-handler.cjs': sha256Hex(content) } };
    const signature = edSign(null, canonicalManifestBytes(manifest), privateKey).toString('base64');
    writeFileSync(join(sourceDir, 'helpers.manifest.json'), JSON.stringify({ manifest, signature, algorithm: 'ed25519' }));

    try {
      const r = await autoRefreshHelpersIfStale(cwd, {
        sourceDirOverride: sourceDir,
        pubkeyPemOverride: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      });
      expect(r.refreshed).toBe(true);
      expect(readFileSync(join(helpersDir, 'hook-handler.cjs'), 'utf-8')).toBe(content);
      for (const [rel, body] of Object.entries(pinnedFiles)) expect(readFileSync(join(cwd, rel), 'utf-8'), rel).toBe(body);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });
});
