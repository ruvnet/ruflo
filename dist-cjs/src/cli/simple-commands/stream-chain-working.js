#!/usr/bin/env node
import { spawn, execSync } from 'child_process';
function checkClaudeAvailable() {
    try {
        execSync('which claude', {
            stdio: 'ignore'
        });
        return true;
    } catch  {
        return false;
    }
}
function extractContentFromStream(streamOutput) {
    const lines = streamOutput.split('\n').filter((line)=>line.trim());
    let content = '';
    for (const line of lines){
        try {
            const json = JSON.parse(line);
            if (json.type === 'assistant' && json.message && json.message.content) {
                for (const item of json.message.content){
                    if (item.type === 'text' && item.text) {
                        content += item.text;
                    }
                }
            }
        } catch (e) {}
    }
    return content.trim();
}
async function executeStep(prompt, previousContent, stepNum, totalSteps, flags) {
    return new Promise((resolve)=>{
        const startTime = Date.now();
        const timeout = (flags.timeout || 30) * 1000;
        let fullPrompt = prompt;
        if (previousContent) {
            fullPrompt = `Previous step output:\n${previousContent}\n\nNext step: ${prompt}`;
        }
        const args = [
            '-p'
        ];
        args.push('--output-format', 'stream-json', '--verbose');
        args.push(fullPrompt);
        if (flags.verbose) {
            console.log(`   Command: claude ${args[0]} ${args[1]} ${args[2]} "${args[4].slice(0, 50)}..."`);
        }
        const claudeProcess = spawn('claude', args, {
            stdio: [
                'pipe',
                'pipe',
                'pipe'
            ],
            env: process.env
        });
        let output = '';
        let stderr = '';
        let completed = false;
        claudeProcess.stdin.end();
        claudeProcess.stdout.on('data', (chunk)=>{
            output += chunk.toString();
        });
        claudeProcess.stderr.on('data', (chunk)=>{
            stderr += chunk.toString();
        });
        claudeProcess.on('close', (code)=>{
            if (completed) return;
            completed = true;
            const duration = Date.now() - startTime;
            if (code !== 0) {
                console.error(`   Process exited with code ${code}`);
                if (stderr && flags.verbose) {
                    console.error(`   stderr: ${stderr.slice(0, 200)}`);
                }
                resolve({
                    success: false,
                    duration,
                    content: null,
                    rawOutput: output
                });
                return;
            }
            const content = extractContentFromStream(output);
            resolve({
                success: true,
                duration,
                content,
                rawOutput: output
            });
        });
        claudeProcess.on('error', (error)=>{
            if (completed) return;
            completed = true;
            console.error('   Process error:', error.message);
            resolve({
                success: false,
                duration: Date.now() - startTime,
                content: null,
                rawOutput: null
            });
        });
        setTimeout(()=>{
            if (!completed) {
                completed = true;
                claudeProcess.kill('SIGTERM');
                console.log('   ⏱️  Step timed out');
                resolve({
                    success: false,
                    duration: timeout,
                    content: null,
                    rawOutput: null
                });
            }
        }, timeout);
    });
}
async function executeChain(prompts, flags) {
    const results = [];
    let previousContent = null;
    for(let i = 0; i < prompts.length; i++){
        const prompt = prompts[i];
        console.log(`\n🔄 Step ${i + 1}/${prompts.length}: ${prompt.slice(0, 50)}...`);
        const result = await executeStep(prompt, previousContent, i + 1, prompts.length, flags);
        results.push({
            step: i + 1,
            prompt: prompt.slice(0, 50),
            success: result.success,
            duration: result.duration,
            content: result.content
        });
        if (!result.success) {
            console.error(`❌ Step ${i + 1} failed`);
            break;
        }
        console.log(`✅ Step ${i + 1} completed (${result.duration}ms)`);
        if (result.content) {
            previousContent = result.content;
            if (flags.verbose) {
                console.log(`   Content: ${result.content.slice(0, 100)}...`);
            }
        }
    }
    return results;
}
export async function streamChainCommand(args, flags) {
    const subcommand = args[0] || 'help';
    if (subcommand === 'help') {
        showHelp();
        return;
    }
    if (!checkClaudeAvailable()) {
        console.error('❌ Claude Code not found');
        console.log('Please ensure Claude Code is installed and available');
        return;
    }
    switch(subcommand){
        case 'demo':
            await runDemo(flags);
            break;
        case 'run':
            await runCustom(args.slice(1), flags);
            break;
        case 'test':
            await runTest(flags);
            break;
        default:
            console.error(`❌ Unknown subcommand: ${subcommand}`);
            showHelp();
    }
}
function showHelp() {
    console.log(`
🔗 Stream Chain Command - Claude Code Context Chaining

DESCRIPTION
    Chain multiple Claude Code prompts with context preservation.
    Each step receives the output from the previous step.

USAGE
    stream-chain <subcommand> [options]

SUBCOMMANDS
    run <p1> <p2> [...]  Execute custom chain
    demo                 Run demo chain
    test                 Test chaining
    help                 Show this help

OPTIONS
    --verbose            Show detailed output
    --timeout <seconds>  Timeout per step (default: 30)

EXAMPLES
    stream-chain demo
    stream-chain run "Write code" "Review it" "Improve it"
    stream-chain test --verbose
  `);
}
async function runDemo(flags) {
    console.log('🎭 Running Stream Chain Demo');
    console.log('━'.repeat(50));
    const prompts = [
        "Write a simple Python function to reverse a string",
        "Add type hints to the function",
        "Add a docstring to the function"
    ];
    const results = await executeChain(prompts, flags);
    showSummary(results);
}
async function runCustom(prompts, flags) {
    if (prompts.length < 2) {
        console.error('❌ Need at least 2 prompts');
        return;
    }
    console.log('🔗 Starting Custom Chain');
    console.log('━'.repeat(50));
    const results = await executeChain(prompts, flags);
    showSummary(results);
}
async function runTest(flags) {
    console.log('🧪 Testing Stream Chain');
    console.log('━'.repeat(50));
    const prompts = [
        "Say exactly: 'Step 1 complete'",
        "If the previous step said 'Step 1 complete', say 'Chain working!'"
    ];
    const results = await executeChain(prompts, {
        ...flags,
        verbose: true
    });
    const success = results.every((r)=>r.success);
    console.log('\n' + (success ? '✅ Test passed!' : '❌ Test failed'));
}
function showSummary(results) {
    console.log('\n' + '═'.repeat(50));
    console.log('📊 Summary');
    console.log('═'.repeat(50));
    for (const r of results){
        const status = r.success ? '✅' : '❌';
        console.log(`${status} Step ${r.step}: ${r.prompt}... (${r.duration}ms)`);
    }
    const total = results.reduce((sum, r)=>sum + r.duration, 0);
    const success = results.filter((r)=>r.success).length;
    console.log(`\n⏱️  Total: ${total}ms`);
    console.log(`📈 Success: ${success}/${results.length}`);
}
export default streamChainCommand;

//# sourceMappingURL=stream-chain-working.js.map