/**
 * @claude-flow/cache-optimizer - Background Handler
 *
 * Handles background process execution for handoff operations.
 * Supports file-based communication for process isolation.
 */

import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { EventEmitter } from 'events';
import type {
  HandoffRequest,
  HandoffResponse,
  HandoffStatus,
} from '../types.js';

/**
 * Background process state
 */
interface BackgroundProcess {
  id: string;
  child: ChildProcess | null;
  request: HandoffRequest;
  status: HandoffStatus;
  startedAt: number;
  completedAt?: number;
  response?: HandoffResponse;
  outputFile: string;
  statusFile: string;
}

/**
 * BackgroundHandler - Manages isolated background processes for model handoffs
 */
export class BackgroundHandler extends EventEmitter {
  private workDir: string;
  private processes: Map<string, BackgroundProcess> = new Map();
  private pollInterval: number;
  private initialized: boolean = false;

  constructor(options: {
    workDir?: string;
    maxConcurrent?: number;
    pollInterval?: number;
  } = {}) {
    super();
    this.workDir = options.workDir || '/tmp/claude-flow-handoff';
    this.pollInterval = options.pollInterval || 100;
  }

  /**
   * Initialize work directory
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await mkdir(this.workDir, { recursive: true });
    this.initialized = true;
  }

  /**
   * Start a background handoff process
   */
  async start(request: HandoffRequest): Promise<string> {
    await this.initialize();

    const processId = randomUUID();
    const outputFile = join(this.workDir, `${processId}_output.json`);
    const statusFile = join(this.workDir, `${processId}_status.json`);
    const requestFile = join(this.workDir, `${processId}_request.json`);

    // Write request to file
    await writeFile(requestFile, JSON.stringify(request, null, 2));

    // Write initial status
    await writeFile(statusFile, JSON.stringify({
      status: 'processing',
      startedAt: Date.now(),
    }));

    // Generate the worker script
    const workerScript = this.generateWorkerScript(request, outputFile, statusFile);

    // Spawn detached process
    const child = spawn('node', ['-e', workerScript], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: this.workDir,
      env: {
        ...process.env,
        HANDOFF_REQUEST_FILE: requestFile,
        HANDOFF_OUTPUT_FILE: outputFile,
        HANDOFF_STATUS_FILE: statusFile,
      },
    });

    // Unref to allow parent to exit
    child.unref();

    const bgProcess: BackgroundProcess = {
      id: processId,
      child,
      request,
      status: 'processing',
      startedAt: Date.now(),
      outputFile,
      statusFile,
    };

    this.processes.set(processId, bgProcess);

    // Monitor process completion
    child.on('exit', async (code) => {
      const proc = this.processes.get(processId);
      if (proc) {
        proc.child = null;
        proc.completedAt = Date.now();

        try {
          // Read output file
          const output = await readFile(outputFile, 'utf8');
          proc.response = JSON.parse(output);
          proc.status = proc.response?.status || (code === 0 ? 'completed' : 'failed');
        } catch {
          proc.status = 'failed';
        }

        this.emit('complete', processId, proc.response);

        // Cleanup files
        try {
          await unlink(requestFile);
          await unlink(outputFile);
          await unlink(statusFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    this.emit('started', processId);
    return processId;
  }

  /**
   * Generate worker script for background execution
   */
  private generateWorkerScript(
    request: HandoffRequest,
    outputFile: string,
    statusFile: string
  ): string {
    // Escape strings for embedding in script
    const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

    return `
const fs = require('fs');
const https = require('https');
const http = require('http');

async function fetchWithTimeout(url, options, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function main() {
  const startTime = Date.now();
  const outputFile = '${escape(outputFile)}';
  const statusFile = '${escape(statusFile)}';

  const request = ${JSON.stringify(request)};

  // Update status
  fs.writeFileSync(statusFile, JSON.stringify({ status: 'processing', startedAt: startTime }));

  let response;
  try {
    // Determine provider and endpoint
    const provider = request.provider || 'ollama-local';
    let endpoint, body, headers;

    if (provider.includes('ollama') || request.provider === 'auto') {
      // Try Ollama first (local)
      endpoint = 'http://localhost:11434/api/chat';
      headers = { 'Content-Type': 'application/json' };
      body = JSON.stringify({
        model: 'llama3.2',
        messages: [
          request.systemPrompt ? { role: 'system', content: request.systemPrompt } : null,
          ...(request.context || []),
          { role: 'user', content: request.prompt },
        ].filter(Boolean),
        stream: false,
        options: {
          temperature: request.options?.temperature || 0.7,
          num_predict: request.options?.maxTokens || 2048,
        },
      });
    } else if (provider.includes('anthropic')) {
      endpoint = 'https://api.anthropic.com/v1/messages';
      const apiKey = process.env.ANTHROPIC_API_KEY;
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      };
      body = JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: request.options?.maxTokens || 2048,
        system: request.systemPrompt,
        messages: [
          ...(request.context || []).filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          })),
          { role: 'user', content: request.prompt },
        ],
      });
    } else if (provider.includes('openai')) {
      endpoint = 'https://api.openai.com/v1/chat/completions';
      const apiKey = process.env.OPENAI_API_KEY;
      headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      };
      body = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          request.systemPrompt ? { role: 'system', content: request.systemPrompt } : null,
          ...(request.context || []),
          { role: 'user', content: request.prompt },
        ].filter(Boolean),
        max_tokens: request.options?.maxTokens || 2048,
        temperature: request.options?.temperature || 0.7,
      });
    }

    const res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers,
      body,
    }, 30000);

    if (!res.ok) {
      throw new Error('Request failed: ' + res.status + ' ' + res.statusText);
    }

    const data = await res.json();

    // Extract content based on provider format
    let content = '';
    let tokens = { prompt: 0, completion: 0, total: 0 };

    if (data.message?.content) {
      // Ollama format
      content = data.message.content;
      tokens = {
        prompt: data.prompt_eval_count || 0,
        completion: data.eval_count || 0,
        total: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      };
    } else if (data.content?.[0]?.text) {
      // Anthropic format
      content = data.content[0].text;
      tokens = {
        prompt: data.usage?.input_tokens || 0,
        completion: data.usage?.output_tokens || 0,
        total: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      };
    } else if (data.choices?.[0]?.message?.content) {
      // OpenAI format
      content = data.choices[0].message.content;
      tokens = {
        prompt: data.usage?.prompt_tokens || 0,
        completion: data.usage?.completion_tokens || 0,
        total: data.usage?.total_tokens || 0,
      };
    }

    // Build response with callback instructions injection
    let finalContent = content;
    if (request.callbackInstructions) {
      finalContent += '\\n\\n---\\n[HANDOFF CALLBACK INSTRUCTIONS]\\n' + request.callbackInstructions + '\\n---';
    }

    response = {
      requestId: request.id,
      provider: provider,
      model: 'auto',
      content: finalContent,
      tokens,
      durationMs: Date.now() - startTime,
      status: 'completed',
      injectedInstructions: request.callbackInstructions,
      completedAt: Date.now(),
    };

  } catch (error) {
    response = {
      requestId: request.id,
      provider: request.provider || 'unknown',
      model: 'unknown',
      content: '',
      tokens: { prompt: 0, completion: 0, total: 0 },
      durationMs: Date.now() - startTime,
      status: 'failed',
      error: error.message || String(error),
      completedAt: Date.now(),
    };
  }

  // Write output
  fs.writeFileSync(outputFile, JSON.stringify(response, null, 2));
  fs.writeFileSync(statusFile, JSON.stringify({
    status: response.status,
    completedAt: Date.now(),
  }));
}

main().catch(e => {
  fs.writeFileSync('${escape(outputFile)}', JSON.stringify({
    requestId: '${request.id}',
    status: 'failed',
    error: e.message || String(e),
    completedAt: Date.now(),
  }));
  process.exit(1);
});
`;
  }

  /**
   * Poll for process completion
   */
  async poll(processId: string, timeout: number = 60000): Promise<HandoffResponse | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const proc = this.processes.get(processId);
      if (!proc) return null;

      if (proc.status === 'completed' || proc.status === 'failed') {
        return proc.response || null;
      }

      // Check status file
      try {
        const statusContent = await readFile(proc.statusFile, 'utf8');
        const status = JSON.parse(statusContent) as { status: string; completedAt?: number };

        if (status.status === 'completed' || status.status === 'failed') {
          // Read output
          try {
            const output = await readFile(proc.outputFile, 'utf8');
            proc.response = JSON.parse(output);
            proc.status = proc.response?.status || 'completed';
            proc.completedAt = status.completedAt || Date.now();
            return proc.response || null;
          } catch {
            proc.status = 'failed';
            return null;
          }
        }
      } catch {
        // Status file not yet written or error reading
      }

      await new Promise(resolve => setTimeout(resolve, this.pollInterval));
    }

    // Timeout
    const proc = this.processes.get(processId);
    if (proc) {
      proc.status = 'timeout';
    }
    return null;
  }

  /**
   * Get process status
   */
  getStatus(processId: string): { status: HandoffStatus; response?: HandoffResponse } | null {
    const proc = this.processes.get(processId);
    if (!proc) return null;

    return {
      status: proc.status,
      response: proc.response,
    };
  }

  /**
   * Cancel a background process
   */
  async cancel(processId: string): Promise<boolean> {
    const proc = this.processes.get(processId);
    if (!proc) return false;

    if (proc.child) {
      proc.child.kill('SIGTERM');
    }

    proc.status = 'cancelled';
    proc.completedAt = Date.now();

    // Cleanup files
    try {
      await unlink(proc.outputFile);
      await unlink(proc.statusFile);
    } catch {
      // Ignore cleanup errors
    }

    this.emit('cancelled', processId);
    return true;
  }

  /**
   * List all processes
   */
  list(): Array<{
    id: string;
    status: HandoffStatus;
    startedAt: number;
    completedAt?: number;
  }> {
    return Array.from(this.processes.values()).map(p => ({
      id: p.id,
      status: p.status,
      startedAt: p.startedAt,
      completedAt: p.completedAt,
    }));
  }

  /**
   * Clear completed processes
   */
  clearCompleted(): number {
    let count = 0;
    for (const [id, proc] of this.processes) {
      if (proc.status === 'completed' || proc.status === 'failed' || proc.status === 'cancelled' || proc.status === 'timeout') {
        this.processes.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Get active process count
   */
  getActiveCount(): number {
    let count = 0;
    for (const proc of this.processes.values()) {
      if (proc.status === 'processing' || proc.status === 'pending') {
        count++;
      }
    }
    return count;
  }

  /**
   * Shutdown all processes
   */
  async shutdown(): Promise<void> {
    for (const [_id, proc] of this.processes) {
      if (proc.child) {
        proc.child.kill('SIGTERM');
      }
      proc.status = 'cancelled';
      proc.completedAt = Date.now();
    }

    this.emit('shutdown');
  }
}

/**
 * Create a chainable handoff helper for workflow integration
 */
export function createHandoffChain(workDir?: string) {
  const handler = new BackgroundHandler({ workDir });

  return {
    /**
     * Start a handoff and get the process ID
     */
    async start(options: {
      prompt: string;
      systemPrompt?: string;
      provider?: string;
      callbackInstructions?: string;
    }): Promise<{ id: string; poll: () => Promise<HandoffResponse | null> }> {
      const request: HandoffRequest = {
        id: randomUUID(),
        provider: options.provider || 'auto',
        systemPrompt: options.systemPrompt,
        prompt: options.prompt,
        callbackInstructions: options.callbackInstructions,
        metadata: {
          sessionId: 'chain',
          source: 'handoff-chain',
          tags: [],
          createdAt: Date.now(),
        },
        options: {},
      };

      const id = await handler.start(request);

      return {
        id,
        poll: () => handler.poll(id),
      };
    },

    /**
     * Execute and wait for result
     */
    async execute(options: {
      prompt: string;
      systemPrompt?: string;
      provider?: string;
      callbackInstructions?: string;
      timeout?: number;
    }): Promise<HandoffResponse | null> {
      const { id, poll } = await this.start(options);

      // Extend poll to use custom timeout
      return handler.poll(id, options.timeout || 60000);
    },

    /**
     * Get underlying handler
     */
    getHandler: () => handler,
  };
}
