import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** chemin relatif -> empreinte du contenu ('deleted' si supprimé) pour chaque fichier non commité. */
export type DirtySnapshot = Map<string, string>;

async function git(cwd: string, args: string[], input?: string): Promise<string> {
  const child = exec('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  if (input !== undefined) {
    child.child.stdin?.end(input);
  }
  const { stdout } = await child;
  return stdout;
}

/** Retourne null si le dossier n'est pas un dépôt git. */
export async function snapshotDirty(workdir: string): Promise<DirtySnapshot | null> {
  let cwd: string;
  try {
    // Les chemins de `git status` sont relatifs à la racine du dépôt.
    cwd = (await git(workdir, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return null;
  }

  const raw = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const tokens = raw.split('\0').filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    const xy = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (xy[0] === 'R' || xy[0] === 'C') i++; // le jeton suivant est l'ancien chemin
  }

  const snapshot: DirtySnapshot = new Map();
  const files: string[] = [];
  for (const p of paths) {
    const abs = path.join(cwd, p);
    if (!existsSync(abs)) snapshot.set(p, 'deleted');
    else if (statSync(abs).isFile()) files.push(p);
  }
  if (files.length > 0) {
    const hashes = (await git(cwd, ['hash-object', '--stdin-paths'], files.join('\n') + '\n')).trim().split('\n');
    files.forEach((p, i) => snapshot.set(p, hashes[i] ?? ''));
  }
  return snapshot;
}

/** Fichiers dont l'état a changé entre les deux instantanés (créés, modifiés, supprimés ou restaurés). */
export function diffSnapshots(before: DirtySnapshot, after: DirtySnapshot): string[] {
  const changed = new Set<string>();
  for (const [p, hash] of after) {
    if (before.get(p) !== hash) changed.add(p);
  }
  for (const p of before.keys()) {
    if (!after.has(p)) changed.add(p);
  }
  return [...changed];
}

/** Chemin modifié par un outil d'écriture (Write, Edit, MultiEdit, NotebookEdit), relatif au dossier. */
export function fileFromToolUse(cwd: string, name: string, input: Record<string, unknown>): string | null {
  if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) return null;
  const target = input.file_path ?? input.notebook_path;
  if (typeof target !== 'string') return null;
  const rel = path.relative(cwd, path.resolve(cwd, target));
  return rel.startsWith('..') ? target : rel;
}

/** Lignes ajoutées / supprimées par fichier ; null pour un fichier binaire. */
export type FileStats = Record<string, [number, number] | null>;

/**
 * Statistiques de diff des fichiers modifiés : par rapport à `base` (commit de départ d'un worktree)
 * ou, sur place, entre HEAD et l'arbre de travail. Un nouveau fichier non suivi compte toutes ses lignes en ajout.
 */
export async function fileStats(cwd: string, files: string[], base: string | null): Promise<FileStats> {
  if (files.length === 0) return {};
  const raw = await git(cwd, ['diff', '--numstat', '--relative', base ? `${base}..HEAD` : 'HEAD']).catch(() => '');
  const byPath = new Map<string, [number, number] | null>();
  for (const line of raw.split('\n')) {
    const [add, del, ...rest] = line.split('\t');
    const p = rest.join('\t');
    if (!p) continue;
    byPath.set(p, add === '-' ? null : [Number(add), Number(del)]);
  }
  const stats: FileStats = {};
  for (const f of files) {
    if (byPath.has(f)) {
      stats[f] = byPath.get(f) ?? null;
      continue;
    }
    const abs = path.resolve(cwd, f);
    if (existsSync(abs) && statSync(abs).isFile() && statSync(abs).size < 5 * 1024 * 1024) {
      const text = readFileSync(abs, 'utf8');
      stats[f] = text.includes('\0') ? null : [text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0, 0];
    }
  }
  return stats;
}
