/**
 * Configuration Reader for UI Components
 * 
 * This module provides utilities to read configuration from claude-flow.config.json
 * for use in UI components, particularly for dynamic port configuration.
 * 
 * Author: Claude-Flow UI Port Patch
 * Date: 2025-08-16
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Get the configured port from claude-flow.config.json
 * @param {number} defaultPort - Default port to use if config not found
 * @returns {number} The configured port or default
 */
export function getConfiguredPort(defaultPort = 3000) {
  const configPaths = [
    'claude-flow.config.json',
    join(process.cwd(), 'claude-flow.config.json'),
    join(process.env.HOME || '', 'claude-flow.config.json'),
    '/home/devops/claude-flow.config.json'
  ];

  for (const configPath of configPaths) {
    try {
      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        // Check multiple possible locations for port config
        const port = config?.server?.port || 
                    config?.mcp?.port || 
                    config?.ui?.port ||
                    config?.port;
        
        if (port && typeof port === 'number') {
          console.log(`✅ Using port ${port} from ${configPath}`);
          return port;
        }
      }
    } catch (err) {
      // Continue to next path
    }
  }

  console.log(`⚠️ No config found, using default port ${defaultPort}`);
  return defaultPort;
}

/**
 * Get the full server URL with dynamic port
 * @param {string} protocol - Protocol to use (http/https)
 * @param {string} hostname - Hostname to use
 * @returns {string} Full server URL
 */
export function getServerUrl(protocol = 'http', hostname = 'localhost') {
  const port = getConfiguredPort();
  return `${protocol}://${hostname}:${port}`;
}

/**
 * Get WebSocket URL with dynamic port
 * @param {string} hostname - Hostname to use
 * @returns {string} WebSocket URL
 */
export function getWebSocketUrl(hostname = 'localhost') {
  const port = getConfiguredPort();
  return `ws://${hostname}:${port}`;
}

// For browser environments, provide a fetch-based config reader
export async function getConfiguredPortAsync(defaultPort = 3000) {
  if (typeof window !== 'undefined') {
    try {
      // Try to fetch config from server endpoint
      const response = await fetch('/api/config/port');
      if (response.ok) {
        const data = await response.json();
        return data.port || defaultPort;
      }
    } catch (err) {
      // Fall back to default
    }
  }
  
  // For Node.js environments
  return getConfiguredPort(defaultPort);
}

export default {
  getConfiguredPort,
  getServerUrl,
  getWebSocketUrl,
  getConfiguredPortAsync
};