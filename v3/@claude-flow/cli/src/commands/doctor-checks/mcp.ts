/**
 * Doctor checks for MCP server configuration and schema overhead.
 * Split out of commands/doctor.ts (#4773).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { HealthCheck } from './shared.js';

// Check MCP servers
export async function checkMcpServers(): Promise<HealthCheck> {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  // #1842: ~/.claude.json holds project-scoped registrations under
  // parsed.projects[<projectPath>].mcpServers.ruflo, in addition to any
  // top-level mcpServers. Check both shapes plus the legacy desktop and
  // local .mcp.json paths.
  const mcpConfigPaths = [
    join(home, '.claude.json'),
    join(home, '.claude/claude_desktop_config.json'),
    join(home, '.config/claude/mcp.json'),
    '.mcp.json',
  ];

  const isRufloKey = (k: string) =>
    k === 'ruflo' || k === 'ruflo_alpha' || k === 'claude-flow' || k === 'claude-flow_alpha';
  // Canonical MCP-server key is `claude-flow` — matches the `mcp__claude-flow__*`
  // prefix that ~166 plugin tool references depend on (#2206). A `ruflo`-keyed
  // entry pointing at the same binary is the legacy duplicate created by
  // pre-rename setup docs that #2612 tracks; doctor treats it as removable.
  const isCurrentRufloKey = (k: string) => k === 'claude-flow' || k === 'claude-flow_alpha';
  const isLegacyRufloKey = (k: string) => k === 'ruflo' || k === 'ruflo_alpha';
  const isRufloServer = (server: unknown): boolean => {
    if (!server || typeof server !== 'object') return false;
    const entry = server as { command?: unknown; args?: unknown };
    const command = typeof entry.command === 'string' ? entry.command : '';
    const args = Array.isArray(entry.args)
      ? entry.args.filter((arg): arg is string => typeof arg === 'string')
      : [];
    const haystack = [command, ...args].join(' ');
    return /\b(?:ruflo|claude-flow|@claude-flow\/cli)(?:@[\w.-]+)?\b/.test(haystack);
  };

  let totalServersSeen = 0;
  const rufloLocations: string[] = [];
  const duplicateLocations: string[] = [];
  const legacyLocations: string[] = [];
  const currentLocations: string[] = [];

  const inspectServers = (
    servers: unknown,
    location: string
  ): { total: number; hasRuflo: boolean } => {
    if (!servers || typeof servers !== 'object') return { total: 0, hasRuflo: false };

    const entries = Object.entries(servers as Record<string, unknown>);
    const activeRufloEntries = entries.filter(([key, server]) => isRufloKey(key) && isRufloServer(server));
    const hasLegacy = activeRufloEntries.some(([key]) => isLegacyRufloKey(key));
    const hasCurrent = activeRufloEntries.some(([key]) => isCurrentRufloKey(key));

    if (activeRufloEntries.length > 0) {
      rufloLocations.push(`${location}: ${activeRufloEntries.map(([key]) => key).join(', ')}`);
    }
    if (hasLegacy && hasCurrent) {
      duplicateLocations.push(`${location}: ${activeRufloEntries.map(([key]) => key).join(' + ')}`);
    }
    for (const [key] of activeRufloEntries) {
      if (isLegacyRufloKey(key)) legacyLocations.push(`${location}: ${key}`);
      if (isCurrentRufloKey(key)) currentLocations.push(`${location}: ${key}`);
    }

    return { total: entries.length, hasRuflo: activeRufloEntries.length > 0 };
  };

  for (const configPath of mcpConfigPaths) {
    if (!existsSync(configPath)) continue;
    try {
      const content = JSON.parse(readFileSync(configPath, 'utf8'));
      // Top-level mcpServers (legacy / desktop form)
      const topResult = inspectServers(content.mcpServers || content.servers || {}, `${configPath} top-level`);
      totalServersSeen += topResult.total;

      // Project-scoped (Claude Code shape): projects[*].mcpServers.ruflo
      if (content.projects && typeof content.projects === 'object') {
        for (const [projectKey, projectVal] of Object.entries(content.projects)) {
          const pm = (projectVal as { mcpServers?: Record<string, unknown> })?.mcpServers;
          if (pm && typeof pm === 'object') {
            const projectResult = inspectServers(pm, `${configPath} projects[${projectKey}]`);
            totalServersSeen += projectResult.total;
          }
        }
      }
    } catch {
      // continue to next path
    }
  }

  if (duplicateLocations.length > 0 || (legacyLocations.length > 0 && currentLocations.length > 0)) {
    const locations = duplicateLocations.length > 0
      ? duplicateLocations.join('; ')
      : `legacy ${legacyLocations.join('; ')} + current ${currentLocations.join('; ')}`;
    return {
      name: 'MCP Servers',
      status: 'warn',
      message: `Duplicate Ruflo MCP registrations found (${locations}) — Claude Code will start both tool schemas`,
      fix: 'Remove the legacy `ruflo`-keyed MCP registration (pre-rename duplicate) and keep the canonical `claude-flow` entry: `claude mcp add claude-flow -- npx -y ruflo@latest mcp start`. The canonical key stays `claude-flow` so the ~166 `mcp__claude-flow__*` plugin tool references keep resolving (#2206).',
    };
  }

  if (rufloLocations.length > 0) {
    return {
      name: 'MCP Servers',
      status: 'pass',
      message: `${totalServersSeen} servers (ruflo configured: ${rufloLocations.join('; ')})`,
    };
  }

  if (totalServersSeen > 0) {
    return {
      name: 'MCP Servers',
      status: 'warn',
      message: `${totalServersSeen} servers (ruflo not found)`,
      fix: 'claude mcp add claude-flow -- npx -y ruflo@latest mcp start',
    };
  }

  return {
    name: 'MCP Servers',
    status: 'warn',
    message: 'No MCP config found',
    fix: 'claude mcp add ruflo -- npx -y ruflo@latest mcp start',
  };
}

// #2726 — tools/list is fixed prompt overhead on clients/backends that do not
// defer MCP schemas. Measure the actual live registry and warn before a small
// context window becomes unrecoverable even after compaction.
export async function checkMcpSchemaOverhead(): Promise<HealthCheck> {
  try {
    const [{ listMCPTools }, {
      assessMcpSchemaOverhead,
      filterAdvertisedMcpTools,
      parseMcpToolSelection,
    }] = await Promise.all([
      import('../../mcp-client.js'),
      import('../../mcp-server.js'),
    ]);
    // The `mcp start --tools` CLI flag takes precedence when the server is
    // constructed. Doctor intentionally inspects the environment fallback so
    // its estimate describes the configuration inherited by MCP clients.
    const selection = parseMcpToolSelection(process.env.CLAUDE_FLOW_MCP_TOOLS);
    const tools = filterAdvertisedMcpTools(listMCPTools(), selection);
    // This is diagnostic metadata about the external client's context window,
    // not Ruflo command configuration, so there is no corresponding CLI flag.
    const rawWindow = process.env.CLAUDE_FLOW_CONTEXT_WINDOW_TOKENS;
    const contextWindow = rawWindow ? Number.parseInt(rawWindow, 10) : undefined;
    const assessment = assessMcpSchemaOverhead(tools, contextWindow);
    const ratio = assessment.ratio === undefined
      ? ''
      : `, ${(assessment.ratio * 100).toFixed(1)}% of ${assessment.contextWindowTokens}-token window`;
    const selectionLabel = selection === 'all' ? 'all tools' : `filtered: ${selection.join(',')}`;
    const message = `${assessment.toolCount} advertised tools ≈ ${assessment.estimatedTokens} schema tokens (${selectionLabel}${ratio})`;

    if (assessment.risk === 'high') {
      return {
        name: 'MCP Schema Overhead',
        status: 'warn',
        message,
        fix: 'Set CLAUDE_FLOW_MCP_TOOLS to required categories/tool names (for example: memory,swarm,agent,hooks) and optionally CLAUDE_FLOW_CONTEXT_WINDOW_TOKENS to your backend limit.',
      };
    }
    return { name: 'MCP Schema Overhead', status: 'pass', message };
  } catch (error) {
    return {
      name: 'MCP Schema Overhead',
      status: 'warn',
      message: `Unable to measure: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
