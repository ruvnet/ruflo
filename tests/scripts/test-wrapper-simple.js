#!/usr/bin/env node

// Simple test for MCP wrapper without timeouts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function test() {
  console.log('🧪 Testing MCP Wrapper (Simple)...\n');
  
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/mcp/gemini-cli-wrapper.ts'],
  });

  const client = new Client({
    name: 'simple-tester',
    version: '1.0.0',
  }, {
    capabilities: {},
  });

  try {
    await client.connect(transport);
    console.log('✅ Connected successfully!\n');
    
    // Just list tools
    console.log('📋 Listing tools...');
    const tools = await client.listTools();
    console.log(`Found ${tools.tools.length} tools\n`);
    
    // Try sparc_list without waiting for result
    console.log('🧪 Testing sparc_list (no wait)...');
    client.callTool('sparc_list', { verbose: false }).catch(err => {
      console.log('sparc_list error (expected):', err.message);
    });
    
    // Give it a moment
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await client.close();
    console.log('\n✅ Test completed!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  process.exit(0);
}

test().catch(console.error);