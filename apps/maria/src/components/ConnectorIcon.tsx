// Tuile d'icône et statut d'un connecteur, partagés par la page Connecteurs et son panneau de détail.
import { CircleAlert, Check, Database, FileText, GitPullRequest, Globe, MessageSquare, Minus, Plug, Puzzle, type LucideIcon } from 'lucide-react';
import type { ConnectorConfig, ConnectorDef, WorkerHealth } from '@/lib/connectors';
import type { Tone } from './StatusBadge';

const ICONS: Record<string, LucideIcon> = {
  github: GitPullRequest,
  playwright: Globe,
  postgres: Database,
  slack: MessageSquare,
  notion: FileText,
};

export function ConnectorIcon({ def, size = 40 }: { def: ConnectorDef; size?: number }) {
  const Icon = ICONS[def.id] ?? (def.category === 'custom' ? Puzzle : Plug);
  return (
    <span className="cx-icon" style={{ width: size, height: size, ['--cx' as string]: def.color }} aria-hidden="true">
      <Icon size={Math.round(size * 0.48)} strokeWidth={1.9} />
    </span>
  );
}

/** Statut affiché : connecté (activé et jetons présents), à configurer, activé (état du worker inconnu) ou disponible. */
export function connectorState(def: ConnectorDef, config: ConnectorConfig | undefined, health: WorkerHealth | null): { label: string; tone: Tone; icon: LucideIcon } {
  if (!config?.enabled) return { label: 'Disponible', tone: 'gray', icon: Minus };
  if (!health) return { label: 'Activé', tone: 'cyan', icon: Check };
  const missing = def.env.some((v) => !health.env_present.includes(v));
  return missing ? { label: 'À configurer', tone: 'yellow', icon: CircleAlert } : { label: 'Connecté', tone: 'green', icon: Check };
}
