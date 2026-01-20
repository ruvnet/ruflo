/**
 * Browser Agent Exports
 * Re-exports agent-related functionality for swarm integration
 */

export { BrowserSwarmCoordinator, createBrowserSwarm } from '../application/browser-service.js';
export { ReasoningBankAdapter, getReasoningBank } from '../infrastructure/reasoningbank-adapter.js';
export type { BrowserPattern, PatternStep } from '../infrastructure/reasoningbank-adapter.js';

// Agent metadata
export const AGENT_METADATA = {
  name: 'browser-agent',
  description: 'Web automation specialist using agent-browser with AI-optimized snapshots',
  version: '1.0.0',
  routing: {
    complexity: 'medium',
    model: 'sonnet',
    priority: 'normal',
    keywords: ['browser', 'web', 'scrape', 'screenshot', 'navigate', 'login', 'form', 'click', 'automate'],
  },
  capabilities: [
    'web-navigation',
    'form-interaction',
    'screenshot-capture',
    'data-extraction',
    'network-interception',
    'session-management',
    'multi-tab-coordination',
  ],
  swarm: {
    roles: ['navigator', 'scraper', 'validator', 'tester', 'monitor'],
    topology: 'hierarchical',
    maxSessions: 5,
  },
};
