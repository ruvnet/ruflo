// Avatars d'agents : icône carrée arrondie, fond dégradé et petite créature, choisis de façon stable d'après le nom.
import type { ReactElement } from 'react';

const INK = '#141019';

interface Creature {
  /** Dégradé du fond (haut-gauche → bas-droite). */
  from: string;
  to: string;
  art: ReactElement;
}

const CREATURES: Creature[] = [
  // Chat noir aux grands yeux blancs
  {
    from: '#d9ccff',
    to: '#8f6bff',
    art: (
      <>
        <path d="M10 34c0-9 1.5-16 2.5-21.5l5.2 4.2a13 13 0 0 1 4.6 0l5.2-4.2C28.5 18 30 25 30 34z" fill={INK} />
        <ellipse cx="16.3" cy="25" rx="2.3" ry="3.4" fill="#fff" />
        <ellipse cx="23.7" cy="25" rx="2.3" ry="3.4" fill="#fff" />
      </>
    ),
  },
  // Blob blanc ensommeillé à petites cornes
  {
    from: '#ffb3ec',
    to: '#f04fd0',
    art: (
      <>
        <path d="M11 32V19a9 9 0 0 1 18 0v13z" fill="#fff" />
        <path d="M13 12.5l2.2 4.3-4.1.6zM27 12.5l-2.2 4.3 4.1.6z" fill="#fff" />
        <path d="M14.8 22.2a2.1 1.5 0 0 0 4.2 0zM21 22.2a2.1 1.5 0 0 0 4.2 0z" fill={INK} />
        <path d="M14.4 21.4q2.5-1 5 0M20.6 21.4q2.5-1 5 0" stroke={INK} strokeWidth="1" fill="none" strokeLinecap="round" />
        <path d="M18 27.5q2 1.2 4 0" stroke={INK} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  // Chat-crâne
  {
    from: '#c6b0ff',
    to: '#7b4dff',
    art: (
      <>
        <path d="M10.5 30c-.5-7 .5-13 2-17.5l5 3.6h5l5-3.6c1.5 4.5 2.5 10.5 2 17.5-1 2.5-3.5 3.5-9.5 3.5S11.5 32.5 10.5 30z" fill="#fff" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="16" cy="22.5" r="2.9" fill={INK} />
        <circle cx="24" cy="22.5" r="2.9" fill={INK} />
        <path d="M19.2 26.4h1.6l-.8 1.2z" fill={INK} />
        <path d="M16.5 29.5h7M18.3 28.7v1.8M20 28.7v1.8M21.7 28.7v1.8" stroke={INK} strokeWidth="1.1" strokeLinecap="round" />
      </>
    ),
  },
  // Blob jaune avec toque de chef
  {
    from: '#ff9d45',
    to: '#ff5a1f',
    art: (
      <>
        <path d="M8 36c0-7.5 5.4-12.5 12-12.5S32 28.5 32 36z" fill="#ffd23f" />
        <path d="M15.5 30.2q1.6 1.4 3.2 0M21.3 30.2q1.6 1.4 3.2 0" stroke={INK} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <circle cx="14" cy="15" r="4.6" fill="#fff" />
        <circle cx="20" cy="12.2" r="5.4" fill="#fff" />
        <circle cx="26" cy="15" r="4.6" fill="#fff" />
        <rect x="13" y="15" width="14" height="8" rx="2" fill="#fff" />
      </>
    ),
  },
  // Lapin noir de profil
  {
    from: '#7b6bff',
    to: '#3d2bb5',
    art: (
      <>
        <path d="M14 36c-2-6-1-11.5 3-14.5-2.5-4-4-9-3.5-14 3.5 2 6.2 6.5 7.3 11.2.6-4.5 2.6-8 5.7-9.7.6 4.6-.6 9.4-3.2 12.6C27 23.5 30 27.5 30 32l1 4z" fill={INK} />
        <circle cx="24.6" cy="27" r="1.7" fill="#fff" />
      </>
    ),
  },
  // Flamme blanche aux yeux noirs
  {
    from: '#ff6f8d',
    to: '#ff2a68',
    art: (
      <>
        <path d="M20 34c-6 0-9.5-4-9.5-9 0-4.2 2.6-7.4 4.6-9.6.3 2 1.2 3.3 2.4 4 .2-4.4 2.2-8.3 5.5-10.4-.4 3.4.8 6 2.9 8.2 1.9 2 3.6 4.6 3.6 7.8 0 5-3.5 9-9.5 9z" fill="#fff" />
        <ellipse cx="17.6" cy="26.5" rx="1.6" ry="2.3" fill={INK} />
        <ellipse cx="22.4" cy="26.5" rx="1.6" ry="2.3" fill={INK} />
      </>
    ),
  },
  // Fantôme
  {
    from: '#a8b4ff',
    to: '#5b5cf0',
    art: (
      <>
        <path d="M11 33V19a9 9 0 0 1 18 0v14l-3-2.4-3 2.4-3-2.4-3 2.4-3-2.4z" fill="#fff" />
        <ellipse cx="17" cy="21" rx="1.7" ry="2.4" fill={INK} />
        <ellipse cx="23" cy="21" rx="1.7" ry="2.4" fill={INK} />
        <ellipse cx="20" cy="25.8" rx="1.3" ry="1" fill={INK} />
      </>
    ),
  },
];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Avatar stable d'un agent : la même créature et la même couleur pour le même nom. */
export function AgentAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const creature = CREATURES[hash(name) % CREATURES.length];
  return (
    <span
      className="agent-avatar"
      style={{ width: size, height: size, background: `linear-gradient(145deg, ${creature.from}, ${creature.to})` }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 40 40" width={size} height={size}>
        {creature.art}
      </svg>
    </span>
  );
}

/** Indicateur en barres (comme un signal réseau) : niveau 0 à 4, couleur selon la charge. */
export function LoadBars({ level, title }: { level: number; title: string }) {
  const tone = level >= 4 ? 'high' : level === 3 ? 'mid' : 'low';
  return (
    <span className={`load-bars ${tone}`} title={title} aria-label={title}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={i <= level ? 'on' : ''} style={{ height: 3 + i * 2.5 }} />
      ))}
    </span>
  );
}

/** Niveau de charge (0 à 4) d'après le nombre de missions récentes qui mentionnent l'agent. */
export function loadLevel(count: number): number {
  return count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
}

export function loadTitle(count: number): string {
  return count === 0 ? 'Pas encore sollicité' : `Sollicité dans ${count} mission(s) récente(s)`;
}
