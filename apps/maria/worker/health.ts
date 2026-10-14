// État de la machine du worker, affiché sur la page Connecteurs (aucun secret : seulement des présences).
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { WorkerHealth } from '../src/lib/connectors';

const exec = promisify(execFile);

async function out(cmd: string, args: string[], cwd?: string): Promise<{ ok: boolean; text: string }> {
  try {
    const { stdout, stderr } = await exec(cmd, args, { cwd, timeout: 20_000 });
    return { ok: true, text: `${stdout}${stderr}`.trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, text: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() };
  }
}

/** Serveurs MCP déclarés par le projet dans son .mcp.json (ex. claude-flow pour Ruflo). */
function projectMcp(dir: string): string[] {
  try {
    const json = JSON.parse(readFileSync(path.join(dir, '.mcp.json'), 'utf8')) as { mcpServers?: Record<string, unknown> };
    return Object.keys(json.mcpServers ?? {});
  } catch {
    return [];
  }
}

export async function computeHealth(claudeBin: string, dir: string, envNames: string[]): Promise<WorkerHealth> {
  const [claude, ghVersion, ghAuth] = await Promise.all([
    out(claudeBin, ['--version']),
    out('gh', ['--version']),
    out('gh', ['auth', 'status']),
  ]);
  const account = /Logged in to \S+ (?:account|as) (\S+)/.exec(ghAuth.text)?.[1] ?? null;
  return {
    checked_at: new Date().toISOString(),
    node: process.versions.node,
    claude: claude.ok ? claude.text.split('\n')[0] : null,
    gh: { installed: ghVersion.ok, logged_in: ghAuth.ok, account },
    ruflo: { initialized: existsSync(path.join(dir, '.claude-flow')), memory: existsSync(path.join(dir, '.swarm', 'memory.db')) },
    project_mcp: projectMcp(dir),
    env_present: [...new Set(envNames)].filter((v) => !!process.env[v]?.trim()).sort(),
  };
}
