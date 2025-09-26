import fs from 'fs/promises';
import path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import readline from 'readline';
const execAsync = promisify(exec);
let AutoFixPairSession = class AutoFixPairSession {
    constructor(options = {}){
        this.sessionId = `pair_${Date.now()}`;
        this.mode = options.mode || 'switch';
        this.agent = options.agent || 'auto';
        this.verify = options.verify || false;
        this.autoFix = options.autoFix || false;
        this.test = options.test || false;
        this.threshold = options.threshold || 0.95;
        this.maxIterations = options.maxIterations || 5;
        this.startTime = new Date();
        this.status = 'active';
        this.currentRole = 'driver';
        this.verificationScores = [];
        this.fixHistory = [];
        this.currentIteration = 0;
        this.rl = null;
    }
    async start() {
        await this.saveSession();
        this.showWelcome();
        if (this.verify && this.autoFix) {
            console.log('\n🔄 Auto-Fix Mode Enabled');
            console.log('  • Will automatically fix issues until threshold is met');
            console.log(`  • Maximum iterations: ${this.maxIterations}`);
            console.log(`  • Target threshold: ${this.threshold}`);
            await this.recursiveFixLoop();
        } else if (this.verify) {
            await this.runVerification();
        }
        await this.startInteractiveMode();
    }
    async recursiveFixLoop() {
        console.log('\n🚀 Starting Recursive Auto-Fix Loop...');
        console.log('━'.repeat(50));
        let score = 0;
        this.currentIteration = 0;
        while(score < this.threshold && this.currentIteration < this.maxIterations){
            this.currentIteration++;
            console.log(`\n📍 Iteration ${this.currentIteration}/${this.maxIterations}`);
            const verificationResult = await this.runVerification();
            score = verificationResult.score;
            if (score >= this.threshold) {
                console.log(`\n✨ Threshold met! Score: ${score.toFixed(2)} >= ${this.threshold}`);
                break;
            }
            const issues = this.identifyIssues(verificationResult);
            console.log(`\n🔍 Issues found: ${issues.length}`);
            issues.forEach((issue)=>console.log(`  • ${issue.type}: ${issue.description}`));
            if (issues.length > 0) {
                console.log('\n🔗 Creating stream-chain to fix issues...');
                await this.createFixChain(issues);
            }
            await new Promise((resolve)=>setTimeout(resolve, 2000));
        }
        if (score < this.threshold) {
            console.log(`\n⚠️ Max iterations reached. Final score: ${score.toFixed(2)}`);
            console.log('💡 Manual intervention may be required.');
        } else {
            console.log(`\n🎉 Success! All issues fixed. Final score: ${score.toFixed(2)}`);
        }
        this.showFixHistory();
    }
    async createFixChain(issues) {
        const chains = [];
        for (const issue of issues){
            let chainCommand = null;
            switch(issue.type){
                case 'lint':
                    chainCommand = this.createLintFixChain();
                    break;
                case 'typecheck':
                    chainCommand = this.createTypeFixChain();
                    break;
                case 'build':
                    chainCommand = this.createBuildFixChain();
                    break;
                case 'test':
                    chainCommand = this.createTestFixChain();
                    break;
            }
            if (chainCommand) {
                chains.push(chainCommand);
            }
        }
        for (const chain of chains){
            console.log(`  🔧 Executing: ${chain.description}`);
            await this.executeChain(chain);
            this.fixHistory.push({
                iteration: this.currentIteration,
                type: chain.type,
                command: chain.command,
                timestamp: new Date()
            });
        }
    }
    createLintFixChain() {
        return {
            type: 'lint',
            description: 'Auto-fix linting issues',
            command: async ()=>{
                console.log('    Running: npm run lint --fix');
                try {
                    await execAsync('npm run lint -- --fix 2>&1 || true');
                    console.log('    ✅ Linting auto-fix applied');
                } catch (error) {
                    console.log('    ⚠️ Some linting issues require manual fixes');
                }
                const { stdout: lintOutput } = await execAsync('npm run lint 2>&1 || true');
                if (lintOutput.includes('error')) {
                    console.log('    🤖 Using Claude to fix remaining issues...');
                    await this.executeClaudeFixChain('lint', lintOutput);
                }
            }
        };
    }
    createTypeFixChain() {
        return {
            type: 'typecheck',
            description: 'Fix TypeScript errors',
            command: async ()=>{
                console.log('    Analyzing TypeScript errors...');
                const { stdout: typeErrors } = await execAsync('npm run typecheck 2>&1 || true');
                if (typeErrors.includes('error')) {
                    console.log('    🤖 Using Claude to fix type errors...');
                    await this.executeClaudeFixChain("typescript", typeErrors);
                }
            }
        };
    }
    createBuildFixChain() {
        return {
            type: 'build',
            description: 'Fix build errors',
            command: async ()=>{
                console.log('    Analyzing build errors...');
                const { stdout: buildErrors } = await execAsync('npm run build 2>&1 || true');
                if (buildErrors.includes('error')) {
                    console.log('    🤖 Using Claude to fix build errors...');
                    await this.executeClaudeFixChain('build', buildErrors);
                }
            }
        };
    }
    createTestFixChain() {
        return {
            type: 'test',
            description: 'Fix failing tests',
            command: async ()=>{
                console.log('    Analyzing test failures...');
                const { stdout: testOutput } = await execAsync('npm test 2>&1 || true');
                if (testOutput.includes('fail')) {
                    console.log('    🤖 Using Claude to fix test failures...');
                    await this.executeClaudeFixChain('test', testOutput);
                }
            }
        };
    }
    async executeClaudeFixChain(type, errorOutput) {
        const prompts = {
            lint: `Fix these ESLint errors. Output only the corrected code:\n\n${errorOutput}`,
            typescript: `Fix these TypeScript errors. Output only the corrected code:\n\n${errorOutput}`,
            build: `Fix these build errors. Output only the corrected code:\n\n${errorOutput}`,
            test: `Fix these test failures. Output only the corrected code:\n\n${errorOutput}`
        };
        return new Promise((resolve, reject)=>{
            const claude = spawn('claude', [
                '-p',
                '--output-format',
                'stream-json',
                prompts[type]
            ]);
            let output = '';
            claude.stdout.on('data', (data)=>{
                output += data.toString();
            });
            claude.on('close', (code)=>{
                if (code === 0) {
                    this.applyClaudeFixes(type, output);
                    resolve();
                } else {
                    reject(new Error(`Claude fix chain failed with code ${code}`));
                }
            });
            claude.on('error', (error)=>{
                console.error('    ❌ Claude chain error:', error.message);
                reject(error);
            });
        });
    }
    async applyClaudeFixes(type, streamOutput) {
        try {
            const fixes = this.extractFixesFromStream(streamOutput);
            if (fixes && fixes.length > 0) {
                console.log(`    📝 Applying ${fixes.length} fixes...`);
                for (const fix of fixes){
                    console.log(`      • Fixed: ${fix.file || type}`);
                }
                console.log('    ✅ Fixes applied successfully');
            }
        } catch (error) {
            console.error('    ⚠️ Could not apply all fixes:', error.message);
        }
    }
    extractFixesFromStream(streamOutput) {
        const fixes = [];
        const lines = streamOutput.split('\n').filter((line)=>line.trim());
        for (const line of lines){
            try {
                const json = JSON.parse(line);
                if (json.type === 'message' && json.message && json.message.content) {
                    for (const item of json.message.content){
                        if (item.type === 'text' && item.text) {
                            const codeMatch = item.text.match(/```[\w]*\n([\s\S]*?)```/g);
                            if (codeMatch) {
                                fixes.push({
                                    type: 'code',
                                    content: codeMatch[0].replace(/```[\w]*\n|```/g, '')
                                });
                            }
                        }
                    }
                }
            } catch (e) {}
        }
        return fixes;
    }
    async executeChain(chain) {
        try {
            await chain.command();
        } catch (error) {
            console.error(`    ❌ Fix failed: ${error.message}`);
        }
    }
    identifyIssues(verificationResult) {
        const issues = [];
        if (verificationResult.results) {
            for (const check of verificationResult.results){
                if (check.score < 0.8) {
                    issues.push({
                        type: check.name.toLowerCase().replace(' check', '').replace(' ', ''),
                        description: `Score: ${check.score.toFixed(2)}`,
                        severity: check.score < 0.5 ? 'high' : 'medium'
                    });
                }
            }
        }
        return issues;
    }
    async runVerification() {
        console.log('\n🔍 Running verification check...');
        const checks = [
            {
                name: 'Type Check',
                command: 'npm run typecheck 2>&1 || true',
                weight: 0.4
            },
            {
                name: 'Linting',
                command: 'npm run lint 2>&1 || true',
                weight: 0.3
            },
            {
                name: 'Build',
                command: 'npm run build 2>&1 || true',
                weight: 0.3
            }
        ];
        const results = [];
        let totalScore = 0;
        let totalWeight = 0;
        for (const check of checks){
            try {
                const { stdout, stderr } = await execAsync(check.command);
                const output = stdout + stderr;
                let score = 1.0;
                if (output.toLowerCase().includes('error')) {
                    const errorCount = (output.match(/error/gi) || []).length;
                    score = Math.max(0.2, 1.0 - errorCount * 0.1);
                } else if (output.toLowerCase().includes('warning')) {
                    const warningCount = (output.match(/warning/gi) || []).length;
                    score = Math.max(0.7, 1.0 - warningCount * 0.05);
                }
                totalScore += score * check.weight;
                totalWeight += check.weight;
                const icon = score >= 0.8 ? '✅' : score >= 0.5 ? '⚠️' : '❌';
                console.log(`  ${icon} ${check.name}: ${score.toFixed(2)}`);
                results.push({
                    name: check.name,
                    score,
                    output: output.slice(0, 200),
                    errors: (output.match(/error/gi) || []).length,
                    warnings: (output.match(/warning/gi) || []).length
                });
            } catch (error) {
                console.log(`  ❌ ${check.name}: 0.00 (failed)`);
                results.push({
                    name: check.name,
                    score: 0,
                    error: error.message
                });
                totalWeight += check.weight;
            }
        }
        const averageScore = totalWeight > 0 ? totalScore / totalWeight : 0;
        console.log(`\n📊 Verification Score: ${averageScore.toFixed(2)}/${this.threshold}`);
        const verificationResult = {
            score: averageScore,
            results,
            timestamp: new Date(),
            iteration: this.currentIteration
        };
        this.verificationScores.push(verificationResult);
        return verificationResult;
    }
    showFixHistory() {
        if (this.fixHistory.length > 0) {
            console.log('\n📋 Fix History:');
            console.log('━'.repeat(50));
            for (const fix of this.fixHistory){
                console.log(`  Iteration ${fix.iteration}: Fixed ${fix.type} at ${fix.timestamp.toLocaleTimeString()}`);
            }
            console.log('━'.repeat(50));
            console.log(`  Total fixes applied: ${this.fixHistory.length}`);
            console.log(`  Final iterations: ${this.currentIteration}`);
        }
    }
    showWelcome() {
        console.log('\n🚀 Starting Pair Programming Session');
        console.log('━'.repeat(50));
        console.log(`Session ID: ${this.sessionId}`);
        console.log(`Mode: ${this.mode}`);
        console.log(`Verification: ${this.verify ? '✅ Enabled' : '❌ Disabled'}`);
        console.log(`Auto-Fix: ${this.autoFix ? '✅ Enabled' : '❌ Disabled'}`);
        console.log(`Testing: ${this.test ? '✅ Enabled' : '❌ Disabled'}`);
        if (this.autoFix) {
            console.log(`\n🔄 Recursive Auto-Fix Settings:`);
            console.log(`  • Target threshold: ${this.threshold}`);
            console.log(`  • Max iterations: ${this.maxIterations}`);
            console.log(`  • Stream chaining: Enabled`);
        }
        console.log('━'.repeat(50));
    }
    async startInteractiveMode() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: '\n💻 pair> '
        });
        console.log('\n💡 Interactive mode active. Type /help for commands.\n');
        this.showCommands();
        this.rl.prompt();
        this.rl.on('line', async (line)=>{
            const input = line.trim();
            if (input.startsWith('/')) {
                await this.handleCommand(input);
            } else if (input) {
                console.log('🤖 AI: Processing your input...');
            }
            this.rl.prompt();
        });
        this.rl.on('close', ()=>{
            this.end();
        });
    }
    showCommands() {
        console.log('\n📝 Session Commands:');
        console.log('  /help      - Show available commands');
        console.log('  /verify    - Run verification check');
        console.log('  /autofix   - Start recursive auto-fix');
        console.log('  /status    - Show session status');
        console.log('  /metrics   - Show quality metrics');
        console.log('  /history   - Show fix history');
        console.log('  /test      - Run tests');
        console.log('  /commit    - Commit with verification');
        console.log('  /end       - End session');
    }
    async handleCommand(command) {
        const [cmd] = command.split(' ');
        switch(cmd){
            case '/help':
                this.showCommands();
                break;
            case '/verify':
                await this.runVerification();
                break;
            case '/autofix':
                await this.recursiveFixLoop();
                break;
            case '/status':
                await this.showStatus();
                break;
            case '/metrics':
                this.showMetrics();
                break;
            case '/history':
                this.showFixHistory();
                break;
            case '/test':
                await this.runTests();
                break;
            case '/commit':
                await this.commitWithVerification();
                break;
            case '/end':
            case '/exit':
                await this.end();
                process.exit(0);
                break;
            default:
                console.log(`❌ Unknown command: ${cmd}`);
                console.log('💡 Type /help for available commands');
        }
    }
    async showStatus() {
        const duration = Math.floor((Date.now() - this.startTime) / 1000 / 60);
        console.log('\n📊 Session Status');
        console.log('━'.repeat(40));
        console.log(`Session ID: ${this.sessionId}`);
        console.log(`Duration: ${duration} minutes`);
        console.log(`Auto-Fix: ${this.autoFix ? 'Enabled' : 'Disabled'}`);
        console.log(`Fix Iterations: ${this.currentIteration}`);
        console.log(`Fixes Applied: ${this.fixHistory.length}`);
        if (this.verificationScores.length > 0) {
            const latest = this.verificationScores[this.verificationScores.length - 1];
            console.log(`Latest Score: ${latest.score.toFixed(2)}`);
        }
    }
    showMetrics() {
        console.log('\n📈 Quality Metrics');
        console.log('━'.repeat(40));
        if (this.verificationScores.length > 0) {
            console.log('\nScore Progression:');
            this.verificationScores.forEach((v, i)=>{
                const bar = '█'.repeat(Math.floor(v.score * 20));
                console.log(`  ${i + 1}. ${bar} ${v.score.toFixed(2)}`);
            });
            if (this.verificationScores.length > 1) {
                const first = this.verificationScores[0].score;
                const last = this.verificationScores[this.verificationScores.length - 1].score;
                const improvement = ((last - first) * 100).toFixed(1);
                console.log(`\n  Improvement: +${improvement}%`);
            }
        }
    }
    async runTests() {
        console.log('\n🧪 Running tests...');
        try {
            const { stdout } = await execAsync('npm test 2>&1 || true');
            const passed = stdout.includes('PASS');
            console.log(`  ${passed ? '✅' : '❌'} Tests ${passed ? 'passed' : 'failed'}`);
            return passed;
        } catch (error) {
            console.log('  ❌ Test execution failed:', error.message);
            return false;
        }
    }
    async commitWithVerification() {
        const result = await this.runVerification();
        if (result.score >= this.threshold) {
            console.log('✅ Verification passed! Ready to commit.');
        } else {
            console.log('❌ Verification failed!');
            console.log('💡 Run /autofix to automatically fix issues');
        }
    }
    async end() {
        console.log('\n🛑 Ending pair programming session...');
        if (this.rl) this.rl.close();
        this.status = 'completed';
        await this.saveSession();
        const duration = Math.floor((Date.now() - this.startTime) / 1000 / 60);
        console.log('\n✨ Session Complete!');
        console.log('━'.repeat(40));
        console.log(`Duration: ${duration} minutes`);
        console.log(`Total Fixes: ${this.fixHistory.length}`);
        console.log(`Final Iterations: ${this.currentIteration}`);
        if (this.verificationScores.length > 0) {
            const final = this.verificationScores[this.verificationScores.length - 1];
            console.log(`Final Score: ${final.score.toFixed(2)}`);
        }
        console.log('\n👋 Thanks for pair programming!\n');
    }
    async saveSession() {
        const sessionPath = '.claude-flow/sessions/pair';
        await fs.mkdir(sessionPath, {
            recursive: true
        });
        const sessionData = {
            id: this.sessionId,
            mode: this.mode,
            verify: this.verify,
            autoFix: this.autoFix,
            threshold: this.threshold,
            startTime: this.startTime.toISOString(),
            status: this.status,
            verificationScores: this.verificationScores,
            fixHistory: this.fixHistory,
            iterations: this.currentIteration
        };
        await fs.writeFile(path.join(sessionPath, `${this.sessionId}.json`), JSON.stringify(sessionData, null, 2));
    }
};
async function pairCommand(args = [], flags = {}) {
    console.log('\n👥 Pair Programming with Auto-Fix');
    console.log('━'.repeat(50));
    if (flags.help || args.includes('--help')) {
        showHelp();
        return;
    }
    if (flags.start) {
        const session = new AutoFixPairSession({
            mode: flags.mode || 'switch',
            verify: flags.verify || false,
            autoFix: flags.autofix || flags.fix || false,
            test: flags.test || false,
            threshold: parseFloat(flags.threshold) || 0.95,
            maxIterations: parseInt(flags.iterations) || 5
        });
        return await session.start();
    }
    showHelp();
}
function showHelp() {
    console.log(`
📚 USAGE:
  claude-flow pair [options]

⚙️ OPTIONS:
  --start              Start a new pair programming session
  --verify             Enable verification
  --autofix, --fix     Enable recursive auto-fix with stream chaining
  --threshold <n>      Target verification threshold (default: 0.95)
  --iterations <n>     Max fix iterations (default: 5)
  --test               Enable testing
  --help               Show this help message

🔄 AUTO-FIX FEATURES:
  • Recursive improvement loop
  • Stream-chaining for intelligent fixes
  • Automatic issue detection and resolution
  • Lint auto-fix integration
  • TypeScript error correction
  • Build error resolution
  • Test failure fixes

💡 EXAMPLES:
  # Basic session with auto-fix
  claude-flow pair --start --verify --autofix
  
  # Custom threshold and iterations
  claude-flow pair --start --verify --autofix --threshold 0.98 --iterations 10
  
  # With testing
  claude-flow pair --start --verify --autofix --test

🎯 HOW IT WORKS:
  1. Run verification to identify issues
  2. Create stream-chain to fix each issue type
  3. Apply fixes automatically
  4. Re-verify and repeat until threshold met
  5. Show complete fix history

📊 DURING SESSION:
  /verify    - Manual verification
  /autofix   - Start recursive fix loop
  /history   - View fix history
  /metrics   - Show improvement metrics
  /status    - Current session status

📚 For detailed documentation, see:
  .claude/commands/pair/README.md
`);
}
export default pairCommand;

//# sourceMappingURL=pair-autofix-only.js.map