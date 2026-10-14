'use client';

import type { DragEvent } from 'react';
import { CalendarDays, Flag, GitBranch, GitPullRequest } from 'lucide-react';
import { PRIORITY_BY_ID, TYPE_BY_ID, shortDate } from '@/lib/tickets';
import { ticketKey, type Ticket } from '@/lib/types';
import { AgentAvatar } from './AgentAvatar';

/** Ticket façon carte d'embarquement : agent et type en haut, T-12 → PR au centre, échancrures et pastilles en bas. */
export function TicketCard({ ticket, onOpen, onDragStart }: { ticket: Ticket; onOpen: () => void; onDragStart?: (e: DragEvent) => void }) {
  const type = TYPE_BY_ID[ticket.type];
  const priority = PRIORITY_BY_ID[ticket.priority];
  return (
    <article
      className={`tk prio-${ticket.priority}`}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      tabIndex={0}
      role="button"
      aria-label={`${ticketKey(ticket)} — ${ticket.title}`}
    >
      <div className="tk-top">
        {ticket.assignee ? <AgentAvatar name={ticket.assignee} size={30} /> : <span className="tk-noagent" aria-hidden="true">?</span>}
        <div className="tk-label">
          <small>Agent</small>
          <strong>{ticket.assignee ?? 'Non assigné'}</strong>
        </div>
        <div className="tk-label right">
          <small>Type</small>
          <strong>{type.label}</strong>
        </div>
      </div>

      <div className="tk-route">
        <div className="tk-end">
          <b className="tk-code">{ticketKey(ticket)}</b>
          <small>{ticket.workspace ?? 'sans dossier'}</small>
        </div>
        <div className="tk-line" aria-hidden="true">
          <span />
          <i>
            <GitBranch size={12} strokeWidth={2.4} />
          </i>
          <span />
        </div>
        <div className="tk-end right">
          <b className={`tk-code ${ticket.pr_number ? '' : 'dim'}`}>{ticket.pr_number ? `#${ticket.pr_number}` : 'PR'}</b>
          <small>{ticket.pr_url ? 'pull request' : ticket.branch ? 'branche prête' : 'pas encore'}</small>
        </div>
      </div>

      <p className="tk-title">{ticket.title}</p>

      <div className="tk-cut" aria-hidden="true" />

      <div className="tk-foot">
        <span className="tk-pill">
          <CalendarDays size={12} strokeWidth={2} />
          {shortDate(ticket.created_at)}
        </span>
        <span className="tk-pill" title={`Priorité ${priority.label.toLowerCase()}`}>
          <Flag size={12} strokeWidth={2} style={{ color: priority.color }} fill={priority.color} />
          {priority.label}
        </span>
        {ticket.pr_url && (
          <a className="tk-pr" href={ticket.pr_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Ouvrir la PR">
            <GitPullRequest size={13} strokeWidth={2.2} />
          </a>
        )}
      </div>
    </article>
  );
}
