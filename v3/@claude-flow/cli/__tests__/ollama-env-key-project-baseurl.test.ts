/**
 * SECURITY: with Ollama selected, the Ollama branch paired the environment's
 * OLLAMA_API_KEY with a baseUrl read from the project's
 * `claude-flow.config.json`. A cloned repository can commit that file, so the
 * project could choose where the user's key (and every prompt) was sent. The
 * environment key now goes only to OLLAMA_BASE_URL or Ollama Cloud; a
 * project-chosen endpoint gets only the key saved beside it, or none.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callAnthropicMessages } from '../src/mcp-tools/agent-execute-core.js';
import { configManager } from '../src/services/config-file-manager.js';

const ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL',
  'OLLAMA_API_KEY', 'OLLAMA_BASE_URL', 'OLLAMA_DEFAULT_MODEL', 'RUFLO_PROVIDER',
] as const;

const PROJECT_URL = 'https://project-chosen.example';
const ENV_KEY = 'env-ollama-key';

describe('Ollama: the environment key never goes to a project-chosen endpoint', () => {
  let dir: string;
  let prevCwd: string | undefined;
  let prevEnv: Record<string, string | undefined>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const writeProjectConfig = (entry: Record<string, unknown>) => writeFileSync(
    join(dir, 'claude-flow.config.json'),
    JSON.stringify({ agents: { providers: [{ name: 'ollama', enabled: true, ...entry }] } }),
  );

  function lastRequest(): { url: string; headers: Record<string, string> } {
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    return { url, headers: init.headers as Record<string, string> };
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-ollama-key-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    prevEnv = {};
    for (const key of ENV_KEYS) { prevEnv[key] = process.env[key]; delete process.env[key]; }
    (configManager as unknown as { config: unknown }).config = null;
    (configManager as unknown as { configPath: unknown }).configPath = null;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'chatcmpl-test', model: 'm',
        choices: [{ message: { role: 'assistant', content: 'PONG' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    } as unknown as Response);
    process.env.RUFLO_PROVIDER = 'ollama';
    process.env.OLLAMA_API_KEY = ENV_KEY;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD; else process.env.CLAUDE_FLOW_CWD = prevCwd;
    for (const key of ENV_KEYS) {
      if (prevEnv[key] === undefined) delete process.env[key]; else process.env[key] = prevEnv[key];
    }
    (configManager as unknown as { config: unknown }).config = null;
    (configManager as unknown as { configPath: unknown }).configPath = null;
    rmSync(dir, { recursive: true, force: true });
    fetchSpy.mockRestore();
  });

  it('does not send OLLAMA_API_KEY to a baseUrl from project config', async () => {
    writeProjectConfig({ baseUrl: PROJECT_URL });
    await callAnthropicMessages({ prompt: 'ping', model: 'qwen3-coder:30b' });
    const { url, headers } = lastRequest();
    expect(url).toBe(`${PROJECT_URL}/v1/chat/completions`);
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain(ENV_KEY);
  });

  it('sends a key saved beside the project baseUrl to that baseUrl', async () => {
    writeProjectConfig({ baseUrl: PROJECT_URL, apiKey: 'saved-with-url' });
    await callAnthropicMessages({ prompt: 'ping', model: 'qwen3-coder:30b' });
    expect(lastRequest().headers.Authorization).toBe('Bearer saved-with-url');
  });

  it('still sends OLLAMA_API_KEY to OLLAMA_BASE_URL, which the user set', async () => {
    writeProjectConfig({ baseUrl: PROJECT_URL });
    process.env.OLLAMA_BASE_URL = 'https://user-chosen.example';
    await callAnthropicMessages({ prompt: 'ping', model: 'qwen3-coder:30b' });
    const { url, headers } = lastRequest();
    expect(url).toBe('https://user-chosen.example/v1/chat/completions');
    expect(headers.Authorization).toBe(`Bearer ${ENV_KEY}`);
  });

  it('still sends OLLAMA_API_KEY to Ollama Cloud, by default or when the project names it', async () => {
    await callAnthropicMessages({ prompt: 'ping', model: 'qwen3-coder:30b' });
    expect(lastRequest()).toMatchObject({ url: 'https://ollama.com/v1/chat/completions', headers: { Authorization: `Bearer ${ENV_KEY}` } });

    fetchSpy.mockClear();
    (configManager as unknown as { config: unknown }).config = null;
    (configManager as unknown as { configPath: unknown }).configPath = null;
    writeProjectConfig({ baseUrl: 'https://ollama.com' });
    await callAnthropicMessages({ prompt: 'ping', model: 'qwen3-coder:30b' });
    expect(lastRequest().headers.Authorization).toBe(`Bearer ${ENV_KEY}`);
  });
});
