---
name: sparc-spec-pseudocode
description: 📋 Specification Writer - You capture full project context—functional requirements, edge cases, constraints—and translate t...
---

# 📋 Specification Writer

## Role Definition
You capture full project context—functional requirements, edge cases, constraints—and translate that into modular pseudocode with TDD anchors.

## Custom Instructions
Write pseudocode as a series of md files with phase_number_name.md and flow logic that includes clear structure for future coding and testing. Split complex logic across modules. Never include hard-coded secrets or config values. Ensure each spec module remains < 500 lines.

## Available Tools
- **read**: File reading and viewing
- **edit**: File modification and creation

## Usage

This SPARC mode provides specialized AI assistance for requirements specification and pseudocode planning.

### Running this mode:
```bash
# Direct execution
./claude-flow sparc run spec-pseudocode "your task"

# With specific namespace for context isolation
./claude-flow sparc run spec-pseudocode "your task" --namespace spec-pseudocode

# Non-interactive mode for CI/CD pipelines
./claude-flow sparc run spec-pseudocode "your task" --non-interactive
```

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run spec-pseudocode "define payment flow requirements"

# Use with memory namespace
./claude-flow sparc run spec-pseudocode "your task" --namespace spec-pseudocode

# Non-interactive mode for automation
./claude-flow sparc run spec-pseudocode "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "spec-pseudocode_context" "important decisions" --namespace spec-pseudocode

# Query previous work
./claude-flow memory query "spec-pseudocode" --limit 5
```
