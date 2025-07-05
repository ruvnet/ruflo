#!/usr/bin/env pwsh
# ruv-swarm local wrapper (PowerShell)
# Cross-platform PowerShell script for ruv-swarm

param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)

# Save the current directory
$ProjectDir = Get-Location
$env:PWD = $ProjectDir
$env:RUVSW_WORKING_DIR = $ProjectDir

# Detect remote execution
if ($env:SSH_CLIENT -or $env:SSH_TTY -or $env:TERM -eq "screen") {
    Write-Host "🌐 Remote execution detected"
    $env:RUVSW_REMOTE_MODE = "1"
}

# Function to find and execute ruv-swarm
function Find-And-Execute {
    param([string[]]$Args)
    
    try {
        # 1. Try npx
        if (Get-Command npx -ErrorAction SilentlyContinue) {
            Set-Location $ProjectDir
            & npx ruv-swarm @Args
            return
        }
        
        # 2. Try local node_modules
        $localBin = Join-Path $ProjectDir "node_modules" ".bin" "ruv-swarm"
        if (Test-Path $localBin) {
            Set-Location $ProjectDir
            & $localBin @Args
            return
        }
        
        # 3. Try global installation
        if (Get-Command ruv-swarm -ErrorAction SilentlyContinue) {
            Set-Location $ProjectDir
            & ruv-swarm @Args
            return
        }
        
        # 4. Fallback to latest
        Set-Location $ProjectDir
        & npx ruv-swarm@latest @Args
        
    } catch {
        Write-Error "Failed to execute ruv-swarm: $_"
        exit 1
    }
}

# Execute with arguments
Find-And-Execute $Arguments
