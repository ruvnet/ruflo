/**
 * Regression guard for a PR #3526 review finding: the fix for #2962 (an
 * explicit `RUFLO_PROVIDER=ollama`/`openrouter` must not be hijacked by a
 * stray key elsewhere in the environment) was implemented more broadly than
 * intended. It disabled key-based fallback for ANY explicit provider value,
 * not just `ollama`/`openrouter` — so `provider: 'anthropic'` (or any other
 * non-ollama/openrouter value, including whatever tier-routing stamps onto
 * an agent record) with no usable Anthropic configuration no longer fell
 * back to a configured Ollama/OpenRouter provider the way it did on base.
 *
 * Only `ollama` and `openrouter` are meant to be a no-fallback explicit
 * choice (matching their own dedicated tests in
 * ollama-local-default-model.test.ts). Every other explicit provider value
 * must still fall back to key-based inference when it has no usable
 * configuration of its own.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callAnthropicMessages } from '../src/mcp-tools/agent-execute-core.js';
import { configManager } from '../src/services/config-file-manager.js';

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'OLLAMA_API_KEY',
  'OLLAMA_BASE_URL',
  'OLLAMA_DEFAULT_MODEL',
  'RUFLO_PROVIDER',
] as const;

const OLLAMA = 'http://127.0.0.1:11434';

describe('#3526 review — explicit-provider override must not disable fallback for non-ollama/openrouter providers', () => {
  let dir: string;
  let prevCwd: string | undefined;
  let prevEnv: Record<string, string | undefined>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-provider-precedence-3526-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    prevEnv = {};
    for (const key of ENV_KEYS) {
      prevEnv[key] = process.env[key];
      delete process.env[key];
    }
    (configManager as unknown as { config: unknown }).config = null;
    (configManager as unknown as { configPath: unknown }).configPath = null;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'chatcmpl-test',
        model: 'qwen3-coder:30b',
        choices: [{ message: { role: 'assistant', content: 'PONG' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    } as unknown as Response);
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    for (const key of ENV_KEYS) {
      if (prevEnv[key] === undefined) delete process.env[key];
      else process.env[key] = prevEnv[key];
    }
    (configManager as unknown as { config: unknown }).config = null;
    (configManager as unknown as { configPath: unknown }).configPath = null;
    rmSync(dir, { recursive: true, force: true });
    fetchSpy.mockRestore();
  });

  function lastRequest(): { url: string; body: Record<string, unknown>; headers: Record<string, string> } {
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    return { url, body: JSON.parse(init.body as string), headers: init.headers as Record<string, string> };
  }

  // Regression (a): explicit provider: 'anthropic' on an agent record
  // (as tier-routing can stamp), with only a local Ollama config available
  // and no ANTHROPIC_API_KEY. Base fell back to Ollama; the unfixed PR
  // returned "No LLM provider configured".
  it('explicit provider "anthropic" with no Anthropic key falls back to a configured self-hosted Ollama', async () => {
    writeFileSync(
      join(dir, 'claude-flow.config.json'),
      JSON.stringify({ agents: { providers: [{ name: 'ollama', enabled: true, baseUrl: OLLAMA, model: 'qwen3-coder:30b' }] } }),
    );

    const result = await callAnthropicMessages({ prompt: 'ping', provider: 'anthropic' });

    expect(result.success).toBe(true);
    expect(lastRequest().url).toBe(`${OLLAMA}/v1/chat/completions`);
  });

  // Regression (b): RUFLO_PROVIDER=openai via env, with only
  // OPENROUTER_API_KEY set (no ANTHROPIC_API_KEY). Base fell back to
  // OpenRouter; the unfixed PR returned "No LLM provider configured".
  it('RUFLO_PROVIDER=openai with only OPENROUTER_API_KEY set falls back to OpenRouter', async () => {
    process.env.RUFLO_PROVIDER = 'openai';
    process.env.OPENROUTER_API_KEY = 'sk-or-real';

    const result = await callAnthropicMessages({ prompt: 'ping', model: 'sonnet' });

    expect(result.success).toBe(true);
    expect(lastRequest().url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  // Same shape as (a)/(b) but via an unrecognized explicit provider string,
  // to confirm the fix isn't a hardcoded 'anthropic'/'openai' allowlist.
  it('an unrecognized explicit provider value also falls back to key-based inference', async () => {
    process.env.RUFLO_PROVIDER = 'some-future-provider';
    process.env.OPENROUTER_API_KEY = 'sk-or-real';

    const result = await callAnthropicMessages({ prompt: 'ping', model: 'sonnet' });

    expect(result.success).toBe(true);
    expect(lastRequest().url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  // Explicit `ollama`/`openrouter` must keep their own no-fallback
  // semantics — this fix must not widen fallback for those two.
  it('explicit provider "ollama" with no usable Ollama config still fails rather than falling back to a present OpenRouter key', async () => {
    process.env.RUFLO_PROVIDER = 'ollama';
    process.env.OPENROUTER_API_KEY = 'sk-or-stray';
    // No OLLAMA_BASE_URL, no OLLAMA_API_KEY, no persisted ollama config —
    // Ollama itself has no usable configuration.

    const result = await callAnthropicMessages({ prompt: 'ping', model: 'sonnet' });

    expect(result.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
