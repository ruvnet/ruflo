/**
 * Regression test for #1567: validateAgentSpawn's Zod call was passing
 * `{ agentType, name }` to `@claude-flow/security`'s SpawnAgentSchema, which
 * expects `{ type, id }` — so every call failed with "type: Required" and
 * the MCP agent_spawn tool returned an input validation error for every
 * possible input. The fix aligns the field names AND swallows
 * `invalid_enum_value` errors so custom agent types (beyond the 15-type
 * hardcoded enum) continue to work.
 */

import { describe, it, expect } from 'vitest';
import { validateAgentSpawn, isUnknownAgentTypeIssue } from '../src/mcp-tools/validate-input.js';

describe('validateAgentSpawn (#1567)', () => {
  it('accepts a built-in agent type like "tester"', async () => {
    const r = await validateAgentSpawn({ agentType: 'tester', agentId: 'tester-1' });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('accepts a custom agent type not in the SpawnAgentSchema enum', async () => {
    // "memory-specialist" is not one of the 15 types that
    // @claude-flow/security's AgentTypeSchema enumerates, but it's a valid
    // Claude Flow agent type and should NOT be rejected.
    const r = await validateAgentSpawn({ agentType: 'memory-specialist', agentId: 'mem-1' });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('accepts an agent type that is genuinely outside the enum', async () => {
    // "memory-specialist" above IS in AgentTypeSchema, so it never reached the
    // enum-suppression branch.
    const r = await validateAgentSpawn({ agentType: 'qe-flaky-hunter', agentId: 'qe-1' });
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  // validateAgentSpawn loads @claude-flow/security dynamically and falls back
  // to inline checks when it cannot resolve it (as under pnpm's strict
  // layout here), so the cases above may never reach the Zod branch. Drive
  // the suppression rule with real SpawnAgentSchema issues instead.
  it('ignores only the unknown-agent-type issue from SpawnAgentSchema', async () => {
    const { SpawnAgentSchema } = await import('@claude-flow/security');
    const issuesFor = (type: unknown, id = 'qe-1') => {
      const r = SpawnAgentSchema.safeParse({ type, id });
      expect(r.success).toBe(false);
      return r.error!.issues;
    };

    const custom = issuesFor('qe-flaky-hunter');
    expect(custom.length).toBeGreaterThan(0);
    expect(custom.every((i) => isUnknownAgentTypeIssue(i, 'qe-flaky-hunter'))).toBe(true);

    // A missing or non-string type must still be reported. zod 4 raises
    // `invalid_value` at ['type'] for these too (zod 3: `invalid_type`).
    for (const missing of [undefined, null, 0, false]) {
      expect(issuesFor(missing).some((i) => isUnknownAgentTypeIssue(i, missing))).toBe(false);
    }

    const badId = issuesFor('tester', 'has spaces');
    expect(badId.some((i) => isUnknownAgentTypeIssue(i, 'tester'))).toBe(false);

    // Only the top-level `type` field is exempt.
    expect(isUnknownAgentTypeIssue({ code: 'invalid_value', path: ['type', 'nested'] }, 'x')).toBe(false);
    expect(isUnknownAgentTypeIssue({ code: 'invalid_enum_value', path: ['priority'] }, 'x')).toBe(false);
  });

  it('still rejects an agentId with invalid characters', async () => {
    const r = await validateAgentSpawn({
      agentType: 'tester',
      agentId: 'has spaces and $pecials',
    });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('does not require the domain field', async () => {
    const r = await validateAgentSpawn({ agentType: 'coder', agentId: 'c1' });
    expect(r.valid).toBe(true);
  });
});
