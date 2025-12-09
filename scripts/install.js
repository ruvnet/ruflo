#!/usr/bin/env node

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import { spawn, exec } from 'node:child_process';

console.log('Installing Claude-Flow...');

// Check if Deno is available
function checkDeno() {
  return new Promise((resolve) => {
    const deno = spawn('deno', ['--version'], { stdio: 'pipe' });
    deno.on('close', (code) => {
      resolve(code === 0);
    });
    deno.on('error', () => {
      resolve(false);
    });
  });
}

// Check if better-sqlite3 bindings are working
async function checkSqliteBindings() {
  try {
    // Try to import and use better-sqlite3
    const Database = await import('better-sqlite3');
    try {
      const db = new Database.default(':memory:');
      db.close();
      return true;
    } catch (error) {
      console.log('SQLite bindings test failed:', error.message);
      return false;
    }
  } catch (error) {
    console.log('SQLite module import failed:', error.message);
    return false;
  }
}

// Rebuild better-sqlite3 for ARM64
function rebuildSqlite() {
  return new Promise((resolve) => {
    console.log('Detected ARM64 architecture, attempting to rebuild better-sqlite3...');
    
    const npmRebuild = spawn('npm', ['rebuild', 'better-sqlite3'], { 
      stdio: 'inherit',
      shell: true
    });
    
    npmRebuild.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Successfully rebuilt better-sqlite3 for ARM64');
        resolve();
      } else {
        console.log('⚠️  Failed to rebuild better-sqlite3, will use in-memory fallback');
        resolve(); // Intentional: fallback to in-memory usage
      }
    });
    
    npmRebuild.on('error', (error) => {
      console.log('⚠️  Could not rebuild better-sqlite3:', error.message);
      resolve(); // Intentional: fallback to in-memory usage
    });
  });
}

// Install Deno if not available
async function installDeno() {
  console.log('Deno not found. Installing Deno...');
  
  const platform = os.platform();
  
  if (platform === 'win32') {
    return new Promise((resolve, reject) => {
      console.log('Installing Deno on Windows using PowerShell...');
      const psCommand = `powershell -Command "irm https://deno.land/install.ps1 | iex"`;
      exec(psCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('Failed to install Deno with PowerShell:', stderr);
          console.log('Please install Deno manually from https://deno.land/');
          reject(new Error('Failed to install Deno'));
        } else {
          console.log('Deno installed successfully!');
          resolve();
        }
      });
    });
  } else {
    return new Promise((resolve, reject) => {
      const installScript = spawn('curl', ['-fsSL', 'https://deno.land/x/install/install.sh'], { stdio: 'pipe' });
      const sh = spawn('sh', [], { stdio: ['pipe', 'inherit', 'inherit'] });
      
      installScript.stdout.pipe(sh.stdin);
      
      sh.on('close', (code) => {
        if (code === 0) {
          console.log('Deno installed successfully!');
          resolve();
        } else {
          reject(new Error('Failed to install Deno'));
        }
      });
    });
  }
}

// Main installation process
async function main() {
  try {
    const denoAvailable = await checkDeno();
    
    if (!denoAvailable) {
      await installDeno();
    }
    
    // Check for ARM64 macOS and better-sqlite3 compatibility
    const platform = os.platform();
    const arch = os.arch();
    const isARM64MacOS = platform === 'darwin' && arch === 'arm64';
    
    if (isARM64MacOS) {
      console.log('📱 Detected Apple Silicon (ARM64) macOS');
      
      // Check if better-sqlite3 bindings are working
      const sqliteWorking = await checkSqliteBindings();
      
      if (!sqliteWorking) {
        console.log('⚠️  better-sqlite3 bindings not working, attempting to rebuild...');
        await rebuildSqlite();
        
        // Test again after rebuild
        const sqliteWorkingAfterRebuild = await checkSqliteBindings();
        
        if (sqliteWorkingAfterRebuild) {
          console.log('✅ better-sqlite3 is now working correctly!');
        } else {
          console.log('ℹ️  better-sqlite3 rebuild did not resolve the issue');
          console.log('ℹ️  Claude-Flow will use in-memory storage (no persistence across sessions)');
          console.log('ℹ️  For persistent storage, try: npm install -g claude-flow@alpha');
        }
      } else {
        console.log('✅ better-sqlite3 bindings are working correctly');
      }
    }
    
    console.log('Claude-Flow installation completed!');
    console.log('You can now use: npx claude-flow or claude-flow (if installed globally)');
    
  } catch (error) {
    console.error('Installation failed:', error.message);
    console.log('Please install Deno manually from https://deno.land/ and try again.');
    process.exit(1);
  }
}

main();