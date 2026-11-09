/**
 * #4886, #4892, #4887 — tool input schemas must advertise the limits the
 * handlers actually enforce, so a caller learns them from tools/list rather
 * than from a refusal.
 *
 *  - aidefence_scan.input            → validateText default (10000 .length)
 *  - agentdb_hierarchical-store.value → validateText default + non-empty
 *  - hooks_post-task taskId/agent/parentAgentId → validateIdentifier grammar
 *    (cli-core) plus the CLI reserved-name wrapper
 *
 * Schemas are compiled with ajv (a real JSON Schema validator, maxLength in
 * code points) and checked against the real validators on the same corpus.
 */

import { describe, it, expect, vi, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Ajv from 'ajv';

// hooks-tools.ts resolves some paths from cwd at import time.
const testRoot = mkdtempSync(join(tmpdir(), 'ruflo-schema-limits-'));
const origCwd = process.cwd();
process.chdir(testRoot);

// No refusal path below may reach the AgentDB bridge; fail loudly if one does.
vi.mock('../src/memory/memory-bridge.js', () => {
  const boom = vi.fn(async () => { throw new Error('bridge must not be reached'); });
  return new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : boom) });
});

const { securityTools } = await import('../src/mcp-tools/security-tools.js');
const { agentdbHierarchicalStore } = await import('../src/mcp-tools/agentdb-tools.js');
const { hooksPostTask } = await import('../src/mcp-tools/hooks-tools.js');
const { validateIdentifier, validateText } = await import('../src/mcp-tools/validate-input.js');

afterAll(() => {
  process.chdir(origCwd);
  rmSync(testRoot, { recursive: true, force: true });
});

const ajv = new Ajv({ strict: false });
const compile = (schema: unknown) => ajv.compile(schema as object);
type Props = Record<string, Record<string, unknown>>;
const propsOf = (tool: { inputSchema: unknown }) => (tool.inputSchema as { properties: Props }).properties;

const aidefenceScan = securityTools.find(t => t.name === 'aidefence_scan')!;
const ASTRAL = '\u{1F600}'; // one code point, two UTF-16 code units

describe('#4886 aidefence_scan input', () => {
  const input = propsOf(aidefenceScan).input;

  it('advertises maxLength 10000 and states the UTF-16 unit', () => {
    expect(input.maxLength).toBe(10000);
    expect(String(input.description)).toMatch(/10000 UTF-16 code units/);
    expect(String(input.description)).toMatch(/code points/);
  });

  it('agrees with the handler at the 10000/10001 boundary', async () => {
    const check = compile(input);
    expect(check('a'.repeat(10000))).toBe(true);
    expect(validateText('a'.repeat(10000), 'input').valid).toBe(true);
    expect(check('a'.repeat(10001))).toBe(false);
    const res = await aidefenceScan.handler({ input: 'a'.repeat(10001) }) as { isError?: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error).toBe('input exceeds 10000 characters');
  });

  it('documents the code-point gap: astral text can pass the schema and still be refused', () => {
    const text = ASTRAL.repeat(5001); // 5001 code points, .length 10002
    expect(compile(input)(text)).toBe(true);
    expect(validateText(text, 'input').valid).toBe(false);
  });
});

describe('#4892 agentdb_hierarchical-store value', () => {
  const value = propsOf(agentdbHierarchicalStore).value;
  const call = (v: unknown) => agentdbHierarchicalStore.handler({ key: 'k1', value: v }) as Promise<{ success: boolean; error?: string }>;

  it('advertises minLength 1, maxLength 10000 and the UTF-16 unit', () => {
    expect(value.minLength).toBe(1);
    expect(value.maxLength).toBe(10000);
    expect(String(value.description)).toMatch(/10000 UTF-16 code units/);
  });

  it('agrees with the handler at the 10000/10001 boundary', async () => {
    const check = compile(value);
    expect(check('a'.repeat(10000))).toBe(true);
    expect(validateText('a'.repeat(10000), 'value').valid).toBe(true);
    expect(check('a'.repeat(10001))).toBe(false);
    expect(await call('a'.repeat(10001))).toEqual({ success: false, error: 'value exceeds 10000 characters' });
  });

  it('refuses an empty value with a message stating the effective limit, not 100KB', async () => {
    expect(compile(value)('')).toBe(false);
    const res = await call('');
    expect(res.success).toBe(false);
    expect(res.error).toBe('value is required (non-empty string, max 10000 characters)');
    expect(res.error).not.toMatch(/100KB/);
  });
});

describe('#4887 hooks_post-task identifiers', () => {
  const props = propsOf(hooksPostTask);
  const fields = ['taskId', 'agent', 'parentAgentId'] as const;

  const corpus: string[] = [
    // valid
    'task-1', 'agent_7', 'ruflo-core:reviewer', 'feature-dev:code-explorer', 'v1.2.3', '_x', '9', 'a'.repeat(128),
    'Constructor', 'proto', '__proto', 'prototypes',
    // reserved (CLI wrapper)
    '__proto__', 'constructor', 'prototype',
    // host paths / traversal
    '/root/x', 'root/x', '../x', 'a/../b', 'C:\\Users\\x', '~/x', './x',
    // bad first character
    '-x', '.x', ':x', ' x',
    // length
    'a'.repeat(129), '',
    // shell / other
    'a;b', 'a b', 'a$b', 'a`b', 'a|b', 'a#b', 'a\nb', 'é', ASTRAL, 'a\u0000b',
  ];

  for (const field of fields) {
    it(`${field} advertises pattern, maxLength 128 and the native-ID rule`, () => {
      const s = props[field];
      expect(s.type).toBe('string');
      expect(s.maxLength).toBe(128);
      expect(typeof s.pattern).toBe('string');
      expect(String(s.description)).toMatch(/registered native ID/);
      expect(String(s.description)).toMatch(/\/root\/x/);
    });

    it(`${field} schema accepts exactly what the handler accepts`, () => {
      const check = compile(props[field]);
      // The handler skips validation for agent '' (treated as omitted).
      const handlerAccepts = (v: string) => (field === 'agent' && v === '') || validateIdentifier(v, field).valid;
      const disagreements = corpus
        .map(v => ({ v, schema: check(v), handler: handlerAccepts(v) }))
        .filter(r => r.schema !== r.handler);
      expect(disagreements).toEqual([]);
    });

    it(`${field} agrees with the runtime validator the HTTP transport applies`, async () => {
      const { validateSchema } = await import('../../mcp/src/schema-validator.js');
      const handlerAccepts = (v: string) => (field === 'agent' && v === '') || validateIdentifier(v, field).valid;
      // validateSchema ignores `not`, so reserved names are left to the handler.
      const reserved = new Set(['__proto__', 'constructor', 'prototype']);
      const disagreements = corpus
        .filter(v => !reserved.has(v))
        .map(v => ({ v, schema: validateSchema(v, props[field] as never).valid, handler: handlerAccepts(v) }))
        .filter(r => r.schema !== r.handler);
      expect(disagreements).toEqual([]);
    });
  }

  it('agent accepts an empty string in the schema, taskId and parentAgentId do not', () => {
    expect(compile(props.agent)('')).toBe(true);
    expect(compile(props.taskId)('')).toBe(false);
    expect(compile(props.parentAgentId)('')).toBe(false);
  });

  it('the bare pattern matches the cli-core grammar; reserved names are caught by `not`', () => {
    const re = new RegExp(String(props.taskId.pattern));
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      expect(re.test(name)).toBe(true);
      expect(compile(props.taskId)(name)).toBe(false);
      expect(validateIdentifier(name, 'taskId').valid).toBe(false);
    }
  });

  it('only taskId is required; agent and parentAgentId stay optional', () => {
    expect((hooksPostTask.inputSchema as { required: string[] }).required).toEqual(['taskId']);
  });

  it('handler refuses a host-path taskId, agent and parentAgentId', async () => {
    const run = (p: Record<string, unknown>) => hooksPostTask.handler(p) as Promise<{ success: boolean; error?: string }>;
    expect((await run({ taskId: '/root/x' })).error).toMatch(/^taskId /);
    expect((await run({ taskId: 't1', agent: '/root/x' })).error).toMatch(/^agent /);
    expect((await run({ taskId: 't1', parentAgentId: '/root/x' })).error).toMatch(/^parentAgentId /);
    expect((await run({ taskId: 't1', parentAgentId: '' })).error).toMatch(/^parentAgentId /);
    expect((await run({ taskId: 'x'.repeat(129) })).error).toBe('taskId exceeds 128 characters');
  });

  it('keeps empty-agent behaviour: agent "" is treated as omitted, not refused', async () => {
    // parentAgentId is invalid so the handler stops right after the agent check.
    const res = await hooksPostTask.handler({ taskId: 't1', agent: '', parentAgentId: '/root/x' }) as { error?: string };
    expect(res.error).toMatch(/^parentAgentId /);
  });
});
