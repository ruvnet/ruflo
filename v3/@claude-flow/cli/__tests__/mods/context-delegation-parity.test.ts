import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { DEFAULT_CONTEXT_LIMITS, delegateContextRead } from '../../src/services/context-delegation.js';
import { LIMITS } from '../../../../../plugins/ruflo-mods/hooks/context-delegate/plan';
import { verifyReply } from '../../../../../plugins/ruflo-mods/hooks/context-delegate/verify';

// ADR-522: the mod reimplements ADR-521's limits and quote check (a hooks module cannot import the CLI).
// These tests fail if the two drift apart.
describe('ruflo-mods context delegation matches the CLI core', () => {
  it('uses the same limits', () => {
    for (const key of ['minInputBytes', 'maxInputBytes', 'maxOutputBytes', 'maxFindings', 'timeoutMs'] as const) {
      expect(LIMITS[key], key).toBe(DEFAULT_CONTEXT_LIMITS[key]);
    }
  });

  // The mod is deliberately more forgiving on two counts, safe because it shows the FILE's lines, never the worker's:
  // dropped indentation, and a cited range up to 3 lines off. Everything that changes the words is rejected by both.
  it('rejects what the core rejects for changed words; forgives only whitespace and nearby line numbers', async () => {
    const content = Array.from({ length: 600 }, (_, i) => `export const pad_${i} = ${i}; // filler`).join('\n') + '\n  export const MAX = 7;\n';
    const sha = createHash('sha256').update(content).digest('hex');
    const line = content.split('\n').indexOf('  export const MAX = 7;') + 1;
    // [name, start, end, quote, mod accepts, core accepts]
    const cases: Array<[string, number, number, string, boolean, boolean]> = [
      ['exact', line, line, '  export const MAX = 7;', true, true],
      ['two-lines', line - 1, line, `export const pad_${line - 2} = ${line - 2}; // filler\n  export const MAX = 7;`, true, true],
      ['forged', line, line, '  export const MAX = 3;', false, false],
      ['partial', line, line, 'MAX = 7', false, false],
      ['past-end', line + 50, line + 50, '  export const MAX = 7;', false, false],
      ['indentation-dropped', line, line, 'export const MAX = 7;', true, false],
      ['nearby-line', line - 2, line - 2, '  export const MAX = 7;', true, false],
    ];
    for (const [name, startLine, endLine, quote, modOk, coreOk] of cases) {
      const mod = verifyReply(JSON.stringify({ findings: [{ startLine, endLine, quote, answer: 'x' }] }), content).ok;
      const core = await delegateContextRead({
        read: { mode: 'enforce', intent: 'analysis' }, question: 'q', sources: [{ path: 'a.ts', content }],
        adapter: { authorize: async () => true, invoke: async () => JSON.stringify({ findings: [{ path: 'a.ts', sourceSha256: sha, startLine, endLine, quote, answer: 'x' }] }) },
      });
      expect(mod, `mod ${name}`).toBe(modOk);
      expect(core.status === 'delegated', `core ${name}`).toBe(coreOk);
    }
  });
});
