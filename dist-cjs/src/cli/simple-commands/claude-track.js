#!/usr/bin/env node
import { trackTokens } from './token-tracker.js';
function parseTokensFromTelemetry(data) {
    try {
        const lines = data.split('\n');
        for (const line of lines){
            if (line.includes('api_request') && line.includes('attributes')) {
                const match = line.match(/input_tokens['":\s]+(\d+).*output_tokens['":\s]+(\d+)/);
                if (match) {
                    return {
                        inputTokens: parseInt(match[1]),
                        outputTokens: parseInt(match[2])
                    };
                }
            }
            if (line.includes('input_tokens:') || line.includes('output_tokens:')) {
                const inputMatch = line.match(/input_tokens:\s*'?(\d+)'?/);
                const outputMatch = line.match(/output_tokens:\s*'?(\d+)'?/);
                if (inputMatch || outputMatch) {
                    return {
                        inputTokens: inputMatch ? parseInt(inputMatch[1]) : 0,
                        outputTokens: outputMatch ? parseInt(outputMatch[1]) : 0
                    };
                }
            }
        }
    } catch (error) {}
    return null;
}
export async function trackClaudeSession() {
    console.log('🔍 Claude token tracker started (running in background)');
    console.log('   Token usage will be saved to .claude-flow/metrics/token-usage.json');
    let totalInput = 0;
    let totalOutput = 0;
    let lastUpdate = Date.now();
    process.stdin.on('data', async (data)=>{
        const output = data.toString();
        const tokens = parseTokensFromTelemetry(output);
        if (tokens && (tokens.inputTokens > 0 || tokens.outputTokens > 0)) {
            totalInput += tokens.inputTokens;
            totalOutput += tokens.outputTokens;
            await trackTokens({
                sessionId: `claude-session-${Date.now()}`,
                agentType: 'claude-cli',
                command: 'interactive',
                inputTokens: tokens.inputTokens,
                outputTokens: tokens.outputTokens,
                metadata: {
                    source: 'telemetry_stream'
                }
            });
            if (Date.now() - lastUpdate > 10000) {
                console.log(`📊 Token Update: Input: ${totalInput}, Output: ${totalOutput}`);
                lastUpdate = Date.now();
            }
        }
    });
    process.on('SIGINT', ()=>{
        console.log(`\n📊 Session Total: Input: ${totalInput}, Output: ${totalOutput}`);
        console.log('✅ Token tracking data saved');
        process.exit(0);
    });
}
if (import.meta.url === `file://${process.argv[1]}`) {
    trackClaudeSession();
}

//# sourceMappingURL=claude-track.js.map