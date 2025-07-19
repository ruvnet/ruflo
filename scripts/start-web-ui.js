#!/usr/bin/env node

/**
 * Simple startup script for Gemini Code Web UI
 * Usage: node start-web-ui.js [port]
 */

import { startWebServer } from './src/cli/simple-commands/web-server.js';

const port = process.argv[2] ? parseInt(process.argv[2]) : 3000;

console.log('🚀 Starting Gemini Code Web UI...');
console.log();

await startWebServer(port);