'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Dashboard } from '@/components/Dashboard';
import { LoginForm } from '@/components/LoginForm';
import { getSupabase } from '@/lib/supabase';

type Access = 'checking' | 'member' | 'denied';

export default function Home() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [access, setAccess] = useState<Access>('checking');
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabase();
    } catch (err) {
      setConfigError((err as Error).message);
      return;
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // Les comptes Auth sont partagés avec l'autre app du projet : seuls les membres de maria.members entrent.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    setAccess('checking');
    getSupabase()
      .from('members')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setConfigError(`Accès à la base impossible : ${error.message}`);
        else setAccess(data ? 'member' : 'denied');
      });
  }, [userId]);

  if (configError) return <main className="center"><p className="error">{configError}</p></main>;
  if (session === undefined) return <main className="center"><p className="muted">Chargement…</p></main>;
  if (!session) return <LoginForm />;
  if (access === 'checking') return <main className="center"><p className="muted">Vérification de l’accès…</p></main>;
  if (access === 'denied') {
    return (
      <main className="center">
        <div className="card login">
          <h1>Accès refusé</h1>
          <p className="muted">Le compte {session.user.email} n’est pas autorisé à utiliser MarIA.</p>
          <button onClick={() => getSupabase().auth.signOut()}>Se déconnecter</button>
        </div>
      </main>
    );
  }
  return <Dashboard email={session.user.email ?? ''} />;
}
