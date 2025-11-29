import { execSync } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
export function isNpmCacheError(error) {
    const errorStr = error?.message || String(error);
    return errorStr.includes('ENOTEMPTY') && (errorStr.includes('npm') || errorStr.includes('npx') || errorStr.includes('_npx')) || errorStr.includes('better-sqlite3');
}
export function isWSL() {
    if (process.platform !== 'linux') {
        return false;
    }
    try {
        const release = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
        return release.includes('microsoft') || release.includes('wsl');
    } catch  {
        return false;
    }
}
export async function cleanNpmCache() {
    const homeDir = os.homedir();
    const npxCacheDir = path.join(homeDir, '.npm', '_npx');
    try {
        console.log('🧹 Cleaning npm cache...');
        try {
            execSync('npm cache clean --force', {
                stdio: 'pipe'
            });
            console.log('✅ npm cache cleaned');
        } catch (error) {
            console.warn('⚠️  npm cache clean failed, continuing...');
        }
        if (await fs.pathExists(npxCacheDir)) {
            console.log(`🗑️  Removing npx cache: ${npxCacheDir}`);
            await fs.remove(npxCacheDir);
            console.log('✅ npx cache removed');
        }
        if (isWSL()) {
            const npmDir = path.join(homeDir, '.npm');
            if (await fs.pathExists(npmDir)) {
                try {
                    execSync(`chmod -R 755 "${npmDir}"`, {
                        stdio: 'pipe'
                    });
                    console.log('✅ npm directory permissions fixed');
                } catch (error) {
                    console.warn('⚠️  Permission fix failed, continuing...');
                }
            }
        }
        return {
            success: true,
            action: 'cache-cleanup',
            message: 'npm/npx cache cleaned successfully',
            recovered: true
        };
    } catch (error) {
        return {
            success: false,
            action: 'cache-cleanup',
            message: `Failed to clean cache: ${error instanceof Error ? error.message : String(error)}`,
            recovered: false
        };
    }
}
export async function retryWithRecovery(fn, options = {}) {
    const { maxRetries = 3, delay = 1000, onRetry, cleanupFn } = options;
    let lastError;
    for(let attempt = 1; attempt <= maxRetries; attempt++){
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (isNpmCacheError(error)) {
                console.log(`\n⚠️  Detected npm cache error (attempt ${attempt}/${maxRetries})`);
                const recovery = await cleanNpmCache();
                if (recovery.success) {
                    console.log('✅ Cache cleaned, retrying...\n');
                    if (cleanupFn) {
                        await cleanupFn();
                    }
                    const backoffDelay = delay * Math.pow(2, attempt - 1);
                    await new Promise((resolve)=>setTimeout(resolve, backoffDelay));
                    continue;
                } else {
                    console.error('❌ Cache cleanup failed:', recovery.message);
                }
            }
            if (onRetry && attempt < maxRetries) {
                onRetry(attempt, lastError);
                await new Promise((resolve)=>setTimeout(resolve, delay));
                continue;
            }
            if (attempt === maxRetries) {
                break;
            }
        }
    }
    throw new Error(`Operation failed after ${maxRetries} attempts. ` + `Last error: ${lastError?.message || 'Unknown error'}`);
}
export async function recoverWSLErrors() {
    if (!isWSL()) {
        return {
            success: true,
            action: 'wsl-check',
            message: 'Not running on WSL, no recovery needed',
            recovered: false
        };
    }
    console.log('🔍 Detected WSL environment, applying fixes...');
    try {
        const homeDir = os.homedir();
        const cwd = process.cwd();
        if (cwd.startsWith('/mnt/')) {
            console.warn('⚠️  WARNING: Running from Windows filesystem (/mnt/)');
            console.warn('   For best results, run from WSL filesystem (e.g., ~/projects/)');
        }
        try {
            execSync('which gcc', {
                stdio: 'pipe'
            });
        } catch  {
            console.warn('⚠️  build-essential not found. Install with:');
            console.warn('   sudo apt-get update && sudo apt-get install -y build-essential python3');
        }
        return await cleanNpmCache();
    } catch (error) {
        return {
            success: false,
            action: 'wsl-recovery',
            message: `WSL recovery failed: ${error instanceof Error ? error.message : String(error)}`,
            recovered: false
        };
    }
}
export async function verifyBetterSqlite3() {
    try {
        require.resolve('better-sqlite3');
        return true;
    } catch  {
        return false;
    }
}
export async function installBetterSqlite3WithRecovery() {
    console.log('📦 Installing better-sqlite3...');
    return retryWithRecovery(async ()=>{
        execSync('npm install better-sqlite3 --no-save', {
            stdio: 'inherit',
            cwd: process.cwd()
        });
        if (await verifyBetterSqlite3()) {
            return {
                success: true,
                action: 'install-sqlite',
                message: 'better-sqlite3 installed successfully',
                recovered: true
            };
        } else {
            throw new Error('Installation completed but module not found');
        }
    }, {
        maxRetries: 3,
        delay: 2000,
        onRetry: (attempt, error)=>{
            console.log(`⚠️  Install attempt ${attempt} failed: ${error.message}`);
            console.log('🔄 Cleaning cache and retrying...');
        }
    });
}
export async function recoverInitErrors(error) {
    console.log('\n🚨 Error detected during initialization');
    console.log(`   Error: ${error?.message || String(error)}\n`);
    if (isWSL()) {
        console.log('🔧 Applying WSL-specific fixes...');
        const wslRecovery = await recoverWSLErrors();
        if (!wslRecovery.success) {
            return wslRecovery;
        }
    }
    if (isNpmCacheError(error)) {
        console.log('🔧 Detected npm cache error, attempting recovery...');
        const cacheRecovery = await cleanNpmCache();
        if (!cacheRecovery.success) {
            return cacheRecovery;
        }
        if (!await verifyBetterSqlite3()) {
            console.log('🔧 better-sqlite3 missing, attempting reinstall...');
            return await installBetterSqlite3WithRecovery();
        }
        return {
            success: true,
            action: 'error-recovery',
            message: 'Cache cleaned and dependencies verified',
            recovered: true
        };
    }
    return {
        success: false,
        action: 'error-recovery',
        message: `Unable to automatically recover from error: ${error?.message || String(error)}`,
        recovered: false
    };
}
export const errorRecovery = {
    isNpmCacheError,
    isWSL,
    cleanNpmCache,
    retryWithRecovery,
    recoverWSLErrors,
    verifyBetterSqlite3,
    installBetterSqlite3WithRecovery,
    recoverInitErrors
};

//# sourceMappingURL=error-recovery.js.map