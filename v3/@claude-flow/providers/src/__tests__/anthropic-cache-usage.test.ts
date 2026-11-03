/**
 * #4597 performance/security scan: Anthropic prompt-cache usage was ignored.
 * `input_tokens` excludes cache writes/reads, so the old response mapping
 * undercounted prompt tokens and over/under-stated cost; cache reads (0.1x)
 * and writes (1.25x) need their own accounting.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider.js';
import { consoleLogger } from '../base-provider.js';

function provider(): AnthropicProvider {
  return new AnthropicProvider({
    config: {
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-3-5-sonnet-latest',
    },
    logger: consoleLogger,
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Anthropic prompt-cache usage accounting', () => {
  it('counts cache writes/reads and applies their pricing multipliers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      id: 'msg_cache',
      type: 'message',
      role: 'assistant',
      model: 'claude-3-5-sonnet-latest',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 800,
      },
    })));

    const anthropic = provider();
    await anthropic.initialize();
    const response = await anthropic.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(response.usage).toMatchObject({
      promptTokens: 1100,
      completionTokens: 50,
      totalTokens: 1150,
      cacheCreationInputTokens: 200,
      cacheReadInputTokens: 800,
    });
    // (100 + 200*1.25 + 800*0.1) / 1000 * 0.003 = 0.00129
    expect(response.cost?.promptCost).toBeCloseTo(0.00129, 8);
    expect(response.cost?.completionCost).toBeCloseTo(0.00075, 8);
    expect(response.cost?.totalCost).toBeCloseTo(0.00204, 8);
  });

  it('keeps the existing usage/cost for a response with no cache tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      id: 'msg_plain',
      type: 'message',
      role: 'assistant',
      model: 'claude-3-5-sonnet-latest',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    })));

    const anthropic = provider();
    await anthropic.initialize();
    const response = await anthropic.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(response.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    expect(response.cost?.promptCost).toBeCloseTo(0.0003, 8);
  });

  it('carries the same accounting through the streaming done event', async () => {
    const events = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"cache_creation_input_tokens":20,"cache_read_input_tokens":30}}}\n\n',
      'data: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n',
      'data: {"type":"message_delta","usage":{"output_tokens":5}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn(async () => {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          for (const event of events) controller.enqueue(encoder.encode(event));
          controller.close();
        },
      }), { status: 200 });
    }));

    const anthropic = provider();
    await anthropic.initialize();
    const done: Array<{ usage?: Record<string, number>; cost?: Record<string, number> }> = [];
    for await (const event of anthropic.streamComplete({
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })) {
      if (event.type === 'done') {
        done.push(event as { usage?: Record<string, number>; cost?: Record<string, number> });
      }
    }

    expect(done).toHaveLength(1);
    expect(done[0].usage).toMatchObject({
      promptTokens: 60,
      completionTokens: 5,
      totalTokens: 65,
      cacheCreationInputTokens: 20,
      cacheReadInputTokens: 30,
    });
    expect(done[0].cost?.promptCost).toBeCloseTo(0.000114, 8);
    expect(done[0].cost?.completionCost).toBeCloseTo(0.000075, 8);
  });
});
