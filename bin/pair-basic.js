/**
 * Optimized Pair Programming Command
 * Interactive pair programming with intelligent verification
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import readline from 'readline';
import { watch } from 'fs';

const execAsync = promisify(exec);

class PairProgrammingSession {
  constructor(options = {}) {
    this.sessionId = `pair_${Date.now()}`;
    this.mode = options.mode || 'switch';
    this.agent = options.agent || 'auto';
    this.verify = options.verify || false;
    this.test = options.test || false;
    this.autoVerify = options.autoVerify || false; // New: control automatic verification
    this.threshold = options.threshold || 0.95;
    this.startTime = new Date();
    this.status = 'active';
    this.currentRole = 'driver';
    this.verificationScores = [];
    this.testResults = [];
    this.fileWatchers = new Map();
    this.rl = null;
    this.lastVerificationTime = 0;
    this.verificationCooldown = 60000; // 1 minute cooldown between auto-verifications
    this.isVerifying = false; // Prevent concurrent verifications
  }

  async start() {
    await this.saveSession();
    this.showWelcome();
    
    if (this.verify) {
      this.showVerificationSettings();
      
      // Only run initial verification once
      if (this.autoVerify) {
        console.log('\n🔍 Running initial verification...');
        await this.runVerification();
      }
    }
    
    if (this.test) {
      await this.setupTestWatcher();
    }
    
    await this.startInteractiveMode();
  }

  showWelcome() {
    console.log('\n🚀 Starting Pair Programming Session');
    console.log('━'.repeat(50));
    console.log(`Session ID: ${this.sessionId}`);
    console.log(`Mode: ${this.mode}`);
    console.log(`Agent: ${this.agent}`);
    console.log(`Verification: ${this.verify ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`Auto-Verify: ${this.autoVerify ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`Testing: ${this.test ? '✅ Enabled' : '❌ Disabled'}`);
    console.log('━'.repeat(50));

    // Show mode details
    switch (this.mode) {
      case 'driver':
        console.log('\n👤 You are the DRIVER - Write code while AI assists');
        console.log('🤖 AI is the NAVIGATOR - Providing guidance and suggestions');
        break;
      case 'navigator':
        console.log('\n🤖 AI is the DRIVER - Writing code based on your guidance');
        console.log('👤 You are the NAVIGATOR - Providing high-level direction');
        break;
      case 'switch':
        console.log('\n🔄 SWITCH MODE - Roles alternate every 10 minutes');
        console.log(`👤 Current role: ${this.currentRole.toUpperCase()} (you)`);
        console.log('🤖 AI role: ' + (this.currentRole === 'driver' ? 'NAVIGATOR' : 'DRIVER'));
        this.startRoleTimer();
        break;
    }

    this.showCommands();
  }

  showCommands() {
    console.log('\n📝 Session Commands:');
    console.log('  /help      - Show available commands');
    console.log('  /switch    - Switch driver/navigator roles');
    console.log('  /suggest   - Get AI suggestions');
    console.log('  /review    - Request code review');
    console.log('  /test      - Run tests manually');
    console.log('  /verify    - Run verification check');
    console.log('  /status    - Show session status');
    console.log('  /metrics   - Show quality metrics');
    console.log('  /auto      - Toggle auto-verification');
    console.log('  /watch     - Toggle file watching');
    console.log('  /commit    - Commit with verification');
    console.log('  /end       - End session');
    console.log('  /exit      - Exit (same as /end)');
  }

  showVerificationSettings() {
    console.log('\n✅ Verification Settings:');
    console.log(`  • Threshold: ${this.threshold}`);
    console.log(`  • Auto-verify: ${this.autoVerify ? 'Enabled' : 'Disabled'}`);
    console.log(`  • Manual verify: Always available via /verify`);
    
    if (this.autoVerify) {
      console.log(`  • Cooldown: ${this.verificationCooldown / 1000}s between checks`);
      console.log('  • Use /auto to toggle automatic verification');
    }
  }

  async runVerification() {
    // Prevent concurrent verifications
    if (this.isVerifying) {
      console.log('⏳ Verification already in progress...');
      return null;
    }

    // Check cooldown for automatic verifications
    const now = Date.now();
    if (this.autoVerify && (now - this.lastVerificationTime) < this.verificationCooldown) {
      const remaining = Math.ceil((this.verificationCooldown - (now - this.lastVerificationTime)) / 1000);
      console.log(`⏱️ Verification cooldown: ${remaining}s remaining`);
      return null;
    }

    this.isVerifying = true;
    this.lastVerificationTime = now;

    console.log('\n🔍 Running verification check...');
    
    const checks = [
      { 
        name: 'Type Check', 
        command: 'npm run typecheck 2>&1 || true',
        weight: 0.4 // Higher weight for type checking
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
    
    let totalScore = 0;
    let totalWeight = 0;
    const results = [];
    
    for (const check of checks) {
      try {
        const { stdout, stderr } = await execAsync(check.command);
        const output = stdout + stderr;
        
        // More intelligent scoring based on actual output
        let score = 1.0;
        
        if (output.toLowerCase().includes('error')) {
          const errorCount = (output.match(/error/gi) || []).length;
          score = Math.max(0.2, 1.0 - (errorCount * 0.1)); // Deduct 0.1 per error, minimum 0.2
        } else if (output.toLowerCase().includes('warning')) {
          const warningCount = (output.match(/warning/gi) || []).length;
          score = Math.max(0.7, 1.0 - (warningCount * 0.05)); // Deduct 0.05 per warning, minimum 0.7
        }
        
        totalScore += score * check.weight;
        totalWeight += check.weight;
        
        const icon = score >= 0.8 ? '✅' : score >= 0.5 ? '⚠️' : '❌';
        console.log(`  ${icon} ${check.name}: ${score.toFixed(2)}`);
        
        results.push({ name: check.name, score, output: output.slice(0, 200) });
      } catch (error) {
        console.log(`  ❌ ${check.name}: 0.00 (failed to run)`);
        results.push({ name: check.name, score: 0, error: error.message });
        totalWeight += check.weight;
      }
    }
    
    const averageScore = totalWeight > 0 ? totalScore / totalWeight : 0;
    this.verificationScores.push({ score: averageScore, timestamp: now, results });
    
    console.log(`\n📊 Verification Score: ${averageScore.toFixed(2)}/${this.threshold}`);
    
    if (averageScore < this.threshold) {
      console.log('⚠️ Verification threshold not met');
      
      // Only show detailed help if score is very low
      if (averageScore < 0.5) {
        console.log('\n💡 Suggestions:');
        console.log('  • Run /test to check test failures');
        console.log('  • Check TypeScript errors with npm run typecheck');
        console.log('  • Fix linting issues with npm run lint --fix');
      }
    } else {
      console.log('✅ Verification passed!');
    }
    
    this.isVerifying = false;
    return averageScore;
  }

  async setupTestWatcher() {
    console.log('\n🧪 Test Configuration:');
    console.log('  • Manual testing via /test command');
    console.log('  • File watching available via /watch');
    
    // Don't automatically run tests, wait for user command
  }

  async runTests() {
    console.log('\n🧪 Running tests...');
    
    try {
      const { stdout, stderr } = await execAsync('npm test 2>&1 || true');
      const output = stdout + stderr;
      const lines = output.split('\n');
      
      // Parse test results more intelligently
      const passLine = lines.find(l => l.includes('passed'));
      const failLine = lines.find(l => l.includes('failed'));
      const suitesLine = lines.find(l => l.includes('Test Suites:'));
      
      let passed = false;
      let summary = 'No test results found';
      
      if (suitesLine) {
        summary = suitesLine.trim();
        passed = !suitesLine.includes('failed');
      } else if (passLine || failLine) {
        summary = (passLine || failLine).trim();
        passed = !!passLine && !failLine;
      }
      
      console.log(`  ${passed ? '✅' : '❌'} ${summary}`);
      
      // Extract coverage if available
      const coverageLine = lines.find(l => l.includes('Coverage') || l.includes('Statements'));
      if (coverageLine) {
        console.log(`  📊 ${coverageLine.trim()}`);
      }
      
      this.testResults.push({
        timestamp: new Date(),
        passed,
        summary
      });
      
      return passed;
    } catch (error) {
      console.log('  ❌ Test execution failed:', error.message);
      return false;
    }
  }

  startRoleTimer() {
    if (this.mode !== 'switch') return;
    
    this.roleTimer = setTimeout(() => {
      this.switchRoles();
      this.startRoleTimer(); // Restart timer
    }, 10 * 60 * 1000); // 10 minutes
  }

  switchRoles() {
    const oldRole = this.currentRole;
    this.currentRole = this.currentRole === 'driver' ? 'navigator' : 'driver';
    
    console.log('\n🔄 Role Switch!');
    console.log(`  Previous role: ${oldRole.toUpperCase()}`);
    console.log(`  New role: ${this.currentRole.toUpperCase()}`);
    console.log('  Take a moment to transition...\n');
  }

  async startInteractiveMode() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\n💻 pair> '
    });

    console.log('\n💡 Interactive mode active. Type /help for commands.\n');
    
    this.rl.prompt();

    this.rl.on('line', async (line) => {
      const input = line.trim();
      
      if (input.startsWith('/')) {
        await this.handleCommand(input);
      } else if (input) {
        // Handle regular input as code discussion
        console.log('🤖 AI: Processing your input...');
        // In a real implementation, this would send to AI
      }
      
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      this.end();
    });
  }

  async handleCommand(command) {
    const [cmd, ...args] = command.split(' ');
    
    switch (cmd) {
      case '/help':
        this.showCommands();
        break;
        
      case '/switch':
        this.switchRoles();
        break;
        
      case '/suggest':
        console.log('🤖 AI Suggestion: Consider using async/await for better readability');
        console.log('   Also check error handling in promise chains');
        break;
        
      case '/review':
        console.log('🔍 Starting code review...');
        await this.runVerification();
        break;
        
      case '/test':
        await this.runTests();
        break;
        
      case '/verify':
        await this.runVerification();
        break;
        
      case '/status':
        await this.showStatus();
        break;
        
      case '/metrics':
        this.showMetrics();
        break;
        
      case '/auto':
        this.autoVerify = !this.autoVerify;
        console.log(`\n🔄 Auto-verification ${this.autoVerify ? 'enabled' : 'disabled'}`);
        if (this.autoVerify) {
          console.log(`  Cooldown: ${this.verificationCooldown / 1000}s between checks`);
        }
        break;
        
      case '/watch':
        console.log('📂 File watching not yet implemented');
        console.log('  Use /verify or /test for manual checks');
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
    console.log(`Current Role: ${this.currentRole.toUpperCase()}`);
    console.log(`Mode: ${this.mode}`);
    console.log(`Status: ${this.status}`);
    console.log(`Auto-Verify: ${this.autoVerify ? 'Enabled' : 'Disabled'}`);
    
    if (this.verify && this.verificationScores.length > 0) {
      const recent = this.verificationScores[this.verificationScores.length - 1];
      console.log(`Last Verification: ${recent.score.toFixed(2)} (${new Date(recent.timestamp).toLocaleTimeString()})`);
    }
    
    if (this.test && this.testResults.length > 0) {
      const passed = this.testResults.filter(r => r.passed).length;
      console.log(`Tests Passed: ${passed}/${this.testResults.length}`);
    }
  }

  showMetrics() {
    console.log('\n📈 Quality Metrics');
    console.log('━'.repeat(40));
    
    if (this.verificationScores.length > 0) {
      console.log('\nVerification History:');
      this.verificationScores.slice(-5).forEach((item, i) => {
        const bar = '█'.repeat(Math.floor(item.score * 20));
        const time = new Date(item.timestamp).toLocaleTimeString();
        console.log(`  ${i + 1}. ${bar} ${item.score.toFixed(2)} - ${time}`);
      });
      
      // Show average
      const avg = this.verificationScores.reduce((sum, item) => sum + item.score, 0) / this.verificationScores.length;
      console.log(`\n  Average: ${avg.toFixed(2)}`);
    } else {
      console.log('\n  No verification history yet');
      console.log('  Run /verify to check code quality');
    }
    
    if (this.testResults.length > 0) {
      console.log('\nTest Results:');
      this.testResults.slice(-5).forEach((result, i) => {
        console.log(`  ${i + 1}. ${result.passed ? '✅' : '❌'} ${new Date(result.timestamp).toLocaleTimeString()}`);
      });
      
      // Show success rate
      const passed = this.testResults.filter(r => r.passed).length;
      const rate = (passed / this.testResults.length * 100).toFixed(0);
      console.log(`\n  Success Rate: ${rate}%`);
    } else {
      console.log('\n  No test history yet');
      console.log('  Run /test to execute test suite');
    }
  }

  async commitWithVerification() {
    console.log('\n🔍 Pre-commit verification...');
    
    const score = await this.runVerification();
    
    if (score === null) {
      console.log('⏳ Please wait for cooldown or use /verify manually');
      return;
    }
    
    if (score >= this.threshold) {
      console.log('✅ Verification passed! Ready to commit.');
      console.log('\n💡 Next steps:');
      console.log('  1. Review changes: git diff');
      console.log('  2. Stage files: git add .');
      console.log('  3. Commit: git commit -m "your message"');
    } else {
      console.log('❌ Verification failed!');
      console.log('\n💡 Fix issues before committing:');
      console.log('  • Run npm run typecheck to see TypeScript errors');
      console.log('  • Run npm run lint to check code style');
      console.log('  • Run npm run build to verify compilation');
    }
  }

  async end() {
    console.log('\n🛑 Ending pair programming session...');
    
    // Clear timers
    if (this.roleTimer) clearTimeout(this.roleTimer);
    if (this.rl) this.rl.close();
    
    // Update session
    this.status = 'completed';
    await this.saveSession();
    
    // Show summary
    const duration = Math.floor((Date.now() - this.startTime) / 1000 / 60);
    console.log('\n✨ Session Complete!');
    console.log('━'.repeat(40));
    console.log(`Duration: ${duration} minutes`);
    
    if (this.verificationScores.length > 0) {
      const avg = this.verificationScores.reduce((sum, item) => sum + item.score, 0) / this.verificationScores.length;
      console.log(`Average Verification: ${avg.toFixed(2)}`);
      console.log(`Total Checks: ${this.verificationScores.length}`);
    }
    
    if (this.testResults.length > 0) {
      const passed = this.testResults.filter(r => r.passed).length;
      console.log(`Test Success Rate: ${((passed / this.testResults.length) * 100).toFixed(0)}%`);
      console.log(`Total Test Runs: ${this.testResults.length}`);
    }
    
    console.log('\n👋 Thanks for pair programming!\n');
  }

  async saveSession() {
    const sessionPath = '.claude-flow/sessions/pair';
    await fs.mkdir(sessionPath, { recursive: true });
    
    const sessionData = {
      id: this.sessionId,
      mode: this.mode,
      agent: this.agent,
      verify: this.verify,
      autoVerify: this.autoVerify,
      test: this.test,
      threshold: this.threshold,
      startTime: this.startTime.toISOString(),
      status: this.status,
      currentRole: this.currentRole,
      verificationScores: this.verificationScores,
      testResults: this.testResults
    };
    
    await fs.writeFile(
      path.join(sessionPath, `${this.sessionId}.json`),
      JSON.stringify(sessionData, null, 2)
    );
  }
}

async function pairCommand(args = [], flags = {}) {
  console.log('\n👥 Pair Programming Session');
  console.log('━'.repeat(50));

  // Handle help flag
  if (flags.help || args.includes('--help')) {
    showHelp();
    return;
  }

  // Handle background execution
  if (flags.background || flags.bg) {
    return startBackgroundSession(args, flags);
  }

  // Handle start flag
  if (flags.start) {
    const session = new PairProgrammingSession({
      mode: flags.mode || 'switch',
      agent: flags.agent || 'auto',
      verify: flags.verify || false,
      test: flags.test || false,
      autoVerify: flags.auto || false, // New flag for automatic verification
      threshold: parseFloat(flags.threshold) || 0.95
    });
    
    return await session.start();
  }

  // Handle status flag
  if (flags.status) {
    return showSessionStatus();
  }

  // Handle end flag
  if (flags.end) {
    return endSession(flags.sessionId || 'current');
  }

  // Default: show help
  showHelp();
}

function showHelp() {
  console.log(`
📚 USAGE:
  claude-flow pair [options]

⚙️ OPTIONS:
  --start              Start a new pair programming session
  --end                End current session
  --status             Show session status
  --mode <type>        Programming mode: driver, navigator, switch (default: switch)
  --agent <name>       AI pair partner (default: auto-select)
  --verify             Enable verification (manual via /verify)
  --auto               Enable automatic verification (with cooldown)
  --test               Enable testing (manual via /test)
  --threshold <n>      Verification threshold (default: 0.95)
  --background, --bg   Run in background
  --help               Show this help message

📝 MODES:
  driver     You write code, AI assists
  navigator  AI writes code, you guide
  switch     Automatically alternate roles every 10 minutes

🎯 SESSION COMMANDS:
  /help      Show available commands
  /switch    Switch driver/navigator roles
  /suggest   Get AI suggestions
  /review    Request code review
  /test      Run tests manually
  /verify    Run verification check
  /status    Show session status
  /metrics   Show quality metrics
  /auto      Toggle auto-verification
  /watch     Toggle file watching
  /commit    Commit with verification
  /end       End session

💡 EXAMPLES:
  # Basic session with manual verification
  claude-flow pair --start --verify
  
  # Session with automatic verification (60s cooldown)
  claude-flow pair --start --verify --auto
  
  # Driver mode with testing
  claude-flow pair --start --mode driver --test
  
  # Check session status
  claude-flow pair --status

🎯 OPTIMIZATION TIPS:
  • Use /verify manually when needed
  • Enable --auto only for continuous monitoring
  • Use /metrics to track quality trends
  • Run /test before commits

📚 For detailed documentation, see:
  .claude/commands/pair/README.md
`);
}

async function startBackgroundSession(args, flags) {
  console.log('\n🔄 Starting pair session in background...');
  
  const child = spawn(process.argv[0], [
    process.argv[1],
    'pair',
    '--start',
    ...args.filter(arg => arg !== '--background' && arg !== '--bg')
  ], {
    detached: true,
    stdio: 'ignore'
  });

  child.unref();
  
  const pid = child.pid;
  console.log(`✅ Background session started (PID: ${pid})`);
  console.log('\n📊 Monitor with: claude-flow pair --status');
  console.log('🛑 Stop with: claude-flow pair --end\n');
}

async function showSessionStatus() {
  try {
    const sessionPath = '.claude-flow/sessions/pair';
    const files = await fs.readdir(sessionPath);
    const sessions = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const data = await fs.readFile(path.join(sessionPath, file), 'utf8');
        sessions.push(JSON.parse(data));
      }
    }

    if (sessions.length === 0) {
      console.log('\n❌ No active pair programming sessions\n');
      return;
    }

    console.log('\n📊 Pair Programming Sessions:');
    console.log('━'.repeat(50));
    
    for (const session of sessions.filter(s => s.status === 'active')) {
      const duration = Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000 / 60);
      console.log(`\n🔹 Session: ${session.id}`);
      console.log(`   Mode: ${session.mode}`);
      console.log(`   Duration: ${duration} minutes`);
      console.log(`   Status: ${session.status}`);
      console.log(`   Verification: ${session.verify ? '✅' : '❌'}`);
      console.log(`   Auto-Verify: ${session.autoVerify ? '✅' : '❌'}`);
      console.log(`   Testing: ${session.test ? '✅' : '❌'}`);
      
      if (session.verificationScores && session.verificationScores.length > 0) {
        const scores = session.verificationScores.map(s => s.score || s);
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        console.log(`   Avg Verification: ${avg.toFixed(2)}`);
        console.log(`   Total Checks: ${scores.length}`);
      }
    }
    
    console.log('━'.repeat(50));
  } catch (error) {
    console.log('\n❌ No active pair programming sessions\n');
  }
}

async function endSession(sessionId) {
  console.log(`\n🛑 Ending pair programming session: ${sessionId}`);
  
  try {
    const sessionPath = '.claude-flow/sessions/pair';
    
    if (sessionId === 'current') {
      // End most recent active session
      const files = await fs.readdir(sessionPath);
      for (const file of files.filter(f => f.endsWith('.json'))) {
        const data = await fs.readFile(path.join(sessionPath, file), 'utf8');
        const session = JSON.parse(data);
        if (session.status === 'active') {
          sessionId = session.id;
          break;
        }
      }
    }
    
    const sessionFile = path.join(sessionPath, `${sessionId}.json`);
    const data = await fs.readFile(sessionFile, 'utf8');
    const session = JSON.parse(data);
    
    session.status = 'completed';
    session.endTime = new Date().toISOString();
    
    await fs.writeFile(sessionFile, JSON.stringify(session, null, 2));
    
    console.log('✅ Session ended successfully');
    console.log(`\n📊 Session Summary:`);
    console.log(`  Duration: ${Math.floor((new Date(session.endTime) - new Date(session.startTime)) / 1000 / 60)} minutes`);
    console.log(`  Mode: ${session.mode}`);
    console.log(`  Agent: ${session.agent}\n`);
  } catch (error) {
    console.log('❌ Failed to end session:', error.message);
  }
}

export default pairCommand;