// Mémoire Ruflo : lecture seule de la table memory_entries de .swarm/memory.db (SQLite) et copie dans Supabase.
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { MemoryEntry } from '../src/lib/types';
import type { Store } from './store';

const MAX_ENTRIES = 1000;
const MAX_CONTENT = 4000;

interface Row {
  id: string;
  namespace: string | null;
  key: string;
  content: string;
  type: string | null;
  tags: string | null;
  provenance_type: string | null;
  access_count: number | null;
  created_at: number | null;
  updated_at: number | null;
}

type Sqlite = { DatabaseSync: typeof DatabaseSync };
let sqlite: Sqlite | null | undefined;

/** node:sqlite est intégré à Node 22.13+ ; absent (ou derrière un flag) sur les versions plus anciennes. */
function loadSqlite(): Sqlite | null {
  if (sqlite === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      sqlite = require('node:sqlite') as Sqlite;
    } catch {
      sqlite = null;
    }
  }
  return sqlite;
}

export function sqliteAvailable(): boolean {
  return loadSqlite() !== null;
}

function parseTags(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.map(String) : null;
  } catch {
    return raw.split(',').map((t) => t.trim()).filter(Boolean);
  }
}

function iso(ms: number | null): string | null {
  return ms == null || !Number.isFinite(ms) ? null : new Date(ms).toISOString();
}

/** Entrées actives les plus récentes de la base ; null si la base n'existe pas (Ruflo pas initialisé). */
export function readMemory(dbPath: string, workspace: string): MemoryEntry[] | null {
  const lib = loadSqlite();
  if (!lib || !existsSync(dbPath)) return null;
  const db = new lib.DatabaseSync(dbPath, { readOnly: true });
  try {
    const hasTable = db.prepare("select 1 from sqlite_master where type = 'table' and name = 'memory_entries'").get();
    if (!hasTable) return [];
    const rows = db
      .prepare(
        `select id, namespace, key, content, type, tags, provenance_type, access_count, created_at, updated_at
         from memory_entries where coalesce(status, 'active') = 'active'
         order by updated_at desc limit ?`,
      )
      .all(MAX_ENTRIES) as unknown as Row[];
    return rows.map((r) => ({
      workspace,
      id: r.id,
      namespace: r.namespace ?? 'default',
      key: r.key,
      content: r.content.length > MAX_CONTENT ? `${r.content.slice(0, MAX_CONTENT)}… [${r.content.length - MAX_CONTENT} caractères tronqués]` : r.content,
      type: r.type,
      tags: parseTags(r.tags),
      provenance: r.provenance_type,
      access_count: r.access_count,
      created_at: iso(r.created_at),
      updated_at: iso(r.updated_at),
    }));
  } finally {
    db.close();
  }
}

/** Synchronise la mémoire de chaque dossier vers Supabase en n'envoyant que les entrées ajoutées, modifiées ou supprimées. */
export class MemorySync {
  /** dossier -> (id -> updated_at en ms) tel que connu de Supabase */
  private readonly synced = new Map<string, Map<string, number>>();

  constructor(
    private readonly store: Store,
    private readonly relPath: string,
  ) {}

  async sync(workspace: string, dir: string): Promise<{ upserted: number; deleted: number }> {
    let known = this.synced.get(workspace);
    if (!known) {
      known = await this.store.memoryIndex(workspace);
      this.synced.set(workspace, known);
    }
    const entries = readMemory(path.resolve(dir, this.relPath), workspace) ?? [];
    const changed = entries.filter((e) => known.get(e.id) !== Date.parse(e.updated_at ?? ''));
    const current = new Set(entries.map((e) => e.id));
    const removed = [...known.keys()].filter((id) => !current.has(id));

    if (changed.length > 0) await this.store.upsertMemory(changed);
    if (removed.length > 0) await this.store.deleteMemory(workspace, removed);
    for (const e of changed) known.set(e.id, Date.parse(e.updated_at ?? ''));
    for (const id of removed) known.delete(id);
    return { upserted: changed.length, deleted: removed.length };
  }
}
