'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { Mission, Workspace } from '@/lib/types';

const ONLINE_WINDOW_MS = 90_000;
const WORKTREE_KEY = 'maria.useWorktree';

export function isOnline(ws: Workspace): boolean {
  return Date.now() - new Date(ws.last_seen_at).getTime() < ONLINE_WINDOW_MS;
}

/** État et envoi d'une nouvelle mission : consigne, dossier, branche isolée. */
export function useMissionComposer(workspaces: Workspace[], onCreated: (mission: Mission) => void, initialPrompt = '') {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [workspace, setWorkspace] = useState('');
  const [useWorktree, setUseWorktree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Préférence mémorisée dans le navigateur (simple confort, sans conséquence si le stockage est indisponible).
  useEffect(() => {
    try {
      setUseWorktree(localStorage.getItem(WORKTREE_KEY) === '1');
    } catch {
      /* stockage indisponible */
    }
  }, []);

  function toggleWorktree(value: boolean) {
    setUseWorktree(value);
    try {
      localStorage.setItem(WORKTREE_KEY, value ? '1' : '0');
    } catch {
      /* stockage indisponible */
    }
  }

  useEffect(() => {
    if (!workspace && workspaces.length > 0) setWorkspace(workspaces[0].name);
  }, [workspaces, workspace]);

  const current = workspaces.find((w) => w.name === workspace);
  const canSubmit = !busy && !!prompt.trim() && !!workspace;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await getSupabase()
      .from('missions')
      .insert({ prompt: prompt.trim(), workspace, use_worktree: useWorktree })
      .select()
      .single();
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setPrompt(initialPrompt);
    onCreated(data as Mission);
  }

  return { prompt, setPrompt, workspace, setWorkspace, current, useWorktree, toggleWorktree, busy, error, canSubmit, submit };
}
