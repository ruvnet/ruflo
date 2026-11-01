'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Network, Plus, Rocket, SquareTerminal, Trash2, UserPlus, X } from 'lucide-react';
import { mentionName, type AgentInfo } from '@/lib/mentions';
import { getSupabase } from '@/lib/supabase';
import type { Team, TeamMember } from '@/lib/types';
import { AgentAvatar } from './AgentAvatar';

const NODE_W = 150;
const LINK_H = 90;
const VIEW_KEY = 'maria.teamsView';

type View = 'chart' | 'terminal';

interface Props {
  agents: AgentInfo[];
  /** Agents mentionnés dans une mission en cours : point vert sur l'organigramme. */
  activeAgents: Set<string>;
  onOpenAgent: (name: string) => void;
  onLaunch: (prompt: string) => void;
}

/** Responsables en haut (le premier membre s'il n'y en a pas), les autres en dessous. */
function split(members: TeamMember[]): { leads: TeamMember[]; others: TeamMember[] } {
  const leads = members.filter((m) => m.lead);
  if (leads.length > 0) return { leads, others: members.filter((m) => !m.lead) };
  return { leads: members.slice(0, 1), others: members.slice(1) };
}

function Member({ m, active, onOpen, onRemove }: { m: TeamMember; active: boolean; onOpen: () => void; onRemove: () => void }) {
  return (
    <div className="org-node">
      <button className="org-avatar" onClick={onOpen} title={`Ouvrir @${mentionName(m.agent)}`}>
        <AgentAvatar name={m.agent} size={52} />
      </button>
      <button className="org-remove" onClick={onRemove} title="Retirer de l’équipe" aria-label={`Retirer ${m.agent}`}>
        <X size={12} strokeWidth={2.5} />
      </button>
      <span className="org-name">
        <i className={`org-dot ${active ? 'on' : ''}`} />
        {m.agent}
      </span>
      <span className="org-role">{m.role || 'Membre'}</span>
    </div>
  );
}

function OrgChart({ team, active, onOpen, onRemove }: { team: Team; active: Set<string>; onOpen: (a: string) => void; onRemove: (m: TeamMember) => void }) {
  const { leads, others } = split(team.members);
  const width = Math.max(leads.length, others.length, 2) * NODE_W;
  const xs = (n: number) => Array.from({ length: n }, (_, i) => width / 2 + (i - (n - 1) / 2) * NODE_W);
  const leadXs = xs(leads.length);
  const otherXs = xs(others.length);
  const from = leadXs.reduce((a, b) => a + b, 0) / Math.max(1, leadXs.length);

  return (
    <div className="org" style={{ width }}>
      <div className="org-row">
        {leads.map((m) => (
          <Member key={m.agent} m={m} active={active.has(m.agent)} onOpen={() => onOpen(m.agent)} onRemove={() => onRemove(m)} />
        ))}
      </div>
      {others.length > 0 && (
        <>
          <svg className="org-links" width={width} height={LINK_H} viewBox={`0 0 ${width} ${LINK_H}`} aria-hidden="true">
            {otherXs.map((x) => (
              <path key={x} d={`M ${from} 0 V ${LINK_H * 0.28} C ${from} ${LINK_H * 0.62}, ${x} ${LINK_H * 0.42}, ${x} ${LINK_H}`} />
            ))}
          </svg>
          <div className="org-row">
            {others.map((m) => (
              <Member key={m.agent} m={m} active={active.has(m.agent)} onOpen={() => onOpen(m.agent)} onRemove={() => onRemove(m)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Vue « Terminal » : l'équipe façon sortie de commande `tree`. */
function TeamTerminal({ team, active }: { team: Team; active: Set<string> }) {
  const { leads, others } = split(team.members);
  const slug = team.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const line = (m: TeamMember) => `${active.has(m.agent) ? '●' : '○'} ${m.agent.padEnd(18)} ${(m.role || 'Membre').padEnd(26)} @${mentionName(m.agent)}`;
  const rows = [
    ...leads.map((m, i) => `${i === leads.length - 1 && others.length === 0 ? '└──' : '├──'} ${line(m)}  ★`),
    ...others.map((m, i) => `${i === others.length - 1 ? '└──' : '├──'} ${line(m)}`),
  ];
  return (
    <div className="term">
      <div className="term-bar">
        <i />
        <i />
        <i />
        <span>maria — teams</span>
      </div>
      <pre className="term-body">
        <span className="term-prompt">$</span> maria team show {slug}
        {'\n'}
        <span className="term-strong">{team.name}</span> — {team.description || 'sans description'}
        {'\n'}
        {team.members.length} membre(s), {team.members.filter((m) => active.has(m.agent)).length} actif(s)
        {'\n\n'}
        {rows.length > 0 ? rows.join('\n') : '(équipe vide)'}
        {'\n\n'}
        <span className="term-prompt">$</span> <span className="term-cursor" />
      </pre>
    </div>
  );
}

/** Page Teams : une équipe à la fois sur une scène lumineuse, avec un dock flottant pour naviguer et agir. */
export function TeamsPage({ agents, activeAgents, onOpenAgent, onLaunch }: Props) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<View>('chart');
  const [dialog, setDialog] = useState<'team' | 'member' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === 'terminal') setView('terminal');
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

  const load = useCallback(async () => {
    const { data, error: err } = await getSupabase().from('teams').select('*').order('created_at');
    setLoading(false);
    if (err) setError(/teams/.test(err.message) ? `${err.message} — applique la migration supabase/migrations/0009_teams.sql` : err.message);
    else {
      setError(null);
      setTeams(data as Team[]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const count = teams.length;
  const team = teams[Math.min(index, count - 1)] ?? null;
  const go = useCallback((step: number) => count > 0 && setIndex((i) => (i + step + count) % count), [count]);

  // ← / → pour passer d'une équipe à l'autre (hors champs de saisie).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || (e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, dialog]);

  async function saveMembers(members: TeamMember[]) {
    if (!team) return;
    setTeams((all) => all.map((t) => (t.id === team.id ? { ...t, members } : t)));
    const { error: err } = await getSupabase().from('teams').update({ members }).eq('id', team.id);
    if (err) {
      setError(err.message);
      void load();
    }
  }

  async function deleteTeam() {
    if (!team || !window.confirm(`Supprimer l’équipe « ${team.name} » ? Les agents eux-mêmes ne sont pas supprimés.`)) return;
    const { error: err } = await getSupabase().from('teams').delete().eq('id', team.id);
    if (err) setError(err.message);
    else {
      setIndex((i) => Math.max(0, i - 1));
      void load();
    }
  }

  // Mission d'équipe : les responsables d'abord, puis les autres membres (ordre de la chaîne @agent).
  const launchPrompt = team ? `${[...split(team.members).leads, ...split(team.members).others].map((m) => `@${mentionName(m.agent)}`).join(' ')} ` : '';

  return (
    <div className="teams">
      <section className="teams-stage">
        <div className="teams-beam" aria-hidden="true" />
        <div className="teams-sparks" aria-hidden="true">
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} style={{ left: `${30 + ((i * 37) % 40)}%`, top: `${45 + ((i * 53) % 50)}%`, animationDelay: `${(i * 0.7) % 5}s` }} />
          ))}
        </div>

        <div className="teams-crumb">
          <Network size={14} strokeWidth={2} />
          Teams
          {team && (
            <>
              <span>·</span>
              <strong>{team.name}</strong>
              <span>·</span>
              {Math.min(index, count - 1) + 1}/{count}
            </>
          )}
        </div>

        {error && <p className="error small teams-error">{error}</p>}

        {!loading && !team && !error && (
          <div className="teams-empty">
            <h2>Aucune équipe pour l’instant</h2>
            <p>Regroupe tes agents en équipes (Dev, Recherche, Revue…) pour leur confier des missions ensemble.</p>
            <button className="primary-btn" onClick={() => setDialog('team')}>
              <Plus size={16} strokeWidth={2.25} />
              Créer une équipe
            </button>
          </div>
        )}

        {team && (
          <div className="teams-team" key={team.id}>
            <h2>{team.name}</h2>
            {team.description && <p className="teams-desc">{team.description}</p>}
            <div className="teams-meta">
              <span>{team.members.length} membre{team.members.length > 1 ? 's' : ''}</span>
              {team.members.length > 0 && (
                <button className="teams-launch" onClick={() => onLaunch(launchPrompt)}>
                  <Rocket size={13} strokeWidth={2} />
                  Confier une mission
                </button>
              )}
              <button className="teams-icon" onClick={deleteTeam} title="Supprimer l’équipe" aria-label="Supprimer l’équipe">
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </div>

            {team.members.length === 0 ? (
              <button className="org-add" onClick={() => setDialog('member')}>
                <UserPlus size={20} strokeWidth={1.8} />
                Ajouter un premier agent
              </button>
            ) : view === 'chart' ? (
              <OrgChart
                team={team}
                active={activeAgents}
                onOpen={onOpenAgent}
                onRemove={(m) => void saveMembers(team.members.filter((x) => x.agent !== m.agent))}
              />
            ) : (
              <TeamTerminal team={team} active={activeAgents} />
            )}
          </div>
        )}
      </section>

      {/* Dock flottant : vue, navigation entre équipes, actions. */}
      <nav className="teams-dock" aria-label="Équipes">
        <div className="dock-seg" role="tablist">
          <button className={view === 'chart' ? 'on' : ''} onClick={() => changeView('chart')} role="tab" aria-selected={view === 'chart'}>
            <Network size={14} strokeWidth={2} />
            Chart
          </button>
          <button className={view === 'terminal' ? 'on' : ''} onClick={() => changeView('terminal')} role="tab" aria-selected={view === 'terminal'}>
            <SquareTerminal size={14} strokeWidth={2} />
            Terminal
          </button>
        </div>
        <span className="dock-sep" />
        <div className="dock-pager">
          <button onClick={() => go(-1)} disabled={count < 2} aria-label="Équipe précédente">
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
          {teams.map((t, i) => (
            <button key={t.id} className={`dock-dot ${i === Math.min(index, count - 1) ? 'on' : ''}`} onClick={() => setIndex(i)} title={t.name} aria-label={t.name} />
          ))}
          <button onClick={() => go(1)} disabled={count < 2} aria-label="Équipe suivante">
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        </div>
        <span className="dock-sep" />
        <button className="dock-btn" onClick={() => setDialog('member')} disabled={!team}>
          <UserPlus size={15} strokeWidth={2} />
          Membre
        </button>
        <button className="dock-btn primary" onClick={() => setDialog('team')}>
          <Plus size={15} strokeWidth={2.25} />
          Équipe
        </button>
      </nav>

      {dialog === 'team' && (
        <NewTeamDialog
          onClose={() => setDialog(null)}
          onCreated={async () => {
            setDialog(null);
            await load();
            setIndex(count);
          }}
        />
      )}
      {dialog === 'member' && team && (
        <AddMemberDialog
          team={team}
          agents={agents}
          onClose={() => setDialog(null)}
          onAdd={async (member) => {
            setDialog(null);
            await saveMembers([...team.members.filter((m) => m.agent !== member.agent), member]);
          }}
        />
      )}
    </div>
  );
}

function NewTeamDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const { error: err } = await getSupabase().from('teams').insert({ name: name.trim(), description: description.trim() });
    setBusy(false);
    if (err) setError(err.message);
    else onCreated();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="team-dialog" onClick={onClose}>
      <form className="card modal team-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 id="team-dialog">Nouvelle équipe</h2>
        <label className="field">
          Nom
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Dev, Recherche, Revue…" maxLength={60} />
        </label>
        <label className="field">
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={500} placeholder="Ce dont l’équipe s’occupe." />
        </label>
        {error && <p className="error small">{error}</p>}
        <div className="row modal-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            Annuler
          </button>
          <button className="primary-btn small" disabled={busy || !name.trim()}>
            Créer
          </button>
        </div>
      </form>
    </div>
  );
}

function AddMemberDialog({ team, agents, onClose, onAdd }: { team: Team; agents: AgentInfo[]; onClose: () => void; onAdd: (m: TeamMember) => void }) {
  const [filter, setFilter] = useState('');
  const [agent, setAgent] = useState<string | null>(null);
  const [role, setRole] = useState('');
  const [lead, setLead] = useState(team.members.length === 0);
  const inTeam = new Set(team.members.map((m) => m.agent));
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return agents.filter((a) => !inTeam.has(a.name) && (!q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, filter, team.members]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="member-dialog" onClick={onClose}>
      <form
        className="card modal team-dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (agent) onAdd({ agent, role: role.trim(), lead });
        }}
      >
        <h2 id="member-dialog">Ajouter un agent à « {team.name} »</h2>
        <input autoFocus placeholder="Filtrer les agents…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul className="pick-list">
          {visible.map((a) => (
            <li key={a.name}>
              <button type="button" className={`pick ${agent === a.name ? 'on' : ''}`} onClick={() => setAgent(a.name)}>
                <AgentAvatar name={a.name} size={28} />
                <span className="pick-text">
                  <strong>{a.name}</strong>
                  <span>{a.description || '—'}</span>
                </span>
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="muted small">Aucun agent disponible.</li>}
        </ul>
        <label className="field">
          Rôle dans l’équipe
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Engineering Lead, Full-Stack Engineer…" maxLength={60} />
        </label>
        <label className="check">
          <input type="checkbox" checked={lead} onChange={(e) => setLead(e.target.checked)} />
          Responsable de l’équipe (en haut de l’organigramme)
        </label>
        <div className="row modal-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            Annuler
          </button>
          <button className="primary-btn small" disabled={!agent}>
            Ajouter
          </button>
        </div>
      </form>
    </div>
  );
}
