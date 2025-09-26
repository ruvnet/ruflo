import { spawn } from 'child_process';
import { createInterface } from 'readline';
export class RuvSwarmWrapper {
    constructor(options = {}){
        this.options = {
            silent: options.silent || false,
            autoRestart: options.autoRestart !== false,
            maxRestarts: options.maxRestarts || 3,
            restartDelay: options.restartDelay || 1000,
            ...options
        };
        this.process = null;
        this.restartCount = 0;
        this.isShuttingDown = false;
    }
    async start() {
        if (this.process) {
            throw new Error('RuvSwarm MCP server is already running');
        }
        return new Promise((resolve, reject)=>{
            try {
                this.process = spawn('npx', [
                    'ruv-swarm',
                    'mcp',
                    'start'
                ], {
                    stdio: [
                        'pipe',
                        'pipe',
                        'pipe'
                    ],
                    env: {
                        ...process.env,
                        MCP_MODE: 'stdio',
                        LOG_LEVEL: 'WARN'
                    }
                });
                let initialized = false;
                let initTimeout;
                const rlOut = createInterface({
                    input: this.process.stdout,
                    crlfDelay: Infinity
                });
                rlOut.on('line', (line)=>{
                    try {
                        const message = JSON.parse(line);
                        if (message.method === 'server.initialized' && !initialized) {
                            initialized = true;
                            clearTimeout(initTimeout);
                            resolve({
                                process: this.process,
                                stdout: this.process.stdout,
                                stdin: this.process.stdin
                            });
                        }
                        process.stdout.write(line + '\n');
                    } catch (err) {}
                });
                const rlErr = createInterface({
                    input: this.process.stderr,
                    crlfDelay: Infinity
                });
                rlErr.on('line', (line)=>{
                    try {
                        const errorData = JSON.parse(line);
                        if (errorData.error && errorData.error.code) {
                            switch(errorData.error.code){
                                case 'LOGGER_METHOD_MISSING':
                                case 'ERR_LOGGER_MEMORY_USAGE':
                                    if (!this.options.silent) {
                                        console.error('⚠️  Known ruv-swarm logger issue detected (continuing normally)');
                                    }
                                    return;
                                case 'ERR_INITIALIZATION':
                                    console.error('❌ RuvSwarm initialization error:', errorData.error.message);
                                    return;
                                default:
                                    if (!this.options.silent) {
                                        console.error(`RuvSwarm error [${errorData.error.code}]:`, errorData.error.message);
                                    }
                            }
                            return;
                        }
                    } catch (e) {
                        const knownErrorPatterns = [
                            {
                                pattern: /logger\.logMemoryUsage is not a function/,
                                code: 'LOGGER_METHOD_MISSING',
                                message: 'Known ruv-swarm logger issue detected (continuing normally)'
                            },
                            {
                                pattern: /Cannot find module/,
                                code: 'MODULE_NOT_FOUND',
                                message: 'Module not found error'
                            },
                            {
                                pattern: /ECONNREFUSED/,
                                code: 'CONNECTION_REFUSED',
                                message: 'Connection refused error'
                            }
                        ];
                        for (const errorPattern of knownErrorPatterns){
                            if (errorPattern.pattern.test(line)) {
                                if (!this.options.silent || errorPattern.code !== 'LOGGER_METHOD_MISSING') {
                                    console.error(`⚠️  ${errorPattern.message}`);
                                }
                                return;
                            }
                        }
                    }
                    if (this.options.silent) {
                        if (line.includes('✅') || line.includes('🧠') || line.includes('📊')) {
                            return;
                        }
                    }
                    if (!this.options.silent) {
                        process.stderr.write(line + '\n');
                    }
                });
                this.process.on('error', (error)=>{
                    if (!initialized) {
                        clearTimeout(initTimeout);
                        reject(new Error(`Failed to start ruv-swarm: ${error.message}`));
                    } else {
                        console.error('RuvSwarm process error:', error);
                        this.handleProcessExit(error.code || 1);
                    }
                });
                this.process.on('exit', (code, signal)=>{
                    if (!initialized) {
                        clearTimeout(initTimeout);
                        reject(new Error(`RuvSwarm exited before initialization: code ${code}, signal ${signal}`));
                    } else {
                        this.handleProcessExit(code || 0);
                    }
                });
                initTimeout = setTimeout(()=>{
                    if (!initialized) {
                        this.stop();
                        reject(new Error('RuvSwarm initialization timeout'));
                    }
                }, 30000);
            } catch (error) {
                reject(error);
            }
        });
    }
    handleProcessExit(code) {
        this.process = null;
        if (this.isShuttingDown) {
            return;
        }
        console.error(`RuvSwarm MCP server exited with code ${code}`);
        if (this.options.autoRestart && this.restartCount < this.options.maxRestarts) {
            this.restartCount++;
            console.log(`Attempting to restart RuvSwarm (attempt ${this.restartCount}/${this.options.maxRestarts})...`);
            setTimeout(()=>{
                this.start().catch((err)=>{
                    console.error('Failed to restart RuvSwarm:', err);
                });
            }, this.options.restartDelay);
        }
    }
    async stop() {
        this.isShuttingDown = true;
        if (!this.process) {
            return;
        }
        return new Promise((resolve)=>{
            const killTimeout = setTimeout(()=>{
                console.warn('RuvSwarm did not exit gracefully, forcing kill...');
                this.process.kill('SIGKILL');
            }, 5000);
            this.process.on('exit', ()=>{
                clearTimeout(killTimeout);
                this.process = null;
                resolve();
            });
            this.process.kill('SIGTERM');
        });
    }
    isRunning() {
        return this.process !== null && !this.process.killed;
    }
}
export async function startRuvSwarmMCP(options = {}) {
    const wrapper = new RuvSwarmWrapper(options);
    try {
        const result = await wrapper.start();
        console.log('✅ RuvSwarm MCP server started successfully');
        return {
            wrapper,
            ...result
        };
    } catch (error) {
        console.error('❌ Failed to start RuvSwarm MCP server:', error.message);
        throw error;
    }
}

//# sourceMappingURL=ruv-swarm-wrapper.js.map