import { describe, expect, it } from 'vitest';
import { generateStatuslineScript } from '../src/init/statusline-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';

describe('statusline generator model detection', () => {
  it('uses dynamic model parsing instead of hardcoded Opus label', () => {
    const script = generateStatuslineScript(DEFAULT_INIT_OPTIONS);

    expect(script).toContain('function formatModelName(modelId)');
    expect(script).toContain("parseFamilyVersion('opus', 'Opus')");
    expect(script).toContain("parseFamilyVersion('sonnet', 'Sonnet')");
    expect(script).toContain("parseFamilyVersion('haiku', 'Haiku')");
    expect(script).not.toContain("if (modelId.includes('opus')) modelName = 'Opus 4.5';");
    expect(script).not.toContain('Opus 4.5');
  });

  it('falls back to settings model lookup when default label is still active', () => {
    const script = generateStatuslineScript(DEFAULT_INIT_OPTIONS);
    expect(script).toContain("if (modelName === '🤖 Claude Code')");
  });
});
