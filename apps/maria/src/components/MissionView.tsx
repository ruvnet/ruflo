'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bot,
  CircleAlert,
  CircleCheck,
  Eye,
  FilePen,
  Globe,
  Info,
  ListTodo,
  Plug,
  Search,
  Terminal,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { buildAgents } from '@/lib/agents';
import { buildFeed, type FeedItem } from '@/lib/feed';
import type { AgentInfo } from '@/lib/mentions';
import { getSupabase, MARIA_SCHEMA } from '@/lib/supabase';
import { FINISHED_STATUSES, type Mission, type MissionEvent } from '@/lib/types';
import { AgentAvatar } from './AgentAvatar';
import { AgentHub } from './AgentHub';
import { BranchPanel } from './BranchPanel';
import { Composer } from './Composer';
import { FileTree } from './FileTree';
import { Logo } from './Sidebar';
import { MissionBadge } from './StatusBadge';

const MAIN_AGENT = 'MarIA';

interface Props {
  mission: Mission;
  agents: AgentInfo[];
  email: string;
  onFollowUp: (mission: Mission) => void;
}

/** « il y a … » compact : à l'instant, 5 min, 3 h, ou la date. */
function ago(iso: string, now: number): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'à l’instant';
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** Verbe et icône d'un appel d'outil, pour une ligne « coder a modifié src/app.ts ». */
function toolAction(tool: string): { verb: string; icon: LucideIcon } {
  switch (tool) {
    case 'Bash':
      return { verb: 'a exécuté', icon: Terminal };
    case 'Read':
      return { verb: 'a lu', icon: Eye };
    case 'Write':
      return { verb: 'a écrit', icon: FilePen };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { verb: 'a modifié', icon: FilePen };
    case 'Grep':
    case 'Glob':
      return { verb: 'a cherché', icon: Search };
    case 'WebFetch':
      return { verb: 'a consulté', icon: Globe };
    case 'WebSearch':
      return { verb: 'a recherché', icon: Globe };
    case 'Agent':
    case 'Task':
      return { verb: 'a lancé l’agent', icon: Bot };
    case 'TodoWrite':
      return { verb: 'a mis à jour sa liste de tâches', icon: ListTodo };
    default:
      return tool.startsWith('mcp__') ? { verb: `a appelé ${tool.split('__').pop()}`, icon: Plug } : { verb: `a utilisé ${tool}`, icon: Wrench };
  }
}

function AgentMark({ name, size = 24 }: { name: string; size?: number }) {
  return name === MAIN_AGENT ? (
    <span className="tl-maria" style={{ width: size, height: size }}>
      <Logo />
    </span>
  ) : (
    <AgentAvatar name={name} size={size} />
  );
}

/** Ligne compacte du fil : icône, phrase, heure ; cliquable si elle a un détail à déplier. */
function Line({ icon: Icon, tone, children, time, detail }: { icon: LucideIcon; tone?: string; children: ReactNode; time: string; detail?: string | null }) {
  const [open, setOpen] = useState(false);
  const body = (
    <>
      <span className="tl-icon">
        <Icon size={12} strokeWidth={2.2} />
      </span>
      <span className="tl-text">{children}</span>
      <span className="tl-time">{time}</span>
    </>
  );
  return (
    <li className={`tl-item tl-line ${tone ?? ''}`}>
      {detail ? (
        <button className="tl-row" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {body}
        </button>
      ) : (
        <div className="tl-row">{body}</div>
      )}
      {open && detail && <pre className="tl-detail">{detail}</pre>}
    </li>
  );
}

/** Message mis en avant : en-tête « X a répondu », carte avec fil d'Ariane et texte. */
function Message({
  who,
  action,
  time,
  crumbs,
  text,
  avatar,
  actions,
}: {
  who: string;
  action: string;
  time: string;
  crumbs: string[];
  text: string;
  avatar: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <li className="tl-item tl-message">
      <div className="tl-row">
        <span className="tl-avatar">{avatar}</span>
        <span className="tl-text">
          <strong>{who}</strong> <span className="tl-muted">{action}</span>
        </span>
        <span className="tl-time">{time}</span>
      </div>
      <div className="tl-card">
        <div className="tl-crumbs">
          {crumbs.map((c, i) => (
            <span key={i} className={i === crumbs.length - 1 ? 'last' : ''}>
              {c}
            </span>
          ))}
        </div>
        <div className="tl-body">{text}</div>
      </div>
      {actions && <div className="tl-actions">{actions}</div>}
    </li>
  );
}

function shorten(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

export function MissionView({ mission, agents, email, onFollowUp }: Props) {
  const [events, setEvents] = useState<MissionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    const merge = (rows: MissionEvent[]) =>
      setEvents((prev) => {
        const byId = new Map(prev.map((e) => [e.id, e]));
        rows.forEach((r) => byId.set(r.id, r));
        return [...byId.values()].sort((a, b) => a.seq - b.seq);
      });

    const channel = supabase
      .channel(`events-${mission.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: MARIA_SCHEMA, table: 'mission_events', filter: `mission_id=eq.${mission.id}` },
        (payload) => merge([payload.new as MissionEvent]),
      )
      .subscribe();

    supabase
      .from('mission_events')
      .select('*')
      .eq('mission_id', mission.id)
      .order('seq')
      .limit(5000)
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else merge(data as MissionEvent[]);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [mission.id]);

  const feed = useMemo(() => buildFeed(events), [events]);
  const finished = FINISHED_STATUSES.includes(mission.status);
  const summary = useMemo(() => buildAgents(events, finished), [events, finished]);

  // Résultat de chaque appel d'outil, déplié sous sa ligne au clic.
  const results = useMemo(() => {
    const map = new Map<string, Extract<FeedItem, { kind: 'tool_result' }>>();
    for (const item of feed) if (item.kind === 'tool_result') map.set(item.toolUseId, item);
    return map;
  }, [feed]);

  useEffect(() => {
    if (!finished) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [feed.length, finished]);

  async function cancel() {
    const { error: err } = await getSupabase().rpc('cancel_mission', { p_id: mission.id });
    if (err) setError(err.message);
  }

  const title = shorten(mission.prompt.split('\n')[0], 48);
  const lastText = [...feed].reverse().find((i) => i.kind === 'text')?.key;
  const you = email.split('@')[0];

  function focusComposer() {
    composerRef.current?.querySelector('textarea')?.focus();
  }

  return (
    <div className="mission-layout">
      <div className="chat-col">
        <div className="chat-head">
          <MissionBadge status={mission.status} />
          <span className="muted small">
            {mission.workspace}
            {mission.cost_usd != null && ` · $${Number(mission.cost_usd).toFixed(4)}`}
          </span>
          {(mission.status === 'queued' || mission.status === 'running') && (
            <button className="ghost-btn danger-text" onClick={cancel}>
              Annuler
            </button>
          )}
        </div>
        {error && <p className="error small">{error}</p>}

        <ol className="timeline">
          <Message
            who={you}
            action="a lancé la mission"
            time={ago(mission.created_at, now)}
            crumbs={[mission.workspace, 'Mission']}
            text={mission.prompt}
            avatar={<span className="tl-you">{(email[0] ?? '?').toUpperCase()}</span>}
          />

          {feed.length === 0 && (
            <Line icon={Info} time="" tone="muted">
              {mission.status === 'queued' ? 'En attente du worker…' : 'Aucun événement.'}
            </Line>
          )}

          {feed.map((item) => {
            const time = ago(item.at, now);
            switch (item.kind) {
              case 'info':
                return (
                  <Line key={item.key} icon={item.level === 'error' ? CircleAlert : item.level === 'warn' ? TriangleAlert : Info} tone={item.level} time={time}>
                    <span className="tl-muted">{item.text}</span>
                  </Line>
                );
              case 'tool': {
                const { verb, icon } = toolAction(item.tool);
                const res = results.get(item.id);
                return (
                  <Line key={item.key} icon={icon} tone={res?.isError ? 'error' : undefined} time={time} detail={res ? res.text || '(sortie vide)' : null}>
                    <strong>{item.agent}</strong> <span className="tl-muted">{verb}</span> {item.detail && <code className="tl-obj">{shorten(item.detail, 90)}</code>}
                  </Line>
                );
              }
              case 'tool_result':
                return null;
              case 'text':
                return (
                  <Message
                    key={item.key}
                    who={item.agent}
                    action="a répondu"
                    time={time}
                    crumbs={[mission.workspace, title, item.agent]}
                    text={item.text}
                    avatar={<AgentMark name={item.agent} />}
                    actions={
                      finished && mission.session_id && item.key === lastText ? (
                        <button className="ghost-btn" onClick={focusComposer}>
                          Répondre
                        </button>
                      ) : undefined
                    }
                  />
                );
              case 'done':
                return (
                  <Line key={item.key} icon={item.isError ? CircleAlert : CircleCheck} tone={item.isError ? 'error' : 'ok'} time={time}>
                    {item.text}
                  </Line>
                );
            }
          })}
          {mission.error && (
            <Line icon={CircleAlert} tone="error" time="">
              {mission.error}
            </Line>
          )}
        </ol>
        <div ref={bottomRef} />

        <div className="chat-composer" ref={composerRef}>
          {finished && mission.session_id ? (
            <FollowUp parent={mission} agents={agents} onCreated={onFollowUp} />
          ) : (
            <p className="muted small chat-wait">
              {finished ? 'Cette mission ne peut pas être continuée (pas de session).' : 'Les agents travaillent… tu pourras répondre à la fin de la mission.'}
            </p>
          )}
        </div>
      </div>

      <aside className="float-col">
        <BranchPanel mission={mission} finished={finished} />
        <AgentHub summary={summary} rufloAgents={mission.ruflo_agents ?? null} finished={finished} />
        <FileTree mission={mission} finished={finished} />
      </aside>
    </div>
  );
}

/** Suite de la mission dans la même conversation, avec la même zone de saisie que « Nouvelle mission ». */
function FollowUp({ parent, agents, onCreated }: { parent: Mission; agents: AgentInfo[]; onCreated: (m: Mission) => void }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await getSupabase()
      .from('missions')
      .insert({ prompt: prompt.trim(), workspace: parent.workspace, parent_id: parent.id, use_worktree: parent.use_worktree })
      .select()
      .single();
    setBusy(false);
    if (err) setError(err.message);
    else {
      setPrompt('');
      onCreated(data as Mission);
    }
  }

  return (
    <Composer
      value={prompt}
      onChange={setPrompt}
      agents={agents}
      placeholder="Répondre ou continuer la mission… (@ pour choisir des agents)"
      canSubmit={!busy && !!prompt.trim()}
      onSubmit={() => void submit()}
      sendLabel="Continuer"
      rows={1}
      note={error && <p className="composer-note error">{error}</p>}
    />
  );
}
