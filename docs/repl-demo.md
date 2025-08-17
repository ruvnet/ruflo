# Claude-Flow REPL Demo

The Claude-Flow REPL (Read-Eval-Print Loop) provides an interactive shell for managing your AI orchestration system.

## Starting the REPL

```bash
claude-flow repl
```

## Available Commands

### System Commands
- `help` - Show all available commands
- `status` - Display system status
- `config [key]` - Show configuration
- `clear` - Clear the screen
- `history` - Show command history
- `exit` or `quit` - Exit REPL

### Agent Management
```bash
# Spawn a new agent
agent spawn researcher bot1

# List all agents
agent list

# Get agent info
agent info bot1

# Terminate an agent
agent terminate bot1
```

### Task Management
```bash
# Create a task
task create research "Analyze market trends"

# List all tasks
task list

# Assign task to agent
task assign task-123 bot1

# Check task status
task status task-123
```

### Memory Operations
```bash
# Store data
memory store analysis "Market is trending upward"

# Retrieve data
memory get analysis

# List all memory keys
memory list

# Clear memory
memory clear
```

### Terminal Sessions
```bash
# Create terminal
terminal create dev-session

# List terminals
terminal list

# Execute command
terminal exec "ls -la"

# Attach to terminal
terminal attach dev-session

# Detach from terminal
terminal detach
```

### Special Features

**Shell Commands:**
```bash
# Execute shell command with !
!pwd
!ls -la
```

**Search History:**
```bash
# Search command history
/agent
/task create
```

## Interactive Example Session

```
$ claude-flow repl
🧠 Claude-Flow Interactive Shell v1.0.26
Type "help" for available commands, "exit" to quit

claude-flow> status
🟢 Claude-Flow Status:
  Agents: 0 active
  Tasks: 0 in queue
  Terminals: 0 active
  Memory Keys: 0

claude-flow> agent spawn researcher ai-bot
✅ Spawned researcher agent: ai-bot (agent-1234567890)

claude-flow> task create research "Analyze code patterns"
✅ Created task: task-1234567891
  Type: research
  Description: Analyze code patterns

claude-flow> task assign task-1234567891 ai-bot
✅ Assigned task task-1234567891 to agent ai-bot

claude-flow> memory store current_project "claude-flow"
✅ Stored: current_project = claude-flow

claude-flow> !echo "Running shell command"
Running shell command

claude-flow> exit
👋 Exiting Claude-Flow REPL...
```

## Tips

1. Use Tab completion (when available) for command suggestions
2. Use Up/Down arrows to navigate command history
3. The prompt changes when attached to a terminal session
4. All REPL state is maintained in memory during the session
5. Shell commands can be executed directly with the `!` prefix