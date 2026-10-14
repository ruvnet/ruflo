'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2, Folder, GitBranch } from 'lucide-react';
import type { Mission } from '@/lib/types';

interface Dir {
  name: string;
  dirs: Map<string, Dir>;
  files: Array<{ name: string; path: string }>;
}

function buildTree(paths: string[]): Dir {
  const root: Dir = { name: '', dirs: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, dirs: new Map(), files: [] });
      node = node.dirs.get(part)!;
    }
    node.files.push({ name: parts[parts.length - 1], path: p });
  }
  return root;
}

/** Regroupe les dossiers à enfant unique (« apps/maria/src ») comme dans une vue de diff. */
function compact(dir: Dir): Dir {
  const dirs = new Map<string, Dir>();
  for (const child of dir.dirs.values()) {
    let c = child;
    while (c.files.length === 0 && c.dirs.size === 1) {
      const only = [...c.dirs.values()][0];
      c = { ...only, name: `${c.name}/${only.name}` };
    }
    const done = compact(c);
    dirs.set(done.name, done);
  }
  return { ...dir, dirs };
}

type Stats = NonNullable<Mission['file_stats']>;

function Counts({ stat }: { stat: [number, number] | null | undefined }) {
  if (stat === undefined) return null;
  if (stat === null) return <span className="ft-counts muted">bin</span>;
  return (
    <span className="ft-counts">
      <span className="add">+{stat[0]}</span>
      <span className="del">−{stat[1]}</span>
    </span>
  );
}

function DirNode({ dir, stats, depth }: { dir: Dir; stats: Stats; depth: number }) {
  const [open, setOpen] = useState(true);
  const dirs = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...dir.files].sort((a, b) => a.name.localeCompare(b.name));
  const pad = { paddingLeft: 10 + depth * 14 };
  return (
    <>
      {dir.name && (
        <li>
          <button className="ft-row ft-dir" style={pad} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
            <Folder size={14} strokeWidth={1.8} />
            <span className="ft-name">{dir.name}</span>
          </button>
        </li>
      )}
      {open && (
        <>
          {dirs.map((d) => (
            <DirNode key={d.name} dir={d} stats={stats} depth={dir.name ? depth + 1 : depth} />
          ))}
          {files.map((f) => (
            <li key={f.path}>
              <div className="ft-row ft-file" style={{ paddingLeft: 10 + (dir.name ? depth + 1 : depth) * 14 + 16 }} title={f.path}>
                <FileCode2 size={14} strokeWidth={1.8} />
                <span className="ft-name">{f.name}</span>
                <Counts stat={stats[f.path]} />
              </div>
            </li>
          ))}
        </>
      )}
    </>
  );
}

/** Fichiers modifiés par la mission, en arborescence, avec lignes ajoutées / supprimées. */
export function FileTree({ mission, finished }: { mission: Mission; finished: boolean }) {
  const files = mission.files_changed;
  const stats: Stats = mission.file_stats ?? {};
  const tree = useMemo(() => compact(buildTree(files)), [files]);
  const total = Object.values(stats).reduce<[number, number]>((acc, s) => (s ? [acc[0] + s[0], acc[1] + s[1]] : acc), [0, 0]);
  const hasStats = Object.keys(stats).length > 0;

  return (
    <section className="float-card files-card">
      <div className="ft-head">
        <GitBranch size={14} strokeWidth={2} />
        <span className="ft-branch">
          {mission.branch ? (
            <>
              <span className="muted">base</span> › {mission.branch}
            </>
          ) : (
            mission.workspace
          )}
        </span>
        {hasStats && (
          <span className="ft-counts">
            <span className="add">+{total[0]}</span>
            <span className="del">−{total[1]}</span>
          </span>
        )}
      </div>
      <div className="ft-title">
        <span>Fichiers modifiés</span>
        <span className="muted small">{files.length}</span>
      </div>
      {!finished && files.length === 0 && <p className="muted small ft-empty">Calculés à la fin de la mission.</p>}
      {finished && files.length === 0 && <p className="muted small ft-empty">Aucun fichier modifié.</p>}
      {files.length > 0 && (
        <ul className="ft-tree">
          <DirNode dir={tree} stats={stats} depth={0} />
        </ul>
      )}
    </section>
  );
}
