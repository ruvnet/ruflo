// Worker MarIA : récupère les missions en attente dans Supabase et les exécute avec Claude Code.
// Lancement : npm run worker (depuis apps/maria, avec .env.local rempli).
import { runWorktreeAction } from './actions';
import { listAgents } from './agents';
import { loadConfig } from './config';
import { MemorySync, sqliteAvailable } from './memory';
import { runMission } from './runner';
import { Store } from './store';
import type { Mission } from '../src/lib/types';

const HEARTBEAT_MS = 30_000;

async function main(): Promise<void> {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) {
    throw new Error(`Node.js ${process.versions.node} détecté : MarIA nécessite Node.js 22 ou plus (nvm install 22 && nvm use 22).`);
  }
  const cfg = loadConfig();
  const store = new Store(cfg.supabaseUrl, cfg.serviceRoleKey);
  const names = Object.keys(cfg.workspaces);

  // Relu à chaque battement : un agent ajouté dans .claude/agents apparaît dans MarIA sans redémarrer le worker.
  const register = () => store.registerWorkspaces(names.map((name) => ({ name, agents: listAgents(cfg.workspaces[name]) })));
  await register();
  const orphans = await store.failOrphans(names);
  if (orphans > 0) console.log(`[maria] ${orphans} mission(s) orpheline(s) marquée(s) en échec`);
  console.log(`[maria] worker prêt — dossiers : ${names.map((n) => `${n} → ${cfg.workspaces[n]}`).join(', ')}`);
  console.log(`[maria] permissions : mode ${cfg.permissionMode}, outils autorisés : ${cfg.allowedTools.join(', ') || '(aucun)'}`);
  console.log(`[maria] autres actions : ${cfg.interactivePermissions ? `demandées dans MarIA (délai ${Math.round(cfg.permissionTimeoutMs / 1000)} s)` : 'refusées automatiquement'}`);
  const memory = cfg.memoryDb && sqliteAvailable() ? new MemorySync(store, cfg.memoryDb) : null;
  console.log(
    `[maria] mémoire Ruflo : ${memory ? `copiée depuis ${cfg.memoryDb} toutes les ${HEARTBEAT_MS / 1000} s` : cfg.memoryDb ? 'désactivée (node:sqlite indisponible : Node.js 22.13 ou plus requis)' : 'désactivée (MARIA_MEMORY_DB)'}`,
  );
  // Une erreur de synchronisation n'est affichée qu'une fois tant qu'elle se répète.
  const lastMemoryError = new Map<string, string>();
  let memoryBusy = false;
  const syncMemory = async () => {
    if (!memory || memoryBusy) return;
    memoryBusy = true;
    for (const name of names) {
      try {
        const { upserted, deleted } = await memory.sync(name, cfg.workspaces[name]);
        if (upserted || deleted) console.log(`[maria] mémoire ${name} : ${upserted} entrée(s) copiée(s), ${deleted} retirée(s)`);
        lastMemoryError.delete(name);
      } catch (err) {
        const message = (err as Error).message;
        if (lastMemoryError.get(name) !== message) console.error(`[maria] mémoire ${name} : ${message}`);
        lastMemoryError.set(name, message);
      }
    }
    memoryBusy = false;
  };
  void syncMemory();
  console.log(`[maria] branches isolées : jusqu'à ${cfg.maxParallel} en parallèle par dossier, dans ${cfg.worktreeRoot}`);

  // Dans le dossier principal : une seule mission « sur place » (ou fusion) à la fois, sinon elles se marcheraient dessus.
  // Les missions en worktree ont chacune leur copie : jusqu'à maxParallel en même temps par dossier.
  const mainBusy = new Set<string>();
  const worktreeCount = new Map<string, number>();
  const running = new Set<Promise<void>>();
  const shutdown = new AbortController();
  let polling = false;

  const track = (task: Promise<void>, release: () => void) => {
    const p = task.finally(() => {
      release();
      running.delete(p);
    });
    running.add(p);
  };

  const startMission = (mission: Mission) => {
    console.log(`[maria] mission ${mission.id} → ${mission.workspace}${mission.use_worktree ? ' (branche isolée)' : ''}`);
    if (mission.use_worktree) worktreeCount.set(mission.workspace, (worktreeCount.get(mission.workspace) ?? 0) + 1);
    else mainBusy.add(mission.workspace);
    const task = runMission(mission, cfg, store, shutdown.signal).catch(async (err: Error) => {
      console.error(`[maria] mission ${mission.id} : ${err.message}`);
      await store
        .update(mission.id, { status: 'failed', error: err.message, finished_at: new Date().toISOString() })
        .catch(() => undefined);
    });
    track(task, () => {
      if (mission.use_worktree) worktreeCount.set(mission.workspace, (worktreeCount.get(mission.workspace) ?? 1) - 1);
      else mainBusy.delete(mission.workspace);
    });
  };

  const poll = async () => {
    if (polling || shutdown.signal.aborted) return;
    polling = true;
    try {
      // Fusions et abandons demandés : ils touchent le dossier principal, donc exclusifs avec les missions sur place.
      for (const mission of await store.pendingWorktreeActions(names.filter((n) => !mainBusy.has(n)))) {
        if (mainBusy.has(mission.workspace)) continue;
        mainBusy.add(mission.workspace);
        track(runWorktreeAction(mission, cfg.workspaces[mission.workspace], store), () => mainBusy.delete(mission.workspace));
      }
      for (;;) {
        const inplace = names.filter((n) => !mainBusy.has(n));
        const worktree = names.filter((n) => (worktreeCount.get(n) ?? 0) < cfg.maxParallel);
        if (inplace.length === 0 && worktree.length === 0) break;
        const mission = await store.claimNext(inplace, worktree);
        if (!mission) break;
        startMission(mission);
      }
    } catch (err) {
      console.error(`[maria] ${(err as Error).message}`);
    } finally {
      polling = false;
    }
  };

  const pollTimer = setInterval(() => void poll(), cfg.pollMs);
  const heartbeatTimer = setInterval(() => {
    register().catch((err: Error) => console.error(`[maria] ${err.message}`));
    void syncMemory();
  }, HEARTBEAT_MS);
  void poll();

  const stop = async (sig: string) => {
    if (shutdown.signal.aborted) process.exit(1); // second Ctrl+C : sortie immédiate
    console.log(`[maria] ${sig} reçu, arrêt des missions en cours…`);
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    shutdown.abort();
    await Promise.allSettled(running.values());
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}

main().catch((err: Error) => {
  console.error(`[maria] ${err.message}`);
  process.exit(1);
});
