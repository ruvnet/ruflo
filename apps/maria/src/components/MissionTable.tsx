'use client';

import { GitBranch } from 'lucide-react';
import { parseMentions } from '@/lib/mentions';
import type { Mission } from '@/lib/types';
import { AgentAvatar } from './AgentAvatar';
import { MissionBadge } from './StatusBadge';

const MAX_AVATARS = 4;

/** Liste des missions (discussions avec les agents), une ligne par mission. */
export function MissionTable({
  missions,
  agentNames,
  onOpen,
}: {
  missions: Mission[];
  agentNames: string[];
  onOpen: (mission: Mission) => void;
}) {
  return (
    <section className="card missions-card">
      <div className="missions-head">
        <h3>Missions</h3>
        <span className="muted small">{missions.length} récentes</span>
      </div>
      {missions.length === 0 ? (
        <p className="muted missions-empty">Aucune mission pour l’instant : lance la première avec « Nouvelle mission ».</p>
      ) : (
        <ul className="missions-table">
          {missions.map((m) => {
            const agents = parseMentions(m.prompt, agentNames).agents;
            return (
              <li key={m.id}>
                <button className="mission-row" onClick={() => onOpen(m)}>
                  <MissionBadge status={m.status} small />
                  <span className="mission-row-title">
                    {m.prompt.split('\n')[0]}
                    {m.branch && (
                      <span className="mission-row-branch" title={m.branch}>
                        <GitBranch size={12} strokeWidth={2} />
                        {m.worktree_state === 'active' ? 'à valider' : m.worktree_state === 'merged' ? 'fusionnée' : 'abandonnée'}
                      </span>
                    )}
                  </span>
                  <span className="mission-row-agents">
                    {agents.slice(0, MAX_AVATARS).map((a) => (
                      <span key={a} title={`@${a}`}>
                        <AgentAvatar name={a} size={22} />
                      </span>
                    ))}
                    {agents.length > MAX_AVATARS && <span className="muted small">+{agents.length - MAX_AVATARS}</span>}
                  </span>
                  <span className="mission-row-meta muted small">{m.workspace}</span>
                  <span className="mission-row-meta muted small">
                    {new Date(m.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                  <span className="mission-row-cost muted small">{m.cost_usd != null ? `$${m.cost_usd.toFixed(2)}` : ''}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
