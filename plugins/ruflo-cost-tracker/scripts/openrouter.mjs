#!/usr/bin/env node
// cost-openrouter — what OpenRouter says you spent. Network, so it asks first.
//
//   OPENROUTER_API_KEY=… node openrouter.mjs key --yes            per-key limit, remaining, usage today/week/month
//   OPENROUTER_API_KEY=… node openrouter.mjs generation <id> --yes   one request's real billed cost + tokens
//   OPENROUTER_MANAGEMENT_KEY=… node openrouter.mjs credits --yes    account credits (management key only)
//
// Rules: without --yes nothing is sent (the command prints what it WOULD call);
// the only host is openrouter.ai; the key is the plugin option `openrouterApiKey`
// (sensitive, kept in the credential store, ADR-506) or $OPENROUTER_API_KEY, and is
// never printed, logged or written. `usage.cost` / `total_cost` from OpenRouter is
// the authoritative figure: do not recompute it from a price list.

import { readSecret, secretHint } from './_secret.mjs';

const HOST = 'https://openrouter.ai/api/v1';
const [command, ...rest] = process.argv.slice(2);
const yes = process.argv.includes('--yes');
const id = rest.find(item => !item.startsWith('--'));

const PLAN = {
  key: { path: '/key', env: 'OPENROUTER_API_KEY', option: 'openrouterApiKey', pick: ['label', 'limit', 'limit_remaining', 'limit_reset', 'usage', 'usage_daily', 'usage_weekly', 'usage_monthly', 'byok_usage', 'is_free_tier', 'free_model_daily_requests'] },
  generation: { path: `/generation?id=${encodeURIComponent(id ?? '')}`, env: 'OPENROUTER_API_KEY', option: 'openrouterApiKey', pick: ['id', 'model', 'provider_name', 'router', 'total_cost', 'usage', 'upstream_inference_cost', 'cache_discount', 'is_byok', 'tokens_prompt', 'tokens_completion', 'native_tokens_prompt', 'native_tokens_completion', 'native_tokens_reasoning', 'native_tokens_cached', 'service_tier', 'cancelled', 'finish_reason', 'session_id', 'created_at'] },
  credits: { path: '/credits', env: 'OPENROUTER_MANAGEMENT_KEY', pick: ['total_credits', 'total_usage'] },
};

const plan = PLAN[command];
if (plan === undefined || (command === 'generation' && id === undefined)) {
  console.error('usage: openrouter.mjs key|credits|generation <id> --yes');
  process.exit(2);
}
if (!yes) {
  console.log(`Would GET ${HOST}${plan.path} using $${plan.env}. Nothing was sent. Re-run with --yes to allow this one request.`);
  process.exit(0);
}
// `credits` needs a management key: it has no plugin option and stays environment-only.
const key = plan.option ? readSecret(plan.option, [plan.env]) : process.env[plan.env];
if (!key) {
  console.error(plan.option ? secretHint(plan.option, [plan.env]) : `${plan.env} is not set; export it in your shell (never paste a key into a prompt or a file).`);
  process.exit(2);
}

try {
  const response = await fetch(`${HOST}${plan.path}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    const hint = response.status === 403 && command === 'credits' ? ' (credits needs a management key, not a normal one)' : response.status === 404 && command === 'generation' ? ' (a just-finished request can take a moment to appear; retry shortly)' : '';
    console.error(`OpenRouter answered ${response.status}${hint}`);
    process.exit(1);
  }
  const body = (await response.json()).data ?? {};
  const out = {};
  for (const field of plan.pick) if (body[field] !== undefined) out[field] = body[field];
  console.log(JSON.stringify(out, null, 2));
} catch (error) {
  // Never echo the request: only the error class and message, which carry no headers.
  console.error(`request failed: ${error?.name ?? 'error'}`);
  process.exit(1);
}
