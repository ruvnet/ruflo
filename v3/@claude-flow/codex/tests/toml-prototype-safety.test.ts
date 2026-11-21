/**
 * config.toml comes from the project being validated (possibly a freshly
 * cloned, untrusted repo). Section headers and keys must never resolve to or
 * write onto Object.prototype.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { validateConfigToml } from '../src/validators/index.js';

const PROBE = 'codexTomlPrototypeProbe';

afterEach(() => {
  delete (Object.prototype as Record<string, unknown>)[PROBE];
  delete (Object as unknown as Record<string, unknown>)[PROBE];
  delete (Object.prototype.toString as unknown as Record<string, unknown>)[PROBE];
});

describe('validateConfigToml prototype safety', () => {
  for (const header of ['__proto__', 'constructor', 'prototype', 'toString']) {
    it(`does not pollute shared prototypes via a [${header}] section`, async () => {
      const content = `model = "gpt-5"\n[${header}]\n${PROBE} = "yes"\n`;
      await validateConfigToml(content);
      expect(({} as Record<string, unknown>)[PROBE]).toBeUndefined();
      expect((Object as unknown as Record<string, unknown>)[PROBE]).toBeUndefined();
      expect((Object.prototype.toString as unknown as Record<string, unknown>)[PROBE]).toBeUndefined();
    });
  }

  it('does not throw when a section reuses a scalar top-level key', async () => {
    await expect(validateConfigToml('model = "gpt-5"\nfoo = 1\n[foo]\nbar = 2\n')).resolves.toBeDefined();
  });

  it('still validates ordinary sections', async () => {
    const result = await validateConfigToml(
      'model = "gpt-5"\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\n[mcp_servers.ruflo]\ncommand = "npx"\n',
    );
    expect(result.errors.filter((e) => /Invalid section|Invalid key/.test(e.message))).toEqual([]);
  });
});
