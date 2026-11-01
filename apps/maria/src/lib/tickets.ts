// Libellés, couleurs et icônes des statuts, priorités et types de tickets.
import {
  Ban,
  Bug,
  CalendarClock,
  CheckCheck,
  CircleDashed,
  CircleDot,
  Eye,
  FlaskConical,
  PencilRuler,
  Play,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { TicketPriority, TicketStatus, TicketType } from './types';

export type Tone = 'cyan' | 'indigo' | 'yellow' | 'purple' | 'orange' | 'green' | 'red' | 'gray';

export const TICKET_STATUSES: Array<{ id: TicketStatus; label: string; tone: Tone; icon: LucideIcon }> = [
  { id: 'open', label: 'Ouvert', tone: 'gray', icon: CircleDashed },
  { id: 'grooming', label: 'À préciser', tone: 'yellow', icon: PencilRuler },
  { id: 'planning', label: 'Planifié', tone: 'orange', icon: CalendarClock },
  { id: 'ready', label: 'Prêt', tone: 'indigo', icon: Play },
  { id: 'in_progress', label: 'En cours', tone: 'cyan', icon: CircleDot },
  { id: 'review', label: 'En revue', tone: 'purple', icon: Eye },
  { id: 'blocked', label: 'Bloqué', tone: 'red', icon: Ban },
  { id: 'done', label: 'Terminé', tone: 'green', icon: CheckCheck },
];

export const STATUS_BY_ID = Object.fromEntries(TICKET_STATUSES.map((s) => [s.id, s])) as Record<TicketStatus, (typeof TICKET_STATUSES)[number]>;

export const PRIORITIES: Array<{ id: TicketPriority; label: string; color: string }> = [
  { id: 'urgent', label: 'Urgente', color: '#fb7185' },
  { id: 'high', label: 'Haute', color: '#fb923c' },
  { id: 'normal', label: 'Normale', color: '#60a5fa' },
  { id: 'low', label: 'Basse', color: '#a1a1aa' },
];

export const PRIORITY_BY_ID = Object.fromEntries(PRIORITIES.map((p) => [p.id, p])) as Record<TicketPriority, (typeof PRIORITIES)[number]>;

export const TYPES: Array<{ id: TicketType; label: string; icon: LucideIcon }> = [
  { id: 'feature', label: 'Fonctionnalité', icon: Sparkles },
  { id: 'bug', label: 'Bug', icon: Bug },
  { id: 'chore', label: 'Maintenance', icon: Wrench },
  { id: 'research', label: 'Recherche', icon: FlaskConical },
];

export const TYPE_BY_ID = Object.fromEntries(TYPES.map((t) => [t.id, t])) as Record<TicketType, (typeof TYPES)[number]>;

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
