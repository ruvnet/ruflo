import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const testDir = path.join(os.tmpdir(), `debug-schema-${Date.now()}`);
await fs.mkdir(testDir, { recursive: true });
process.chdir(testDir);

const dbPath = path.join(testDir, '.hive-mind', 'hive.db');

console.log('Running hive-mind init...');
try {
  execSync('npx claude-flow hive-mind init', {
    cwd: testDir,
    stdio: 'pipe',
    env: { ...process.env, PATH: `/workspaces/claude-code-flow/node_modules/.bin:${process.env.PATH}` }
  });
  
  console.log('Database created. Checking schema...');
  
  const db = new Database(dbPath);
  
  // Get swarms table schema
  const swarmsSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='swarms'").get();
  console.log('\n--- SWARMS TABLE SCHEMA ---');
  console.log(swarmsSchema?.sql || 'Table not found');
  
  // Get swarms table columns
  const swarmsColumns = db.prepare("PRAGMA table_info(swarms)").all();
  console.log('\n--- SWARMS TABLE COLUMNS ---');
  swarmsColumns.forEach(col => console.log(`${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : 'NULL'}`));
  
  // Get agents table schema
  const agentsSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'").get();
  console.log('\n--- AGENTS TABLE SCHEMA ---');
  console.log(agentsSchema?.sql || 'Table not found');
  
  // Get agents table columns
  const agentsColumns = db.prepare("PRAGMA table_info(agents)").all();
  console.log('\n--- AGENTS TABLE COLUMNS ---');
  agentsColumns.forEach(col => console.log(`${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : 'NULL'}`));
  
  db.close();
} catch (error) {
  console.error('Error:', error.message);
  console.error('Stdout:', error.stdout?.toString() || 'No stdout');
  console.error('Stderr:', error.stderr?.toString() || 'No stderr');
}

// Cleanup
process.chdir(os.tmpdir());
await fs.rm(testDir, { recursive: true, force: true });