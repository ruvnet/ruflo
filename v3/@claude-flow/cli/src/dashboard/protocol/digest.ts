import { z } from 'zod';

const S = (n: number) => z.string().max(n);
export const MAX_ITEMS = 100;
export const DigestSchema = z.object({
  collectedAt: z.number().int().positive(),
  ruflo: z.object({ version: S(40), node: S(40).optional(), os: S(40).optional() }).strict(),
  level: z.enum(['off', 'read', 'write', 'manage', 'full']),
  health: z.object({ ok: z.boolean(), notes: z.array(S(200)).max(20).default([]) }).strict(),
  missions: z.array(z.object({ id: S(40), objective: S(300), state: S(24), revision: z.number().int().nonnegative(), budgetMinor: z.number().int().nonnegative().optional(), updatedAt: z.number().int().optional() }).strict()).max(MAX_ITEMS).default([]),
  tasks: z.object({ total: z.number().int().nonnegative(), pending: z.number().int().nonnegative(), running: z.number().int().nonnegative(), done: z.number().int().nonnegative() }).strict().optional(),
  swarm: z.object({ id: S(80).optional(), topology: S(32).optional(), maxAgents: z.number().int().optional(), agents: z.array(z.object({ id: S(80), type: S(40), state: S(24) }).strict()).max(MAX_ITEMS).default([]) }).strict().optional(),
  memory: z.object({ entries: z.number().int().nonnegative(), namespaces: z.number().int().nonnegative().optional(), backend: S(40).optional() }).strict().optional(),
  cost: z.object({ currency: S(8), totalMinor: z.number().int().nonnegative(), todayMinor: z.number().int().nonnegative().optional() }).strict().optional(),
  adrs: z.array(z.object({ id: S(40), title: S(200), status: S(24) }).strict()).max(MAX_ITEMS).default([]),
  events: z.array(z.object({ at: z.number().int(), kind: S(40), text: S(300) }).strict()).max(MAX_ITEMS).default([]),
}).strict();
export type Digest = z.infer<typeof DigestSchema>;

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, /\bAIza[0-9A-Za-z_-]{30,}/g, /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b((?:api[_-]?key|secret|token|password|passwd|authorization)\s*[=:]\s*)["']?[^\s"',;]{6,}/gi,
];
export function maskSecrets(s: string): string {
  let out = s;
  for (const re of SECRET_PATTERNS) out = out.replace(re, (m, p1) => (typeof p1 === 'string' && /[=:]\s*$/.test(p1) ? p1 + '[masked]' : '[masked]'));
  return out;
}
/** Strip control characters (keep \n\t), mask secrets, recursively. Applied both locally before send and server-side on receipt. */
export function sanitize<T>(v: T, depth = 0): T {
  if (depth > 12) return undefined as T;
  if (typeof v === 'string') return maskSecrets(v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')) as T;
  if (Array.isArray(v)) return v.map(x => sanitize(x, depth + 1)) as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue; o[k] = sanitize(x, depth + 1); }
    return o as T;
  }
  return v;
}
export function parseDigest(raw: unknown): { ok: true; digest: Digest } | { ok: false } {
  const r = DigestSchema.safeParse(sanitize(raw));
  return r.success ? { ok: true, digest: r.data } : { ok: false };
}
