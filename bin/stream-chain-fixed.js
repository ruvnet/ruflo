/**
 * Execute a single step in the stream chain
 */
async function executeStreamStep(prompt, inputStream, isLast, flags = {}) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let resolved = false; // Prevent double resolution
    
    const safeResolve = (result) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };
    
    // Check if we should use mock mode
    const useMock = flags.mock || !checkClaudeAvailable();
    
    if (useMock) {
      // Mock implementation when claude CLI isn't available or mock flag is set
      return mockStreamStep(prompt, inputStream, isLast, flags, safeResolve, startTime);
    }
    
    // Set a reasonable timeout for real Claude CLI (15 seconds - more realistic)
    const stepTimeout = flags.timeout ? parseInt(flags.timeout) * 1000 : 15000;
    
    // Build command arguments
    const args = ['-p'];
    
    // For now, avoid stream-json input chaining due to format complexity
    // Each step runs independently for better reliability
    if (!isLast || flags.json) {
      args.push('--output-format', 'stream-json');
      // stream-json output requires --verbose
      args.push('--verbose');
    }
    
    // Add the prompt
    args.push(prompt);

    if (flags.verbose) {
      console.log(`   Debug: Executing: claude ${args.join(' ')}`);
    }

    // Use exec with built-in timeout for better reliability
    const command = `claude ${args.join(' ')}`;
    
    exec(command, { 
      timeout: stepTimeout,
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    }, (error, stdout, stderr) => {
      if (resolved) {
        return; // Already resolved
      }
      
      const duration = Date.now() - startTime;
      
      if (error && error.code === 'TIMEOUT') {
        // Handle timeout via exec
        console.log('⚠️  Claude CLI timed out, falling back to mock mode...');
        mockStreamStep(prompt, inputStream, isLast, { ...flags, mock: true }, safeResolve, Date.now());
        return;
      }
      
      if (flags.verbose && stderr) {
        console.error('Error output:', stderr);
      }
      
      safeResolve({
        success: !error || error.code === 0,
        duration,
        output: stdout || '',
        stream: (!isLast && stdout) ? stdout : null,
        error: stderr || (error ? error.message : null)
      });
    });
  });
}