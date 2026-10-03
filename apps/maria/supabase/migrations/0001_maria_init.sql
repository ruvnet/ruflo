-- MarIA : missions pilotées par l'interface, exécutées par le worker local.
--
-- Tout vit dans un schéma dédié « maria » pour cohabiter avec une autre app dans le même
-- projet Supabase. Les comptes Auth étant partagés avec cette autre app, l'accès est réservé
-- aux utilisateurs listés dans maria.members (voir la fin du fichier).
--
-- Après exécution : Settings → API → Exposed schemas → ajouter « maria ».

create schema if not exists maria;
grant usage on schema maria to authenticated, service_role;

-- Utilisateurs autorisés à utiliser MarIA.
create table maria.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Dossiers de travail déclarés par le worker (heartbeat via last_seen_at).
create table maria.workspaces (
  name text primary key,
  last_seen_at timestamptz not null default now()
);

create table maria.missions (
  id uuid primary key default gen_random_uuid(),
  prompt text not null check (char_length(prompt) between 1 and 20000),
  workspace text not null references maria.workspaces (name),
  parent_id uuid references maria.missions (id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'cancel_requested', 'completed', 'failed', 'cancelled')),
  session_id text,
  result text,
  error text,
  files_changed jsonb not null default '[]'::jsonb,
  cost_usd numeric,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index missions_status_created_idx on maria.missions (status, created_at);

-- Flux brut de Claude Code (--output-format stream-json) + messages du worker (type 'maria').
create table maria.mission_events (
  id bigint generated always as identity primary key,
  mission_id uuid not null references maria.missions (id) on delete cascade,
  seq integer not null,
  type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (mission_id, seq)
);

-- ---------------------------------------------------------------------------
-- Droits : seuls les membres voient et créent des missions. Le front ne peut fixer que
-- prompt/workspace/parent_id et ne change un statut que via cancel_mission().
-- Le worker (service_role) contourne la RLS.
-- ---------------------------------------------------------------------------
create function maria.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from maria.members where user_id = auth.uid());
$$;

revoke execute on function maria.is_member() from public, anon;
grant execute on function maria.is_member() to authenticated;

alter table maria.members enable row level security;
alter table maria.workspaces enable row level security;
alter table maria.missions enable row level security;
alter table maria.mission_events enable row level security;

grant all on all tables in schema maria to service_role;
grant select on maria.members, maria.workspaces, maria.missions, maria.mission_events to authenticated;
grant insert (prompt, workspace, parent_id) on maria.missions to authenticated;

create policy "members read own membership" on maria.members
  for select to authenticated using (user_id = auth.uid());
create policy "members read workspaces" on maria.workspaces
  for select to authenticated using (maria.is_member());
create policy "members read missions" on maria.missions
  for select to authenticated using (maria.is_member());
create policy "members create missions" on maria.missions
  for insert to authenticated with check (maria.is_member() and created_by = auth.uid());
create policy "members read events" on maria.mission_events
  for select to authenticated using (maria.is_member());

create function maria.cancel_mission(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update maria.missions
  set status = case when status = 'queued' then 'cancelled' else 'cancel_requested' end,
      finished_at = case when status = 'queued' then now() else finished_at end
  where id = p_id
    and status in ('queued', 'running')
    and maria.is_member();
$$;

revoke execute on function maria.cancel_mission(uuid) from public, anon;
grant execute on function maria.cancel_mission(uuid) to authenticated;

-- Réservation atomique de la prochaine mission pour les dossiers libres du worker.
create function maria.claim_next_mission(p_workspaces text[])
returns setof maria.missions
language sql
security definer
set search_path = ''
as $$
  update maria.missions
  set status = 'running', started_at = now()
  where id = (
    select id from maria.missions
    where status = 'queued' and workspace = any (p_workspaces)
    order by created_at
    for update skip locked
    limit 1
  )
  returning *;
$$;

revoke execute on function maria.claim_next_mission(text[]) from public, anon, authenticated;
grant execute on function maria.claim_next_mission(text[]) to service_role;

-- Temps réel pour la liste des missions et le fil d'activité.
alter publication supabase_realtime add table maria.missions, maria.mission_events;

-- ---------------------------------------------------------------------------
-- Donner l'accès à ton compte (à exécuter après t'être connecté une première fois,
-- ou après avoir créé l'utilisateur dans Authentication → Users) :
--
--   insert into maria.members (user_id)
--   select id from auth.users where email = 'ton@email.com';
-- ---------------------------------------------------------------------------
