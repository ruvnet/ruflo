/** Provider event semantics for ADR-115 / dynamic workflows. No model calls. */
export interface ManagedEvent {
  id: string;
  type: string;
  processed_at?: string | null;
  content?: Array<{ type: string; text?: string }>;
  name?: string;
  input?: unknown;
  stop_reason?: { type: string };
  workflow_run_id?: string | null;
  session_thread_id?: string;
  result?: { type: string } | string;
  [key: string]: unknown;
}

export interface EventPage { data: ManagedEvent[]; next_page?: string | null }

/** Validate untrusted pages before deriving lifecycle claims. */
export function eventPage(value: unknown): EventPage {
  if (!value || typeof value !== 'object') throw new Error('Invalid Managed Agents event page');
  const page = value as EventPage;
  if (!Array.isArray(page.data) || page.data.some(e => !e || typeof e.id !== 'string' || !e.id || typeof e.type !== 'string')) {
    throw new Error('Invalid Managed Agents events');
  }
  for (const e of page.data) {
    if (e.processed_at != null && (typeof e.processed_at !== 'string' || !Number.isFinite(Date.parse(e.processed_at)))) throw new Error('Invalid event timestamp');
    if (e.type === 'agent.message' && e.content !== undefined && (!Array.isArray(e.content) || e.content.some(b => !b || typeof b.type !== 'string' || (b.text !== undefined && typeof b.text !== 'string')))) throw new Error('Invalid event content');
    if (e.stop_reason != null && typeof e.stop_reason.type !== 'string') throw new Error('Invalid event stop reason');
    if (e.type === 'workflow_run.status_ended' && (!e.result || typeof e.result !== 'object' || typeof e.result.type !== 'string')) throw new Error('Invalid workflow result');
    if (e.type.startsWith('workflow_run.') && e.type !== 'workflow_run.error' && (typeof e.workflow_run_id !== 'string' || !e.workflow_run_id)) throw new Error('Invalid workflow ID');
    if (e.workflow_run_id != null && typeof e.workflow_run_id !== 'string') throw new Error('Invalid workflow ID');
  }
  if (page.next_page != null && (typeof page.next_page !== 'string' || !page.next_page || page.next_page.length > 4096)) {
    throw new Error('Invalid Managed Agents cursor');
  }
  return page;
}

/** Reads complete history, bounded and deduplicated. Cursor is opaque, never a URL. */
export async function readManagedEvents(
  read: (query: string) => Promise<unknown>,
  since?: string,
): Promise<ManagedEvent[]> {
  const events = new Map<string, ManagedEvent>();
  const cursors = new Set<string>();
  let bytes = 0;
  let cursor: string | undefined;
  for (let count = 0; count < 100; count++) {
    const query = new URLSearchParams({ order: 'asc', limit: '100' });
    if (cursor) query.set('page', cursor);
    if (since) query.set('created_at[gte]', since);
    const page = eventPage(await read(query.toString()));
    bytes += Buffer.byteLength(JSON.stringify(page), 'utf8');
    if (bytes > 16_000_000) throw new Error('Managed Agents transcript limit exceeded');
    for (const e of page.data) events.set(e.id, e);
    if (events.size > 10_000) throw new Error('Managed Agents event limit exceeded');
    if (!page.next_page) return [...events.values()];
    if (cursors.has(page.next_page)) throw new Error('Repeated Managed Agents cursor');
    cursors.add(page.next_page);
    cursor = page.next_page;
  }
  throw new Error('Managed Agents page limit exceeded');
}

/** Incremental reducer. Provider completion is always unverified. */
export class ManagedProgress {
  private seen = new Set<string>();
  private text: string[] = [];
  private tools: Array<{ name: string; input: unknown }> = [];
  private runs = new Map<string, { id: string; status: string; result?: string }>();
  private failures = 0;
  private status = 'unknown';
  private stopReason: string | null = null;
  private cost: unknown = null;
  private since: string | undefined;
  private bytes = 0;
  private finished = false;
  private interrupted = false;

  accept(events: ManagedEvent[]): void {
    for (const e of events) {
      // Queued user messages may be returned again after processing.
      if (!e.processed_at) continue;
      if (this.seen.has(e.id)) continue;
      if (this.seen.size >= 10_000) throw new Error('Managed Agents event limit exceeded');
      this.bytes += Buffer.byteLength(JSON.stringify(e), 'utf8');
      if (this.bytes > 16_000_000) throw new Error('Managed Agents transcript limit exceeded');
      this.seen.add(e.id);
      if (!this.since || e.processed_at > this.since) this.since = e.processed_at;
      if (e.type === 'user.message') {
        this.finished = false; this.interrupted = false;
      } else if (e.type === 'user.interrupt') {
        this.finished = false; this.interrupted = true;
      } else if (e.type === 'agent.message' && Array.isArray(e.content)) {
        this.text.push(e.content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join(''));
      } else if (e.type === 'agent.tool_use' || e.type === 'agent.mcp_tool_use') {
        this.tools.push({ name: e.name ?? '?', input: e.input });
      } else if (e.type === 'session.status_running') {
        this.status = 'running'; this.stopReason = null; this.finished = false;
      } else if (e.type === 'session.status_idle') {
        this.status = 'idle'; this.stopReason = e.stop_reason?.type ?? null;
        this.finished = this.stopReason === 'end_turn' && !this.interrupted && [...this.runs.values()].every(r => r.status === 'ended');
      } else if (e.type === 'session.status_terminated') {
        this.status = 'terminated'; this.finished = false;
      } else if (e.type === 'session.error' || e.type === 'session.status_error' || e.type === 'session.status_failed') {
        this.failures++;
      } else if (e.type === 'session.usage') {
        this.cost = e.usage && typeof e.usage === 'object' ? (e.usage as Record<string, unknown>).list_cost ?? null : null;
      }
      if (e.type === 'workflow_run.error') this.failures++;
      if (e.workflow_run_id && e.type.startsWith('workflow_run.')) {
        this.finished = false;
        const run = this.runs.get(e.workflow_run_id) ?? { id: e.workflow_run_id, status: 'running' };
        if (e.type === 'workflow_run.status_ended') {
          run.status = 'ended'; run.result = typeof e.result === 'object' ? e.result.type : 'unknown';
          if (run.result !== 'completed') this.failures++;
        } else if (e.type === 'workflow_run.status_idle' && run.status !== 'ended') run.status = 'idle';
        else if (e.type === 'workflow_run.status_running' && run.status !== 'ended') run.status = 'running';
        this.runs.set(run.id, run);
      }
    }
  }

  watermark(): string | undefined { return this.since; }

  snapshot() {
    const workflowRuns = [...this.runs.values()].map(r => ({ ...r }));
    const openRuns = workflowRuns.filter(r => r.status !== 'ended').length;
    const blocked = this.status === 'idle' && ['budget_reached', 'requires_action'].includes(this.stopReason ?? '');
    return {
      assistantText: this.text.join(''), toolUses: [...this.tools], status: this.status,
      stopReason: this.stopReason, eventCount: this.seen.size, workflowRuns, openRuns,
      finished: this.finished, interrupted: this.interrupted, blocked, observedFailures: this.failures, listCost: this.cost,
      verification: 'unverified' as const,
      needsThreadInspection: workflowRuns.length > 0,
    };
  }
}

/** Build only the supported configuration; do not pass arbitrary multiagent JSON. */
export function dynamicConfig(input: Record<string, unknown>) {
  if (input.dynamicWorkflows !== undefined && typeof input.dynamicWorkflows !== 'boolean') throw new Error('dynamicWorkflows must be boolean');
  const enabled = input.dynamicWorkflows === true;
  if (input.budgetCents !== undefined || enabled) {
    if (typeof input.budgetCents !== 'string' || !/^[1-9][0-9]{0,8}$/.test(input.budgetCents)) {
      throw new Error('budgetCents must be a positive integer cents string (maximum 999999999)');
    }
  }
  if (enabled && input.networking !== undefined && input.networking !== 'limited') throw new Error('Dynamic workflows require limited networking');
  const hosts = input.allowedHosts ?? [];
  if (!Array.isArray(hosts) || hosts.length > 100 || hosts.some(h => typeof h !== 'string' || h.length > 253 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i.test(h))) {
    throw new Error('allowedHosts must contain at most 100 exact hostnames');
  }
  const agents = input.predefinedAgents;
  if (agents !== undefined && (!Array.isArray(agents) || agents.length < 1 || agents.length > 20 || agents.some(a => typeof a !== 'string' || !/^agent_[A-Za-z0-9]+$/.test(a)))) {
    throw new Error('predefinedAgents must contain 1 to 20 agent IDs');
  }
  return {
    enabled,
    budget: input.budgetCents === undefined ? undefined : { type: 'limit', max_list_cost: { amount: input.budgetCents, currency: 'USD' } },
    multiagent: enabled ? {
      type: 'multiagent_20261001', subagents: { type: 'disabled' },
      workflows: { type: 'enabled', ...(agents ? { inline_agents: { type: 'disabled' }, predefined_agents: agents } : {}) },
    } : undefined,
    networking: enabled || input.networking === 'limited' ? { type: 'limited', allowed_hosts: hosts } : { type: input.networking ?? 'unrestricted' },
  };
}
