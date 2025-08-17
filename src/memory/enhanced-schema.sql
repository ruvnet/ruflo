-- Enhanced SQLite Schema for .swarm/memory.db
-- Additional tables for comprehensive swarm coordination

-- 1. Session Management (for resuming work)
CREATE TABLE IF NOT EXISTS session_state (
    session_id TEXT PRIMARY KEY,
    user_id TEXT,
    project_path TEXT,
    active_branch TEXT,
    last_activity INTEGER,
    state TEXT, -- active, paused, completed
    context TEXT, -- JSON with current task, open files, cursor positions
    environment TEXT -- JSON with env vars, tool versions
);

-- 2. MCP Tool Usage Analytics
CREATE TABLE IF NOT EXISTS mcp_tool_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL,
    session_id TEXT,
    timestamp INTEGER DEFAULT (strftime('%s', 'now')),
    arguments TEXT, -- JSON
    result_summary TEXT,
    execution_time_ms INTEGER,
    success BOOLEAN,
    error_message TEXT
);

-- 3. Training Data for Neural Patterns
CREATE TABLE IF NOT EXISTS training_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_type TEXT, -- code_style, error_fix, refactor, etc
    input_context TEXT,
    action_taken TEXT,
    outcome TEXT,
    success_score REAL,
    timestamp INTEGER DEFAULT (strftime('%s', 'now')),
    model_version TEXT,
    feedback TEXT -- user feedback if provided
);

-- 4. Code Context and Patterns
CREATE TABLE IF NOT EXISTS code_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT,
    pattern_name TEXT,
    pattern_content TEXT,
    language TEXT,
    frequency INTEGER DEFAULT 1,
    last_used INTEGER,
    effectiveness_score REAL,
    UNIQUE(file_path, pattern_name)
);

-- 5. Agent Collaboration History
CREATE TABLE IF NOT EXISTS agent_interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_agent TEXT,
    target_agent TEXT,
    message_type TEXT, -- request, response, broadcast
    content TEXT,
    task_id TEXT,
    timestamp INTEGER DEFAULT (strftime('%s', 'now')),
    correlation_id TEXT
);

-- 6. Project Knowledge Graph
CREATE TABLE IF NOT EXISTS knowledge_graph (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT, -- file, function, class, module, concept
    entity_name TEXT,
    entity_path TEXT,
    relationships TEXT, -- JSON array of related entities
    metadata TEXT, -- JSON with additional info
    embedding BLOB, -- Vector embedding for similarity search
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 7. Error Recovery and Learning
CREATE TABLE IF NOT EXISTS error_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    error_type TEXT,
    error_message TEXT,
    stack_trace TEXT,
    context TEXT, -- What was being attempted
    resolution TEXT, -- How it was fixed
    prevention_strategy TEXT,
    occurrence_count INTEGER DEFAULT 1,
    last_seen INTEGER DEFAULT (strftime('%s', 'now')),
    UNIQUE(error_type, error_message)
);

-- 8. Task Dependencies and Flow
CREATE TABLE IF NOT EXISTS task_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT,
    depends_on TEXT, -- task_id of dependency
    dependency_type TEXT, -- blocking, optional, parallel
    status TEXT, -- pending, satisfied, failed
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 9. Performance Benchmarks
CREATE TABLE IF NOT EXISTS performance_benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_type TEXT,
    operation_details TEXT,
    duration_ms INTEGER,
    memory_used_mb REAL,
    cpu_percent REAL,
    timestamp INTEGER DEFAULT (strftime('%s', 'now')),
    session_id TEXT,
    optimization_applied TEXT
);

-- 10. User Preferences and Learning
CREATE TABLE IF NOT EXISTS user_preferences (
    preference_key TEXT PRIMARY KEY,
    preference_value TEXT,
    category TEXT, -- coding_style, tool_usage, communication
    learned_from TEXT, -- explicit, inferred
    confidence_score REAL,
    last_updated INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_session_activity ON session_state(last_activity);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_timestamp ON mcp_tool_usage(timestamp);
CREATE INDEX IF NOT EXISTS idx_training_pattern ON training_data(pattern_type);
CREATE INDEX IF NOT EXISTS idx_agent_task ON agent_interactions(task_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge_graph(entity_type);
CREATE INDEX IF NOT EXISTS idx_error_type ON error_patterns(error_type);
CREATE INDEX IF NOT EXISTS idx_task_deps ON task_dependencies(task_id);

-- Views for common queries
CREATE VIEW IF NOT EXISTS active_sessions AS
SELECT * FROM session_state 
WHERE state = 'active' 
ORDER BY last_activity DESC;

CREATE VIEW IF NOT EXISTS frequent_errors AS
SELECT error_type, error_message, occurrence_count, resolution
FROM error_patterns
WHERE occurrence_count > 1
ORDER BY occurrence_count DESC;

CREATE VIEW IF NOT EXISTS tool_effectiveness AS
SELECT tool_name, 
       COUNT(*) as usage_count,
       AVG(CASE WHEN success THEN 1 ELSE 0 END) * 100 as success_rate,
       AVG(execution_time_ms) as avg_time_ms
FROM mcp_tool_usage
GROUP BY tool_name;