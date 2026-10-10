-- MarIA : atelier d'agents. Le worker publie les définitions .claude/agents de chaque dossier (agent_files)
-- et applique les créations, modifications et suppressions demandées depuis l'interface (agent_ops).

create table maria.agent_files (
  workspace text not null references maria.workspaces (name) on delete cascade,
  name text not null,
  -- project = <dossier>/.claude/agents, user = ~/.claude/agents (lecture seule dans MarIA)
  scope text not null check (scope in ('project', 'user')),
  path text not null,
  description text not null default '',
  -- null = tous les outils (hérités de la mission)
  tools text[],
  model text,
  color text,
  body text not null default '',
  hash text not null,
  updated_at timestamptz not null default now(),
  primary key (workspace, name)
);

create table maria.agent_ops (
  id uuid primary key default gen_random_uuid(),
  workspace text not null references maria.workspaces (name) on delete cascade,
  op text not null check (op in ('save', 'delete')),
  -- Nom actuel de l'agent modifié ou supprimé (null pour une création).
  original_name text,
  -- { name, description, tools, model, color, body } pour op = save
  content jsonb,
  status text not null default 'pending' check (status in ('pending', 'done', 'error')),
  error text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create index agent_ops_pending on maria.agent_ops (created_at) where status = 'pending';

alter table maria.agent_files enable row level security;
alter table maria.agent_ops enable row level security;

grant select on maria.agent_files to authenticated;
grant select on maria.agent_ops to authenticated;
-- Le navigateur ne peut que déposer une demande ; le statut est écrit par le worker.
grant insert (workspace, op, original_name, content) on maria.agent_ops to authenticated;
grant all on maria.agent_files, maria.agent_ops to service_role;

create policy "members read agent files" on maria.agent_files for select to authenticated using (maria.is_member());
create policy "members read agent ops" on maria.agent_ops for select to authenticated using (maria.is_member());
create policy "members request agent ops" on maria.agent_ops for insert to authenticated with check (maria.is_member());
