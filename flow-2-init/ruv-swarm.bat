@echo off
REM ruv-swarm local wrapper (Windows)
REM This script ensures ruv-swarm runs from your project directory

set PROJECT_DIR=%CD%
set RUVSW_WORKING_DIR=%PROJECT_DIR%

REM Check for remote execution (basic detection)
if defined SSH_CLIENT set RUVSW_REMOTE_MODE=1
if defined SSH_TTY set RUVSW_REMOTE_MODE=1

REM Function to find and execute ruv-swarm
call :find_and_execute %*
goto :eof

:find_and_execute
    REM 1. Try npx
    where npx >nul 2>nul
    if %ERRORLEVEL% == 0 (
        cd /d "%PROJECT_DIR%"
        npx ruv-swarm %*
        exit /b %ERRORLEVEL%
    )
    
    REM 2. Try local node_modules
    if exist "%PROJECT_DIR%\node_modules\.bin\ruv-swarm.cmd" (
        cd /d "%PROJECT_DIR%"
        "%PROJECT_DIR%\node_modules\.bin\ruv-swarm.cmd" %*
        exit /b %ERRORLEVEL%
    )
    
    REM 3. Try global installation
    where ruv-swarm >nul 2>nul
    if %ERRORLEVEL% == 0 (
        cd /d "%PROJECT_DIR%"
        ruv-swarm %*
        exit /b %ERRORLEVEL%
    )
    
    REM 4. Fallback to latest
    cd /d "%PROJECT_DIR%"
    npx ruv-swarm@latest %*
    exit /b %ERRORLEVEL%
