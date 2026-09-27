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
 *   post-agent     - Record an Agent/Task call for routing learning (PostToolUse)
 *   session-restore - Restore previous session state
 *   session-end    - End session and persist state
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const helpersDir = __dirname;

// Resolve an installed @claude-flow/cli (or ruflo) bin — mirrors
// statusline-generator.ts's resolveCliBin() candidate list. Used only to
// spawn the detached funnel-refresh helper below; failures are silent (no
// candidate found just means the refresh never fires this session).
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
function resolveCliBinForHook() {
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
      try {
        if (fs.existsSync(p) && fs.existsSync(path.join(path.dirname(p), '..', 'dist', 'src', 'index.js'))) {
          return p;
        }
      } catch (e) { /* try next candidate */ }
    }
  } catch (e) { /* ignore */ }
  return null;
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
// No usable local candidate (resolveCliBinForHook() returned null) falls
// back to npx: this call is detached/unref'd, so a slower npx cold-start
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
// Compile a helper as CommonJS regardless of the project's package "type".
function loadCommonJs(modulePath) {
  const Module = require('module');
  const mod = new Module(modulePath, module);
  mod.filename = modulePath;
  mod.paths = Module._nodeModulePaths(path.dirname(modulePath));
  mod._compile(fs.readFileSync(modulePath, 'utf8'), modulePath);
  return mod.exports;
}

// In a project whose package.json says "type": "module", Node treats these
// CommonJS .js helpers as ES modules. Depending on the Node version and the
// helper, require() then returns an empty namespace, throws ERR_REQUIRE_ESM,
// or throws "require is not defined in ES module scope" (a ReferenceError
// with no code), and routing silently disappeared. Prefer a .cjs sibling;
// otherwise a .js helper that fails or loads empty gets one retry compiled
// explicitly as CommonJS.
function safeRequire(modulePath) {
  const candidates = modulePath.endsWith('.js')
    ? [modulePath.slice(0, -3) + '.cjs', modulePath]
    : [modulePath];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const origLog = console.log;
    const origError = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      let mod;
      try {
        mod = require(candidate);
      } catch (e) {
        if (!candidate.endsWith('.js')) throw e;
        mod = loadCommonJs(candidate);
      }
      if (candidate.endsWith('.js') && mod && typeof mod === 'object' && Object.keys(mod).length === 0) {
        mod = loadCommonJs(candidate);
      }
      return mod;
    } catch (e) {
      // silently fail; try the next candidate
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  }
  return null;
}

const router = safeRequire(path.join(helpersDir, 'router.js'));
const session = safeRequire(path.join(helpersDir, 'session.js'));
const memory = safeRequire(path.join(helpersDir, 'memory.js'));
const intelligence = safeRequire(path.join(helpersDir, 'intelligence.cjs'));

// ── Routing learning loop ──────────────────────────────────────────────
// post-agent appends every Agent/Task call to .claude-flow/routing-observations.jsonl
// (see services/routing-outcome-store.ts). Only keywords and a prompt hash are
// stored, never prompt text. A completed call is `unknown`, not a success:
// only an explicit outcome (hooks_post-task, routing-outcomes.json) labels a
// success. The TS side compiles learned-patterns.json from the labelled rows;
// route reads it (behind CLAUDE_FLOW_ROUTER_LEARNED) only when the keyword
// router had no match. Keep ROUTING_STOPWORDS and
// extractRoutingKeywords identical to routing-outcome-store.ts (parity test).
const ROUTING_STOPWORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'to','of','in','for','on','with','at','by','from','as','into','through','during',
  'before','after','above','below','between','under','again','further','then','once',
  'it','its','this','that','these','those','i','me','my','we','our','you','your',
  'he','she','they','them','and','but','or','nor','not','no','so','if','when','than',
  'very','just','also','only','both','each','all','any','few','more','most','other',
  'some','such','same','new','now','here','there','where','how','what','which','who',
]);
const MAX_ROUTING_STORE_BYTES = 5 * 1024 * 1024;
const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,79}$/;

function extractRoutingKeywords(text) {
  if (!text) return [];
  return String(text).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !ROUTING_STOPWORDS.has(w));
}

// Same precedence as getProjectCwd() in @claude-flow/cli-core, so the hook and
// the MCP server resolve the same store, then Claude Code's project dir.
// Keywords safe to persist (identical to storableRoutingKeywords in TS):
// plain words only, so tokens shaped like credentials or IDs are never stored.
const STORABLE_KEYWORD = /^[a-z](?:[a-z-]{1,22}[a-z])$/;
function storableRoutingKeywords(text, max) {
  const limit = max || 40;
  return Array.from(new Set(extractRoutingKeywords(text).filter((w) => STORABLE_KEYWORD.test(w)))).slice(0, limit);
}

function projectRoot(hi) {
  const flowCwd = process.env.CLAUDE_FLOW_CWD;
  if (flowCwd && flowCwd !== '/' && flowCwd !== process.env.HOME) return path.resolve(flowCwd);
  const dir = process.env.CLAUDE_PROJECT_DIR
    || (hi && typeof hi.cwd === 'string' && hi.cwd)
    || process.cwd();
  return path.resolve(dir);
}

// Agent responses are prose that often mentions errors that were fixed, so
// only a structured error flag counts as failure here (not the keyword match
// toolFailed uses for Bash output).
function agentCallFailed(hi) {
  const tr = hi && (hi.tool_response != null ? hi.tool_response : hi.toolResponse);
  return !!(tr && typeof tr === 'object' && (tr.is_error === true || tr.isError === true));
}

// Observations go to their own append-only JSONL file, NOT routing-outcomes.json.
// That store holds the rare labelled outcomes the learner uses; sharing its
// 500-row cap with a row per agent call would evict every label within days,
// and a read-modify-write there loses rows when parallel agents finish at once.
// One appendFileSync of a short line is atomic enough for concurrent hooks.
function recordAgentOutcome(hi) {
  const ti = (hi && (hi.tool_input || hi.toolInput)) || {};
  // subagent_type is optional on the Agent tool; omitting it runs general-purpose.
  const agent = typeof ti.subagent_type === 'string' && ti.subagent_type.trim()
    ? ti.subagent_type.trim()
    : 'general-purpose';
  const text = typeof ti.prompt === 'string' ? ti.prompt
    : (typeof ti.description === 'string' ? ti.description : '');
  if (!AGENT_NAME_RE.test(agent) || !text.trim()) return null;
  const failed = agentCallFailed(hi);
  const row = {
    agent,
    promptHash: 'sha256:' + require('crypto').createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16),
    keywords: storableRoutingKeywords(text),
    outcome: failed ? 'failure' : 'unknown',
    signal: failed ? 'tool_error' : 'none',
    // A background agent's PostToolUse fires at spawn, so its result is unknown here.
    background: ti.run_in_background === true,
    source: 'hook',
    timestamp: new Date().toISOString(),
  };
  const file = path.join(projectRoot(hi), '.claude-flow', 'routing-observations.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    // Keep one rotated generation so the file stays bounded.
    if (fs.statSync(file).size > MAX_ROUTING_STORE_BYTES) fs.renameSync(file, `${file}.1`);
  } catch (e) { /* no file yet */ }
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
  return row;
}

// Opt-in (CLAUDE_FLOW_ROUTER_LEARNED=1) until the ADR-391 benchmark shows a
// gain. Consulted only when the keyword router fell through to its default.
function learnedFallback(promptText, root) {
  if (!/^(1|true|on|yes)$/i.test(String(process.env.CLAUDE_FLOW_ROUTER_LEARNED || '').trim())) return null;
  const minSupport = Math.max(1, parseInt(process.env.CLAUDE_FLOW_ROUTER_LEARNED_MIN_SUPPORT || '30', 10) || 30);
  let data;
  try {
    const file = path.join(root, '.claude-flow', 'learned-patterns.json');
    if (fs.statSync(file).size > 1024 * 1024) return null;
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { return null; }
  const words = new Set(extractRoutingKeywords(promptText));
  let best = null;
  for (const p of Object.values((data && data.patterns) || {})) {
    if (!p || !Array.isArray(p.keywords) || !Array.isArray(p.agents)) continue;
    const agent = p.agents[0];
    if (typeof agent !== 'string' || !AGENT_NAME_RE.test(agent)) continue;
    const support = Number(p.support) || 0;
    const reliability = Math.max(0, Math.min(1, Number(p.reliability) || 0));
    if (support < minSupport) continue;
    const hits = p.keywords.filter((k) => words.has(k)).length;
    if (hits < 2) continue;
    const score = hits * reliability;
    if (!best || score > best.score) best = { agent, hits, score, support, reliability };
  }
  return best;
}

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
      let result = router.routeTask(prompt);
      if (result && /^Default routing/.test(result.reason || '')) {
        try {
          const learned = learnedFallback(prompt, projectRoot(hookInput));
          if (learned) {
            result = {
              agent: learned.agent,
              confidence: Math.min(0.6, 0.3 + 0.05 * learned.hits),
              reason: `Learned from ${learned.support} outcomes (${learned.hits} keyword hits)`,
            };
          }
        } catch (e) { /* keep the keyword result */ }
      }
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

  'post-agent': () => {
    if (toolName !== 'Task' && toolName !== 'Agent') {
      console.log('[OK] post-agent: not an agent call');
      return;
    }
    const row = recordAgentOutcome(hookInput);
    console.log(row
      ? `[LEARN] Agent outcome recorded (${row.agent}: ${row.outcome})`
      : '[OK] post-agent: nothing to record');
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

module.exports = {
  runWithTimeout,
  INTELLIGENCE_TIMEOUT_MS,
  safeRequire,
  extractRoutingKeywords,
  storableRoutingKeywords,
  ROUTING_STOPWORDS,
  recordAgentOutcome,
  learnedFallback,
};
