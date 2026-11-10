/**
 * #4785: the MCP server's shared defender takes its pattern-pack selection
 * from RUFLO_AIDEFENCE_PACKS. Unset keeps today's options exactly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const createAIDefence = vi.fn((_options: Record<string, unknown>) => ({
  detect: async () => ({ safe: true, threats: [], piiFound: false, detectionTimeMs: 0, inputHash: 'h' }),
  getStats: async () => ({}),
}));
vi.mock('@claude-flow/aidefence', () => ({ createAIDefence }));

const previous = process.env.RUFLO_AIDEFENCE_PACKS;

async function scanWith(value: string | undefined) {
  vi.resetModules();
  createAIDefence.mockClear();
  if (value === undefined) delete process.env.RUFLO_AIDEFENCE_PACKS;
  else process.env.RUFLO_AIDEFENCE_PACKS = value;
  const { securityTools } = await import('../src/mcp-tools/security-tools.js');
  const scan = securityTools.find(tool => tool.name === 'aidefence_scan')!;
  return scan.handler({ input: 'hello' }) as Promise<Record<string, unknown>>;
}

afterEach(() => {
  if (previous === undefined) delete process.env.RUFLO_AIDEFENCE_PACKS;
  else process.env.RUFLO_AIDEFENCE_PACKS = previous;
});

describe('aidefencePackSelection (#4785)', () => {
  it('parses the accepted forms and refuses everything else', async () => {
    const { aidefencePackSelection } = await import('../src/mcp-tools/security-tools.js');
    expect(aidefencePackSelection(undefined)).toBeUndefined();
    expect(aidefencePackSelection('  ')).toBeUndefined();
    expect(aidefencePackSelection('false')).toBe(false);
    expect(aidefencePackSelection('TRUE')).toBe(true);
    expect(aidefencePackSelection('core, exfil_url,core')).toEqual(['core', 'exfil_url']);
    expect(() => aidefencePackSelection('no')).toThrow(/Invalid RUFLO_AIDEFENCE_PACKS/);
    expect(() => aidefencePackSelection('core,bogus')).toThrow(/Invalid RUFLO_AIDEFENCE_PACKS/);
    expect(() => aidefencePackSelection(',')).toThrow(/Invalid RUFLO_AIDEFENCE_PACKS/);
  });
});

describe('shared defender options (#4785)', () => {
  it('omits packs when the variable is unset', async () => {
    await scanWith(undefined);
    expect(createAIDefence).toHaveBeenCalledTimes(1);
    expect(createAIDefence.mock.calls[0][0]).toEqual({ enableLearning: true });
  });

  it('passes packs:false for built-ins-only mode', async () => {
    await scanWith('false');
    expect(createAIDefence.mock.calls[0][0]).toEqual({ enableLearning: true, packs: false });
  });

  it('passes a named pack list', async () => {
    await scanWith('core,tool_invocation');
    expect(createAIDefence.mock.calls[0][0]).toEqual({ enableLearning: true, packs: ['core', 'tool_invocation'] });
  });

  it('refuses an invalid value instead of creating a defender', async () => {
    const result = await scanWith('maybe');
    expect(createAIDefence).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toMatch(/Invalid RUFLO_AIDEFENCE_PACKS/);
  });
});
