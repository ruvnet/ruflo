# Analysis Mode (Planning Permission Mode)

## Overview

Claude Flow's Analysis Mode implements a read-only/planning permission mode that prevents all code modifications while enabling comprehensive codebase analysis. This feature is inspired by Claude Code's planning permission mode and provides a safe environment for code exploration, security audits, and architectural analysis.

## Features

- 🔍 **Read-Only Operations**: Safely explore codebases without risk of modifications
- 🛡️ **Security Audits**: Perform comprehensive security analysis without changing code
- 📊 **Architecture Analysis**: Document and analyze system architecture patterns
- 🎯 **Technical Debt Assessment**: Identify and report on technical debt without making changes
- 🔐 **Safe Exploration**: Perfect for "what-if" scenarios and code reviews

## Usage

### Basic Usage

```bash
# Enable analysis mode with --analysis flag
claude-flow swarm "Analyze codebase for security vulnerabilities" --analysis

# Enable analysis mode with --read-only flag (alias)
claude-flow swarm "Review architecture patterns" --read-only

# Combine with other flags
claude-flow swarm "Assess technical debt" --analysis --strategy research --max-agents 3
```

### Example Commands

```bash
# Security audit
claude-flow swarm "Identify security vulnerabilities in authentication system" --analysis

# Performance analysis
claude-flow swarm "Analyze database query performance bottlenecks" --read-only --strategy analysis

# Architecture review
claude-flow swarm "Document microservices architecture patterns" --analysis --strategy research

# Code quality assessment
claude-flow swarm "Evaluate code quality and technical debt" --read-only --max-agents 5
```

## Analysis Mode Constraints

### ✅ Allowed Operations

1. **Read Files**: Use `Read` tool to analyze file contents
2. **Search Codebases**: Use `Glob` and `Grep` tools for pattern matching
3. **Code Structure Analysis**: Analyze code organization and patterns
4. **Generate Reports**: Create comprehensive analysis documentation
5. **Create Summaries**: Generate executive summaries of findings
6. **Memory Storage**: Store findings in swarm memory for collaboration
7. **Agent Communication**: Share discoveries between swarm agents

### ❌ Forbidden Operations

1. **File Modifications**: Never use `Write`, `Edit`, or `MultiEdit` tools
2. **File Creation**: Never create new files or directories
3. **System Commands**: Never use `Bash` for system-modifying commands
4. **Package Installation**: Never install dependencies or packages
5. **Configuration Changes**: Never modify configuration files
6. **State Changes**: Never execute code that changes system state

## Use Cases

### Security Audits
Perfect for identifying vulnerabilities without modifying code.

### Code Reviews
Comprehensive analysis of pull requests and code changes.

### Architecture Analysis
Document and analyze system architecture patterns.

### Technical Debt Assessment
Identify areas for improvement without making changes.

For more details, see the [examples](../examples/analysis-mode-example.md).