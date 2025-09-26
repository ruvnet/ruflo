#!/usr/bin/env node
import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ClaudeCodeMCPWrapper } from './claude-code-wrapper.js';
export class MCPIntegration {
    claudeCodeClient;
    wrapper;
    constructor(){
        this.wrapper = new ClaudeCodeMCPWrapper();
    }
    async connectToClaudeCode() {
        try {
            const claudeCodeProcess = spawn('npx', [
                '-y',
                '@anthropic/claude-code',
                'mcp'
            ], {
                stdio: [
                    'pipe',
                    'pipe',
                    'pipe'
                ]
            });
            const transport = new StdioClientTransport({
                command: 'npx',
                args: [
                    '-y',
                    '@anthropic/claude-code',
                    'mcp'
                ]
            });
            this.claudeCodeClient = new Client({
                name: 'claude-flow-wrapper-client',
                version: '1.0.0'
            }, {
                capabilities: {}
            });
            await this.claudeCodeClient.connect(transport);
            this.wrapper.claudeCodeMCP = this.claudeCodeClient;
            console.log('Connected to Claude Code MCP server');
        } catch (error) {
            console.error('Failed to connect to Claude Code MCP:', error);
            throw error;
        }
    }
    async start() {
        await this.connectToClaudeCode();
        await this.wrapper.run();
    }
}
export function injectClaudeCodeClient(wrapper, client) {
    wrapper.forwardToClaudeCode = async function(toolName, args) {
        try {
            const result = await client.callTool(toolName, args);
            return result;
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error calling Claude Code tool ${toolName}: ${error instanceof Error ? error.message : String(error)}`
                    }
                ],
                isError: true
            };
        }
    };
}
if (import.meta.url === `file://${process.argv[1]}`) {
    const integration = new MCPIntegration();
    integration.start().catch(console.error);
}

//# sourceMappingURL=integrate-wrapper.js.map