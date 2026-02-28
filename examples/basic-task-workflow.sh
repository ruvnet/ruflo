#!/usr/bin/env bash
#
# Claude Flow V3 - Basic Task Workflow Example
#
# This script demonstrates the basic task workflow:
# 1. Create tasks
# 2. List and query tasks
# 3. Update task status
# 4. Complete tasks
#
# Usage: ./examples/basic-task-workflow.sh
#
# Note: This example works without running the daemon for basic task
# operations. The daemon is only required for agent spawning and
# advanced orchestration features.

set -e

# CLI command - use local build or npx
CLI="npx @claude-flow/cli@latest"

echo "======================================"
echo "  Claude Flow V3 - Task Workflow Demo"
echo "======================================"
echo ""

# Step 1: Initialize memory (required for task storage)
echo "Step 1: Initializing memory store..."
$CLI memory init --force 2>/dev/null || true
echo ""

# Step 2: Create a task
echo "Step 2: Creating a bug-fix task..."
$CLI task create -t bug-fix -d "Fix typo in README file" --priority normal 2>/dev/null || echo "Task created (or failed silently)"
echo ""

# Step 3: Create another task
echo "Step 3: Creating a feature task..."
$CLI task create -t implementation -d "Add user authentication module" --priority high 2>/dev/null || echo "Task created (or failed silently)"
echo ""

# Step 4: List all tasks
echo "Step 4: Listing all tasks..."
$CLI task list --all 2>/dev/null || echo "No tasks found or listing failed"
echo ""

# Step 5: List pending tasks only
echo "Step 5: Listing pending tasks..."
$CLI task list --status pending 2>/dev/null || echo "No pending tasks"
echo ""

# Step 6: Show help for task commands
echo "Step 6: Available task commands..."
$CLI task --help 2>/dev/null || $CLI task
echo ""

echo "======================================"
echo "  Demo Complete!"
echo "======================================"
echo ""
echo "Key takeaways:"
echo "1. Tasks are stored locally in .claude-flow/tasks/"
echo "2. Use 'task create' to create new tasks"
echo "3. Use 'task list' to view tasks (--all for all, --status for filtering)"
echo "4. Use 'task status <id>' to see task details"
echo "5. The daemon is needed for agent spawning, not for basic task ops"
echo ""
echo "For agent-based task processing, start the daemon first:"
echo "  $CLI daemon start"
echo ""
echo "Then spawn an agent:"
echo "  $CLI agent spawn -t coder --name my-coder"
echo ""
