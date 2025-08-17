#!/usr/bin/env node

import os from 'node:os';
import { spawn } from 'node:child_process';

// Check if SQLite bindings are working
async function checkSqliteBindings() {
  try {
    const Database = await import('better-sqlite3');
    const db = new Database.default(':memory:');
    db.close();
    return true;
  } catch (error) {
    return false;
  }
}

// Attempt to rebuild better-sqlite3 for ARM64
async function rebuildSqlite() {
  console.log('🔧 Rebuilding better-sqlite3 for ARM64...');
  
  return new Promise((resolve) => {
    const rebuild = spawn('npm', ['rebuild', 'better-sqlite3'], {
      stdio: 'inherit',
      shell: true
    });
    
    rebuild.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Successfully rebuilt better-sqlite3 for ARM64');
        resolve(true);
      } else {
        console.log('⚠️  Failed to rebuild better-sqlite3');
        resolve(false);
      }
    });
    
    rebuild.on('error', () => {
      console.log('⚠️  Failed to rebuild better-sqlite3');
      resolve(false);
    });
  });
}

// Main installation logic
async function main() {
  const platform = os.platform();
  const arch = os.arch();
  
  // Only run on ARM64 macOS
  if (platform === 'darwin' && arch === 'arm64') {
    console.log('🍎 Detected Apple Silicon (ARM64) Mac');
    
    const bindingsWork = await checkSqliteBindings();
    
    if (!bindingsWork) {
      console.log('⚠️  SQLite bindings not working for ARM64');
      const rebuildSuccess = await rebuildSqlite();
      
      if (!rebuildSuccess) {
        console.log('');
        console.log('⚠️  Unable to rebuild SQLite bindings for ARM64');
        console.log('📝 Claude-Flow will fall back to in-memory storage');
        console.log('');
        console.log('To fix this issue, you can try:');
        console.log('1. Install Xcode Command Line Tools: xcode-select --install');
        console.log('2. Manually rebuild: cd node_modules/better-sqlite3 && npm run build-release');
        console.log('3. Use Rosetta 2: arch -x86_64 npm install');
        console.log('');
      }
    } else {
      console.log('✅ SQLite bindings are working correctly');
    }
  }
}

// Run the installation enhancement
main().catch(console.error);