#!/usr/bin/env node
import { spawn, execSync } from 'child_process';
import { Readable } from 'stream';
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
async function executeStreamChain(prompts, flags = {}) {
    if (!checkClaudeAvailable()) {
        console.error('❌ Error: Claude CLI is required for stream chaining');
        console.log('   Install: npm install -g @anthropic-ai/claude-cli');
        console.log('   Or use Claude Code: https://docs.anthropic.com/claude/docs/claude-cli');
        return;
    }
    console.log('🔗 Starting Real Stream Chain');
    console.log('━'.repeat(50));
    console.log(`📝 Chain length: ${prompts.length} steps`);
    console.log('');
    const results = [];
    let previousOutput = null;
    for(let i = 0; i < prompts.length; i++){
        const prompt = prompts[i];
        const isFirst = i === 0;
        const isLast = i === prompts.length - 1;
        console.log(`\n🔄 Step ${i + 1}/${prompts.length}: ${prompt.slice(0, 50)}...`);
        try {
            const result = await executeSingleStep(prompt, previousOutput, isFirst, isLast, flags);
            results.push({
                step: i + 1,
                prompt: prompt.slice(0, 50),
                success: result.success,
                duration: result.duration
            });
            if (!result.success) {
                console.error(`❌ Step ${i + 1} failed`);
                break;
            }
            console.log(`✅ Step ${i + 1} completed (${result.duration}ms)`);
            if (!isLast) {
                previousOutput = result.output;
            }
            if (flags.verbose && result.output) {
                const preview = result.output.slice(0, 200);
                console.log(`   Output preview: ${preview}...`);
            }
        } catch (error) {
            console.error(`❌ Step ${i + 1} error:`, error.message);
            results.push({
                step: i + 1,
                prompt: prompt.slice(0, 50),
                success: false,
                duration: 0
            });
            break;
        }
    }
    console.log('\n' + '═'.repeat(50));
    console.log('📊 Stream Chain Summary');
    console.log('═'.repeat(50));
    for (const result of results){
        const status = result.success ? '✅' : '❌';
        console.log(`${status} Step ${result.step}: ${result.prompt}... (${result.duration}ms)`);
    }
    const totalTime = results.reduce((sum, r)=>sum + r.duration, 0);
    const successCount = results.filter((r)=>r.success).length;
    console.log(`\n⏱️  Total execution time: ${totalTime}ms`);
    console.log(`📈 Success rate: ${successCount}/${results.length} steps`);
}
async function executeSingleStep(prompt, inputStream, isFirst, isLast, flags) {
    return new Promise((resolve, reject)=>{
        const startTime = Date.now();
        const timeout = (flags.timeout || 30) * 1000;
        const args = [
            '-p'
        ];
        if (!isFirst && inputStream) {
            args.push('--input-format', 'stream-json');
        }
        if (!isLast) {
            args.push('--output-format', 'stream-json');
            if (flags.verbose) {
                args.push('--verbose');
            }
        }
        args.push(prompt);
        console.log(`   Executing: claude ${args.join(' ')}`);
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
        let processCompleted = false;
        if (!isFirst && inputStream) {
            console.log('   🔗 Piping input from previous step...');
            const inputReadable = Readable.from(inputStream);
            inputReadable.pipe(claudeProcess.stdin);
            inputReadable.on('error', (error)=>{
                console.error('   Input pipe error:', error.message);
            });
        } else {
            claudeProcess.stdin.end();
        }
        claudeProcess.stdout.on('data', (data)=>{
            output += data.toString();
            if (flags.verbose && !processCompleted) {
                process.stdout.write('.');
            }
        });
        claudeProcess.stderr.on('data', (data)=>{
            stderr += data.toString();
        });
        claudeProcess.on('close', (code)=>{
            if (processCompleted) return;
            processCompleted = true;
            const duration = Date.now() - startTime;
            if (flags.verbose) {
                console.log('');
            }
            if (code !== 0) {
                console.error(`   Process exited with code ${code}`);
                if (stderr) {
                    console.error(`   stderr: ${stderr.slice(0, 200)}`);
                }
                resolve({
                    success: false,
                    duration,
                    output: null,
                    error: stderr || `Process exited with code ${code}`
                });
                return;
            }
            resolve({
                success: true,
                duration,
                output: output.trim(),
                error: null
            });
        });
        claudeProcess.on('error', (error)=>{
            if (processCompleted) return;
            processCompleted = true;
            console.error('   Process error:', error.message);
            reject(error);
        });
        const timeoutId = setTimeout(()=>{
            if (processCompleted) return;
            processCompleted = true;
            console.log('   ⏱️  Timeout reached, terminating...');
            claudeProcess.kill('SIGTERM');
            resolve({
                success: false,
                duration: timeout,
                output: null,
                error: 'Process timed out'
            });
        }, timeout);
        claudeProcess.on('exit', ()=>{
            clearTimeout(timeoutId);
        });
    });
}
export async function streamChainCommand(args, flags) {
    const subcommand = args[0] || 'help';
    switch(subcommand){
        case 'help':
            showHelp();
            break;
        case 'demo':
            await runDemo(flags);
            break;
        case 'run':
            await runCustomChain(args.slice(1), flags);
            break;
        case 'test':
            await testStreamConnection(flags);
            break;
        case 'pipeline':
            await runPipeline(args.slice(1), flags);
            break;
        default:
            console.error(`❌ Unknown subcommand: ${subcommand}`);
            console.log('Use "stream-chain help" for usage information');
    }
}
function showHelp() {
    console.log(`
🔗 Real Stream Chain Command - Claude CLI Stream-JSON Chaining

DESCRIPTION
    Connect multiple Claude instances using stream-json format for
    real multi-agent workflows with full context preservation.

USAGE
    stream-chain <subcommand> [options]

SUBCOMMANDS
    run <prompt1> <prompt2> [...]  Execute custom chain (min 2 prompts)
    demo                           Run 3-step demonstration
    pipeline <type>                Execute predefined pipeline
    test                          Test stream connection
    help                          Show this help

PIPELINE TYPES
    analysis    Code analysis pipeline
    refactor    Refactoring workflow
    test        Test generation
    optimize    Performance optimization

OPTIONS
    --verbose            Show detailed output
    --timeout <seconds>  Timeout per step (default: 30)

EXAMPLES
    stream-chain run "Analyze code" "Suggest improvements" "Apply changes"
    stream-chain demo --verbose
    stream-chain pipeline analysis --timeout 60
    stream-chain test

STREAM-JSON FORMAT
    Each step communicates via newline-delimited JSON:
    {"type":"init","session_id":"abc123"}
    {"type":"message","role":"assistant","content":[...]}
    {"type":"tool_use","name":"Bash","input":{...}}
    {"type":"result","status":"success"}

For more: docs/stream-chaining.md
  `);
}
async function runDemo(flags) {
    console.log('🎭 Running Stream Chain Demo');
    console.log('━'.repeat(50));
    console.log('This demonstrates a real 3-step chain with context preservation\n');
    const prompts = [
        "Generate a simple Python function to calculate factorial",
        "Review the code and suggest improvements for efficiency",
        "Apply the improvements and create the final optimized version"
    ];
    await executeStreamChain(prompts, flags);
}
async function runCustomChain(prompts, flags) {
    if (prompts.length < 2) {
        console.error('❌ Error: Need at least 2 prompts for chaining');
        console.log('Usage: stream-chain run "prompt1" "prompt2" [...]');
        return;
    }
    await executeStreamChain(prompts, flags);
}
async function testStreamConnection(flags) {
    console.log('🧪 Testing Stream Connection');
    console.log('━'.repeat(50));
    const testPrompts = [
        "Say 'Stream test step 1 complete'",
        "Acknowledge the previous message and say 'Stream test step 2 complete'"
    ];
    await executeStreamChain(testPrompts, {
        ...flags,
        verbose: true
    });
}
async function runPipeline(args, flags) {
    const pipelineType = args[0] || 'analysis';
    const pipelines = {
        analysis: [
            "Analyze the current directory structure and identify key components",
            "Based on the analysis, identify potential improvements",
            "Create a detailed report with actionable recommendations"
        ],
        refactor: [
            "Identify code that needs refactoring in the current project",
            "Create a refactoring plan with priorities",
            "Generate refactored code examples for the top priorities"
        ],
        test: [
            "Analyze code coverage and identify untested areas",
            "Design comprehensive test cases for critical functions",
            "Generate unit test implementations"
        ],
        optimize: [
            "Profile the codebase for performance bottlenecks",
            "Identify optimization opportunities",
            "Provide optimized implementations"
        ]
    };
    const pipeline = pipelines[pipelineType];
    if (!pipeline) {
        console.error(`❌ Unknown pipeline: ${pipelineType}`);
        console.log('Available pipelines:', Object.keys(pipelines).join(', '));
        return;
    }
    console.log(`🚀 Running ${pipelineType} pipeline`);
    await executeStreamChain(pipeline, flags);
}
export default streamChainCommand;

//# sourceMappingURL=stream-chain-real.js.map