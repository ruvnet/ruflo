#!/usr/bin/env node

/**
 * Simple startup script for Claude Code Web UI
 * Usage: node start-web-ui.js [port]
 */

import { startWebServer } from './src/cli/simple-commands/web-server.js';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

// Try to read port from config file first
let defaultPort = 3000;
try {
  const configFile = 'claude-flow.config.json';
  if (existsSync(configFile)) {
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    // Check both server.port and mcp.port for compatibility
    defaultPort = config?.server?.port || config?.mcp?.port || 3000;
    console.log(`📋 Using port ${defaultPort} from config file`);
  }
} catch (err) {
  // Ignore config read errors, use default
}

const port = process.argv[2] ? parseInt(process.argv[2]) : defaultPort;

console.log('🚀 Starting Claude Code Web UI...');
console.log();

await startWebServer(port);