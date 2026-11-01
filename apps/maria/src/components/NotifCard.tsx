'use client';

import type { ReactNode } from 'react';
import { CircleAlert, CircleArrowDown, CircleCheck, CircleHelp, CircleX, ShieldQuestion, X, type LucideIcon } from 'lucide-react';

/** progress = en cours (bleu), success (vert), error (rose), warning (ambre), permission (violet), question (indigo). */
export type NotifTone = 'progress' | 'success' | 'error' | 'warning' | 'permission' | 'question';

const ICONS: Record<NotifTone, LucideIcon> = {
  progress: CircleArrowDown,
  success: CircleCheck,
  error: CircleX,
  warning: CircleAlert,
  permission: ShieldQuestion,
  question: CircleHelp,
};

interface Props {
  tone: NotifTone;
  title: ReactNode;
  children?: ReactNode;
  /** Boutons d'action, alignés sous le texte. */
  actions?: ReactNode;
  onClose?: () => void;
  /** 0–100, ou 'indeterminate' pour une barre animée. */
  progress?: number | 'indeterminate';
  /** Texte discret en haut à droite (heure, mission…). */
  meta?: ReactNode;
  unread?: boolean;
  compact?: boolean;
  icon?: LucideIcon;
  id?: string;
}

/**
 * Carte de notification commune (fenêtres d'autorisation, questions, toasts, page Notifications) :
 * fond sombre, halo coloré dans l'angle, icône cerclée, titre, texte et boutons.
 */
export function NotifCard({ tone, title, children, actions, onClose, progress, meta, unread, compact, icon, id }: Props) {
  const Icon = icon ?? ICONS[tone];
  return (
    <article className={`notif ${tone} ${compact ? 'compact' : ''}`} aria-labelledby={id}>
      <span className="notif-icon" aria-hidden="true">
        <Icon size={compact ? 26 : 32} strokeWidth={1.8} />
      </span>
      <div className="notif-body">
        <div className="notif-head">
          <h3 id={id}>
            {unread && <i className="notif-unread" aria-label="Non lu" />}
            {title}
          </h3>
          {meta && <span className="notif-meta">{meta}</span>}
        </div>
        {children && <div className="notif-text">{children}</div>}
        {(progress !== undefined || actions) && (
          <div className="notif-foot">
            {progress !== undefined && (
              <div className="notif-progress">
                {typeof progress === 'number' && <span className="notif-pct">{Math.round(progress)}%</span>}
                <div className={`notif-bar ${progress === 'indeterminate' ? 'indeterminate' : ''}`}>
                  <span style={typeof progress === 'number' ? { width: `${Math.max(0, Math.min(100, progress))}%` } : undefined} />
                </div>
              </div>
            )}
            {actions && <div className="notif-actions">{actions}</div>}
          </div>
        )}
      </div>
      {onClose && (
        <button className="notif-close" onClick={onClose} aria-label="Fermer">
          <X size={18} strokeWidth={2} />
        </button>
      )}
    </article>
  );
}
