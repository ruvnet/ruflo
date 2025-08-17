# Hive Mind Resume Functionality

## Overview

The Hive Mind Resume feature allows you to pause and resume swarm operations, maintaining full context and progress across sessions. This is particularly useful for:

- Long-running tasks that may span multiple work sessions
- Handling interruptions without losing progress
- Switching between different swarm operations
- Disaster recovery and fault tolerance

## Key Features

### 1. Session Tracking
Every swarm spawn automatically creates a session that tracks:
- Swarm configuration and objective
- Agent status and assignments
- Task progress and completion
- Collective memory state
- Consensus decisions
- Performance metrics

### 2. Auto-Save Functionality
- **Automatic Progress Saving**: State is saved every 30 seconds
- **Critical Event Saving**: Immediate saves on important events:
  - Task completion
  - Agent spawning
  - Consensus decisions
  - Memory updates
- **Graceful Shutdown**: Automatic save on Ctrl+C or process termination

### 3. Resume Capabilities
- **Full Context Restoration**: Resume with complete swarm state
- **Progress Tracking**: See completion percentage and remaining tasks
- **Activity History**: View recent logs and decisions
- **Claude Code Integration**: Spawn Claude Code with restored context

## Usage

### Creating a Resumable Swarm

All swarms are automatically resumable:

```bash
# Spawn a new swarm (automatically creates a session)
claude-flow hive-mind spawn "Build a REST API with authentication"

# Output includes Session ID
# Session ID: session-1234567890-abc123def
```

### Viewing Active Sessions

List all active and paused sessions:

```bash
claude-flow hive-mind sessions

# Output:
# 🗂️  Hive Mind Sessions
# 
# ════════════════════════════════════════════════════════════════
# 🟢 My API Swarm
# Session ID: session-1234567890-abc123def
# Status: active
# Objective: Build a REST API with authentication
# Progress: 45%
# Created: 2024-01-15 10:30:00
# Last Updated: 2024-01-15 11:15:00
# 
# Progress:
#   Agents: 6
#   Tasks: 12/25
```

### Pausing a Session

Sessions are automatically paused when:
- You press Ctrl+C during swarm operation
- The process is terminated
- System shutdown or unexpected interruption

The auto-save functionality ensures no progress is lost.

### Resuming a Session

Resume a paused session with full context:

```bash
# Basic resume
claude-flow hive-mind resume session-1234567890-abc123def

# Resume with Claude Code launch
claude-flow hive-mind resume session-1234567890-abc123def --claude

# Resume with auto-permissions
claude-flow hive-mind resume session-1234567890-abc123def --claude --dangerously-skip-permissions
```

## Architecture

### Session Manager
The `HiveMindSessionManager` class handles:
- Session lifecycle (create, pause, resume, complete)
- Checkpoint saving and restoration
- Progress tracking and metrics
- Session archival and cleanup

### Auto-Save Middleware
The `AutoSaveMiddleware` class provides:
- Periodic state saving (configurable interval)
- Event-based immediate saves
- Change tracking and batching
- Graceful shutdown handling

### Database Schema

Sessions are stored in SQLite with the following tables:

#### sessions
- `id`: Unique session identifier
- `swarm_id`: Associated swarm ID
- `status`: active, paused, completed
- `checkpoint_data`: Latest state snapshot
- `completion_percentage`: Progress tracking

#### session_checkpoints
- Incremental checkpoint storage
- Named checkpoints for important milestones
- Checkpoint restoration capabilities

#### session_logs
- Detailed activity logging
- Agent-specific event tracking
- Performance and decision history

## Integration Points

### MCP Tools Integration
Resume functionality works seamlessly with MCP tools:
- Memory state is preserved across sessions
- Neural patterns continue learning
- Task orchestration maintains context

### Claude Code Integration
When resuming with `--claude` flag:
- Full session context is provided
- Pending tasks are highlighted
- Recent decisions are included
- Checkpoint data is available

### Collective Memory
- All memory entries are preserved
- Access patterns are maintained
- Consensus decisions are retained

## Best Practices

### 1. Regular Checkpoints
While auto-save handles most cases, you can create named checkpoints:
```javascript
// In your swarm coordination
await sessionManager.saveCheckpoint(sessionId, 'milestone-auth-complete', {
  milestone: 'Authentication implementation complete',
  nextPhase: 'API endpoints'
});
```

### 2. Session Hygiene
- Archive old sessions: `claude-flow hive-mind archive --days-old 30`
- Export important sessions: `claude-flow hive-mind export session-id`
- Clean up completed sessions periodically

### 3. Monitoring Progress
Use session tracking to monitor long-running operations:
```bash
# Check specific session progress
claude-flow hive-mind session-status session-1234567890-abc123def

# View session metrics
claude-flow hive-mind session-metrics session-1234567890-abc123def
```

## Technical Details

### Auto-Save Intervals
- Default: 30 seconds
- Configurable via `--save-interval` flag
- Immediate save on critical events

### Storage Location
- Sessions stored in `.hive-mind/hive.db`
- Checkpoint files in `.hive-mind/sessions/`
- Archived sessions in `.hive-mind/sessions/archive/`

### Performance Impact
- Minimal overhead (< 1% CPU usage)
- Efficient incremental saves
- Compressed checkpoint storage

## Troubleshooting

### Session Not Found
If a session cannot be resumed:
1. Check session ID is correct
2. Verify session status with `sessions` command
3. Ensure `.hive-mind/` directory exists

### Corrupted Session
If session data is corrupted:
1. Try loading from checkpoint file
2. Use `--force-restore` flag
3. Export and re-import session

### Auto-Save Not Working
Verify auto-save is active:
1. Check process permissions
2. Ensure disk space available
3. Verify SQLite database accessibility

## Future Enhancements

Planned improvements include:
- Multi-user session sharing
- Cloud backup integration
- Session branching and merging
- Real-time collaboration features
- Advanced checkpoint management UI

## Examples

### Example 1: Long-Running Development Task
```bash
# Start a complex development task
claude-flow hive-mind spawn "Build microservices architecture" --max-workers 8

# Work for a while, then pause (Ctrl+C)
# ... later ...

# Resume where you left off
claude-flow hive-mind resume session-xxx --claude
```

### Example 2: Multiple Concurrent Projects
```bash
# List all your sessions
claude-flow hive-mind sessions

# Resume specific project
claude-flow hive-mind resume session-project-a

# Switch to another project
claude-flow hive-mind resume session-project-b
```

### Example 3: Disaster Recovery
```bash
# System crashed? No problem!
# List sessions to find the one you were working on
claude-flow hive-mind sessions

# Resume with full context
claude-flow hive-mind resume session-xxx --claude --verbose
```

## Conclusion

The Hive Mind Resume functionality ensures that no work is lost and complex swarm operations can span multiple sessions seamlessly. With automatic saving, easy resumption, and full Claude Code integration, it provides a robust foundation for long-running AI-coordinated tasks.