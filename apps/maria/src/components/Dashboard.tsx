'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bot, Plus, type LucideProps } from 'lucide-react';
import type { ComponentType } from 'react';
import { mentionName, parseMentions, type AgentInfo } from '@/lib/mentions';
import { getSupabase, MARIA_SCHEMA } from '@/lib/supabase';
import { FINISHED_STATUSES, type Mission, type Workspace } from '@/lib/types';
import { ActivityHeatmap } from './ActivityHeatmap';
import { AgentLibrary } from './AgentLibrary';
import { ConnectorsPage } from './ConnectorsPage';
import { MemoryView } from './MemoryView';
import { MissionForm } from './MissionForm';
import { MissionTable } from './MissionTable';
import { MissionView } from './MissionView';
import { NewMissionPage } from './NewMissionPage';
import { NotifCard } from './NotifCard';
import { NotificationsPage } from './NotificationsPage';
import { PermissionPrompt } from './PermissionPrompt';
import { NAV_LABEL, Sidebar, type Page } from './Sidebar';
import { TeamsPage } from './TeamsPage';
import { TicketsPage } from './TicketsPage';
import { TopBar } from './TopBar';

const WORKSPACE_REFRESH_MS = 30_000;

/** Page courante <-> ancre d'URL (#/overview, #/agents/coder), pour garder la page au rechargement. */
function pageFromHash(hash: string): Page {
  const [, section, rest] = hash.replace(/^#\/?/, '/').split('/');
  if (section === 'agents' && rest) return { kind: 'agent', name: decodeURIComponent(rest) };
  if (section === 'missions' && rest) return { kind: 'mission', id: decodeURIComponent(rest) };
  if (section && section in NAV_LABEL) return { kind: section as Exclude<Page['kind'], 'agent' | 'mission'> } as Page;
  return { kind: 'overview' };
}

function hashFromPage(page: Page): string {
  if (page.kind === 'agent') return `#/agents/${encodeURIComponent(page.name)}`;
  if (page.kind === 'mission') return `#/missions/${encodeURIComponent(page.id)}`;
  return `#/${page.kind}`;
}

const PLACEHOLDERS: Record<'new-agent', { icon: ComponentType<LucideProps>; text: string }> = {
  'new-agent': {
    icon: Bot,
    text: 'La création d’agents depuis MarIA arrive bientôt. En attendant, un agent est un fichier Markdown dans .claude/agents/ du dossier : il apparaît ici au prochain passage du worker.',
  },
};

export function Dashboard({ email }: { email: string }) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [page, setPage] = useState<Page>({ kind: 'overview' });
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Mission[]>([]);
  const dismissToast = useCallback((id: string) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const pushToast = useCallback(
    (m: Mission) => {
      setToasts((all) => [m, ...all.filter((t) => t.id !== m.id)].slice(0, 3));
      setTimeout(() => dismissToast(m.id), 9000);
    },
    [dismissToast],
  );
  const [theme, toggleTheme] = useTheme();

  useEffect(() => {
    const sync = () => setPage(pageFromHash(window.location.hash));
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const navigate = useCallback((next: Page) => {
    setPage(next);
    if (window.location.hash !== hashFromPage(next)) window.history.pushState(null, '', hashFromPage(next));
  }, []);

  useEffect(() => {
    const supabase = getSupabase();

    const upsert = (row: Mission) =>
      setMissions((prev) => {
        const before = prev.find((m) => m.id === row.id);
        // Toast quand une mission suivie en direct se termine (pas au chargement initial).
        if (before && !FINISHED_STATUSES.includes(before.status) && FINISHED_STATUSES.includes(row.status)) pushToast(row);
        const rest = prev.filter((m) => m.id !== row.id);
        return [row, ...rest].sort((a, b) => b.created_at.localeCompare(a.created_at));
      });

    // Abonnement avant le chargement initial pour ne rien rater entre les deux.
    const channel = supabase
      .channel('missions')
      .on('postgres_changes', { event: '*', schema: MARIA_SCHEMA, table: 'missions' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const id = (payload.old as Partial<Mission>).id;
          setMissions((prev) => prev.filter((m) => m.id !== id));
        } else {
          upsert(payload.new as Mission);
        }
      })
      .subscribe();

    supabase
      .from('missions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else (data as Mission[]).forEach(upsert);
      });

    const loadWorkspaces = () =>
      supabase
        .from('workspaces')
        .select('*')
        .order('name')
        .then(({ data, error: err }) => {
          if (err) setError(err.message);
          else setWorkspaces(data as Workspace[]);
        });
    loadWorkspaces();
    const timer = setInterval(loadWorkspaces, WORKSPACE_REFRESH_MS);

    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  // Agents de tous les dossiers, sans doublon.
  const agents = useMemo(() => {
    const byName = new Map<string, AgentInfo>();
    for (const w of workspaces) for (const a of w.agents ?? []) if (!byName.has(a.name)) byName.set(a.name, a);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [workspaces]);

  // Charge de chaque agent : nombre de missions chargées (les 50 dernières) qui le mentionnent.
  const agentLoad = useMemo(() => {
    const names = agents.map((a) => a.name);
    const load: Record<string, number> = {};
    for (const m of missions) for (const name of parseMentions(m.prompt, names).agents) load[name] = (load[name] ?? 0) + 1;
    return load;
  }, [agents, missions]);

  const openMission = (m: Mission) => {
    navigate({ kind: 'mission', id: m.id });
  };

  // Agents cités dans une mission en cours : « actifs » dans les équipes.
  const activeAgents = useMemo(() => {
    const names = agents.map((a) => a.name);
    const set = new Set<string>();
    for (const m of missions) if (m.status === 'running' || m.status === 'queued') for (const a of parseMentions(m.prompt, names).agents) set.add(a);
    return set;
  }, [agents, missions]);

  const opened = page.kind === 'mission' ? (missions.find((m) => m.id === page.id) ?? null) : null;
  const title =
    page.kind === 'agent'
      ? page.name
      : page.kind === 'mission'
        ? opened
          ? opened.prompt.split('\n')[0].slice(0, 70) + (opened.prompt.length > 70 ? '…' : '')
          : 'Mission'
        : NAV_LABEL[page.kind];

  return (
    <div className="app">
      <Sidebar
        page={page}
        onNavigate={navigate}
        agents={agents}
        agentLoad={agentLoad}
        notificationCount={pendingCount}
      />
      <PermissionPrompt missions={missions} onCountChange={setPendingCount} />
      <div className="workspace">
        <TopBar
          agents={agents}
          missions={missions}
          dark={theme === 'dark'}
          onToggleDark={toggleTheme}
          onNavigate={navigate}
          onOpenMission={openMission}
          email={email}
          onSignOut={() => getSupabase().auth.signOut()}
        />
      <main className="main">
        {page.kind !== 'new-mission' && page.kind !== 'teams' && (
          <div className="page-title">
            <h1>{title}</h1>
            {page.kind === 'overview' && (
              <button className="primary-btn" onClick={() => navigate({ kind: 'new-mission' })}>
                <Plus size={16} strokeWidth={2.25} />
                Nouvelle mission
              </button>
            )}
          </div>
        )}
        {error && <p className="error banner">{error}</p>}

        {page.kind === 'overview' && (
          <div className="overview">
            <ActivityHeatmap refreshKey={missions.length} />
            <MissionTable missions={missions} agentNames={agents.map((a) => a.name)} onOpen={openMission} />
          </div>
        )}

        {page.kind === 'mission' && (
          <div className="mission-page">
            <button className="back-link" onClick={() => navigate({ kind: 'overview' })}>
              <ArrowLeft size={16} strokeWidth={2} />
              Overview
            </button>
            {opened ? (
              <MissionView key={opened.id} mission={opened} agents={agents} email={email} onFollowUp={openMission} />
            ) : (
              <p className="muted">Mission introuvable parmi les 50 plus récentes.</p>
            )}
          </div>
        )}

        {page.kind === 'new-mission' && (
          <NewMissionPage key={page.prompt ?? ''} workspaces={workspaces} email={email} onCreated={openMission} initialPrompt={page.prompt} />
        )}

        {page.kind === 'notifications' && <NotificationsPage missions={missions} onOpenMission={openMission} />}

        {page.kind === 'tickets' && <TicketsPage agents={agents} workspaces={workspaces} missions={missions} onOpenMission={openMission} />}

        {page.kind === 'teams' && (
          <TeamsPage
            agents={agents}
            activeAgents={activeAgents}
            onOpenAgent={(name) => navigate({ kind: 'agent', name })}
            onLaunch={(prompt) => navigate({ kind: 'new-mission', prompt })}
          />
        )}

        {page.kind === 'brains' && <MemoryView workspaces={workspaces} />}

        {page.kind === 'agents' && <AgentLibrary agents={agents} agentLoad={agentLoad} onNavigate={navigate} />}

        {page.kind === 'agent' && (
          <AgentPage key={page.name} agent={agents.find((a) => a.name === page.name) ?? null} name={page.name} workspaces={workspaces} onCreated={openMission} />
        )}

        {page.kind === 'connectors' && <ConnectorsPage workspaces={workspaces} agents={agents} />}

        {page.kind === 'new-agent' && <Placeholder {...PLACEHOLDERS[page.kind]} />}
      </main>
      </div>

      {toasts.length > 0 && (
        <div className="toasts" aria-live="polite">
          {toasts.map((m) => (
            <NotifCard
              key={m.id}
              compact
              tone={m.status === 'completed' ? 'success' : m.status === 'failed' ? 'error' : 'warning'}
              title={m.status === 'completed' ? 'Mission terminée !' : m.status === 'failed' ? 'La mission a échoué' : 'Mission annulée'}
              onClose={() => dismissToast(m.id)}
              actions={
                <button
                  className="primary"
                  onClick={() => {
                    dismissToast(m.id);
                    openMission(m);
                  }}
                >
                  Voir la mission
                </button>
              }
            >
              <p>« {m.prompt.length > 90 ? `${m.prompt.slice(0, 90)}…` : m.prompt} »</p>
            </NotifCard>
          ))}
        </div>
      )}

    </div>
  );
}

const THEME_KEY = 'maria.theme';

/** Thème clair/sombre : sombre par défaut, choix mémorisé dans le navigateur (appliqué avant l'affichage par layout.tsx). */
function useTheme(): ['dark' | 'light', () => void] {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);
  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* stockage indisponible : le choix vaut pour cette visite */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}

function Placeholder({ icon: Icon, text }: { icon: ComponentType<LucideProps>; text: string }) {
  return (
    <div className="placeholder">
      <Icon size={28} strokeWidth={1.5} />
      <p>{text}</p>
    </div>
  );
}

function AgentPage({
  agent,
  name,
  workspaces,
  onCreated,
}: {
  agent: AgentInfo | null;
  name: string;
  workspaces: Workspace[];
  onCreated: (m: Mission) => void;
}) {
  const where = workspaces.filter((w) => w.agents?.some((a) => a.name === name)).map((w) => w.name);
  return (
    <div className="agent-page">
      <div className="card agent-card">
        <code className="agent-mention">@{mentionName(name)}</code>
        <p>{agent?.description || 'Pas de description.'}</p>
        {where.length > 0 && <p className="muted small">Disponible dans : {where.join(', ')}</p>}
      </div>
      <h2>Confier une mission à cet agent</h2>
      <MissionForm workspaces={workspaces} onCreated={onCreated} initialPrompt={`@${mentionName(name)} `} />
    </div>
  );
}
