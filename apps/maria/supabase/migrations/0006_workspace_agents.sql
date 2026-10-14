-- MarIA : agents disponibles dans chaque dossier (.claude/agents + agents intégrés), publiés par le worker
-- pour l'autocomplétion des mentions « @agent » dans le formulaire de mission.
alter table maria.workspaces add column agents jsonb;
