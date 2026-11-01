-- MarIA : connecteurs (serveurs MCP branchés sur Claude Code par le worker) et réglages partagés.
-- Les secrets restent dans .env.local sur la machine du worker : ces tables n'en contiennent aucun.

-- État du worker (versions, gh connecté, Ruflo, variables présentes) publié à chaque battement.
alter table maria.workspaces add column health jsonb;

create table maria.connectors (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,39}$' and id <> 'maria'),
  enabled boolean not null default false,
  policy text not null default 'ask' check (policy in ('ask', 'allow')),
  allowed_tools text[] not null default '{}',
  agents text[],
  custom jsonb,
  updated_at timestamptz not null default now()
);

create trigger connectors_touch before update on maria.connectors
  for each row execute function maria.touch_updated_at();

-- Réglages globaux, ex. {"key": "allowed_tools", "value": ["Read", "Edit", "Bash(npm test:*)"]}.
create table maria.settings (
  key text primary key check (char_length(key) between 1 and 60),
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table maria.connectors enable row level security;
alter table maria.settings enable row level security;
grant select, insert, update, delete on maria.connectors, maria.settings to authenticated;
grant all on maria.connectors, maria.settings to service_role;

create policy "members read connectors" on maria.connectors for select to authenticated using (maria.is_member());
create policy "members write connectors" on maria.connectors for insert to authenticated with check (maria.is_member());
create policy "members update connectors" on maria.connectors for update to authenticated using (maria.is_member()) with check (maria.is_member());
create policy "members delete connectors" on maria.connectors for delete to authenticated using (maria.is_member());

create policy "members read settings" on maria.settings for select to authenticated using (maria.is_member());
create policy "members write settings" on maria.settings for insert to authenticated with check (maria.is_member());
create policy "members update settings" on maria.settings for update to authenticated using (maria.is_member()) with check (maria.is_member());
