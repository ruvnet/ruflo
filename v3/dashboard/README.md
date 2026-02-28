# Claude-Flow Kanban Dashboard

A localhost kanban board for managing tasks and agents with [claude-flow](https://github.com/ruvnet/claude-flow).

![Kanban Board](https://img.shields.io/badge/status-beta-blue)

## Features

- 🎯 **Visual Kanban Board** - Drag & drop tasks between columns
- 🤖 **Agent Integration** - Spawn claude-flow agents directly from tasks
- 💾 **Persistent State** - SQLite database survives restarts
- 📜 **Activity Log** - Track all task and agent activity
- 🔄 **Live Updates** - Auto-refresh status indicators

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Start the dashboard
python server.py

# Open in browser
open http://localhost:3333
```

## Usage

### Creating Tasks

1. Enter a task title and optional description
2. Optionally select an agent type to auto-assign
3. Click "Add Task"

### Managing Tasks

- **Drag & Drop** - Move tasks between columns (Backlog → Active → Review → Done)
- **Assign Agent** - Select an agent type from the dropdown on any task
- **Delete** - Click the ✕ button to remove a task

### Agent Types

| Agent | Purpose |
|-------|---------|
| 💻 Coder | Code generation & refactoring |
| 🧪 Tester | Write tests & QA |
| 👀 Reviewer | Code review & security |
| 🏗️ Architect | System design |
| 🔍 Researcher | Research & analysis |
| 🐛 Debugger | Bug fixing |
| 📝 Documenter | Documentation |
| 🔒 Security | Security audit |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Main kanban board |
| `/tasks` | POST | Create a new task |
| `/tasks/{id}/move` | POST | Move task to new status |
| `/tasks/{id}/assign` | POST | Assign agent to task |
| `/tasks/{id}/delete` | POST | Delete a task |
| `/agents` | GET | List all agents |
| `/agents/{id}/stop` | POST | Stop an agent |
| `/status` | GET | Get claude-flow status |
| `/activity` | GET | Get activity log |
| `/health` | GET | Health check |

## Database Schema

SQLite database stored at `./kanban.db`:

- **tasks** - Task records with status, agent assignment
- **agents** - Agent records with status, task linkage
- **activity_log** - Audit trail of all actions

## Configuration

Environment variables:

```bash
# Default port
PORT=3333

# Claude-flow CLI command
CLAUDE_FLOW_CMD="npx @claude-flow/cli@latest"
```

## License

MIT - Part of the [claude-flow](https://github.com/ruvnet/claude-flow) project.
