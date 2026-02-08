/**
 * SMS Gateway Service
 *
 * Enables users to interact with Claude Flow swarms via SMS.
 * Integrates with Twilio for SMS send/receive and provides a
 * webhook endpoint for incoming messages.
 *
 * Architecture:
 *   User SMS → Twilio → Webhook → SMS Gateway → Swarm Router → Provider
 *                                                              ↓
 *   User SMS ← Twilio ← SMS Gateway ← Response ← Provider Result
 *
 * Features:
 * - Send/receive SMS via Twilio
 * - Session management (track conversations per phone number)
 * - Rate limiting per number
 * - Cost tracking per message
 * - Provider routing (use cheapest model for SMS to control costs)
 * - Multi-turn conversations with memory
 * - Command parsing (e.g., "/swarm", "/status", "/model kimi-k2")
 *
 * @module @claude-flow/cli/services/sms-gateway
 */

import { EventEmitter } from 'events';
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import * as crypto from 'crypto';

// ===== TYPES =====

export interface SMSGatewayConfig {
  /** Twilio Account SID */
  accountSid: string;
  /** Twilio Auth Token */
  authToken: string;
  /** Twilio phone number to send from (E.164 format) */
  fromNumber: string;
  /** Port for webhook server */
  webhookPort?: number;
  /** Webhook path for incoming messages */
  webhookPath?: string;
  /** Max SMS length before splitting */
  maxSmsLength?: number;
  /** Default AI model for SMS interactions */
  defaultModel?: string;
  /** Max messages per hour per number (rate limiting) */
  rateLimit?: number;
  /** Session timeout in ms (default 30 min) */
  sessionTimeout?: number;
  /** Enable Twilio signature validation */
  validateSignature?: boolean;
  /** Public URL for webhook (for Twilio to call back) */
  publicUrl?: string;
}

export interface SMSSession {
  phoneNumber: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>;
  model: string;
  swarmActive: boolean;
  lastActivity: number;
  messageCount: number;
  totalCost: number;
}

export interface SMSIncomingMessage {
  from: string;
  to: string;
  body: string;
  messageSid: string;
  timestamp: number;
}

export interface SMSOutgoingMessage {
  to: string;
  body: string;
  messageSid?: string;
  cost?: number;
}

type SMSCommandHandler = (session: SMSSession, args: string) => Promise<string>;

// ===== SMS COMMANDS =====

const SMS_COMMANDS: Record<string, { description: string; usage: string }> = {
  '/help': { description: 'Show available commands', usage: '/help' },
  '/model': { description: 'Switch AI model', usage: '/model kimi-k2 or /model deepseek-v3' },
  '/swarm': { description: 'Start a multi-agent swarm task', usage: '/swarm <task description>' },
  '/status': { description: 'Check current session status', usage: '/status' },
  '/cost': { description: 'Show cost for this session', usage: '/cost' },
  '/clear': { description: 'Clear conversation history', usage: '/clear' },
  '/models': { description: 'List available cheap models', usage: '/models' },
};

// Model shortcuts for SMS convenience
const MODEL_SHORTCUTS: Record<string, string> = {
  'kimi': 'moonshotai/kimi-k2',
  'kimi-k2': 'moonshotai/kimi-k2',
  'deepseek': 'deepseek/deepseek-chat-v3-0324',
  'deepseek-v3': 'deepseek/deepseek-chat-v3-0324',
  'deepseek-r1': 'deepseek/deepseek-r1',
  'llama': 'meta-llama/llama-3.3-70b-instruct',
  'llama-4': 'meta-llama/llama-4-scout',
  'qwen': 'qwen/qwen3-235b-a22b',
  'qwen-small': 'qwen/qwen3-30b-a3b',
  'gemini': 'google/gemini-2.5-flash-preview',
  'gemini-pro': 'google/gemini-2.5-pro-preview',
  'codestral': 'mistralai/codestral-2501',
  'claude': 'anthropic/claude-sonnet-4',
};

// ===== GATEWAY =====

export class SMSGateway extends EventEmitter {
  private config: Required<SMSGatewayConfig>;
  private sessions: Map<string, SMSSession> = new Map();
  private rateLimiter: Map<string, number[]> = new Map();
  private server: http.Server | null = null;
  private commandHandlers: Map<string, SMSCommandHandler> = new Map();

  /**
   * Handler function that the caller sets to process AI requests.
   * This decouples the SMS gateway from the provider system.
   *
   * Signature: (messages, model) => Promise<{ content: string; cost: number }>
   */
  public onAIRequest?: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    model: string
  ) => Promise<{ content: string; cost: number }>;

  constructor(config: SMSGatewayConfig) {
    super();
    this.config = {
      accountSid: config.accountSid,
      authToken: config.authToken,
      fromNumber: config.fromNumber,
      webhookPort: config.webhookPort ?? 3001,
      webhookPath: config.webhookPath ?? '/sms/webhook',
      maxSmsLength: config.maxSmsLength ?? 1600,
      defaultModel: config.defaultModel ?? 'qwen/qwen3-30b-a3b', // Ultra-cheap default
      rateLimit: config.rateLimit ?? 30,
      sessionTimeout: config.sessionTimeout ?? 1800000, // 30 min
      validateSignature: config.validateSignature ?? true,
      publicUrl: config.publicUrl ?? '',
    };

    this.registerCommands();
  }

  /**
   * Start the webhook server for incoming SMS
   */
  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch(err => {
        this.emit('error', err);
        res.writeHead(500);
        res.end('Internal Server Error');
      });
    });

    return new Promise((resolve) => {
      this.server!.listen(this.config.webhookPort, () => {
        this.emit('started', { port: this.config.webhookPort });
        resolve();
      });
    });
  }

  /**
   * Stop the webhook server
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.emit('stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Send an SMS via Twilio
   */
  async sendSMS(to: string, body: string): Promise<SMSOutgoingMessage> {
    const segments = this.splitMessage(body);
    const results: SMSOutgoingMessage[] = [];

    for (const segment of segments) {
      const result = await this.twilioSend(to, segment);
      results.push(result);
    }

    return {
      to,
      body,
      messageSid: results[0]?.messageSid,
      cost: results.reduce((sum, r) => sum + (r.cost || 0), 0),
    };
  }

  /**
   * Process an incoming SMS message
   */
  async processIncoming(message: SMSIncomingMessage): Promise<string> {
    const { from, body } = message;

    // Rate limiting
    if (!this.checkRateLimit(from)) {
      return 'Rate limit reached. Please wait a few minutes.';
    }

    // Get or create session
    const session = this.getOrCreateSession(from);
    session.lastActivity = Date.now();
    session.messageCount++;

    // Check for commands
    if (body.startsWith('/')) {
      const [command, ...argParts] = body.split(' ');
      const args = argParts.join(' ');
      const handler = this.commandHandlers.get(command.toLowerCase());
      if (handler) {
        return handler(session, args);
      }
    }

    // Regular message - send to AI
    session.messages.push({ role: 'user', content: body, timestamp: Date.now() });

    try {
      if (!this.onAIRequest) {
        return 'AI provider not configured. Set up a provider first.';
      }

      const aiMessages = session.messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const result = await this.onAIRequest(aiMessages, session.model);
      session.messages.push({
        role: 'assistant',
        content: result.content,
        timestamp: Date.now(),
      });
      session.totalCost += result.cost;

      this.emit('message:processed', {
        from,
        model: session.model,
        cost: result.cost,
      });

      return result.content;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { from, error: errorMsg });
      return `Error: ${errorMsg.slice(0, 100)}`;
    }
  }

  /**
   * Get active sessions info
   */
  getActiveSessions(): Array<{
    phoneNumber: string;
    model: string;
    messageCount: number;
    totalCost: number;
    lastActivity: number;
  }> {
    return Array.from(this.sessions.values())
      .filter(s => Date.now() - s.lastActivity < this.config.sessionTimeout)
      .map(s => ({
        phoneNumber: s.phoneNumber,
        model: s.model,
        messageCount: s.messageCount,
        totalCost: s.totalCost,
        lastActivity: s.lastActivity,
      }));
  }

  // ===== PRIVATE METHODS =====

  private registerCommands(): void {
    this.commandHandlers.set('/help', async () => {
      const lines = ['Claude Flow SMS Commands:'];
      for (const [cmd, info] of Object.entries(SMS_COMMANDS)) {
        lines.push(`${cmd} - ${info.description}`);
      }
      lines.push('', 'Or just text your question!');
      return lines.join('\n');
    });

    this.commandHandlers.set('/model', async (session, args) => {
      if (!args) {
        return `Current model: ${session.model}\nUse /model <name> to switch.\nShortcuts: kimi, deepseek, llama, qwen, gemini, claude`;
      }
      const resolved = MODEL_SHORTCUTS[args.toLowerCase()] || args;
      session.model = resolved;
      return `Switched to model: ${resolved}`;
    });

    this.commandHandlers.set('/models', async () => {
      const models = [
        'kimi - Kimi K2 ($0.0006/1K) - Best value reasoning',
        'deepseek - DeepSeek V3 ($0.0003/1K) - Cheapest code',
        'deepseek-r1 - DeepSeek R1 ($0.0008/1K) - o1-class reasoning',
        'qwen-small - Qwen 3 30B ($0.00005/1K) - Ultra-fast & cheap',
        'llama - Llama 3.3 70B ($0.00012/1K) - Great general model',
        'gemini - Gemini Flash ($0.00015/1K) - 1M context',
      ];
      return 'Available models:\n' + models.join('\n');
    });

    this.commandHandlers.set('/status', async (session) => {
      return [
        `Session: ${session.phoneNumber}`,
        `Model: ${session.model}`,
        `Messages: ${session.messageCount}`,
        `Cost: $${session.totalCost.toFixed(4)}`,
        `Swarm: ${session.swarmActive ? 'Active' : 'Inactive'}`,
      ].join('\n');
    });

    this.commandHandlers.set('/cost', async (session) => {
      return `Session cost: $${session.totalCost.toFixed(4)} (${session.messageCount} messages)`;
    });

    this.commandHandlers.set('/clear', async (session) => {
      session.messages = [];
      return 'Conversation cleared.';
    });

    this.commandHandlers.set('/swarm', async (session, args) => {
      if (!args) {
        return 'Usage: /swarm <task description>\nExample: /swarm analyze auth module for vulnerabilities';
      }
      session.swarmActive = true;
      this.emit('swarm:requested', {
        phoneNumber: session.phoneNumber,
        task: args,
        model: session.model,
      });
      return `Swarm initiated for: ${args}\nI'll text you when results are ready.`;
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = url.parse(req.url || '', true);

    if (parsedUrl.pathname !== this.config.webhookPath || req.method !== 'POST') {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    // Parse form body
    const body = await this.readBody(req);
    const params = new URLSearchParams(body);

    // Validate Twilio signature if enabled
    if (this.config.validateSignature) {
      const signature = req.headers['x-twilio-signature'] as string;
      if (!this.validateTwilioSignature(signature, params)) {
        res.writeHead(403);
        res.end('Invalid signature');
        return;
      }
    }

    const incoming: SMSIncomingMessage = {
      from: params.get('From') || '',
      to: params.get('To') || '',
      body: params.get('Body') || '',
      messageSid: params.get('MessageSid') || '',
      timestamp: Date.now(),
    };

    this.emit('message:received', incoming);

    // Process and reply
    const reply = await this.processIncoming(incoming);
    await this.sendSMS(incoming.from, reply);

    // Respond with TwiML (empty response since we send separately)
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  private validateTwilioSignature(
    signature: string,
    params: URLSearchParams
  ): boolean {
    if (!signature) return false;

    const webhookUrl = `${this.config.publicUrl}${this.config.webhookPath}`;

    // Sort params and concatenate
    const sorted = Array.from(params.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => k + v)
      .join('');

    const expected = crypto
      .createHmac('sha1', this.config.authToken)
      .update(webhookUrl + sorted)
      .digest('base64');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  }

  private async twilioSend(to: string, body: string): Promise<SMSOutgoingMessage> {
    const { accountSid, authToken, fromNumber } = this.config;

    const postData = new URLSearchParams({
      To: to,
      From: fromNumber,
      Body: body,
    }).toString();

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.twilio.com',
        port: 443,
        path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({
              to,
              body,
              messageSid: json.sid,
              cost: parseFloat(json.price || '0'),
            });
          } catch {
            resolve({ to, body });
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  private splitMessage(text: string): string[] {
    const max = this.config.maxSmsLength;
    if (text.length <= max) return [text];

    const segments: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= max) {
        segments.push(remaining);
        break;
      }

      // Try to split at a sentence or newline boundary
      let splitAt = remaining.lastIndexOf('\n', max);
      if (splitAt < max * 0.5) {
        splitAt = remaining.lastIndexOf('. ', max);
      }
      if (splitAt < max * 0.5) {
        splitAt = remaining.lastIndexOf(' ', max);
      }
      if (splitAt < max * 0.5) {
        splitAt = max;
      }

      segments.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }

    return segments;
  }

  private getOrCreateSession(phoneNumber: string): SMSSession {
    let session = this.sessions.get(phoneNumber);

    if (!session || Date.now() - session.lastActivity > this.config.sessionTimeout) {
      session = {
        phoneNumber,
        messages: [],
        model: this.config.defaultModel,
        swarmActive: false,
        lastActivity: Date.now(),
        messageCount: 0,
        totalCost: 0,
      };
      this.sessions.set(phoneNumber, session);
    }

    return session;
  }

  private checkRateLimit(phoneNumber: string): boolean {
    const now = Date.now();
    const hourAgo = now - 3600000;

    let timestamps = this.rateLimiter.get(phoneNumber) || [];
    timestamps = timestamps.filter(t => t > hourAgo);

    if (timestamps.length >= this.config.rateLimit) {
      return false;
    }

    timestamps.push(now);
    this.rateLimiter.set(phoneNumber, timestamps);
    return true;
  }
}
