'use client';

import type { Mission, MissionStatus } from '@/lib/types';
import { MissionBadge } from './StatusBadge';

export const STATUS_LABEL: Record<MissionStatus, string> = {
  queued: 'En attente',
  running: 'En cours',
  cancel_requested: 'Annulation…',
  completed: 'Terminée',
  failed: 'Échec',
  cancelled: 'Annulée',
};

interface Props {
  missions: Mission[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function MissionList({ missions, selectedId, onSelect }: Props) {
  if (missions.length === 0) return <p className="muted small">Aucune mission pour l’instant.</p>;
  return (
    <ul className="mission-list">
      {missions.map((m) => (
        <li key={m.id}>
          <button className={`mission-item ${m.id === selectedId ? 'active' : ''}`} onClick={() => onSelect(m.id)}>
            <MissionBadge status={m.status} small />
            <span className="mission-title">{m.prompt}</span>
            <span className="muted small">
              {m.workspace}
              {m.branch ? ` · ⑂ ${m.worktree_state === 'active' ? 'branche à valider' : m.worktree_state === 'merged' ? 'fusionnée' : 'abandonnée'}` : ''} · {new Date(m.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
