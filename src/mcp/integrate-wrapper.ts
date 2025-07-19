#!/usr/bin/env node
import { getErrorMessage } from '../utils/error-handler.js';
import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { GeminiCliMCPWrapper } from './gemini-cli-wrapper.js';

/**
 * Integration script that connects the Gemini-Flow MCP wrapper
 * to the Gemini CLI MCP server
 */
export class MCPIntegration {
  private geminiCliClient?: Client;
  private wrapper: GeminiCliMCPWrapper;

  constructor() {
    this.wrapper = new GeminiCliMCPWrapper();
  }

  async connectToGeminiCli(): Promise<void> {
    try {
      // Start Gemini CLI MCP server process
      const geminiCliProcess = spawn('gemini', [
        'mcp'
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const transport = new StdioClientTransport({
        command: 'gemini',
        args: ['mcp'],
      });

      this.geminiCliClient = new Client({
        name: 'gemini-flow-wrapper-client',
        version: '1.0.0',
      }, {
        capabilities: {},
      });

      await this.geminiCliClient.connect(transport);

      // Inject the client into the wrapper
      (this.wrapper as any).geminiCliMcp = this.geminiCliClient;

      console.log('Connected to Gemini CLI MCP server');
    } catch (error) {
      console.error('Failed to connect to Gemini CLI MCP:', error);
      throw error;
    }
  }

  async start(): Promise<void> {
    // Connect to Gemini CLI MCP
    await this.connectToGeminiCli();

    // Start the wrapper server
    await this.wrapper.run();
  }
}

// Update the wrapper to use the real Gemini CLI MCP client
export function injectGeminiCliClient(wrapper: GeminiCliMCPWrapper, client: Client): void {
  // Override the forwardToGeminiCli method
  (wrapper as any).forwardToGeminiCli = async function(toolName: string, args: any) {
    try {
      const result = await client.callTool(toolName, args);
      return result;
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error calling Gemini CLI tool ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  };
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const integration = new MCPIntegration();
  integration.start().catch(console.error);
}