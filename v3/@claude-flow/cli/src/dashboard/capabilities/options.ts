/** Which plugin options the dashboard may change, decided by the connector (never by the manifest). */
import type { CatalogOption, RefuseCode } from './types.js';

const SECRETISH = /key|token|secret|password|passwd|credential|auth|cookie|bearer|private/i;
/** Options that decide what the machine will trust or where it talks: never changed remotely. */
const GATES = new Set(['modTrust', 'modTrustAllow', 'guard', 'cli']);
/** Budget caps: may only be lowered (0 means "off" and counts as raising). */
export const CAP_OPTIONS = new Set(['costBudgetUsd', 'wfBudgetRunUsd', 'wfBudgetDayUsd']);
/** Numbers with a connector-owned range. */
const NUMBER_RULES: Record<string, { min: number; max: number }> = { costBudgetUsd: { min: 0, max: 100000 }, wfBudgetRunUsd: { min: 0, max: 100000 }, wfBudgetDayUsd: { min: 0, max: 100000 }, refreshSeconds: { min: 1, max: 3600 }, fps: { min: 1, max: 60 } };

interface Raw { type?: unknown; default?: unknown; options?: unknown; enum?: unknown; sensitive?: unknown }
const scalar = (v: unknown): boolean | number | string | undefined => (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) ? v : typeof v === 'string' ? v.slice(0, 64) : undefined);

export function classifyOption(key: string, raw: Raw): CatalogOption {
  const type = typeof raw.type === 'string' ? raw.type.slice(0, 16) : 'string';
  const choicesRaw = Array.isArray(raw.options) ? raw.options : Array.isArray(raw.enum) ? raw.enum : undefined;
  const choices = choicesRaw?.filter((c): c is string => typeof c === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(c)).slice(0, 12);
  const def = scalar(raw.default);
  const base: CatalogOption = { key, type, ...(def !== undefined ? { default: def } : {}), ...(choices?.length ? { choices } : {}), settable: false };
  const no = (why: RefuseCode): CatalogOption => ({ ...base, why });
  if (raw.sensitive === true || SECRETISH.test(key)) return no('secret-option');
  if (GATES.has(key)) return no('loosens-gate');
  if (type === 'boolean') return { ...base, settable: true, rule: 'bool' };
  if (type === 'number' && NUMBER_RULES[key]) return { ...base, settable: true, rule: 'number', cap: CAP_OPTIONS.has(key), ...NUMBER_RULES[key]! };
  if (type === 'string' && choices?.length) return { ...base, settable: true, rule: 'enum' };
  return no('no-schema'); // free strings, lists and numbers without a range
}

export type OptionCheck = { ok: true; value: boolean | number | string } | { ok: false; code: RefuseCode | 'bad_value' };
/** Validate a requested value against the option's rule; `current` is the value now in effect (undefined = unset). */
export function checkOptionValue(opt: CatalogOption, value: unknown, current: unknown): OptionCheck {
  if (!opt.settable) return { ok: false, code: opt.why ?? 'no-schema' };
  if (opt.rule === 'bool') return typeof value === 'boolean' ? { ok: true, value } : { ok: false, code: 'bad_value' };
  if (opt.rule === 'enum') return typeof value === 'string' && opt.choices?.includes(value) ? { ok: true, value } : { ok: false, code: 'bad_value' };
  if (opt.rule === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < (opt.min ?? 0) || value > (opt.max ?? 0)) return { ok: false, code: 'bad_value' };
    if (opt.cap) {
      const cur = typeof current === 'number' ? current : typeof current === 'string' && current.trim() !== '' ? Number(current) : typeof opt.default === 'number' ? opt.default : 0;
      // 0 is "no cap". Going to 0, or above a cap that is set, loosens the gate; from "off" any positive cap tightens it.
      if (value === 0 && cur !== 0) return { ok: false, code: 'would-raise-cap' };
      if (cur > 0 && value > cur) return { ok: false, code: 'would-raise-cap' };
    }
    return { ok: true, value };
  }
  return { ok: false, code: 'no-schema' };
}
