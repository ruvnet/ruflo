/**
 * @claude-flow/browser - agent-browser argv guard
 *
 * agent-browser reads its own options anywhere in argv, so a caller value
 * (selector, typed text, URL, path) that starts with "--" would be parsed
 * as an option such as --executable-path. Values reach the adapter from MCP
 * tool input, so command argv may only carry the options the adapter itself
 * emits. Mirrors @claude-flow/cli's browser-argv.ts.
 */

/** Options the adapter emits after a subcommand. Global options (--session, --executable-path, ...) are excluded. */
const COMMAND_FLAGS: ReadonlySet<string> = new Set([
  '--abort', '--body', '--button', '--clear', '--click-count', '--delay',
  '--exact', '--filter', '--fn', '--force', '--full', '--headers', '--load',
  '--name', '--status', '--text', '--url', '--wait', '--with-deps',
  '-c', '-d', '-i', '-s',
]);

/** Returns an error when command argv contains an option the adapter did not mean to pass. */
export function commandArgvError(args: readonly unknown[]): string | null {
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
 * Returns an error when a navigation target is not a web page. Page text is
 * returned to the caller, so file:, view-source:, chrome:, data: and similar
 * schemes would read local files or browser state. Accepts http(s),
 * about:blank, and scheme-less targets such as example.com/path or
 * localhost:3000.
 */
export function browserUrlError(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return 'url must be a non-empty string';
  // Chromium drops tabs/newlines anywhere and trims leading control chars and spaces.
  const url = value.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+/, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!scheme) return null;
  const name = scheme[1].toLowerCase();
  if (name === 'http' || name === 'https') return null;
  if (url.toLowerCase() === 'about:blank') return null;
  // host:port with no scheme; host must be localhost or contain a dot.
  if ((name === 'localhost' || name.includes('.')) && /^[a-z0-9.-]+:\d{1,5}(?:[/?#]|$)/i.test(url)) return null;
  return `url scheme not allowed: ${JSON.stringify(name.slice(0, 40))} (use http or https)`;
}
