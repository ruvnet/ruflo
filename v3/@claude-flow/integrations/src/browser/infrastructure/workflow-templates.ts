/**
 * @claude-flow/browser - Workflow Templates
 * Pre-built workflow templates for common browser automation tasks
 */

import type { BrowserTrajectoryStep } from '../domain/types.js';

// ============================================================================
// Workflow Types
// ============================================================================

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: WorkflowCategory;
  steps: WorkflowStep[];
  variables: WorkflowVariable[];
  tags: string[];
  estimatedDuration: number; // ms
  successRate?: number;
}

export type WorkflowCategory =
  | 'authentication'
  | 'data-extraction'
  | 'form-submission'
  | 'navigation'
  | 'testing'
  | 'monitoring';

export interface WorkflowStep {
  id: string;
  action: BrowserAction;
  target?: string; // Selector or variable reference ${var}
  value?: string; // Value or variable reference
  waitAfter?: number;
  optional?: boolean;
  onError?: 'continue' | 'abort' | 'retry';
  maxRetries?: number;
  condition?: string; // JavaScript condition
}

export type BrowserAction =
  | 'open'
  | 'click'
  | 'fill'
  | 'type'
  | 'press'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'hover'
  | 'scroll'
  | 'wait'
  | 'screenshot'
  | 'snapshot'
  | 'get'
  | 'eval'
  | 'assert';

export interface WorkflowVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'selector';
  required: boolean;
  default?: string | number | boolean;
  description: string;
  sensitive?: boolean; // Will be masked in logs
}

export interface WorkflowExecution {
  templateId: string;
  variables: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  currentStep: number;
  results: WorkflowStepResult[];
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface WorkflowStepResult {
  stepId: string;
  success: boolean;
  duration: number;
  data?: unknown;
  error?: string;
  retries?: number;
}

// ============================================================================
// Built-in Workflow Templates
// ============================================================================

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  // ============ Authentication ============
  {
    id: 'login-basic',
    name: 'Basic Login',
    description: 'Standard username/password login flow',
    category: 'authentication',
    tags: ['login', 'auth', 'form'],
    estimatedDuration: 5000,
    variables: [
      { name: 'url', type: 'string', required: true, description: 'Login page URL' },
      { name: 'usernameSelector', type: 'selector', required: false, default: '#username, #email, [name="email"], [type="email"]', description: 'Username/email field selector' },
      { name: 'passwordSelector', type: 'selector', required: false, default: '#password, [name="password"], [type="password"]', description: 'Password field selector' },
      { name: 'submitSelector', type: 'selector', required: false, default: '[type="submit"], button[type="submit"], #login-btn', description: 'Submit button selector' },
      { name: 'username', type: 'string', required: true, description: 'Username or email', sensitive: false },
      { name: 'password', type: 'string', required: true, description: 'Password', sensitive: true },
      { name: 'successIndicator', type: 'selector', required: false, default: '.dashboard, .home, #welcome', description: 'Element that indicates successful login' },
    ],
    steps: [
      { id: 'navigate', action: 'open', target: '\${url}', waitAfter: 1000 },
      { id: 'snapshot-login', action: 'snapshot', onError: 'continue' },
      { id: 'enter-username', action: 'fill', target: '\${usernameSelector}', value: '\${username}', onError: 'abort' },
      { id: 'enter-password', action: 'fill', target: '\${passwordSelector}', value: '\${password}', onError: 'abort' },
      { id: 'submit', action: 'click', target: '\${submitSelector}', waitAfter: 2000, onError: 'retry', maxRetries: 2 },
      { id: 'verify-success', action: 'wait', target: '\${successIndicator}', onError: 'abort' },
      { id: 'snapshot-dashboard', action: 'snapshot', optional: true },
    ],
  },
  {
    id: 'login-oauth',
    name: 'OAuth/SSO Login',
    description: 'Login via OAuth provider (Google, GitHub, etc.)',
    category: 'authentication',
    tags: ['login', 'oauth', 'sso', 'google', 'github'],
    estimatedDuration: 8000,
    variables: [
      { name: 'url', type: 'string', required: true, description: 'App login page URL' },
      { name: 'providerButton', type: 'selector', required: true, description: 'OAuth provider button selector (e.g., "Continue with Google")' },
      { name: 'email', type: 'string', required: true, description: 'OAuth account email' },
      { name: 'password', type: 'string', required: true, description: 'OAuth account password', sensitive: true },
      { name: 'successUrl', type: 'string', required: false, description: 'URL pattern after successful login' },
    ],
    steps: [
      { id: 'navigate', action: 'open', target: '\${url}', waitAfter: 1000 },
      { id: 'click-oauth', action: 'click', target: '\${providerButton}', waitAfter: 2000 },
      { id: 'enter-email', action: 'fill', target: '[type="email"], #identifierId', value: '\${email}' },
      { id: 'next-email', action: 'click', target: '#identifierNext, [type="submit"]', waitAfter: 1500 },
      { id: 'enter-password', action: 'fill', target: '[type="password"], [name="password"]', value: '\${password}' },
      { id: 'submit', action: 'click', target: '#passwordNext, [type="submit"]', waitAfter: 3000 },
      { id: 'wait-redirect', action: 'wait', target: '\${successUrl}', onError: 'continue' },
    ],
  },
  {
    id: 'logout',
    name: 'Logout',
    description: 'Standard logout flow',
    category: 'authentication',
    tags: ['logout', 'auth', 'session'],
    estimatedDuration: 3000,
    variables: [
      { name: 'menuSelector', type: 'selector', required: false, default: '.user-menu, #user-dropdown, .avatar', description: 'User menu selector (if needed)' },
      { name: 'logoutSelector', type: 'selector', required: true, description: 'Logout button/link selector' },
      { name: 'confirmSelector', type: 'selector', required: false, description: 'Confirmation button if needed' },
    ],
    steps: [
      { id: 'open-menu', action: 'click', target: '\${menuSelector}', optional: true, waitAfter: 500 },
      { id: 'click-logout', action: 'click', target: '\${logoutSelector}', waitAfter: 1000 },
      { id: 'confirm', action: 'click', target: '\${confirmSelector}', optional: true, waitAfter: 1000 },
      { id: 'verify', action: 'wait', target: '/login, /signin, .login-form', onError: 'continue' },
    ],
  },

  // ============ Data Extraction ============
  {
    id: 'scrape-table',
    name: 'Scrape Table Data',
    description: 'Extract data from HTML tables',
    category: 'data-extraction',
    tags: ['scrape', 'table', 'data', 'extract'],
    estimatedDuration: 3000,
    variables: [
      { name: 'url', type: 'string', required: true, description: 'Page URL containing the table' },
      { name: 'tableSelector', type: 'selector', required: false, default: 'table', description: 'Table selector' },
      { name: 'includeHeaders', type: 'boolean', required: false, default: true, description: 'Include table headers' },
    ],
    steps: [
      { id: 'navigate', action: 'open', target: '\${url}', waitAfter: 1000 },
      { id: 'wait-table', action: 'wait', target: '\${tableSelector}' },
      { id: 'extract-data', action: 'eval', value: `
        (() => {
          const table = document.querySelector('\${tableSelector}');
          if (!table) return { error: 'Table not found' };

          const rows = Array.from(table.querySelectorAll('tr'));
          const data = rows.map(row => {
            const cells = Array.from(row.querySelectorAll('td, th'));
            return cells.map(cell => cell.textContent.trim());
          });

          return { headers: data[0], rows: data.slice(1), totalRows: data.length - 1 };
        })()
      `},
    ],
  },
  {
    id: 'scrape-list',
    name: 'Scrape List Items',
    description: 'Extract items from lists or repeated elements',
    category: 'data-extraction',
    tags: ['scrape', 'list', 'data', 'extract'],
    estimatedDuration: 3000,
    variables: [
      { name: 'url', type: 'string', required: true, description: 'Page URL' },
      { name: 'itemSelector', type: 'selector', required: true, description: 'Selector for each item' },
      { name: 'fields', type: 'string', required: true, description: 'JSON object mapping field names to sub-selectors' },
    ],
    steps: [
      { id: 'navigate', action: 'open', target: '\${url}', waitAfter: 1000 },
      { id: 'wait-items', action: 'wait', target: '\${itemSelector}' },
      { id: 'extract-items', action: 'eval', value: `
        (() => {
          const items = document.querySelectorAll('\${itemSelector}');
          const fields = JSON.parse('\${fields}');

          return Array.from(items).map(item => {
            const result = {};
            for (const [name, selector] of Object.entries(fields)) {
              const el = item.querySelector(selector);
              result[name] = el ? el.textContent.trim() : null;
            }
            return result;
          });
        })()
      `},
    ],
  },

  // ============ Form Submission ============
  {
    id: 'contact-form',
    name: 'Contact Form Submission',
    description: 'Fill and submit a contact form',
    category: 'form-submission',
    tags: ['form', 'contact', 'submit'],
    estimatedDuration: 5000,
    variables: [
      { name: 'url', type: 'string', required: true, description: 'Contact page URL' },
      { name: 'name', type: 'string', required: true, description: 'Your name' },
      { name: 'email', type: 'string', required: true, description: 'Your email' },
      { name: 'message', type: 'string', required: true, description: 'Message content' },
      { name: 'submitSelector', type: 'selector', required: false, default: '[type="submit"], button[type="submit"]', description: 'Submit button' },
    ],
    steps: [
      { id: 'navigate', action: 'open', target: '\${url}', waitAfter: 1000 },
      { id: 'fill-name', action: 'fill', target: '#name, [name="name"], [placeholder*="name" i]', value: '\${name}' },
      { id: 'fill-email', action: 'fill', target: '#email, [name="email"], [type="email"]', value: '\${email}' },
      { id: 'fill-message', action: 'fill', target: '#message, [name="message"], textarea', value: '\${message}' },
      { id: 'submit', action: 'click', target: '\${submitSelector}', waitAfter: 2000 },
      { id: 'screenshot', action: 'screenshot', optional: true },
    ],
  },

  // ============ Testing ============
  {
    id: 'visual-regression',
    name: 'Visual Regression Test',
    description: 'Take screenshots for visual comparison',
    category: 'testing',
    tags: ['test', 'visual', 'screenshot', 'regression'],
    estimatedDuration: 5000,
    variables: [
      { name: 'urls', type: 'string', required: true, description: 'Comma-separated list of URLs to test' },
      { name: 'viewport', type: 'string', required: false, default: '1280x720', description: 'Viewport size (WxH)' },
    ],
    steps: [
      { id: 'set-viewport', action: 'eval', value: `
        (() => {
          const [w, h] = '\${viewport}'.split('x').map(Number);
          return { width: w, height: h };
        })()
      `},
      { id: 'test-urls', action: 'eval', value: `'\${urls}'.split(',').map(u => u.trim())` },
    ],
  },
  {
    id: 'smoke-test',
    name: 'Smoke Test',
    description: 'Basic smoke test to verify page loads correctly',
    category: 'testing',
    tags: ['test', 'smoke', 'health'],
    estimatedDuration: 3000,
    variables: [
      { name: 'url', type: 'string', required: true, description: 'URL to test' },
      { name: 'expectedTitle', type: 'string', required: false, description: 'Expected page title (partial match)' },
      { name: 'requiredElements', type: 'string', required: false, description: 'Comma-separated selectors that must exist' },
    ],
    steps: [
      { id: 'navigate', action: 'open', target: '\${url}', waitAfter: 1000, onError: 'abort' },
      { id: 'check-title', action: 'get', target: 'title', condition: '\${expectedTitle}' },
      { id: 'check-elements', action: 'eval', value: `
        (() => {
          const selectors = '\${requiredElements}'.split(',').map(s => s.trim()).filter(Boolean);
          const results = selectors.map(sel => ({
            selector: sel,
            found: document.querySelector(sel) !== null
          }));
          const allFound = results.every(r => r.found);
          return { results, allFound };
        })()
      `, optional: true },
      { id: 'screenshot', action: 'screenshot' },
    ],
  },

  // ============ Monitoring ============
  {
    id: 'uptime-check',
    name: 'Uptime Check',
    description: 'Check if a page is accessible and loads within timeout',
    category: 'monitoring',
    tags: ['monitor', 'uptime', 'health', 'availability'],
    estimatedDuration: 10000,
    variables: [
      { name: 'url', type: 'string', required: true, description: 'URL to check' },
      { name: 'timeout', type: 'number', required: false, default: 10000, description: 'Timeout in ms' },
      { name: 'expectedStatus', type: 'number', required: false, default: 200, description: 'Expected HTTP status' },
    ],
    steps: [
      { id: 'navigate', action: 'open', target: '\${url}', onError: 'abort' },
      { id: 'measure', action: 'eval', value: `
        (() => {
          const timing = performance.timing;
          return {
            dns: timing.domainLookupEnd - timing.domainLookupStart,
            connection: timing.connectEnd - timing.connectStart,
            ttfb: timing.responseStart - timing.requestStart,
            domLoad: timing.domContentLoadedEventEnd - timing.navigationStart,
            fullLoad: timing.loadEventEnd - timing.navigationStart
          };
        })()
      `},
      { id: 'screenshot', action: 'screenshot', optional: true },
    ],
  },
];

// ============================================================================
// Workflow Manager
// ============================================================================

export class WorkflowManager {
  private templates: Map<string, WorkflowTemplate> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();

  constructor() {
    // Load built-in templates
    for (const template of WORKFLOW_TEMPLATES) {
      this.templates.set(template.id, template);
    }
  }

  /**
   * Get all available templates
   */
  listTemplates(category?: WorkflowCategory): WorkflowTemplate[] {
    const templates = Array.from(this.templates.values());
    if (category) {
      return templates.filter((t) => t.category === category);
    }
    return templates;
  }

  /**
   * Get a specific template
   */
  getTemplate(id: string): WorkflowTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Register a custom template
   */
  registerTemplate(template: WorkflowTemplate): void {
    this.templates.set(template.id, template);
  }

  /**
   * Search templates by tags
   */
  searchTemplates(query: string): WorkflowTemplate[] {
    const terms = query.toLowerCase().split(/\s+/);
    return Array.from(this.templates.values()).filter((t) => {
      const searchText = `${t.name} ${t.description} ${t.tags.join(' ')}`.toLowerCase();
      return terms.every((term) => searchText.includes(term));
    });
  }

  /**
   * Validate variables for a template
   */
  validateVariables(
    templateId: string,
    variables: Record<string, unknown>
  ): { valid: boolean; errors: string[] } {
    const template = this.templates.get(templateId);
    if (!template) {
      return { valid: false, errors: [`Template '${templateId}' not found`] };
    }

    const errors: string[] = [];

    for (const varDef of template.variables) {
      const value = variables[varDef.name];

      if (varDef.required && (value === undefined || value === null || value === '')) {
        errors.push(`Required variable '${varDef.name}' is missing`);
        continue;
      }

      if (value !== undefined && value !== null) {
        switch (varDef.type) {
          case 'number':
            if (typeof value !== 'number' && isNaN(Number(value))) {
              errors.push(`Variable '${varDef.name}' must be a number`);
            }
            break;
          case 'boolean':
            if (typeof value !== 'boolean' && !['true', 'false'].includes(String(value))) {
              errors.push(`Variable '${varDef.name}' must be a boolean`);
            }
            break;
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Interpolate variables in step values
   */
  interpolateStep(step: WorkflowStep, variables: Record<string, unknown>): WorkflowStep {
    const interpolate = (value: string | undefined): string | undefined => {
      if (!value) return value;
      return value.replace(/\$\{(\w+)\}/g, (_, name) => {
        const val = variables[name];
        return val !== undefined ? String(val) : `\${${name}}`;
      });
    };

    return {
      ...step,
      target: interpolate(step.target),
      value: interpolate(step.value),
    };
  }

  /**
   * Get execution status
   */
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId);
  }
}

// ============================================================================
// Factory
// ============================================================================

let defaultManager: WorkflowManager | null = null;

export function getWorkflowManager(): WorkflowManager {
  if (!defaultManager) {
    defaultManager = new WorkflowManager();
  }
  return defaultManager;
}

export function listWorkflows(category?: WorkflowCategory): WorkflowTemplate[] {
  return getWorkflowManager().listTemplates(category);
}

export function getWorkflow(id: string): WorkflowTemplate | undefined {
  return getWorkflowManager().getTemplate(id);
}
