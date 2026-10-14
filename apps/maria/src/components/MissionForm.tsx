'use client';

import type { FormEvent } from 'react';
import type { Mission, Workspace } from '@/lib/types';
import { AgentPrompt } from './AgentPrompt';
import { isOnline, useMissionComposer } from './useMissionComposer';

export { isOnline };

interface Props {
  workspaces: Workspace[];
  onCreated: (mission: Mission) => void;
  /** Texte de départ, ex. « @coder » depuis la page d'un agent. */
  initialPrompt?: string;
}

export function MissionForm({ workspaces, onCreated, initialPrompt = '' }: Props) {
  const m = useMissionComposer(workspaces, onCreated, initialPrompt);

  function submit(e: FormEvent) {
    e.preventDefault();
    void m.submit();
  }

  return (
    <form className="card mission-form" onSubmit={submit}>
      <AgentPrompt
        placeholder="Décris la mission… ex. « Ajoute des tests au module de paiement ». Tape @ pour choisir les agents de la chaîne."
        value={m.prompt}
        onChange={m.setPrompt}
        agents={m.current?.agents ?? []}
        rows={4}
        onSubmit={() => void m.submit()}
      />
      <div className="row">
        <select value={m.workspace} onChange={(e) => m.setWorkspace(e.target.value)} disabled={workspaces.length === 0}>
          {workspaces.length === 0 && <option value="">Aucun dossier (lance le worker)</option>}
          {workspaces.map((w) => (
            <option key={w.name} value={w.name}>
              {isOnline(w) ? '●' : '○'} {w.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!m.canSubmit}>
          {m.busy ? '…' : 'Lancer'}
        </button>
      </div>
      <label className="check small">
        <input type="checkbox" checked={m.useWorktree} onChange={(e) => m.toggleWorktree(e.target.checked)} />
        Branche isolée (worktree) : la mission travaille sur sa propre branche, en parallèle des autres
      </label>
      {m.current && !isOnline(m.current) && <p className="muted small">Worker hors ligne : la mission attendra son redémarrage.</p>}
      {m.error && <p className="error small">{m.error}</p>}
    </form>
  );
}
