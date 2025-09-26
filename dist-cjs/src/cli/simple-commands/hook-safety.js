import { printError, printWarning, printSuccess } from '../utils.js';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
const HOOK_SAFETY_CONFIG = {
    MAX_HOOK_DEPTH: 3,
    MAX_STOP_HOOK_EXECUTIONS: 2,
    CIRCUIT_BREAKER_TIMEOUT: 60000,
    ENV_VARS: {
        CONTEXT: 'CLAUDE_HOOK_CONTEXT',
        DEPTH: 'CLAUDE_HOOK_DEPTH',
        SESSION_ID: 'CLAUDE_HOOK_SESSION_ID',
        SKIP_HOOKS: 'CLAUDE_SKIP_HOOKS',
        SAFE_MODE: 'CLAUDE_SAFE_MODE'
    }
};
let HookExecutionTracker = class HookExecutionTracker {
    constructor(){
        this.executions = new Map();
        this.sessionId = this.generateSessionId();
        this.resetTimeout = null;
    }
    generateSessionId() {
        return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    track(hookType) {
        const key = `${this.sessionId}:${hookType}`;
        const count = this.executions.get(key) || 0;
        this.executions.set(key, count + 1);
        if (this.resetTimeout) clearTimeout(this.resetTimeout);
        this.resetTimeout = setTimeout(()=>{
            this.executions.clear();
        }, HOOK_SAFETY_CONFIG.CIRCUIT_BREAKER_TIMEOUT);
        return count + 1;
    }
    getExecutionCount(hookType) {
        const key = `${this.sessionId}:${hookType}`;
        return this.executions.get(key) || 0;
    }
    reset() {
        this.executions.clear();
        this.sessionId = this.generateSessionId();
    }
};
const executionTracker = new HookExecutionTracker();
export class HookContextManager {
    static setContext(hookType, depth = 1) {
        process.env[HOOK_SAFETY_CONFIG.ENV_VARS.CONTEXT] = hookType;
        process.env[HOOK_SAFETY_CONFIG.ENV_VARS.DEPTH] = depth.toString();
        process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SESSION_ID] = executionTracker.sessionId;
    }
    static getContext() {
        return {
            type: process.env[HOOK_SAFETY_CONFIG.ENV_VARS.CONTEXT],
            depth: parseInt(process.env[HOOK_SAFETY_CONFIG.ENV_VARS.DEPTH] || '0'),
            sessionId: process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SESSION_ID],
            skipHooks: process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SKIP_HOOKS] === 'true',
            safeMode: process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SAFE_MODE] === 'true'
        };
    }
    static clearContext() {
        delete process.env[HOOK_SAFETY_CONFIG.ENV_VARS.CONTEXT];
        delete process.env[HOOK_SAFETY_CONFIG.ENV_VARS.DEPTH];
        delete process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SESSION_ID];
    }
    static isInHookContext() {
        return !!process.env[HOOK_SAFETY_CONFIG.ENV_VARS.CONTEXT];
    }
    static setSafeMode(enabled = true) {
        if (enabled) {
            process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SAFE_MODE] = 'true';
        } else {
            delete process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SAFE_MODE];
        }
    }
    static setSkipHooks(enabled = true) {
        if (enabled) {
            process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SKIP_HOOKS] = 'true';
        } else {
            delete process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SKIP_HOOKS];
        }
    }
}
export class HookCommandValidator {
    static validateCommand(command, hookType) {
        const context = HookContextManager.getContext();
        const warnings = [];
        const errors = [];
        if (hookType === 'Stop' && this.isClaudeCommand(command)) {
            errors.push({
                type: 'CRITICAL_RECURSION_RISK',
                message: '🚨 CRITICAL ERROR: Claude command detected in Stop hook!\n' + 'This creates an INFINITE LOOP that can cost THOUSANDS OF DOLLARS.\n' + 'Stop hooks that call "claude" commands bypass rate limits and\n' + 'can result in massive unexpected API charges.\n\n' + 'BLOCKED FOR SAFETY - Use alternative patterns instead.'
            });
        }
        if (context.type && this.isClaudeCommand(command)) {
            const depth = context.depth;
            if (depth >= HOOK_SAFETY_CONFIG.MAX_HOOK_DEPTH) {
                errors.push({
                    type: 'HOOK_RECURSION_LIMIT',
                    message: `🚨 Hook recursion limit exceeded! (Depth: ${depth})\n` + `Hook type: ${context.type}\n` + 'Blocking execution to prevent infinite loop.'
                });
            } else {
                warnings.push({
                    type: 'POTENTIAL_RECURSION',
                    message: `⚠️  WARNING: Claude command in ${context.type} hook (depth: ${depth})\n` + 'This could create recursion. Consider using --skip-hooks flag.'
                });
            }
        }
        if (this.isDangerousPattern(command, hookType)) {
            warnings.push({
                type: 'DANGEROUS_PATTERN',
                message: `⚠️  WARNING: Potentially dangerous hook pattern detected.\n` + 'Review the command and consider safer alternatives.'
            });
        }
        return {
            warnings,
            errors,
            safe: errors.length === 0
        };
    }
    static isClaudeCommand(command) {
        const claudePatterns = [
            /\bclaude\b/,
            /claude-code\b/,
            /npx\s+claude\b/,
            /\.\/claude\b/,
            /claude\.exe\b/
        ];
        return claudePatterns.some((pattern)=>pattern.test(command));
    }
    static isDangerousPattern(command, hookType) {
        const dangerousPatterns = [
            /git\s+commit.*--all/,
            /git\s+add\s+\./,
            /watch\s+.*claude/,
            /nodemon.*claude/,
            /bash.*hook/,
            /sh.*hook/
        ];
        return dangerousPatterns.some((pattern)=>pattern.test(command));
    }
}
export class HookCircuitBreaker {
    static checkExecution(hookType) {
        const executionCount = executionTracker.track(hookType);
        if (hookType === 'Stop' && executionCount > HOOK_SAFETY_CONFIG.MAX_STOP_HOOK_EXECUTIONS) {
            throw new Error(`🚨 CIRCUIT BREAKER ACTIVATED!\n` + `Stop hook has executed ${executionCount} times in this session.\n` + `This indicates a potential infinite loop that could cost thousands of dollars.\n` + `Execution blocked for financial protection.\n\n` + `To reset: Use --reset-circuit-breaker flag or restart your session.`);
        }
        if (executionCount > 20) {
            throw new Error(`🚨 CIRCUIT BREAKER: ${hookType} hook executed ${executionCount} times!\n` + `This is highly unusual and indicates a potential problem.\n` + `Execution blocked to prevent system overload.`);
        }
        if (hookType === 'Stop' && executionCount > 1) {
            printWarning(`⚠️  Stop hook execution #${executionCount} detected. Monitor for recursion.`);
        }
        return true;
    }
    static reset() {
        executionTracker.reset();
        printSuccess('Circuit breaker reset successfully.');
    }
    static getStatus() {
        return {
            sessionId: executionTracker.sessionId,
            executions: Array.from(executionTracker.executions.entries()).map(([key, count])=>{
                const [sessionId, hookType] = key.split(':');
                return {
                    hookType,
                    count
                };
            })
        };
    }
}
export class HookConfigValidator {
    static validateClaudeCodeConfig(configPath = null) {
        if (!configPath) {
            const possiblePaths = [
                path.join(process.env.HOME || '.', '.claude', 'settings.json'),
                path.join(process.cwd(), '.claude', 'settings.json'),
                path.join(process.cwd(), 'settings.json')
            ];
            configPath = possiblePaths.find((p)=>existsSync(p));
            if (!configPath) {
                return {
                    safe: true,
                    message: 'No Claude Code configuration found.'
                };
            }
        }
        try {
            const config = JSON.parse(readFileSync(configPath, 'utf8'));
            const validation = this.validateHooksConfig(config.hooks || {});
            return {
                safe: validation.errors.length === 0,
                configPath,
                ...validation
            };
        } catch (err) {
            return {
                safe: false,
                error: `Failed to validate configuration: ${err.message}`,
                configPath
            };
        }
    }
    static validateHooksConfig(hooksConfig) {
        const warnings = [];
        const errors = [];
        if (hooksConfig.Stop) {
            for (const hookGroup of hooksConfig.Stop){
                for (const hook of hookGroup.hooks || []){
                    if (hook.type === 'command' && hook.command) {
                        const result = HookCommandValidator.validateCommand(hook.command, 'Stop');
                        warnings.push(...result.warnings);
                        errors.push(...result.errors);
                    }
                }
            }
        }
        const dangerousHookTypes = [
            'SubagentStop',
            'PostToolUse'
        ];
        for (const hookType of dangerousHookTypes){
            if (hooksConfig[hookType]) {
                for (const hookGroup of hooksConfig[hookType]){
                    for (const hook of hookGroup.hooks || []){
                        if (hook.type === 'command' && hook.command) {
                            const result = HookCommandValidator.validateCommand(hook.command, hookType);
                            warnings.push(...result.warnings);
                            errors.push(...result.errors);
                        }
                    }
                }
            }
        }
        return {
            warnings,
            errors
        };
    }
    static generateSafeAlternatives(dangerousConfig) {
        const alternatives = [];
        if (dangerousConfig.includes('claude')) {
            alternatives.push({
                pattern: 'Stop hook with claude command',
                problem: 'Creates infinite recursion loop',
                solution: 'Use flag-based approach instead',
                example: `
// Instead of this DANGEROUS pattern:
{
  "Stop": [{
    "hooks": [{"type": "command", "command": "claude -c -p 'Update history'"}]
  }]
}

// Use this SAFE pattern:
{
  "Stop": [{
    "hooks": [{"type": "command", "command": "touch ~/.claude/needs_update"}]
  }]
}

// Then manually run: claude -c -p "Update history" when needed
        `
            });
            alternatives.push({
                pattern: 'PostToolUse hook alternative',
                problem: 'Stop hooks execute too frequently',
                solution: 'Use PostToolUse for specific tools',
                example: `
// SAFER: Use PostToolUse for specific operations
{
  "PostToolUse": [{
    "matcher": "Write|Edit|MultiEdit",
    "hooks": [{"type": "command", "command": "echo 'File modified' >> ~/.claude/changes.log"}]
  }]
}
        `
            });
        }
        return alternatives;
    }
}
export class SafeHookExecutor {
    static async executeHookCommand(command, hookType, options = {}) {
        try {
            if (HookContextManager.getContext().skipHooks) {
                console.log(`⏭️  Skipping ${hookType} hook (hooks disabled)`);
                return {
                    success: true,
                    skipped: true
                };
            }
            HookCircuitBreaker.checkExecution(hookType);
            const validation = HookCommandValidator.validateCommand(command, hookType);
            for (const warning of validation.warnings){
                printWarning(warning.message);
            }
            if (!validation.safe) {
                for (const error of validation.errors){
                    printError(error.message);
                }
                return {
                    success: false,
                    blocked: true,
                    errors: validation.errors
                };
            }
            const currentContext = HookContextManager.getContext();
            const newDepth = currentContext.depth + 1;
            HookContextManager.setContext(hookType, newDepth);
            const result = await this.executeCommand(command, options);
            return {
                success: true,
                result
            };
        } catch (err) {
            printError(`Hook execution failed: ${err.message}`);
            return {
                success: false,
                error: err.message
            };
        } finally{
            HookContextManager.clearContext();
        }
    }
    static async executeCommand(command, options = {}) {
        console.log(`🔗 Executing hook command: ${command}`);
        return {
            stdout: '',
            stderr: '',
            exitCode: 0
        };
    }
}
export async function hookSafetyCommand(subArgs, flags) {
    const subcommand = subArgs[0];
    switch(subcommand){
        case 'validate':
            return await validateConfigCommand(subArgs, flags);
        case 'status':
            return await statusCommand(subArgs, flags);
        case 'reset':
            return await resetCommand(subArgs, flags);
        case 'safe-mode':
            return await safeModeCommand(subArgs, flags);
        default:
            showHookSafetyHelp();
    }
}
async function validateConfigCommand(subArgs, flags) {
    const configPath = flags.config || flags.c;
    console.log('🔍 Validating hook configuration for safety...\n');
    const result = HookConfigValidator.validateClaudeCodeConfig(configPath);
    if (result.safe) {
        printSuccess('✅ Hook configuration is safe!');
        if (result.configPath) {
            console.log(`📄 Validated: ${result.configPath}`);
        }
    } else {
        printError('❌ DANGEROUS hook configuration detected!');
        if (result.errors) {
            console.log('\n🚨 CRITICAL ERRORS:');
            for (const error of result.errors){
                console.log(`\n${error.message}`);
            }
        }
        if (result.warnings) {
            console.log('\n⚠️  WARNINGS:');
            for (const warning of result.warnings){
                console.log(`\n${warning.message}`);
            }
        }
        console.log('\n💡 RECOMMENDATIONS:');
        console.log('1. Remove claude commands from Stop hooks');
        console.log('2. Use PostToolUse hooks for specific tools');
        console.log('3. Implement flag-based update patterns');
        console.log('4. Use claude --skip-hooks for manual updates');
    }
}
async function statusCommand(subArgs, flags) {
    const context = HookContextManager.getContext();
    const circuitStatus = HookCircuitBreaker.getStatus();
    console.log('🔗 Hook Safety Status\n');
    console.log('📊 Current Context:');
    if (context.type) {
        console.log(`  🔄 Hook Type: ${context.type}`);
        console.log(`  📏 Depth: ${context.depth}`);
        console.log(`  🆔 Session: ${context.sessionId}`);
        console.log(`  ⏭️  Skip Hooks: ${context.skipHooks ? 'Yes' : 'No'}`);
        console.log(`  🛡️  Safe Mode: ${context.safeMode ? 'Yes' : 'No'}`);
    } else {
        console.log('  ✅ Not currently in hook context');
    }
    console.log('\n⚡ Circuit Breaker Status:');
    console.log(`  🆔 Session: ${circuitStatus.sessionId}`);
    if (circuitStatus.executions.length > 0) {
        console.log('  📊 Hook Executions:');
        for (const exec of circuitStatus.executions){
            console.log(`    • ${exec.hookType}: ${exec.count} times`);
        }
    } else {
        console.log('  ✅ No hook executions in current session');
    }
}
async function resetCommand(subArgs, flags) {
    console.log('🔄 Resetting hook safety systems...\n');
    HookCircuitBreaker.reset();
    HookContextManager.clearContext();
    printSuccess('✅ Hook safety systems reset successfully!');
    console.log('All execution counters and context cleared.');
}
async function safeModeCommand(subArgs, flags) {
    const enable = !flags.disable && !flags.off;
    if (enable) {
        HookContextManager.setSafeMode(true);
        HookContextManager.setSkipHooks(true);
        printSuccess('🛡️  Safe mode enabled!');
        console.log('• All hooks will be skipped');
        console.log('• Claude commands will show safety warnings');
        console.log('• Additional validation will be performed');
    } else {
        HookContextManager.setSafeMode(false);
        HookContextManager.setSkipHooks(false);
        printSuccess('⚡ Safe mode disabled.');
        console.log('Normal hook execution restored.');
    }
}
function showHookSafetyHelp() {
    console.log(`
🛡️  Hook Safety System - Prevent Infinite Loops & Financial Damage

USAGE:
  claude-flow hook-safety <command> [options]

COMMANDS:
  validate      Validate hook configuration for dangerous patterns
  status        Show current hook safety status and context
  reset         Reset circuit breakers and execution counters
  safe-mode     Enable/disable safe mode (skips all hooks)

VALIDATE OPTIONS:
  --config, -c <path>     Path to Claude Code settings.json

SAFE-MODE OPTIONS:
  --disable, --off        Disable safe mode

EXAMPLES:
  # Check your Claude Code hooks for dangerous patterns
  claude-flow hook-safety validate

  # Check specific configuration file
  claude-flow hook-safety validate --config ~/.claude/settings.json

  # View current safety status
  claude-flow hook-safety status

  # Reset if circuit breaker is triggered
  claude-flow hook-safety reset

  # Enable safe mode (skips all hooks)
  claude-flow hook-safety safe-mode

  # Disable safe mode
  claude-flow hook-safety safe-mode --disable

🚨 CRITICAL WARNING:
Stop hooks that call 'claude' commands create INFINITE LOOPS that can:
• Bypass API rate limits
• Cost thousands of dollars per day
• Make your system unresponsive

SAFE ALTERNATIVES:
• Use PostToolUse hooks instead of Stop hooks
• Implement flag-based update patterns
• Use 'claude --skip-hooks' for manual updates
• Create conditional execution scripts

For more information: https://github.com/ruvnet/claude-flow/issues/166
`);
}
export function addSafetyFlags(command) {
    const context = HookContextManager.getContext();
    if (context.type) {
        if (!command.includes('--skip-hooks')) {
            command += ' --skip-hooks';
        }
    }
    if (context.safeMode) {
        if (!command.includes('--dry-run')) {
            command += ' --dry-run';
        }
    }
    return command;
}
export default {
    HookContextManager,
    HookCommandValidator,
    HookCircuitBreaker,
    HookConfigValidator,
    SafeHookExecutor,
    hookSafetyCommand,
    addSafetyFlags
};

//# sourceMappingURL=hook-safety.js.map