#!/usr/bin/env node

/**
 * Test script for Gemini-Flow MCP Wrapper
 * 
 * This script demonstrates how the wrapper transforms SPARC tool calls
 * into enhanced Gemini Code MCP requests.
 */

import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

class MCPWrapperTester {
  constructor() {
    this.client = null;
  }

  async connect() {
    console.log('🔌 Connecting to Gemini-Flow MCP Wrapper...');
    
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', 'src/mcp/gemini-cli-wrapper.ts'],
    });

    this.client = new Client({
      name: 'mcp-wrapper-tester',
      version: '1.0.0',
    }, {
      capabilities: {},
    });

    await this.client.connect(transport);
    console.log('✅ Connected successfully!\n');
  }

  async listTools() {
    console.log('📋 Listing available tools...');
    const tools = await this.client.listTools();
    
    console.log(`Found ${tools.tools.length} tools:\n`);
    
    // Group tools by category
    const sparcTools = tools.tools.filter(t => t.name.startsWith('sparc_'));
    const metaTools = ['sparc_list', 'sparc_swarm', 'sparc_swarm_status'];
    
    console.log('🎯 SPARC Mode Tools:');
    sparcTools
      .filter(t => !metaTools.includes(t.name))
      .forEach(tool => {
        console.log(`  - ${tool.name}: ${tool.description}`);
      });
    
    console.log('\n🔧 Meta Tools:');
    sparcTools
      .filter(t => metaTools.includes(t.name))
      .forEach(tool => {
        console.log(`  - ${tool.name}: ${tool.description}`);
      });
    
    console.log('');
  }

  async testSparcList() {
    console.log('🧪 Testing sparc_list tool...');
    
    try {
      const result = await this.client.callTool('sparc_list', { verbose: false });
      console.log('Result:', result.content[0].text);
    } catch (error) {
      console.error('Error:', error.message);
    }
    
    console.log('');
  }

  async testSparcMode(mode, task) {
    console.log(`🧪 Testing sparc_${mode} tool...`);
    console.log(`Task: "${task}"\n`);
    
    try {
      const result = await this.client.callTool(`sparc_${mode}`, {
        task: task,
        context: {
          memoryKey: `test_${mode}_${Date.now()}`,
          parallel: true,
        }
      });
      
      console.log('Result preview:');
      const text = result.content[0].text;
      console.log(text.substring(0, 500) + '...\n');
      
      // Show what would be sent to Gemini CLI
      console.log('📤 Enhanced prompt that would be sent to Gemini CLI:');
      console.log('Tool: Task');
      console.log(`Description: SPARC ${mode}`);
      console.log('Prompt includes:');
      console.log('  - SPARC mode description');
      console.log('  - Available tools list');
      console.log('  - Usage patterns');
      console.log('  - Best practices');
      console.log('  - SPARC methodology framework');
      console.log('  - Original task');
      console.log('  - Memory key and context\n');
      
    } catch (error) {
      console.error('Error:', error.message);
    }
    
    console.log('');
  }

  async testSwarm() {
    console.log('🧪 Testing sparc_swarm tool...');
    
    const swarmConfig = {
      objective: "Create a simple calculator application",
      strategy: "development",
      mode: "distributed",
      maxAgents: 3
    };
    
    console.log('Swarm configuration:', JSON.stringify(swarmConfig, null, 2));
    
    try {
      const result = await this.client.callTool('sparc_swarm', swarmConfig);
      console.log('\nResult:', JSON.stringify(JSON.parse(result.content[0].text), null, 2));
    } catch (error) {
      console.error('Error:', error.message);
    }
    
    console.log('');
  }

  async demonstratePromptInjection() {
    console.log('📝 Demonstrating Prompt Injection\n');
    console.log('Original request:');
    console.log('```json');
    console.log(JSON.stringify({
      tool: "sparc_coder",
      params: {
        task: "Create a REST API endpoint for user registration"
      }
    }, null, 2));
    console.log('```\n');
    
    console.log('Enhanced prompt structure:');
    console.log('```');
    console.log('SPARC: coder');
    console.log('');
    console.log('## Mode Description');
    console.log('Autonomous code generation and implementation');
    console.log('');
    console.log('## Available Tools');
    console.log('- **Read**: Read file contents');
    console.log('- **Write**: Write files');
    console.log('- **Edit**: Edit existing files');
    console.log('- **MultiEdit**: Make multiple edits to a file');
    console.log('- **Bash**: Execute system commands');
    console.log('- **TodoWrite**: Create and manage task coordination');
    console.log('');
    console.log('## Usage Pattern');
    console.log('[Code examples for using the tools]');
    console.log('');
    console.log('## Best Practices');
    console.log('- Follow existing code patterns and conventions');
    console.log('- Write comprehensive tests for new code');
    console.log('- Use batch file operations for efficiency');
    console.log('- Implement proper error handling');
    console.log('- Add meaningful comments and documentation');
    console.log('');
    console.log('## TASK: Create a REST API endpoint for user registration');
    console.log('');
    console.log('# 🎯 SPARC METHODOLOGY EXECUTION FRAMEWORK');
    console.log('[Full SPARC workflow with 5 steps]');
    console.log('```\n');
  }

  async runAllTests() {
    try {
      await this.connect();
      await this.listTools();
      await this.testSparcList();
      await this.demonstratePromptInjection();
      await this.testSparcMode('coder', 'Create a function to calculate fibonacci numbers');
      await this.testSparcMode('researcher', 'Research best practices for REST API design');
      await this.testSwarm();
      
      console.log('✅ All tests completed!');
      
    } catch (error) {
      console.error('❌ Test failed:', error);
    } finally {
      if (this.client) {
        await this.client.close();
      }
      process.exit(0);
    }
  }
}

// Run tests
const tester = new MCPWrapperTester();
tester.runAllTests().catch(console.error);