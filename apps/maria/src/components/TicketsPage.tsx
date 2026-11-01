'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, List, Plus, Search, SquareKanban, Table2 } from 'lucide-react';
import type { AgentInfo } from '@/lib/mentions';
import { getSupabase, MARIA_SCHEMA } from '@/lib/supabase';
import { PRIORITIES, PRIORITY_BY_ID, STATUS_BY_ID, TICKET_STATUSES, TYPES, TYPE_BY_ID, shortDate } from '@/lib/tickets';
import { ticketKey, type Mission, type Ticket, type TicketStatus, type Workspace } from '@/lib/types';
import { AgentAvatar } from './AgentAvatar';
import { Badge } from './StatusBadge';
import { TicketCard } from './TicketCard';
import { TicketDrawer } from './TicketDrawer';

type View = 'list' | 'table' | 'board';
const VIEW_KEY = 'maria.ticketsView';

const VIEWS: Array<{ id: View; label: string; icon: typeof List }> = [
  { id: 'list', label: 'Liste', icon: List },
  { id: 'table', label: 'Tableur', icon: Table2 },
  { id: 'board', label: 'Tableau', icon: SquareKanban },
];

interface Props {
  agents: AgentInfo[];
  workspaces: Workspace[];
  missions: Mission[];
  onOpenMission: (mission: Mission) => void;
}

/** Page Tickets façon ClickUp : vues Liste, Tableur et Tableau (Kanban), détail en panneau latéral. */
export function TicketsPage({ agents, workspaces, missions, onOpenMission }: Props) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [view, setView] = useState<View>('board');
  const [query, setQuery] = useState('');
  const [assignee, setAssignee] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<TicketStatus | null>(null);
  const [dragOver, setDragOver] = useState<TicketStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'list' || saved === 'table' || saved === 'board') setView(saved);
    } catch {
      /* stockage indisponible */
    }
  }, []);

  function changeView(v: View) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* stockage indisponible */
    }
  }

  const upsert = useCallback((row: Ticket) => setTickets((all) => [...all.filter((t) => t.id !== row.id), row]), []);

  useEffect(() => {
    const supabase = getSupabase();
    // Temps réel : le worker fait avancer les tickets (en cours, en revue, PR…).
    const channel = supabase
      .channel('tickets')
      .on('postgres_changes', { event: '*', schema: MARIA_SCHEMA, table: 'tickets' }, (payload) => {
        if (payload.eventType === 'DELETE') setTickets((all) => all.filter((t) => t.id !== (payload.old as Partial<Ticket>).id));
        else upsert(payload.new as Ticket);
      })
      .subscribe();
    supabase
      .from('tickets')
      .select('*')
      .order('position')
      .then(({ data, error: err }) => {
        if (err) setError(/tickets/.test(err.message) ? `${err.message} — applique la migration supabase/migrations/0010_tickets.sql` : err.message);
        else setTickets(data as Ticket[]);
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [upsert]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets
      .filter((t) => (!assignee || t.assignee === assignee) && (!q || t.title.toLowerCase().includes(q) || ticketKey(t).toLowerCase().includes(q) || t.description.toLowerCase().includes(q)))
      .sort((a, b) => a.position - b.position || a.number - b.number);
  }, [tickets, query, assignee]);

  const byStatus = useMemo(() => {
    const map = new Map<TicketStatus, Ticket[]>(TICKET_STATUSES.map((s) => [s.id, []]));
    for (const t of visible) map.get(t.status)?.push(t);
    return map;
  }, [visible]);

  async function update(id: string, patch: Partial<Ticket>) {
    setTickets((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const { data, error: err } = await getSupabase().from('tickets').update(patch).eq('id', id).select().single();
    if (err) setError(err.message);
    else upsert(data as Ticket);
  }

  async function remove(id: string) {
    setOpenId(null);
    setTickets((all) => all.filter((t) => t.id !== id));
    const { error: err } = await getSupabase().from('tickets').delete().eq('id', id);
    if (err) setError(err.message);
  }

  function moveTo(id: string, status: TicketStatus) {
    const ticket = tickets.find((t) => t.id === id);
    if (!ticket || ticket.status === status) return;
    const last = Math.max(0, ...tickets.filter((t) => t.status === status).map((t) => t.position));
    void update(id, { status, position: last + 1 });
  }

  const assignees = useMemo(() => [...new Set(tickets.map((t) => t.assignee).filter(Boolean) as string[])].sort(), [tickets]);
  const opened = tickets.find((t) => t.id === openId) ?? null;

  return (
    <div className="tickets">
      <div className="tk-toolbar">
        <div className="tk-views" role="tablist">
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? 'on' : ''} onClick={() => changeView(id)} role="tab" aria-selected={view === id}>
              <Icon size={14} strokeWidth={2} />
              {label}
            </button>
          ))}
        </div>
        <label className="tk-search">
          <Search size={14} strokeWidth={2} />
          <input placeholder="Rechercher un ticket…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select className="tk-filter" value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Filtrer par agent">
          <option value="">Tous les agents</option>
          {assignees.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button className="primary-btn small tk-new" onClick={() => setCreating('open')}>
          <Plus size={15} strokeWidth={2.4} />
          Ticket
        </button>
      </div>

      {error && <p className="error small">{error}</p>}

      {view === 'board' && (
        <div className="board">
          {TICKET_STATUSES.map((s) => {
            const items = byStatus.get(s.id) ?? [];
            return (
              <section
                key={s.id}
                className={`board-col tone-${s.tone} ${dragOver === s.id ? 'over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(s.id);
                }}
                onDragLeave={() => setDragOver((d) => (d === s.id ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  moveTo(e.dataTransfer.getData('text/ticket'), s.id);
                }}
              >
                <header className="board-head">
                  <Badge label={s.label.toUpperCase()} tone={s.tone} icon={s.icon} small />
                  <span className="board-count">{items.length}</span>
                </header>
                <div className="board-cards">
                  {items.map((t) => (
                    <TicketCard
                      key={t.id}
                      ticket={t}
                      onOpen={() => setOpenId(t.id)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/ticket', t.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                    />
                  ))}
                  <QuickAdd status={s.id} onCreated={upsert} />
                </div>
              </section>
            );
          })}
        </div>
      )}

      {view === 'list' && (
        <div className="tk-list">
          {TICKET_STATUSES.map((s) => (
            <ListGroup key={s.id} status={s.id} items={byStatus.get(s.id) ?? []} onOpen={setOpenId} onAdd={() => setCreating(s.id)} />
          ))}
        </div>
      )}

      {view === 'table' && (
        <div className="tk-table-wrap">
          <table className="tk-table">
            <thead>
              <tr>
                <th>Clé</th>
                <th>Titre</th>
                <th>Statut</th>
                <th>Agent</th>
                <th>Priorité</th>
                <th>Type</th>
                <th>Dossier</th>
                <th>PR</th>
                <th>Modifié</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id}>
                  <td>
                    <button className="tk-key" onClick={() => setOpenId(t.id)}>
                      {ticketKey(t)}
                    </button>
                  </td>
                  <td className="tk-cell-title" onClick={() => setOpenId(t.id)}>
                    {t.title}
                  </td>
                  <td>
                    <select value={t.status} onChange={(e) => void update(t.id, { status: e.target.value as TicketStatus })}>
                      {TICKET_STATUSES.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={t.assignee ?? ''} onChange={(e) => void update(t.id, { assignee: e.target.value || null })}>
                      <option value="">—</option>
                      {agents.map((a) => (
                        <option key={a.name} value={a.name}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={t.priority} onChange={(e) => void update(t.id, { priority: e.target.value as Ticket['priority'] })}>
                      {PRIORITIES.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="muted">{TYPE_BY_ID[t.type].label}</td>
                  <td className="muted">{t.workspace ?? '—'}</td>
                  <td>
                    {t.pr_url ? (
                      <a href={t.pr_url} target="_blank" rel="noreferrer" className="tk-prlink">
                        #{t.pr_number ?? '?'} <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="muted">{shortDate(t.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <p className="muted tk-empty">Aucun ticket.</p>}
        </div>
      )}

      {opened && (
        <TicketDrawer
          ticket={opened}
          agents={agents}
          workspaces={workspaces}
          missions={missions}
          onClose={() => setOpenId(null)}
          onChange={(patch) => void update(opened.id, patch)}
          onDelete={() => void remove(opened.id)}
          onOpenMission={onOpenMission}
        />
      )}

      {creating && (
        <NewTicketDialog
          status={creating}
          agents={agents}
          workspaces={workspaces}
          onClose={() => setCreating(null)}
          onCreated={(t) => {
            upsert(t);
            setCreating(null);
            setOpenId(t.id);
          }}
        />
      )}
    </div>
  );
}

function ListGroup({ status, items, onOpen, onAdd }: { status: TicketStatus; items: Ticket[]; onOpen: (id: string) => void; onAdd: () => void }) {
  const [open, setOpen] = useState(true);
  const s = STATUS_BY_ID[status];
  return (
    <section className="tk-group">
      <header>
        <button className="tk-group-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <Badge label={s.label.toUpperCase()} tone={s.tone} icon={s.icon} small />
        <span className="board-count">{items.length}</span>
      </header>
      {open && (
        <ul>
          {items.map((t) => (
            <li key={t.id}>
              <button className="tk-row" onClick={() => onOpen(t.id)}>
                <span className="tk-row-key">{ticketKey(t)}</span>
                <span className="tk-row-title">{t.title}</span>
                <span className="tk-row-agent">
                  {t.assignee ? (
                    <>
                      <AgentAvatar name={t.assignee} size={20} />
                      {t.assignee}
                    </>
                  ) : (
                    <span className="muted">Non assigné</span>
                  )}
                </span>
                <span className="tk-row-prio" style={{ color: PRIORITY_BY_ID[t.priority].color }}>
                  ● {PRIORITY_BY_ID[t.priority].label}
                </span>
                <span className="tk-row-pr muted">{t.pr_number ? `PR #${t.pr_number}` : t.branch ? 'branche' : ''}</span>
              </button>
            </li>
          ))}
          <li>
            <button className="tk-add-row" onClick={onAdd}>
              <Plus size={14} /> Ajouter un ticket
            </button>
          </li>
        </ul>
      )}
    </section>
  );
}

/** Ajout rapide en bas d'une colonne du Kanban : un titre, Entrée, c'est créé. */
function QuickAdd({ status, onCreated }: { status: TicketStatus; onCreated: (t: Ticket) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const { data, error } = await getSupabase().from('tickets').insert({ title: title.trim(), status, position: Date.now() / 1e6 }).select().single();
    if (!error) {
      onCreated(data as Ticket);
      setTitle('');
    }
  }

  if (!editing)
    return (
      <button className="board-add" onClick={() => setEditing(true)}>
        <Plus size={14} strokeWidth={2.2} /> Ajouter un ticket
      </button>
    );
  return (
    <form onSubmit={submit} className="board-quick">
      <input autoFocus value={title} placeholder="Titre du ticket…" onChange={(e) => setTitle(e.target.value)} onBlur={() => !title && setEditing(false)} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)} />
    </form>
  );
}

function NewTicketDialog({
  status,
  agents,
  workspaces,
  onClose,
  onCreated,
}: {
  status: TicketStatus;
  agents: AgentInfo[];
  workspaces: Workspace[];
  onClose: () => void;
  onCreated: (t: Ticket) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<Ticket['type']>('feature');
  const [priority, setPriority] = useState<Ticket['priority']>('normal');
  const [assignee, setAssignee] = useState('');
  const [workspace, setWorkspace] = useState(workspaces[0]?.name ?? '');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const { data, error: err } = await getSupabase()
      .from('tickets')
      .insert({ title: title.trim(), description: description.trim(), status, type, priority, assignee: assignee || null, workspace: workspace || null, position: Date.now() / 1e6 })
      .select()
      .single();
    if (err) setError(err.message);
    else onCreated(data as Ticket);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="ticket-dialog" onClick={onClose}>
      <form className="card modal team-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 id="ticket-dialog">Nouveau ticket</h2>
        <label className="field">
          Titre
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="[Bug] La page d’accueil ne s’affiche pas bien" maxLength={200} />
        </label>
        <label className="field">
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Contexte, critères d’acceptation…" />
        </label>
        <div className="tk-dialog-grid">
          <label className="field">
            Agent
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Non assigné</option>
              {agents.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Dossier
            <select value={workspace} onChange={(e) => setWorkspace(e.target.value)}>
              <option value="">Aucun</option>
              {workspaces.map((w) => (
                <option key={w.name} value={w.name}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Type
            <select value={type} onChange={(e) => setType(e.target.value as Ticket['type'])}>
              {TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Priorité
            <select value={priority} onChange={(e) => setPriority(e.target.value as Ticket['priority'])}>
              {PRIORITIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="error small">{error}</p>}
        <div className="row modal-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            Annuler
          </button>
          <button className="primary-btn small" disabled={!title.trim()}>
            Créer
          </button>
        </div>
      </form>
    </div>
  );
}
