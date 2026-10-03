import type { CapabilityEnvelope, PolicyAction } from './types.js';

export interface EnvelopeCheck {
  allowed: boolean;
  reason?: string;
}

function matches(patterns: readonly string[] | undefined, value: string | undefined): boolean {
  if (patterns === undefined) return true;
  if (!value) return false;
  return patterns.some((pattern) => (
    pattern === '*'
    || pattern === value
    || (pattern.endsWith('*') && value.startsWith(pattern.slice(0, -1)))
  ));
}

function subset(child: readonly string[] | undefined, parent: readonly string[] | undefined): boolean {
  if (parent === undefined) return true;
  if (child === undefined) return false;
  return child.every((value) => matches(parent, value));
}

export function checkCapabilityEnvelope(
  action: PolicyAction,
  envelope: CapabilityEnvelope | undefined,
  now = Date.now(),
): EnvelopeCheck {
  if (envelope === undefined) return { allowed: true };
  try { validateCapabilityEnvelope(envelope); } catch {
    return { allowed: false, reason: 'invalid-capability-envelope' };
  }
  if (!Number.isFinite(now)) return { allowed: false, reason: 'invalid-authority-clock' };
  if (envelope.expiresAt !== undefined && envelope.expiresAt <= now) {
    return { allowed: false, reason: 'capability-envelope-expired' };
  }
  const checks: Array<[boolean, string]> = [
    [matches(envelope.actions, action.type), 'action-outside-envelope'],
    [matches(envelope.resources, action.resource), 'resource-outside-envelope'],
    [matches(envelope.tools, action.tool), 'tool-outside-envelope'],
    [matches(envelope.servers, action.server), 'server-outside-envelope'],
    [matches(envelope.environments, action.environment), 'environment-outside-envelope'],
  ];
  if (action.namespace) {
    const namespaces = (action.type === 'read' || action.type.endsWith('.read'))
      ? envelope.readNamespaces
      : envelope.writeNamespaces;
    checks.push([matches(namespaces, action.namespace), 'namespace-outside-envelope']);
  }
  for (const [value, limit, reason, integer] of [
    [action.costUsd, envelope.maxCostUsd, 'cost-outside-envelope', false],
    [action.tokens, envelope.maxTokens, 'tokens-outside-envelope', true],
    [action.concurrency, envelope.maxConcurrency, 'concurrency-outside-envelope', true],
  ] as const) {
    if (limit !== undefined) {
      checks.push([typeof value === 'number' && Number.isFinite(value) && value >= 0
        && (!integer || Number.isSafeInteger(value)) && value <= limit, reason]);
    }
  }
  if (action.network === true) checks.push([envelope.network === true, 'network-outside-envelope']);
  if (action.destructive === true) checks.push([envelope.destructive === true, 'destructive-outside-envelope']);
  const failed = checks.find(([allowed]) => !allowed);
  return failed ? { allowed: false, reason: failed[1] } : { allowed: true };
}

export function isEnvelopeReduction(parent: CapabilityEnvelope, child: CapabilityEnvelope): boolean {
  try { validateCapabilityEnvelope(parent); validateCapabilityEnvelope(child); } catch { return false; }
  const listChecks = [
    subset(child.actions, parent.actions),
    subset(child.resources, parent.resources),
    subset(child.tools, parent.tools),
    subset(child.servers, parent.servers),
    subset(child.readNamespaces, parent.readNamespaces),
    subset(child.writeNamespaces, parent.writeNamespaces),
    subset(child.environments, parent.environments),
  ];
  const numericChecks: Array<[number | undefined, number | undefined]> = [
    [child.maxCostUsd, parent.maxCostUsd],
    [child.maxTokens, parent.maxTokens],
    [child.maxConcurrency, parent.maxConcurrency],
    [child.delegationDepth, parent.delegationDepth],
    [child.expiresAt, parent.expiresAt],
  ];
  return listChecks.every(Boolean)
    && numericChecks.every(([next, current]) => (
      current === undefined
        ? true
        : next !== undefined && next <= current
    ))
    && !(child.network === true && parent.network !== true)
    && !(child.destructive === true && parent.destructive !== true);
}

export function delegateEnvelope(
  parent: CapabilityEnvelope,
  child: CapabilityEnvelope,
): CapabilityEnvelope {
  validateCapabilityEnvelope(parent);
  validateCapabilityEnvelope(child);
  if ((parent.delegationDepth ?? 0) <= 0) {
    throw new Error('delegation-depth-exhausted');
  }
  const reduced = {
    ...parent,
    ...child,
    delegationDepth: Math.min(
      child.delegationDepth ?? Number.MAX_SAFE_INTEGER,
      (parent.delegationDepth ?? 0) - 1,
    ),
    expiresAt: Math.min(
      child.expiresAt ?? Number.MAX_SAFE_INTEGER,
      parent.expiresAt ?? Number.MAX_SAFE_INTEGER,
    ),
  };
  if (!isEnvelopeReduction(parent, reduced)) throw new Error('capability-envelope-cannot-grow');
  return snapshotEnvelope(reduced);
}

// Undefined preserves legacy unconstrained lists; an explicit empty list grants
// nothing. Callers migrating old empty-list configurations must omit the field
// to retain unrestricted behavior. Never use empty lists to mean wildcard.
const LIST_FIELDS = ['actions', 'resources', 'tools', 'servers', 'readNamespaces', 'writeNamespaces', 'environments'] as const;
const NUMBER_FIELDS = ['maxCostUsd', 'maxTokens', 'maxConcurrency', 'delegationDepth', 'expiresAt'] as const;
const BOOLEAN_FIELDS = ['network', 'destructive'] as const;
const KNOWN_FIELDS = new Set<string>([...LIST_FIELDS, ...NUMBER_FIELDS, ...BOOLEAN_FIELDS]);

/** Validate at the authority boundary, including callers using plain JSON. */
export function validateCapabilityEnvelope(value: unknown): asserts value is CapabilityEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-capability-envelope');
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!KNOWN_FIELDS.has(key)) throw new Error(`invalid-capability-envelope-field:${key}`);
  }
  for (const key of LIST_FIELDS) {
    const list = record[key];
    if (list !== undefined && (!Array.isArray(list) || !Array.from(list).every(item =>
      typeof item === 'string' && item.length > 0 && item.trim() === item
      && (!item.includes('*') || (item.endsWith('*') && item.indexOf('*') === item.length - 1))))) {
      throw new Error(`invalid-capability-envelope-field:${key}`);
    }
  }
  for (const key of NUMBER_FIELDS) {
    const number = record[key];
    if (number !== undefined && (typeof number !== 'number' || !Number.isFinite(number) || number < 0
      || (key !== 'maxCostUsd' && !Number.isSafeInteger(number)))) {
      throw new Error(`invalid-capability-envelope-field:${key}`);
    }
  }
  for (const key of BOOLEAN_FIELDS) {
    if (record[key] !== undefined && typeof record[key] !== 'boolean') throw new Error(`invalid-capability-envelope-field:${key}`);
  }
}

function snapshotEnvelope(envelope: CapabilityEnvelope): CapabilityEnvelope {
  const copy = { ...envelope };
  for (const key of LIST_FIELDS) if (envelope[key] !== undefined) copy[key] = [...envelope[key]!];
  return copy;
}

/** Intersection is a restriction, not a grant or a delegation-depth spend. */
export function intersectEnvelopes(...envelopes: (CapabilityEnvelope | undefined)[]): CapabilityEnvelope | undefined {
  let result: CapabilityEnvelope | undefined;
  for (const envelope of envelopes) {
    if (envelope === undefined) continue;
    validateCapabilityEnvelope(envelope);
    if (result === undefined) { result = snapshotEnvelope(envelope); continue; }
    for (const key of LIST_FIELDS) {
      const left = result[key];
      const right = envelope[key];
      if (right === undefined) continue;
      if (left === undefined) { result[key] = [...right]; continue; }
      // Our grammar is exact strings and trailing-prefix wildcards, so the
      // narrower member of each overlapping pair describes its intersection.
      result[key] = [...new Set(left.flatMap(a => right.flatMap(b =>
        matches([a], b) ? [b] : matches([b], a) ? [a] : [])))];
    }
    for (const key of NUMBER_FIELDS) {
      if (envelope[key] !== undefined) result[key] = Math.min(result[key] ?? Infinity, envelope[key]!);
    }
    // A present envelope only permits these effects when explicitly true.
    for (const key of BOOLEAN_FIELDS) result[key] = result[key] === true && envelope[key] === true;
  }
  return result;
}
