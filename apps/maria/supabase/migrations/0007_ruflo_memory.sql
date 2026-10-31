-- MarIA : copie en lecture seule de la mémoire Ruflo (.swarm/memory.db, table memory_entries) de chaque
-- dossier, synchronisée par le worker. Le front l'affiche ; seule la base SQLite locale fait foi.
create table maria.memory_entries (
  workspace text not null references maria.workspaces (name) on delete cascade,
  id text not null,
  namespace text not null,
  key text not null,
  content text not null,
  type text,
  tags jsonb,
  provenance text,
  access_count integer,
  created_at timestamptz,
  updated_at timestamptz,
  primary key (workspace, id)
);

create index memory_entries_recent on maria.memory_entries (workspace, updated_at desc);

alter table maria.memory_entries enable row level security;
grant select on maria.memory_entries to authenticated;
grant all on maria.memory_entries to service_role;

create policy "members read memory" on maria.memory_entries
  for select to authenticated using (maria.is_member());
