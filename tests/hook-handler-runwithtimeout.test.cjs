'use strict';
/**
 * Unit tests for hook-handler.cjs runWithTimeout (FIX 1).
 *
 * The previous implementation called fn() and clearTimeout(timer) immediately,
 * so an async fn returned a *pending* promise that resolved through the race —
 * the timeout never fired. The "times out a slow async fn" case below fails
 * against the old code (it would return 'late') and passes against the fix.
 *
 * Uses node:test (built-in) so it runs without installing dependencies.
 */
// Both copies must also remain importable after a helper sync (#3206).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');

const root = path.join(__dirname, '..');
for (const [label, relative] of [
  ['root dogfood', '.claude/helpers/hook-handler.cjs'],
  ['packaged', 'v3/@claude-flow/cli/.claude/helpers/hook-handler.cjs'],
]) {
  test(`${label}: import surface and runWithTimeout`, async (t) => {
    const helper = path.join(root, relative);
    const cwd = mkdtempSync(path.join(tmpdir(), 'helper-import-'));
    const marker = 'HELPER_IMPORT_RETURNED_WITH_EXPORTS';
    try {
      // An unguarded main() can exit 0 before registering any tests. Keep
      // that import out of the parent and require a marker AFTER it returns.
      const child = spawnSync(process.execPath, ['-e', `
        const assert = require('node:assert/strict');
        const helper = require(process.argv[1]);
        assert.equal(typeof helper.runWithTimeout, 'function');
        assert.equal(typeof helper.INTELLIGENCE_TIMEOUT_MS, 'number');
        assert.ok(Number.isFinite(helper.INTELLIGENCE_TIMEOUT_MS) && helper.INTELLIGENCE_TIMEOUT_MS > 0);
        console.log(${JSON.stringify(marker)});
      `, helper], { cwd, input: '', encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
      assert.ifError(child.error);
      assert.equal(child.signal, null, child.stderr);
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stdout.trim(), marker, 'require must return without running main()');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    const { runWithTimeout, INTELLIGENCE_TIMEOUT_MS } = require(helper);
    await t.test('returns the value for a fast async fn', async () => {
      assert.equal(await runWithTimeout(() => Promise.resolve(42), 'fast-async'), 42);
    });
    await t.test('returns the value for a fast sync fn', async () => {
      assert.equal(await runWithTimeout(() => 7, 'fast-sync'), 7);
    });
    await t.test('resolves null (never rejects) when fn throws synchronously', async () => {
      assert.equal(await runWithTimeout(() => { throw new Error('boom'); }, 'sync-throw'), null);
    });
    await t.test('resolves null (never rejects) when an async fn rejects', async () => {
      assert.equal(await runWithTimeout(() => Promise.reject(new Error('boom')), 'async-reject'), null);
    });
    await t.test('times out a slow async fn and resolves null near the timeout', { timeout: 8000 }, async () => {
      const start = Date.now();
      const result = await runWithTimeout(() => new Promise((res) => {
        const timer = setTimeout(() => res('late'), INTELLIGENCE_TIMEOUT_MS + 2000);
        timer.unref();
      }), 'slow-async');
      const elapsed = Date.now() - start;
      assert.equal(result, null, 'should time out to null, not return the late value');
      assert.ok(elapsed >= INTELLIGENCE_TIMEOUT_MS - 200 && elapsed < INTELLIGENCE_TIMEOUT_MS + 1500,
        `should resolve near ${INTELLIGENCE_TIMEOUT_MS}ms, took ${elapsed}ms`);
    });
  });
}
