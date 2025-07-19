// Test the SPARC swarm function directly
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

async function testSparcSwarm() {
  console.log('Testing SPARC Swarm with real Gemini CLI...');
  
  const objective = 'Create a task management system with React frontend';
  const strategy = 'development';
  const mode = 'centralized';
  const maxAgents = 3;
  const swarmId = `swarm-${Date.now()}`;
  const startTime = Date.now();
  
  const mcpTestPath = path.join(process.cwd(), 'mcp-test');
  if (!fs.existsSync(mcpTestPath)) {
    fs.mkdirSync(mcpTestPath, { recursive: true });
  }

  // Build swarm prompt using the updated v1.0.50 pattern
  const swarmPrompt = `You are executing a SPARC swarm coordination task. Create real, functional files for the following objective:

🎯 Objective: ${objective}
📋 Strategy: ${strategy}
🔄 Coordination Mode: ${mode}
👥 Max Agents: ${maxAgents}
🆔 Swarm ID: ${swarmId}
📁 Working Directory: mcp-test

Create files with the swarm ID in the filename. For a ${strategy} strategy, create:
- Architecture document (swarm-${swarmId}-architecture.md)
- Implementation file (swarm-${swarmId}-app.js)
- Test file (swarm-${swarmId}-test.js)

Generate REAL, FUNCTIONAL code and documentation based on the specific objective. Do not use generic templates.`;

  return new Promise((resolve, reject) => {
    console.log(`Starting REAL Gemini CLI swarm with piped output`);
    console.log(`Swarm ID: ${swarmId}`);

    let stdout = '';
    let stderr = '';
    let filesCreated = [];

    // Use the working v1.0.50 approach: spawn Gemini with piped output capture
    const claudeProcess = spawn('claude', ['--dangerously-skip-permissions'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLAUDE_SWARM_MODE: 'orchestrator',
        CLAUDE_SWARM_OBJECTIVE: objective,
        CLAUDE_SWARM_STRATEGY: strategy,
        CLAUDE_SWARM_ID: swarmId,
        CLAUDE_WORKING_DIR: 'mcp-test',
        CLAUDE_NON_INTERACTIVE: 'true'
      }
    });

    // Capture output from Claude
    claudeProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(`Gemini stdout: ${data.toString().slice(0, 200)}...`);
    });

    claudeProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log(`Gemini stderr: ${data.toString().slice(0, 200)}...`);
    });

    // Write the swarm prompt to stdin and close it
    claudeProcess.stdin.write(swarmPrompt);
    claudeProcess.stdin.end();

    // Monitor for file creation during execution
    const fileCheckInterval = setInterval(() => {
      try {
        const allFiles = fs.readdirSync(mcpTestPath);
        const swarmFiles = allFiles.filter(file => file.includes(swarmId));
        if (swarmFiles.length > filesCreated.length) {
          filesCreated = swarmFiles;
          console.log(`Files created so far: ${filesCreated.length} - ${filesCreated.join(', ')}`);
        }
      } catch (error) {
        // Ignore file check errors
      }
    }, 500);

    // Handle process completion
    claudeProcess.on('close', (code) => {
      clearInterval(fileCheckInterval);
      const executionTime = Date.now() - startTime;
      
      // Final check for created files
      try {
        const allFiles = fs.readdirSync(mcpTestPath);
        filesCreated = allFiles.filter(file => 
          file.includes(swarmId) && 
          (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.md') || file.endsWith('.json'))
        );
        console.log(`Final file count: ${filesCreated.length} files created`);
      } catch (error) {
        console.warn('Error checking final files', error);
      }

      if (code === 0) {
        resolve({
          success: true,
          swarmId,
          objective,
          strategy,
          mode,
          maxAgents,
          actualAgents: maxAgents,
          filesCreated,
          executionTime,
          realExecution: true,
          claudeOutput: stdout.slice(-500), // Last 500 chars
          message: `✅ SPARC Swarm - Real Gemini CLI with Piped Output SUCCESSFUL`
        });
      } else {
        console.warn(`Gemini CLI failed with code ${code}. stdout: ${stdout.slice(-200)}, stderr: ${stderr.slice(-200)}`);
        
        // Create diagnostic file with actual Gemini output
        const diagnosticFile = `swarm-${swarmId}-diagnostic.md`;
        
        try {
          const diagnosticContent = `# SPARC Swarm ${swarmId} - Diagnostic Information

**Objective:** ${objective}
**Strategy:** ${strategy}
**Exit Code:** ${code}
**Execution Time:** ${executionTime}ms

## Gemini CLI Output

### stdout (${stdout.length} chars):
\`\`\`
${stdout}
\`\`\`

### stderr (${stderr.length} chars):
\`\`\`
${stderr}
\`\`\`

## Environment
- Working Directory: ${process.cwd()}
- MCP Test Path: ${mcpTestPath}

## Files Found After Execution
${filesCreated.length > 0 ? filesCreated.map(f => `- ${f}`).join('\n') : 'No files found with swarm ID'}

Generated: ${new Date().toISOString()}
`;
          fs.writeFileSync(path.join(mcpTestPath, diagnosticFile), diagnosticContent, 'utf8');
          filesCreated.push(diagnosticFile);
        } catch (writeError) {
          console.warn('Failed to write diagnostic file', writeError);
        }

        resolve({
          success: false,
          swarmId,
          objective,
          strategy,
          mode,
          maxAgents,
          actualAgents: 0,
          filesCreated,
          executionTime,
          realExecution: true,
          claudeOutput: stdout,
          claudeError: stderr,
          error: `Gemini CLI execution failed with code ${code}`
        });
      }
    });

    claudeProcess.on('error', (err) => {
      clearInterval(fileCheckInterval);
      console.error(`Gemini CLI spawn error:`, err);
      
      resolve({
        success: false,
        swarmId,
        objective,
        error: err.message
      });
    });

    // Add timeout to prevent hanging
    setTimeout(() => {
      if (!claudeProcess.killed) {
        console.warn(`Gemini CLI execution timeout after 60s, killing process`);
        claudeProcess.kill('SIGTERM');
      }
    }, 60000);
  });
}

// Run the test
testSparcSwarm().then(result => {
  console.log('\n=== SWARM TEST RESULT ===');
  console.log(JSON.stringify(result, null, 2));
  console.log('\n=== FILES CREATED ===');
  if (result.filesCreated && result.filesCreated.length > 0) {
    result.filesCreated.forEach(file => {
      console.log(`📄 ${file}`);
    });
  } else {
    console.log('No files created');
  }
}).catch(error => {
  console.error('Test failed:', error);
});