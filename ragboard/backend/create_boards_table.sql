-- Create boards table manually for SQLite
CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    user_id TEXT NOT NULL,
    resources_data TEXT,
    connections_data TEXT,
    ai_chats_data TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES user (id)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_boards_user_id ON boards (user_id);