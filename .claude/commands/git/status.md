---
description: Intelligently analyze git status and provide insights about current project state
category: workflow
allowed-tools: Bash(git:*), Task
---

Analyze the current git status and provide an intelligent summary of what's happening in the project.

## Git Expert Integration
For complex git analysis scenarios (merge conflicts, complex branch states, repository issues), consider using the Task tool with `git-expert` subagent for specialized git expertise.

## Efficiency Note:
Be concise. Skip verbose explanations of what commands you're running. Focus on the actual status results.

## Instructions for Claude:

1. Run all git commands in a single bash call for speed:
!git status --porcelain=v1 && echo "---" && git diff --stat 2>/dev/null && echo "---" && git branch -vv | grep "^\*" && echo "---" && git log --oneline -1 && echo "---" && git diff --cached --stat 2>/dev/null

Note: The output will be separated by "---" markers. Parse each section accordingly.

3. Provide results directly without explaining the process:
   - **Summary**: Brief overview of the current state
   - **Modified Files**: Group by type (docs, code, tests, config)
   - **Uncommitted Changes**: What's been changed and why it might matter
   - **Branch Status**: Relationship to remote branch
   - **Suggestions**: What actions might be appropriate

Provide insights about:
- Whether changes appear related or should be separate commits
- If any critical files are modified (package.json, config files, etc.)
- Whether the working directory is clean for operations like rebasing
- Any patterns in the modifications (e.g., all test files, all docs, etc.)
- If there are stashed changes that might be forgotten

Make the output concise but informative, focusing on what matters most to the developer.

Example of concise output:
- Skip: "I'll analyze the current git status for you."
- Skip: "Let me gather the details efficiently:"
- Skip: "I see there are changes. Let me gather the details:"
- Just show the results directly