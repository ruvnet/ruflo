/**
 * MCP Governance Policy Enforcer (opt-in).
 *
 * `.harness/mcp-policy.json` declares governance intent (defaultDeny,
 * auditLog, maxToolCallsPerTurn, dangerousPatterns, ...) for the claude-flow
 * MCP server, but until now nothing in the running server (mcp-server.ts)
 * ever read it: `harness mcp-scan` grades the file's *posture* offline, the
 * live `tools/call` dispatch never consulted it. Any connected MCP client
 * could call every registered tool with no audit trail and no call budget.
 *
 * This module wires the policy fields that are actually in this server's
 * jurisdiction:
 *   - `auditLog`: append a JSONL record for every `tools/call`.
 *   - `maxToolCallsPerTurn`: bound calls per MCP *session* (one stdio
 *     process lifetime), deny once exceeded.
 *   - `allowShell` / `allowNetwork` / `allowFileWrite` (dream-cycle
 *     2026-11-26): deny a call when the tool is listed in
 *     `MCP_TOOL_CAPABILITY` below — proven, by two independent research
 *     passes that traced the call chain file:line, to perform that
 *     capability directly inside its own MCP handler — and the
 *     corresponding flag is explicitly `false`. Earlier revisions of this
 *     module claimed these three fields describe only the native-Claude-
 *     Code-tool layer (Bash/Write/Edit/WebFetch) and were "intentionally
 *     left unenforced" here on that basis; that premise was false
 *     (`terminal_execute` runs `execSync` on caller-supplied input,
 *     `http_fetch` performs raw outbound HTTP(S), `hooks_fast-apply` and
 *     `hooks_codemod` write files directly — all inside this MCP server's
 *     own tool surface, not Claude Code's). Scoped to the tools actually
 *     traced end-to-end tonight; a tool not in `MCP_TOOL_CAPABILITY` is
 *     unaffected by these three flags, same as before.
 *
 * Fully opt-in via `RUFLO_MCP_ENFORCE_POLICY=1` (or `true`). Unset/false
 * means every function below is a no-op on the hot path — the pre-existing
 * `tools/call` behavior is unchanged.
 *
 * FAIL-CLOSED once enforcement is enabled (PR #3139 review round 1):
 * a missing/malformed policy file, or a failed mandatory audit-log write,
 * denies the call rather than silently degrading to unrestricted execution.
 * The whole point of opting in is a restriction that actually holds; an
 * enforcement flag that quietly falls back to "no restriction" on its own
 * misconfiguration defeats the feature. See `evaluateToolCall()`.
 *
 * Known scope limits (disclosed, not fixed here):
 *   - Wired into all three stdio `tools/call` dispatchers: the CLI fast
 *     path, the standalone MCP launcher, and MCPServerManager. The separate
 *     HTTP/websocket path (`startHttpServer()`, via `@claude-flow/mcp`)
 *     does not call this module and is unaffected even when this flag is set.
 *
 * `maxToolCallsPerTurn` reset semantics (dream-cycle 2026-09-01, follow-up
 * to 2026-08-31 review round 1): despite the field's name, the original
 * implementation enforced a *session-lifetime cumulative* cap that never
 * reset — a long-lived stdio session could exhaust the budget under
 * entirely legitimate use and stay locked out until the MCP server process
 * restarted. Research that night (see the dream-cycle gist) found: (1) the
 * MCP spec only mandates "rate limit tool invocations" with zero mechanism
 * guidance, and its 2026-07-28 revision (SEP-2567) is actively removing the
 * session concept from the protocol entirely; (2) every framework/product
 * that gets this right (FastMCP's rate-limiting middleware, the PolicyLayer
 * MCP firewall, Cloudflare's public rate limiter) anchors the reset to
 * wall-clock time, not to a turn or session counter that never decays —
 * a turn-count reset is gameable by a chatty loop re-arming its own budget,
 * which wall-clock time is not. This module now enforces a *sliding
 * wall-clock window*: `maxToolCallsPerTurn` calls are allowed per rolling
 * `turnWindowMs` (default 60000) per session, keyed by call timestamp so
 * calls fall out of the window as time passes rather than accumulating
 * forever. `now` is an injectable parameter (defaults to `Date.now`) so
 * production callers need no change and tests stay fully deterministic via
 * `vi.useFakeTimers()`.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface McpPolicy {
  schema?: number;
  policyVersion?: number;
  harnessId?: string;
  defaultDeny?: boolean;
  auditLog?: boolean;
  /** Explicit destination; takes precedence over the environment and project default. */
  auditLogPath?: string;
  /** Maximum bytes per audit segment. Default 10 MiB; oversized records fail closed. */
  auditLogMaxBytes?: number;
  /** Rotated segments retained in addition to the active log. Default 5, maximum 100. */
  auditLogMaxFiles?: number;
  requireApprovalForDangerous?: boolean;
  /** Deny tools in `MCP_TOOL_CAPABILITY` whose capability is 'shell', when explicitly `false`. */
  allowShell?: boolean;
  /** Deny tools in `MCP_TOOL_CAPABILITY` whose capability is 'network', when explicitly `false`. */
  allowNetwork?: boolean;
  /** Deny tools in `MCP_TOOL_CAPABILITY` whose capability is 'fileWrite', when explicitly `false`. */
  allowFileWrite?: boolean;
  toolTimeoutMs?: number;
  /**
   * Despite the name, this is a WALL-CLOCK rate limit, not a literal
   * conversational-turn counter — MCP has no protocol-level concept of a
   * "turn" to count against (confirmed: the spec is silent on it, and its
   * 2026-07-28 revision removes the session concept entirely). Enforced as
   * "at most this many calls in any rolling `turnWindowMs` window" per
   * session. Treat it, and document it to callers, as rate limiting.
   */
  maxToolCallsPerTurn?: number;
  /** Rolling window (ms) over which `maxToolCallsPerTurn` is counted. Default 60000. */
  turnWindowMs?: number;
  dangerousPatterns?: string[];
  approvedServers?: string[];
  [key: string]: unknown;
}

export function isPolicyEnforcementEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.RUFLO_MCP_ENFORCE_POLICY;
  return v === '1' || (v ?? '').toLowerCase() === 'true';
}

export function loadMcpPolicy(
  policyPath: string = path.join(process.cwd(), '.harness', 'mcp-policy.json'),
): McpPolicy | null {
  try {
    const raw = fs.readFileSync(policyPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as McpPolicy;
  } catch {
    return null;
  }
}

const DEFAULT_TURN_WINDOW_MS = 60_000;

interface SessionState {
  /** Timestamps (ms) of calls still believed to be within the current sliding window. */
  callTimes: number[];
}

const sessionState = new Map<string, SessionState>();

/** Test-only: clear per-session call state between test cases. */
export function resetPolicyEnforcerState(): void {
  sessionState.clear();
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
}

export type McpToolCapability = 'shell' | 'network' | 'fileWrite';

/**
 * Tool name -> capability it is proven (dream-cycle 2026-11-26, two
 * independent research passes, file:line traced) to exercise directly
 * inside its own MCP handler: `terminal_execute` (`execSync` on
 * caller-supplied input), `http_fetch` (raw outbound HTTP/S), and
 * `hooks_fast-apply`/`hooks_codemod` (direct `writeFileSync`). This is
 * deliberately the narrow, traced subset, not every tool the broader scan
 * also turned up (github_*, browser_*, several more exec/fetch call
 * sites) — those are a disclosed, not-yet-audited follow-up, not implied
 * safe by omission from this table.
 */
export const MCP_TOOL_CAPABILITY: Readonly<Record<string, McpToolCapability>> = Object.freeze({
  terminal_execute: 'shell',
  http_fetch: 'network',
  'hooks_fast-apply': 'fileWrite',
  hooks_codemod: 'fileWrite',
});

const CAPABILITY_POLICY_FIELD: Readonly<Record<McpToolCapability, 'allowShell' | 'allowNetwork' | 'allowFileWrite'>> =
  Object.freeze({
    shell: 'allowShell',
    network: 'allowNetwork',
    fileWrite: 'allowFileWrite',
  });

/**
 * Denies a call only when `toolName` is in `MCP_TOOL_CAPABILITY` AND the
 * matching `allow*` flag is explicitly `false`. A tool outside the table,
 * or a flag left `undefined`, is unaffected — this closes the gap for the
 * specific tools proven to need it; it does not invent a new default-deny
 * posture for the rest of the ~300-tool surface.
 */
export function checkCapabilityAllowed(policy: McpPolicy, toolName: string): PolicyCheckResult {
  const capability = MCP_TOOL_CAPABILITY[toolName];
  if (!capability) return { allowed: true };
  const field = CAPABILITY_POLICY_FIELD[capability];
  if (policy[field] !== false) return { allowed: true };
  return {
    allowed: false,
    reason: `policy.${field} is false and '${toolName}' performs direct ${capability} access`,
  };
}

/**
 * Checks (and, if allowed, records) a tool call against
 * `policy.maxToolCallsPerTurn`, counted over a sliding window of
 * `policy.turnWindowMs` (default 60000ms) rather than the session's whole
 * lifetime. Calls older than the window are pruned before comparing count
 * to limit, so a session that pauses gets its budget back rather than
 * staying denied until the process restarts. `now` defaults to `Date.now`
 * for production callers; tests inject a controlled clock instead.
 */
export function checkAndRecordCall(
  policy: McpPolicy,
  sessionId: string,
  now: number = Date.now(),
): PolicyCheckResult {
  const limit = policy.maxToolCallsPerTurn;
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return { allowed: true };
  }
  const configuredWindow = policy.turnWindowMs;
  const windowMs =
    typeof configuredWindow === 'number' && Number.isFinite(configuredWindow) && configuredWindow > 0
      ? configuredWindow
      : DEFAULT_TURN_WINDOW_MS;

  const state = sessionState.get(sessionId) ?? { callTimes: [] };
  const cutoff = now - windowMs;
  state.callTimes = state.callTimes.filter((t) => t > cutoff);

  if (state.callTimes.length >= limit) {
    sessionState.set(sessionId, state);
    return {
      allowed: false,
      reason: `maxToolCallsPerTurn (${limit}) exceeded within the last ${windowMs}ms for this session`,
    };
  }
  state.callTimes.push(now);
  sessionState.set(sessionId, state);
  return { allowed: true };
}

export interface AuditLogEntry {
  timestamp: string;
  sessionId: string;
  toolName: string;
  allowed: boolean;
  reason?: string;
  projectPath?: string;
}

let auditLogPathOverride: string | null = null;

/** Test-only: redirect the audit log to a temp file instead of the default path. */
export function setAuditLogPathForTesting(p: string | null): void {
  auditLogPathOverride = p;
}

export function getAuditLogPath(options: Pick<McpPolicy, 'auditLogPath'> = {}): string {
  if (auditLogPathOverride !== null) return auditLogPathOverride;
  if (options.auditLogPath !== undefined &&
      (typeof options.auditLogPath !== 'string' || options.auditLogPath.trim().length === 0)) {
    throw new Error('auditLogPath must be a non-empty string');
  }
  // Precedence: explicit caller/policy destination, environment, project default.
  const configured = options.auditLogPath ?? process.env.RUFLO_MCP_AUDIT_LOG_PATH;
  return configured
    ? path.resolve(process.cwd(), configured)
    : path.join(process.cwd(), '.claude-flow', 'logs', 'mcp-audit.jsonl');
}

/**
 * Appends one JSONL audit record. Returns `true` if `policy.auditLog` is not
 * set (nothing was required) or the write succeeded; `false` only when
 * `auditLog` is required and the write itself failed (disk full, unwritable
 * path, etc). Never throws — the caller (`evaluateToolCall`) decides what a
 * failed *mandatory* write means for the call (fail-closed: deny it).
 */
export function appendAuditLog(policy: McpPolicy, entry: AuditLogEntry): boolean {
  if (!policy.auditLog) return true;
  try {
    const maxBytes = policy.auditLogMaxBytes ?? 10 * 1024 * 1024;
    const maxFiles = policy.auditLogMaxFiles ?? 5;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 ||
        !Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 100) return false;
    const line = `${JSON.stringify({ ...entry, projectPath: path.resolve(process.cwd()) })}\n`;
    const bytes = Buffer.byteLength(line, 'utf8');
    if (bytes > maxBytes) return false;

    const logPath = getAuditLogPath(policy);
    fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
    // All writers of a configured path serialize rotation AND append. On
    // contention (or a stale lock after a crash), deny rather than lose audit
    // evidence by racing a rename. Only the lock owner removes its lock.
    const lockPath = `${logPath}.lock`;
    const lock = fs.openSync(lockPath, 'wx', 0o600);
    try {
      let size = 0;
      try {
        const stat = fs.lstatSync(logPath);
        if (!stat.isFile()) throw new Error('Audit log is not a regular file');
        size = stat.size;
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (size + bytes > maxBytes) {
        // Validate the entire chain before moving or expiring any evidence.
        for (let index = 1; index <= maxFiles; index++) {
          try { if (!fs.lstatSync(`${logPath}.${index}`).isFile()) throw new Error('Audit segment is not a regular file'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        for (let index = maxFiles; index >= 1; index--) {
          const source = index === 1 ? logPath : `${logPath}.${index - 1}`;
          const target = `${logPath}.${index}`;
          if (index === maxFiles) {
            try { fs.unlinkSync(target); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          }
          try { fs.renameSync(source, target); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
      }
      fs.appendFileSync(logPath, line, { encoding: 'utf8', mode: 0o600 });
      return true;
    } finally {
      fs.closeSync(lock);
      fs.unlinkSync(lockPath);
    }
  } catch {
    return false;
  }
}

/**
 * Single enforcement entry point for a `tools/call` dispatch. Combines, in
 * order: fail-closed on a missing/malformed policy, the `allowShell`/
 * `allowNetwork`/`allowFileWrite` capability check (`checkCapabilityAllowed`),
 * the per-session call budget, and fail-closed on a failed mandatory
 * audit-log write. A capability denial skips the budget check entirely —
 * it is not counted against `maxToolCallsPerTurn`. `policy` is the result
 * of `loadMcpPolicy()` — pass `null` straight through when it failed to
 * load, rather than re-deciding that here.
 */
export function evaluateToolCall(
  policy: McpPolicy | null,
  sessionId: string,
  toolName: string,
  now: number = Date.now(),
): PolicyCheckResult {
  if (policy === null) {
    return {
      allowed: false,
      reason: 'RUFLO_MCP_ENFORCE_POLICY is set but .harness/mcp-policy.json is missing or invalid — failing closed',
    };
  }

  const capability = checkCapabilityAllowed(policy, toolName);
  const budget = capability.allowed ? checkAndRecordCall(policy, sessionId, now) : capability;
  const auditOk = appendAuditLog(policy, {
    timestamp: new Date(now).toISOString(),
    sessionId,
    toolName,
    allowed: budget.allowed,
    reason: budget.reason,
  });

  if (!budget.allowed) return budget;
  if (!auditOk) {
    return {
      allowed: false,
      reason: 'audit log write failed and policy.auditLog is required — failing closed',
    };
  }
  return { allowed: true };
}
