import { afterEach, describe, expect, it, vi } from 'vitest';
import { NovitaProvider } from '../novita-provider.js';
import { consoleLogger } from '../base-provider.js';

describe('NovitaProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses Novita OpenAI-compatible endpoint and returns novita provider label', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://api.novita.ai/openai/chat/completions');
      return new Response(
        JSON.stringify({
          id: 'cmpl-test',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'hello from novita' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 3,
            total_tokens: 8,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    vi.stubGlobal('fetch', fetchMock);

    const provider = new NovitaProvider({
      config: {
        provider: 'novita',
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
      },
      logger: consoleLogger,
    });

    await provider.initialize();
    const response = await provider.complete({
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(response.provider).toBe('novita');
    expect(response.content).toBe('hello from novita');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    provider.destroy();
  });
});
