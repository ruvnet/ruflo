import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { mentionName, parseMentions } from '../src/lib/mentions';
import { ticketKey, type Mission, type MissionStatus, type StreamEvent, type Ticket, type ToolUseBlock } from '../src/lib/types';
import { listAgents } from './agents';
import type { WorkerConfig } from './config';
import { diffSnapshots, fileFromToolUse, fileStats, snapshotDirty } from './files';
import { PERMISSION_TOOL, SERVER_NAME } from './permission-mcp';
import { readRufloAgents, touchesRuflo } from './ruflo';
import { EventSink, type Store } from './store';
import { pushAndOpenPr } from './github';
import { commitWorktree, createWorktree, isGitRepo, slugify, worktreeCwd, type WorktreeInfo } from './worktree';

const STATUS_POLL_MS = 2000;
const KILL_GRACE_MS = 5000;
const STDERR_TAIL = 4000;

/** Contexte ajouté au prompt système : l'agent tourne sans terminal, piloté depuis MarIA. */
function headlessNote(cwd: string, interactive: boolean, branch: string | null, chain: string[]): string {
  return [
    interactive
      ? 'Tu es exécuté par MarIA sans terminal : toute action non pré-autorisée est soumise à l’utilisateur dans l’interface, qui peut l’autoriser ou la refuser.'
      : 'Tu es exécuté en mode headless par MarIA : aucun humain ne peut approuver une permission pendant la mission.',
    `Ton dossier de travail est ${cwd} ; lance les commandes directement depuis ce dossier, sans \`cd\`, et une commande à la fois (pas de && ni de |) pour qu'elles correspondent aux outils pré-autorisés.`,
    'Écris les commandes sous leur forme la plus simple, sans option de changement de dossier (pas de `git -C`, `npm --prefix`, chemins absolus vers le dossier de travail) : par exemple `git status`, `npm test`.',
    "Si une commande est refusée, ne réessaie pas de variantes : continue avec ce que tu peux faire et liste en fin de réponse les commandes à autoriser.",
    "Si tu délègues à des sous-agents (outil Agent) : ils n'ont pas d'outil pour se parler entre eux. Lance-les en mode synchrone, l'un après l'autre quand ils dépendent les uns des autres (en parallèle seulement s'ils sont indépendants), et transmets toi-même le résultat de chacun dans la consigne du suivant. Ne leur demande pas d'attendre un message d'un autre agent, et ne vérifie pas leur état en boucle (pas de ScheduleWakeup ni de ListAgents répétés).",
    interactive
      ? "Si tu as besoin d'une décision de l'utilisateur pour avancer, utilise l'outil AskUserQuestion : la question s'affiche dans MarIA et sa réponse te revient directement."
      : "Si tu as besoin d'une décision de l'utilisateur, termine ta réponse par une question claire : il pourra répondre via « Continuer ».",
    ...(chain.length > 0
      ? [
          `Mission en chaîne : l'utilisateur a choisi les sous-agents ${chain.map((a) => `« ${a} »`).join(' → ')}, et seulement eux (les autres sont bloqués). Délègue chaque étape à l'agent correspondant avec l'outil Agent (subagent_type exactement égal au nom entre guillemets), dans cet ordre, un à la fois et en mode synchrone (sans run_in_background). Donne à chaque agent la consigne de la mission et le compte rendu utile des étapes précédentes (décisions, fichiers modifiés, points ouverts), puisqu'il ne voit rien d'autre. Ne fais pas toi-même le travail d'une étape ; si une étape échoue ou bloque, arrête la chaîne et explique pourquoi. À la fin, fais une synthèse courte de ce que chaque agent a fait.`,
        ]
      : []),
    ...(branch
      ? [
          `Tu travailles dans un worktree git isolé, sur la branche dédiée ${branch}. Ne change pas de branche, ne fais ni git push ni git commit : MarIA commitera tes modifications à la fin, puis l'utilisateur décidera de fusionner ou non.`,
        ]
      : []),
  ].join('\n');
}

/** Déclare le serveur MCP de permissions (worker/permission-mcp.ts), lancé par Claude Code. */
function permissionMcpConfig(cfg: WorkerConfig, missionId: string): string {
  return JSON.stringify({
    mcpServers: {
      [SERVER_NAME]: {
        command: process.execPath,
        args: [path.join(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(__dirname, 'permission-mcp.ts')],
        env: { MARIA_MISSION_ID: missionId, MARIA_PERMISSION_TIMEOUT_MS: String(cfg.permissionTimeoutMs) },
      },
    },
  });
}

/** Hook PreToolUse (worker/agent-guard.ts) qui bloque les sous-agents non mentionnés dans une mission en chaîne. */
function chainGuardSettings(): string {
  const command = [process.execPath, path.join(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(__dirname, 'agent-guard.ts')]
    .map((part) => JSON.stringify(part))
    .join(' ');
  return JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Agent|Task', hooks: [{ type: 'command', command }] }] } });
}

function buildArgs(
  cfg: WorkerConfig,
  cwd: string,
  missionId: string,
  resumeSessionId: string | null,
  branch: string | null,
  chain: string[],
): string[] {
  // Le prompt passe par stdin : --allowedTools est variadique et avalerait un argument positionnel.
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', cfg.permissionMode];
  args.push('--append-system-prompt', headlessNote(cwd, cfg.interactivePermissions, branch, chain));
  if (chain.length > 0) args.push('--settings', chainGuardSettings());
  if (cfg.interactivePermissions) {
    args.push('--mcp-config', permissionMcpConfig(cfg, missionId), '--permission-prompt-tool', PERMISSION_TOOL);
  }
  // Les questions (AskUserQuestion) s'affichent dans MarIA via le serveur de permissions ; sans lui, personne ne
  // peut y répondre : l'agent doit alors poser ses questions en texte (réponse via « Continuer »).
  if (!cfg.interactivePermissions) args.push('--disallowedTools', 'AskUserQuestion');
  if (cfg.allowedTools.length > 0) args.push('--allowedTools', cfg.allowedTools.join(','));
  if (cfg.model) args.push('--model', cfg.model);
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  return args;
}

async function resolveResume(
  store: Store,
  mission: Mission,
  sink: EventSink,
  cfg: WorkerConfig,
  cwd: string,
): Promise<string | null> {
  if (!mission.parent_id) return null;
  const parent = await store.getMission(mission.parent_id);
  if (!parent?.session_id) {
    sink.info('Mission parente sans session : démarrage d’une nouvelle conversation.', 'warn');
    return null;
  }
  if (parent.workspace !== mission.workspace) {
    sink.info('La mission parente est dans un autre dossier : reprise impossible.', 'warn');
    return null;
  }
  // Claude Code range ses sessions par dossier : la reprise n'est possible que dans le même dossier.
  const workspaceDir = cfg.workspaces[mission.workspace];
  const parentCwd = parent.worktree_path ? await worktreeCwd(workspaceDir, parent.worktree_path).catch(() => null) : workspaceDir;
  if (parentCwd !== cwd) {
    sink.info('La mission parente a tourné dans un autre dossier (branche fusionnée ou abandonnée) : nouvelle conversation.', 'warn');
    return null;
  }
  return parent.session_id;
}

/** Choisit le dossier de travail : le workspace, ou un worktree dédié (nouveau, ou celui de la mission parente). */
async function prepareWorkdir(
  mission: Mission,
  cfg: WorkerConfig,
  store: Store,
  sink: EventSink,
  ticket: Ticket | null,
): Promise<{ cwd: string; worktree: WorktreeInfo | null }> {
  const workspaceDir = cfg.workspaces[mission.workspace];
  if (!mission.use_worktree) return { cwd: workspaceDir, worktree: null };

  const parent = mission.parent_id ? await store.getMission(mission.parent_id) : null;
  if (parent?.worktree_state === 'active' && parent.worktree_path && parent.branch && existsSync(parent.worktree_path)) {
    const worktree: WorktreeInfo = {
      path: parent.worktree_path,
      cwd: await worktreeCwd(workspaceDir, parent.worktree_path),
      branch: parent.branch,
      baseCommit: parent.base_commit ?? '',
    };
    await store.update(mission.id, {
      branch: worktree.branch,
      worktree_path: worktree.path,
      base_commit: parent.base_commit,
      worktree_state: 'active',
    });
    sink.info(`Suite dans la branche ${worktree.branch}`);
    return { cwd: worktree.cwd, worktree };
  }

  if (!(await isGitRepo(workspaceDir))) {
    throw new Error(`« ${mission.workspace} » n’est pas un dépôt git : impossible d’isoler la mission dans une branche (lance « git init » dans le dossier, ou décoche « Branche isolée »).`);
  }
  // Un ticket donne son numéro à la branche : maria/T-12-titre-du-ticket.
  const branchName = ticket ? `maria/${ticketKey(ticket)}-${slugify(ticket.title)}` : undefined;
  const worktree = await createWorktree(
    workspaceDir,
    mission.workspace,
    mission.id,
    mission.prompt,
    { root: cfg.worktreeRoot, links: cfg.worktreeLinks, copies: cfg.worktreeCopies },
    branchName,
  );
  await store.update(mission.id, {
    branch: worktree.branch,
    worktree_path: worktree.path,
    base_commit: worktree.baseCommit,
    worktree_state: 'active',
  });
  sink.info(`Branche isolée ${worktree.branch} créée (${worktree.path})`);
  return { cwd: worktree.cwd, worktree };
}

/**
 * Exécute une mission avec `claude -p` dans son dossier de travail et diffuse chaque
 * événement stream-json vers Supabase. `signal` permet au worker d'interrompre la mission à l'arrêt.
 */
export async function runMission(
  mission: Mission,
  cfg: WorkerConfig,
  store: Store,
  signal: AbortSignal,
): Promise<void> {
  const sink = new EventSink(store, mission.id);
  sink.info(`Mission démarrée dans « ${mission.workspace} »`);

  // Mission d'exécution d'un ticket : le ticket passe « en cours » et pointe vers cette mission.
  const ticket = mission.ticket_id ? await store.getTicket(mission.ticket_id).catch(() => null) : null;
  const updateTicket = (patch: Partial<Ticket>) =>
    ticket ? store.updateTicket(ticket.id, patch).catch((err: Error) => console.error(`[maria] ticket ${ticketKey(ticket)} : ${err.message}`)) : Promise.resolve();
  if (ticket) {
    sink.info(`Ticket ${ticketKey(ticket)} · ${ticket.title}`);
    await updateTicket({ status: 'in_progress', mission_id: mission.id });
  }

  let prepared: { cwd: string; worktree: WorktreeInfo | null };
  try {
    prepared = await prepareWorkdir(mission, cfg, store, sink, ticket);
  } catch (err) {
    sink.info((err as Error).message, 'error');
    await sink.flush();
    await updateTicket({ status: 'blocked' });
    throw err;
  }
  const { cwd, worktree } = prepared;
  if (worktree) await updateTicket({ branch: worktree.branch });
  const { agents: chain, unknown } = parseMentions(mission.prompt, listAgents(cwd).map((a) => a.name));
  if (unknown.length > 0) sink.info(`Agent(s) inconnu(s) dans ce dossier, ignoré(s) : ${unknown.map((a) => `@${a}`).join(', ')}`, 'warn');
  if (chain.length > 0) sink.info(`Chaîne d’agents : ${chain.map((a) => `@${mentionName(a)}`).join(' → ')} (les autres sous-agents sont bloqués)`);
  const resumeSessionId = await resolveResume(store, mission, sink, cfg, cwd);
  const before = await snapshotDirty(cwd).catch(() => null);
  const toolFiles = new Set<string>();
  let sessionId: string | null = null;
  let resultEvent: StreamEvent | null = null;
  let stderrTail = '';
  let cancelled = false;
  let usedRuflo = false;

  const child = spawn(cfg.claudeBin, buildArgs(cfg, cwd, mission.id, resumeSessionId, worktree?.branch ?? null, chain), {
    cwd,
    // Laisse au serveur de permissions le temps d'attendre la décision de l'utilisateur.
    env: { ...process.env, MCP_TOOL_TIMEOUT: String(cfg.permissionTimeoutMs + 60_000), MARIA_CHAIN_AGENTS: chain.join(',') },
    stdio: ['pipe', 'pipe', 'pipe'],
    // Groupe de processus dédié pour pouvoir tuer aussi les commandes lancées par l'agent.
    detached: process.platform !== 'win32',
  });

  const kill = (sig: NodeJS.Signals) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch {
      /* déjà terminé */
    }
  };
  const stop = (reason: string) => {
    if (cancelled) return;
    cancelled = true;
    sink.info(reason, 'warn');
    kill('SIGTERM');
    setTimeout(() => kill('SIGKILL'), KILL_GRACE_MS).unref();
  };

  const onAbort = () => stop('Worker arrêté : mission interrompue.');
  signal.addEventListener('abort', onAbort, { once: true });
  const statusTimer = setInterval(() => {
    store
      .getStatus(mission.id)
      .then((status) => {
        if (status === 'cancel_requested') stop('Annulation demandée depuis MarIA.');
      })
      .catch((err: Error) => console.error(`[maria] ${err.message}`));
  }, STATUS_POLL_MS);

  child.stdin.end(mission.prompt);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL);
  });

  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let event: StreamEvent;
    try {
      event = JSON.parse(line) as StreamEvent;
    } catch {
      sink.info(line, 'warn');
      return;
    }
    if (event.type === 'system' && event.subtype === 'init' && cfg.interactivePermissions) {
      const server = event.mcp_servers?.find((s) => s.name === SERVER_NAME);
      if (server?.status !== 'connected') {
        sink.info(
          `Le serveur d’autorisations MarIA n’a pas démarré (statut : ${server?.status ?? 'absent'}) : les actions non pré-autorisées seront refusées sans fenêtre. Vérifie le terminal du worker.`,
          'error',
        );
      }
    }
    if (event.type === 'system' && event.subtype === 'init' && event.session_id && !sessionId) {
      sessionId = event.session_id;
      void store.update(mission.id, { session_id: sessionId }).catch((err: Error) => console.error(`[maria] ${err.message}`));
    }
    if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block.type !== 'tool_use') continue;
        const { name, input } = block as ToolUseBlock;
        const file = fileFromToolUse(cwd, name, input ?? {});
        if (file) toolFiles.add(file);
        if (touchesRuflo(name, input ?? {})) usedRuflo = true;
      }
    }
    if (event.type === 'result') resultEvent = event;
    sink.push(event);
  });

  const exit = await new Promise<{ code: number | null; error?: Error }>((resolve) => {
    child.once('error', (error) => resolve({ code: null, error }));
    child.once('close', (code) => resolve({ code }));
  });

  clearInterval(statusTimer);
  signal.removeEventListener('abort', onAbort);
  lines.close();

  const after = before ? await snapshotDirty(cwd).catch(() => null) : null;
  const gitFiles = before && after ? diffSnapshots(before, after) : [];
  const files = [...new Set([...gitFiles, ...toolFiles])]
    .filter((f) => !cfg.ignorePaths.some((prefix) => f.startsWith(prefix)))
    .sort();

  const result = resultEvent as StreamEvent | null;
  let status: MissionStatus;
  let error: string | null = null;
  if (cancelled) {
    status = 'cancelled';
  } else if (exit.error) {
    status = 'failed';
    error = `Impossible de lancer « ${cfg.claudeBin} » : ${exit.error.message}`;
  } else if (exit.code === 0 && result && !result.is_error) {
    status = 'completed';
  } else {
    status = 'failed';
    error = (result?.is_error && result.result) || stderrTail.trim() || `claude a quitté avec le code ${exit.code}`;
  }

  if (worktree && !exit.error) {
    const title = ticket ? `${ticketKey(ticket)}: ${ticket.title}`.slice(0, 72) : `MarIA: ${mission.prompt.split('\n')[0].slice(0, 72)}`;
    try {
      const sha = await commitWorktree(cwd, `${title}\n\nMission ${mission.id}`, [...cfg.worktreeLinks, ...cfg.worktreeCopies]);
      sink.info(sha ? `Modifications commitées sur ${worktree.branch} (${sha.slice(0, 7)}).` : `Aucune modification à commiter sur ${worktree.branch}.`);
    } catch (err) {
      sink.info(`Commit sur ${worktree.branch} impossible : ${(err as Error).message}`, 'error');
    }
  }

  // Ticket : sa branche est poussée et sa PR ouverte (ou mise à jour), puis il passe en revue.
  if (ticket) {
    let patch: Partial<Ticket> = { status: status === 'completed' ? 'review' : status === 'cancelled' ? 'ready' : 'blocked' };
    if (worktree && status === 'completed' && cfg.ticketPr) {
      const { pr, note } = await pushAndOpenPr({
        cwd,
        workspaceDir: cfg.workspaces[mission.workspace],
        branch: worktree.branch,
        title: `${ticketKey(ticket)}: ${ticket.title}`,
        body: `${ticket.description || ticket.title}\n\n---\nExécuté par MarIA${ticket.assignee ? ` avec @${ticket.assignee}` : ''} — mission ${mission.id}.`,
      });
      sink.info(pr ? `${note} : ${pr.url}` : `PR GitHub : ${note}`, pr ? 'info' : 'warn');
      if (pr) patch = { ...patch, pr_url: pr.url, pr_number: pr.number };
    }
    await updateTicket(patch);
  }

  await store.expirePermissions([mission.id]).catch((err: Error) => console.error(`[maria] ${err.message}`));
  sink.info(status === 'completed' ? 'Mission terminée.' : `Mission ${status === 'cancelled' ? 'annulée' : 'en échec'}.`);
  await sink.flush();
  await store.update(mission.id, {
    status,
    error,
    result: result?.result ?? null,
    cost_usd: result?.total_cost_usd ?? null,
    session_id: sessionId ?? result?.session_id ?? null,
    files_changed: files,
    finished_at: new Date().toISOString(),
  });

  // Lignes ajoutées / supprimées par fichier (vue « Fichiers modifiés »), sans bloquer la fin de mission.
  if (files.length > 0) {
    try {
      const stats = await fileStats(cwd, files, worktree?.baseCommit || null);
      await store.update(mission.id, { file_stats: stats });
    } catch (err) {
      const hint = /file_stats/.test((err as Error).message) ? ' — applique la migration supabase/migrations/0008_file_stats.sql' : '';
      console.error(`[maria] statistiques de fichiers indisponibles pour ${mission.id} : ${(err as Error).message}${hint}`);
    }
  }

  // Instantané du registre Ruflo, après coup pour ne pas retarder la fin de mission.
  if (usedRuflo && cfg.rufloCmd) {
    try {
      const agents = await readRufloAgents(cfg.rufloCmd, cwd);
      await store.update(mission.id, { ruflo_agents: agents });
    } catch (err) {
      console.error(`[maria] registre Ruflo illisible pour ${mission.id} : ${(err as Error).message}`);
    }
  }
}
