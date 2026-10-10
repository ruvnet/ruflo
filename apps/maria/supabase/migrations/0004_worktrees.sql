-- MarIA : missions isolées dans un worktree git (une branche par mission), pour pouvoir
-- lancer plusieurs missions en parallèle sur le même dossier. Le résultat reste sur la
-- branche jusqu'à ce que l'utilisateur la fusionne ou l'abandonne depuis l'interface.

alter table maria.missions
  add column use_worktree boolean not null default false,
  add column branch text,
  add column worktree_path text,
  add column base_commit text,
  add column worktree_state text check (worktree_state in ('active', 'merged', 'discarded')),
  add column worktree_action text check (worktree_action in ('merge', 'discard')),
  add column worktree_error text;

grant insert (use_worktree) on maria.missions to authenticated;

-- Le front demande une fusion ou un abandon ; le worker exécute puis remet worktree_action à null.
create function maria.request_worktree_action(p_id uuid, p_action text)
returns void
language sql
security definer
set search_path = ''
as $$
  update maria.missions
  set worktree_action = p_action, worktree_error = null
  where id = p_id
    and p_action in ('merge', 'discard')
    and worktree_state = 'active'
    and status in ('completed', 'failed', 'cancelled')
    and maria.is_member();
$$;

revoke execute on function maria.request_worktree_action(uuid, text) from public, anon;
grant execute on function maria.request_worktree_action(uuid, text) to authenticated;

-- Réservation : les missions « sur place » seulement pour les dossiers libres, les missions
-- en worktree pour les dossiers qui ont encore de la capacité.
drop function maria.claim_next_mission(text[]);

create function maria.claim_next_mission(p_inplace text[], p_worktree text[])
returns setof maria.missions
language sql
security definer
set search_path = ''
as $$
  update maria.missions
  set status = 'running', started_at = now()
  where id = (
    select id from maria.missions
    where status = 'queued'
      and (
        (use_worktree and workspace = any (p_worktree))
        or (not use_worktree and workspace = any (p_inplace))
      )
    order by created_at
    for update skip locked
    limit 1
  )
  returning *;
$$;

revoke execute on function maria.claim_next_mission(text[], text[]) from public, anon, authenticated;
grant execute on function maria.claim_next_mission(text[], text[]) to service_role;
