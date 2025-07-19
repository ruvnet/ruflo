// executable-wrapper.js - Create local executable wrapper

import { writeFile, chmod } from 'fs/promises';
import { platform } from 'os';

export async function createLocalExecutable(workingDir, dryRun = false) {
  try {
    if (platform() === 'win32') {
      // Create Windows batch file
      const wrapperScript = `@echo off
REM Gemini-Flow local wrapper
REM This script ensures gemini-flow runs from your project directory

set PROJECT_DIR=%CD%
set PWD=%PROJECT_DIR%
set CLAUDE_WORKING_DIR=%PROJECT_DIR%

REM Try to find gemini-flow binary
REM Check common locations for npm/npx installations

REM 1. Local node_modules (npm install gemini-flow)
if exist "%PROJECT_DIR%\\node_modules\\.bin\\gemini-flow.cmd" (
  cd /d "%PROJECT_DIR%"
  "%PROJECT_DIR%\\node_modules\\.bin\\gemini-flow.cmd" %*
  exit /b %ERRORLEVEL%
)

REM 2. Parent directory node_modules (monorepo setup)
if exist "%PROJECT_DIR%\\..\\node_modules\\.bin\\gemini-flow.cmd" (
  cd /d "%PROJECT_DIR%"
  "%PROJECT_DIR%\\..\\node_modules\\.bin\\gemini-flow.cmd" %*
  exit /b %ERRORLEVEL%
)

REM 3. Global installation (npm install -g gemini-flow)
where gemini-flow >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  cd /d "%PROJECT_DIR%"
  gemini-flow %*
  exit /b %ERRORLEVEL%
)

REM 4. Fallback to npx (will download if needed)
cd /d "%PROJECT_DIR%"
npx gemini-flow@latest %*
`;

      // Write the Windows batch file
      if (!dryRun) {
        await writeFile(`${workingDir}/gemini-flow.cmd`, wrapperScript, 'utf8');
        console.log('  ✓ Created local gemini-flow.cmd executable wrapper');
        console.log('    You can now use: gemini-flow instead of npx gemini-flow');
      }
      
    } else {
      // Check if we're in development mode (gemini-flow repo)
      const isDevelopment = workingDir.includes('gemini-flow');
      const devBinPath = isDevelopment ? 
        workingDir.split('gemini-flow')[0] + 'gemini-flow/bin/gemini-flow' : '';
      
      // Create Unix/Linux/Mac shell script
      const wrapperScript = `#!/usr/bin/env bash
# Gemini-Flow local wrapper
# This script ensures gemini-flow runs from your project directory

# Save the current directory
PROJECT_DIR="\${PWD}"

# Set environment to ensure correct working directory
export PWD="\${PROJECT_DIR}"
export CLAUDE_WORKING_DIR="\${PROJECT_DIR}"

# Try to find gemini-flow binary
# Check common locations for npm/npx installations

${isDevelopment ? `# Development mode - use local bin
if [ -f "${devBinPath}" ]; then
  cd "\${PROJECT_DIR}"
  exec "${devBinPath}" "$@"
fi

` : ''}# 1. Local node_modules (npm install gemini-flow)
if [ -f "\${PROJECT_DIR}/node_modules/.bin/gemini-flow" ]; then
  cd "\${PROJECT_DIR}"
  exec "\${PROJECT_DIR}/node_modules/.bin/gemini-flow" "$@"

# 2. Parent directory node_modules (monorepo setup)
elif [ -f "\${PROJECT_DIR}/../node_modules/.bin/gemini-flow" ]; then
  cd "\${PROJECT_DIR}"
  exec "\${PROJECT_DIR}/../node_modules/.bin/gemini-flow" "$@"

# 3. Global installation (npm install -g gemini-flow)
elif command -v gemini-flow &> /dev/null; then
  cd "\${PROJECT_DIR}"
  exec gemini-flow "$@"

# 4. Fallback to npx (will download if needed)
else
  cd "\${PROJECT_DIR}"
  exec npx gemini-flow@latest "$@"
fi
`;

      // Write the wrapper script
      if (!dryRun) {
        await writeFile(`${workingDir}/gemini-flow`, wrapperScript, 'utf8');
        
        // Make it executable
        await chmod(`${workingDir}/gemini-flow`, 0o755);
        
        console.log('  ✓ Created local gemini-flow executable wrapper');
        console.log('    You can now use: ./gemini-flow instead of npx gemini-flow');
      }
    }
    
  } catch (err) {
    console.log(`  ⚠️  Could not create local executable: ${err.message}`);
  }
}