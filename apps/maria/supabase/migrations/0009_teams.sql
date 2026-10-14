-- MarIA : équipes d'agents (page Teams). Une équipe regroupe des agents (.claude/agents) avec un rôle,
-- dont un ou plusieurs responsables affichés en haut de l'organigramme.
create table maria.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 500),
  -- [{"agent": "coder", "role": "Full-Stack Engineer", "lead": false}, …]
  members jsonb not null default '[]'::jsonb check (jsonb_typeof(members) = 'array'),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

alter table maria.teams enable row level security;
grant select, insert, update, delete on maria.teams to authenticated;
grant all on maria.teams to service_role;

create policy "members read teams" on maria.teams for select to authenticated using (maria.is_member());
create policy "members create teams" on maria.teams for insert to authenticated with check (maria.is_member());
create policy "members update teams" on maria.teams for update to authenticated using (maria.is_member()) with check (maria.is_member());
create policy "members delete teams" on maria.teams for delete to authenticated using (maria.is_member());
