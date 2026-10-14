'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, GitBranch, GitPullRequest, Play, Trash2, X } from 'lucide-react';
import { mentionName, type AgentInfo } from '@/lib/mentions';
import { getSupabase } from '@/lib/supabase';
import { PRIORITIES, STATUS_BY_ID, TICKET_STATUSES, TYPES, shortDate } from '@/lib/tickets';
import { ticketKey, type Mission, type Ticket, type Workspace } from '@/lib/types';
import { AgentAvatar } from './AgentAvatar';
import { Badge, MissionBadge } from './StatusBadge';

interface Props {
  ticket: Ticket;
  agents: AgentInfo[];
  workspaces: Workspace[];
  missions: Mission[];
  onClose: () => void;
  onChange: (patch: Partial<Ticket>) => void;
  onDelete: () => void;
  onOpenMission: (mission: Mission) => void;
}

/** Détails d'un ticket, en panneau latéral : champs modifiables, branche, PR et lancement de l'agent assigné. */
export function TicketDrawer({ ticket, agents, workspaces, missions, onClose, onChange, onDelete, onOpenMission }: Props) {
  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(ticket.title);
    setDescription(ticket.description);
  }, [ticket.id, ticket.title, ticket.description]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const status = STATUS_BY_ID[ticket.status];
  const runs = missions.filter((m) => m.ticket_id === ticket.id);
  const last = missions.find((m) => m.id === ticket.mission_id) ?? runs[0] ?? null;
  const running = last && (last.status === 'queued' || last.status === 'running');
  const canLaunch = !!ticket.assignee && !!ticket.workspace && !running && !busy;

  /** Lance l'agent assigné sur la branche du ticket (et reprend sa conversation s'il a déjà travaillé dessus). */
  async function launch() {
    if (!ticket.assignee || !ticket.workspace) return;
    setBusy(true);
    setError(null);
    const resume = last && last.session_id && last.workspace === ticket.workspace && last.worktree_state === 'active' ? last.id : null;
    const prompt = [
      `@${mentionName(ticket.assignee)} ${ticketKey(ticket)} — ${ticket.title}`,
      ticket.description && `\n${ticket.description}`,
      resume ? '\nReprends le ticket là où tu t’étais arrêté.' : '',
    ]
      .filter(Boolean)
      .join('\n');
    const { data, error: err } = await getSupabase()
      .from('missions')
      .insert({ prompt, workspace: ticket.workspace, use_worktree: true, ticket_id: ticket.id, parent_id: resume })
      .select()
      .single();
    setBusy(false);
    if (err) setError(/ticket_id/.test(err.message) ? `${err.message} — applique la migration 0010_tickets.sql` : err.message);
    else onOpenMission(data as Mission);
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Ticket ${ticketKey(ticket)}`} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <span className="drawer-key">{ticketKey(ticket)}</span>
          <Badge label={status.label} tone={status.tone} icon={status.icon} small />
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <input
          className="drawer-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== ticket.title && onChange({ title: title.trim() })}
          aria-label="Titre"
        />

        <div className="drawer-grid">
          <label>
            Statut
            <select value={ticket.status} onChange={(e) => onChange({ status: e.target.value as Ticket['status'] })}>
              {TICKET_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Agent assigné
            <div className="drawer-agent">
              {ticket.assignee && <AgentAvatar name={ticket.assignee} size={22} />}
              <select value={ticket.assignee ?? ''} onChange={(e) => onChange({ assignee: e.target.value || null })}>
                <option value="">Non assigné</option>
                {agents.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label>
            Priorité
            <select value={ticket.priority} onChange={(e) => onChange({ priority: e.target.value as Ticket['priority'] })}>
              {PRIORITIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select value={ticket.type} onChange={(e) => onChange({ type: e.target.value as Ticket['type'] })}>
              {TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Dossier
            <select value={ticket.workspace ?? ''} onChange={(e) => onChange({ workspace: e.target.value || null })}>
              <option value="">Aucun</option>
              {workspaces.map((w) => (
                <option key={w.name} value={w.name}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="drawer-desc">
          Description
          <textarea
            value={description}
            rows={7}
            placeholder="Contexte, critères d’acceptation, fichiers concernés…"
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => description !== ticket.description && onChange({ description })}
          />
        </label>

        <section className="drawer-git">
          <div className="drawer-git-row">
            <GitBranch size={15} strokeWidth={2} />
            {ticket.branch ? <code>{ticket.branch}</code> : <span className="muted">La branche sera créée au premier lancement.</span>}
          </div>
          <div className="drawer-git-row">
            <GitPullRequest size={15} strokeWidth={2} />
            {ticket.pr_url ? (
              <a className="drawer-pr" href={ticket.pr_url} target="_blank" rel="noreferrer">
                Pull request {ticket.pr_number ? `#${ticket.pr_number}` : ''}
                <ExternalLink size={13} strokeWidth={2} />
              </a>
            ) : (
              <span className="muted">{ticket.branch ? 'Pas encore de PR (ouverte en fin de mission si GitHub est configuré).' : 'Pas encore de PR.'}</span>
            )}
          </div>
        </section>

        {runs.length > 0 && (
          <section className="drawer-runs">
            <h3>Exécutions</h3>
            {runs.map((m) => (
              <button key={m.id} className="drawer-run" onClick={() => onOpenMission(m)}>
                <MissionBadge status={m.status} small />
                <span className="muted small">{new Date(m.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                {m.cost_usd != null && <span className="muted small">${m.cost_usd.toFixed(2)}</span>}
              </button>
            ))}
          </section>
        )}

        {error && <p className="error small">{error}</p>}

        <div className="drawer-actions">
          <button className="primary-btn small" onClick={launch} disabled={!canLaunch} title={!ticket.assignee ? 'Assigne un agent' : !ticket.workspace ? 'Choisis un dossier' : undefined}>
            <Play size={14} strokeWidth={2.4} />
            {running ? 'En cours…' : last ? 'Relancer l’agent' : 'Lancer l’agent'}
          </button>
          <button
            className="ghost-btn danger-text"
            onClick={() => window.confirm(`Supprimer ${ticketKey(ticket)} ?`) && onDelete()}
          >
            <Trash2 size={14} strokeWidth={2} />
          </button>
          <span className="muted small drawer-dates">
            Créé le {shortDate(ticket.created_at)} · modifié le {shortDate(ticket.updated_at)}
          </span>
        </div>
      </aside>
    </div>
  );
}
