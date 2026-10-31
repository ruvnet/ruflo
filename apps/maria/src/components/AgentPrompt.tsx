'use client';

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { mentionAt, mentionName, parseMentions, type AgentInfo } from '@/lib/mentions';

interface Props {
  value: string;
  onChange: (value: string) => void;
  agents: AgentInfo[];
  placeholder: string;
  rows: number;
  onSubmit: () => void;
}

/** Zone de saisie de mission avec autocomplétion des mentions « @agent » et aperçu de la chaîne. */
export function AgentPrompt({ value, onChange, agents, placeholder, rows, onSubmit }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);

  const suggestions = useMemo(() => {
    if (!mention) return [];
    // Tous les agents correspondants (le menu défile) : ceux qui commencent par la saisie d'abord.
    const q = mention.query.toLowerCase();
    const key = (a: AgentInfo) => mentionName(a.name).toLowerCase();
    const starts = agents.filter((a) => key(a).startsWith(q));
    const contains = agents.filter((a) => !key(a).startsWith(q) && (key(a).includes(q) || a.description.toLowerCase().includes(q)));
    return [...starts, ...contains];
  }, [agents, mention]);

  const chain = useMemo(() => parseMentions(value, agents.map((a) => a.name)), [value, agents]);
  const unknown = chain.unknown.filter((a) => !mention || a.toLowerCase() !== mention.query.toLowerCase());

  function refresh(text: string, caret: number | null) {
    setMention(caret == null ? null : mentionAt(text, caret));
    setActive(0);
  }

  function pick(agent: AgentInfo) {
    const el = ref.current;
    if (!el || !mention) return;
    const caret = el.selectionStart;
    const insert = `@${mentionName(agent.name)} `;
    const next = value.slice(0, mention.start) + insert + value.slice(caret);
    onChange(next);
    setMention(null);
    const pos = mention.start + insert.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((i) => (i + step + suggestions.length) % suggestions.length);
        return;
      }
      if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') {
        e.preventDefault();
        pick(suggestions[active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit();
  }

  return (
    <div className="agent-prompt">
      <textarea
        ref={ref}
        placeholder={placeholder}
        value={value}
        rows={rows}
        onChange={(e) => {
          onChange(e.target.value);
          refresh(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onClick={(e) => refresh(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={() => setTimeout(() => setMention(null), 150)}
      />
      {suggestions.length > 0 && (
        <ul className="mention-menu" role="listbox" aria-label={`${suggestions.length} agent(s)`}>
          {suggestions.map((agent, i) => (
            <li
              key={agent.name}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              ref={i === active ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(agent);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <strong>@{mentionName(agent.name)}</strong>
              {agent.description && <span className="muted"> — {agent.description}</span>}
            </li>
          ))}
        </ul>
      )}
      {chain.agents.length > 0 && (
        <p className="chain small">
          Chaîne : {chain.agents.map((a) => `@${mentionName(a)}`).join(' → ')}
          <span className="muted"> — seuls ces agents seront utilisés, dans cet ordre</span>
        </p>
      )}
      {/* La mention en cours de frappe (« @co… ») n'est pas encore une erreur. */}
      {unknown.length > 0 && agents.length > 0 && (
        <p className="muted small">Agent(s) inconnu(s) dans ce dossier, ignoré(s) : {unknown.map((a) => `@${a}`).join(', ')}</p>
      )}
    </div>
  );
}
