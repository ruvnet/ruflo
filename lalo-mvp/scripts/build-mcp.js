#!/usr/bin/env node

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('🔨 Building LALO MCP Server...');

try {
  // Ensure TypeScript build is complete
  if (!existsSync(join(projectRoot, 'dist', 'mcp', 'server.js'))) {
    console.log('📦 Building TypeScript first...');
    execSync('npx tsc', { cwd: projectRoot, stdio: 'inherit' });
  }

  // Make MCP server executable
  const mcpServerPath = join(projectRoot, 'dist', 'mcp', 'server.js');
  if (existsSync(mcpServerPath)) {
    let content = readFileSync(mcpServerPath, 'utf8');

    // Ensure shebang is present
    if (!content.startsWith('#!/usr/bin/env node')) {
      content = '#!/usr/bin/env node\n' + content;
      writeFileSync(mcpServerPath, content);
    }

    // Make executable on Unix systems
    try {
      execSync(`chmod +x "${mcpServerPath}"`, { stdio: 'ignore' });
    } catch (error) {
      // Ignore chmod errors on Windows
    }

    console.log('✅ MCP server built successfully');
    console.log(`📍 Server location: ${mcpServerPath}`);
    console.log('🚀 To test: node dist/mcp/server.js');
  } else {
    throw new Error('MCP server build failed - server.js not found');
  }

} catch (error) {
  console.error('❌ MCP build failed:', error.message);
  process.exit(1);
}