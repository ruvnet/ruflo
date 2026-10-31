'use client';

import { useState, type FormEvent } from 'react';
import { getSupabase } from '@/lib/supabase';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('sending');
    // shouldCreateUser: false → seuls les comptes déjà créés dans Supabase peuvent se connecter.
    const { error } = await getSupabase().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });
    if (error) {
      setState('error');
      setMessage(error.message);
    } else {
      setState('sent');
    }
  }

  return (
    <main className="center">
      <form className="card login" onSubmit={submit}>
        <h1>MarIA</h1>
        <p className="muted">Connexion par lien magique</p>
        <input
          type="email"
          required
          placeholder="ton@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={state === 'sending' || state === 'sent'}
        />
        <button type="submit" disabled={state === 'sending' || state === 'sent'}>
          {state === 'sending' ? 'Envoi…' : 'Recevoir le lien'}
        </button>
        {state === 'sent' && <p className="muted">Lien envoyé, vérifie ta boîte mail.</p>}
        {state === 'error' && <p className="error">{message}</p>}
      </form>
    </main>
  );
}
