import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Schéma Postgres dédié à MarIA (cohabitation avec une autre app dans le même projet). */
export const MARIA_SCHEMA = 'maria';

let client: SupabaseClient<any, typeof MARIA_SCHEMA> | null = null;

/** Client navigateur (clé anon + session de l'utilisateur). Créé à la demande pour ne pas casser le build sans variables. */
export function getSupabase() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY doivent être définies');
  }
  client = createClient(url, anonKey, { db: { schema: MARIA_SCHEMA } });
  return client;
}
