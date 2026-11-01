'use client';

import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { Bell, Brain, House, MoreHorizontal, PanelLeft, Plug, Plus, Ticket, Users, type LucideProps } from 'lucide-react';
import { mentionName, type AgentInfo } from '@/lib/mentions';
import { AgentAvatar, LoadBars, loadLevel, loadTitle } from './AgentAvatar';

export type Page =
  | { kind: 'overview' }
  | { kind: 'teams' }
  | { kind: 'tickets' }
  | { kind: 'notifications' }
  | { kind: 'brains' }
  | { kind: 'connectors' }
  | { kind: 'agents' }
  | { kind: 'new-agent' }
  | { kind: 'new-mission'; prompt?: string }
  | { kind: 'agent'; name: string; edit?: boolean }
  | { kind: 'mission'; id: string };

type StaticKind = Exclude<Page['kind'], 'agent' | 'mission'>;

interface NavItem {
  kind: StaticKind;
  label: string;
  icon: ComponentType<LucideProps>;
}

export const NAV_LABEL: Record<StaticKind, string> = {
  overview: 'Overview',
  teams: 'Teams',
  tickets: 'Tickets',
  notifications: 'Notifications',
  brains: 'Brains',
  connectors: 'Connecteurs',
  agents: 'Bibliothèque d’agents',
  'new-agent': 'Nouvel agent',
  'new-mission': 'Nouvelle mission',
};

export const SECTIONS: Array<{ title: string | null; items: NavItem[] }> = [
  { title: null, items: [{ kind: 'overview', label: NAV_LABEL.overview, icon: House }] },
  {
    title: 'Category',
    items: [
      { kind: 'teams', label: NAV_LABEL.teams, icon: Users },
      { kind: 'tickets', label: NAV_LABEL.tickets, icon: Ticket },
      { kind: 'notifications', label: NAV_LABEL.notifications, icon: Bell },
      { kind: 'brains', label: NAV_LABEL.brains, icon: Brain },
    ],
  },
  { title: 'Settings', items: [{ kind: 'connectors', label: NAV_LABEL.connectors, icon: Plug }] },
];

/** Nombre d'agents affichés dans la barre ; les autres sont dans la bibliothèque. */
const SIDEBAR_AGENTS = 4;
const COLLAPSED_KEY = 'maria.sidebarCollapsed';

export function Logo() {
  return (
    <svg className="logo-mark" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="12.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M8 19V9.5l6 6 6-6V19" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Agents triés : les plus sollicités d'abord, puis par ordre alphabétique. */
export function sortAgents(agents: AgentInfo[], load: Record<string, number>): AgentInfo[] {
  return [...agents].sort((a, b) => (load[b.name] ?? 0) - (load[a.name] ?? 0) || a.name.localeCompare(b.name));
}

interface Props {
  page: Page;
  onNavigate: (page: Page) => void;
  agents: AgentInfo[];
  /** Nombre de missions récentes où chaque agent a été mentionné (@agent). */
  agentLoad: Record<string, number>;
  notificationCount: number;
}

/** Barre latérale : navigation principale et agents les plus sollicités. */
export function Sidebar({ page, onNavigate, agents, agentLoad, notificationCount }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  // Préférence mémorisée dans le navigateur ; sans stockage, la barre reste dépliée.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1');
    } catch {
      /* stockage indisponible */
    }
  }, []);

  function toggle() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1');
      } catch {
        /* stockage indisponible */
      }
      return !value;
    });
  }

  const sorted = useMemo(() => sortAgents(agents, agentLoad), [agents, agentLoad]);
  const shown = sorted.slice(0, SIDEBAR_AGENTS);
  // L'agent ouvert reste visible même s'il n'est pas dans les premiers.
  if (page.kind === 'agent' && !shown.some((a) => a.name === page.name)) {
    const current = sorted.find((a) => a.name === page.name);
    if (current) shown.push(current);
  }
  const more = sorted.length - shown.length;

  // Une mission ouverte reste rattachée à Overview dans la navigation.
  const current: Page['kind'] = page.kind === 'mission' || page.kind === 'new-mission' ? 'overview' : page.kind;
  const isActive = (p: Page) => p.kind === current && (p.kind !== 'agent' || (page.kind === 'agent' && page.name === p.name));

  return (
    <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Navigation principale">
      <div className="sb-head">
        <button className="sb-brand" onClick={() => onNavigate({ kind: 'overview' })} title="MarIA">
          <Logo />
          <span className="sb-label sb-brand-name">MarIA</span>
        </button>
        <button className="sb-icon-btn" onClick={toggle} title={collapsed ? 'Déplier la barre' : 'Replier la barre'} aria-label={collapsed ? 'Déplier la barre' : 'Replier la barre'}>
          <PanelLeft size={18} strokeWidth={1.75} />
        </button>
      </div>

      <div className="sb-scroll">
        {SECTIONS.map((section) => (
          <div key={section.title ?? 'main'} className="sb-section">
            {section.title && <div className="sb-section-title sb-label">{section.title}</div>}
            {section.items.map(({ kind, label, icon: Icon }) => (
              <button
                key={kind}
                className={`sb-item ${isActive({ kind } as Page) ? 'active' : ''}`}
                onClick={() => onNavigate({ kind } as Page)}
                title={collapsed ? label : undefined}
                aria-current={isActive({ kind } as Page) ? 'page' : undefined}
              >
                <Icon size={18} strokeWidth={1.75} />
                <span className="sb-label">{label}</span>
                {kind === 'notifications' && notificationCount > 0 && <span className="sb-count">{notificationCount}</span>}
              </button>
            ))}
          </div>
        ))}

        <div className="sb-section sb-team">
          <div className="sb-team-head">
            <span className="sb-label">Agents</span>
            <button
              className={`sb-add ${page.kind === 'new-agent' ? 'active' : ''}`}
              onClick={() => onNavigate({ kind: 'new-agent' })}
              title="Ajouter un agent"
              aria-label="Ajouter un agent"
            >
              <Plus size={18} strokeWidth={1.75} />
            </button>
          </div>
          {agents.length === 0 && <p className="sb-empty sb-label">Aucun agent : lance le worker.</p>}
          {shown.map((agent) => {
            const target: Page = { kind: 'agent', name: agent.name };
            const count = agentLoad[agent.name] ?? 0;
            return (
              <button
                key={agent.name}
                className={`sb-member ${isActive(target) ? 'active' : ''}`}
                onClick={() => onNavigate(target)}
                title={agent.description ? `@${mentionName(agent.name)} — ${agent.description}` : `@${mentionName(agent.name)}`}
              >
                <AgentAvatar name={agent.name} size={collapsed ? 30 : 26} />
                <span className="sb-label sb-member-name">{agent.name}</span>
                <span className="sb-label sb-member-load">
                  <LoadBars level={loadLevel(count)} title={loadTitle(count)} />
                </span>
              </button>
            );
          })}
          {more > 0 && (
            <button
              className={`sb-more ${page.kind === 'agents' ? 'active' : ''}`}
              onClick={() => onNavigate({ kind: 'agents' })}
              title={`Voir les ${agents.length} agents`}
            >
              <span className="sb-more-icon" aria-hidden="true">
                <MoreHorizontal size={16} strokeWidth={2} />
              </span>
              <span className="sb-label">and {more} more…</span>
            </button>
          )}
        </div>
      </div>

    </nav>
  );
}
