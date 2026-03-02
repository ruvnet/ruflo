/**
 * V3 Novita Provider
 *
 * OpenAI-compatible provider configured for Novita endpoint.
 *
 * @module @claude-flow/providers/novita-provider
 */

import { BaseProviderOptions } from './base-provider.js';
import { OpenAIProvider } from './openai-provider.js';

const NOVITA_API_URL = 'https://api.novita.ai/openai';

export class NovitaProvider extends OpenAIProvider {
  constructor(options: BaseProviderOptions) {
    super({
      ...options,
      config: {
        ...options.config,
        provider: 'novita',
        apiUrl: options.config.apiUrl || NOVITA_API_URL,
      },
    });
  }
}
