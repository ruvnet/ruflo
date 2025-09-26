async function executeStreamStep(prompt, inputStream, isLast, flags = {}) {
    return new Promise((resolve)=>{
        const startTime = Date.now();
        let resolved = false;
        const safeResolve = (result)=>{
            if (!resolved) {
                resolved = true;
                resolve(result);
            }
        };
        const useMock = flags.mock || !checkClaudeAvailable();
        if (useMock) {
            return mockStreamStep(prompt, inputStream, isLast, flags, safeResolve, startTime);
        }
        const stepTimeout = flags.timeout ? parseInt(flags.timeout) * 1000 : 15000;
        const args = [
            '-p'
        ];
        if (!isLast || flags.json) {
            args.push('--output-format', 'stream-json');
            args.push('--verbose');
        }
        args.push(prompt);
        if (flags.verbose) {
            console.log(`   Debug: Executing: claude ${args.join(' ')}`);
        }
        const command = `claude ${args.join(' ')}`;
        exec(command, {
            timeout: stepTimeout,
            maxBuffer: 1024 * 1024 * 10
        }, (error, stdout, stderr)=>{
            if (resolved) {
                return;
            }
            const duration = Date.now() - startTime;
            if (error && error.code === 'TIMEOUT') {
                console.log('⚠️  Claude CLI timed out, falling back to mock mode...');
                mockStreamStep(prompt, inputStream, isLast, {
                    ...flags,
                    mock: true
                }, safeResolve, Date.now());
                return;
            }
            if (flags.verbose && stderr) {
                console.error('Error output:', stderr);
            }
            safeResolve({
                success: !error || error.code === 0,
                duration,
                output: stdout || '',
                stream: !isLast && stdout ? stdout : null,
                error: stderr || (error ? error.message : null)
            });
        });
    });
}

//# sourceMappingURL=stream-chain-fixed.js.map