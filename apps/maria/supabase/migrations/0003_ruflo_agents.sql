-- MarIA : instantané du registre d'agents Ruflo (`ruflo agent list`) pris à la fin d'une mission
-- qui a utilisé Ruflo. Null tant qu'aucun instantané n'a été pris.
alter table maria.missions add column ruflo_agents jsonb;
