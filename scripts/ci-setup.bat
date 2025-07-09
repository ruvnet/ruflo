@echo off
REM CI Environment Setup Script for Windows

echo Setting up CI environment for Windows...

REM Set environment variables
set NODE_ENV=test
set CLAUDE_FLOW_ENV=test
set CI=true
set NODE_OPTIONS=--max-old-space-size=2048

REM Create necessary directories
if not exist logs mkdir logs
if not exist coverage mkdir coverage
if not exist test-results mkdir test-results
if not exist .claude mkdir .claude

REM Install dependencies with retries
set RETRIES=3
set COUNT=0

:install_loop
if %COUNT% geq %RETRIES% goto install_failed
set /a COUNT=%COUNT%+1

echo Installing dependencies (attempt %COUNT%/%RETRIES%)...
call npm ci --ignore-scripts --no-audit --no-fund

if %ERRORLEVEL% equ 0 (
    echo Dependencies installed successfully
    goto install_success
)

if %COUNT% lss %RETRIES% (
    echo Installation failed, retrying in 5 seconds...
    timeout /t 5 /nobreak > nul
    call npm cache clean --force 2>nul
    goto install_loop
)

:install_failed
echo Failed to install dependencies after %RETRIES% attempts
exit /b 1

:install_success

REM Create default config if not exists
if not exist .claude\settings.json (
    echo Creating default CI config...
    (
        echo {
        echo   "version": "2.0.0",
        echo   "environment": "ci",
        echo   "testMode": true,
        echo   "hooks": {
        echo     "enabled": false
        echo   },
        echo   "memory": {
        echo     "backend": "json",
        echo     "path": "./memory/test-memory.json"
        echo   }
        echo }
    ) > .claude\settings.json
)

REM Validate environment
echo Validating CI environment...
node -v
npm -v

if not exist package.json (
    echo Missing required file: package.json
    exit /b 1
)

if not exist package-lock.json (
    echo Missing required file: package-lock.json
    exit /b 1
)

REM Test Node.js
node -e "console.log('Node.js works')"
if %ERRORLEVEL% neq 0 (
    echo Node.js runtime failed
    exit /b 1
)

echo.
echo CI environment setup complete!
echo ================================