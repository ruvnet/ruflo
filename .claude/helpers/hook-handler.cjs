#!/usr/bin/env node
/**
 * Claude Flow Hook Handler (Cross-Platform)
 * Dispatches hook events to the appropriate helper modules.
 *
 * Usage: node hook-handler.cjs <command> [args...]
 *
 * Commands:
 *   route          - Route a task to optimal agent (reads PROMPT from env/stdin)
 *   pre-bash       - Validate command safety before execution
 *   post-edit      - Record edit outcome for learning
 *   session-restore - Restore previous session state
 *   session-end    - End session and persist state
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const helpersDir = __dirname;

// Resolve an installed @claude-flow/cli (or ruflo) bin — mirrors
// statusline-generator.ts's resolveCliBin() candidate list, then looks for a
// global install (resolveGlobalCliBin() below, #3368). Used only to spawn the
// detached funnel-refresh helper below; failures are silent (no candidate
// found just means the refresh falls back to npx).
//
// Verifies dist/src/index.js exists alongside bin/cli.js, not just the bin
// itself — Claude Code's own plugin marketplace mechanism installs by
// `git clone`/`git pull` with no build step, so `~/.claude/plugins/
// marketplaces/ruflo` is a SOURCE-ONLY checkout by construction: bin/cli.js
// is present on disk but importing dist/src/index.js throws
// ERR_MODULE_NOT_FOUND on every real command (confirmed live — only
// `--version` happens to survive it, since it reads package.json directly).
// Without this check, resolveCliBinForHook() picked that doomed candidate
// first every time and spawnDetachedFunnelRefresh() below had no fallback,
// so the promo/disclosure row could never populate for any marketplace
// install, on any OS.
// session-restore asks up to three times (first-run enable, then the two
// refreshes). The answer cannot change inside one short-lived hook process,
// so resolve once: `undefined` means "not looked up yet", null means "no
// local or global CLI — use npx".
let cliBinCache;
function resolveCliBinForHook() {
  if (cliBinCache === undefined) cliBinCache = resolveCliBinUncached();
  return cliBinCache;
}

function resolveCliBinUncached() {
  try {
    const home = os.homedir();
    const cwd = process.cwd();
    const candidates = [
      path.join(home, '.claude', 'plugins', 'marketplaces', 'ruflo', 'bin', 'cli.js'),
      path.join(cwd, 'node_modules', '@claude-flow', 'cli', 'bin', 'cli.js'),
      path.join(cwd, 'node_modules', 'ruflo', 'bin', 'cli.js'),
      path.join(cwd, 'v3', '@claude-flow', 'cli', 'bin', 'cli.js'),
      // helpersDir is .claude/helpers/ inside the package itself when this
      // file is running from a real @claude-flow/cli install (not a project
      // that merely copied the helper) — its bin/ is two levels up.
      path.join(helpersDir, '..', '..', 'bin', 'cli.js'),
    ];
    for (const p of candidates) {
      if (isRunnableCli(p)) return p;
    }
    return resolveGlobalCliBin();
  } catch (e) { /* ignore */ }
  return null;
}

function isRunnableCli(p) {
  try {
    return fs.existsSync(p) && fs.existsSync(path.join(path.dirname(p), '..', 'dist', 'src', 'index.js'));
  } catch (e) { return false; }
}

// #3368: a global install — the README's `npm install -g ruflo@latest` — keeps
// the CLI at <prefix>/lib/node_modules/ruflo/node_modules/@claude-flow/cli,
// which none of the project-relative candidates above cover, so on those
// machines every refresh fell back to npx: a second, separately cached copy
// of the CLI that follows the registry's latest rather than the version the
// user pinned (the same npx-cache skew as #3306), and that cannot start
// offline on a cold cache.
//
// Two lookups, fs calls only (no child process), reached only after every
// candidate above missed:
//   1. npm's global prefix, resolved the way npm resolves it
//      (npmGlobalPrefix() below). First because it does not depend on PATH:
//      a hook inherits the host process's PATH, which need not contain the
//      prefix's bin/ even when the user's interactive shell does (observed:
//      the Claude Code process spawning hooks lacked ~/.npm-global/bin while
//      a login zsh on the same machine had it).
//   2. `ruflo`, then `claude-flow`, on PATH — the order plugins/ruflo-core/
//      scripts/ruflo-hook.cjs uses — for globals npm did not install (yarn
//      classic, bun). Only a symlinked bin counts, and only when it lands in
//      a package that declares one of the three known names, so a wrapper
//      script or a version-manager shim (Volta) is never mistaken for an
//      install. The <dir>/node_modules/<name> layout npm uses on Windows,
//      where ruflo.cmd sits beside node_modules\ruflo (what resolveNpmShim()
//      in ruflo-hook.cjs maps), is only consulted on win32: on POSIX every
//      manager symlinks, and probing it there would follow a Windows install
//      exposed to WSL through the appended Windows PATH.
//      Relative PATH entries (`.` or an empty entry) are skipped, so a bare
//      `./ruflo` in the working directory is never picked up.
// `env`/`platform`/`execPath` are parameters so any layout is testable
// from any OS.
function resolveGlobalCliBin(env = process.env, platform = process.platform, execPath = process.execPath) {
  const prefix = npmGlobalPrefix(env, platform, execPath);
  if (prefix) {
    const modules = platform === 'win32'
      ? path.join(prefix, 'node_modules')
      : path.join(prefix, 'lib', 'node_modules');
    for (const pkg of ['ruflo', 'claude-flow', path.join('@claude-flow', 'cli')]) {
      const hit = cliInPackage(path.join(modules, pkg));
      if (hit) return hit;
    }
  }
  const dirs = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':');
  const exts = platform === 'win32' ? ['.cmd', ''] : [''];
  for (const name of ['ruflo', 'claude-flow']) {
    for (const dir of dirs) {
      if (!dir || !path.isAbsolute(dir)) continue;
      for (const ext of exts) {
        const shim = path.join(dir, name + ext);
        if (!fs.existsSync(shim)) continue;
        const roots = [];
        try {
          if (fs.lstatSync(shim).isSymbolicLink()) {
            const root = path.dirname(path.dirname(fs.realpathSync(shim)));
            if (isKnownPackageRoot(root)) roots.push(root);
          }
        } catch (e) { /* unreadable link — fall back to the layout roots */ }
        if (platform === 'win32') {
          roots.push(path.join(dir, 'node_modules', name));
          if (name === 'claude-flow') roots.push(path.join(dir, 'node_modules', '@claude-flow', 'cli'));
        }
        for (const root of roots) {
          const hit = cliInPackage(root);
          if (hit) return hit;
        }
      }
    }
  }
  return null;
}

// A bin on PATH only counts as an install when the package it points into
// declares one of the three published names. This is a narrower check than
// resolveNpmShim() in ruflo-hook.cjs, which never reads `name`: that one takes
// the package name from the shim's own filename, then validates package.json's
// `bin` entry and that its realpath stays inside the package. Here the bin has
// already been resolved to a package root, so the manifest `name` is what
// identifies it.
function isKnownPackageRoot(root) {
  try {
    const name = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).name;
    return name === 'ruflo' || name === 'claude-flow' || name === '@claude-flow/cli';
  } catch (e) { return false; }
}

// Map an installed ruflo / claude-flow / @claude-flow/cli package root to the
// CLI it runs: <root>/bin/cli.js (@claude-flow/cli itself),
// <root>/v3/@claude-flow/cli/bin/cli.js (the claude-flow umbrella bundles
// it), or @claude-flow/cli in the node_modules npm nests inside <root> —
// or, for the flat layout yarn classic and bun use, in the node_modules
// folder that holds <root> itself. That is the dependency edge
// ruflo/bin/ruflo.js's findCliPath() follows. The search stops at that one
// enclosing node_modules: walking further up would reach unrelated trees,
// such as a stray ~/node_modules left by an `npm i` in a home directory.
// Every hit must still pass isRunnableCli().
function cliInPackage(root) {
  if (!fs.existsSync(root)) return null;
  const candidates = [
    path.join(root, 'bin', 'cli.js'),
    path.join(root, 'v3', '@claude-flow', 'cli', 'bin', 'cli.js'),
    path.join(root, 'node_modules', '@claude-flow', 'cli', 'bin', 'cli.js'),
  ];
  for (let dir = path.dirname(root), i = 0; i < 4 && dir !== path.dirname(dir); i++, dir = path.dirname(dir)) {
    if (path.basename(dir) === 'node_modules') {
      candidates.push(path.join(dir, '@claude-flow', 'cli', 'bin', 'cli.js'));
      break;
    }
  }
  return candidates.find(isRunnableCli) || null;
}

// npm's global prefix without spawning npm (`npm prefix -g` measured 70-80 ms
// per call, paid on every SessionStart that gets this far). Same precedence
// npm applies:
//   1. npm_config_prefix in the environment (npm accepts either case);
//   2. `prefix=` in the user npmrc ($npm_config_userconfig, else ~/.npmrc),
//      where `npm config set prefix ~/.npm-global` (the npm docs' fix for
//      EACCES on global installs) writes it;
//   3. `prefix=` in npm's builtin npmrc (<npm package>/npmrc), found through
//      the `npm` link beside node: Homebrew writes `prefix = /opt/homebrew`
//      there (its process.execPath is the Cellar path, so step 4 alone would
//      be wrong), and the Node.js Windows installer ships
//      `prefix=${APPDATA}\npm`;
//   4. npm's default: $PREFIX, else the directory above node's bin/ (POSIX)
//      or node.exe's own directory (Windows).
// Values follow npm's ini handling for the cases that decide a path: a
// quoted value is taken literally, an unquoted `;`/`#` starts a comment,
// keys below a `[section]` header are ignored, `${VAR}` expands when the
// variable is set (and `${VAR?}` to empty when it is not) but otherwise
// stays literal like npm — which leaves the value relative, so the
// isAbsolute() check below rejects it instead of pointing at the drive root.
// Not emulated: escaped characters and npm's other ini corner cases; each of
// those produces a miss, never a wrong CLI. The npmrc is read into memory,
// but only the value of its last top-level `prefix =` line is kept: no other
// line (an `_authToken`, say) is returned, stored or logged.
function npmGlobalPrefix(env = process.env, platform = process.platform, execPath = process.execPath) {
  const home = (platform === 'win32' ? env.USERPROFILE : env.HOME) || os.homedir();
  const readPrefix = (file) => {
    let value = null;
    try {
      for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
        if (/^\s*\[/.test(line)) break; // only the top-level section applies
        const m = /^\s*prefix\s*=\s*(.*?)\s*$/.exec(line);
        if (m) value = m[1]; // last one wins, as in npm's ini parser
      }
    } catch (e) { /* no such npmrc */ }
    return value;
  };
  const nodeDir = path.dirname(execPath);
  // npm's builtin npmrc sits in npm's own package dir. On Windows that is
  // node_modules\npm beside node.exe; elsewhere follow the `npm` link beside
  // node (<npm>/bin/npm-cli.js) — on Homebrew it points out of the node keg
  // to /opt/homebrew/lib/node_modules/npm.
  let builtinRc = path.join(nodeDir, 'node_modules', 'npm', 'npmrc');
  if (platform !== 'win32') {
    try {
      builtinRc = path.join(path.dirname(path.dirname(fs.realpathSync(path.join(nodeDir, 'npm')))), 'npmrc');
    } catch (e) { /* no npm beside node */ }
  }
  const raw = env.npm_config_prefix || env.NPM_CONFIG_PREFIX
    || readPrefix(env.npm_config_userconfig || env.NPM_CONFIG_USERCONFIG || path.join(home, '.npmrc'))
    || readPrefix(builtinRc)
    || env.PREFIX
    || (platform === 'win32' ? nodeDir : path.dirname(nodeDir));
  let value = String(raw).trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(value);
  if (quoted) value = quoted[2];
  else value = value.replace(/(^|[^\\])[;#].*$/, '$1').trim();
  value = value
    .replace(/\$\{([^}?]+)(\?)?\}/g, (whole, name, optional) => (
      env[name] !== undefined ? env[name] : (optional ? '' : whole)
    ))
    .replace(/^~(?=$|[\\/])/, home);
  return path.isAbsolute(value) ? path.resolve(value) : null;
}

// Fire-and-forget doesn't work when the CALLER is itself a short-lived
// subprocess (confirmed live: two consecutive statusline renders 5s apart
// both saw an empty funnel-messages-cache, because the async HTTPS fetch
// inside a `void refreshRemoteMessages()` call gets killed when the spawning
// process exits before the request completes). Spawning fully DETACHED +
// unref'd decouples the refresh's lifetime from this hook's — it keeps
// running (up to message-transport.ts's own 4s fetch timeout) even after
// session-restore's own process has already exited, so it actually gets a
// chance to write the cache. Never awaited here — must not add to
// SessionStart's own timeout budget.
//
// No usable local or global candidate (resolveCliBinForHook() returned null)
// falls back to npx: this call is detached/unref'd, so a slower npx cold-start
// costs nothing perceptible — unlike the statusline's own synchronous
// render path, where local-first exists purely for per-render latency.
// `--prefer-offline` avoids a registry round trip for the tarball when
// already cached while still resolving the current `@latest` version.
function spawnDetachedHookRefresh(subcommand) {
  try {
    const { spawn } = require('child_process');
    const cliBin = resolveCliBinForHook();
    const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const spawnArgs = cliBin
      ? [process.execPath, [cliBin, 'hooks', subcommand, '--quiet']]
      : [cmd, ['--prefer-offline', '@claude-flow/cli', 'hooks', subcommand, '--quiet']];
    const child = spawn(spawnArgs[0], spawnArgs[1], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
      windowsHide: true,
    });
    child.unref();
  } catch (e) { /* best-effort only */ }
}

function spawnDetachedFunnelRefresh() {
  spawnDetachedHookRefresh('refresh-funnel');
}

// ADR-318/319: first-run auto-enable of spinner verbs (default ON) +
// announcements (default OFF, explicit opt-in). Fires ONCE per install
// (marker at ~/.ruflo/first-run-enabled.json), then never again —
// subsequent sessions see the marker and skip.
//
// Split posture rationale:
//   - Spinner verbs = low-intrusion (per-spin flash, append-mode mix
//     with Claude Code defaults, moderate visibility over time). Default ON.
//     Disclosure notification + one-command disable satisfies the ethical bar.
//   - Announcements = higher-intrusion (prominent line at every Claude Code
//     startup, more attention per view). Default OFF; opt-in via
//     RUFLO_AUTO_ENABLE_ANNOUNCEMENTS=1 or explicit `ruflo announcements enable`.
//
// Gates (spinner is default-on unless any is TRUE):
//   - RUFLO_NO_AUTO_ENABLE truthy (master opt-out — kills both)
//   - RUFLO_NO_AUTO_ENABLE_SPINNER truthy (spinner-only opt-out)
//   - CI / GITHUB_ACTIONS truthy
//   - stdout is not a TTY (piped, non-interactive)
//   - Marker file already exists
//
// Announcements needs the same gates PLUS RUFLO_AUTO_ENABLE_ANNOUNCEMENTS=1.
//
// Marker is written even if the spawns fail — auto-enable is a "we tried once"
// contract, not "keep trying until success." Users can run enable manually.
function firstRunAutoEnableIfEligible() {
  try {
    const path = require('path');
    const fs = require('fs');
    const os = require('os');
    const truthy = (v) => v && !/^(0|false|off|no)$/i.test(String(v));
    if (truthy(process.env.RUFLO_NO_AUTO_ENABLE)) return;
    if (process.env.CI || process.env.GITHUB_ACTIONS) return;
    if (process.stdout && process.stdout.isTTY === false) return;
    const markerPath = path.join(os.homedir(), '.ruflo', 'first-run-enabled.json');
    if (fs.existsSync(markerPath)) return;

    const enableSpinner = !truthy(process.env.RUFLO_NO_AUTO_ENABLE_SPINNER);
    const enableAnnouncements = truthy(process.env.RUFLO_AUTO_ENABLE_ANNOUNCEMENTS);

    // Nothing to do — user opted out of both. Skip marker write so if they
    // change their mind and re-enable env vars later, first-run still fires.
    if (!enableSpinner && !enableAnnouncements) return;

    // Spawn the enable commands detached + non-blocking. Any failure
    // (missing CLI, refused state, etc.) is silent — auto-enable is
    // best-effort and MUST NOT block session-restore. Uses execPath +
    // resolved cli.js directly rather than spawnDetachedHookRefresh
    // because that helper hardcodes 'hooks' as the top-level command.
    const { spawn } = require('child_process');
    const cliBin = resolveCliBinForHook();
    const runDetached = (args) => {
      try {
        const spawnArgs = cliBin
          ? [process.execPath, [cliBin, ...args]]
          : [process.platform === 'win32' ? 'npx.cmd' : 'npx',
             ['--prefer-offline', '@claude-flow/cli', ...args]];
        const child = spawn(spawnArgs[0], spawnArgs[1], {
          detached: true, stdio: 'ignore', env: process.env, windowsHide: true,
        });
        child.unref();
      } catch { /* best-effort */ }
    };
    if (enableSpinner) runDetached(['spinner', 'enable', '--yes']);
    if (enableAnnouncements) runDetached(['announcements', 'enable', '--yes']);

    try {
      fs.mkdirSync(path.dirname(markerPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        markerPath,
        JSON.stringify({
          _ts: Date.now(),
          source: 'session-restore-hook',
          enabled: { spinner: enableSpinner, announcements: enableAnnouncements },
        }, null, 2),
        { encoding: 'utf-8', mode: 0o600 }
      );
    } catch { /* ignore — best effort */ }

    // Notification tells user exactly what happened. stderr so it doesn't
    // corrupt any downstream JSON stdout consumer.
    try {
      const parts = [];
      if (enableSpinner) parts.push('spinner verbs');
      if (enableAnnouncements) parts.push('startup announcements');
      const disableCmds = [];
      if (enableSpinner) disableCmds.push('`ruflo spinner disable`');
      if (enableAnnouncements) disableCmds.push('`ruflo announcements disable`');
      process.stderr.write(
        '[ruflo] First-run: enabled ' + parts.join(' + ') + '. ' +
        'Disable anytime with ' + disableCmds.join(' / ') + '. ' +
        (enableSpinner && !enableAnnouncements
          ? 'Announcements stay opt-in — set RUFLO_AUTO_ENABLE_ANNOUNCEMENTS=1 to enable those too. '
          : '') +
        'Restart Claude Code once to see the changes take effect.\n'
      );
    } catch { /* ignore */ }
  } catch { /* auto-enable must never break session-restore */ }
}

// Same fallback-aware pattern as spawnDetachedFunnelRefresh() above, for
// ADR-316's co-pilot advisor tip. Safe to call on EVERY session-restore:
// refresh-advisor's own action checks consent + a 24h TTL BEFORE spending
// anything, so an unconsented or already-fresh install is a fast no-op file
// read, never a network call. Never awaited here — must not add to
// SessionStart's own timeout budget.
function spawnDetachedAdvisorRefresh() {
  spawnDetachedHookRefresh('refresh-advisor');
}

// Safe require with stdout suppression - the helper modules have CLI
// sections that run unconditionally on require(), so we mute console
// during the require to prevent noisy output.
function safeRequire(modulePath) {
  try {
    if (fs.existsSync(modulePath)) {
      const origLog = console.log;
      const origError = console.error;
      console.log = () => {};
      console.error = () => {};
      try {
        const mod = require(modulePath);
        return mod;
      } finally {
        console.log = origLog;
        console.error = origError;
      }
    }
  } catch (e) {
    // silently fail
  }
  return null;
}

const router = safeRequire(path.join(helpersDir, 'router.js'));
const session = safeRequire(path.join(helpersDir, 'session.js'));
const memory = safeRequire(path.join(helpersDir, 'memory.js'));
const intelligence = safeRequire(path.join(helpersDir, 'intelligence.cjs'));

// ── Intelligence timeout protection (fixes #1530, #1531) ───────────────────
const INTELLIGENCE_TIMEOUT_MS = 3000;
// Race the (possibly-async) work against a real timeout. The previous version
// called fn() and clearTimeout(timer) immediately, so an async fn returned a
// pending promise that resolved THROUGH the race — the timeout protected
// nothing. This settles on whichever finishes first, then clears the timer.
//
// LIMITATION: a synchronous blocking fn (the current intelligence.init() does
// blocking fs reads) cannot be interrupted by any in-process timer — the event
// loop is blocked. The real guard for that case is the readJSON file-size
// limit in intelligence.cjs. This util only bounds work that yields (async I/O).
function runWithTimeout(fn, label) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      process.stderr.write("[WARN] " + label + " timed out after " + INTELLIGENCE_TIMEOUT_MS + "ms, skipping\n");
      resolve(null);
    }, INTELLIGENCE_TIMEOUT_MS);
  });
  const work = Promise.resolve().then(fn).catch(() => null);
  return Promise.race([work, timeout]).then((result) => {
    clearTimeout(timer);
    return result;
  });
}


// Get the command from argv
const [,, command, ...args] = process.argv;

// Read stdin with timeout — Claude Code sends hook data as JSON via stdin.
// Timeout prevents hanging when stdin is not properly closed (common on Windows).
async function readStdin() {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => {
      process.stdin.removeAllListeners();
      process.stdin.pause();
      resolve(data);
    }, 500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(data); });
    process.stdin.resume();
  });
}

function claimSideEffectEvent(family, stdinData, event) {
  if (/^(1|true|yes|on)$/i.test(process.env.RUFLO_DISABLE_HOOK_DEDUP || '')) return true;
  try {
    const crypto = require('crypto');
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

async function main() {
  // Global safety timeout: hooks must NEVER hang (#1530, #1531)
  const safetyTimer = setTimeout(() => {
    process.stderr.write("[WARN] Hook handler global timeout (5s), forcing exit\n");
    process.exit(0);
  }, 5000);
  safetyTimer.unref(); // don't keep process alive just for this timer

  let stdinData = '';
  try { stdinData = await readStdin(); } catch (e) { /* ignore stdin errors */ }

  let hookInput = {};
  if (stdinData.trim()) {
    try { hookInput = JSON.parse(stdinData); } catch (e) { /* ignore parse errors */ }
  }

  if ((command === 'post-edit' || command === 'session-end') &&
      !claimSideEffectEvent(command, stdinData, hookInput)) {
    return;
  }

  // Normalize snake_case/camelCase: Claude Code sends tool_input/tool_name (snake_case)
  const toolInput = hookInput.toolInput || hookInput.tool_input || {};
  const toolName = hookInput.toolName || hookInput.tool_name || '';

  // Merge stdin data into prompt resolution: prefer stdin fields, then env, then argv.
  // `toolInput` is an object (e.g. {command:"ls"}) — it's truthy but not a string,
  // so falling back to it directly bound `prompt` to the object and tripped
  // `.toLowerCase()` / `.substring()` on every Bash hook (#1944). Use the
  // `.command` field instead, which is the actual string the hook needs.
  const prompt = hookInput.prompt || hookInput.command || toolInput.command
    || process.env.PROMPT || process.env.TOOL_INPUT_command || args.join(' ') || '';

  // ADR-174: capture FAILURES so the learning substrate has negative examples.
  // Claude Code's PostToolUse payload carries the tool result; a failed
  // Write/Edit/Bash surfaces as tool_response.is_error / an error string /
  // a non-zero exit code. Conservative — only a positive error signal counts
  // as failure (mirrors isToolFailure() in helpers-generator.ts).
  const toolFailed = (function (hi) {
    if (!hi || typeof hi !== 'object') return false;
    const tr = hi.tool_response != null ? hi.tool_response : (hi.toolResponse != null ? hi.toolResponse : hi.result);
    if (tr == null) return false;
    if (typeof tr === 'string') return /\b(error|failed|failure|exception|not found|no such|permission denied|traceback)\b/i.test(tr);
    if (typeof tr === 'object') {
      if (tr.is_error === true || tr.isError === true || tr.success === false || tr.error != null) return true;
      const code = tr.exit_code != null ? tr.exit_code : (tr.exitCode != null ? tr.exitCode : tr.code);
      if (typeof code === 'number' && code !== 0) return true;
      if (Array.isArray(tr.content) && tr.is_error === true) return true;
    }
    return false;
  })(hookInput);

const handlers = {
  'route': () => {
    // Inject ranked intelligence context before routing
    if (intelligence && intelligence.getContext) {
      try {
        const ctx = intelligence.getContext(prompt);
        if (ctx) console.log(ctx);
      } catch (e) { /* non-fatal */ }
    }
    if (router && router.routeTask) {
      const result = router.routeTask(prompt);
      // Format output for Claude Code hook consumption — real data only
      const output = [
        `[INFO] Routing task: ${prompt.substring(0, 80) || '(no prompt)'}`,
        '',
        '+------------------- Primary Recommendation -------------------+',
        `| Agent: ${result.agent.padEnd(53)}|`,
        `| Confidence: ${(result.confidence * 100).toFixed(1)}%${' '.repeat(44)}|`,
        `| Reason: ${(result.reason || '').substring(0, 53).padEnd(53)}|`,
        '+--------------------------------------------------------------+',
      ];
      console.log(output.join('\n'));
    } else {
      console.log('[INFO] Router not available, using default routing');
    }

    // Rate-limit -> sponsored-capacity nudge (ADR-312/313). Fires here,
    // client-side, BEFORE the API call this prompt would make — so it still
    // reaches the transcript even if that call then fails from the rate
    // limit. Cheap local file reads only; never a network call or a child
    // process, so it cannot add latency to prompt submission.
    try {
      const rlFunnelEnv = process.env.RUFLO_FUNNEL;
      const rlDisabledByEnv = rlFunnelEnv !== undefined && /^(0|false|off|no)$/i.test(String(rlFunnelEnv).trim());
      const rlCiVars = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'TRAVIS', 'BUILDKITE', 'JENKINS_URL', 'TEAMCITY_VERSION', 'TF_BUILD'];
      const rlIsCi = rlCiVars.some((v) => {
        const val = process.env[v];
        return val !== undefined && val !== '' && val !== '0' && String(val).toLowerCase() !== 'false';
      });
      const rlHome = path.join(os.homedir(), '.ruflo');
      let rlUserDisabled = false;
      try {
        const rlUserCfg = JSON.parse(fs.readFileSync(path.join(rlHome, 'funnel.json'), 'utf8'));
        rlUserDisabled = !!(rlUserCfg && rlUserCfg.enabled === false);
      } catch (e) { /* absent/malformed = not disabled */ }
      let rlProjectDisabled = false;
      try {
        const rlProjCfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'claude-flow.config.json'), 'utf8'));
        rlProjectDisabled = !!(rlProjCfg && rlProjCfg.funnel && rlProjCfg.funnel.enabled === false);
      } catch (e) { /* absent/malformed = not disabled */ }

      if (!rlDisabledByEnv && !rlIsCi && !rlUserDisabled && !rlProjectDisabled) {
        let rlStatus = null;
        try { rlStatus = JSON.parse(fs.readFileSync(path.join(rlHome, 'rate-limit-status.json'), 'utf8')); } catch (e) { /* not flagged */ }
        let rlIsLimited = false;
        if (rlStatus && rlStatus.limited) {
          if (rlStatus.since) {
            const rlSinceMs = Date.parse(rlStatus.since);
            rlIsLimited = isNaN(rlSinceMs) ? true : (Date.now() - rlSinceMs) < 6 * 60 * 60 * 1000;
          } else {
            rlIsLimited = true;
          }
        }
        if (rlIsLimited) {
          let rlConsented = false;
          try {
            const rlConsentFile = JSON.parse(fs.readFileSync(path.join(rlHome, 'consent.json'), 'utf8'));
            const rlReceipt = rlConsentFile && rlConsentFile['sponsored-downtime'];
            rlConsented = !!(rlReceipt && rlReceipt.granted === true && rlReceipt.at !== null && rlReceipt.policyVersion === 1);
          } catch (e) { /* not consented */ }
          if (!rlConsented) {
            console.log('[COGNITUM] Hit your Claude usage limit? Free sponsored capacity is available at cognitum.one/meta-llm — run: ruflo proxy sponsor-enable --yes');
          }
        }
      }
    } catch (e) { /* nudge must never break the hook */ }
  },

  'pre-bash': () => {
    // Basic command safety check — prefer stdin command data from Claude Code.
    // String() wrap is belt-and-suspenders for #2017: even if a future regression
    // re-binds `prompt` or `hookInput.command` to a non-string, `.toLowerCase()`
    // can no longer throw a TypeError that the global try/catch would swallow
    // (silently exiting 0 and letting the dangerous command through).
    const cmd = String(hookInput.command || toolInput.command || prompt || '').toLowerCase();
    const dangerous = ['rm -rf /', 'format c:', 'del /s /q c:\\', ':(){:|:&};:'];
    for (const d of dangerous) {
      if (cmd.includes(d)) {
        console.error(`[BLOCKED] Dangerous command detected: ${d}`);
        process.exit(1);
      }
    }
    console.log('[OK] Command validated');
  },

  'post-edit': () => {
    // Record edit for session metrics
    if (session && session.metric) {
      try { session.metric('edits'); } catch (e) { /* no active session */ }
    }
    // Record edit for intelligence consolidation — prefer stdin data from Claude Code
    if (intelligence && intelligence.recordEdit) {
      try {
        const file = hookInput.file_path || toolInput.file_path
          || process.env.TOOL_INPUT_file_path || args[0] || '';
        intelligence.recordEdit(file, !toolFailed);
      } catch (e) { /* non-fatal */ }
    }
    console.log(toolFailed ? '[LEARN] Edit FAILURE recorded' : '[OK] Edit recorded');
  },

  'session-restore': async () => {
    // ADR-318/319 first-run auto-enable — fire once per install, never
    // re-fires after user disables. Respects RUFLO_NO_AUTO_ENABLE + CI.
    // Fully non-blocking (detached spawn) so session-restore latency
    // is unchanged.
    firstRunAutoEnableIfEligible();
    if (session) {
      // Try restore first, fall back to start
      const existing = session.restore && session.restore();
      if (!existing) {
        session.start && session.start();
      }
    } else {
      // Minimal session restore output
      const sessionId = `session-${Date.now()}`;
      console.log(`[INFO] Restoring session: %SESSION_ID%`);
      console.log('');
      console.log(`[OK] Session restored from %SESSION_ID%`);
      console.log(`New session ID: ${sessionId}`);
      console.log('');
      console.log('Restored State');
      console.log('+----------------+-------+');
      console.log('| Item           | Count |');
      console.log('+----------------+-------+');
      console.log('| Tasks          |     0 |');
      console.log('| Agents         |     0 |');
      console.log('| Memory Entries |     0 |');
      console.log('+----------------+-------+');
    }
    // Initialize intelligence graph after session restore (with timeout — #1530)
    if (intelligence && intelligence.init) {
      const initResult = await runWithTimeout(() => intelligence.init(), 'intelligence.init()');
      if (initResult && initResult.nodes > 0) {
        console.log(`[INTELLIGENCE] Loaded ${initResult.nodes} patterns, ${initResult.edges} edges`);
      }
    }
    // Warm the funnel message cache once per session (see
    // spawnDetachedFunnelRefresh's doc comment for why this must happen
    // here, detached, rather than as the statusline's own fire-and-forget).
    spawnDetachedFunnelRefresh();
    // ADR-316 co-pilot advisor tip — same detached pattern; cheap no-op
    // when not consented or still within the 24h TTL (see refresh-advisor's
    // own doc comment).
    spawnDetachedAdvisorRefresh();
  },

  'session-end': async () => {
    // Consolidate intelligence before ending session (with timeout — #1530)
    if (intelligence && intelligence.consolidate) {
      const consResult = await runWithTimeout(() => intelligence.consolidate(), 'intelligence.consolidate()');
      if (consResult && consResult.entries > 0) {
        console.log(`[INTELLIGENCE] Consolidated: ${consResult.entries} entries, ${consResult.edges} edges${consResult.newEntries > 0 ? `, ${consResult.newEntries} new` : ''}, PageRank recomputed`);
      }
    }
    if (session && session.end) {
      session.end();
    } else {
      console.log('[OK] Session ended');
    }
  },

  'pre-task': () => {
    if (session && session.metric) {
      try { session.metric('tasks'); } catch (e) { /* no active session */ }
    }
    // Route the task if router is available
    if (router && router.routeTask && prompt) {
      const result = router.routeTask(prompt);
      console.log(`[INFO] Task routed to: ${result.agent} (confidence: ${result.confidence})`);
    } else {
      console.log('[OK] Task started');
    }
  },

  'post-task': () => {
    // ADR-174: feed the REAL outcome (feedback() boosts confidence on success,
    // decays it on failure) instead of a hardcoded true — no more all-positive
    // signal that the substrate can't learn from.
    if (intelligence && intelligence.feedback) {
      try {
        intelligence.feedback(!toolFailed);
      } catch (e) { /* non-fatal */ }
    }
    console.log(toolFailed ? '[LEARN] Task FAILURE recorded' : '[OK] Task completed');
  },

  'stats': () => {
    if (intelligence && intelligence.stats) {
      intelligence.stats(args.includes('--json'));
    } else {
      console.log('[WARN] Intelligence module not available. Run session-restore first.');
    }
  },
};

  // Execute the handler
  if (command && handlers[command]) {
    try {
      await Promise.resolve(handlers[command]());
    } catch (e) {
      // Hooks should never crash Claude Code - fail silently
      console.log(`[WARN] Hook ${command} encountered an error: ${e.message}`);
    }
  } else if (command) {
    // Unknown command - pass through without error
    console.log(`[OK] Hook: ${command}`);
  } else {
    console.log('Usage: hook-handler.cjs <route|pre-bash|post-edit|session-restore|session-end|pre-task|post-task|stats>');
  }
}

// Hooks must ALWAYS exit 0 — Claude Code treats non-zero as "hook error"
// and skips all subsequent hooks for the event.
//
// Only dispatch when run directly (node hook-handler.cjs <cmd>). When
// require()'d by a test, expose the internals instead of reading stdin and
// calling process.exit — the 2026-06-15 fix (cb1e93e8d) added this guard and
// the exports for tests/hook-handler-runwithtimeout.test.cjs; the 2026-07-04
// helper sync (a5f86ad0a) dropped both, so the test died with
// "runWithTimeout is not a function" once the Test Suite job ran again.
if (require.main === module) {
  process.exitCode = 0;
  main().catch((e) => {
    try { console.log(`[WARN] Hook handler error: ${e.message}`); } catch (_) {}
  }).finally(() => {
    process.exit(0);
  });
}

// resolveGlobalCliBin/npmGlobalPrefix are exported for
// hook-handler-global-cli.test.ts; resolveCliBinForHook for anyone checking
// what a given machine resolves to without running a hook (#3368).
module.exports = {
  runWithTimeout, INTELLIGENCE_TIMEOUT_MS,
  resolveCliBinForHook, resolveGlobalCliBin, npmGlobalPrefix,
};
