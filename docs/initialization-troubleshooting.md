# Initialization Troubleshooting Guide

## Overview

This guide helps resolve common issues encountered during Gemini-Flow initialization, particularly when using the optimized `--sparc --force` setup. Each issue includes symptoms, causes, and step-by-step solutions.

## Quick Diagnostic Commands

Before diving into specific issues, run these commands to gather diagnostic information:

```bash
# Check system environment
node --version
npm --version
npx --version

# Check Gemini-Flow version
npx gemini-flow@latest --version

# Check network connectivity
curl -I https://registry.npmjs.org/gemini-flow

# Check directory permissions
ls -la
pwd
```

## Common Issues and Solutions

### 1. Permission Denied Errors

#### Symptoms
```
Error: EACCES: permission denied, mkdir '.gemini'
Error: EACCES: permission denied, open 'GEMINI.md'
```

#### Causes
- Insufficient directory permissions
- Running in read-only directory
- File ownership issues

#### Solutions

**Solution 1: Fix Directory Permissions**
```bash
# Check current permissions
ls -la

# Fix ownership (if needed)
sudo chown -R $USER:$USER .

# Set proper permissions
chmod 755 .
chmod 644 package.json 2>/dev/null || true

# Retry initialization
npx gemini-flow@latest init --sparc --force
```

**Solution 2: Use Different Directory**
```bash
# Create new directory with proper permissions
mkdir ~/my-project
cd ~/my-project

# Initialize there
npx gemini-flow@latest init --sparc --force
```

**Solution 3: Run with Sudo (NOT recommended)**
```bash
# Only if other solutions fail and you understand the security implications
sudo npx gemini-flow@latest init --sparc --force
sudo chown -R $USER:$USER .
```

### 2. Network and Package Issues

#### Symptoms
```
npm ERR! network request to https://registry.npmjs.org/gemini-flow failed
Error: create-sparc failed, creating basic SPARC structure manually...
```

#### Causes
- Network connectivity issues
- Corporate firewall blocking npm registry
- Proxy configuration problems
- npm cache corruption

#### Solutions

**Solution 1: Check and Fix Network**
```bash
# Test connectivity
ping registry.npmjs.org
curl -I https://registry.npmjs.org/gemini-flow

# Check npm configuration
npm config list
npm config get registry

# If behind corporate firewall, configure proxy
npm config set proxy http://proxy.company.com:8080
npm config set https-proxy http://proxy.company.com:8080
```

**Solution 2: Clear npm Cache**
```bash
# Clear npm cache
npm cache clean --force

# Clear npx cache
rm -rf ~/.npm/_npx/

# Retry initialization
npx -y gemini-flow@latest init --sparc --force
```

**Solution 3: Use Alternative Registry**
```bash
# Temporarily use different registry
npm config set registry https://registry.yarnpkg.com/

# Or use yarn
yarn global add gemini-flow
gemini-flow init --sparc --force

# Restore original registry
npm config set registry https://registry.npmjs.org/
```

### 3. File Conflicts and Overwrites

#### Symptoms
```
Warning: The following files already exist: GEMINI.md, .roomodes
Use --force to overwrite existing files
```

#### Causes
- Previous initialization attempt
- Existing project configuration
- Git merge conflicts

#### Solutions

**Solution 1: Safe Backup and Overwrite**
```bash
# Create timestamped backup
mkdir backup-$(date +%Y%m%d-%H%M%S)
cp GEMINI.md .roomodes backup-$(date +%Y%m%d-%H%M%S)/ 2>/dev/null || true
cp -r .gemini backup-$(date +%Y%m%d-%H%M%S)/ 2>/dev/null || true

# Force overwrite with optimized templates
npx gemini-flow@latest init --sparc --force

# Review and merge important customizations
# Compare backup files with new versions
diff backup-*/GEMINI.md GEMINI.md || echo "Files are different - review changes"
```

**Solution 2: Selective File Handling**
```bash
# Remove specific files you want to regenerate
rm GEMINI.md .roomodes
rm -rf .gemini/commands/

# Initialize (will only create missing files)
npx gemini-flow@latest init --sparc --force
```

**Solution 3: Clean Slate Approach**
```bash
# For complete fresh start (CAREFUL - backs up everything)
mkdir ../project-backup-$(date +%Y%m%d)
cp -r . ../project-backup-$(date +%Y%m%d)/

# Remove Gemini-Flow related files
rm -f GEMINI.md memory-bank.md coordination.md .roomodes
rm -rf .gemini/ memory/ coordination/
rm -f ./gemini-flow

# Fresh initialization
npx gemini-flow@latest init --sparc --force
```

### 4. Template Generation Errors

#### Symptoms
```
Error: Failed to generate template: ReferenceError: createSparcGeminiMd is not defined
TypeError: Cannot read property 'generateOptimizedTemplate' of undefined
```

#### Causes
- Corrupted package installation
- Version mismatch
- Missing dependencies

#### Solutions

**Solution 1: Force Fresh Installation**
```bash
# Uninstall any global installation
npm uninstall -g gemini-flow

# Clear all caches
npm cache clean --force
rm -rf ~/.npm/

# Use latest version with -y flag
npx -y gemini-flow@latest init --sparc --force
```

**Solution 2: Check Version Compatibility**
```bash
# Check what version is being used
npx gemini-flow@latest --version

# If version is outdated, force latest
npx gemini-flow@$(npm show gemini-flow version) init --sparc --force
```

**Solution 3: Manual Template Generation**
```bash
# If automated generation fails, create basic structure manually
mkdir -p .gemini/commands memory coordination

# Create minimal GEMINI.md
cat > GEMINI.md << 'EOF'
# Gemini CLI Configuration - SPARC Development Environment

## Project Overview
This project uses Gemini-Flow with SPARC methodology for AI-assisted development.

## Quick Start
- Use `./gemini-flow sparc "your task"` for development
- Available modes: architect, code, tdd, debug, security-review
- Memory system: `./gemini-flow memory store/query`

## Best Practices
- Write tests first (TDD)
- Keep functions small and focused
- Document all public APIs
- Use TypeScript for type safety
EOF

# Create minimal .roomodes
cat > .roomodes << 'EOF'
{
  "architect": {
    "description": "System design and architecture",
    "systemPrompt": "You are a software architect. Design clean, scalable systems."
  },
  "code": {
    "description": "Code implementation",
    "systemPrompt": "You are a senior developer. Write clean, modular, well-tested code."
  },
  "tdd": {
    "description": "Test-driven development",
    "systemPrompt": "You are a TDD expert. Write tests first, then implement."
  }
}
EOF

echo "✅ Basic structure created manually"
```

### 5. SPARC Mode Loading Issues

#### Symptoms
```
Error: SPARC modes not found
./gemini-flow sparc modes returns empty list
Command not found: ./gemini-flow
```

#### Causes
- Incomplete initialization
- Missing executable wrapper
- Incorrect working directory

#### Solutions

**Solution 1: Verify Complete Installation**
```bash
# Check for required files
ls -la | grep -E "(GEMINI.md|\.roomodes|gemini-flow)"

# If gemini-flow executable missing, recreate it
if [ ! -f "./gemini-flow" ]; then
  npx gemini-flow@latest init --sparc --force
fi

# Make executable if needed
chmod +x ./gemini-flow

# Test SPARC modes
./gemini-flow sparc modes
```

**Solution 2: Fix Path and Working Directory**
```bash
# Ensure you're in the right directory
pwd
ls -la GEMINI.md || echo "Not in project directory"

# If in wrong directory, navigate to project root
cd /path/to/your/project

# Verify initialization
./gemini-flow --version
```

**Solution 3: Regenerate SPARC Configuration**
```bash
# Remove and regenerate SPARC files
rm -f .roomodes
rm -rf .gemini/

# Reinitialize SPARC components
npx gemini-flow@latest init --sparc --force

# Verify modes are loaded
./gemini-flow sparc modes --verbose
```

### 6. Memory System Initialization Issues

#### Symptoms
```
Error: Cannot initialize memory system
Memory directory not accessible
./gemini-flow memory stats fails
```

#### Causes
- Permission issues with memory directory
- Disk space problems
- File system limitations

#### Solutions

**Solution 1: Fix Memory Directory Permissions**
```bash
# Check memory directory
ls -la memory/ 2>/dev/null || echo "Memory directory missing"

# Recreate memory structure
rm -rf memory/
mkdir -p memory/{agents,sessions}

# Set proper permissions
chmod 755 memory/
chmod 755 memory/agents/
chmod 755 memory/sessions/

# Initialize memory database
echo '{"agents":[],"tasks":[],"lastUpdated":'$(date +%s)'}' > memory/gemini-flow-data.json

# Test memory system
./gemini-flow memory stats
```

**Solution 2: Check Disk Space**
```bash
# Check available disk space
df -h .

# If low on space, clean up
npm cache clean --force
rm -rf node_modules/
rm -rf .git/logs/ 2>/dev/null || true

# Retry initialization
npx gemini-flow@latest init --sparc --force
```

### 7. Gemini CLI Integration Issues

#### Symptoms
```
Gemini CLI slash commands not appearing
/sparc command not found in Gemini CLI
.gemini/commands/ directory empty
```

#### Causes
- Incomplete slash command generation
- Gemini CLI not reading configuration
- File permission issues

#### Solutions

**Solution 1: Regenerate Slash Commands**
```bash
# Remove and recreate slash commands
rm -rf .gemini/commands/

# Force regeneration
npx gemini-flow@latest init --sparc --force

# Verify slash commands created
ls -la .gemini/commands/
ls -la .gemini/commands/sparc/

# Check for specific commands
ls .gemini/commands/ | grep sparc
```

**Solution 2: Verify Gemini CLI Integration**
```bash
# Check GEMINI.md exists and is readable
cat GEMINI.md | head -10

# Ensure .gemini directory structure is correct
find .gemini -type f -name "*.md" | head -5

# Restart Gemini CLI to pick up changes
# (In Gemini CLI, reload window or restart application)
```

**Solution 3: Manual Slash Command Creation**
```bash
# Create slash commands directory
mkdir -p .gemini/commands/sparc

# Create basic /sparc command
cat > .gemini/commands/sparc.md << 'EOF'
# SPARC Development Command

Execute SPARC methodology workflows for systematic development.

## Usage
Use this command to run SPARC development tasks with AI assistance.

## Examples
- `/sparc "build user authentication"`
- `/sparc "create REST API with tests"`
- `/sparc "design database schema"`

## Available Modes
Run `./gemini-flow sparc modes` to see all available development modes.
EOF

echo "✅ Basic slash commands created"
```

### 8. Performance Issues with Optimized Setup

#### Symptoms
```
Slow response times even with --sparc --force
High token usage despite optimization claims
AI responses not meeting quality expectations
```

#### Causes
- Network latency
- Suboptimal prompts for specific use case
- Configuration not fully applied

#### Solutions

**Solution 1: Verify Optimized Configuration Applied**
```bash
# Check if optimized templates were used
grep -q "optimized" GEMINI.md && echo "✅ Optimized template" || echo "❌ Standard template"

# Check .roomodes for optimization markers
grep -q "systemPrompt.*focus" .roomodes && echo "✅ Optimized prompts" || echo "❌ Standard prompts"

# Reinitialize if needed
if ! grep -q "optimized" GEMINI.md; then
  npx gemini-flow@latest init --sparc --force
fi
```

**Solution 2: Monitor Performance**
```bash
# Enable performance monitoring
./gemini-flow config set monitoring.enabled true
./gemini-flow config set logging.level debug

# Test with timing
time ./gemini-flow sparc "simple hello world function"

# Check memory usage
./gemini-flow memory stats
```

**Solution 3: Optimize for Your Use Case**
```bash
# Customize for your project type
./gemini-flow config set project.type "web-app"  # or "api", "mobile", etc.
./gemini-flow config set team.experience "senior"  # or "junior", "mixed"

# Update prompts for your domain
# Edit .roomodes to include domain-specific context
```

## Environment-Specific Issues

### Windows Users

#### Common Windows Issues
```powershell
# PowerShell execution policy
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Path issues with ./gemini-flow
# Use .\gemini-flow.cmd instead
npx gemini-flow@latest init --sparc --force
.\gemini-flow.cmd sparc modes

# If .cmd file missing, create it
@echo off
npx gemini-flow %*
```

### macOS Users

#### Common macOS Issues
```bash
# Gatekeeper issues
sudo spctl --master-disable  # Temporarily, not recommended for security

# Permission issues with ~/
sudo chown -R $(whoami) ~/.npm

# Path issues
echo 'export PATH="$PATH:./node_modules/.bin"' >> ~/.zshrc
source ~/.zshrc
```

### Linux Users

#### Common Linux Issues
```bash
# SELinux issues (CentOS/RHEL)
setsebool -P httpd_can_network_connect 1

# File descriptor limits
ulimit -n 4096

# Node.js version issues
# Use Node Version Manager (nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install --lts
nvm use --lts
```

## Advanced Troubleshooting

### Debug Mode

```bash
# Enable comprehensive debugging
export DEBUG=gemini-flow:*
export NODE_ENV=development

# Run with debug output
npx gemini-flow@latest init --sparc --force --verbose

# Check debug logs
ls -la .gemini/logs/
tail -f .gemini/logs/debug.log
```

### Clean Environment Test

```bash
# Test in completely clean environment
mkdir /tmp/gemini-flow-test
cd /tmp/gemini-flow-test

# Initialize fresh
npx -y gemini-flow@latest init --sparc --force

# Test basic functionality
./gemini-flow --version
./gemini-flow sparc modes
./gemini-flow status
```

### System Requirements Verification

```bash
# Check system requirements
echo "Node.js: $(node --version)"
echo "npm: $(npm --version)"
echo "OS: $(uname -a)"
echo "Available memory: $(free -h 2>/dev/null || vm_stat)"
echo "Disk space: $(df -h .)"

# Minimum requirements check
node -e "
const version = process.version.slice(1).split('.').map(Number);
if (version[0] < 16) {
  console.log('❌ Node.js 16+ required, found:', process.version);
  process.exit(1);
} else {
  console.log('✅ Node.js version OK:', process.version);
}
"
```

## Getting Help

### Community Support

1. **GitHub Issues**: https://github.com/ruvnet/gemini-flow/issues
2. **Documentation**: https://github.com/ruvnet/gemini-flow/docs
3. **Discussions**: https://github.com/ruvnet/gemini-flow/discussions

### Reporting Bugs

When reporting issues, include:

```bash
# Generate diagnostic report
./gemini-flow diagnostic > gemini-flow-diagnostic.txt

# Include this information:
echo "Gemini-Flow Version: $(npx gemini-flow --version)"
echo "Node.js Version: $(node --version)"
echo "npm Version: $(npm --version)"
echo "Operating System: $(uname -a)"
echo "Working Directory: $(pwd)"
echo "Directory Contents: $(ls -la)"
echo "Environment Variables:" 
env | grep -E "(NODE|NPM|PATH)" | head -10
```

### Emergency Recovery

If everything fails and you need to start over:

```bash
# Complete cleanup script
#!/bin/bash
echo "🚨 Emergency cleanup - this will remove ALL Gemini-Flow files"
read -p "Are you sure? (type 'yes'): " confirm

if [ "$confirm" = "yes" ]; then
  # Remove all Gemini-Flow files
  rm -f GEMINI.md memory-bank.md coordination.md .roomodes
  rm -rf .gemini/ memory/ coordination/
  rm -f gemini-flow gemini-flow.cmd
  
  # Clear npm cache
  npm cache clean --force
  
  # Fresh start
  npx -y gemini-flow@latest init --sparc --force
  
  echo "✅ Emergency recovery complete"
else
  echo "❌ Emergency recovery cancelled"
fi
```

## Prevention Best Practices

1. **Always backup before major changes**
2. **Use version control** to track configuration changes
3. **Test in development environment** before production
4. **Keep Gemini-Flow updated** regularly
5. **Monitor performance** after changes
6. **Document customizations** for your team

For additional help or complex issues, consult the full documentation or open an issue on GitHub with diagnostic information.
