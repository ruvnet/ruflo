import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AgentInfo } from '../src/lib/mentions';
import type { MemoryEntry, Mission, MissionStatus, StreamEvent, Ticket } from '../src/lib/types';

const MAX_STRING = 4000;

/** Tronque les longues chaînes (sorties d'outils, contenus de fichiers) avant stockage. */
function compact(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… [${value.length - MAX_STRING} caractères tronqués]` : value;
  }
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, compact(v)]));
  }
  return value;
}

export class Store {
  private readonly db: SupabaseClient<any, 'maria'>;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false }, db: { schema: 'maria' } });
  }

  async registerWorkspaces(workspaces: Array<{ name: string; agents: AgentInfo[] }>): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.db
      .from('workspaces')
      .upsert(workspaces.map(({ name, agents }) => ({ name, agents, last_seen_at: now })));
    if (error && /agents/.test(error.message)) {
      throw new Error(`registerWorkspaces: ${error.message} — applique la migration supabase/migrations/0006_workspace_agents.sql`);
    }
    if (error) throw new Error(`registerWorkspaces: ${error.message}`);
  }

  /** id -> updated_at (ms) des entrées mémoire déjà copiées pour ce dossier. */
  async memoryIndex(workspace: string): Promise<Map<string, number>> {
    const { data, error } = await this.db.from('memory_entries').select('id, updated_at').eq('workspace', workspace).limit(5000);
    if (error) throw new Error(`memoryIndex: ${error.message}${/memory_entries/.test(error.message) ? ' — applique la migration supabase/migrations/0007_ruflo_memory.sql' : ''}`);
    return new Map((data as Array<{ id: string; updated_at: string | null }>).map((r) => [r.id, Date.parse(r.updated_at ?? '')]));
  }

  async upsertMemory(entries: MemoryEntry[]): Promise<void> {
    for (let i = 0; i < entries.length; i += 200) {
      const { error } = await this.db.from('memory_entries').upsert(entries.slice(i, i + 200));
      if (error) throw new Error(`upsertMemory: ${error.message}`);
    }
  }

  async deleteMemory(workspace: string, ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await this.db.from('memory_entries').delete().eq('workspace', workspace).in('id', ids.slice(i, i + 100));
      if (error) throw new Error(`deleteMemory: ${error.message}`);
    }
  }

  /** Clôt les demandes d'autorisation restées sans réponse (mission terminée ou worker redémarré). */
  async expirePermissions(missionIds: string[]): Promise<void> {
    if (missionIds.length === 0) return;
    const { error } = await this.db
      .from('permission_requests')
      .update({ status: 'expired' })
      .in('mission_id', missionIds)
      .eq('status', 'pending');
    if (error) throw new Error(`expirePermissions: ${error.message}`);
  }

  /** Missions restées "running" après un arrêt brutal du worker. */
  async failOrphans(names: string[]): Promise<number> {
    const { data, error } = await this.db
      .from('missions')
      .update({ status: 'failed', error: 'Le worker a redémarré pendant la mission', finished_at: new Date().toISOString() })
      .in('workspace', names)
      .in('status', ['running', 'cancel_requested'])
      .select('id');
    if (error) throw new Error(`failOrphans: ${error.message}`);
    await this.expirePermissions(data.map((m) => m.id));
    return data.length;
  }

  /** Réserve la prochaine mission : « sur place » pour les dossiers libres, en worktree pour ceux qui ont de la capacité. */
  async claimNext(inplace: string[], worktree: string[]): Promise<Mission | null> {
    const { data, error } = await this.db.rpc('claim_next_mission', { p_inplace: inplace, p_worktree: worktree });
    if (error) throw new Error(`claimNext: ${error.message}`);
    const rows = data as Mission[] | null;
    return rows?.[0] ?? null;
  }

  /** Missions dont l'utilisateur a demandé la fusion ou l'abandon de la branche. */
  async pendingWorktreeActions(workspaces: string[]): Promise<Mission[]> {
    const { data, error } = await this.db
      .from('missions')
      .select('*')
      .in('workspace', workspaces)
      .eq('worktree_state', 'active')
      .not('worktree_action', 'is', null)
      .order('created_at');
    if (error) throw new Error(`pendingWorktreeActions: ${error.message}`);
    return data as Mission[];
  }

  /** Une mission tourne-t-elle encore dans ce worktree ? */
  async worktreeBusy(worktreePath: string): Promise<boolean> {
    const { count, error } = await this.db
      .from('missions')
      .select('id', { count: 'exact', head: true })
      .eq('worktree_path', worktreePath)
      .in('status', ['queued', 'running', 'cancel_requested']);
    if (error) throw new Error(`worktreeBusy: ${error.message}`);
    return (count ?? 0) > 0;
  }

  /** Met à jour toutes les missions qui partagent un worktree (une mission et ses suites). */
  async updateWorktree(worktreePath: string, patch: Partial<Mission>): Promise<void> {
    const { error } = await this.db.from('missions').update(patch).eq('worktree_path', worktreePath);
    if (error) throw new Error(`updateWorktree: ${error.message}`);
  }

  async getTicket(id: string): Promise<Ticket | null> {
    const { data, error } = await this.db.from('tickets').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`getTicket: ${error.message}`);
    return data as Ticket | null;
  }

  async updateTicket(id: string, patch: Partial<Ticket>): Promise<void> {
    const { error } = await this.db.from('tickets').update(patch).eq('id', id);
    if (error) throw new Error(`updateTicket: ${error.message}`);
  }

  async getMission(id: string): Promise<Mission | null> {
    const { data, error } = await this.db.from('missions').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`getMission: ${error.message}`);
    return data as Mission | null;
  }

  async getStatus(id: string): Promise<MissionStatus | null> {
    const { data, error } = await this.db.from('missions').select('status').eq('id', id).maybeSingle();
    if (error) throw new Error(`getStatus: ${error.message}`);
    return (data?.status as MissionStatus | undefined) ?? null;
  }

  async update(id: string, patch: Partial<Mission>): Promise<void> {
    const { error } = await this.db.from('missions').update(patch).eq('id', id);
    if (error) throw new Error(`update: ${error.message}`);
  }

  async insertEvents(rows: Array<{ mission_id: string; seq: number; event: StreamEvent }>): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.db.from('mission_events').insert(
      rows.map(({ mission_id, seq, event }) => ({
        mission_id,
        seq,
        type: event.type,
        payload: compact(event),
      })),
    );
    if (error) throw new Error(`insertEvents: ${error.message}`);
  }
}

/** Regroupe les événements et les écrit par lots pour limiter les allers-retours. */
export class EventSink {
  private queue: Array<{ mission_id: string; seq: number; event: StreamEvent }> = [];
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: Store,
    private readonly missionId: string,
    private readonly intervalMs = 300,
  ) {}

  push(event: StreamEvent): void {
    this.queue.push({ mission_id: this.missionId, seq: this.seq++, event });
    if (this.queue.length >= 50) void this.flush();
    else this.timer ??= setTimeout(() => void this.flush(), this.intervalMs);
  }

  info(text: string, level: StreamEvent['level'] = 'info'): void {
    this.push({ type: 'maria', level, text });
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.queue;
    this.queue = [];
    this.flushing = this.flushing.then(() =>
      this.store.insertEvents(batch).catch((err: Error) => console.error(`[maria] ${err.message}`)),
    );
    return this.flushing;
  }
}
