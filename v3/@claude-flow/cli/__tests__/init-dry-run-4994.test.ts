/**
 * #4994: `init --dry-run` used to be honoured only by --grok; every other mode
 * ignored it and ran a real init (project scaffold, $HOME/.codex, mods enable).
 * It must now write nothing and say so.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initCommand } from '../src/commands/init.js';

describe('init --dry-run (#4994)', () => {
  for (const flags of [{}, { codex: true }, { dual: true }]) {
    it(`writes nothing with ${JSON.stringify(flags)}`, async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'ruflo-dry-'));
      try {
        const result = await initCommand.action!({
          args: [], cwd, interactive: false, flags: { ...flags, 'dry-run': true, dryRun: true },
        } as never);
        expect(result?.success).toBe(true);
        expect(readdirSync(cwd)).toEqual([]);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  }
});
