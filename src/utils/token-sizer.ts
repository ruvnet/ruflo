import { MCPTool } from './types.js';

/**
 * Calculate the token size of an MCP tool
 * Uses a simple approximation of JSON string length / 4
 * Returns an integer with a minimum of 1
 * 
 * @param tool The MCP tool to calculate token size for
 * @returns Token count as an integer, minimum 1
 */
export function tokenSizer(tool: MCPTool): number {
  // Simple token calculation based on JSON string length
  // In a real implementation, use a proper tokenizer
  const rawTokens = JSON.stringify(tool).length / 4;
  return Math.max(1, Math.ceil(rawTokens));
}