/**
 * `ruflo add <capability>` — install a heavy optional capability on demand (ADR-525).
 *
 * Installs into the user-level add-on root with `npm install --prefix`, using
 * the version range the CLI was tested with. npm runs from an argument array
 * with no shell, and only registered add-on names are accepted.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import {
  ADDONS,
  addonRoot,
  isAddonName,
  readPackageVersion,
  resolveAddonPackageRoot,
  type AddonName,
} from '../addons/index.js';

/** The npm arguments `ruflo add` runs for an add-on. Exported for tests. */
export function buildNpmInstallArgs(name: AddonName, root: string): string[] {
  const spec = ADDONS[name];
  return ['install', '--no-audit', '--no-fund', '--prefix', root, `${spec.pkg}@${spec.range}`];
}

/**
 * How to run npm without a shell: through the npm CLI script with this Node
 * when it can be found, otherwise the `npm` binary on PATH (not on Windows,
 * where `npm.cmd` cannot be spawned without a shell).
 */
export function resolveNpmInvocation(): { command: string; prefixArgs: string[] } | null {
  const candidates: string[] = [];
  const execPath = process.env.npm_execpath;
  if (execPath && /npm-cli\.c?js$/.test(basename(execPath))) candidates.push(execPath);
  const nodeDir = dirname(process.execPath);
  candidates.push(join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  candidates.push(join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  for (const cli of candidates) {
    if (existsSync(cli)) return { command: process.execPath, prefixArgs: [cli] };
  }
  if (process.platform === 'win32') return null;
  return { command: 'npm', prefixArgs: [] };
}

function runNpm(command: string, args: string[]): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false });
    child.on('error', () => resolvePromise(1));
    child.on('close', (code) => resolvePromise(typeof code === 'number' ? code : 1));
  });
}

function listAddons(): CommandResult {
  const root = addonRoot();
  const rows = (Object.keys(ADDONS) as AddonName[]).map((name) => {
    const spec = ADDONS[name];
    const found = resolveAddonPackageRoot(spec.pkg);
    const version = found ? readPackageVersion(found.dir) : null;
    return {
      name,
      package: `${spec.pkg}@${spec.range}`,
      status: found ? `installed${version ? ` v${version}` : ''}` : 'missing',
      where: found ? found.dir : `ruflo add ${name}`,
      provides: spec.provides,
    };
  });
  output.writeln(`Add-on root: ${root}`);
  output.printTable({
    columns: [
      { key: 'name', header: 'Add-on', width: 10 },
      { key: 'package', header: 'Package', width: 22 },
      { key: 'status', header: 'Status', width: 26 },
      { key: 'where', header: 'Where / install', width: 50 },
    ],
    data: rows,
  });
  for (const row of rows) output.writeln(output.dim(`  ${row.name}: ${row.provides}`));
  return { success: true, data: { root, addons: rows } };
}

export const addCommand: Command = {
  name: 'add',
  description: 'Install an optional heavy capability on demand (e.g. `ruflo add learning`)',
  options: [
    { name: 'list', type: 'boolean', description: 'List add-ons, whether each is installed, and where', default: false },
  ],
  examples: [
    { command: 'ruflo add --list', description: 'Show available add-ons and their install state' },
    { command: 'ruflo add learning', description: 'Install agentic-flow for autopilot learning and ReasoningBank retrieval' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    if (ctx.flags.list) return listAddons();

    const name = ctx.args[0];
    const valid = Object.keys(ADDONS).join(', ');
    if (!name) {
      output.printError(`Name an add-on to install. Available: ${valid}`);
      output.writeln(output.dim('Run `ruflo add --list` to see what each one provides.'));
      return { success: false, exitCode: 1 };
    }
    if (!isAddonName(name)) {
      output.printError(`Unknown add-on "${name}". Available: ${valid}`);
      return { success: false, exitCode: 1 };
    }

    const spec = ADDONS[name];
    const existing = resolveAddonPackageRoot(spec.pkg);
    if (existing) {
      const version = readPackageVersion(existing.dir);
      output.printSuccess(`${spec.pkg}${version ? ` v${version}` : ''} is already installed (${existing.dir})`);
      return { success: true, data: { name, installed: true, dir: existing.dir } };
    }

    const root = addonRoot();
    const npm = resolveNpmInvocation();
    const args = buildNpmInstallArgs(name, root);
    output.writeln(`Installing the ${name} add-on: ${spec.pkg}@${spec.range}`);
    output.writeln(`  Provides: ${spec.provides}`);
    output.writeln(`  Size:     ${spec.approxSize}`);
    output.writeln(`  Into:     ${root}`);
    if (!npm) {
      output.printError('Could not locate the npm CLI to run without a shell.');
      output.writeln(`Run it yourself: npm ${args.join(' ')}`);
      return { success: false, exitCode: 1 };
    }

    mkdirSync(root, { recursive: true });
    const code = await runNpm(npm.command, [...npm.prefixArgs, ...args]);
    if (code !== 0) {
      output.printError(`npm exited with code ${code}; the ${name} add-on was not installed.`);
      return { success: false, exitCode: code };
    }
    output.printSuccess(`Installed the ${name} add-on into ${root}`);
    return { success: true, data: { name, installed: true, root } };
  },
};

export default addCommand;
