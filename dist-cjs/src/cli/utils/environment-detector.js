import chalk from 'chalk';
export function detectExecutionEnvironment(options = {}) {
    const env = {
        isInteractive: false,
        isVSCode: false,
        isVSCodeInsiders: false,
        isCI: false,
        isDocker: false,
        isSSH: false,
        isGitBash: false,
        isWindowsTerminal: false,
        isWSL: false,
        isWindows: false,
        supportsRawMode: false,
        supportsColor: true,
        terminalType: 'unknown',
        recommendedFlags: [],
        warnings: []
    };
    env.isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const termProgram = process.env.TERM_PROGRAM?.toLowerCase() || '';
    env.isVSCode = termProgram === 'vscode';
    env.isVSCodeInsiders = termProgram === 'vscode-insiders';
    env.terminalType = termProgram || process.env.TERM || 'unknown';
    env.isCI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI || process.env.JENKINS_URL || process.env.CIRCLECI || process.env.TRAVIS || process.env.BUILDKITE || process.env.DRONE);
    env.isDocker = Boolean(process.env.DOCKER_CONTAINER || existsSync('/.dockerenv') || existsSync('/proc/1/cgroup') && readFileSync('/proc/1/cgroup', 'utf8').includes('docker'));
    env.isSSH = Boolean(process.env.SSH_CLIENT || process.env.SSH_TTY);
    env.isGitBash = process.env.TERM_PROGRAM === 'mintty' || process.env.MSYSTEM?.startsWith('MINGW') || false;
    env.isWindowsTerminal = Boolean(process.env.WT_SESSION);
    env.isWindows = process.platform === 'win32';
    env.isWSL = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP || existsSync('/proc/version') && readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft'));
    env.supportsRawMode = checkRawModeSupport();
    env.supportsColor = process.env.NO_COLOR !== '1' && process.env.TERM !== 'dumb' && (process.stdout.isTTY || process.env.FORCE_COLOR === '1');
    generateRecommendations(env);
    if (!options.skipWarnings && env.warnings.length > 0) {
        showEnvironmentWarnings(env);
    }
    return env;
}
function checkRawModeSupport() {
    try {
        if (!process.stdin.isTTY) return false;
        if (typeof process.stdin.setRawMode !== 'function') return false;
        const originalRawMode = process.stdin.isRaw;
        process.stdin.setRawMode(true);
        process.stdin.setRawMode(originalRawMode);
        return true;
    } catch  {
        return false;
    }
}
function generateRecommendations(env) {
    if (env.isVSCode || env.isVSCodeInsiders) {
        env.recommendedFlags.push('--dangerously-skip-permissions');
        env.recommendedFlags.push('--non-interactive');
        env.warnings.push('VS Code integrated terminal detected - interactive features may be limited');
    }
    if (env.isCI) {
        env.recommendedFlags.push('--dangerously-skip-permissions');
        env.recommendedFlags.push('--non-interactive');
        env.recommendedFlags.push('--json');
        env.warnings.push('CI environment detected - running in non-interactive mode');
    }
    if (env.isDocker && !env.isInteractive) {
        env.recommendedFlags.push('--dangerously-skip-permissions');
        env.recommendedFlags.push('--non-interactive');
        env.warnings.push('Docker container without TTY - interactive features disabled');
    }
    if (env.isSSH && !env.isInteractive) {
        env.recommendedFlags.push('--dangerously-skip-permissions');
        env.warnings.push('SSH session without TTY - consider using ssh -t');
    }
    if (env.isGitBash) {
        env.warnings.push('Git Bash detected - some interactive features may not work correctly');
    }
    if (env.isWSL) {
        env.recommendedFlags.push('--no-interactive');
        env.warnings.push('WSL detected - raw mode may cause hangs, using non-interactive mode');
        if (!env.supportsRawMode) {
            env.warnings.push('WSL subprocess context detected - interactive features disabled');
        }
    }
    if (env.isWindows && !env.isWSL) {
        env.recommendedFlags.push('--compatible-ui');
        env.warnings.push('Native Windows detected - using compatible UI mode');
    }
    if (!env.supportsRawMode && env.isInteractive) {
        env.recommendedFlags.push('--compatible-ui');
        env.warnings.push('Terminal does not support raw mode - using compatible UI');
    }
}
function showEnvironmentWarnings(env) {
    if (env.warnings.length === 0) return;
    console.log(chalk.yellow('\n⚠️  Environment Detection:'));
    env.warnings.forEach((warning)=>{
        console.log(chalk.gray(`   • ${warning}`));
    });
    if (env.recommendedFlags.length > 0) {
        console.log(chalk.cyan('\n💡 Recommended flags for your environment:'));
        console.log(chalk.gray(`   ${env.recommendedFlags.join(' ')}`));
    }
    console.log();
}
export function applySmartDefaults(options, env) {
    const environment = env || detectExecutionEnvironment({
        skipWarnings: true
    });
    const appliedDefaults = [];
    const enhanced = {
        ...options,
        appliedDefaults
    };
    if ((environment.isVSCode || environment.isCI || !environment.supportsRawMode) && !options.hasOwnProperty('skipPermissions')) {
        enhanced.skipPermissions = true;
        enhanced.dangerouslySkipPermissions = true;
        appliedDefaults.push('--dangerously-skip-permissions');
    }
    if ((environment.isCI || !environment.isInteractive) && !options.hasOwnProperty('nonInteractive')) {
        enhanced.nonInteractive = true;
        appliedDefaults.push('--non-interactive');
    }
    if (environment.isCI && !options.hasOwnProperty('json')) {
        enhanced.json = true;
        appliedDefaults.push('--json');
    }
    if (!environment.supportsColor && !options.hasOwnProperty('noColor')) {
        enhanced.noColor = true;
        appliedDefaults.push('--no-color');
    }
    if (options.verbose && appliedDefaults.length > 0) {
        console.log(chalk.gray(`ℹ️  Auto-applied flags: ${appliedDefaults.join(' ')}`));
    }
    return enhanced;
}
export function getEnvironmentDescription(env) {
    const environment = env || detectExecutionEnvironment({
        skipWarnings: true
    });
    const parts = [];
    if (environment.isVSCode) parts.push('VS Code');
    if (environment.isCI) parts.push('CI');
    if (environment.isDocker) parts.push('Docker');
    if (environment.isSSH) parts.push('SSH');
    if (environment.isGitBash) parts.push('Git Bash');
    if (environment.isWindowsTerminal) parts.push('Windows Terminal');
    if (environment.isWSL) parts.push('WSL');
    if (environment.isWindows && !environment.isWSL) parts.push('Windows');
    if (parts.length === 0) {
        parts.push(environment.terminalType);
    }
    const features = [];
    if (environment.isInteractive) features.push('interactive');
    if (environment.supportsRawMode) features.push('raw mode');
    if (environment.supportsColor) features.push('color');
    return `${parts.join('/')} (${features.join(', ')})`;
}
export function shouldUseNonInteractiveMode(options) {
    if (options?.force) return true;
    const env = detectExecutionEnvironment({
        skipWarnings: true
    });
    return !env.isInteractive || env.isCI || env.isVSCode || env.isWSL || env.isWindows || !env.supportsRawMode;
}
function existsSync(path) {
    try {
        require('fs').accessSync(path);
        return true;
    } catch  {
        return false;
    }
}
function readFileSync(path, encoding) {
    try {
        return require('fs').readFileSync(path, encoding);
    } catch  {
        return '';
    }
}
export default {
    detectExecutionEnvironment,
    applySmartDefaults,
    getEnvironmentDescription,
    shouldUseNonInteractiveMode
};

//# sourceMappingURL=environment-detector.js.map