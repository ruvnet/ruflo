'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Trash2, X } from 'lucide-react';
import { CATEGORY_LABEL, type ConnectorConfig, type ConnectorDef, type WorkerHealth } from '@/lib/connectors';
import type { AgentInfo } from '@/lib/mentions';
import { AgentAvatar } from './AgentAvatar';
import { Badge } from './StatusBadge';
import { ConnectorIcon, connectorState } from './ConnectorIcon';

interface Props {
  def: ConnectorDef;
  config: ConnectorConfig;
  health: WorkerHealth | null;
  agents: AgentInfo[];
  onChange: (patch: Partial<ConnectorConfig>) => void;
  onDelete?: () => void;
  onClose: () => void;
}

function splitList(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((t) => t.trim()).filter(Boolean))];
}

/** Réglages d'un connecteur : jetons à fournir au worker, règle d'autorisation et agents concernés. */
export function ConnectorDrawer({ def, config, health, agents, onChange, onDelete, onClose }: Props) {
  const [tools, setTools] = useState(config.allowed_tools.join(', '));
  const [copied, setCopied] = useState(false);

  useEffect(() => setTools(config.allowed_tools.join(', ')), [config.allowed_tools]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const state = connectorState(def, config, health);
  const restricted = config.agents ?? [];

  function copyEnv() {
    const text = def.env.map((v) => `${v}=`).join('\n');
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  }

  function toggleAgent(name: string) {
    const next = restricted.includes(name) ? restricted.filter((a) => a !== name) : [...restricted, name];
    onChange({ agents: next.length > 0 ? next : null });
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Connecteur ${def.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <ConnectorIcon def={def} size={38} />
          <div className="cx-drawer-name">
            <strong>{def.name}</strong>
            <span className="muted small">{CATEGORY_LABEL[def.category]}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="cx-drawer-status">
          <Badge {...state} small />
          <label className="cx-switch">
            <input type="checkbox" checked={config.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
            <span aria-hidden="true" />
            {config.enabled ? 'Activé' : 'Désactivé'}
          </label>
        </div>

        <p className="cx-desc">{def.description}</p>

        <section className="cx-block">
          <h3>
            <KeyRound size={14} strokeWidth={2} /> Jetons du worker
          </h3>
          {def.env.length === 0 ? (
            <p className="muted small">Aucun jeton nécessaire.</p>
          ) : (
            <>
              <p className="muted small">
                À ajouter dans <code>apps/maria/.env.local</code> sur la machine du worker, puis <code>npm run service -- restart</code>. Les valeurs ne quittent jamais ta machine.
              </p>
              <div className="cx-env">
                {def.env.map((v) => {
                  const present = health?.env_present.includes(v);
                  return (
                    <div key={v} className="cx-env-row">
                      <code>{v}=</code>
                      <span className={`cx-env-state ${present ? 'ok' : health ? 'missing' : ''}`}>
                        {present ? 'présente' : health ? 'absente' : 'inconnue'}
                      </span>
                    </div>
                  );
                })}
                <button className="ghost-btn cx-copy" onClick={copyEnv}>
                  {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={2} />}
                  {copied ? 'Copié' : 'Copier'}
                </button>
              </div>
            </>
          )}
          <p className="muted small">{def.setup}</p>
        </section>

        <section className="cx-block">
          <h3>Autorisations</h3>
          <div className="cx-radio">
            <label className={config.policy === 'ask' ? 'active' : ''}>
              <input type="radio" name="policy" checked={config.policy === 'ask'} onChange={() => onChange({ policy: 'ask' })} />
              <strong>Demander</strong>
              <span className="muted small">Chaque action ouvre la fenêtre Autoriser / Refuser, sauf les outils listés ci-dessous.</span>
            </label>
            <label className={config.policy === 'allow' ? 'active' : ''}>
              <input type="radio" name="policy" checked={config.policy === 'allow'} onChange={() => onChange({ policy: 'allow' })} />
              <strong>Toujours autoriser</strong>
              <span className="muted small">Tous les outils du connecteur sont pré-autorisés.</span>
            </label>
          </div>
          {config.policy === 'ask' && (
            <label className="field">
              Outils autorisés sans demander
              <input
                value={tools}
                placeholder={def.tools.slice(0, 2).join(', ') || 'nom_outil, autre_outil'}
                onChange={(e) => setTools(e.target.value)}
                onBlur={() => {
                  const next = splitList(tools);
                  if (next.join(',') !== config.allowed_tools.join(',')) onChange({ allowed_tools: next });
                }}
              />
            </label>
          )}
          {def.tools.length > 0 && (
            <div className="cx-tools">
              <span className="muted small">Exemples d’outils :</span>
              {def.tools.map((t) => (
                <code key={t}>{t}</code>
              ))}
            </div>
          )}
        </section>

        <section className="cx-block">
          <h3>Agents</h3>
          <p className="muted small">
            {restricted.length === 0
              ? 'Chargé dans toutes les missions. Choisis des agents pour le réserver aux missions qui les mentionnent (@agent).'
              : 'Chargé uniquement dans les missions qui mentionnent un de ces agents.'}
          </p>
          {agents.length === 0 ? (
            <p className="muted small">Aucun agent connu : lance le worker.</p>
          ) : (
            <div className="chips cx-agents">
              {agents.map((a) => (
                <button key={a.name} className={`chip ${restricted.includes(a.name) ? 'active' : ''}`} onClick={() => toggleAgent(a.name)}>
                  <AgentAvatar name={a.name} size={16} />
                  {a.name}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="cx-block">
          <h3>Commande</h3>
          <code className="cx-cmd">{[def.command, ...def.args].join(' ')}</code>
        </section>

        {onDelete && (
          <div className="drawer-actions">
            <button className="ghost-btn danger-text" onClick={() => window.confirm(`Supprimer ${def.name} ?`) && onDelete()}>
              <Trash2 size={14} strokeWidth={2} /> Supprimer ce serveur
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
