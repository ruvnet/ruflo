import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let tokenCache = {
    sessions: {},
    totals: {
        input: 0,
        output: 0,
        total: 0
    },
    byAgent: {},
    byCommand: {},
    history: []
};
function getMetricsDir() {
    return path.join(process.cwd(), '.claude-flow', 'metrics');
}
function getTokenFilePath() {
    return path.join(getMetricsDir(), 'token-usage.json');
}
export async function loadTokenData() {
    try {
        const filePath = getTokenFilePath();
        const data = await fs.readFile(filePath, 'utf-8');
        tokenCache = JSON.parse(data);
        return tokenCache;
    } catch (error) {
        return tokenCache;
    }
}
export async function saveTokenData() {
    try {
        const dir = getMetricsDir();
        await fs.mkdir(dir, {
            recursive: true
        });
        const filePath = getTokenFilePath();
        await fs.writeFile(filePath, JSON.stringify(tokenCache, null, 2));
    } catch (error) {
        console.error('Failed to save token data:', error.message);
    }
}
export async function trackTokens(params) {
    const { sessionId, agentType = 'general', command = 'unknown', inputTokens = 0, outputTokens = 0, metadata = {} } = params;
    tokenCache.totals.input += inputTokens;
    tokenCache.totals.output += outputTokens;
    tokenCache.totals.total += inputTokens + outputTokens;
    if (!tokenCache.byAgent[agentType]) {
        tokenCache.byAgent[agentType] = {
            input: 0,
            output: 0,
            total: 0,
            count: 0
        };
    }
    tokenCache.byAgent[agentType].input += inputTokens;
    tokenCache.byAgent[agentType].output += outputTokens;
    tokenCache.byAgent[agentType].total += inputTokens + outputTokens;
    tokenCache.byAgent[agentType].count++;
    if (!tokenCache.byCommand[command]) {
        tokenCache.byCommand[command] = {
            input: 0,
            output: 0,
            total: 0,
            count: 0
        };
    }
    tokenCache.byCommand[command].input += inputTokens;
    tokenCache.byCommand[command].output += outputTokens;
    tokenCache.byCommand[command].total += inputTokens + outputTokens;
    tokenCache.byCommand[command].count++;
    tokenCache.history.push({
        timestamp: Date.now(),
        sessionId,
        agentType,
        command,
        inputTokens,
        outputTokens,
        metadata
    });
    if (tokenCache.history.length > 1000) {
        tokenCache.history = tokenCache.history.slice(-1000);
    }
    await saveTokenData();
    return {
        sessionTotal: inputTokens + outputTokens,
        grandTotal: tokenCache.totals.total
    };
}
export async function getRealTokenUsage(agentFilter = 'all') {
    await loadTokenData();
    if (tokenCache.totals.total === 0) {
        const claudeTokens = await getClaudeCodeTokenUsage();
        if (claudeTokens) {
            return claudeTokens;
        }
    }
    if (agentFilter !== 'all' && tokenCache.byAgent[agentFilter]) {
        const agentData = tokenCache.byAgent[agentFilter];
        return {
            total: agentData.total,
            input: agentData.input,
            output: agentData.output,
            byAgent: {
                [agentFilter]: agentData.total
            }
        };
    }
    const byAgent = {};
    Object.entries(tokenCache.byAgent).forEach(([type, data])=>{
        byAgent[type] = data.total;
    });
    return {
        total: tokenCache.totals.total,
        input: tokenCache.totals.input,
        output: tokenCache.totals.output,
        byAgent,
        byCommand: tokenCache.byCommand,
        history: tokenCache.history
    };
}
async function getClaudeCodeTokenUsage() {
    try {
        const possiblePaths = [
            path.join(process.env.HOME, '.config', 'claude', 'usage.json'),
            path.join(process.env.HOME, '.claude', 'metrics.json'),
            path.join(process.cwd(), '.claude', 'usage.json')
        ];
        for (const logPath of possiblePaths){
            try {
                const data = await fs.readFile(logPath, 'utf-8');
                const usage = JSON.parse(data);
                if (usage.tokens || usage.usage) {
                    const tokens = usage.tokens || usage.usage;
                    return {
                        total: tokens.total || 0,
                        input: tokens.input || tokens.prompt_tokens || 0,
                        output: tokens.output || tokens.completion_tokens || 0,
                        byAgent: {},
                        source: 'claude-code'
                    };
                }
            } catch (e) {}
        }
    } catch (error) {}
    return {
        total: 0,
        input: 0,
        output: 0,
        byAgent: {},
        source: 'none'
    };
}
export function calculateCost(tokenData) {
    const INPUT_COST_PER_1M = 15.00;
    const OUTPUT_COST_PER_1M = 75.00;
    const inputCost = tokenData.input / 1000000 * INPUT_COST_PER_1M;
    const outputCost = tokenData.output / 1000000 * OUTPUT_COST_PER_1M;
    return {
        input: inputCost,
        output: outputCost,
        total: inputCost + outputCost
    };
}
export function generateOptimizationSuggestions(tokenData) {
    const suggestions = [];
    if (tokenData.total === 0) {
        return [
            'No token usage data available. Start using Claude Code to track tokens.'
        ];
    }
    const outputRatio = tokenData.output / tokenData.total;
    if (outputRatio > 0.6) {
        suggestions.push('High output ratio detected. Consider more concise prompts to reduce generation.');
    }
    if (tokenData.byAgent) {
        const sortedAgents = Object.entries(tokenData.byAgent).sort((a, b)=>b[1] - a[1]);
        if (sortedAgents.length > 0) {
            const [topAgent, topUsage] = sortedAgents[0];
            const percentage = topUsage / tokenData.total * 100;
            if (percentage > 50) {
                suggestions.push(`${topAgent} agents consume ${percentage.toFixed(0)}% of tokens. Consider optimization or caching.`);
            }
        }
    }
    if (tokenData.history && tokenData.history.length > 10) {
        const recentCommands = tokenData.history.slice(-20).map((h)=>h.command);
        const duplicates = recentCommands.filter((cmd, i)=>recentCommands.indexOf(cmd) !== i);
        if (duplicates.length > 5) {
            suggestions.push('Repeated commands detected. Consider implementing result caching.');
        }
    }
    if (tokenData.total > 100000) {
        suggestions.push('Consider using Claude Haiku for non-critical tasks to reduce costs by ~90%.');
    }
    if (tokenData.total > 50000) {
        suggestions.push('Implement prompt templates to reduce input token usage.');
        suggestions.push('Use streaming responses to optimize output generation.');
    }
    return suggestions.length > 0 ? suggestions : [
        'Token usage is within optimal range.'
    ];
}
export async function generateTokenUsageReport(tokenData, agentFilter) {
    const reportDir = path.join(process.cwd(), 'analysis-reports');
    await fs.mkdir(reportDir, {
        recursive: true
    });
    const timestamp = Date.now();
    const csvPath = path.join(reportDir, `token-usage-${timestamp}.csv`);
    let csv = 'Timestamp,Session,Agent,Command,Input Tokens,Output Tokens,Total\n';
    if (tokenData.history) {
        tokenData.history.forEach((entry)=>{
            const date = new Date(entry.timestamp).toISOString();
            const total = entry.inputTokens + entry.outputTokens;
            csv += `${date},${entry.sessionId},${entry.agentType},${entry.command},${entry.inputTokens},${entry.outputTokens},${total}\n`;
        });
    }
    csv += '\nSUMMARY\n';
    csv += `Total Input Tokens,${tokenData.input}\n`;
    csv += `Total Output Tokens,${tokenData.output}\n`;
    csv += `Total Tokens,${tokenData.total}\n`;
    if (tokenData.byAgent) {
        csv += '\nBY AGENT TYPE\n';
        Object.entries(tokenData.byAgent).forEach(([type, usage])=>{
            csv += `${type},${usage}\n`;
        });
    }
    await fs.writeFile(csvPath, csv);
    return csvPath;
}
export function getAgentIcon(agentType) {
    const icons = {
        coordinator: '🎯',
        developer: '👨‍💻',
        researcher: '🔍',
        analyzer: '📊',
        tester: '🧪',
        architect: '🏗️',
        general: '🤖'
    };
    return icons[agentType] || '🤖';
}
export async function resetTokenTracking() {
    tokenCache = {
        sessions: {},
        totals: {
            input: 0,
            output: 0,
            total: 0
        },
        byAgent: {},
        byCommand: {},
        history: []
    };
    await saveTokenData();
}

//# sourceMappingURL=token-tracker.js.map