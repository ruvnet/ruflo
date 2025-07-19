// Test simple swarm execution
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const swarmId = `swarm-${Date.now()}`;
const simplePrompt = `Create a calculator module with add and subtract functions. Save it as swarm-${swarmId}-simple-calc.js in the mcp-test directory.`;

console.log('Testing simple swarm with prompt:', simplePrompt);

const claudeProcess = spawn('claude', ['--dangerously-skip-permissions'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: false,
  cwd: process.cwd()
});

let stdout = '';
let stderr = '';

claudeProcess.stdout.on('data', (data) => {
  stdout += data.toString();
  console.log('Gemini output:', data.toString());
});

claudeProcess.stderr.on('data', (data) => {
  stderr += data.toString();
  console.log('Gemini error:', data.toString());
});

claudeProcess.stdin.write(simplePrompt);
claudeProcess.stdin.end();

claudeProcess.on('close', (code) => {
  console.log(`Process exited with code: ${code}`);
  console.log(`stdout: ${stdout}`);
  console.log(`stderr: ${stderr}`);
  
  // Check for files
  try {
    const files = fs.readdirSync('mcp-test');
    const swarmFiles = files.filter(f => f.includes(swarmId));
    console.log('Created files:', swarmFiles);
  } catch (err) {
    console.log('Error reading files:', err.message);
  }
});

claudeProcess.on('error', (err) => {
  console.log('Process error:', err.message);
});

setTimeout(() => {
  if (!claudeProcess.killed) {
    console.log('Timeout - killing process');
    claudeProcess.kill('SIGTERM');
  }
}, 15000);