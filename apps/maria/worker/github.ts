// PR GitHub d'un ticket : pousse la branche du ticket et ouvre (ou retrouve) sa pull request avec `gh`.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface PullRequest {
  url: string;
  number: number | null;
}

async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec(cmd, args, { cwd, maxBuffer: 4 * 1024 * 1024, timeout: 120_000 });
  return stdout.trim();
}

function errorText(err: unknown): string {
  const e = err as { stderr?: string; message?: string };
  return (e.stderr?.trim() || e.message || String(err)).split('\n').slice(-2).join(' ');
}

function prNumber(url: string): number | null {
  const m = /\/pull\/(\d+)/.exec(url);
  return m ? Number(m[1]) : null;
}

/**
 * Pousse `branch` sur origin puis ouvre sa PR vers la branche actuelle du dossier principal.
 * Renvoie la PR, ou une raison lisible si ce n'est pas possible (pas de remote, `gh` absent ou non connecté…).
 */
export async function pushAndOpenPr(opts: {
  cwd: string;
  workspaceDir: string;
  branch: string;
  title: string;
  body: string;
}): Promise<{ pr: PullRequest | null; note: string }> {
  const { cwd, workspaceDir, branch, title, body } = opts;
  try {
    await run('git', ['remote', 'get-url', 'origin'], cwd);
  } catch {
    return { pr: null, note: 'pas de remote « origin » : branche gardée en local' };
  }
  const base = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], workspaceDir).catch(() => 'main');
  try {
    await run('git', ['push', '-u', 'origin', branch], cwd);
  } catch (err) {
    return { pr: null, note: `push impossible (${errorText(err)})` };
  }
  try {
    await run('gh', ['--version'], cwd);
  } catch {
    return { pr: null, note: `branche poussée ; installe et connecte la CLI GitHub (gh auth login) pour que MarIA ouvre la PR` };
  }
  // Ticket relancé : la PR existe peut-être déjà pour cette branche.
  try {
    const existing = JSON.parse(await run('gh', ['pr', 'view', branch, '--json', 'url,number,state'], cwd)) as { url: string; number: number; state: string };
    if (existing.state === 'OPEN') return { pr: { url: existing.url, number: existing.number }, note: 'PR mise à jour' };
  } catch {
    /* pas encore de PR */
  }
  try {
    const out = await run('gh', ['pr', 'create', '--head', branch, '--base', base, '--title', title, '--body', body], cwd);
    const url = out.split('\n').find((l) => l.startsWith('http')) ?? out;
    return { pr: { url, number: prNumber(url) }, note: 'PR ouverte' };
  } catch (err) {
    return { pr: null, note: `branche poussée, PR non créée (${errorText(err)})` };
  }
}
