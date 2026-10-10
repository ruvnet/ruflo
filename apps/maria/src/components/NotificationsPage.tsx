'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BellOff, CheckCheck } from 'lucide-react';
import { describeTool } from '@/lib/feed';
import { getSupabase, MARIA_SCHEMA } from '@/lib/supabase';
import { ticketKey, type Mission, type PermissionRequest, type Ticket } from '@/lib/types';
import { NotifCard, type NotifTone } from './NotifCard';

const SEEN_KEY = 'maria.notifSeen';

type Category = 'action' | 'mission' | 'permission' | 'ticket';

interface Notif {
  key: string;
  at: string;
  category: Category;
  pending: boolean;
  tone: NotifTone;
  title: string;
  text: ReactNode;
  meta?: string;
  progress?: 'indeterminate';
  actions?: ReactNode;
}

const FILTERS: Array<{ id: 'all' | Category; label: string }> = [
  { id: 'all', label: 'Tout' },
  { id: 'action', label: 'À traiter' },
  { id: 'mission', label: 'Missions' },
  { id: 'permission', label: 'Autorisations' },
  { id: 'ticket', label: 'Tickets' },
];

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function dayGroup(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (d.getTime() >= start) return 'Aujourd’hui';
  if (d.getTime() >= start - 86_400_000) return 'Hier';
  return 'Plus tôt';
}

function short(text: string, max = 110): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

interface Props {
  missions: Mission[];
  onOpenMission: (mission: Mission) => void;
}

/** Centre de notifications : actions à traiter, fins de mission, historique des autorisations, PR des tickets. */
export function NotificationsPage({ missions, onOpenMission }: Props) {
  const [requests, setRequests] = useState<PermissionRequest[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<'all' | Category>('all');
  const [seen, setSeen] = useState<number>(0);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setSeen(Number(localStorage.getItem(SEEN_KEY) ?? 0));
    } catch {
      /* stockage indisponible : tout est considéré comme non lu */
    }
  }, []);

  function markAllRead() {
    const now = Date.now();
    setSeen(now);
    try {
      localStorage.setItem(SEEN_KEY, String(now));
    } catch {
      /* stockage indisponible */
    }
  }

  useEffect(() => {
    const supabase = getSupabase();
    const apply = (row: PermissionRequest) => setRequests((all) => [row, ...all.filter((r) => r.id !== row.id)]);
    const channel = supabase
      .channel('notifications-requests')
      .on('postgres_changes', { event: '*', schema: MARIA_SCHEMA, table: 'permission_requests' }, (payload) => {
        if (payload.eventType !== 'DELETE') apply(payload.new as PermissionRequest);
      })
      .subscribe();
    supabase
      .from('permission_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setRequests(data as PermissionRequest[]);
      });
    // Tickets avec une PR (table absente si la migration 0010 n'est pas appliquée : on ignore).
    supabase
      .from('tickets')
      .select('*')
      .not('pr_url', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(30)
      .then(({ data }) => setTickets((data as Ticket[] | null) ?? []));
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const decide = useCallback(async (id: string, allow: boolean) => {
    const { error: err } = await getSupabase().rpc('decide_permission', { p_id: id, p_allow: allow });
    if (err) setError(err.message);
  }, []);

  const cancel = useCallback(async (id: string) => {
    const { error: err } = await getSupabase().rpc('cancel_mission', { p_id: id });
    if (err) setError(err.message);
  }, []);

  const retry = useCallback(
    async (m: Mission) => {
      const { data, error: err } = await getSupabase()
        .from('missions')
        .insert({ prompt: m.prompt, workspace: m.workspace, use_worktree: m.use_worktree, ticket_id: m.ticket_id ?? null })
        .select()
        .single();
      if (err) setError(err.message);
      else onOpenMission(data as Mission);
    },
    [onOpenMission],
  );

  const items = useMemo<Notif[]>(() => {
    const byMission = new Map(missions.map((m) => [m.id, m]));
    const out: Notif[] = [];

    for (const r of requests) {
      const mission = byMission.get(r.mission_id);
      const where = mission ? `Mission « ${short(mission.prompt, 60)} »` : 'Mission';
      const isQuestion = r.tool_name === 'AskUserQuestion';
      const detail = isQuestion ? '' : describeTool(r.tool_name, r.input);
      const base = { key: `r-${r.id}`, at: r.created_at, category: 'permission' as Category, meta: ago(r.created_at) };
      if (r.status === 'pending') {
        out.push({
          ...base,
          category: 'action',
          pending: true,
          tone: isQuestion ? 'question' : 'permission',
          title: isQuestion ? 'L’agent attend ta réponse' : 'Autorisation demandée',
          text: isQuestion ? (
            <p>{where} : la question est affichée en fenêtre au-dessus de MarIA.</p>
          ) : (
            <p>
              {where} veut utiliser <strong>{r.tool_name}</strong>
              {detail && (
                <>
                  {' '}
                  : <code>{short(detail, 90)}</code>
                </>
              )}
              .
            </p>
          ),
          actions: isQuestion ? (
            <button onClick={() => void decide(r.id, false)}>Ne pas répondre</button>
          ) : (
            <>
              <button className="primary" onClick={() => void decide(r.id, true)}>
                Autoriser
              </button>
              <button onClick={() => void decide(r.id, false)}>Refuser</button>
            </>
          ),
        });
      } else {
        const what = isQuestion ? 'Question' : `${r.tool_name}${detail ? ` · ${short(detail, 70)}` : ''}`;
        const state =
          r.status === 'allowed'
            ? { tone: 'success' as NotifTone, title: isQuestion ? 'Question répondue' : 'Action autorisée' }
            : r.status === 'denied'
              ? { tone: 'error' as NotifTone, title: isQuestion ? 'Question ignorée' : 'Action refusée' }
              : { tone: 'warning' as NotifTone, title: 'Demande expirée sans réponse' };
        out.push({ ...base, pending: false, ...state, text: <p>{`${what} — ${where}`}</p> });
      }
    }

    for (const m of missions) {
      const view = (
        <button onClick={() => onOpenMission(m)} className={m.status === 'completed' ? 'primary' : undefined}>
          Voir la mission
        </button>
      );
      const base = { key: `m-${m.id}`, category: 'mission' as Category, meta: m.cost_usd != null ? `$${m.cost_usd.toFixed(2)}` : undefined };
      if (m.status === 'queued' || m.status === 'running') {
        out.push({
          ...base,
          at: m.started_at ?? m.created_at,
          category: 'action',
          pending: true,
          tone: 'progress',
          title: m.status === 'queued' ? 'En attente du worker…' : 'Juste une minute…',
          text: <p>Les agents travaillent sur « {short(m.prompt)} ».</p>,
          progress: 'indeterminate',
          actions: (
            <>
              {view}
              <button onClick={() => void cancel(m.id)}>Annuler</button>
            </>
          ),
        });
      } else if (m.status === 'completed') {
        out.push({ ...base, at: m.finished_at ?? m.created_at, pending: false, tone: 'success', title: 'Mission terminée !', text: <p>« {short(m.prompt)} » · {m.workspace}</p>, actions: view });
      } else if (m.status === 'failed') {
        out.push({
          ...base,
          at: m.finished_at ?? m.created_at,
          pending: false,
          tone: 'error',
          title: 'La mission a échoué',
          text: <p>{m.error ? short(m.error, 160) : `« ${short(m.prompt)} » n’a pas pu aller au bout.`} Veux-tu réessayer ?</p>,
          actions: (
            <>
              <button className="primary" onClick={() => void retry(m)}>
                Réessayer
              </button>
              {view}
            </>
          ),
        });
      } else if (m.status === 'cancelled') {
        out.push({ ...base, at: m.finished_at ?? m.created_at, pending: false, tone: 'warning', title: 'Mission annulée', text: <p>« {short(m.prompt)} »</p>, actions: view });
      }
    }

    for (const t of tickets) {
      out.push({
        key: `t-${t.id}`,
        at: t.updated_at,
        category: 'ticket',
        pending: false,
        tone: 'success',
        title: `Pull request ouverte · ${ticketKey(t)}`,
        text: <p>{short(t.title)}{t.assignee ? ` — par @${t.assignee}` : ''}</p>,
        meta: ago(t.updated_at),
        actions: t.pr_url ? (
          <a href={t.pr_url} target="_blank" rel="noreferrer" className="primary">
            Ouvrir la PR {t.pr_number ? `#${t.pr_number}` : ''}
          </a>
        ) : undefined,
      });
    }

    return out.sort((a, b) => Number(b.pending) - Number(a.pending) || b.at.localeCompare(a.at));
  }, [requests, missions, tickets, decide, cancel, retry, onOpenMission]);

  const visible = items.filter((n) => !hidden.has(n.key) && (filter === 'all' || n.category === filter || (filter === 'action' && n.pending)));
  const unreadCount = items.filter((n) => !n.pending && new Date(n.at).getTime() > seen).length;
  const pendingCount = items.filter((n) => n.pending).length;

  const groups: Array<[string, Notif[]]> = [];
  for (const n of visible) {
    const label = n.pending ? 'À traiter' : dayGroup(n.at);
    const last = groups[groups.length - 1];
    if (last && last[0] === label) last[1].push(n);
    else groups.push([label, [n]]);
  }

  return (
    <div className="notifs">
      <div className="notifs-bar">
        <div className="chips">
          {FILTERS.map((f) => (
            <button key={f.id} className={`chip ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id === 'action' && pendingCount > 0 && ` (${pendingCount})`}
            </button>
          ))}
        </div>
        <button className="ghost-btn notifs-read" onClick={markAllRead} disabled={unreadCount === 0}>
          <CheckCheck size={15} strokeWidth={2} />
          Tout marquer comme lu{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </button>
      </div>

      {error && <p className="error small">{error}</p>}

      {visible.length === 0 && (
        <div className="notifs-empty">
          <BellOff size={28} strokeWidth={1.5} />
          <p>Rien à signaler pour l’instant.</p>
        </div>
      )}

      {groups.map(([label, list]) => (
        <section key={label} className="notifs-group">
          <h2>{label}</h2>
          {list.map((n) => (
            <NotifCard
              key={n.key}
              tone={n.tone}
              title={n.title}
              meta={n.meta ?? ago(n.at)}
              progress={n.progress}
              actions={n.actions}
              unread={!n.pending && new Date(n.at).getTime() > seen}
              compact={!n.pending}
              onClose={n.pending ? undefined : () => setHidden((h) => new Set(h).add(n.key))}
            >
              {n.text}
            </NotifCard>
          ))}
        </section>
      ))}
    </div>
  );
}
