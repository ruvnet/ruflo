#!/usr/bin/env node
/**
 * Test MCP Server - Standalone Test Script
 * Tests the refactored MCP server implementation
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const mcpServerPath = join(__dirname, 'src', 'mcp', 'server.ts');

console.log('🧪 Testing Claude Flow MCP Server');
console.log('📂 Server path:', mcpServerPath);
console.log('🚀 Starting MCP server with tsx...\n');

// Start the MCP server with tsx
const serverProcess = spawn('npx', ['tsx', mcpServerPath], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    CLAUDE_FLOW_LOG_LEVEL: 'debug',
    CLAUDE_FLOW_DEBUG: 'true',
    CLAUDE_FLOW_AUTO_ORCHESTRATOR: 'false',
    CLAUDE_FLOW_NEURAL_ENABLED: 'true',
    CLAUDE_FLOW_WASM_ENABLED: 'true',
  },
});

serverProcess.on('error', (error) => {
  console.error('❌ Failed to start MCP server:', error.message);
  process.exit(1);
});

serverProcess.on('exit', (code) => {
  if (code !== 0) {
    console.error(`\n❌ MCP server exited with code ${code}`);
  } else {
    console.log('\n✅ MCP server stopped gracefully');
  }
  process.exit(code || 0);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping MCP server...');
  serverProcess.kill('SIGTERM');
});

process.on('SIGTERM', () => {
  serverProcess.kill('SIGTERM');
});