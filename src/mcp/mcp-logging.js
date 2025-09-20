// Centralized logging configuration for claude-flow
const path = require('path');
const fs = require('fs');
const { createLogger, format, transports } = require('winston');

// Ensure log directory exists
const logDir = path.join(process.env.HOME, '.claude', 'logs', 'mcp', 'claude-flow');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// Create logger with centralized configuration
const logger = createLogger({
    level: process.env.MCP_LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.json()
    ),
    defaultMeta: { 
        service: 'mcp-claude-flow',
        server: 'claude-flow'
    },
    transports: [
        // Console transport
        new transports.Console({
            format: format.simple()
        }),
        // File transport with daily rotation
        new transports.File({
            filename: path.join(logDir, 'claude-flow.log'),
            maxsize: 10485760, // 10MB
            maxFiles: 7
        })
    ]
});

// Log startup
logger.info('MCP server initialized', {
    event: 'startup',
    logDir: logDir
});

module.exports = logger;
