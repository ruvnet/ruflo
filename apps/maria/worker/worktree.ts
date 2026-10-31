// Worktrees git : chaque mission isolée travaille sur sa propre branche, dans un dossier à part.
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface WorktreeInfo {
  /** Racine du worktree (copie du dépôt sur la branche de la mission). */
  path: string;
  /** Dossier de travail de l'agent dans le worktree (le workspace peut être un sous-dossier du dépôt). */
  cwd: string;
  branch: string;
  baseCommit: string;
}

export interface WorktreeOptions {
  /** Dossier racine où créer les worktrees. */
  root: string;
  /** Éléments non versionnés du workspace à relier par lien symbolique (état Ruflo partagé, node_modules…). */
  links: string[];
  /** Éléments non versionnés à copier (configuration Claude/Ruflo locale). */
  copies: string[];
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

/** Message d'erreur git lisible (stderr plutôt que la commande complète). */
function gitError(err: unknown): string {
  const e = err as { stderr?: string; stdout?: string; message?: string };
  const text = e.stderr?.trim() || e.stdout?.trim() || e.message || String(err);
  return text.trim().split('\n').slice(-3).join(' ');
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    return (await git(dir, ['rev-parse', '--is-inside-work-tree'])) === 'true';
  } catch {
    return false;
  }
}

export function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 30)
      .replace(/^-+|-+$/g, '') || 'mission'
  );
}

/** Crée le worktree et la branche `maria/<id>-<slug>` à partir du commit courant du workspace. */
export async function createWorktree(
  workspaceDir: string,
  workspaceName: string,
  missionId: string,
  prompt: string,
  opts: WorktreeOptions,
  /** Nom de branche imposé (ex. celui d'un ticket) ; sinon maria/<id>-<slug>. */
  branchName?: string,
): Promise<WorktreeInfo> {
  const top = await git(workspaceDir, ['rev-parse', '--show-toplevel']);
  const rel = path.relative(top, workspaceDir);
  const baseCommit = await git(workspaceDir, ['rev-parse', 'HEAD']);
  const short = missionId.slice(0, 8);
  const branch = branchName ?? `maria/${short}-${slugify(prompt)}`;
  const wtPath = path.join(opts.root, workspaceName, short);

  mkdirSync(path.dirname(wtPath), { recursive: true });
  try {
    await git(top, ['worktree', 'add', '-b', branch, wtPath, baseCommit]);
  } catch (err) {
    throw new Error(`Création du worktree impossible : ${gitError(err)}`);
  }

  const cwd = path.join(wtPath, rel);
  for (const name of opts.copies) {
    const src = path.join(workspaceDir, name);
    const dst = path.join(cwd, name);
    if (existsSync(src) && !existsSync(dst)) cpSync(src, dst, { recursive: true });
  }
  for (const name of opts.links) {
    const src = path.join(workspaceDir, name);
    const dst = path.join(cwd, name);
    if (existsSync(src) && !existsSync(dst)) symlinkSync(src, dst);
  }
  return { path: wtPath, cwd, branch, baseCommit };
}

/**
 * Commite tout le travail de l'agent sur la branche du worktree, sauf les éléments reliés ou copiés.
 * Renvoie le hash du commit, ou null s'il n'y avait rien à commiter.
 */
export async function commitWorktree(cwd: string, message: string, excluded: string[]): Promise<string | null> {
  const relToTop = await git(cwd, ['rev-parse', '--show-prefix']);
  const excludes = excluded.map((name) => `:(top,exclude)${path.posix.join(relToTop, name)}`);
  await git(cwd, ['add', '-A', '--', ':/', ...excludes]);
  const staged = await git(cwd, ['diff', '--cached', '--name-only']);
  if (!staged) return null;

  // Identité de secours si git n'est pas configuré sur la machine.
  const hasIdentity = await git(cwd, ['config', 'user.email']).then(Boolean, () => false);
  const identity = hasIdentity ? [] : ['-c', 'user.name=MarIA', '-c', 'user.email=maria@localhost'];
  await git(cwd, [...identity, 'commit', '--no-verify', '-q', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

/** Supprime le worktree et sa branche. */
export async function removeWorktree(workspaceDir: string, wt: Pick<WorktreeInfo, 'path' | 'branch'>): Promise<void> {
  const top = await git(workspaceDir, ['rev-parse', '--show-toplevel']);
  if (existsSync(wt.path)) await git(top, ['worktree', 'remove', '--force', wt.path]);
  else await git(top, ['worktree', 'prune']);
  await git(top, ['branch', '-D', wt.branch]).catch(() => undefined);
}

/**
 * Fusionne la branche de la mission dans la branche actuelle du workspace.
 * Refuse si le workspace a des modifications non commitées ; annule proprement en cas de conflit.
 */
export async function mergeWorktree(workspaceDir: string, wt: Pick<WorktreeInfo, 'path' | 'branch'>, message: string): Promise<void> {
  const top = await git(workspaceDir, ['rev-parse', '--show-toplevel']);
  const dirty = await git(top, ['status', '--porcelain', '--untracked-files=no']);
  if (dirty) {
    throw new Error('Le dossier principal a des modifications non commitées : commite-les ou mets-les de côté (git stash) avant de fusionner.');
  }
  const hasIdentity = await git(top, ['config', 'user.email']).then(Boolean, () => false);
  const identity = hasIdentity ? [] : ['-c', 'user.name=MarIA', '-c', 'user.email=maria@localhost'];
  try {
    await git(top, [...identity, 'merge', '--no-ff', '--no-edit', '-m', message, wt.branch]);
  } catch (err) {
    await git(top, ['merge', '--abort']).catch(() => undefined);
    throw new Error(`Fusion impossible (conflit ?) : ${gitError(err)}. Résous-la à la main ou abandonne la branche.`);
  }
  await removeWorktree(workspaceDir, wt);
}

/** Dossier de travail correspondant à `workspaceDir` dans un worktree existant. */
export async function worktreeCwd(workspaceDir: string, wtPath: string): Promise<string> {
  const top = await git(workspaceDir, ['rev-parse', '--show-toplevel']);
  return path.join(wtPath, path.relative(top, workspaceDir));
}
