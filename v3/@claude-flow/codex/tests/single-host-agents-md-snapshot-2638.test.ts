/**
 * #2638 — single-host AGENTS.md output must not change.
 *
 * The snapshot was recorded on origin/main before the dual-mode single-source
 * work landed. Dual mode (`--dual`) gets its own composition; a Codex-only
 * init keeps writing exactly these bytes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateAgentsMd } from '../src/generators/index.js';
import { CodexInitializer } from '../src/initializer.js';
import type { AgentsMdTemplate } from '../src/types.js';

const TEMPLATES: AgentsMdTemplate[] = ['minimal', 'default', 'full', 'enterprise'];

describe('single-host AGENTS.md is unchanged (#2638)', () => {
  for (const template of TEMPLATES) {
    it(`generateAgentsMd(${template})`, async () => {
      const md = await generateAgentsMd({ projectName: 'snapshot-project', template });
      expect(md).toMatchSnapshot();
    });
  }

  describe('CodexInitializer without --dual', () => {
    let dir: string;
    let originalPath: string | undefined;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'snapshot-project-'));
      // No `codex`/`claude` binaries: MCP registration and plugin install are skipped.
      originalPath = process.env.PATH;
      process.env.PATH = '';
    });
    afterEach(() => {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      rmSync(dir, { recursive: true, force: true });
    });

    for (const template of ['minimal', 'default'] as const) {
      it(`writes the same AGENTS.md and no CLAUDE.md (${template})`, async () => {
        const result = await new CodexInitializer().initialize({ projectPath: dir, template });
        expect(result.success).toBe(true);
        const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf-8').split(dir.split('/').pop()!).join('<project>');
        expect(agents).toMatchSnapshot();
        expect(result.filesCreated).not.toContain('CLAUDE.md');
      });
    }
  });
});
