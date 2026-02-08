/**
 * Unified Messaging Bridge
 *
 * Connects SMS and Email gateways to the Claude Flow provider system
 * and swarm orchestration. This is the central integration point that
 * allows users to do EVERYTHING through a simple text or email.
 *
 * Architecture:
 *
 *   SMS Gateway  ─┐
 *                  ├─→ Messaging Bridge ─→ Universal Gateway ─→ AI Providers
 *   Email Gateway ─┘         │                                   (OpenRouter, Fireworks, etc.)
 *                            │
 *                            ├─→ Swarm Orchestrator (for /swarm commands)
 *                            ├─→ Memory System (conversation persistence)
 *                            └─→ Cost Tracker (budget enforcement)
 *
 * What users can do via SMS or email:
 * - Ask any question → routes to cheapest appropriate model
 * - Run swarms → "/swarm analyze my auth code"
 * - Switch models → "/model kimi-k2" or [model:deepseek-r1] in subject
 * - Check costs → "/cost"
 * - Get status → "/status"
 * - Run code analysis, security audits, generate code, etc.
 *
 * @module @claude-flow/cli/services/messaging-bridge
 */

import { EventEmitter } from 'events';
import { SMSGateway, SMSGatewayConfig } from './sms-gateway.js';
import { EmailGateway, EmailGatewayConfig, EmailMessage } from './email-gateway.js';

// ===== TYPES =====

export interface MessagingBridgeConfig {
  /** SMS configuration (optional - omit to disable SMS) */
  sms?: SMSGatewayConfig;
  /** Email configuration (optional - omit to disable email) */
  email?: EmailGatewayConfig;
  /** Function to send requests to the AI provider gateway */
  aiProvider: (
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    model: string,
    options?: { maxTokens?: number; temperature?: number }
  ) => Promise<{ content: string; cost: number; model: string; tokens: number }>;
  /** Function to trigger a swarm task (optional) */
  swarmHandler?: (task: string, model: string, replyTo: {
    type: 'sms' | 'email';
    address: string;
    threadId?: string;
  }) => Promise<void>;
  /** System prompt prepended to all conversations */
  systemPrompt?: string;
  /** Global daily budget across all messaging users */
  dailyBudget?: number;
  /** Per-user daily budget */
  perUserDailyBudget?: number;
  /** Enable conversation memory persistence */
  persistMemory?: boolean;
}

interface UserBudget {
  daily: number;
  dayStart: number;
}

export interface MessagingStats {
  smsMessages: number;
  emailMessages: number;
  totalCost: number;
  activeSMSSessions: number;
  activeEmailSessions: number;
  swarmTasksInitiated: number;
}

/**
 * Unified Messaging Bridge
 *
 * Wires together SMS + Email gateways with AI providers and swarm orchestration.
 */
export class MessagingBridge extends EventEmitter {
  private smsGateway?: SMSGateway;
  private emailGateway?: EmailGateway;
  private config: MessagingBridgeConfig;
  private userBudgets: Map<string, UserBudget> = new Map();
  private stats: MessagingStats = {
    smsMessages: 0,
    emailMessages: 0,
    totalCost: 0,
    activeSMSSessions: 0,
    activeEmailSessions: 0,
    swarmTasksInitiated: 0,
  };

  constructor(config: MessagingBridgeConfig) {
    super();
    this.config = config;

    // Initialize SMS gateway
    if (config.sms) {
      this.smsGateway = new SMSGateway(config.sms);
      this.smsGateway.onAIRequest = (messages, model) => this.handleAIRequest(messages, model);
      this.smsGateway.on('swarm:requested', (data) => this.handleSwarmRequest(
        data.task,
        data.model,
        { type: 'sms', address: data.phoneNumber }
      ));
      this.smsGateway.on('message:processed', () => { this.stats.smsMessages++; });
    }

    // Initialize email gateway
    if (config.email) {
      this.emailGateway = new EmailGateway(config.email);
      this.emailGateway.onAIRequest = (messages, model, context) =>
        this.handleAIRequest(messages, model, context);
      this.emailGateway.on('swarm:requested', (data) => this.handleSwarmRequest(
        data.task,
        data.model,
        { type: 'email', address: data.email, threadId: data.threadId }
      ));
      this.emailGateway.on('message:processed', () => { this.stats.emailMessages++; });
    }
  }

  /**
   * Start all configured gateways
   */
  async start(): Promise<void> {
    const startPromises: Promise<void>[] = [];

    if (this.smsGateway) {
      startPromises.push(this.smsGateway.start());
    }
    if (this.emailGateway) {
      startPromises.push(this.emailGateway.start());
    }

    await Promise.all(startPromises);
    this.emit('started', {
      sms: !!this.smsGateway,
      email: !!this.emailGateway,
    });
  }

  /**
   * Stop all gateways
   */
  async stop(): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    if (this.smsGateway) {
      stopPromises.push(this.smsGateway.stop());
    }
    if (this.emailGateway) {
      stopPromises.push(this.emailGateway.stop());
    }

    await Promise.all(stopPromises);
    this.emit('stopped');
  }

  /**
   * Send a message to a user (auto-detects SMS vs email)
   */
  async sendMessage(to: string, content: string, subject?: string): Promise<void> {
    if (to.includes('@')) {
      // Email
      if (this.emailGateway) {
        await this.emailGateway.sendEmail(to, subject || 'Claude Flow', content);
      }
    } else {
      // SMS (phone number)
      if (this.smsGateway) {
        await this.smsGateway.sendSMS(to, content);
      }
    }
  }

  /**
   * Get messaging statistics
   */
  getStats(): MessagingStats {
    this.stats.activeSMSSessions = this.smsGateway?.getActiveSessions().length || 0;
    this.stats.activeEmailSessions = this.emailGateway?.getActiveSessions().length || 0;
    return { ...this.stats };
  }

  /**
   * Get all active sessions across both gateways
   */
  getActiveSessions(): Array<{
    type: 'sms' | 'email';
    address: string;
    model: string;
    messageCount: number;
    totalCost: number;
  }> {
    const sessions: Array<{
      type: 'sms' | 'email';
      address: string;
      model: string;
      messageCount: number;
      totalCost: number;
    }> = [];

    if (this.smsGateway) {
      for (const s of this.smsGateway.getActiveSessions()) {
        sessions.push({
          type: 'sms',
          address: s.phoneNumber,
          model: s.model,
          messageCount: s.messageCount,
          totalCost: s.totalCost,
        });
      }
    }

    if (this.emailGateway) {
      for (const s of this.emailGateway.getActiveSessions()) {
        sessions.push({
          type: 'email',
          address: s.email,
          model: s.model,
          messageCount: s.messageCount,
          totalCost: s.totalCost,
        });
      }
    }

    return sessions;
  }

  // ===== PRIVATE =====

  private async handleAIRequest(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    model: string,
    context?: { subject?: string; attachments?: string[] }
  ): Promise<{ content: string; cost: number }> {
    // Build message array with system prompt
    const fullMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

    if (this.config.systemPrompt) {
      fullMessages.push({ role: 'system', content: this.config.systemPrompt });
    }

    // Add context from email subject/attachments
    if (context?.subject) {
      fullMessages.push({
        role: 'system',
        content: `Email subject: ${context.subject}${
          context.attachments?.length
            ? `\nAttachments: ${context.attachments.join(', ')}`
            : ''
        }`,
      });
    }

    fullMessages.push(...messages);

    // Check per-user budget
    const userKey = messages[0]?.content?.slice(0, 20) || 'unknown';
    this.checkUserBudget(userKey);

    // Call AI provider
    const result = await this.config.aiProvider(fullMessages, model, {
      maxTokens: 2048, // Keep responses concise for messaging
      temperature: 0.7,
    });

    // Track costs
    this.stats.totalCost += result.cost;
    this.updateUserBudget(userKey, result.cost);

    return {
      content: result.content,
      cost: result.cost,
    };
  }

  private async handleSwarmRequest(
    task: string,
    model: string,
    replyTo: { type: 'sms' | 'email'; address: string; threadId?: string }
  ): Promise<void> {
    this.stats.swarmTasksInitiated++;

    if (this.config.swarmHandler) {
      try {
        await this.config.swarmHandler(task, model, replyTo);
      } catch (error) {
        const msg = `Swarm task failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        await this.sendMessage(replyTo.address, msg);
      }
    } else {
      await this.sendMessage(
        replyTo.address,
        'Swarm tasks require additional setup. Configure a swarmHandler in the messaging bridge config.'
      );
    }
  }

  private checkUserBudget(userKey: string): void {
    if (!this.config.perUserDailyBudget) return;

    const budget = this.getUserBudget(userKey);
    if (budget.daily >= this.config.perUserDailyBudget) {
      throw new Error(
        `Daily budget limit reached ($${budget.daily.toFixed(2)} / $${this.config.perUserDailyBudget}). ` +
        'Try again tomorrow or switch to a cheaper model with /model qwen-small'
      );
    }
  }

  private updateUserBudget(userKey: string, cost: number): void {
    const budget = this.getUserBudget(userKey);
    budget.daily += cost;
    this.userBudgets.set(userKey, budget);
  }

  private getUserBudget(userKey: string): UserBudget {
    let budget = this.userBudgets.get(userKey);
    const now = Date.now();

    if (!budget || now - budget.dayStart > 86400000) {
      budget = { daily: 0, dayStart: now };
      this.userBudgets.set(userKey, budget);
    }

    return budget;
  }
}

/**
 * Quick factory: create a fully configured messaging bridge from env vars
 *
 * Required env vars:
 *   SMS:    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 *   Email:  EMAIL_FROM, SENDGRID_API_KEY (or MAILGUN_API_KEY)
 *
 * Optional:
 *   SMS_WEBHOOK_PORT, EMAIL_WEBHOOK_PORT
 *   DEFAULT_MODEL, SYSTEM_PROMPT
 *   DAILY_BUDGET, PER_USER_DAILY_BUDGET
 */
export function createMessagingBridgeFromEnv(
  aiProvider: MessagingBridgeConfig['aiProvider'],
  swarmHandler?: MessagingBridgeConfig['swarmHandler']
): MessagingBridge {
  const env = process.env;

  const smsConfig: SMSGatewayConfig | undefined = env.TWILIO_ACCOUNT_SID ? {
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN || '',
    fromNumber: env.TWILIO_PHONE_NUMBER || '',
    webhookPort: parseInt(env.SMS_WEBHOOK_PORT || '3001'),
    defaultModel: env.DEFAULT_MODEL || 'qwen/qwen3-30b-a3b',
    publicUrl: env.SMS_PUBLIC_URL,
  } : undefined;

  const emailConfig: EmailGatewayConfig | undefined = env.EMAIL_FROM ? {
    fromEmail: env.EMAIL_FROM,
    fromName: env.EMAIL_FROM_NAME || 'Claude Flow',
    sendProvider: env.SENDGRID_API_KEY ? 'sendgrid' : env.MAILGUN_API_KEY ? 'mailgun' : 'smtp',
    sendApiKey: env.SENDGRID_API_KEY || env.MAILGUN_API_KEY || '',
    webhookPort: parseInt(env.EMAIL_WEBHOOK_PORT || '3002'),
    defaultModel: env.DEFAULT_MODEL || 'deepseek/deepseek-chat-v3-0324',
    smtpHost: env.SMTP_HOST,
    smtpPort: parseInt(env.SMTP_PORT || '587'),
    smtpUser: env.SMTP_USER,
    smtpPass: env.SMTP_PASS,
  } : undefined;

  return new MessagingBridge({
    sms: smsConfig,
    email: emailConfig,
    aiProvider,
    swarmHandler,
    systemPrompt: env.SYSTEM_PROMPT || 'You are Claude Flow, an AI assistant. Be concise and helpful.',
    dailyBudget: env.DAILY_BUDGET ? parseFloat(env.DAILY_BUDGET) : undefined,
    perUserDailyBudget: env.PER_USER_DAILY_BUDGET ? parseFloat(env.PER_USER_DAILY_BUDGET) : undefined,
  });
}
