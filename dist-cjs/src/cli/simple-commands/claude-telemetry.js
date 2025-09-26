#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { trackTokens } from './token-tracker.js';
const CLAUDE_DATA_PATHS = [
    path.join(os.homedir(), '.claude', 'sessions'),
    path.join(os.homedir(), '.config', 'claude', 'sessions'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'sessions')
];
async function parseClaudeSessionData(sessionId) {
    for (const dataPath of CLAUDE_DATA_PATHS){
        try {
            const sessionFile = path.join(dataPath, `${sessionId}.jsonl`);
            const exists = await fs.access(sessionFile).then(()=>true).catch(()=>false);
            if (!exists) continue;
            const content = await fs.readFile(sessionFile, 'utf-8');
            const lines = content.trim().split('\n');
            let totalInput = 0;
            let totalOutput = 0;
            for (const line of lines){
                try {
                    const data = JSON.parse(line);
                    if (data.usage) {
                        totalInput += data.usage.input_tokens || 0;
                        totalOutput += data.usage.output_tokens || 0;
                    }
                } catch (e) {}
            }
            return {
                inputTokens: totalInput,
                outputTokens: totalOutput
            };
        } catch (error) {}
    }
    return null;
}
function parseClaudeOutput(output) {
    const tokenRegex = /(\d+)\s+tokens?\s+\((input|output|total)\)/gi;
    const costRegex = /\$(\d+\.\d+)/g;
    const tokens = {
        input: 0,
        output: 0,
        total: 0
    };
    const costs = [];
    let match;
    while((match = tokenRegex.exec(output)) !== null){
        const count = parseInt(match[1]);
        const type = match[2].toLowerCase();
        tokens[type] = count;
    }
    while((match = costRegex.exec(output)) !== null){
        costs.push(parseFloat(match[1]));
    }
    return {
        tokens,
        costs
    };
}
export async function runClaudeWithTelemetry(args, options = {}) {
    const sessionId = options.sessionId || `claude-${Date.now()}`;
    const agentType = options.agentType || 'claude-cli';
    const command = args.join(' ');
    const env = {
        ...process.env,
        CLAUDE_CODE_ENABLE_TELEMETRY: '1',
        OTEL_METRICS_EXPORTER: process.env.OTEL_METRICS_EXPORTER || 'console',
        OTEL_LOGS_EXPORTER: process.env.OTEL_LOGS_EXPORTER || 'console'
    };
    return new Promise((resolve, reject)=>{
        const claude = spawn('claude', args, {
            env,
            stdio: [
                'inherit',
                'pipe',
                'pipe'
            ]
        });
        let stdout = '';
        let stderr = '';
        const rlOut = readline.createInterface({
            input: claude.stdout,
            terminal: false
        });
        const rlErr = readline.createInterface({
            input: claude.stderr,
            terminal: false
        });
        rlOut.on('line', (line)=>{
            console.log(line);
            stdout += line + '\n';
            const usage = parseClaudeOutput(line);
            if (usage.tokens.input > 0 || usage.tokens.output > 0) {
                trackTokens({
                    sessionId,
                    agentType,
                    command,
                    inputTokens: usage.tokens.input,
                    outputTokens: usage.tokens.output,
                    metadata: {
                        costs: usage.costs
                    }
                }).catch(console.error);
            }
        });
        rlErr.on('line', (line)=>{
            console.error(line);
            stderr += line + '\n';
        });
        claude.on('exit', async (code)=>{
            const sessionData = await parseClaudeSessionData(sessionId);
            if (sessionData) {
                await trackTokens({
                    sessionId,
                    agentType,
                    command,
                    inputTokens: sessionData.inputTokens,
                    outputTokens: sessionData.outputTokens,
                    metadata: {
                        source: 'session_file'
                    }
                });
            }
            const fullUsage = parseClaudeOutput(stdout + stderr);
            if (fullUsage.tokens.input > 0 || fullUsage.tokens.output > 0) {
                await trackTokens({
                    sessionId,
                    agentType,
                    command,
                    inputTokens: fullUsage.tokens.input,
                    outputTokens: fullUsage.tokens.output,
                    metadata: {
                        source: 'output_parse',
                        costs: fullUsage.costs
                    }
                });
            }
            resolve({
                code,
                stdout,
                stderr
            });
        });
        claude.on('error', reject);
    });
}
export async function monitorClaudeSession(sessionId, interval = 5000) {
    console.log(`📊 Monitoring Claude session: ${sessionId}`);
    console.log(`   Checking every ${interval / 1000} seconds for token updates...\n`);
    let lastTokens = {
        input: 0,
        output: 0
    };
    const monitor = setInterval(async ()=>{
        const data = await parseClaudeSessionData(sessionId);
        if (data) {
            const inputDiff = data.inputTokens - lastTokens.input;
            const outputDiff = data.outputTokens - lastTokens.output;
            if (inputDiff > 0 || outputDiff > 0) {
                console.log(`🔄 Token Update Detected:`);
                console.log(`   Input:  +${inputDiff} (Total: ${data.inputTokens})`);
                console.log(`   Output: +${outputDiff} (Total: ${data.outputTokens})`);
                await trackTokens({
                    sessionId,
                    agentType: 'claude-monitor',
                    command: 'session_monitor',
                    inputTokens: inputDiff,
                    outputTokens: outputDiff,
                    metadata: {
                        totalInput: data.inputTokens,
                        totalOutput: data.outputTokens
                    }
                });
                lastTokens = data;
            }
        }
    }, interval);
    return ()=>{
        clearInterval(monitor);
        console.log(`\n✅ Stopped monitoring session: ${sessionId}`);
    };
}
export async function extractCostCommand() {
    return new Promise((resolve, reject)=>{
        const claude = spawn('claude', [
            '/cost'
        ], {
            stdio: [
                'pipe',
                'pipe',
                'pipe'
            ]
        });
        claude.stdin.write('\n');
        claude.stdin.end();
        let output = '';
        claude.stdout.on('data', (data)=>{
            output += data.toString();
        });
        claude.stderr.on('data', (data)=>{
            output += data.toString();
        });
        claude.on('exit', ()=>{
            const usage = parseClaudeOutput(output);
            resolve(usage);
        });
        claude.on('error', reject);
    });
}
if (import.meta.url === `file://${process.argv[1]}`) {
    const command = process.argv[2];
    switch(command){
        case 'wrap':
            const claudeArgs = process.argv.slice(3);
            runClaudeWithTelemetry(claudeArgs).then((result)=>process.exit(result.code)).catch((error)=>{
                console.error('Error:', error);
                process.exit(1);
            });
            break;
        case 'monitor':
            const sessionId = process.argv[3] || 'current';
            const stopMonitor = await monitorClaudeSession(sessionId);
            process.on('SIGINT', ()=>{
                stopMonitor();
                process.exit(0);
            });
            break;
        case 'cost':
            const costData = await extractCostCommand();
            console.log('\n📊 Current Session Usage:');
            console.log(`   Input Tokens:  ${costData.tokens.input || 0}`);
            console.log(`   Output Tokens: ${costData.tokens.output || 0}`);
            console.log(`   Total Tokens:  ${costData.tokens.total || 0}`);
            if (costData.costs.length > 0) {
                console.log(`   Estimated Cost: $${costData.costs[0]}`);
            }
            break;
        default:
            console.log(`
Claude Telemetry Integration

Usage:
  claude-telemetry wrap <claude-args>    Run Claude with telemetry
  claude-telemetry monitor [session-id]  Monitor session for tokens
  claude-telemetry cost                  Get current session cost

Examples:
  claude-telemetry wrap chat "Hello"
  claude-telemetry monitor claude-123456
  claude-telemetry cost
`);
    }
}

//# sourceMappingURL=claude-telemetry.js.map