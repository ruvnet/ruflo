#!/usr/bin/env node
import { getErrorMessage } from '../utils/error-handler.js';
/**
 * Gemini-Flow MCP Server - Wrapper Mode
 * 
 * This version uses the Gemini Code MCP wrapper approach instead of templates.
 */

import { GeminiCliMCPWrapper } from './gemini-cli-wrapper.js';

// Check if running as wrapper mode
const isWrapperMode = process.env.CLAUDE_FLOW_WRAPPER_MODE === 'true' || 
                      process.argv.includes('--wrapper');

async function main() {
  if (isWrapperMode) {
    console.error('Starting Gemini-Flow MCP in wrapper mode...');
    const wrapper = new GeminiCliMCPWrapper();
    await wrapper.run();
  } else {
    // Fall back to original server
    console.error('Starting Gemini-Flow MCP in direct mode...');
    const { runMCPServer } = await import('./server.js');
    await runMCPServer();
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});