-- MarIA : questions posées par l'agent (outil AskUserQuestion), affichées dans une fenêtre.
-- Elles passent par le même circuit que les autorisations (maria.permission_requests) ;
-- la réponse de l'utilisateur est stockée dans `response` ({ "<question>": "<réponse>" }).

alter table maria.permission_requests add column response jsonb;

create function maria.answer_question(p_id uuid, p_answers jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update maria.permission_requests
  set status = 'allowed',
      response = p_answers,
      decided_by = auth.uid(),
      decided_at = now()
  where id = p_id
    and status = 'pending'
    and tool_name = 'AskUserQuestion'
    and jsonb_typeof(p_answers) = 'object'
    and maria.is_member();
$$;

revoke execute on function maria.answer_question(uuid, jsonb) from public, anon;
grant execute on function maria.answer_question(uuid, jsonb) to authenticated;
