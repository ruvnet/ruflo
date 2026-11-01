'use client';

import type { ReactNode } from 'react';
import { ArrowUp } from 'lucide-react';
import type { AgentInfo } from '@/lib/mentions';
import { AgentPrompt } from './AgentPrompt';

interface Props {
  value: string;
  onChange: (value: string) => void;
  agents: AgentInfo[];
  placeholder: string;
  canSubmit: boolean;
  onSubmit: () => void;
  /** Ligne au-dessus de la zone (dossier, branche…). */
  meta?: ReactNode;
  /** Message sous la zone (worker hors ligne, erreur…). */
  note?: ReactNode;
  /** Contenu sous la zone, ex. suggestions. */
  children?: ReactNode;
  rows?: number;
  sendLabel?: string;
}

/** Zone de saisie commune (nouvelle mission et suite de mission) : autocomplétion @agent et bouton d'envoi rond. */
export function Composer({ value, onChange, agents, placeholder, canSubmit, onSubmit, meta, note, children, rows = 2, sendLabel = 'Envoyer' }: Props) {
  return (
    <div className="composer">
      {meta && <div className="composer-meta">{meta}</div>}
      <div className="composer-box">
        <AgentPrompt placeholder={placeholder} value={value} onChange={onChange} agents={agents} rows={rows} onSubmit={onSubmit} />
        <button className="composer-send" onClick={onSubmit} disabled={!canSubmit} aria-label={sendLabel} title={`${sendLabel} (Ctrl+Entrée)`}>
          <ArrowUp size={18} strokeWidth={2.25} />
        </button>
      </div>
      {note}
      {children}
    </div>
  );
}
