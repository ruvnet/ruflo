'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { MemoryEntry, Workspace } from '@/lib/types';

const REFRESH_MS = 30_000;
const PREVIEW = 280;

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

/** Mémoire Ruflo d'un dossier (copie de .swarm/memory.db synchronisée par le worker), en lecture seule. */
export function MemoryView({ workspaces }: { workspaces: Workspace[] }) {
  const [workspace, setWorkspace] = useState('');
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [namespace, setNamespace] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace && workspaces.length > 0) setWorkspace(workspaces[0].name);
  }, [workspaces, workspace]);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    const { data, error: err } = await getSupabase()
      .from('memory_entries')
      .select('*')
      .eq('workspace', workspace)
      .order('updated_at', { ascending: false })
      .limit(1000);
    setLoading(false);
    if (err) setError(err.message);
    else {
      setError(null);
      setEntries(data as MemoryEntry[]);
    }
  }, [workspace]);

  useEffect(() => {
    setNamespace(null);
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const namespaces = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.namespace, (counts.get(e.namespace) ?? 0) + 1);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (!namespace || e.namespace === namespace) &&
        (!q || e.key.toLowerCase().includes(q) || e.content.toLowerCase().includes(q) || e.tags?.some((t) => t.toLowerCase().includes(q))),
    );
  }, [entries, namespace, query]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="memory">
      <div className="memory-head">
        <select value={workspace} onChange={(e) => setWorkspace(e.target.value)} disabled={workspaces.length === 0}>
          {workspaces.map((w) => (
            <option key={w.name} value={w.name}>
              {w.name}
            </option>
          ))}
        </select>
        <input type="search" placeholder="Rechercher (clé, contenu, tag)…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="link" onClick={() => void load()} disabled={loading}>
          {loading ? 'Chargement…' : 'Actualiser'}
        </button>
      </div>

      {namespaces.length > 0 && (
        <div className="chips">
          <button className={`chip ${namespace === null ? 'active' : ''}`} onClick={() => setNamespace(null)}>
            Tout ({entries.length})
          </button>
          {namespaces.map(([ns, count]) => (
            <button key={ns} className={`chip ${namespace === ns ? 'active' : ''}`} onClick={() => setNamespace(ns)}>
              {ns} ({count})
            </button>
          ))}
        </div>
      )}

      {error && <p className="error small">{error}</p>}
      {!error && entries.length === 0 && !loading && (
        <p className="muted">
          Aucune entrée. La mémoire apparaît ici quand des agents utilisent la mémoire Ruflo dans ce dossier (fichier
          <code> .swarm/memory.db</code>), quelques secondes après la synchronisation du worker.
        </p>
      )}
      {entries.length > 0 && visible.length === 0 && <p className="muted">Aucune entrée ne correspond.</p>}

      <ul className="memory-list">
        {visible.map((e) => {
          const expanded = open.has(e.id);
          const long = e.content.length > PREVIEW;
          return (
            <li key={e.id} className="card memory-item">
              <div className="memory-meta">
                <strong className="memory-key">{e.key}</strong>
                <span className="badge">{e.namespace}</span>
                {e.type && e.type !== 'semantic' && <span className="badge">{e.type}</span>}
                <span className="muted small">{formatDate(e.updated_at)}</span>
              </div>
              <pre className="memory-content">{expanded || !long ? e.content : `${e.content.slice(0, PREVIEW)}…`}</pre>
              <div className="memory-meta small">
                {e.tags?.map((t) => (
                  <span key={t} className="tag">
                    #{t}
                  </span>
                ))}
                {e.access_count ? <span className="muted">{e.access_count} lecture(s)</span> : null}
                {long && (
                  <button className="link" onClick={() => toggle(e.id)}>
                    {expanded ? 'Réduire' : 'Tout afficher'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
