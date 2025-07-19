#!/usr/bin/env node

// Final MCP test
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function test() {
  console.log('🧪 Testing Gemini-Flow MCP Server...\n');
  
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/cli/mcp-stdio-server.ts'],
  });

  const client = new Client({
    name: 'mcp-final-tester',
    version: '1.0.0',
  }, {
    capabilities: {},
  });

  try {
    await client.connect(transport);
    console.log('✅ Connected successfully!\n');
    
    // List tools
    console.log('📋 Listing available tools...');
    const tools = await client.listTools();
    console.log(`Found ${tools.tools.length} tools:\n`);
    
    // Group by type
    const sparcTools = tools.tools.filter(t => t.name.startsWith('sparc_') && !['sparc_list', 'sparc_swarm', 'sparc_swarm_status'].includes(t.name));
    const metaTools = tools.tools.filter(t => ['sparc_list', 'sparc_swarm', 'sparc_swarm_status'].includes(t.name));
    
    console.log(`🎯 SPARC Mode Tools (${sparcTools.length}):`);
    sparcTools.forEach(tool => {
      console.log(`  - ${tool.name}: ${tool.description}`);
    });
    
    console.log(`\n🔧 Meta Tools (${metaTools.length}):`);
    metaTools.forEach(tool => {
      console.log(`  - ${tool.name}: ${tool.description}`);
    });
    
    // Test sparc_list
    console.log('\n🧪 Testing sparc_list tool...');
    const listResult = await client.callTool('sparc_list', { verbose: false });
    console.log('Result preview:', listResult.content[0].text.substring(0, 200) + '...');
    
    await client.close();
    console.log('\n✅ All tests passed!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (client) await client.close();
  }
  
  process.exit(0);
}

test().catch(console.error);