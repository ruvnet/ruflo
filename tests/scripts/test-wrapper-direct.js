#!/usr/bin/env node

// Direct test of the MCP wrapper
console.log('🧪 Testing MCP Wrapper directly...\n');

import { spawn } from 'child_process';

// Start the wrapper directly
const wrapper = spawn('npx', ['tsx', 'src/mcp/gemini-cli-wrapper.ts'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Capture startup messages
let output = '';
wrapper.stderr.on('data', (data) => {
  output += data.toString();
});

wrapper.stdout.on('data', (data) => {
  output += data.toString();
});

// Give it time to start
setTimeout(() => {
  console.log('📋 Wrapper output:');
  console.log('================');
  console.log(output);
  console.log('================\n');
  
  // Check for expected messages
  if (output.includes('Gemini-Flow MCP Server (Wrapper Mode)')) {
    console.log('✅ Wrapper mode confirmed');
  } else {
    console.log('❌ Wrapper mode not detected');
  }
  
  if (output.includes('Using Gemini CLI MCP pass-through')) {
    console.log('✅ Gemini CLI pass-through confirmed');
  } else {
    console.log('❌ Gemini CLI pass-through not detected');
  }
  
  if (output.includes('SPARC prompt injection')) {
    console.log('✅ SPARC prompt injection confirmed');
  } else {
    console.log('❌ SPARC prompt injection not detected');
  }
  
  // Kill the process
  wrapper.kill();
  process.exit(0);
}, 2000);