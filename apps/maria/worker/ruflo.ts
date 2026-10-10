import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RufloAgent } from '../src/lib/types';

const exec = promisify(execFile);
const TIMEOUT_MS = 90_000;

/** Un appel d'outil laisse-t-il penser que la mission a utilisé Ruflo ? */
export function touchesRuflo(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName.startsWith('mcp__claude-flow__')) return true;
  return toolName === 'Bash' && typeof input.command === 'string' && /\b(ruflo|claude-flow)\b/.test(input.command);
}

/**
 * Lit le registre d'agents Ruflo du dossier de travail (`agent list --format json`, agents non terminés).
 * Pas de `--all` : la CLI le traduit en filtre `status === 'all'`, qui ne renvoie jamais rien.
 */
export async function readRufloAgents(cmd: string[], cwd: string): Promise<RufloAgent[]> {
  const [bin, ...base] = cmd;
  const { stdout } = await exec(bin, [...base, 'agent', 'list', '--format', 'json'], {
    cwd,
    timeout: TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, npm_config_update_notifier: 'false' },
  });
  // La CLI peut afficher des avertissements avant le JSON : on isole l'objet.
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('sortie JSON introuvable');
  const parsed = JSON.parse(stdout.slice(start, end + 1)) as { agents?: RufloAgent[] };
  return Array.isArray(parsed.agents) ? parsed.agents : [];
}
