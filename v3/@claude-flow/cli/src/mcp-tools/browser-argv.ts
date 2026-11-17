/**
 * Argument checks for the agent-browser bridge.
 *
 * agent-browser reads its own options anywhere in argv, and forwards `--args`
 * to the Chromium it launches. Both are reachable from MCP tool input, so
 * caller text must never be able to add an option, and launch flags are
 * limited to a fixed list of plain switches.
 */

/** Chromium launch switches a caller may request. Exact matches only; none takes a value. */
export const ALLOWED_LAUNCH_ARGS: ReadonlySet<string> = new Set([
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--disable-extensions',
  '--mute-audio',
  '--hide-scrollbars',
  '--incognito',
]);

/** The agent-browser options the browser tools themselves emit after a subcommand. */
const COMMAND_FLAGS: ReadonlySet<string> = new Set([
  '--wait-until', '--full', '--button', '--count', '--delay', '--text', '--url',
  '-i', '-c', '-d', '-s',
]);

/** Returns an error when a launch-flag list contains anything outside the allowlist. */
export function launchArgsError(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return 'args must be an array of strings';
  for (const arg of value) {
    if (typeof arg !== 'string') return 'args must be an array of strings';
    if (!ALLOWED_LAUNCH_ARGS.has(arg)) {
      return `launch arg not allowed: ${JSON.stringify(arg.slice(0, 80))} (allowed: ${[...ALLOWED_LAUNCH_ARGS].join(', ')})`;
    }
  }
  return null;
}

/**
 * Returns an error when argv contains an option the tools did not mean to
 * pass — for example a selector or typed text of "--executable-path".
 */
export function commandArgvError(args: readonly string[]): string | null {
  if (args[0] === 'open') {
    const urlError = browserUrlError(args[1]);
    if (urlError) return urlError;
  }
  for (const arg of args) {
    if (typeof arg !== 'string') return 'browser command arguments must be strings';
    if (arg.startsWith('--')) {
      const name = arg.split('=', 1)[0];
      if (!COMMAND_FLAGS.has(name)) return `value must not start with "--": ${JSON.stringify(arg.slice(0, 80))}`;
    } else if (/^-[A-Za-z]$/.test(arg) && !COMMAND_FLAGS.has(arg)) {
      return `value must not be an option: ${JSON.stringify(arg)}`;
    }
  }
  return null;
}

/**
 * Returns an error when a navigation target is not a web page. The browser
 * tools return page text to the caller, so a `file:` URL (or `view-source:`,
 * `chrome:`, `data:` and the like) would read local files or browser state
 * that `http_fetch` never serves. Only http(s) URLs, `about:blank`, and
 * scheme-less targets such as `example.com/path` or `localhost:3000` (which
 * agent-browser opens over http(s)) are accepted.
 */
export function browserUrlError(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return 'url must be a non-empty string';
  // Chromium drops tabs and newlines anywhere in a URL and trims leading
  // control characters and spaces, so check what it would actually parse.
  const url = value.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+/, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!scheme) return null;
  const name = scheme[1].toLowerCase();
  if (name === 'http' || name === 'https') return null;
  if (url.toLowerCase() === 'about:blank') return null;
  // `host:port` with no scheme, e.g. `localhost:3000/app`. The host must be
  // `localhost` or contain a dot, so `file:1/...` is not mistaken for one.
  if ((name === 'localhost' || name.includes('.')) && /^[a-z0-9.-]+:\d{1,5}(?:[/?#]|$)/i.test(url)) return null;
  return `url scheme not allowed: ${JSON.stringify(name.slice(0, 40))} (use http or https)`;
}
