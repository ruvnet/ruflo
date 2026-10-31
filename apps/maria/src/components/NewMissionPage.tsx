'use client';

import { Bug, FlaskConical, FolderGit2, GitBranch, ScanSearch } from 'lucide-react';
import type { Mission, Workspace } from '@/lib/types';
import { Composer } from './Composer';
import { Logo } from './Sidebar';
import { isOnline, useMissionComposer } from './useMissionComposer';

const SUGGESTIONS = [
  { icon: FlaskConical, label: 'Écrire des tests', prompt: '@tester Ajoute des tests pour ' },
  { icon: Bug, label: 'Corriger un bug', prompt: '@researcher @coder Trouve et corrige le bug suivant : ' },
  { icon: ScanSearch, label: 'Revoir le code', prompt: '@reviewer Relis les dernières modifications et signale les problèmes de ' },
];

function greeting(email: string): string {
  const name = email.split('@')[0].split(/[._-]/)[0];
  const pretty = name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
  return pretty ? `Ravi de te voir, ${pretty} !` : 'Ravi de te voir !';
}

/** Page « Nouvelle mission » : accueil centré, zone de saisie et suggestions. */
export function NewMissionPage({
  workspaces,
  email,
  onCreated,
  initialPrompt = '',
}: {
  workspaces: Workspace[];
  email: string;
  onCreated: (mission: Mission) => void;
  /** Consigne de départ, ex. les @agents d'une équipe. */
  initialPrompt?: string;
}) {
  const m = useMissionComposer(workspaces, onCreated, initialPrompt);

  return (
    <div className="welcome">
      <div className="welcome-glow" aria-hidden="true" />
      <div className="welcome-logo">
        <Logo />
      </div>
      <h1 className="welcome-title">
        {greeting(email)}
        <br />
        Quelle mission pour aujourd’hui ?
      </h1>
      <p className="welcome-sub">Décris la tâche et mentionne des agents avec @ : MarIA s’occupe du reste.</p>

      <Composer
        value={m.prompt}
        onChange={m.setPrompt}
        agents={m.current?.agents ?? []}
        placeholder="Demande n’importe quoi… (@ pour choisir des agents)"
        canSubmit={m.canSubmit}
        onSubmit={() => void m.submit()}
        sendLabel="Lancer la mission"
        meta={
          <>
            <label className="composer-select" title="Dossier de travail">
              <FolderGit2 size={14} strokeWidth={2} />
              <select value={m.workspace} onChange={(e) => m.setWorkspace(e.target.value)} disabled={workspaces.length === 0}>
                {workspaces.length === 0 && <option value="">Aucun dossier (lance le worker)</option>}
                {workspaces.map((w) => (
                  <option key={w.name} value={w.name}>
                    {isOnline(w) ? '●' : '○'} {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={`composer-toggle ${m.useWorktree ? 'on' : ''}`} title="La mission travaille sur sa propre branche git, en parallèle des autres">
              <input type="checkbox" checked={m.useWorktree} onChange={(e) => m.toggleWorktree(e.target.checked)} />
              <GitBranch size={14} strokeWidth={2} />
              Branche isolée
            </label>
          </>
        }
        note={
          <>
            {m.current && !isOnline(m.current) && <p className="composer-note">Worker hors ligne : la mission attendra son redémarrage.</p>}
            {m.error && <p className="composer-note error">{m.error}</p>}
          </>
        }
      >
        <div className="suggestions">
          {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
            <button key={label} className="suggestion" onClick={() => m.setPrompt(prompt)}>
              <Icon size={15} strokeWidth={1.9} />
              {label}
            </button>
          ))}
        </div>
      </Composer>
    </div>
  );
}
