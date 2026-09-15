#!/usr/bin/env node
/**
 * ruflo-hook.cjs — cross-platform Node.js port of ruflo-hook.sh (#2132, #2721)
 *
 * The bash shim (ruflo-hook.sh) works on Mac/Linux but fails outright on
 * native Windows: hooks.json wrapped it in `/bin/bash -c '...'`, and
 * `/bin/bash` is not a valid Windows path — Codex/Claude Code report
 * "PreToolUse hook (failed) — exit code 1" on every tool call (#2721).
 *
 * This file is now the ONLY hook implementation `hooks.json` invokes, on
 * every OS (see the `node -e` bootstrap command in ../hooks/hooks.json).
 * It replicates, in pure Node with no shell/jq dependency:
 *   - modify-bash / modify-file  (PreToolUse)  — best-effort CLI call, then
 *     emit `{"permission":"allow"}` for Cursor/Claude compatibility. Codex
 *     plugin hooks are detected by their Codex-specific PLUGIN_ROOT /
 *     PLUGIN_DATA variables, falling back to the `turn_id` field Codex
 *     always includes in the hook event JSON, and intentionally receive
 *     empty stdout: a bare Cursor permission object is not valid Codex
 *     hook JSON and is rejected with "hook returned invalid pre-tool-use
 *     JSON output" (#2816, #2856).
 *   - post-command / post-edit  (PostToolUse)  — parse the hook event JSON
 *     from stdin (no jq), extract the same fields the bash version pulled
 *     with jq, and forward them as CLI flags.
 *   - precompact-manual / precompact-auto  (PreCompact) — static guidance
 *     text, no CLI call at all (matches the bash version's plain echoes).
 *   - session-end  (Stop) — forwarded as-is, same flags as before.
 *
 * Shared behaviour:
 *   1. Prefers a locally installed `ruflo` or `claude-flow` binary.
 *   2. Falls back to `npx --prefer-offline ruflo@latest`.
 *   3. ALWAYS exits 0 — hook subcommands are best-effort telemetry; a
 *      failure must never surface an error or block a turn.
 *   4. Swallows all stdout/stderr from the invoked CLI.
 *
 * Usage: node ruflo-hook.cjs <hook-subcommand>
 *   (invoked via the `node -e` bootstrap in hooks.json, which resolves
 *   this script's path from `process.env.CLAUDE_PLUGIN_ROOT` — no shell
 *   env-var expansion needed, so there is no `${VAR}` vs `%VAR%` split)
 */

'use strict';

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/** Exit 0 unconditionally — hooks must never block a turn */
function done() {
  process.exit(0);
}

/** Check if a binary is available on PATH */
function commandExists(cmd) {
  try {
    const result = execSync(
      process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Escape one argv element so it survives BOTH parsers a Windows shell:true
 * spawn puts it through before the target CLI ever sees it:
 *   1. cmd.exe's own line tokenizer, which still scans for & | < > ^ % ! " ( )
 *      even inside a per-argument quoted segment — quoting alone does not
 *      shield cmd.exe metacharacters, and this runs a SECOND time when the
 *      resolved binary is itself a .cmd shim (npm's `ruflo`/`claude-flow`/
 *      `npx` global installs on Windows), because launching a .cmd file is
 *      cmd.exe re-invoking itself on the command line.
 *   2. The eventual CommandLineToArgvW argv parse in the target process,
 *      which needs backslash-before-quote sequences doubled and the value
 *      quoted so it lands as ONE argument.
 * Without this, a hook-derived value (e.g. a Bash tool's `command`, or a
 * file path) containing a shell metacharacter can be reinterpreted as a
 * separate command / redirection instead of reaching the CLI as literal
 * data — this is the class of bug in CVE-2024-27980 (Node's own .bat/.cmd
 * argument-injection advisory). Algorithm: https://qntm.org/cmd, the same
 * reference the `cross-spawn` package's Windows escaping is built from.
 */
function escapeCmdArg(arg) {
  let s = String(arg);
  s = s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  s = `"${s}"`;
  return s.replace(/[()%!^"<>&|;,]/g, '^$&');
}

/**
 * Spawn the CLI with the hook subcommand + args, forwarding stdinData.
 * Returns true on success (exit 0), false otherwise. Never throws.
 */
function invokeHook(bin, binArgs, hookSubcommand, hookArgs, stdinData) {
  const args = [...binArgs, 'hooks', hookSubcommand, ...hookArgs];
  // On Windows, shell: true is needed to resolve .cmd/.ps1 shims that npm
  // creates for globally-installed bins (`ruflo`, `claude-flow`, `npx`) —
  // CreateProcess cannot execute those directly. `node` itself is always a
  // real .exe (never a shim), so skip the shell entirely there —
  // CreateProcess gets the argv array verbatim, byte-for-byte, no
  // cmd.exe involved at all. This covers the common `node <cli.js>`
  // invocation (test harness, npx-resolved runs). A real global
  // `ruflo`/`claude-flow` install still goes through the shim path below;
  // every array element is escaped with escapeCmdArg() before it reaches
  // cmd.exe so hook-derived values can't be reinterpreted as shell syntax.
  const useShell = process.platform === 'win32' && bin !== 'node' && bin !== process.execPath;
  const spawnBin = useShell ? escapeCmdArg(bin) : bin;
  const spawnArgs = useShell ? args.map(escapeCmdArg) : args;
  // Test-only: RUFLO_HOOK_DEBUG_STDOUT surfaces the invoked CLI's own
  // stdout/stderr instead of swallowing them, so test-hooks.mjs can assert
  // on the CLI's actual recorded value (e.g. catching #1859/#1862-style
  // flag-wiring regressions). Production never sets this — hooks must
  // never leak CLI output into the host (Cursor's PreToolUse contract).
  const debug = process.env.RUFLO_HOOK_DEBUG_STDOUT === '1';
  try {
    const result = spawnSync(spawnBin, spawnArgs, {
      shell: useShell,
      input: stdinData || '',
      encoding: 'utf8',
      stdio: debug ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'ignore', 'ignore'],
      timeout: 30_000,
    });
    if (debug) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    return result.status === 0;
  } catch {
    return false;
  }
}

/** Best-effort: try ruflo, then claude-flow, then npx. Never throws. */
function invokeCli(hookSubcommand, hookArgs, stdinData) {
  // Test-only escape hatch: point at a specific local build instead of the
  // commandExists() PATH probe (used by test-hooks.mjs and the plugin-hooks
  // real-command smoke so tests exercise the build under test, not whatever
  // happens to be on the runner's PATH). Space-split — always a simple
  // "node /abs/path/cli.js" invocation in practice, never quoted args.
  const override = process.env.RUFLO_HOOK_CLI_OVERRIDE;
  if (override) {
    const [bin, ...binArgs] = override.split(' ').filter(Boolean);
    invokeHook(bin, binArgs, hookSubcommand, hookArgs, stdinData);
    return;
  }
  if (commandExists('ruflo')) {
    invokeHook('ruflo', [], hookSubcommand, hookArgs, stdinData);
    return;
  }
  if (commandExists('claude-flow')) {
    invokeHook('claude-flow', [], hookSubcommand, hookArgs, stdinData);
    return;
  }
  // SKIP npx when RUFLO_HOOK_SKIP_NPX=1 — used by CI smokes that test the
  // shim's *control flow* without exercising npm install network paths.
  // Without the skip, npx can take 30+s on a cold runner, exceeding a
  // smoke's timeout and producing a spurious failure even though the shim
  // itself works correctly. The bash version doesn't hit this because it
  // backgrounded the work.
  if (process.env.RUFLO_HOOK_SKIP_NPX !== '1') {
    invokeHook('npx', ['--prefer-offline', '--yes', 'ruflo@latest'], hookSubcommand, hookArgs, stdinData);
  }
}

/** Read all of stdin synchronously. Returns '' on any failure (best effort). */
function readStdinRaw() {
  try {
    const chunk = Buffer.alloc(64 * 1024);
    let buf = '';
    let bytesRead;
    while (true) {
      try {
        bytesRead = fs.readSync(0 /* STDIN_FILENO */, chunk, 0, chunk.length, null);
        if (bytesRead === 0) break;
        buf += chunk.slice(0, bytesRead).toString('utf8');
      } catch {
        break;
      }
    }
    return buf;
  } catch {
    return '';
  }
}

/** Parse stdinData as JSON, returning {} on any parse failure. */
function parseEventJson(stdinData) {
  try {
    const trimmed = (stdinData || '').trim();
    return trimmed ? JSON.parse(trimmed) : {};
  } catch {
    return {};
  }
}

/**
 * Project-installed hooks and marketplace-plugin hooks can receive the same
 * event. Claim side-effecting events atomically so post-edit learning and
 * session-end consolidation execute exactly once (#2640).
 */
function claimSideEffectEvent(family, stdinData, event) {
  if (/^(1|true|yes|on)$/i.test(process.env.RUFLO_DISABLE_HOOK_DEDUP || '')) return true;
  try {
    const eventId = event?.tool_use_id || event?.toolUseId ||
      event?.session_id || event?.sessionId || event?.hook_event_id;
    const payloadIdentity = eventId
      ? `event:${eventId}`
      : `payload:${(stdinData || '').trim()}|bucket:${Math.floor(Date.now() / 2000)}`;
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const digest = crypto.createHash('sha256')
      .update(`ruflo-hook-dedup-v1\0${path.resolve(projectRoot)}\0${family}\0${payloadIdentity}`)
      .digest('hex');
    const dir = process.env.RUFLO_HOOK_DEDUP_DIR ||
      path.join(os.tmpdir(), 'ruflo-hook-dedup-v1');
    fs.mkdirSync(dir, { recursive: true });
    const fd = fs.openSync(path.join(dir, digest), 'wx', 0o600);
    fs.writeFileSync(fd, String(Date.now()));
    fs.closeSync(fd);
    return true;
  } catch (error) {
    return error?.code === 'EEXIST' ? false : true;
  }
}

/**
 * Codex sets PLUGIN_ROOT and PLUGIN_DATA for plugin-bundled hooks, in
 * addition to the cross-host CLAUDE_PLUGIN_* compatibility variables.
 * Cursor and Claude Code use CLAUDE_PLUGIN_ROOT without these Codex-specific
 * variables. Keep this positive Codex check narrow so existing Cursor
 * installations retain their permission response.
 *
 * Fallback: Codex's PreToolUse input JSON always carries a `turn_id` string
 * field (verified against codex-rs' pre-tool-use.command.input schema —
 * it is Codex's own documented extension, not present in Claude Code's or
 * Cursor's hook payloads). This catches any install/config path where the
 * PLUGIN_ROOT/PLUGIN_DATA env vars aren't injected, so a stray Cursor-shaped
 * `{"permission":"allow"}` object never reaches Codex's stricter parser
 * (#2856): Codex's output_parser rejects unknown top-level keys outright
 * and reports "hook returned invalid pre-tool-use JSON output" for any
 * JSON-shaped stdout it can't fit into its schema, whereas empty stdout is
 * treated as no-opinion/implicit-allow with no error.
 */
function isCodexPluginHost(event) {
  if (process.env.PLUGIN_ROOT || process.env.PLUGIN_DATA) return true;
  return typeof event?.turn_id === 'string' && event.turn_id.length > 0;
}

/**
 * PreCompact guidance text — matches the bash `echo` lines verbatim.
 * Not a CLI call at all; pure stdout guidance for the transcript/context.
 */
function precompactManual(event) {
  const custom = typeof event?.custom_instructions === 'string' ? event.custom_instructions : '';
  const lines = [
    '🔄 PreCompact Guidance:',
    '📋 IMPORTANT: Review CLAUDE.md in project root for:',
    '   • 54 available agents and concurrent usage patterns',
    '   • Swarm coordination strategies (hierarchical, mesh, adaptive)',
    '   • SPARC methodology workflows with batchtools optimization',
    '   • Critical concurrent execution rules (GOLDEN RULE: 1 MESSAGE = ALL OPERATIONS)',
  ];
  if (custom) lines.push(`🎯 Custom compact instructions: ${custom}`);
  lines.push('✅ Ready for compact operation');
  process.stdout.write(lines.join('\n') + '\n');
}

function precompactAuto() {
  const lines = [
    '🔄 Auto-Compact Guidance (Context Window Full):',
    '📋 CRITICAL: Before compacting, ensure you understand:',
    '   • All 54 agents available in .claude/agents/ directory',
    '   • Concurrent execution patterns from CLAUDE.md',
    '   • Batchtools optimization for 300% performance gains',
    '   • Swarm coordination strategies for complex tasks',
    '⚡ Apply GOLDEN RULE: Always batch operations in single messages',
    '✅ Auto-compact proceeding with full agent context',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

function main() {
  const [subcommand] = process.argv.slice(2);
  if (!subcommand) done(); // no subcommand — no-op, same as bash version

  // PreCompact: pure guidance text, no CLI call, no stdin required beyond
  // (optionally) custom_instructions for the manual variant.
  if (subcommand === 'precompact-manual') {
    precompactManual(parseEventJson(readStdinRaw()));
    done();
  }
  if (subcommand === 'precompact-auto') {
    precompactAuto();
    done();
  }

  const stdinData = readStdinRaw();
  const event = parseEventJson(stdinData);

  if ((subcommand === 'post-edit' || subcommand === 'session-end') &&
      !claimSideEffectEvent(subcommand, stdinData, event)) {
    done();
  }

  // PostToolUse: derive CLI flags from the hook event JSON (replaces jq).
  if (subcommand === 'post-command') {
    const cmd = event?.tool_input?.command;
    if (!cmd) done(); // bash version: `[ -z "$CMD" ] && exit 0`
    const exitCode = event?.tool_response?.exit_code ?? 0;
    invokeCli('post-command', ['-c', String(cmd), '-s', String(exitCode === 0), '-e', String(exitCode)], stdinData);
    done();
  }
  if (subcommand === 'post-edit') {
    const file = event?.tool_input?.file_path ?? event?.tool_input?.path;
    if (!file) done(); // bash version: `[ -z "$FILE" ] && exit 0`
    invokeCli('post-edit', ['-f', String(file), '-s', 'true'], stdinData);
    done();
  }

  // PreToolUse: telemetry always runs. Cursor retains its permission verdict;
  // Codex unconditional allow is exit 0 with empty stdout (#2816).
  if (subcommand === 'modify-bash' || subcommand === 'modify-file') {
    invokeCli(subcommand, [], stdinData);
    if (!isCodexPluginHost(event)) {
      process.stdout.write('{"permission":"allow"}');
    }
    done();
  }

  // Stop / session-end and anything else: forward remaining argv unchanged
  // (matches ruflo-hook.sh's generic `ruflo hooks "$@"` passthrough).
  const extraArgs = process.argv.slice(3);
  invokeCli(subcommand, extraArgs, stdinData);
  done();
}

// Test-only: RUFLO_HOOK_UNIT_TEST skips main() so a unit test can require()
// this file for its pure helpers (escapeCmdArg) without triggering the real
// hook flow / process.exit(0). hooks.json always invokes this file via a
// plain require() inside a `node -e` wrapper (see the header comment) — there
// is no `require.main === module` boundary to gate on — so main() must
// default to running unconditionally in every other context.
if (process.env.RUFLO_HOOK_UNIT_TEST !== '1') {
  main();
}

module.exports = { escapeCmdArg };
