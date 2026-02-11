/**
 * Browser Skill Exports
 * Re-exports skill-related functionality for Claude Code integration
 */

export { browserTools } from '../mcp-tools/browser-tools.js';
export { BrowserService, createBrowserService } from '../application/browser-service.js';
export { preBrowseHook, postBrowseHook, browserHooks } from '../infrastructure/hooks-integration.js';

// Skill metadata
export const SKILL_METADATA = {
  name: 'browser',
  description: 'Web browser automation with AI-optimized snapshots for claude-flow agents',
  version: '1.0.0',
  triggers: ['/browser', 'browse', 'web automation', 'scrape', 'navigate', 'screenshot'],
  tools: [
    'browser/open',
    'browser/snapshot',
    'browser/click',
    'browser/fill',
    'browser/screenshot',
    'browser/close',
  ],
};
