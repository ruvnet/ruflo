'use client';

import { useEffect, useState } from 'react';
import { describeTool } from '@/lib/feed';
import { getSupabase, MARIA_SCHEMA } from '@/lib/supabase';
import type { AgentQuestion, Mission, PermissionRequest } from '@/lib/types';
import { NotifCard } from './NotifCard';
import { QuestionForm } from './QuestionForm';

const BASE_TITLE = 'MarIA';

/** Fenêtre « Autoriser / Refuser » pour les actions que l'agent n'est pas pré-autorisé à faire. */
export function PermissionPrompt({ missions, onCountChange }: { missions: Mission[]; onCountChange?: (count: number) => void }) {
  const [pending, setPending] = useState<PermissionRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    const apply = (row: PermissionRequest) =>
      setPending((prev) => {
        const rest = prev.filter((r) => r.id !== row.id);
        const next = row.status === 'pending' ? [...rest, row] : rest;
        return next.sort((a, b) => a.created_at.localeCompare(b.created_at));
      });

    const channel = supabase
      .channel('permission-requests')
      .on('postgres_changes', { event: '*', schema: MARIA_SCHEMA, table: 'permission_requests' }, (payload) => {
        if (payload.eventType !== 'DELETE') apply(payload.new as PermissionRequest);
      })
      .subscribe();

    supabase
      .from('permission_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at')
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else (data as PermissionRequest[]).forEach(apply);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Signale une demande en attente dans l'onglet, même quand MarIA n'est pas au premier plan.
  useEffect(() => {
    document.title = pending.length > 0 ? `(${pending.length}) Action requise — ${BASE_TITLE}` : BASE_TITLE;
    onCountChange?.(pending.length);
  }, [pending.length, onCountChange]);

  const current = pending[0];
  if (!current) return null;
  const mission = missions.find((m) => m.id === current.mission_id);

  const questions =
    current.tool_name === 'AskUserQuestion' && Array.isArray(current.input.questions)
      ? (current.input.questions as AgentQuestion[])
      : null;

  async function answer(answers: Record<string, string>) {
    setBusy(true);
    setError(null);
    const { error: err } = await getSupabase().rpc('answer_question', { p_id: current.id, p_answers: answers });
    setBusy(false);
    if (err) setError(err.message);
    else setPending((prev) => prev.filter((r) => r.id !== current.id));
  }

  async function decide(allow: boolean) {
    setBusy(true);
    setError(null);
    const { error: err } = await getSupabase().rpc('decide_permission', { p_id: current.id, p_allow: allow });
    setBusy(false);
    if (err) setError(err.message);
    else setPending((prev) => prev.filter((r) => r.id !== current.id));
  }

  const context = mission ? `« ${mission.prompt.length > 80 ? `${mission.prompt.slice(0, 80)}…` : mission.prompt} » · ${mission.workspace}` : null;
  const others = pending.length > 1 ? `+${pending.length - 1} autre(s) en attente` : null;

  if (questions) {
    return (
      <div className="modal-backdrop notif-backdrop" role="dialog" aria-modal="true" aria-labelledby="perm-title">
        <div className="notif-modal">
          <NotifCard tone="question" id="perm-title" title="L’agent a une question" meta={others}>
            {context && <p className="notif-context">Mission {context}</p>}
            <QuestionForm questions={questions} busy={busy} onAnswer={answer} onSkip={() => decide(false)} />
            {error && <p className="error small">{error}</p>}
          </NotifCard>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop notif-backdrop" role="dialog" aria-modal="true" aria-labelledby="perm-title">
      <div className="notif-modal">
        <NotifCard
          tone="permission"
          id="perm-title"
          title="Autorisation demandée"
          meta={others}
          actions={
            <>
              <button className="primary" disabled={busy} onClick={() => decide(true)} autoFocus>
                Autoriser
              </button>
              <button disabled={busy} onClick={() => decide(false)}>
                Refuser
              </button>
            </>
          }
        >
          {context && <p className="notif-context">Mission {context}</p>}
          <p>
            L’agent veut utiliser <strong>{current.tool_name}</strong> :
          </p>
          <pre className="perm-detail">{describeTool(current.tool_name, current.input) || '(sans détail)'}</pre>
          <details>
            <summary className="small">Paramètres complets</summary>
            <pre className="perm-detail">{JSON.stringify(current.input, null, 2)}</pre>
          </details>
          {error && <p className="error small">{error}</p>}
        </NotifCard>
      </div>
    </div>
  );
}
