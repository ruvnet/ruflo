# Hive Mind SIGINT Handling Implementation

## Overview

This feature implements automatic session pausing when users press Ctrl+C during hive-mind spawn operations. This addresses Issue #325 by ensuring sessions are properly saved and can be resumed later instead of being left in an active but orphaned state.

## Implementation Details

### 1. Core SIGINT Handler in `spawnSwarm` Function

When a hive-mind swarm is spawned, a SIGINT handler is registered to:
- Detect Ctrl+C (SIGINT) signals
- Save the current session state as a checkpoint
- Change session status from 'active' to 'paused'
- Provide clear instructions for resuming the session
- Clean up any running processes gracefully

### 2. Claude Code Process Management

When Claude Code instances are spawned with `--claude` flag:
- Child process PIDs are tracked in the session
- SIGINT handler terminates Claude Code processes gracefully
- Session is paused with checkpoint data including Claude PID
- Child PIDs are removed from session tracking on exit

### 3. Resume Session Handling

When resuming a session:
- Simple SIGINT handler for clean termination only
- No re-pausing of already paused sessions
- Clean removal of signal handlers on process exit

## Key Features

### Automatic Checkpoint Creation
```javascript
const checkpointData = {
  timestamp: new Date().toISOString(),
  swarmId,
  objective,
  workerCount: workers.length,
  workerTypes,
  status: 'paused_by_user',
  reason: 'User pressed Ctrl+C',
};
```

### Clear User Feedback
```
⏸️  Pausing session...
✓ Session paused successfully

To resume this session, run:
  claude-flow hive-mind resume session-1234567890-abc123
```

### Process Tracking
- Parent process PID stored in session
- Child process PIDs tracked and managed
- Clean termination of all related processes

## Usage Examples

### Basic Usage
```bash
# Start a hive-mind session
$ claude-flow hive-mind spawn "Build a REST API"
✓ Swarm is ready for coordination
💡 To pause: Press Ctrl+C to safely pause and resume later
💡 To resume: claude-flow hive-mind resume session-123

# Press Ctrl+C
^C
⏸️  Pausing session...
✓ Session paused successfully

To resume this session, run:
  claude-flow hive-mind resume session-123
```

### With Claude Code Integration
```bash
# Start with Claude Code
$ claude-flow hive-mind spawn "Research AI trends" --claude
✓ Claude Code launched with Hive Mind coordination

# Press Ctrl+C
^C
⏸️  Pausing session and terminating Claude Code...
✓ Session paused successfully

To resume this session, run:
  claude-flow hive-mind resume session-123
```

## Technical Implementation

### Signal Handlers
- `SIGINT`: Primary handler for Ctrl+C
- `SIGTERM`: Additional handler for graceful termination
- Prevents multiple executions with `isExiting` flag
- Cleans up handlers after process exit

### Database Updates
- Session status updated to 'paused'
- Checkpoint saved with auto-pause name
- Session logs record pause event
- Child PIDs tracked and cleaned up

### Error Handling
- Try-catch blocks for all critical operations
- Graceful degradation if session manager fails
- Clear error messages for debugging
- Process exits with appropriate codes

## Testing

Test coverage includes:
1. Basic SIGINT handling during spawn
2. Checkpoint creation verification
3. Claude Code process termination
4. Session state verification in database
5. Resume functionality after pause

Run tests with:
```bash
npm test tests/hive-mind-sigint.test.js
```

## Benefits

1. **No Lost Work**: Sessions are automatically saved when interrupted
2. **Easy Resume**: Clear instructions for continuing work
3. **Clean Process Management**: No orphaned processes
4. **Better UX**: Users can confidently interrupt long-running operations
5. **Consistent State**: Database and process states remain synchronized

## Future Enhancements

- Add session auto-save intervals during long operations
- Implement session recovery for unexpected crashes
- Add option to disable auto-pause behavior
- Support for distributed session management
- Integration with process monitoring tools