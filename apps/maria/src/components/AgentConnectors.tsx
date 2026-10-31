'use client';

import { useEffect, useState } from 'react';
import { CATALOG, resolveDef, type ConnectorConfig, type ConnectorDef } from '@/lib/connectors';
import { getSupabase } from '@/lib/supabase';
import { ConnectorIcon } from './ConnectorIcon';

type Access = 'all' | 'agent' | 'others' | 'off';

function access(config: ConnectorConfig | undefined, agent: string): Access {
  if (!config?.enabled) return 'off';
  if (!config.agents || config.agents.length === 0) return 'all';
  return config.agents.includes(agent) ? 'agent' : 'others';
}

const HINT: Record<Access, string> = {
  all: 'Chargé dans toutes les missions',
  agent: 'Chargé quand cet agent est mentionné',
  others: 'Réservé à d’autres agents',
  off: 'Désactivé',
};

/** Connecteurs (serveurs MCP) chargés pour cet agent ; modifiés directement dans maria.connectors. */
export function AgentConnectors({ agentName }: { agentName: string | null }) {
  const [configs, setConfigs] = useState<ConnectorConfig[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSupabase()
      .from('connectors')
      .select('*')
      .then(({ data, error: err }) => setConfigs(err ? [] : (data as ConnectorConfig[])));
  }, []);

  const byId = new Map((configs ?? []).map((c) => [c.id, c]));
  const entries: Array<{ def: ConnectorDef; config: ConnectorConfig | undefined }> = [
    ...CATALOG.map((def) => ({ def, config: byId.get(def.id) })),
    ...(configs ?? []).flatMap((c) => {
      const def = c.custom ? resolveDef(c) : null;
      return def ? [{ def, config: c }] : [];
    }),
  ];

  async function toggle(def: ConnectorDef, config: ConnectorConfig | undefined, on: boolean) {
    if (!agentName) return;
    const base: ConnectorConfig = config ?? { id: def.id, enabled: false, policy: 'ask', allowed_tools: [], agents: null, custom: null };
    let next: ConnectorConfig;
    if (on) {
      next = base.enabled
        ? { ...base, agents: [...(base.agents ?? []), agentName] }
        : { ...base, enabled: true, agents: [agentName] };
    } else {
      const agents = (base.agents ?? []).filter((a) => a !== agentName);
      next = agents.length > 0 ? { ...base, agents } : { ...base, enabled: false, agents: null };
    }
    setConfigs((all) => [next, ...(all ?? []).filter((c) => c.id !== def.id)]);
    const { error: err } = await getSupabase()
      .from('connectors')
      .upsert({ id: next.id, enabled: next.enabled, policy: next.policy, allowed_tools: next.allowed_tools, agents: next.agents, custom: next.custom });
    if (err) {
      setError(err.message);
      setConfigs((all) => [base, ...(all ?? []).filter((c) => c.id !== def.id)]);
    }
  }

  return (
    <section className="float-card as-section">
      <h3>Connecteurs</h3>
      {!agentName ? (
        <p className="muted small">Tu pourras brancher des connecteurs (GitHub, Slack…) sur cet agent une fois créé.</p>
      ) : configs === null ? (
        <p className="muted small">Chargement…</p>
      ) : (
        <div className="as-connectors">
          {entries.map(({ def, config }) => {
            const a = access(config, agentName);
            return (
              <label key={def.id} className={`as-connector ${a === 'all' ? 'locked' : ''}`} title={a === 'all' ? 'Partagé par toutes les missions : restreins-le depuis la page Connecteurs.' : undefined}>
                <ConnectorIcon def={def} size={28} />
                <span>
                  <strong>{def.name}</strong>
                  <span className="muted small">{HINT[a]}</span>
                </span>
                <span className="cx-switch">
                  <input type="checkbox" checked={a === 'all' || a === 'agent'} disabled={a === 'all'} onChange={(e) => void toggle(def, config, e.target.checked)} />
                  <span aria-hidden="true" />
                </span>
              </label>
            );
          })}
        </div>
      )}
      {error && <p className="error small">{error}</p>}
      {agentName && <p className="muted small">Enregistré immédiatement. Les jetons se règlent dans Connecteurs.</p>}
    </section>
  );
}
