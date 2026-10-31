-- MarIA : lignes ajoutées / supprimées par fichier modifié ({"chemin": [ajouts, suppressions] | null si binaire}),
-- calculées par le worker en fin de mission pour la vue « Fichiers modifiés ».
alter table maria.missions add column file_stats jsonb;
