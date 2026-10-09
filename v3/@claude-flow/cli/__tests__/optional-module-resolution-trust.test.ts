/**
 * The CLI, its MCP tools and plugin scripts load optional modules and plugin
 * scripts that they then execute. Those must resolve from the tool's own
 * install (or the user's marketplace checkout), never from the cwd: the cwd
 * is the opened project, and a project must not choose code that runs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../../../..');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-optional-module-')));
  tempRoots.push(root);
  return root;
}

function write(file: string, content: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** Source of `function name(...) { ... }` up to the next top-level closing brace. */
function fnSource(file: string, name: string): string {
  const source = readFileSync(resolve(REPO, file), 'utf8');
  const start = source.search(new RegExp(`function ${name}\\(`));
  expect(start, `${name} in ${file}`).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('\n}\n', start));
}

describe('locators of executed modules never consult the cwd', () => {
  const cases: Array<[string, string]> = [
    ['v3/@claude-flow/cli/src/mcp-tools/testgen-tools.ts', 'locateTestgenScripts'],
    ['v3/@claude-flow/cli/src/mcp-tools/metaharness-tools.ts', 'locatePluginScripts'],
    ['v3/@claude-flow/cli/src/commands/metaharness.ts', 'locatePluginScripts'],
    ['v3/@claude-flow/cli/src/commands/doctor.ts', 'checkMetaharnessIntegration'],
    ['v3/@claude-flow/cli/src/commands/init.ts', 'resolveCodexInitializer'],
    ['plugins/ruflo-ruos/scripts/lib/ledger.mjs', 'resolveCallTool'],
  ];
  for (const [file, name] of cases) {
    it(`${file} ${name}()`, () => {
      // Comments may still describe the old cwd lookup; only code counts.
      const body = fnSource(file, name).split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
      expect(body).not.toMatch(/process\.cwd\(\)|getProjectCwd\(\)|join\(cwd,/);
    });
  }

  it('embedding-service resolves agentic-flow from its own package only', () => {
    const source = readFileSync(resolve(REPO, 'v3/@claude-flow/embeddings/src/embedding-service.ts'), 'utf8');
    expect(source).not.toContain("path.join(cwd, 'node_modules/agentic-flow");
    expect(source).not.toContain('/workspaces/claude-flow/node_modules');
    expect(source).toContain("require.resolve('agentic-flow/package.json')");
  });

  it('compact.mjs does not resolve the token optimizer from the cwd', () => {
    const source = readFileSync(resolve(REPO, 'plugins/ruflo-cost-tracker/scripts/compact.mjs'), 'utf8');
    expect(source).not.toContain("tryResolveFrom(join(process.cwd(), 'package.json'))");
  });
});

describe('ruflo-ruos resolveCallTool at runtime', () => {
  it("never imports a dispatcher planted in the project's node_modules", async () => {
    const project = scratch();
    const marker = join(project, 'planted-dispatcher-ran');
    const planted = `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, '1');\nexport function callMCPTool() {}\n`;
    write(join(project, 'node_modules', '@claude-flow', 'cli', 'package.json'), JSON.stringify({ name: '@claude-flow/cli', type: 'module' }));
    write(join(project, 'node_modules', '@claude-flow', 'cli', 'dist', 'src', 'mcp-client.js'), planted);

    const { resolveCallTool } = await import(pathToFileURL(resolve(REPO, 'plugins/ruflo-ruos/scripts/lib/ledger.mjs')).href);
    await resolveCallTool(project, {});

    expect(existsSync(marker)).toBe(false);
  });
});

describe('cost-tracker compact.mjs at runtime', () => {
  it("never imports a token optimizer planted in the project's node_modules", () => {
    const project = scratch();
    const marker = join(project, 'planted-optimizer-ran');
    const pkg = join(project, 'node_modules', '@claude-flow', 'integration');
    write(join(pkg, 'package.json'), JSON.stringify({
      name: '@claude-flow/integration',
      type: 'module',
      exports: { './token-optimizer': './token-optimizer.js' },
    }));
    write(join(pkg, 'token-optimizer.js'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, '1');\n`);
    write(join(project, 'package.json'), JSON.stringify({ name: 'untrusted' }));

    const result = spawnSync(process.execPath, [resolve(REPO, 'plugins/ruflo-cost-tracker/scripts/compact.mjs'), 'query'], {
      cwd: project,
      env: { ...process.env, COMPACT_QUIET: '1' },
      encoding: 'utf8',
      timeout: 60_000,
    });

    expect(result.error).toBeUndefined();
    expect(existsSync(marker)).toBe(false);
  });
});
