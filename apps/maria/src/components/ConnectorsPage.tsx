'use client';

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, Brain, Cpu, GitPullRequest, Plus, Server, ShieldCheck, Terminal } from 'lucide-react';
import { CATALOG, CATEGORY_LABEL, resolveDef, type ConnectorCategory, type ConnectorConfig, type ConnectorDef } from '@/lib/connectors';
import type { AgentInfo } from '@/lib/mentions';
import { getSupabase } from '@/lib/supabase';
import type { Workspace } from '@/lib/types';
import { ConnectorDrawer } from './ConnectorDrawer';
import { ConnectorIcon, connectorState } from './ConnectorIcon';
import { Badge } from './StatusBadge';

const ONLINE_MS = 90_000;

function defaultConfig(id: string): ConnectorConfig {
  return { id, enabled: false, policy: 'ask', allowed_tools: [], agents: null, custom: null };
}

function missingTable(message: string): boolean {
  return /does not exist|Could not find the table|schema cache/i.test(message);
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  return `il y a ${Math.round(s / 3600)} h`;
}

function splitList(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((t) => t.trim()).filter(Boolean))];
}

interface Props {
  workspaces: Workspace[];
  agents: AgentInfo[];
}

/** Connecteurs : état de la machine du worker, serveurs MCP branchés sur les missions et outils pré-autorisés. */
export function ConnectorsPage({ workspaces, agents }: Props) {
  const [configs, setConfigs] = useState<ConnectorConfig[]>([]);
  const [allowed, setAllowed] = useState('');
  const [savedAllowed, setSavedAllowed] = useState('');
  const [category, setCategory] = useState<'all' | ConnectorCategory>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [wsName, setWsName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    supabase
      .from('connectors')
      .select('*')
      .then(({ data, error: err }) => {
        if (err) {
          if (missingTable(err.message)) setNeedsMigration(true);
          else setError(err.message);
        } else setConfigs(data as ConnectorConfig[]);
      });
    supabase
      .from('settings')
      .select('value')
      .eq('key', 'allowed_tools')
      .maybeSingle()
      .then(({ data }) => {
        const list = Array.isArray(data?.value) ? (data.value as string[]).join(', ') : '';
        setAllowed(list);
        setSavedAllowed(list);
      });
  }, []);

  const workspace = workspaces.find((w) => w.name === wsName) ?? workspaces.find((w) => w.health) ?? workspaces[0] ?? null;
  const health = workspace?.health ?? null;
  const online = !!workspace && Date.now() - new Date(workspace.last_seen_at).getTime() < ONLINE_MS;

  const byId = useMemo(() => new Map(configs.map((c) => [c.id, c])), [configs]);
  const entries = useMemo(() => {
    const list: Array<{ def: ConnectorDef; config: ConnectorConfig }> = CATALOG.map((def) => ({ def, config: byId.get(def.id) ?? defaultConfig(def.id) }));
    for (const c of configs) {
      const def = c.custom ? resolveDef(c) : null;
      if (def) list.push({ def, config: c });
    }
    return list;
  }, [configs, byId]);
  const categories = useMemo(() => [...new Set(entries.map((e) => e.def.category))], [entries]);
  const shown = entries.filter((e) => category === 'all' || e.def.category === category);
  const open = entries.find((e) => e.def.id === openId) ?? null;
  const activeCount = entries.filter((e) => e.config.enabled).length;

  async function save(id: string, patch: Partial<ConnectorConfig>) {
    const current = byId.get(id) ?? defaultConfig(id);
    const next = { ...current, ...patch };
    setConfigs((all) => [next, ...all.filter((c) => c.id !== id)]);
    const { error: err } = await getSupabase()
      .from('connectors')
      .upsert({ id, enabled: next.enabled, policy: next.policy, allowed_tools: next.allowed_tools, agents: next.agents, custom: next.custom });
    if (err) {
      setConfigs((all) => [current, ...all.filter((c) => c.id !== id)]);
      if (missingTable(err.message)) setNeedsMigration(true);
      else setError(err.message);
    }
  }

  async function remove(id: string) {
    setOpenId(null);
    setConfigs((all) => all.filter((c) => c.id !== id));
    const { error: err } = await getSupabase().from('connectors').delete().eq('id', id);
    if (err) setError(err.message);
  }

  async function saveAllowed() {
    const list = splitList(allowed);
    const text = list.join(', ');
    setAllowed(text);
    if (text === savedAllowed) return;
    const { error: err } = await getSupabase().from('settings').upsert({ key: 'allowed_tools', value: list });
    if (err) setError(missingTable(err.message) ? 'Applique la migration 0011_connectors.sql pour enregistrer ce réglage.' : err.message);
    else setSavedAllowed(text);
  }

  const gh = health?.gh;
  const status: Array<{ icon: typeof Server; title: string; value: ReactNode; ok: boolean | null; hint?: string }> = [
    {
      icon: Activity,
      title: 'Worker',
      value: workspace ? (online ? 'En ligne' : `Hors ligne · vu ${ago(workspace.last_seen_at)}`) : 'Jamais vu',
      ok: online,
      hint: health ? `Node ${health.node}` : undefined,
    },
    { icon: Cpu, title: 'Claude Code', value: health ? (health.claude ?? 'Introuvable') : '—', ok: health ? !!health.claude : null },
    {
      icon: GitPullRequest,
      title: 'GitHub CLI',
      value: !gh ? '—' : !gh.installed ? 'Non installée' : gh.logged_in ? `Connecté${gh.account ? ` · ${gh.account}` : ''}` : 'Non connecté',
      ok: gh ? gh.installed && gh.logged_in : null,
      hint: gh && gh.installed && !gh.logged_in ? 'gh auth login' : gh && !gh.installed ? 'Requise pour les PR des tickets' : undefined,
    },
    {
      icon: Brain,
      title: 'Ruflo',
      value: !health ? '—' : health.ruflo.initialized ? (health.ruflo.memory ? 'Initialisé · mémoire active' : 'Initialisé') : 'Non initialisé',
      ok: health ? health.ruflo.initialized : null,
      hint: health && !health.ruflo.initialized ? 'npx ruflo@latest init' : undefined,
    },
    {
      icon: Server,
      title: 'MCP du projet',
      value: !health ? '—' : health.project_mcp.length > 0 ? health.project_mcp.join(', ') : 'Aucun (.mcp.json)',
      ok: health ? true : null,
    },
  ];

  return (
    <div className="cx">
      {needsMigration && (
        <p className="cx-warn">
          Les tables des connecteurs n’existent pas encore : exécute <code>supabase/migrations/0011_connectors.sql</code> dans le SQL Editor de Supabase, puis <code>notify pgrst, &apos;reload schema&apos;;</code>
        </p>
      )}
      {error && <p className="error small">{error}</p>}

      <section className="cx-section">
        <div className="cx-section-head">
          <h2>État du système</h2>
          {workspaces.length > 1 && (
            <div className="chips">
              {workspaces.map((w) => (
                <button key={w.name} className={`chip ${w.name === workspace?.name ? 'active' : ''}`} onClick={() => setWsName(w.name)}>
                  {w.name}
                </button>
              ))}
            </div>
          )}
          {health && <span className="muted small">Vérifié {ago(health.checked_at)}</span>}
        </div>
        <div className="cx-status">
          {status.map(({ icon: Icon, title, value, ok, hint }) => (
            <div key={title} className="float-card cx-stat">
              <div className="cx-stat-head">
                <Icon size={16} strokeWidth={2} />
                <span>{title}</span>
                <span className={`cx-dot ${ok === null ? '' : ok ? 'ok' : 'ko'}`} />
              </div>
              <strong>{value}</strong>
              {hint && <code className="cx-hint">{hint}</code>}
            </div>
          ))}
        </div>
        {!health && workspace && <p className="muted small">Le worker publiera son état à son prochain démarrage (après la migration 0011).</p>}
      </section>

      <section className="cx-section">
        <div className="cx-section-head">
          <h2>Connecteurs · {activeCount} activé{activeCount > 1 ? 's' : ''}</h2>
          <div className="chips">
            <button className={`chip ${category === 'all' ? 'active' : ''}`} onClick={() => setCategory('all')}>
              Tous
            </button>
            {categories.map((c) => (
              <button key={c} className={`chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
          <button className="primary-btn small cx-add" onClick={() => setAdding(true)}>
            <Plus size={14} strokeWidth={2.4} /> Serveur MCP
          </button>
        </div>
        <div className="cx-grid">
          {shown.map(({ def, config }) => (
            <article key={def.id} className={`float-card cx-card ${config.enabled ? 'on' : ''}`} onClick={() => setOpenId(def.id)}>
              <div className="cx-card-head">
                <ConnectorIcon def={def} />
                <label className="cx-switch" onClick={(e) => e.stopPropagation()} title={config.enabled ? 'Désactiver' : 'Activer'}>
                  <input type="checkbox" checked={config.enabled} onChange={(e) => void save(def.id, { enabled: e.target.checked })} aria-label={`Activer ${def.name}`} />
                  <span aria-hidden="true" />
                </label>
              </div>
              <div>
                <h3>{def.name}</h3>
                <p className="muted small">{def.description}</p>
              </div>
              <div className="cx-card-foot">
                <Badge {...connectorState(def, config, health)} small />
                {config.enabled && config.policy === 'allow' && <span className="cx-tag">Toujours autorisé</span>}
                {config.enabled && config.agents && config.agents.length > 0 && (
                  <span className="cx-tag">
                    {config.agents.length} agent{config.agents.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="cx-section">
        <div className="float-card cx-allowed">
          <div className="cx-stat-head">
            <ShieldCheck size={16} strokeWidth={2} />
            <span>Outils toujours autorisés</span>
          </div>
          <p className="muted small">
            Pour toutes les missions, en plus de <code>MARIA_ALLOWED_TOOLS</code> du worker. Exemples : <code>Read</code>, <code>Edit</code>, <code>Bash(npm test:*)</code>,{' '}
            <code>mcp__github__get_file_contents</code>.
          </p>
          <div className="cx-allowed-row">
            <Terminal size={15} strokeWidth={2} />
            <input value={allowed} onChange={(e) => setAllowed(e.target.value)} onBlur={() => void saveAllowed()} onKeyDown={(e) => e.key === 'Enter' && void saveAllowed()} placeholder="Read, Glob, Grep, Bash(git log:*)" />
          </div>
          {allowed !== savedAllowed && <span className="muted small">Entrée ou clic ailleurs pour enregistrer.</span>}
        </div>
      </section>

      {open && (
        <ConnectorDrawer
          def={open.def}
          config={open.config}
          health={health}
          agents={agents}
          onChange={(patch) => void save(open.def.id, patch)}
          onDelete={open.config.custom ? () => void remove(open.def.id) : undefined}
          onClose={() => setOpenId(null)}
        />
      )}

      {adding && (
        <CustomDialog
          taken={entries.map((e) => e.def.id)}
          onClose={() => setAdding(false)}
          onCreate={(config) => {
            setAdding(false);
            void save(config.id, config).then(() => setOpenId(config.id));
          }}
        />
      )}
    </div>
  );
}

function CustomDialog({ taken, onClose, onCreate }: { taken: string[]; onClose: () => void; onCreate: (config: ConnectorConfig) => void }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('npx');
  const [args, setArgs] = useState('');
  const [env, setEnv] = useState('');

  const idError = !id ? null : !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || id === 'maria' ? 'minuscules, chiffres et tirets' : taken.includes(id) ? 'déjà utilisé' : null;
  const envList = splitList(env).map((v) => v.toUpperCase());
  const envError = envList.some((v) => !/^[A-Z_][A-Z0-9_]*$/.test(v)) ? 'Noms de variables : lettres, chiffres et _' : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!id || idError || envError || !command.trim()) return;
    onCreate({
      ...defaultConfig(id),
      enabled: true,
      custom: { name: name.trim() || id, description: '', command: command.trim(), args: args.trim() ? args.trim().split(/\s+/) : [], env: envList },
    });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="mcp-dialog" onClick={onClose}>
      <form className="card modal team-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 id="mcp-dialog">Serveur MCP personnalisé</h2>
        <div className="tk-dialog-grid">
          <label className="field">
            Identifiant {idError && <span className="error small">({idError})</span>}
            <input autoFocus value={id} onChange={(e) => setId(e.target.value.toLowerCase())} placeholder="sentry" maxLength={40} />
          </label>
          <label className="field">
            Nom affiché
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sentry" maxLength={60} />
          </label>
        </div>
        <label className="field">
          Commande
          <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
        </label>
        <label className="field">
          Arguments (séparés par des espaces ; ${'{'}VAR{'}'} = variable du worker)
          <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @sentry/mcp-server" />
        </label>
        <label className="field">
          Variables d’environnement requises {envError && <span className="error small">({envError})</span>}
          <input value={env} onChange={(e) => setEnv(e.target.value)} placeholder="SENTRY_ACCESS_TOKEN" />
        </label>
        <p className="muted small">Seuls les noms des variables sont enregistrés ; leurs valeurs vont dans le .env.local du worker.</p>
        <div className="row modal-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            Annuler
          </button>
          <button className="primary-btn small" disabled={!id || !!idError || !!envError || !command.trim()}>
            Ajouter
          </button>
        </div>
      </form>
    </div>
  );
}
