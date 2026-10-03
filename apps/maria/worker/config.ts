import { existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PERMISSION_MODES = ['acceptEdits', 'auto', 'bypassPermissions', 'dontAsk', 'plan'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export interface WorkerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  /** nom affiché -> chemin absolu du dossier de travail */
  workspaces: Record<string, string>;
  claudeBin: string;
  permissionMode: PermissionMode;
  allowedTools: string[];
  model: string | null;
  ignorePaths: string[];
  pollMs: number;
  /** Demandes d'autorisation affichées dans MarIA (sinon : refus automatique). */
  interactivePermissions: boolean;
  permissionTimeoutMs: number;
  /** Commande Ruflo (ex. `npx -y ruflo@latest`) pour lire le registre d'agents ; null = désactivé. */
  rufloCmd: string[] | null;
  /** Dossier où créer les worktrees des missions isolées. */
  worktreeRoot: string;
  /** Éléments non versionnés reliés (symlink) dans chaque worktree. */
  worktreeLinks: string[];
  /** Éléments non versionnés copiés dans chaque worktree. */
  worktreeCopies: string[];
  /** Nombre maximal de missions en worktree simultanées par dossier. */
  maxParallel: number;
  /** Ouvrir une PR GitHub (git push + gh) à la fin d'une mission de ticket. */
  ticketPr: boolean;
  /** Base mémoire Ruflo, relative à chaque dossier (`.swarm/memory.db`) ; null = pas de synchronisation. */
  memoryDb: string | null;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseWorkspaces(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('MARIA_WORKSPACES doit être un objet JSON {"nom": "/chemin/absolu"}');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MARIA_WORKSPACES doit être un objet JSON {"nom": "/chemin/absolu"}');
  }
  const result: Record<string, string> = {};
  for (const [name, dir] of Object.entries(parsed)) {
    if (!/^[\w.-]{1,64}$/.test(name)) throw new Error(`Nom de workspace invalide : "${name}"`);
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
      throw new Error(`Le chemin du workspace "${name}" doit être absolu`);
    }
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      throw new Error(`Le dossier du workspace "${name}" n'existe pas : ${dir}`);
    }
    result[name] = path.resolve(dir);
  }
  if (Object.keys(result).length === 0) throw new Error('MARIA_WORKSPACES est vide');
  return result;
}

function parseCommand(value: string): string[] | null {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts : null;
}

export function loadConfig(): WorkerConfig {
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file)) process.loadEnvFile(file);
  }

  const permissionMode = (process.env.MARIA_PERMISSION_MODE?.trim() || 'acceptEdits') as PermissionMode;
  if (!PERMISSION_MODES.includes(permissionMode)) {
    throw new Error(`MARIA_PERMISSION_MODE invalide : ${permissionMode} (${PERMISSION_MODES.join(', ')})`);
  }

  const pollMs = Number(process.env.MARIA_POLL_MS ?? 2000);
  if (!Number.isFinite(pollMs) || pollMs < 250) throw new Error('MARIA_POLL_MS doit être >= 250');

  const permissionTimeoutMs = Number(process.env.MARIA_PERMISSION_TIMEOUT_MS ?? 600_000);
  if (!Number.isFinite(permissionTimeoutMs) || permissionTimeoutMs < 10_000) {
    throw new Error('MARIA_PERMISSION_TIMEOUT_MS doit être >= 10000');
  }

  const maxParallel = Number(process.env.MARIA_MAX_PARALLEL ?? 3);
  if (!Number.isInteger(maxParallel) || maxParallel < 1) throw new Error('MARIA_MAX_PARALLEL doit être un entier >= 1');
  const worktreeRoot = path.resolve(process.env.MARIA_WORKTREE_DIR?.trim() || path.join(os.homedir(), '.maria', 'worktrees'));

  return {
    supabaseUrl: required('SUPABASE_URL'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    workspaces: parseWorkspaces(required('MARIA_WORKSPACES')),
    claudeBin: process.env.MARIA_CLAUDE_BIN?.trim() || 'claude',
    permissionMode,
    allowedTools: list(process.env.MARIA_ALLOWED_TOOLS),
    model: process.env.MARIA_MODEL?.trim() || null,
    ignorePaths: list(process.env.MARIA_IGNORE_PATHS ?? '.claude-flow/,.swarm/'),
    pollMs,
    interactivePermissions: process.env.MARIA_INTERACTIVE_PERMISSIONS?.trim() !== '0',
    permissionTimeoutMs,
    rufloCmd: parseCommand(process.env.MARIA_RUFLO_CMD ?? 'npx -y ruflo@latest'),
    worktreeRoot,
    worktreeLinks: list(process.env.MARIA_WORKTREE_LINKS ?? '.claude-flow,.swarm,node_modules'),
    worktreeCopies: list(process.env.MARIA_WORKTREE_COPY ?? '.mcp.json,.claude,CLAUDE.md'),
    maxParallel,
    ticketPr: process.env.MARIA_TICKET_PR?.trim() !== '0',
    memoryDb: ['', '0'].includes(process.env.MARIA_MEMORY_DB?.trim() ?? '.swarm/memory.db') ? null : process.env.MARIA_MEMORY_DB?.trim() || '.swarm/memory.db',
  };
}
