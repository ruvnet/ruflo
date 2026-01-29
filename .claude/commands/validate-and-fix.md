---
description: Run quality checks and automatically fix issues using concurrent agents
category: workflow
allowed-tools: Bash, Task, TodoWrite, Read, Edit, MultiEdit
---

# Validate and Fix

Run quality checks and automatically fix discovered issues using parallel execution.

## Process

### 1. SYSTEMATIC PRIORITY-BASED ANALYSIS

#### Command Discovery
First, discover what validation commands are available:
1. Check AGENTS.md/CLAUDE.md for documented build/test/lint commands
2. Examine package.json scripts section for available commands
3. Look for common patterns in scripts:
   - Linting: "lint", "eslint", "lint:fix", "check:lint", "lint:js"
   - Type checking: "typecheck", "type-check", "tsc", "check:types", "types"
   - Testing: "test", "test:unit", "jest", "check:test", "test:all"
   - Formatting: "format", "prettier", "fmt", "format:fix"
   - Build: "build", "compile", "build:prod"
4. Check README.md for any additional validation instructions

#### Discovery with Immediate Categorization
Run all discovered quality checks in parallel using Bash. Capture full output including file paths, line numbers, and error messages:
- Linting (ESLint, Prettier, Ruff, etc.)
- Type checking (TypeScript, mypy, etc.)
- Tests (Jest, pytest, go test, etc.)
- Build verification
- Custom project checks

Immediately categorize findings by:
- **CRITICAL**: Security issues, breaking changes, data loss risk
- **HIGH**: Functionality bugs, test failures, build breaks
- **MEDIUM**: Code quality, style violations, documentation gaps
- **LOW**: Formatting, minor optimizations

#### Risk Assessment Before Action
- Identify "quick wins" vs. complex fixes
- Map dependencies between issues (fix A before B)
- Flag issues that require manual intervention

### 2. STRATEGIC FIX EXECUTION

#### Phase 1 - Safe Quick Wins
- Start with LOW and MEDIUM priority fixes that can't break anything
- Verify each fix immediately before proceeding

#### Phase 2 - Functionality Fixes
- Address HIGH priority issues one at a time
- Run tests after each fix to ensure no regressions

#### Phase 3 - Critical Issues
- Handle CRITICAL issues with explicit user confirmation
- Provide detailed plan before executing

#### Phase 4 - Verification
- Re-run ALL checks to confirm fixes were successful
- Provide summary of what was fixed vs. what remains

### 3. COMPREHENSIVE ERROR HANDLING

#### Rollback Capability
- Create git stash checkpoint before ANY changes
- Provide instant rollback procedure if fixes cause issues

#### Partial Success Handling
- Continue execution even if some fixes fail
- Clearly separate successful fixes from failures
- Provide manual fix instructions for unfixable issues

#### Quality Validation
- Accept 100% success in each phase before proceeding
- If phase fails, diagnose and provide specific next steps

#### Task Distribution
Create detailed task plans where each agent gets:
- A specific, focused objective (e.g., "Fix all TypeScript errors in src/components/")
- Exact file paths and line numbers to modify
- Clear success criteria (e.g., "Ensure the project's type checking command passes for these files")
- Any relevant context about dependencies or patterns to follow

### 4. Parallel Execution
Launch multiple agents concurrently for independent, parallelizable tasks:
- **CRITICAL**: Include multiple Task tool calls in a SINGLE message ONLY when tasks can be done in parallel
- Tasks that depend on each other should be executed sequentially (separate messages)
- Parallelizable tasks: Different file fixes, independent test suites, non-overlapping components
- Sequential tasks: Tasks with dependencies, shared state modifications, ordered phases
- **Use specialized subagents** when tasks match expert domains (TypeScript, React, testing, databases, etc.)
- Run `claudekit list agents` to see available specialized experts  
- Match task requirements to expert domains for optimal results
- Use general-purpose approach only when no specialized expert fits
- Each parallel agent should have non-overlapping responsibilities to avoid conflicts
- Agents working on related files must understand the shared interfaces
- Each agent verifies their fixes work before completing
- Track progress with TodoWrite
- Execute phases sequentially: complete Phase 1 before Phase 2, etc.
- Create checkpoint after each successful phase

### 5. Final Verification
After all agents complete:
- Re-run all checks to confirm 100% of fixable issues are resolved
- Confirm no new issues were introduced by fixes
- Report any remaining manual fixes needed with specific instructions
- Provide summary: "Fixed X/Y issues, Z require manual intervention"

This approach maximizes efficiency through parallel discovery and fixing while ensuring coordinated, conflict-free changes.