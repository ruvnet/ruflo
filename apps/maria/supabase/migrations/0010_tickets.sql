-- MarIA : tickets (page Tickets, façon ClickUp). Chaque ticket a un numéro (T-12) qui donne son nom à la
-- branche git sur laquelle l'agent assigné l'exécute ; le worker y ouvre une PR quand c'est possible.
create table maria.tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 20000),
  status text not null default 'open'
    check (status in ('open', 'grooming', 'planning', 'ready', 'in_progress', 'review', 'blocked', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  type text not null default 'feature' check (type in ('feature', 'bug', 'chore', 'research')),
  assignee text,
  workspace text references maria.workspaces (name) on delete set null,
  branch text,
  pr_url text,
  pr_number integer,
  mission_id uuid references maria.missions (id) on delete set null,
  position double precision not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tickets_board on maria.tickets (status, position);

create function maria.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tickets_touch before update on maria.tickets
  for each row execute function maria.touch_updated_at();

alter table maria.tickets enable row level security;
grant select, insert, update, delete on maria.tickets to authenticated;
grant all on maria.tickets to service_role;

create policy "members read tickets" on maria.tickets for select to authenticated using (maria.is_member());
create policy "members create tickets" on maria.tickets for insert to authenticated with check (maria.is_member());
create policy "members update tickets" on maria.tickets for update to authenticated using (maria.is_member()) with check (maria.is_member());
create policy "members delete tickets" on maria.tickets for delete to authenticated using (maria.is_member());

-- Mission lancée pour exécuter un ticket.
alter table maria.missions add column ticket_id uuid references maria.tickets (id) on delete set null;
grant insert (ticket_id) on maria.missions to authenticated;

alter publication supabase_realtime add table maria.tickets;
