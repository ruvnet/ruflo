/**
 * Budget export to a gateway (ADR-508 §2.2).
 *
 * LiteLLM virtual-key budget fields, as docs.litellm.ai documents them
 * (checked 2026-10-29: /docs/proxy/users and /docs/proxy/budget_fallbacks):
 *   budget_limits     [{ budget_duration: "24h", max_budget: 10 }, ...]   stacked windows
 *   model_max_budget  { "<model>": { budget_limit: 0.01, time_period: "1d" } }
 *   budget_fallbacks  { "<model>": ["<fallback>", ...] }                   LiteLLM >= v1.92.0
 * Durations use LiteLLM's grammar: "30s", "30m", "30h", "30d".
 *
 * meta-llm documents no budget API, so it is refused with a pointer to
 * ADR-508 rather than guessed at.
 */

import { stringify as stringifyYaml } from 'yaml';

import { ladderWindow, type BudgetFile } from './budget-file.js';

export const ADR_POINTER = 'v3/docs/adr/ADR-508-cost-ladder-gateway-budgets.md';
export const GATEWAYS = ['litellm', 'meta-llm'] as const;
const MODEL = /^[A-Za-z0-9._:/@-]{1,128}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;

export interface LiteLLMKeyBody {
  budget_limits: { budget_duration: string; max_budget: number }[];
  model_max_budget?: Record<string, { budget_limit: number; time_period: string }>;
  budget_fallbacks?: Record<string, string[]>;
}

/** Why a gateway cannot be exported to, or undefined when it can. */
export function gatewayRefusal(gateway: unknown): string | undefined {
  if (gateway === 'litellm') return undefined;
  if (gateway === 'meta-llm') {
    return `--gateway meta-llm: meta-llm documents no budget API yet, so ruflo does not guess an endpoint. Its allowance tiers stay as they are; see ${ADR_POINTER} §2.2.`;
  }
  return `--gateway must be one of: litellm (meta-llm is reserved until it documents a budget API; see ${ADR_POINTER})`;
}

/**
 * The LiteLLM `/key/generate` budget fields for a budget. Every window becomes
 * one `budget_limits` entry. `model_max_budget` (the ladder's window, on the
 * named model) and `budget_fallbacks` (model → [fallbackModel]) are added only
 * when `model` is given: the file names no primary model, and ruflo never
 * invents a gateway model name.
 */
export function toLiteLLMKeyBody(budget: BudgetFile, model?: string): LiteLLMKeyBody {
  const body: LiteLLMKeyBody = {
    budget_limits: budget.windows.map((w) => ({ budget_duration: w.period, max_budget: w.usd })),
  };
  if (model !== undefined) {
    if (!MODEL.test(model)) throw new Error('--model must be a plain model name (letters, digits, . _ : / @ -; at most 128)');
    const w = ladderWindow(budget);
    body.model_max_budget = { [model]: { budget_limit: w.usd, time_period: w.period } };
    if (budget.fallbackModel) body.budget_fallbacks = { [model]: [budget.fallbackModel] };
  }
  return body;
}

/** The body as YAML (LiteLLM key settings) or as the `/key/generate` JSON body. */
export function formatBody(body: LiteLLMKeyBody, format: 'yaml' | 'json'): string {
  return format === 'json' ? `${JSON.stringify(body, null, 2)}\n` : stringifyYaml(body);
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The `/key/generate` URL for a proxy URL, or the reason it is refused:
 * HTTPS only, except a loopback host (`localhost`, `127.0.0.1`, `[::1]`);
 * no credentials in the URL; no query or fragment; no path starting with `//`.
 * The result always keeps the given scheme and host.
 */
export function keyGenerateUrl(proxy: unknown): { url?: URL; error?: string } {
  if (typeof proxy !== 'string' || proxy.trim() === '') return { error: '--apply needs --url <proxy base URL>' };
  let u: URL;
  try {
    u = new URL(proxy);
  } catch {
    return { error: `--url is not a URL: ${proxy.slice(0, 200)}` };
  }
  if (u.username || u.password) return { error: '--url must not carry credentials; the key comes from --key-env' };
  if (u.search || u.hash) return { error: '--url must be the proxy base URL, without a query or fragment' };
  const loopback = LOOPBACK.has(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) {
    return { error: `--apply refuses ${u.protocol}//${u.hostname}: use https, or plain http only to a loopback host (localhost, 127.0.0.1, [::1])` };
  }
  // A path starting with "//" ("/\" normalises to it) would read as a protocol-relative
  // URL if resolved as a string, and move the request, bearer key included, to another host.
  if (u.pathname.startsWith('//')) return { error: '--url path must not start with "//" or "/\\"' };
  // The path is set on a copy, never resolved from a string, so it cannot change the
  // scheme or host; the check below holds that anyway.
  const out = new URL(u.href);
  out.pathname = `${u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`}key/generate`;
  if (out.protocol !== u.protocol || out.host !== u.host) return { error: `--url would send the key to another host (${out.host}); refused` };
  return { url: out };
}

/** The master key from the environment variable `--key-env` names (never from argv), or why there is none. */
export function keyFromEnv(name: unknown, env: NodeJS.ProcessEnv = process.env): { key?: string; error?: string } {
  if (typeof name !== 'string' || !ENV_NAME.test(name)) return { error: '--apply needs --key-env <ENV_VAR_NAME> (upper-case letters, digits, _); the key itself is never taken from the command line' };
  const key = env[name];
  if (!key) return { error: `environment variable ${name} is not set or empty` };
  return { key };
}

/** A key shown masked: its first 4 characters and its length. */
export const maskKey = (key: string) => (key.length <= 8 ? '********' : `${key.slice(0, 4)}…(${key.length} chars)`);

export interface ApplyResult { ok: boolean; status: number; generatedKey?: string; error?: string }

/**
 * POSTs the budget fields to the proxy's `/key/generate`. Only the budget
 * fields are sent; redirects are refused (one could leave HTTPS or loopback);
 * 15 s timeout.
 */
export async function applyToLiteLLM(url: URL, masterKey: string, body: LiteLLMKeyBody, fetchImpl: typeof fetch = fetch): Promise<ApplyResult> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${masterKey}` },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return { ok: false, status: 0, error: String((error as Error)?.message ?? error).slice(0, 300) };
  }
  const text = (await res.text().catch(() => '')).slice(0, 64 * 1024);
  if (!res.ok) return { ok: false, status: res.status, error: text.replace(/\s+/g, ' ').slice(0, 300) };
  let generatedKey: string | undefined;
  try {
    const parsed = JSON.parse(text) as { key?: unknown };
    if (typeof parsed.key === 'string') generatedKey = parsed.key;
  } catch {
    // a 2xx without a JSON body still applied
  }
  return { ok: true, status: res.status, generatedKey };
}
