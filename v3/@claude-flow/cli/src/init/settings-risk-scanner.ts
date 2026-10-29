/**
 * Static, non-blocking risk scanner for pre-existing .claude/settings.json
 * content that `ruflo init`/`ruflo init --upgrade` carry forward unexamined.
 *
 * `mergeSettingsForUpgrade()` and `writeSettings()` both read a target
 * project's *existing* settings.json off disk and spread its `hooks` /
 * `permissions.allow` entries into the merged output verbatim (see
 * executor.ts:352-353 and :901-912) — the same trust shape as the publicly
 * disclosed CVE-2025-59536 class (a settings.json hook payload achieving
 * command execution with no review step). Ruflo's own hook dispatch is a
 * closed set of internal handlers (hook-handler.cjs), so this isn't
 * remotely exploitable through Ruflo itself — but a malicious fork, PR, or
 * compromised dependency that plants a bad settings.json before a user
 * runs `ruflo init`/`--upgrade` in that directory would have its payload
 * silently preserved and reported as a normal "merged"/"updated" result,
 * with zero visibility.
 *
 * This scanner is advisory-only: it never mutates its input and never
 * blocks a merge/write. Callers decide what to do with the findings
 * (surfaced as a CLI warning today).
 *
 * KNOWN LIMITATION (found by an independent adversarial review the same
 * night this was written — see docs/dream-cycle/dream-gist-2026-08-16.md
 * §5): this is a best-effort, static, blocklist-style heuristic, NOT a
 * security boundary. It catches copy-pasted proof-of-concept payload
 * shapes; it does not and cannot catch every obfuscation a motivated
 * adversary could construct (string-built commands, uncommon interpreters,
 * novel exfil channels, etc). Treat findings as "worth a second look,"
 * never as a guarantee of safety.
 */

export interface SettingsRiskFinding {
  location: string;
  snippet: string;
  reason: string;
}

const DANGEROUS_COMMAND_WORDS = [
  'rm', 'rmdir', 'del', 'format', 'mkfs', 'dd', 'chmod', 'chown',
  'kill', 'killall', 'pkill', 'reboot', 'shutdown', 'poweroff', 'halt',
  'sudo', 'eval',
];

// Words that make a *hook command string* look risky when combined with a
// downloader (curl/wget) or a decode step (base64) anywhere in the same
// string — deliberately co-occurrence-based, not strict adjacency/piping,
// since `curl … -o f && sh f` and `curl … | tee x | bash` both reach the
// same outcome as the textbook `curl … | bash` and a strict pipe-adjacency
// regex misses both (found by adversarial review).
const SHELL_EXEC_WORDS = ['bash', 'sh', 'zsh', 'python', 'python3', 'perl', 'ruby', 'eval'];
const DOWNLOADER_WORDS = ['curl', 'wget'];

const STANDALONE_RISK_PATTERNS: RegExp[] = [
  /\bInvoke-Expression\b/i,
  /\biex\s*\(/i,
  /\/dev\/tcp\//i,
  /\bnc\s+-e\b/i,
  /base64\s+(-d|--decode)\b/i,
];

// Words a Bash allow-rule should never blanket-preapprove without a
// specific argument scope, even though they aren't "dangerous" on their
// own the way `rm`/`chmod` are — pre-approving them removes the human
// review step for exactly the commands download-and-execute attacks use.
const RISKY_PREAPPROVE_WORDS = [...DANGEROUS_COMMAND_WORDS, ...SHELL_EXEC_WORDS, ...DOWNLOADER_WORDS];

// Encoded PowerShell (`powershell[.exe] ... -e|-enc|-encodedcommand <payload>`),
// matched on whitespace-separated tokens in ONE linear pass. The earlier regex
// (`powershell\\s+(?:\\S+\\s+)*?-e...`) is quadratic on repeated "powershell "
// tokens (every start rescans the tail: 256KB measured ~2.5s, 1MB ~40s) because
// the lazy token loop re-runs from each start. Same semantics: a token ending in
// powershell/powershell.exe, then LATER a token that is exactly -e/-enc/
// -encodedcommand, then at least one more token.
function hasEncodedPowershell(command: string): boolean {
  let seenPs = false;
  let pendingEnc = false;
  for (const raw of command.split(/\s+/)) {
    if (!raw) continue;
    if (pendingEnc) return true;
    const t = raw.toLowerCase();
    if (seenPs && (t === '-e' || t === '-enc' || t === '-encodedcommand')) pendingEnc = true;
    else if (t.endsWith('powershell') || t.endsWith('powershell.exe')) seenPs = true;
  }
  return false;
}

function wordBoundaryMatches(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, 'i').test(text);
}

/** Reasons a single hook `command` string looks risky (empty = clean). */
export function scanCommandStringForRisk(command: string): string[] {
  const reasons: string[] = [];

  if (hasEncodedPowershell(command) || STANDALONE_RISK_PATTERNS.some((pattern) => pattern.test(command))) {
    reasons.push('matches a known-dangerous execution pattern (encoded/remote command execution)');
  }

  const hasDownloader = DOWNLOADER_WORDS.some((w) => wordBoundaryMatches(command, w));
  const hasShellExec = SHELL_EXEC_WORDS.some((w) => wordBoundaryMatches(command, w));
  if (hasDownloader && hasShellExec) {
    reasons.push('combines a downloader (curl/wget) with a shell/interpreter invocation in the same command');
  }

  for (const word of DANGEROUS_COMMAND_WORDS) {
    if (wordBoundaryMatches(command, word)) {
      reasons.push(`invokes dangerous command "${word}"`);
    }
  }
  return reasons;
}

/** Reasons a single `permissions.allow` rule string looks risky (empty = clean). */
export function scanAllowRuleForRisk(rule: string): string[] {
  const trimmed = rule.trim();
  const reasons: string[] = [];
  if (/^Bash\(\s*\*\s*(:\s*\*\s*)?\)$/i.test(trimmed)) {
    reasons.push('grants unrestricted Bash execution (wildcard allow rule)');
  }
  for (const word of RISKY_PREAPPROVE_WORDS) {
    if (new RegExp(`^Bash\\(\\s*${word}\\s*(:| |\\))`, 'i').test(trimmed)) {
      reasons.push(`pre-allows "${word}" with no per-call confirmation`);
    }
  }
  return reasons;
}

/**
 * Strips ANSI/control characters from untrusted text before it's ever
 * embedded in a CLI warning string. Without this, a malicious hook command
 * could use escape sequences to spoof or corrupt the terminal output of
 * the very warning meant to flag it (found during this candidate's own
 * security review — not part of the CVE-2025-59536 class itself, but the
 * same "untrusted settings.json content reaches the user's terminal"
 * shape, so it gets the same treatment here rather than being left open).
 */
function sanitizeForDisplay(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function buildSnippet(text: string): string {
  const clean = sanitizeForDisplay(text);
  return clean.length > 120 ? `${clean.slice(0, 120)}…` : clean;
}

/**
 * Scans a settings.json-shaped object's `hooks` and `permissions.allow`
 * for content matching known-dangerous patterns.
 */
export function scanSettingsForRisk(settings: Record<string, unknown>): SettingsRiskFinding[] {
  const findings: SettingsRiskFinding[] = [];

  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (hooks && typeof hooks === 'object') {
    for (const [eventName, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;
      groups.forEach((group, groupIdx) => {
        const hookList = (group as { hooks?: Array<{ command?: unknown }> })?.hooks;
        if (!Array.isArray(hookList)) return;
        hookList.forEach((h, hookIdx) => {
          if (typeof h?.command !== 'string') return;
          for (const reason of scanCommandStringForRisk(h.command)) {
            findings.push({
              location: `hooks.${eventName}[${groupIdx}].hooks[${hookIdx}]`,
              snippet: buildSnippet(h.command),
              reason,
            });
          }
        });
      });
    }
  }

  const allow = (settings.permissions as { allow?: unknown } | undefined)?.allow;
  if (Array.isArray(allow)) {
    allow.forEach((rule, idx) => {
      if (typeof rule !== 'string') return;
      for (const reason of scanAllowRuleForRisk(rule)) {
        findings.push({
          location: `permissions.allow[${idx}]`,
          snippet: buildSnippet(rule),
          reason,
        });
      }
    });
  }

  return findings;
}

/** Formats findings as short, human-readable CLI warning lines. */
export function formatRiskFindingsAsWarnings(findings: SettingsRiskFinding[]): string[] {
  return findings.map((f) => `${f.location}: ${f.reason} — "${f.snippet}"`);
}

// ─── ADR-509 §2.3: project-level auto-approve keys ──────────────────────────
//
// Unlike the advisory scan above, these keys make `ruflo init` / `init upgrade`
// STOP when they would be carried forward (CVE-2025-59536: a repository's
// `enableAllProjectMcpServers: true` started an MCP server before the person
// could read the trust dialog). `--keep-risky-settings` keeps them;
// `--drop-risky-settings` writes the merged file without them.

/** What a finding points at, precisely enough for dropAutoApproveKeys to remove only that. */
export type AutoApproveTarget =
  | { kind: 'enableAllProjectMcpServers' }
  | { kind: 'enabledMcpjsonServers' }
  | { kind: 'defaultMode' }
  | { kind: 'allow'; index: number }
  | { kind: 'hook'; event: string; group: number; hook: number };

export interface AutoApproveFinding extends SettingsRiskFinding {
  target: AutoApproveTarget;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A bare `Bash`, `Bash(*)`, `Bash(*:*)` or a `*` wildcard pre-approves every command. */
function isBlanketAllow(rule: string): boolean {
  const t = rule.trim();
  return t === '*' || /^Bash$/i.test(t) || /^Bash\(\s*\*\s*(:\s*\*\s*)?\)$/i.test(t) || /^\*\s*\(.*\)$/.test(t);
}

/**
 * The auto-approve keys of a PROJECT settings file (`.claude/settings.json` or
 * `.claude/settings.local.json`). `isRufloHook` decides which hook commands are
 * ruflo's own helpers (injected so this module stays dependency-free).
 */
export function scanProjectAutoApproveKeys(settings: Record<string, unknown>, isRufloHook: (command: string) => boolean): AutoApproveFinding[] {
  const out: AutoApproveFinding[] = [];
  if (settings.enableAllProjectMcpServers === true) {
    out.push({ target: { kind: 'enableAllProjectMcpServers' }, location: 'enableAllProjectMcpServers', snippet: 'true', reason: 'starts every .mcp.json server in the project without asking' });
  }
  const enabled = settings.enabledMcpjsonServers;
  if (Array.isArray(enabled) && enabled.length > 0) {
    out.push({ target: { kind: 'enabledMcpjsonServers' }, location: 'enabledMcpjsonServers', snippet: buildSnippet(enabled.map(String).join(', ')), reason: 'pre-approves .mcp.json servers before the trust dialog' });
  }
  const permissions = isRecord(settings.permissions) ? settings.permissions : undefined;
  if (permissions?.defaultMode === 'bypassPermissions') {
    out.push({ target: { kind: 'defaultMode' }, location: 'permissions.defaultMode', snippet: 'bypassPermissions', reason: 'turns off every permission prompt' });
  }
  if (Array.isArray(permissions?.allow)) {
    (permissions!.allow as unknown[]).forEach((rule, index) => {
      if (typeof rule === 'string' && isBlanketAllow(rule)) {
        out.push({ target: { kind: 'allow', index }, location: `permissions.allow[${index}]`, snippet: buildSnippet(rule), reason: 'pre-approves every command (bare Bash or * wildcard)' });
      }
    });
  }
  const hooks = isRecord(settings.hooks) ? settings.hooks : undefined;
  for (const [event, groups] of Object.entries(hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((g, group) => {
      const list = isRecord(g) && Array.isArray(g.hooks) ? g.hooks : [];
      list.forEach((h, hook) => {
        if (!isRecord(h) || typeof h.command !== 'string' || isRufloHook(h.command)) return;
        out.push({ target: { kind: 'hook', event, group, hook }, location: `hooks.${event}[${group}].hooks[${hook}]`, snippet: buildSnippet(h.command), reason: 'runs a command that is not a ruflo helper' });
      });
    });
  }
  return out;
}

/** A deep copy of `settings` without the keys/entries the findings point at. Never mutates its input. */
export function dropAutoApproveKeys(settings: Record<string, unknown>, findings: readonly AutoApproveFinding[]): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(settings)) as Record<string, unknown>;
  const perms = isRecord(next.permissions) ? next.permissions : undefined;
  const allowDrop = new Set<number>();
  const hookDrop = new Set<string>();
  for (const { target: t } of findings) {
    if (t.kind === 'enableAllProjectMcpServers') delete next.enableAllProjectMcpServers;
    else if (t.kind === 'enabledMcpjsonServers') delete next.enabledMcpjsonServers;
    else if (t.kind === 'defaultMode' && perms) delete perms.defaultMode;
    else if (t.kind === 'allow') allowDrop.add(t.index);
    else if (t.kind === 'hook') hookDrop.add(`${t.event}\u0000${t.group}\u0000${t.hook}`);
  }
  if (perms && Array.isArray(perms.allow)) perms.allow = (perms.allow as unknown[]).filter((_, i) => !allowDrop.has(i));
  if (isRecord(next.hooks) && hookDrop.size) {
    for (const [event, groups] of Object.entries(next.hooks)) {
      if (!Array.isArray(groups)) continue;
      const kept = groups
        .map((g, gi) => (isRecord(g) && Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter((_, hi) => !hookDrop.has(`${event}\u0000${gi}\u0000${hi}`)) } : g))
        .filter((g) => !(isRecord(g) && Array.isArray(g.hooks) && g.hooks.length === 0));
      if (kept.length) (next.hooks as Record<string, unknown>)[event] = kept;
      else delete (next.hooks as Record<string, unknown>)[event];
    }
    // No hooks left: drop the key, so init writes its own hooks as it does for a file without any.
    if (Object.keys(next.hooks).length === 0) delete next.hooks;
  }
  return next;
}

/** What `init` does when the existing settings carry auto-approve keys. */
export type RiskySettingsMode = 'stop' | 'keep' | 'drop';

export const RISKY_SETTINGS_HINT = 'Re-run with --drop-risky-settings to write the merged settings without these keys, or --keep-risky-settings to keep them.';
