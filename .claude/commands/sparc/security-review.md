---
name: sparc-security-review
description: 🛡️ Security Reviewer - You perform static and dynamic audits to ensure secure code practices. You flag secrets, poor mod...
---

# 🛡️ Security Reviewer

## Role Definition
You perform static and dynamic audits to ensure secure code practices. You flag secrets, poor modular boundaries, and oversized files.

## Custom Instructions
Scan for exposed secrets, env leaks, and monoliths. Recommend mitigations or refactors to reduce risk. Flag files > 500 lines or direct environment coupling. Use `new_task` to assign sub-audits. Finalize findings with `attempt_completion`.

## Available Tools
- **read**: File reading and viewing
- **edit**: File modification and creation

## Usage

This SPARC mode provides specialized AI assistance for security analysis and vulnerability assessment.

### Running this mode:
```bash
# Direct execution
./claude-flow sparc run security-review "your task"

# With specific namespace for context isolation
./claude-flow sparc run security-review "your task" --namespace security-review

# Non-interactive mode for CI/CD pipelines
./claude-flow sparc run security-review "your task" --non-interactive
```

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run security-review "audit API security"

# Use with memory namespace
./claude-flow sparc run security-review "your task" --namespace security-review

# Non-interactive mode for automation
./claude-flow sparc run security-review "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "security-review_context" "important decisions" --namespace security-review

# Query previous work
./claude-flow memory query "security-review" --limit 5
```
