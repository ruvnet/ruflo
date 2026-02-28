#!/usr/bin/env python3
"""
Claude-Flow Kanban Dashboard
A localhost kanban board for managing tasks and agents with claude-flow.

Run: python server.py
Open: http://localhost:3333
"""

import asyncio
import json
import sqlite3
import subprocess
import uuid
from datetime import datetime
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Form, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import uvicorn

# Database setup
DB_PATH = Path(__file__).parent / "kanban.db"
CLAUDE_FLOW_CMD = "npx @claude-flow/cli@latest"

def get_db():
    """Get database connection with row factory."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database schema."""
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'backlog',
            agent_type TEXT,
            agent_id TEXT,
            priority INTEGER DEFAULT 0,
            created_at TEXT,
            updated_at TEXT,
            completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS agents (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            status TEXT DEFAULT 'idle',
            task_id TEXT,
            spawned_at TEXT,
            last_active TEXT,
            FOREIGN KEY (task_id) REFERENCES tasks(id)
        );

        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            action TEXT,
            task_id TEXT,
            agent_id TEXT,
            details TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    """)
    conn.commit()
    conn.close()

def log_activity(action: str, task_id: str = None, agent_id: str = None, details: str = None):
    """Log an activity to the database."""
    conn = get_db()
    conn.execute(
        "INSERT INTO activity_log (timestamp, action, task_id, agent_id, details) VALUES (?, ?, ?, ?, ?)",
        (datetime.now().isoformat(), action, task_id, agent_id, details)
    )
    conn.commit()
    conn.close()

# FastAPI app
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(title="Claude-Flow Kanban", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")
templates = Jinja2Templates(directory=Path(__file__).parent / "templates")

# Agent types available in claude-flow
AGENT_TYPES = [
    {"id": "coder", "name": "Coder", "icon": "💻", "desc": "Code generation & refactoring"},
    {"id": "tester", "name": "Tester", "icon": "🧪", "desc": "Write tests & QA"},
    {"id": "reviewer", "name": "Reviewer", "icon": "👀", "desc": "Code review & security"},
    {"id": "architect", "name": "Architect", "icon": "🏗️", "desc": "System design"},
    {"id": "researcher", "name": "Researcher", "icon": "🔍", "desc": "Research & analysis"},
    {"id": "debugger", "name": "Debugger", "icon": "🐛", "desc": "Bug fixing"},
    {"id": "documenter", "name": "Documenter", "icon": "📝", "desc": "Documentation"},
    {"id": "security-auditor", "name": "Security", "icon": "🔒", "desc": "Security audit"},
]

STATUSES = [
    {"id": "backlog", "name": "Backlog", "color": "gray"},
    {"id": "active", "name": "Active", "color": "blue"},
    {"id": "review", "name": "Review", "color": "yellow"},
    {"id": "done", "name": "Done", "color": "green"},
]

# Routes
@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Main kanban board view."""
    conn = get_db()
    tasks = conn.execute("SELECT * FROM tasks ORDER BY priority DESC, created_at DESC").fetchall()
    agents = conn.execute("SELECT * FROM agents ORDER BY spawned_at DESC").fetchall()
    recent_activity = conn.execute(
        "SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT 10"
    ).fetchall()
    conn.close()

    # Group tasks by status
    tasks_by_status = {s["id"]: [] for s in STATUSES}
    for task in tasks:
        if task["status"] in tasks_by_status:
            tasks_by_status[task["status"]].append(dict(task))

    return templates.TemplateResponse("index.html", {
        "request": request,
        "tasks_by_status": tasks_by_status,
        "statuses": STATUSES,
        "agents": [dict(a) for a in agents],
        "agent_types": AGENT_TYPES,
        "recent_activity": [dict(a) for a in recent_activity],
    })

@app.post("/tasks", response_class=HTMLResponse)
async def create_task(
    request: Request,
    title: str = Form(...),
    description: str = Form(""),
    agent_type: str = Form(None)
):
    """Create a new task."""
    task_id = f"task-{uuid.uuid4().hex[:8]}"
    now = datetime.now().isoformat()

    conn = get_db()
    conn.execute(
        "INSERT INTO tasks (id, title, description, agent_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (task_id, title, description, agent_type, now, now)
    )
    conn.commit()
    conn.close()

    log_activity("task_created", task_id=task_id, details=title)
    return RedirectResponse(url="/", status_code=303)

@app.post("/tasks/{task_id}/move")
async def move_task(task_id: str, status: str = Form(...)):
    """Move a task to a different status column."""
    now = datetime.now().isoformat()
    completed_at = now if status == "done" else None

    conn = get_db()
    conn.execute(
        "UPDATE tasks SET status = ?, updated_at = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?",
        (status, now, completed_at, task_id)
    )
    conn.commit()
    conn.close()

    log_activity("task_moved", task_id=task_id, details=f"Moved to {status}")
    return {"success": True}

@app.post("/tasks/{task_id}/assign")
async def assign_agent(task_id: str, agent_type: str = Form(...)):
    """Assign an agent type to a task and spawn the agent."""
    now = datetime.now().isoformat()
    agent_id = f"agent-{uuid.uuid4().hex[:8]}"
    agent_name = f"{agent_type}-{task_id[-8:]}"

    conn = get_db()

    # Update task with agent assignment
    conn.execute(
        "UPDATE tasks SET agent_type = ?, agent_id = ?, status = 'active', updated_at = ? WHERE id = ?",
        (agent_type, agent_id, now, task_id)
    )

    # Create agent record
    conn.execute(
        "INSERT INTO agents (id, name, type, status, task_id, spawned_at, last_active) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (agent_id, agent_name, agent_type, "running", task_id, now, now)
    )
    conn.commit()
    conn.close()

    # Spawn agent via claude-flow CLI (async, non-blocking)
    asyncio.create_task(spawn_agent_async(agent_type, agent_name, agent_id))

    log_activity("agent_assigned", task_id=task_id, agent_id=agent_id, details=f"Spawned {agent_type}")
    return {"success": True, "agent_id": agent_id}

async def spawn_agent_async(agent_type: str, agent_name: str, agent_id: str):
    """Spawn an agent via claude-flow CLI asynchronously."""
    try:
        proc = await asyncio.create_subprocess_shell(
            f"{CLAUDE_FLOW_CMD} agent spawn --type {agent_type} --name {agent_name}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()

        # Update agent status based on result
        status = "running" if proc.returncode == 0 else "error"
        conn = get_db()
        conn.execute(
            "UPDATE agents SET status = ?, last_active = ? WHERE id = ?",
            (status, datetime.now().isoformat(), agent_id)
        )
        conn.commit()
        conn.close()

        if proc.returncode != 0:
            log_activity("agent_error", agent_id=agent_id, details=stderr.decode()[:200])
    except Exception as e:
        log_activity("agent_error", agent_id=agent_id, details=str(e)[:200])

@app.post("/tasks/{task_id}/delete")
async def delete_task(task_id: str):
    """Delete a task."""
    conn = get_db()
    conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.execute("DELETE FROM agents WHERE task_id = ?", (task_id,))
    conn.commit()
    conn.close()

    log_activity("task_deleted", task_id=task_id)
    return {"success": True}

@app.get("/agents")
async def list_agents():
    """Get list of all agents."""
    conn = get_db()
    agents = conn.execute("SELECT * FROM agents ORDER BY spawned_at DESC").fetchall()
    conn.close()
    return {"agents": [dict(a) for a in agents]}

@app.post("/agents/{agent_id}/stop")
async def stop_agent(agent_id: str):
    """Stop an agent."""
    conn = get_db()
    conn.execute(
        "UPDATE agents SET status = 'stopped', last_active = ? WHERE id = ?",
        (datetime.now().isoformat(), agent_id)
    )
    conn.commit()
    conn.close()

    # Try to stop via CLI
    try:
        subprocess.run(
            f"{CLAUDE_FLOW_CMD} agent stop {agent_id}",
            shell=True, capture_output=True, timeout=5
        )
    except:
        pass

    log_activity("agent_stopped", agent_id=agent_id)
    return {"success": True}

@app.get("/status")
async def get_status():
    """Get claude-flow status."""
    try:
        result = subprocess.run(
            f"{CLAUDE_FLOW_CMD} status --json",
            shell=True, capture_output=True, text=True, timeout=10
        )
        return {"status": "connected", "output": result.stdout}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.get("/activity")
async def get_activity(limit: int = 20):
    """Get recent activity log."""
    conn = get_db()
    activity = conn.execute(
        "SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return {"activity": [dict(a) for a in activity]}

# Health check
@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}

if __name__ == "__main__":
    print("\n🎯 Claude-Flow Kanban Dashboard")
    print("=" * 40)
    print(f"📍 Open: http://localhost:3333")
    print(f"💾 Database: {DB_PATH}")
    print("=" * 40 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=3333, log_level="info")
