'use client';

import type { AgentsSummary, SubAgentRun } from '@/lib/agents';
import type { RufloAgent } from '@/lib/types';
import { AgentAvatar } from './AgentAvatar';
import { Logo } from './Sidebar';
import { AgentBadge } from './StatusBadge';

const W = 320;
const ROW = 74;
const NODE = 44;
const PER_SIDE = 3;
const CENTER = 64;

interface Props {
  summary: AgentsSummary;
  rufloAgents: RufloAgent[] | null;
  finished: boolean;
}

/** Disposition des sous-agents autour de MarIA : à gauche puis à droite, de haut en bas. */
function layout(agents: SubAgentRun[]) {
  const shown = agents.slice(0, PER_SIDE * 2);
  const left = shown.filter((_, i) => i % 2 === 0);
  const right = shown.filter((_, i) => i % 2 === 1);
  const rows = Math.max(1, left.length, right.length);
  const height = Math.max(190, rows * ROW + 40);
  const cy = height / 2;
  const place = (side: SubAgentRun[], x: number) =>
    side.map((agent, i) => ({ agent, x, y: cy + (i - (side.length - 1) / 2) * ROW }));
  return { nodes: [...place(left, 34), ...place(right, W - 34)], height, cy };
}

/** Agents de la mission : MarIA au centre, sous-agents reliés autour (animés tant qu'ils travaillent). */
export function AgentHub({ summary, rufloAgents, finished }: Props) {
  const { subAgents, mainActions, rufloCalls } = summary;
  const running = subAgents.filter((a) => a.status === 'running').length;
  const { nodes, height, cy } = layout(subAgents);
  const rufloEntries = Object.entries(rufloCalls);

  return (
    <section className="float-card hub">
      <div className="float-head">
        <h3>Agents</h3>
        <span className="muted small">
          {subAgents.length} sous-agent{subAgents.length > 1 ? 's' : ''}
          {running > 0 && ` · ${running} en cours`}
        </span>
      </div>

      <div className="hub-stage" style={{ height }}>
        <svg className="hub-lines" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="hub-axis" x1="0" x2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0" />
              <stop offset=".5" stopColor="currentColor" stopOpacity=".35" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="40" x2={W - 40} y1={cy} y2={cy} stroke="url(#hub-axis)" strokeWidth="1" />
          {nodes.map(({ agent, x, y }, i) => {
            const toRight = x < W / 2;
            const sx = toRight ? x + NODE / 2 : x - NODE / 2;
            const ex = toRight ? W / 2 - CENTER / 2 : W / 2 + CENTER / 2;
            const ey = cy + (i % 3 === 0 ? -14 : i % 3 === 1 ? 14 : 0) * (y < cy ? 1 : -1) * 0.6;
            const mx = (sx + ex) / 2;
            const d = `M ${sx} ${y} H ${mx - 10} C ${mx + 6} ${y}, ${mx - 6} ${ey}, ${mx + 10} ${ey} H ${ex}`;
            return <path key={agent.id} d={d} className={`hub-path ${agent.status}`} />;
          })}
        </svg>

        <div className={`hub-center ${running > 0 ? 'busy' : ''}`} style={{ top: cy - CENTER / 2, left: W / 2 - CENTER / 2 }} title={`MarIA · ${mainActions} action(s)`}>
          <Logo />
        </div>

        {nodes.map(({ agent, x, y }) => (
          <div key={agent.id} className={`hub-node ${agent.status}`} style={{ left: `${(x / W) * 100}%`, top: y }} title={agent.description || agent.type}>
            <span className="hub-node-ring">
              <AgentAvatar name={agent.type} size={30} />
            </span>
            <span className="hub-node-label">{agent.type}</span>
          </div>
        ))}

        {subAgents.length === 0 && (
          <p className="hub-empty muted small">{finished ? 'MarIA a travaillé seule.' : 'Pas encore de sous-agent.'}</p>
        )}
      </div>

      {subAgents.length > 0 && (
        <ul className="hub-list">
          {subAgents.map((a) => (
            <li key={a.id}>
              <AgentAvatar name={a.type} size={24} />
              <div className="hub-list-text">
                <strong>{a.type}</strong>
                <span className="muted small">{a.description || `${a.actions} action(s)`}</span>
              </div>
              <AgentBadge status={a.status} small />
            </li>
          ))}
        </ul>
      )}

      {(rufloEntries.length > 0 || (rufloAgents && rufloAgents.length > 0)) && (
        <p className="hub-ruflo muted small">
          Ruflo : {rufloEntries.map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', ') || '—'}
          {rufloAgents && rufloAgents.length > 0 && ` · registre : ${rufloAgents.map((a) => a.agentType).join(', ')}`}
        </p>
      )}
    </section>
  );
}
