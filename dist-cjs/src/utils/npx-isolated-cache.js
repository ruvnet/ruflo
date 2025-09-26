#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cacheDirectories = new Set();
let cleanupRegistered = false;
export function createIsolatedCache() {
    const timestamp = Date.now();
    const pid = process.pid;
    const random = Math.random().toString(36).substring(2, 8);
    const cacheName = `claude-flow-${pid}-${timestamp}-${random}`;
    const cacheDir = path.join(os.tmpdir(), '.npm-cache', cacheName);
    cacheDirectories.add(cacheDir);
    if (!cleanupRegistered) {
        registerCleanup();
        cleanupRegistered = true;
    }
    const baseEnv = typeof Deno !== 'undefined' && Deno.env ? Deno.env.toObject() : process.env;
    return {
        ...baseEnv,
        NPM_CONFIG_CACHE: cacheDir,
        npm_config_cache: cacheDir
    };
}
export function getIsolatedNpxEnv(additionalEnv = {}) {
    const isolatedEnv = createIsolatedCache();
    return {
        ...isolatedEnv,
        ...additionalEnv
    };
}
async function cleanupCaches() {
    const cleanupPromises = Array.from(cacheDirectories).map(async (cacheDir)=>{
        try {
            await fs.rm(cacheDir, {
                recursive: true,
                force: true
            });
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.debug(`Failed to cleanup cache ${cacheDir}:`, error.message);
            }
        }
    });
    await Promise.all(cleanupPromises);
    cacheDirectories.clear();
}
function registerCleanup() {
    process.on('exit', ()=>{
        for (const cacheDir of cacheDirectories){
            try {
                require('fs').rmSync(cacheDir, {
                    recursive: true,
                    force: true
                });
            } catch (error) {}
        }
    });
    const signals = [
        'SIGINT',
        'SIGTERM',
        'SIGUSR1',
        'SIGUSR2'
    ];
    signals.forEach((signal)=>{
        process.on(signal, async ()=>{
            await cleanupCaches();
            process.exit();
        });
    });
    process.on('uncaughtException', async (error)=>{
        console.error('Uncaught exception:', error);
        await cleanupCaches();
        process.exit(1);
    });
    process.on('unhandledRejection', async (reason, promise)=>{
        console.error('Unhandled rejection at:', promise, 'reason:', reason);
        await cleanupCaches();
        process.exit(1);
    });
}
export async function cleanupAllCaches() {
    await cleanupCaches();
}
if (import.meta.url === `file://${process.argv[1]}`) {
    const command = process.argv[2];
    if (command === 'test') {
        console.log('Testing isolated cache creation...');
        const env = createIsolatedCache();
        console.log('Cache directory:', env.NPM_CONFIG_CACHE);
        console.log('Environment configured successfully');
        await cleanupAllCaches();
        console.log('Cleanup completed');
    } else {
        console.log('NPX Isolated Cache Utility');
        console.log('Usage: node npx-isolated-cache.js test');
    }
}

//# sourceMappingURL=npx-isolated-cache.js.map