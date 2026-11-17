/**
 * zod 3/4 compatibility
 *
 * These run against the real schemas. Under zod 4, `ZodError.errors` is gone
 * (only `.issues` remains) and an object's `_def.shape` is a plain object
 * rather than a function, which broke error reporting and MCP tool schemas.
 */

import { describe, it, expect } from 'vitest';
import { GasTownBridgePlugin } from '../src/index.js';
import { BeadsError, GasTownErrorCode } from '../src/errors.js';
import { sanitizeBeadOutput } from '../src/sanitizers.js';
import { validateBeadId } from '../src/validators.js';

describe('validation errors', () => {
  it('reports a schema failure as BeadsError with the zod message', () => {
    let thrown: unknown;
    try {
      sanitizeBeadOutput('{"title":"no id"}');
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BeadsError);
    expect((thrown as BeadsError).code).toBe(GasTownErrorCode.BEAD_PARSE_FAILED);
    expect((thrown as BeadsError).cause?.message).toMatch(/\S/);
  });

  it('rejects an invalid bead ID with a ValidationError, not a TypeError', () => {
    expect(() => validateBeadId('gt-abc; rm -rf /')).toThrow(/bead/i);
    expect(() => validateBeadId('gt-abc; rm -rf /')).not.toThrow(TypeError);
  });
});

describe('MCP tool input schemas', () => {
  it('converts a zod object schema into JSON Schema properties', () => {
    const plugin = new GasTownBridgePlugin();
    const tool = plugin.getMCPTools().find((t) => t.name === 'gt_beads_create');

    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as {
      properties: Record<string, { type: string }>;
      required?: string[];
    };
    expect(schema.properties.title).toEqual({ type: 'string' });
    expect(Object.keys(schema.properties)).toContain('priority');
    expect(schema.required).toContain('title');
    expect(schema.required).not.toContain('priority');
  });
});
