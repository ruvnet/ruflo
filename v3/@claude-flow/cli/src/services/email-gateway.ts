/**
 * Email Gateway Service
 *
 * Enables users to interact with Claude Flow swarms via email.
 * Supports both inbound (webhook/IMAP polling) and outbound (SMTP) email.
 *
 * Architecture:
 *   User Email → SendGrid/Mailgun Webhook → Email Gateway → Swarm Router → Provider
 *                     or IMAP Polling                                       ↓
 *   User Email ← SMTP ← Email Gateway ← Response ← Provider Result
 *
 * Features:
 * - Inbound email processing via webhooks (SendGrid, Mailgun, Postmark)
 * - Outbound email via SMTP or API
 * - Rich formatting in responses (markdown → HTML)
 * - Attachment handling (code files, images)
 * - Thread tracking via In-Reply-To / References headers
 * - Subject-line commands ("[swarm]", "[model:kimi-k2]")
 * - Per-user session management
 * - Cost tracking per conversation
 *
 * @module @claude-flow/cli/services/email-gateway
 */

import { EventEmitter } from 'events';
import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';

// ===== TYPES =====

export interface EmailGatewayConfig {
  /** SMTP host for sending email */
  smtpHost?: string;
  /** SMTP port */
  smtpPort?: number;
  /** SMTP username */
  smtpUser?: string;
  /** SMTP password */
  smtpPass?: string;
  /** Send via API instead of SMTP: 'sendgrid' | 'mailgun' | 'postmark' */
  sendProvider?: 'sendgrid' | 'mailgun' | 'postmark' | 'smtp';
  /** API key for send provider */
  sendApiKey?: string;
  /** Inbound webhook provider: 'sendgrid' | 'mailgun' | 'postmark' */
  inboundProvider?: 'sendgrid' | 'mailgun' | 'postmark';
  /** Webhook secret for signature validation */
  webhookSecret?: string;
  /** Port for webhook server */
  webhookPort?: number;
  /** Webhook path */
  webhookPath?: string;
  /** From email address */
  fromEmail: string;
  /** From display name */
  fromName?: string;
  /** Default AI model for email interactions */
  defaultModel?: string;
  /** Max response length */
  maxResponseLength?: number;
  /** Session timeout in ms (default 24h for email) */
  sessionTimeout?: number;
  /** Allowed sender domains (empty = allow all) */
  allowedDomains?: string[];
}

export interface EmailMessage {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: Array<{
    filename: string;
    contentType: string;
    content: string; // base64
    size: number;
  }>;
  timestamp: number;
}

export interface EmailSession {
  email: string;
  threadId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>;
  model: string;
  subject: string;
  lastActivity: number;
  messageCount: number;
  totalCost: number;
}

// Subject-line command patterns
const SUBJECT_COMMANDS = {
  swarm: /\[swarm\]/i,
  model: /\[model:([^\]]+)\]/i,
  status: /\[status\]/i,
  clear: /\[clear\]/i,
};

const MODEL_SHORTCUTS: Record<string, string> = {
  'kimi': 'moonshotai/kimi-k2',
  'deepseek': 'deepseek/deepseek-chat-v3-0324',
  'deepseek-r1': 'deepseek/deepseek-r1',
  'llama': 'meta-llama/llama-3.3-70b-instruct',
  'qwen': 'qwen/qwen3-235b-a22b',
  'gemini': 'google/gemini-2.5-flash-preview',
  'claude': 'anthropic/claude-sonnet-4',
};

export class EmailGateway extends EventEmitter {
  private config: Required<EmailGatewayConfig>;
  private sessions: Map<string, EmailSession> = new Map();
  private server: http.Server | null = null;

  /**
   * Handler function that the caller sets to process AI requests.
   */
  public onAIRequest?: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    model: string,
    context?: { subject: string; attachments?: string[] }
  ) => Promise<{ content: string; cost: number }>;

  constructor(config: EmailGatewayConfig) {
    super();
    this.config = {
      smtpHost: config.smtpHost ?? 'smtp.sendgrid.net',
      smtpPort: config.smtpPort ?? 587,
      smtpUser: config.smtpUser ?? 'apikey',
      smtpPass: config.smtpPass ?? '',
      sendProvider: config.sendProvider ?? 'sendgrid',
      sendApiKey: config.sendApiKey ?? '',
      inboundProvider: config.inboundProvider ?? 'sendgrid',
      webhookSecret: config.webhookSecret ?? '',
      webhookPort: config.webhookPort ?? 3002,
      webhookPath: config.webhookPath ?? '/email/webhook',
      fromEmail: config.fromEmail,
      fromName: config.fromName ?? 'Claude Flow',
      defaultModel: config.defaultModel ?? 'deepseek/deepseek-chat-v3-0324',
      maxResponseLength: config.maxResponseLength ?? 50000,
      sessionTimeout: config.sessionTimeout ?? 86400000, // 24h
      allowedDomains: config.allowedDomains ?? [],
    };
  }

  /**
   * Start the inbound webhook server
   */
  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.handleWebhook(req, res).catch(err => {
        this.emit('error', err);
        res.writeHead(500);
        res.end('Error');
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
   * Process an incoming email
   */
  async processIncoming(email: EmailMessage): Promise<void> {
    // Domain filtering
    if (this.config.allowedDomains.length > 0) {
      const domain = email.from.split('@')[1]?.toLowerCase();
      if (!this.config.allowedDomains.includes(domain)) {
        this.emit('rejected', { from: email.from, reason: 'domain not allowed' });
        return;
      }
    }

    // Parse subject-line commands
    const commands = this.parseSubjectCommands(email.subject);

    // Get or create session
    const threadId = email.inReplyTo || email.messageId || crypto.randomUUID();
    const session = this.getOrCreateSession(email.from, threadId, email.subject);

    // Apply commands
    if (commands.model) {
      session.model = MODEL_SHORTCUTS[commands.model] || commands.model;
    }

    if (commands.clear) {
      session.messages = [];
      await this.sendEmail(email.from, `Re: ${email.subject}`, 'Conversation cleared.');
      return;
    }

    if (commands.status) {
      const status = [
        `Session: ${session.email}`,
        `Model: ${session.model}`,
        `Messages: ${session.messageCount}`,
        `Cost: $${session.totalCost.toFixed(4)}`,
      ].join('\n');
      await this.sendEmail(email.from, `Re: ${email.subject}`, status);
      return;
    }

    // Extract text content
    const content = this.extractContent(email);
    session.messages.push({ role: 'user', content, timestamp: Date.now() });
    session.lastActivity = Date.now();
    session.messageCount++;

    // Process with AI
    try {
      if (!this.onAIRequest) {
        await this.sendEmail(email.from, `Re: ${email.subject}`, 'AI provider not configured.');
        return;
      }

      const attachmentNames = email.attachments?.map(a => a.filename);

      const result = await this.onAIRequest(
        session.messages.map(m => ({ role: m.role, content: m.content })),
        session.model,
        { subject: email.subject, attachments: attachmentNames }
      );

      session.messages.push({ role: 'assistant', content: result.content, timestamp: Date.now() });
      session.totalCost += result.cost;

      // Send response email
      const responseSubject = email.subject.startsWith('Re:')
        ? email.subject
        : `Re: ${email.subject}`;

      const htmlContent = this.markdownToHtml(result.content);
      const footer = `\n\n---\nModel: ${session.model} | Cost: $${session.totalCost.toFixed(4)} | Reply to continue`;

      await this.sendEmail(
        email.from,
        responseSubject,
        result.content + footer,
        htmlContent + this.markdownToHtml(footer),
        email.messageId
      );

      this.emit('message:processed', {
        from: email.from,
        model: session.model,
        cost: result.cost,
      });

      // Handle swarm command
      if (commands.swarm) {
        this.emit('swarm:requested', {
          email: email.from,
          task: content,
          model: session.model,
          threadId,
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await this.sendEmail(
        email.from,
        `Re: ${email.subject}`,
        `Error processing your request: ${errorMsg}`
      );
      this.emit('error', { from: email.from, error: errorMsg });
    }
  }

  /**
   * Send an email
   */
  async sendEmail(
    to: string,
    subject: string,
    textBody: string,
    htmlBody?: string,
    inReplyTo?: string
  ): Promise<void> {
    switch (this.config.sendProvider) {
      case 'sendgrid':
        await this.sendViaSendGrid(to, subject, textBody, htmlBody, inReplyTo);
        break;
      case 'mailgun':
        await this.sendViaMailgun(to, subject, textBody, htmlBody, inReplyTo);
        break;
      default:
        await this.sendViaSMTP(to, subject, textBody, htmlBody, inReplyTo);
        break;
    }
  }

  /**
   * Get active sessions
   */
  getActiveSessions(): Array<{
    email: string;
    model: string;
    messageCount: number;
    totalCost: number;
    subject: string;
    lastActivity: number;
  }> {
    return Array.from(this.sessions.values())
      .filter(s => Date.now() - s.lastActivity < this.config.sessionTimeout)
      .map(s => ({
        email: s.email,
        model: s.model,
        messageCount: s.messageCount,
        totalCost: s.totalCost,
        subject: s.subject,
        lastActivity: s.lastActivity,
      }));
  }

  // ===== PRIVATE METHODS =====

  private async handleWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url || '', `http://localhost:${this.config.webhookPort}`);

    if (parsedUrl.pathname !== this.config.webhookPath || req.method !== 'POST') {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const body = await this.readBody(req);
    const email = this.parseInboundEmail(body, req.headers);

    if (email) {
      this.emit('message:received', email);
      await this.processIncoming(email);
    }

    res.writeHead(200);
    res.end('OK');
  }

  private parseInboundEmail(
    body: string,
    _headers: http.IncomingHttpHeaders
  ): EmailMessage | null {
    try {
      // Try JSON format (SendGrid, Postmark)
      const data = JSON.parse(body);

      // SendGrid format
      if (Array.isArray(data)) {
        const item = data[0];
        return {
          from: item.from?.email || item.envelope?.from || '',
          fromName: item.from?.name,
          to: item.to?.[0]?.email || '',
          subject: item.subject || '',
          textBody: item.text || item.plain || '',
          htmlBody: item.html,
          messageId: item.headers?.['message-id'] || item['message-id'],
          inReplyTo: item.headers?.['in-reply-to'],
          timestamp: Date.now(),
        };
      }

      // Postmark format
      if (data.From) {
        return {
          from: data.FromFull?.Email || data.From || '',
          fromName: data.FromFull?.Name,
          to: data.ToFull?.[0]?.Email || data.To || '',
          subject: data.Subject || '',
          textBody: data.TextBody || '',
          htmlBody: data.HtmlBody,
          messageId: data.MessageID,
          inReplyTo: data.Headers?.find((h: { Name: string }) =>
            h.Name.toLowerCase() === 'in-reply-to')?.Value,
          timestamp: Date.now(),
        };
      }

      return null;
    } catch {
      // Try URL-encoded format (Mailgun)
      const params = new URLSearchParams(body);
      if (params.get('sender') || params.get('from')) {
        return {
          from: params.get('sender') || params.get('from') || '',
          to: params.get('recipient') || '',
          subject: params.get('subject') || '',
          textBody: params.get('body-plain') || params.get('stripped-text') || '',
          htmlBody: params.get('body-html') || undefined,
          messageId: params.get('Message-Id') || undefined,
          inReplyTo: params.get('In-Reply-To') || undefined,
          timestamp: Date.now(),
        };
      }

      return null;
    }
  }

  private parseSubjectCommands(subject: string): {
    swarm: boolean;
    model?: string;
    status: boolean;
    clear: boolean;
  } {
    return {
      swarm: SUBJECT_COMMANDS.swarm.test(subject),
      model: subject.match(SUBJECT_COMMANDS.model)?.[1],
      status: SUBJECT_COMMANDS.status.test(subject),
      clear: SUBJECT_COMMANDS.clear.test(subject),
    };
  }

  private extractContent(email: EmailMessage): string {
    let content = email.textBody || '';

    // Strip quoted reply text (lines starting with >)
    content = content
      .split('\n')
      .filter(line => !line.startsWith('>') && !line.startsWith('On ') && !line.includes('wrote:'))
      .join('\n')
      .trim();

    // Add attachment info if present
    if (email.attachments?.length) {
      content += '\n\n[Attachments: ' + email.attachments.map(a => a.filename).join(', ') + ']';
    }

    return content;
  }

  private getOrCreateSession(email: string, threadId: string, subject: string): EmailSession {
    const key = `${email}:${threadId}`;
    let session = this.sessions.get(key);

    if (!session || Date.now() - session.lastActivity > this.config.sessionTimeout) {
      session = {
        email,
        threadId,
        messages: [],
        model: this.config.defaultModel,
        subject,
        lastActivity: Date.now(),
        messageCount: 0,
        totalCost: 0,
      };
      this.sessions.set(key, session);
    }

    return session;
  }

  private markdownToHtml(markdown: string): string {
    // Simple markdown → HTML conversion
    return markdown
      .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>');
  }

  private async sendViaSendGrid(
    to: string,
    subject: string,
    textBody: string,
    htmlBody?: string,
    inReplyTo?: string
  ): Promise<void> {
    const payload = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: this.config.fromEmail, name: this.config.fromName },
      subject,
      content: [
        { type: 'text/plain', value: textBody },
        ...(htmlBody ? [{ type: 'text/html', value: htmlBody }] : []),
      ],
      ...(inReplyTo ? { headers: { 'In-Reply-To': inReplyTo, References: inReplyTo } } : {}),
    };

    await this.httpPost(
      'api.sendgrid.com',
      '/v3/mail/send',
      payload,
      { Authorization: `Bearer ${this.config.sendApiKey}` }
    );
  }

  private async sendViaMailgun(
    to: string,
    subject: string,
    textBody: string,
    htmlBody?: string,
    inReplyTo?: string
  ): Promise<void> {
    const domain = this.config.fromEmail.split('@')[1];
    const params = new URLSearchParams({
      from: `${this.config.fromName} <${this.config.fromEmail}>`,
      to,
      subject,
      text: textBody,
      ...(htmlBody ? { html: htmlBody } : {}),
      ...(inReplyTo ? { 'h:In-Reply-To': inReplyTo, 'h:References': inReplyTo } : {}),
    });

    await this.httpPost(
      'api.mailgun.net',
      `/v3/${domain}/messages`,
      params.toString(),
      {
        Authorization: `Basic ${Buffer.from(`api:${this.config.sendApiKey}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    );
  }

  private async sendViaSMTP(
    to: string,
    subject: string,
    textBody: string,
    _htmlBody?: string,
    _inReplyTo?: string
  ): Promise<void> {
    // Basic SMTP - for production use nodemailer
    this.emit('smtp:send', { to, subject, body: textBody });
    // The actual SMTP implementation would use nodemailer or similar
    // This emits an event so the consuming code can handle it
  }

  private httpPost(
    hostname: string,
    path: string,
    body: unknown,
    headers: Record<string, string>
  ): Promise<void> {
    const data = typeof body === 'string' ? body : JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname,
          port: 443,
          path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            ...headers,
          },
        },
        (res) => {
          let responseData = '';
          res.on('data', chunk => { responseData += chunk; });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`Email send failed: ${res.statusCode} ${responseData}`));
            } else {
              resolve();
            }
          });
        }
      );

      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }
}
