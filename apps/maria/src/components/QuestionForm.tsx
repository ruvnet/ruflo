'use client';

import { useState, type FormEvent } from 'react';
import type { AgentQuestion } from '@/lib/types';

const OTHER = '__other__';

interface Props {
  questions: AgentQuestion[];
  busy: boolean;
  onAnswer: (answers: Record<string, string>) => void;
  onSkip: () => void;
}

/** Questions de l'agent (AskUserQuestion) : choix proposés + réponse libre « Autre ». */
export function QuestionForm({ questions, busy, onAnswer, onSkip }: Props) {
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});

  const toggle = (qi: number, value: string, multi: boolean) =>
    setSelected((prev) => {
      const current = prev[qi] ?? [];
      const next = multi ? (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]) : [value];
      return { ...prev, [qi]: next };
    });

  const answerFor = (qi: number): string => {
    const values = (selected[qi] ?? []).map((v) => (v === OTHER ? (other[qi] ?? '').trim() : v)).filter(Boolean);
    return values.join(', ');
  };
  const complete = questions.every((_, qi) => answerFor(qi) !== '');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!complete) return;
    onAnswer(Object.fromEntries(questions.map((q, qi) => [q.question, answerFor(qi)])));
  }

  return (
    <form className="questions" onSubmit={submit}>
      {questions.map((q, qi) => {
        const multi = !!q.multiSelect;
        const type = multi ? 'checkbox' : 'radio';
        const isChecked = (v: string) => (selected[qi] ?? []).includes(v);
        return (
          <fieldset key={qi} className="question">
            {q.header && <span className="badge">{q.header}</span>}
            <legend>{q.question}</legend>
            {multi && <p className="muted small">Plusieurs choix possibles.</p>}
            {(q.options ?? []).map((o) => (
              <label key={o.label} className="option">
                <input type={type} name={`q${qi}`} checked={isChecked(o.label)} onChange={() => toggle(qi, o.label, multi)} />
                <span>
                  <strong>{o.label}</strong>
                  {o.description && o.description !== o.label && <span className="muted small"> — {o.description}</span>}
                </span>
              </label>
            ))}
            <label className="option">
              <input type={type} name={`q${qi}`} checked={isChecked(OTHER)} onChange={() => toggle(qi, OTHER, multi)} />
              <span>Autre :</span>
              <input
                className="other"
                value={other[qi] ?? ''}
                placeholder="Ta réponse"
                onFocus={() => !isChecked(OTHER) && toggle(qi, OTHER, multi)}
                onChange={(e) => setOther((prev) => ({ ...prev, [qi]: e.target.value }))}
              />
            </label>
          </fieldset>
        );
      })}
      <div className="row modal-actions">
        <button type="button" className="link" disabled={busy} onClick={onSkip}>
          Ne pas répondre
        </button>
        <button type="submit" disabled={busy || !complete}>
          Répondre
        </button>
      </div>
    </form>
  );
}
