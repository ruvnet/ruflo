// Badges de statut « pilule lumineuse » : bord coloré, fond teinté et pastille d'icône pleine.
import { Check, ClipboardList, Contrast, GitMerge, Hourglass, Minus, Plus, RotateCcw, Trash2, X, type LucideIcon } from 'lucide-react';
import type { AgentStatus } from '@/lib/agents';
import type { Mission, MissionStatus } from '@/lib/types';

export type Tone = 'cyan' | 'indigo' | 'yellow' | 'purple' | 'orange' | 'green' | 'red' | 'gray';

interface BadgeSpec {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

export function Badge({ label, tone, icon: Icon, small = false }: BadgeSpec & { small?: boolean }) {
  return (
    <span className={`sbadge ${tone} ${small ? 'small' : ''}`}>
      <span className="sbadge-icon" aria-hidden="true">
        <Icon size={small ? 9 : 11} strokeWidth={3} />
      </span>
      {label}
    </span>
  );
}

const MISSION: Record<MissionStatus, BadgeSpec> = {
  queued: { label: 'En attente', tone: 'indigo', icon: Plus },
  running: { label: 'En cours', tone: 'cyan', icon: Contrast },
  cancel_requested: { label: 'Annulation…', tone: 'yellow', icon: Hourglass },
  completed: { label: 'Terminée', tone: 'green', icon: Check },
  failed: { label: 'Échec', tone: 'red', icon: X },
  cancelled: { label: 'Annulée', tone: 'gray', icon: Minus },
};

const AGENT: Record<AgentStatus, BadgeSpec> = {
  running: { label: 'En cours', tone: 'cyan', icon: Contrast },
  done: { label: 'Terminé', tone: 'green', icon: Check },
  error: { label: 'Erreur', tone: 'red', icon: X },
  interrupted: { label: 'Interrompu', tone: 'orange', icon: RotateCcw },
};

const BRANCH: Record<NonNullable<Mission['worktree_state']>, BadgeSpec> = {
  active: { label: 'À valider', tone: 'yellow', icon: ClipboardList },
  merged: { label: 'Fusionnée', tone: 'purple', icon: GitMerge },
  discarded: { label: 'Abandonnée', tone: 'gray', icon: Trash2 },
};

export function MissionBadge({ status, small }: { status: MissionStatus; small?: boolean }) {
  return <Badge {...MISSION[status]} small={small} />;
}

export function AgentBadge({ status, small }: { status: AgentStatus; small?: boolean }) {
  return <Badge {...AGENT[status]} small={small} />;
}

export function BranchBadge({ state, small }: { state: NonNullable<Mission['worktree_state']>; small?: boolean }) {
  return <Badge {...BRANCH[state]} small={small} />;
}

