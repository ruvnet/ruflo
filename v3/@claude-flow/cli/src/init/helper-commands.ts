/**
 * Hook and statusline commands that launch the `.claude/helpers` scripts.
 *
 * A project-level settings.json (`<project>/.claude/settings.json`) keeps the
 * #1943 probe: run the project's helper, fall back to `$HOME/.claude/helpers`.
 * The project controls that settings file anyway, so preferring its helpers
 * grants it nothing new.
 *
 * A user-level settings.json (`~/.claude/settings.json`) applies to every
 * project the user opens. There the probe would let any opened project supply
 * the helper that runs, so user-level commands are pinned to the user's own
 * `$HOME/.claude/helpers` with no project lookup.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type HelperScope = 'project' | 'user';

/** Claude Code reads a hook's `timeout` in SECONDS; the auto-memory hooks wrote 6000-10000, i.e. up to 100 minutes (#4058). */
export const AUTO_MEMORY_HOOK_TIMEOUT_S = 30;

const IS_WINDOWS = process.platform === 'win32';
const STATUSLINE_SCRIPT = '.claude/helpers/statusline.cjs';

function canonical(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

/** Settings written into the user's home directory are user-level settings. */
export function helperScopeFor(targetDir: string | undefined): HelperScope {
  if (!targetDir) return 'project';
  return canonical(targetDir) === canonical(os.homedir()) ? 'user' : 'project';
}

/**
 * Windows hook command (#4045). It must not go through `cmd /c`: under Git Bash
 * MSYS rewrites `/c` into a path, cmd starts interactively and executes the
 * hook's stdin JSON, and any `>` in that text creates a file. A single
 * `node -e` has no shell syntax to misread (no cmd, no `%VAR%`, no `<>|&$` and
 * no inner double quotes), so cmd, PowerShell and Git Bash pass it through
 * unchanged. The script and its subcommand stay in one string, because the
 * ruflo-mods ownership rule matches `hook-handler.cjs <subcommand>`. Project
 * scope prefers the project's helper and falls back to the user profile's
 * (#1943); user scope never looks at the project. The helper runs as a child
 * with inherited stdio so stdin, stdout and the exit status pass through (a
 * `require` would skip the helper's `require.main === module` entry point).
 */
function windowsHookCommand(script: string, subcommand: string, scope: HelperScope): string {
  // Ternaries, not `||`: the command carries no pipe or ampersand at all.
  const home = "(e.USERPROFILE?e.USERPROFILE:e.HOME?e.HOME:'.')";
  const pick = scope === 'user'
    ? `f=p.join(${home},a[0]);`
    : "f=p.join(e.CLAUDE_PROJECT_DIR?e.CLAUDE_PROJECT_DIR:'.',a[0]);" +
      `if(!fs.existsSync(f))f=p.join(${home},a[0]);`;
  const js = `var a='${[script, subcommand].filter(Boolean).join(' ')}'.split(' '),e=process.env,fs=require('fs'),p=require('path'),f;` + pick +
    "var r=require('child_process').spawnSync(process.execPath,[f].concat(a.slice(1)),{stdio:'inherit'});" +
    'process.exit(r.status===null?1:r.status)';
  return `node -e "${js}"`;
}

/** Command that runs `node <script> <subcommand>` for a hook. */
export function helperHookCommand(script: string, subcommand: string, scope: HelperScope, windows = IS_WINDOWS): string {
  const arg = subcommand ? ` ${subcommand}` : '';
  if (windows) return windowsHookCommand(script, subcommand, scope);
  if (scope === 'user') return `sh -c 'exec node "\${HOME}/${script}"${arg}'`;
  // POSIX sh: prefer project-local helpers, fall back to $HOME/.claude/.
  // eslint-disable-next-line no-template-curly-in-string
  const projVar = '${CLAUDE_PROJECT_DIR:-.}';
  // eslint-disable-next-line no-template-curly-in-string
  const homeVar = '${HOME}';
  return `sh -c 'D="${projVar}"; [ -f "$D/${script}" ] || D="${homeVar}"; exec node "$D/${script}"${arg}'`;
}

/** Command for the statusLine entry. */
export function helperStatusLineCommand(scope: HelperScope, windows = IS_WINDOWS): string {
  if (windows) {
    // The Node CLI's `-e` flag avoids all shell-quoting pitfalls (#1948,
    // #1973): never `cmd /c` for statusline, it blocks stdin forwarding.
    const home = "p.join(process.env.USERPROFILE||process.env.HOME||'.', '" + STATUSLINE_SCRIPT + "')";
    const js = scope === 'user'
      ? `const p=require('path');require(${home});`
      : "const fs=require('fs'),p=require('path');" +
        `const d=process.env.CLAUDE_PROJECT_DIR||'.';` +
        `const f=p.join(d,'${STATUSLINE_SCRIPT}');` +
        `const h=${home};` +
        'require(fs.existsSync(f)?f:h);';
    return `node -e "${js}"`;
  }
  if (scope === 'user') return `sh -c 'exec node "\${HOME}/${STATUSLINE_SCRIPT}"'`;
  // eslint-disable-next-line no-template-curly-in-string
  const projVar = '${CLAUDE_PROJECT_DIR:-.}';
  // eslint-disable-next-line no-template-curly-in-string
  const homeVar = '${HOME}';
  return `sh -c 'D="${projVar}"; [ -f "$D/${STATUSLINE_SCRIPT}" ] || D="${homeVar}"; exec node "$D/${STATUSLINE_SCRIPT}"'`;
}

// Helpers ruflo installs under .claude/helpers that settings can launch.
const RUFLO_HELPERS = [
  'hook-handler.cjs', 'auto-memory-hook.mjs', 'statusline.cjs', 'ruflo-hook.cjs', 'router.cjs',
  'session.cjs', 'memory.cjs', 'intelligence.cjs', 'learning-service.mjs', 'metrics-db.mjs',
  'context-persistence-hook.mjs',
];
const HELPER_REF = new RegExp(`\\.claude[\\\\/]helpers[\\\\/](${RUFLO_HELPERS.map((h) => h.replace('.', '\\.')).join('|')})`, 'g');
// How a ruflo-generated command reached the project's copy of a helper:
// CLAUDE_PROJECT_DIR (sh, cmd or node -e), `git rev-parse --show-toplevel`,
// or a path relative to the cwd.
const PROJECT_REACH = /CLAUDE_PROJECT_DIR|git rev-parse --show-toplevel/;
const RELATIVE_REF = /(?:^|[\s"'])(?:\.[\\/])?\.claude[\\/]helpers[\\/]/;
const SHELL_CHAINING = /&&|\|\||[;|<>`]/;
const ARGS = /^(?: [\w:.=-]+)*$/;
// The fixed shell scaffolding of the #1943 probes, which itself contains `;`
// and `||`; removed before checking the rest for chaining.
const PROBE_PREAMBLE = /D="\$\{CLAUDE_PROJECT_DIR:-\.\}"; \[ -f "\$D\/\.claude\/helpers\/[\w.-]+" \] \|\| D="\$\{HOME\}"; /;
const IF_EXIST_PREAMBLE = /"IF EXIST "%CLAUDE_PROJECT_DIR%\\\.claude\\helpers\\[\w.-]+" \(node "%CLAUDE_PROJECT_DIR%\\\.claude\\helpers\\[\w.-]+"(?: [\w:.=-]+)*\) ELSE \(/;

/**
 * Rewrite a command that runs one of ruflo's helpers from the opened project
 * into the pinned user-level form, keeping its subcommand. Covers every form
 * ruflo has shipped: the #1943 sh/cmd probes, the earlier
 * `${CLAUDE_PROJECT_DIR:-.}` / `%CLAUDE_PROJECT_DIR%` forms, the ADR-059
 * `git rev-parse` node -e forms (CJS and ESM, with or without argv.splice),
 * and plain relative paths. Returns null for anything else, so user-authored
 * commands (other scripts, redirects, chains) are left alone.
 */
export function pinToUserHelpers(command: string, windows = IS_WINDOWS): string | null {
  // The #4045 Windows form: recognised only when it is exactly what ruflo generates.
  const generated = /^node -e "var a='\.claude\/helpers\/([\w.-]+)((?: [\w:.=-]+)*)'\.split\(' '\)/.exec(command);
  if (generated) {
    if (!RUFLO_HELPERS.includes(generated[1])) return null;
    const script = `.claude/helpers/${generated[1]}`;
    const subcommand = generated[2].trim();
    return command === helperHookCommand(script, subcommand, 'project', true)
      ? helperHookCommand(script, subcommand, 'user', true)
      : null;
  }
  const refs = [...command.matchAll(HELPER_REF)];
  if (refs.length === 0) return null;
  const helper = refs[refs.length - 1][1];
  if (refs.some((m) => m[1] !== helper)) return null;
  if (!PROJECT_REACH.test(command) && !RELATIVE_REF.test(command)) return null;

  let args: string;
  const nodeEval = /^node -e "(.*)"((?: [\w:.=-]+)*)$/.exec(command);
  if (nodeEval) {
    if (!/git rev-parse --show-toplevel|CLAUDE_PROJECT_DIR/.test(nodeEval[1])) return null;
    args = nodeEval[2];
  } else {
    if (!/^(?:sh -c '|cmd \/c |node )/.test(command)) return null;
    // Drop the shell wrapper's closing quote / paren, then split around the
    // last helper reference: the head launches it, the tail is its argv.
    const body = command.replace(/'$/, '').replace(/\)"$/, '');
    const last = refs[refs.length - 1];
    const head = body.slice(0, last.index ?? 0).replace(PROBE_PREAMBLE, '').replace(IF_EXIST_PREAMBLE, '');
    let tail = body.slice((last.index ?? 0) + last[0].length);
    if (tail.startsWith('"')) tail = tail.slice(1);
    if (SHELL_CHAINING.test(head) || SHELL_CHAINING.test(tail)) return null;
    args = tail.trimEnd();
  }
  if (!ARGS.test(args)) return null;
  const script = `.claude/helpers/${helper}`;
  if (helper === 'statusline.cjs' && args === '') return helperStatusLineCommand('user', windows);
  return helperHookCommand(script, args.trim(), 'user', windows);
}

/**
 * ADR-059 statusLine command `init upgrade` writes for a project-level
 * settings file (the git-root `node -e` form). Exported so the upgrade and the
 * ADR-509 classifier use one string.
 */
export const GIT_ROOT_STATUSLINE_CMD =
  `node -e "var c=require('child_process'),p=require('path'),r;try{r=c.execSync('git rev-parse --show-toplevel',{encoding:'utf8'}).trim()}catch(e){r=process.cwd()}var s=p.join(r,'.claude/helpers/statusline.cjs');process.argv.splice(1,0,s);require(s)"`;

/** Subcommands ruflo has written for each helper it launches from a hook. */
const HELPER_SUBCOMMANDS: Record<string, readonly string[]> = {
  'hook-handler.cjs': [
    'pre-bash', 'post-bash', 'pre-edit', 'post-edit', 'pre-task', 'post-task', 'pre-command', 'post-command',
    'route', 'session-restore', 'session-end', 'session-start', 'notify', 'stats', 'status', 'compact-manual', 'compact-auto',
  ],
  'auto-memory-hook.mjs': ['import', 'sync', 'status'],
};

const GIT_ROOT = "var c=require('child_process'),p=require('path'),r;try{r=c.execSync('git rev-parse --show-toplevel',{encoding:'utf8'}).trim()}catch(e){r=process.cwd()}";
const GIT_ROOT_ESM = "var c=require('child_process'),p=require('path'),u=require('url'),r;try{r=c.execSync('git rev-parse --show-toplevel',{encoding:'utf8'}).trim()}catch(e){r=process.cwd()}";

/** Every exact command string ruflo has generated (or generates) to launch `script` with `sub`. */
function generatedForms(script: string, sub: string): string[] {
  const arg = sub ? ` ${sub}` : '';
  const win = script.replace(/\//g, '\\');
  const forms = [
    ...(['project', 'user'] as const).flatMap((scope) => [helperHookCommand(script, sub, scope, false), helperHookCommand(script, sub, scope, true)]),
    `node ${script}${arg}`,
    `node "$CLAUDE_PROJECT_DIR/${script}"${arg}`,
    `sh -c 'exec node "\${CLAUDE_PROJECT_DIR:-.}/${script}"${arg}'`,
    `cmd /c node %CLAUDE_PROJECT_DIR%/${script}${arg}`,
    `cmd /c "IF EXIST \"%CLAUDE_PROJECT_DIR%\\${win}\" (node \"%CLAUDE_PROJECT_DIR%\\${win}\"${arg}) ELSE (node \"%USERPROFILE%\\${win}\"${arg})"`,
  ];
  if (script.endsWith('.mjs')) {
    forms.push(
      `node -e "${GIT_ROOT_ESM}var f=p.join(r,'${script}');process.argv.splice(1,0,f);import(u.pathToFileURL(f).href)"${arg}`,
      `node -e "${GIT_ROOT_ESM}var f=p.join(r,'${script}');import(u.pathToFileURL(f).href)"${arg}`,
    );
  } else {
    forms.push(`node -e "${GIT_ROOT}var s=p.join(r,'${script}');process.argv.splice(1,0,s);require(s)"${arg}`);
  }
  return forms;
}

let knownCommands: Set<string> | undefined;

/** The closed set of hook and statusLine commands ruflo writes, built once. */
function rufloCommands(): Set<string> {
  if (knownCommands) return knownCommands;
  const set = new Set<string>();
  for (const [helper, subs] of Object.entries(HELPER_SUBCOMMANDS)) {
    for (const sub of subs) for (const form of generatedForms(`.claude/helpers/${helper}`, sub)) set.add(form);
  }
  for (const scope of ['project', 'user'] as const) for (const win of [false, true]) set.add(helperStatusLineCommand(scope, win));
  for (const form of generatedForms(STATUSLINE_SCRIPT, '')) set.add(form);
  set.add(GIT_ROOT_STATUSLINE_CMD);
  knownCommands = set;
  return set;
}

// Older ruflo-generated CLI hooks (`npx @claude-flow/cli@latest hooks pre-bash`), which `init upgrade` migrates.
// Exact shape only: a registry spec with a version or tag (never a bare name a project's node_modules/.bin
// could answer), one of ruflo's own hook/memory subcommands, and at most ten plain words with no shell
// syntax (bounded, one alternative: no backtracking blow-up on a crafted settings file).
const LEGACY_NPX_HOOK =
  /^npx (?:-y |--yes )?(?:@claude-flow\/cli|claude-flow|ruflo)@(?:latest|alpha|v3alpha|\d+\.\d+\.\d+(?:-[\w.]+)?) (?:hooks (?:pre-bash|post-bash|pre-edit|post-edit|pre-task|post-task|pre-command|post-command|route|session-start|session-end|session-restore|notify|statusline)|memory (?:import|sync|store))(?: [\w.:=-]+){0,10}$/;

/**
 * ADR-509: whether a settings hook (or statusLine) command is one of ruflo's own
 * helper launches. Exact string equality against the closed set of commands
 * ruflo generates or has generated, for each helper, each subcommand it is
 * launched with, each scope and each platform. No substring or pattern test on
 * the helper path: a command that merely mentions a helper (in a comment, after
 * `node -r`, `--import` or a NODE_OPTIONS= prefix, or with code chained on) is
 * a command ruflo did not write.
 */
export function isRufloHelperCommand(command: string): boolean {
  return rufloCommands().has(command) || LEGACY_NPX_HOOK.test(command);
}
