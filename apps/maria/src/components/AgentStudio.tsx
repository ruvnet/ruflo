'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, FileCode2, Loader2, Play, Save, Sparkles, Trash2 } from 'lucide-react';
import { AGENT_COLORS, AGENT_NAME, MODELS, TOOL_GROUPS, agentFileName, serializeAgent, type AgentDef, type AgentFile, type AgentOp } from '@/lib/agent-def';
import { AGENT_TEMPLATES } from '@/lib/agent-templates';
import { mentionName } from '@/lib/mentions';
import { getSupabase } from '@/lib/supabase';
import type { Workspace } from '@/lib/types';
import { AgentAvatar } from './AgentAvatar';
import { AgentConnectors } from './AgentConnectors';

const ONLINE_MS = 90_000;
const OP_TIMEOUT_MS = 60_000;
const KNOWN_TOOLS = new Set(TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.id)));

const EMPTY: AgentDef = { name: '', description: '', tools: null, model: null, color: 'purple', body: '' };

function missingTable(message: string): boolean {
  return /does not exist|Could not find the table|schema cache/i.test(message);
}

function sameDef(a: AgentDef, b: AgentDef): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface Props {
  workspaces: Workspace[];
  /** Agent modifié ; null = création. */
  name: string | null;
  onSaved: (name: string) => void;
  onDeleted: () => void;
  onTest: (name: string) => void;
}

/** Atelier : crée ou modifie un agent, enregistré par le worker dans .claude/agents du dossier. */
export function AgentStudio({ workspaces, name, onSaved, onDeleted, onTest }: Props) {
  const [workspace, setWorkspace] = useState(workspaces[0]?.name ?? '');
  const [file, setFile] = useState<AgentFile | null>(null);
  const [def, setDef] = useState<AgentDef>(EMPTY);
  const [initial, setInitial] = useState<AgentDef>(EMPTY);
  const [extraTools, setExtraTools] = useState('');
  const [loading, setLoading] = useState(!!name);
  const [busy, setBusy] = useState<null | 'save' | 'delete'>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [showFile, setShowFile] = useState(false);

  // Chargement de la définition existante (dans le premier dossier qui la contient).
  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    getSupabase()
      .from('agent_files')
      .select('*')
      .eq('name', name)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        setLoading(false);
        if (err) {
          if (missingTable(err.message)) setNeedsMigration(true);
          else setError(err.message);
          return;
        }
        const rows = (data as AgentFile[]).sort((a, b) => Number(b.scope === 'project') - Number(a.scope === 'project'));
        const row = rows.find((r) => r.workspace === workspace) ?? rows[0] ?? null;
        setFile(row);
        if (row) {
          setWorkspace(row.workspace);
          const loaded: AgentDef = { name: row.name, description: row.description, tools: row.tools, model: row.model, color: row.color, body: row.body };
          setDef(loaded);
          setInitial(loaded);
          setExtraTools((row.tools ?? []).filter((t) => !KNOWN_TOOLS.has(t)).join(', '));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  const ws = workspaces.find((w) => w.name === workspace) ?? null;
  const online = !!ws && Date.now() - new Date(ws.last_seen_at).getTime() < ONLINE_MS;
  const builtin = !!name && !loading && !file && !needsMigration;
  const readOnlyScope = file?.scope === 'user';
  const nameError = def.name && !AGENT_NAME.test(def.name.trim()) ? 'Lettres, chiffres, espaces, - et _' : null;
  const dirty = !sameDef(def, initial);
  const canSave = !!workspace && !!def.name.trim() && !nameError && !!def.description.trim() && !!def.body.trim() && (dirty || !name) && !busy;
  const preview = useMemo(() => serializeAgent({ ...def, name: def.name.trim() || 'mon-agent' }), [def]);
  const path = file?.scope === 'project' ? file.path : `.claude/agents/${agentFileName(def.name || 'mon-agent')}`;

  const set = (patch: Partial<AgentDef>) => {
    setSaved(false);
    setDef((d) => ({ ...d, ...patch }));
  };

  function toggleTool(id: string) {
    const current = def.tools ?? [];
    set({ tools: current.includes(id) ? current.filter((t) => t !== id) : [...current, id] });
  }

  function applyExtraTools(text: string) {
    const extra = text.split(',').map((t) => t.trim()).filter(Boolean);
    const known = (def.tools ?? []).filter((t) => KNOWN_TOOLS.has(t));
    set({ tools: [...known, ...extra] });
  }

  function applyTemplate(template: Omit<AgentDef, 'name'>) {
    if (def.body.trim() && !window.confirm('Remplacer la description, les outils et les instructions actuels ?')) return;
    set({ ...template, name: def.name });
    setExtraTools((template.tools ?? []).filter((t) => !KNOWN_TOOLS.has(t)).join(', '));
  }

  /** Dépose la demande puis attend que le worker l'applique. */
  async function request(op: 'save' | 'delete'): Promise<boolean> {
    setBusy(op);
    setError(null);
    const content: AgentDef | null = op === 'save' ? { ...def, name: def.name.trim(), description: def.description.trim() } : null;
    const { data, error: err } = await getSupabase()
      .from('agent_ops')
      .insert({ workspace, op, original_name: file?.name ?? null, content })
      .select('id')
      .single();
    if (err) {
      setBusy(null);
      if (missingTable(err.message)) setNeedsMigration(true);
      else setError(err.message);
      return false;
    }
    const id = (data as { id: string }).id;
    const started = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 1200));
      const { data: row } = await getSupabase().from('agent_ops').select('status, error').eq('id', id).single();
      const status = row as Pick<AgentOp, 'status' | 'error'> | null;
      if (status?.status === 'done') break;
      if (status?.status === 'error') {
        setBusy(null);
        setError(status.error ?? 'Le worker a refusé la demande.');
        return false;
      }
      if (Date.now() - started > OP_TIMEOUT_MS) {
        setBusy(null);
        setError('Le worker n’a pas encore traité la demande : elle sera appliquée dès qu’il sera en ligne.');
        return false;
      }
    }
    setBusy(null);
    return true;
  }

  async function save() {
    if (await request('save')) {
      setInitial(def);
      setSaved(true);
      onSaved(def.name.trim());
    }
  }

  async function remove() {
    if (!window.confirm(`Supprimer l’agent ${def.name} ? Le fichier ${path} sera effacé.`)) return;
    if (await request('delete')) onDeleted();
  }

  if (loading) return <p className="muted">Chargement de l’agent…</p>;

  return (
    <div className="as">
      {needsMigration && (
        <p className="cx-warn">
          L’atelier a besoin de la migration <code>supabase/migrations/0012_agent_studio.sql</code> : exécute-la dans le SQL Editor de Supabase, puis{' '}
          <code>notify pgrst, &apos;reload schema&apos;;</code> et redémarre le worker.
        </p>
      )}
      {builtin && (
        <p className="cx-warn">
          « {name} » est un agent intégré à Claude Code : il n’a pas de fichier modifiable. Tu peux créer ton propre agent à partir d’un modèle ci-dessous.
        </p>
      )}
      {readOnlyScope && (
        <p className="cx-warn">
          Cet agent est défini dans <code>{file?.path}</code> (tous tes projets). L’enregistrer crée une copie dans le dossier <strong>{workspace}</strong>, qui prend le dessus.
        </p>
      )}

      <div className="as-layout">
        <div className="as-form">
          <section className="float-card as-section">
            <h3>Identité</h3>
            <div className="as-row">
              <label className="field">
                Nom {nameError && <span className="error small">({nameError})</span>}
                <input value={def.name} onChange={(e) => set({ name: e.target.value })} placeholder="security-reviewer" maxLength={64} />
              </label>
              <label className="field">
                Dossier
                <select value={workspace} onChange={(e) => setWorkspace(e.target.value)} disabled={!!file}>
                  {workspaces.map((w) => (
                    <option key={w.name} value={w.name}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              Quand l’utiliser ? <span className="muted small">Claude Code lit cette description pour choisir l’agent.</span>
              <textarea rows={2} value={def.description} onChange={(e) => set({ description: e.target.value })} placeholder="Relit le code modifié (bugs, sécurité). À utiliser avant de fusionner." />
            </label>
            <div className="as-row">
              <div className="field">
                Modèle
                <div className="as-seg">
                  {MODELS.map((m) => (
                    <button key={m.label} type="button" className={def.model === m.id ? 'active' : ''} onClick={() => set({ model: m.id })} title={m.hint}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                Couleur
                <div className="as-colors">
                  {AGENT_COLORS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={def.color === c.id ? 'active' : ''}
                      style={{ background: c.hex }}
                      onClick={() => set({ color: c.id })}
                      aria-label={c.id}
                      title={c.id}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="float-card as-section">
            <div className="as-section-head">
              <h3>Outils</h3>
              <label className="cx-switch">
                <input type="checkbox" checked={def.tools === null} onChange={(e) => set({ tools: e.target.checked ? null : ['Read', 'Glob', 'Grep'] })} />
                <span aria-hidden="true" />
                Tous les outils de la mission
              </label>
            </div>
            {def.tools === null ? (
              <p className="muted small">L’agent hérite de tous les outils, connecteurs compris. Désactive pour le limiter (recommandé pour un relecteur, par exemple).</p>
            ) : (
              <>
                <div className="as-tools">
                  {TOOL_GROUPS.map((g) => (
                    <div key={g.label} className="as-tool-group">
                      <span className="muted small">{g.label}</span>
                      {g.tools.map((t) => (
                        <button key={t.id} type="button" className={`as-tool ${def.tools?.includes(t.id) ? 'active' : ''}`} onClick={() => toggleTool(t.id)} title={t.hint}>
                          {def.tools?.includes(t.id) && <Check size={12} strokeWidth={3} />}
                          {t.id}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
                <label className="field">
                  Autres outils <span className="muted small">ex. Bash(npm test:*), mcp__github</span>
                  <input
                    value={extraTools}
                    onChange={(e) => setExtraTools(e.target.value)}
                    onBlur={() => applyExtraTools(extraTools)}
                    placeholder="Bash(npm test:*), mcp__github"
                  />
                </label>
              </>
            )}
          </section>

          <AgentConnectors agentName={file?.name ?? null} />

          <section className="float-card as-section">
            <div className="as-section-head">
              <h3>Instructions</h3>
              <div className="chips">
                <Sparkles size={14} strokeWidth={2} className="as-spark" />
                {AGENT_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="chip"
                    onClick={() => applyTemplate(t.def)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              className="as-body"
              rows={16}
              value={def.body}
              onChange={(e) => set({ body: e.target.value })}
              placeholder={'Tu es un expert en sécurité applicative.\n\n## Méthode\n1. …\n\n## Compte rendu\n…'}
            />
          </section>
        </div>

        <aside className="float-col as-side">
          <div className="float-card as-preview">
            <div className="as-preview-head">
              <AgentAvatar name={def.name.trim() || 'agent'} size={52} />
              <div>
                <strong>{def.name.trim() || 'Nouvel agent'}</strong>
                <code>@{mentionName(def.name.trim() || 'agent')}</code>
              </div>
              <span className="as-color-dot" style={{ background: AGENT_COLORS.find((c) => c.id === def.color)?.hex ?? 'var(--muted)', color: AGENT_COLORS.find((c) => c.id === def.color)?.hex }} />
            </div>
            <p className="muted small">{def.description || 'Décris quand utiliser cet agent.'}</p>
            <div className="as-tags">
              <span className="cx-tag">{MODELS.find((m) => m.id === def.model)?.label ?? def.model}</span>
              <span className="cx-tag">{def.tools === null ? 'Tous les outils' : `${def.tools.length} outil${def.tools.length > 1 ? 's' : ''}`}</span>
              <span className="cx-tag">{workspace || '—'}</span>
            </div>
            {!online && ws && <p className="as-offline small">Worker hors ligne : la demande attendra son retour.</p>}
            {error && <p className="error small">{error}</p>}
            {saved && !dirty && <p className="as-ok small">Enregistré dans {path}</p>}
            <div className="as-actions">
              <button className="primary-btn small" onClick={() => void save()} disabled={!canSave}>
                {busy === 'save' ? <Loader2 size={14} className="spin" /> : <Save size={14} strokeWidth={2.2} />}
                {busy === 'save' ? 'Enregistrement…' : file ? 'Enregistrer' : 'Créer l’agent'}
              </button>
              {file && !dirty && (
                <button className="ghost-btn" onClick={() => onTest(file.name)}>
                  <Play size={14} strokeWidth={2.2} /> Tester
                </button>
              )}
              {file?.scope === 'project' && (
                <button className="ghost-btn danger-text" onClick={() => void remove()} disabled={!!busy} title="Supprimer l’agent">
                  {busy === 'delete' ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} strokeWidth={2} />}
                </button>
              )}
            </div>
          </div>

          <div className="float-card as-file">
            <button className="as-file-toggle" onClick={() => setShowFile((v) => !v)}>
              <FileCode2 size={15} strokeWidth={2} />
              <code>{path}</code>
              <span className="muted small">{showFile ? 'Masquer' : 'Voir le fichier'}</span>
            </button>
            {showFile && <pre className="as-file-pre">{preview}</pre>}
          </div>
        </aside>
      </div>
    </div>
  );
}
