'use client';

import { useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { Mission } from '@/lib/types';
import { BranchBadge } from './StatusBadge';

/** Branche git isolée de la mission : fusion dans le dossier principal ou abandon. */
export function BranchPanel({ mission, finished }: { mission: Mission; finished: boolean }) {
  const [error, setError] = useState<string | null>(null);
  if (!mission.branch || !mission.worktree_state) return null;

  const pending = mission.worktree_action;
  const canAct = finished && mission.worktree_state === 'active' && !pending;

  async function request(action: 'merge' | 'discard') {
    const question =
      action === 'merge'
        ? `Fusionner ${mission.branch} dans la branche actuelle du dossier « ${mission.workspace} » ?`
        : `Abandonner ${mission.branch} ? Le worktree et la branche seront supprimés, et les modifications perdues.`;
    if (!window.confirm(question)) return;
    setError(null);
    const { error: err } = await getSupabase().rpc('request_worktree_action', { p_id: mission.id, p_action: action });
    if (err) setError(err.message);
  }

  return (
    <section className="float-card branch">
      <div className="float-head">
        <h3>Branche</h3>
        <BranchBadge state={mission.worktree_state} small />
      </div>
      <code className="branch-name">{mission.branch}</code>
      {mission.worktree_path && mission.worktree_state === 'active' && (
        <p className="muted small">Worktree : {mission.worktree_path}</p>
      )}
      {!finished && mission.worktree_state === 'active' && (
        <p className="muted small">Les modifications seront commitées sur la branche à la fin de la mission.</p>
      )}
      {pending && <p className="muted small">{pending === 'merge' ? 'Fusion en cours…' : 'Suppression en cours…'}</p>}
      {mission.worktree_error && <p className="error small">{mission.worktree_error}</p>}
      {error && <p className="error small">{error}</p>}
      {canAct && (
        <div className="row">
          <button className="primary-btn small" onClick={() => request('merge')}>
            Fusionner
          </button>
          <button className="ghost-btn danger-text" onClick={() => request('discard')}>
            Abandonner
          </button>
        </div>
      )}
    </section>
  );
}
