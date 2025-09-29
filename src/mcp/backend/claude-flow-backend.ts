import { MCPServer } from '../server.js';
import { createClaudeFlowTools, ClaudeFlowToolContext } from '../claude-flow-tools.js';
import { logger } from '../../core/logger.js';
import { EventBus } from '../../core/event-bus.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Make port and host configurable for tests and multi-instance dev
const config = {
  transport: 'http' as const,
  host: (process.env.HOST && process.env.HOST.trim()) ? process.env.HOST : 'localhost',
  port: (() => {
    const raw = process.env.PORT?.trim();
    const n = raw ? Number(raw) : 3001;
    return Number.isFinite(n) && n > 0 && n <= 65535 ? n : 3001;
  })(),
  tlsEnabled: false,
};

async function startClaudeFlowBackend() {
  const eventBus = EventBus.getInstance(); // Use getInstance() since constructor is private
  const server = new MCPServer(config, eventBus, logger);

  // Register claude-flow tools
  const tools = await createClaudeFlowTools(logger);
  for (const tool of tools) {
    const originalHandler = tool.handler;
    tool.handler = async (input: unknown, context?: ClaudeFlowToolContext) => {
      // For the backend server, we don't have orchestrator, so use a basic context
      const backendContext: ClaudeFlowToolContext = {
        ...(context ?? {}), // Fixed: Handle undefined context
        // Add any backend-specific context if needed
      } as ClaudeFlowToolContext;
      return await originalHandler(input, backendContext);
    };
    server.registerTool(tool);
  }

  await server.start();
  logger.info('Claude-Flow backend MCP server started', { 
    port: config.port,
    host: config.host,
    transport: config.transport 
  });
  return server;
}

// Export for use in main app or separate process
export { startClaudeFlowBackend };

// CLI bootstrap - allows running this file directly
// Check if this module is being run directly
const currentModulePath = fileURLToPath(import.meta.url);
const mainModulePath = resolve(process.argv[1] ?? '');

if (currentModulePath === mainModulePath) {
  console.log('Starting Claude-Flow backend MCP server...');
  startClaudeFlowBackend().catch((err) => {
    console.error('Failed to start Claude-Flow backend:', err);
    process.exit(1);
  });
}
