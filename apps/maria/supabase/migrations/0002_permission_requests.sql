-- MarIA : demandes d'autorisation interactives.
-- Quand l'agent veut utiliser un outil non pré-autorisé, Claude Code interroge le serveur MCP
-- du worker (--permission-prompt-tool), qui crée une demande ici et attend la décision prise
-- dans l'interface via decide_permission().

create table maria.permission_requests (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references maria.missions (id) on delete cascade,
  tool_name text not null,
  input jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'allowed', 'denied', 'expired')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index permission_requests_pending_idx on maria.permission_requests (status, created_at);

alter table maria.permission_requests enable row level security;
grant all on maria.permission_requests to service_role;
grant select on maria.permission_requests to authenticated;

create policy "members read permission requests" on maria.permission_requests
  for select to authenticated using (maria.is_member());

create function maria.decide_permission(p_id uuid, p_allow boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update maria.permission_requests
  set status = case when p_allow then 'allowed' else 'denied' end,
      decided_by = auth.uid(),
      decided_at = now()
  where id = p_id
    and status = 'pending'
    and maria.is_member();
$$;

revoke execute on function maria.decide_permission(uuid, boolean) from public, anon;
grant execute on function maria.decide_permission(uuid, boolean) to authenticated;

alter publication supabase_realtime add table maria.permission_requests;
