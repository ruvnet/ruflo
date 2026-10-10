import { describe, expect, it } from 'vitest';
import { checkCapabilityEnvelope, delegateEnvelope, intersectEnvelopes, isEnvelopeReduction, validateCapabilityEnvelope } from '../src/policy/envelope.js';

import { evaluatePolicy } from '../src/policy/evaluator.js';

describe('authority envelope boundary', () => {
  it.each(['legacy', 'observe', 'enforce'] as const)('cannot override authority with allow rules in %s', mode => {
    const result = evaluatePolicy({identity:{id:'worker',type:'agent'},
      action:{type:'mcp.tool.call',tool:'shell'},context:{envelope:{tools:['memory_get']}}},
      [{id:'allow-all',effect:'allow',actions:['*']}],mode);
    expect(result.enforcedOutcome).toBe('denied');
  });

  it('distinguishes missing constraints from no granted capabilities', () => {
    expect(checkCapabilityEnvelope({ type: 'read', tool: 'memory_get' }, {}).allowed).toBe(true);
    expect(checkCapabilityEnvelope({ type: 'read', tool: 'memory_get' }, { tools: [] }).allowed).toBe(false);
    expect(isEnvelopeReduction({ tools: [] }, { tools: ['memory_get'] })).toBe(false);
    expect(isEnvelopeReduction({ tools: ['memory_get'] }, { tools: [] })).toBe(true);
  });

  it('intersects exact and prefix scopes without granting disjoint permissions', () => {
    const envelope = intersectEnvelopes({ tools: ['memory_*', 'status'], network: true, maxTokens: 100 },
      { tools: ['memory_get', 'shell'], network: false, maxTokens: 20 });
    expect(envelope).toEqual({ tools: ['memory_get'], network: false, destructive: false, maxTokens: 20 });
    expect(checkCapabilityEnvelope({ type: 'read', tool: 'shell' }, envelope).allowed).toBe(false);
    expect(intersectEnvelopes({ tools: ['a'] }, { tools: ['b'] })?.tools).toEqual([]);
    expect(intersectEnvelopes({ tools: ['memory_*'] }, { tools: ['memory_g*'] })?.tools).toEqual(['memory_g*']);
  });

  it('rejects malformed authority instead of treating it as unrestricted', () => {
    for (const value of [null, [], { tools: 'shell' }, { tools: [3] }, { tools: ['a*b'] },
      { maxTokens: NaN }, { maxCostUsd: Infinity }, { delegationDepth: -1 },
      { delegationDepth: 1.5 }, { network: 'true' }, { tool: ['shell'] }]) {
      expect(() => validateCapabilityEnvelope(value)).toThrow();
      expect(checkCapabilityEnvelope({ type: 'read' }, value as never).allowed).toBe(false);
    }
  });

  it('consumes depth, rejects growth and snapshots delegated lists', () => {
    const parent = { tools: ['memory_*'], delegationDepth: 2, expiresAt: 2000 };
    const requested = { tools: ['memory_get'] };
    const child = delegateEnvelope(parent, requested);
    expect(child.delegationDepth).toBe(1);
    requested.tools.push('shell');
    parent.tools.push('exec');
    expect(child.tools).toEqual(['memory_get']);
    expect(() => delegateEnvelope(child, { tools: ['shell'] })).toThrow('cannot-grow');
    expect(() => delegateEnvelope(delegateEnvelope(child, {}), {})).toThrow('depth-exhausted');
    expect(checkCapabilityEnvelope({ type: 'read', tool: 'memory_get' }, child, 2000).allowed).toBe(false);
  });

  it('returns detached intersections and retains absence when no constraints exist', () => {
    const parent = { tools: ['a'] };
    const result = intersectEnvelopes(undefined, parent)!;
    parent.tools.push('b');
    expect(result.tools).toEqual(['a']);
    expect(intersectEnvelopes(undefined)).toBeUndefined();
  });
});

describe('authority algebra and usage bounds', () => {
  it('intersection is commutative and never grants beyond either input', () => {
    const scopes = [undefined, [], ['*'], ['memory_*'], ['memory_get'], ['shell'], ['memory_g*','status']];
    for (const toolsA of scopes) for (const toolsB of scopes) {
      const a = {tools:toolsA}, b = {tools:toolsB};
      const ab = intersectEnvelopes(a,b), ba = intersectEnvelopes(b,a);
      for (const tool of ['memory_get','memory_store','shell','status','memory_g','other']) {
        const action = {type:'read',tool};
        const expected = checkCapabilityEnvelope(action,a).allowed && checkCapabilityEnvelope(action,b).allowed;
        expect(checkCapabilityEnvelope(action,ab).allowed).toBe(expected);
        expect(checkCapabilityEnvelope(action,ba).allowed).toBe(expected);
      }
    }
  });
  it('requires known finite nonnegative usage under a cap', () => {
    for (const [field,cap] of [['costUsd','maxCostUsd'],['tokens','maxTokens'],['concurrency','maxConcurrency']]) {
      for (const value of [undefined,NaN,Infinity,-1,11]) {
        expect(checkCapabilityEnvelope({type:'run',[field]:value},{[cap]:10}).allowed).toBe(false);
      }
      expect(checkCapabilityEnvelope({type:'run',[field]:10},{[cap]:10}).allowed).toBe(true);
    }
    expect(checkCapabilityEnvelope({type:'run'},{expiresAt:1},NaN).allowed).toBe(false);
  });
});
