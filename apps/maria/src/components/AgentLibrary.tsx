'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { mentionName, type AgentInfo } from '@/lib/mentions';
import { AgentAvatar, LoadBars, loadLevel, loadTitle } from './AgentAvatar';
import { sortAgents, type Page } from './Sidebar';

/** Bibliothèque : tous les agents disponibles, avec leur description et leur charge récente. */
export function AgentLibrary({
  agents,
  agentLoad,
  onNavigate,
}: {
  agents: AgentInfo[];
  agentLoad: Record<string, number>;
  onNavigate: (page: Page) => void;
}) {
  const [filter, setFilter] = useState('');
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return sortAgents(agents, agentLoad).filter(
      (a) => !q || mentionName(a.name).toLowerCase().includes(q) || a.description.toLowerCase().includes(q),
    );
  }, [agents, agentLoad, filter]);

  if (agents.length === 0) return <p className="muted">Aucun agent : lance le worker pour publier les agents de tes dossiers.</p>;

  return (
    <div className="library">
      <div className="library-bar">
        <label className="tb-search library-filter">
          <Search size={16} strokeWidth={1.75} />
          <input placeholder="Filtrer les agents…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        <span className="muted small">
          {visible.length} / {agents.length} agents
        </span>
      </div>
      <ul className="library-grid">
        {visible.map((agent) => {
          const count = agentLoad[agent.name] ?? 0;
          return (
            <li key={agent.name}>
              <button className="library-card" onClick={() => onNavigate({ kind: 'agent', name: agent.name })}>
                <div className="library-card-head">
                  <AgentAvatar name={agent.name} size={44} />
                  <div className="library-card-title">
                    <strong>{agent.name}</strong>
                    <code>@{mentionName(agent.name)}</code>
                  </div>
                  <LoadBars level={loadLevel(count)} title={loadTitle(count)} />
                </div>
                <p>{agent.description || 'Pas de description.'}</p>
              </button>
            </li>
          );
        })}
      </ul>
      {visible.length === 0 && <p className="muted">Aucun agent ne correspond.</p>}
    </div>
  );
}
