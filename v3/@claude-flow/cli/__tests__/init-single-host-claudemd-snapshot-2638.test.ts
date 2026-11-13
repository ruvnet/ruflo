/**
 * #2638 — single-host CLAUDE.md output must not change.
 *
 * Recorded on origin/main before the dual-mode single-source work. Splitting
 * the section generators into shared and Claude-only parts must reproduce
 * these bytes exactly for every template and preset.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateClaudeMd } from '../src/init/claudemd-generator.js';
import {
  DEFAULT_INIT_OPTIONS,
  FULL_INIT_OPTIONS,
  MINIMAL_INIT_OPTIONS,
  type ClaudeMdTemplate,
  type InitOptions,
} from '../src/init/types.js';
import { executeInit } from '../src/init/executor.js';

const TEMPLATES: ClaudeMdTemplate[] = ['minimal', 'standard', 'full', 'security', 'performance', 'solo'];
const PRESETS: Array<[string, InitOptions]> = [
  ['default', DEFAULT_INIT_OPTIONS],
  ['minimal', MINIMAL_INIT_OPTIONS],
  ['full', FULL_INIT_OPTIONS],
];

describe('single-host CLAUDE.md is unchanged (#2638)', () => {
  for (const [preset, options] of PRESETS) {
    for (const template of TEMPLATES) {
      it(`generateClaudeMd(${preset}, ${template})`, () => {
        expect(generateClaudeMd(options, template)).toMatchSnapshot();
      });
    }
  }

  describe('executeInit writes the same CLAUDE.md', () => {
    let dir: string;
    let configDir: string;
    let savedConfigDir: string | undefined;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'claudemd-snap-'));
      // Hermetic: no installed Claude Code plugins visible to init.
      configDir = mkdtempSync(join(tmpdir(), 'claudemd-snap-cfg-'));
      savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
      process.env.CLAUDE_CONFIG_DIR = configDir;
    });
    afterEach(() => {
      if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
      rmSync(dir, { recursive: true, force: true });
      rmSync(configDir, { recursive: true, force: true });
    });

    for (const [preset, base] of PRESETS) {
      it(`${preset} preset`, async () => {
        const options: InitOptions = structuredClone(base);
        options.targetDir = dir;
        options.skipGlobalClaudeMd = true;
        options.components = { ...options.components, helpers: false, statusline: false, settings: false };
        const result = await executeInit(options);
        expect(result.success).toBe(true);
        expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toMatchSnapshot();
      });
    }
  });
});
