import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression test extending ruvnet/ruflo#3688 / #4050: Codex's native hook
// loader accepts only top-level `description` and `hooks`. Every plugin whose
// Claude hooks/hooks.json declares `modules` must ship a `.codex-plugin`
// override pointing at hooks/codex-hooks.json so Codex does not fail with
// `unknown field 'modules'`. The Claude function-hook manifest stays intact.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ALLOWED = new Set(['description', 'hooks']);
const EXISTING_NATIVE_GUARDS = new Set(['ruflo-adr', 'ruflo-ddd', 'ruflo-sparc']);
const EXISTING_NOOP = new Set(['ruflo-swarm']);
const CARRIED_COMMAND_HOOKS = new Set(['ruflo-metaharness']);

function listFunctionHookPlugins() {
  const pluginsDir = path.join(root, 'plugins');
  return fs.readdirSync(pluginsDir).sort().filter((name) => {
    const hooksPath = path.join(pluginsDir, name, 'hooks', 'hooks.json');
    if (!fs.existsSync(hooksPath)) return false;
    const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    return Object.prototype.hasOwnProperty.call(hooks, 'modules');
  });
}

function assertValidCodexOverride(plugin, options = {}) {
  const pluginRoot = path.join(root, 'plugins', plugin);
  const claudeManifest = JSON.parse(
    fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'),
  );
  const codexManifestPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
  assert.ok(
    fs.existsSync(codexManifestPath),
    `${plugin}: ${codexManifestPath} must exist so Codex prefers it over .claude-plugin/plugin.json (see #3688 / #4050)`,
  );
  const codexManifest = JSON.parse(fs.readFileSync(codexManifestPath, 'utf8'));
  assert.equal(codexManifest.name, claudeManifest.name, `${plugin}: Codex name must match the Claude manifest`);
  assert.equal(codexManifest.version, claudeManifest.version, `${plugin}: Codex version must match the Claude manifest`);
  assert.equal(codexManifest.hooks, './hooks/codex-hooks.json', `${plugin}: Codex manifest must point at hooks/codex-hooks.json`);

  const codexHooksPath = path.join(pluginRoot, 'hooks', 'codex-hooks.json');
  assert.ok(fs.existsSync(codexHooksPath), `${plugin}: ${codexHooksPath} must exist`);
  const codexHooks = JSON.parse(fs.readFileSync(codexHooksPath, 'utf8'));
  const unknown = Object.keys(codexHooks).filter((key) => !ALLOWED.has(key));
  assert.deepEqual(
    unknown,
    [],
    `${plugin}: codex-hooks.json must only use description/hooks at the top level, found: ${unknown.join(', ')}`,
  );
  assert.equal(typeof codexHooks.description, 'string', `${plugin}: description must be a string`);
  assert.equal(typeof codexHooks.hooks, 'object', `${plugin}: hooks must be an object`);
  assert.ok(codexHooks.hooks !== null, `${plugin}: hooks must not be null`);
  assert.ok(!Array.isArray(codexHooks.hooks), `${plugin}: hooks must be a map of event names`);

  const claudeHooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
  assert.ok(Array.isArray(claudeHooks.modules) && claudeHooks.modules.length > 0, `${plugin}: Claude hooks.json must keep modules`);
  for (const modulePath of claudeHooks.modules) {
    assert.ok(
      fs.existsSync(path.join(pluginRoot, 'hooks', modulePath)),
      `${plugin}: Claude module ${modulePath} must remain in place`,
    );
  }

  if (options.expectHooksEmpty) {
    assert.deepEqual(codexHooks.hooks, {}, `${plugin}: Codex should get an explicit no-op, not invented command hooks`);
  }
  if (options.expectEvents) {
    assert.deepEqual(
      Object.keys(codexHooks.hooks).sort(),
      [...options.expectEvents].sort(),
      `${plugin}: Codex hooks events`,
    );
  }
  if (options.expectCarriedFromClaude) {
    assert.deepEqual(
      codexHooks.hooks,
      claudeHooks.hooks,
      `${plugin}: Codex hooks must carry the Claude command hooks and omit modules`,
    );
  }
}

test('every function-hook plugin ships a Codex-valid override and leaves the Claude manifest intact', () => {
  const plugins = listFunctionHookPlugins();
  assert.ok(plugins.length >= 45, `expected the known function-hook plugins, found ${plugins.length}: ${plugins.join(', ')}`);
  for (const plugin of plugins) {
    if (EXISTING_NATIVE_GUARDS.has(plugin)) {
      assertValidCodexOverride(plugin, { expectEvents: ['PreToolUse', 'SessionStart'] });
      continue;
    }
    if (EXISTING_NOOP.has(plugin)) {
      assertValidCodexOverride(plugin, { expectHooksEmpty: true });
      continue;
    }
    if (CARRIED_COMMAND_HOOKS.has(plugin)) {
      assertValidCodexOverride(plugin, { expectEvents: ['SessionStart'], expectCarriedFromClaude: true });
      continue;
    }
    assertValidCodexOverride(plugin, { expectHooksEmpty: true });
  }
});

test('plugin-creator mod template ships a Codex override without a live .codex-plugin tree', () => {
  const tmpl = path.join(root, 'plugins/ruflo-plugin-creator/templates/mod');
  assert.ok(fs.existsSync(path.join(tmpl, 'codex-plugin.json.tmpl')));
  assert.ok(!fs.existsSync(path.join(tmpl, '.codex-plugin')));
  const tmplManifest = JSON.parse(fs.readFileSync(path.join(tmpl, 'codex-plugin.json.tmpl'), 'utf8'));
  assert.equal(tmplManifest.hooks, './hooks/codex-hooks.json');
  const codexHooks = JSON.parse(fs.readFileSync(path.join(tmpl, 'hooks/codex-hooks.json'), 'utf8'));
  const unknown = Object.keys(codexHooks).filter((key) => !ALLOWED.has(key));
  assert.deepEqual(unknown, []);
  assert.ok(Array.isArray(codexHooks.hooks?.UserPromptSubmit));
  const claudeHooks = JSON.parse(fs.readFileSync(path.join(tmpl, 'hooks/hooks.json'), 'utf8'));
  assert.deepEqual(claudeHooks.modules, ['./register.ts']);
  assert.deepEqual(codexHooks.hooks, claudeHooks.hooks);
});

test('this suite is registered with an explicit CI runner', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/all-plugins-smoke.yml'), 'utf8');
  assert.match(
    workflow,
    /node --test tests\/plugins\/codex-swarm-hook-manifest\.test\.mjs tests\/plugins\/codex-function-hook-manifests\.test\.mjs/,
  );
  const excluded = fs.readFileSync(path.join(root, 'scripts/ci-test-excluded.txt'), 'utf8');
  assert.match(excluded, /^tests\/plugins\/codex-function-hook-manifests\.test\.mjs$/m);
});
