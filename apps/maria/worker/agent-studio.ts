// Atelier d'agents côté worker : publie les fichiers .claude/agents et applique les demandes de l'interface.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENT_NAME, agentFileName, parseAgentDef, serializeAgent, type AgentDef, type AgentOp } from '../src/lib/agent-def';
import type { Store } from './store';

export interface LocalAgentFile {
  scope: 'project' | 'user';
  absPath: string;
  /** Chemin affiché : relatif au dossier (projet) ou à ~ (utilisateur). */
  path: string;
  text: string;
  def: AgentDef;
  hash: string;
}

const MAX_BODY = 100_000;

function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join(e.parentPath, e.name));
}

function readScope(dir: string, scope: LocalAgentFile['scope'], base: string, prefix: string): LocalAgentFile[] {
  const out: LocalAgentFile[] = [];
  for (const absPath of markdownFiles(dir)) {
    try {
      const text = readFileSync(absPath, 'utf8');
      const def = parseAgentDef(text);
      if (!def) continue;
      out.push({ scope, absPath, path: `${prefix}${path.relative(base, absPath)}`, text, def, hash: createHash('sha1').update(text).digest('hex') });
    } catch {
      /* fichier illisible : ignoré */
    }
  }
  return out;
}

export function projectAgentsDir(cwd: string): string {
  return path.join(cwd, '.claude', 'agents');
}

/** Définitions visibles dans `cwd` ; celle du projet l'emporte sur celle de l'utilisateur. */
export function localAgentFiles(cwd: string): LocalAgentFile[] {
  const home = os.homedir();
  const byName = new Map<string, LocalAgentFile>();
  for (const f of readScope(path.join(home, '.claude', 'agents'), 'user', home, '~/')) byName.set(f.def.name, f);
  for (const f of readScope(projectAgentsDir(cwd), 'project', cwd, '')) byName.set(f.def.name, f);
  return [...byName.values()];
}

function validate(def: AgentDef | null): AgentDef {
  if (!def || typeof def !== 'object') throw new Error('Définition manquante.');
  const name = String(def.name ?? '').trim();
  if (!AGENT_NAME.test(name)) throw new Error('Nom invalide : lettres, chiffres, espaces, - et _ (64 caractères max).');
  const description = String(def.description ?? '').trim();
  if (!description) throw new Error('La description est obligatoire : Claude Code s’en sert pour choisir l’agent.');
  const body = String(def.body ?? '');
  if (!body.trim()) throw new Error('Les instructions de l’agent sont vides.');
  if (body.length > MAX_BODY) throw new Error('Instructions trop longues (100 000 caractères max).');
  const tools = Array.isArray(def.tools) ? def.tools.map((t) => String(t).trim()).filter(Boolean) : null;
  if (tools?.some((t) => !/^[\w*().:/ -]+$/.test(t) || t.length > 120)) throw new Error('Nom d’outil invalide.');
  const simple = (v: unknown) => {
    const s = v == null ? '' : String(v).trim();
    if (s && !/^#?[\w.-]{1,60}$/.test(s)) throw new Error(`Valeur invalide : ${s}`);
    return s || null;
  };
  return { name, description, tools: tools && tools.length > 0 ? tools : null, model: simple(def.model), color: simple(def.color), body };
}

/** Le fichier visé doit rester dans <dossier>/.claude/agents. */
function insideAgentsDir(cwd: string, target: string): string {
  const root = path.resolve(projectAgentsDir(cwd));
  const abs = path.resolve(target);
  if (!abs.startsWith(root + path.sep)) throw new Error('Chemin refusé : hors de .claude/agents.');
  return abs;
}

/** Applique une demande ; renvoie un résumé lisible pour le journal. */
export function applyAgentOp(op: AgentOp, cwd: string): string {
  const files = localAgentFiles(cwd);
  const project = new Map(files.filter((f) => f.scope === 'project').map((f) => [f.def.name, f]));
  const any = new Map(files.map((f) => [f.def.name, f]));

  if (op.op === 'delete') {
    const target = op.original_name ? project.get(op.original_name) : undefined;
    if (!target) throw new Error('Seuls les agents du dossier (.claude/agents du projet) peuvent être supprimés.');
    unlinkSync(insideAgentsDir(cwd, target.absPath));
    return `agent ${target.def.name} supprimé (${target.path})`;
  }

  const def = validate(op.content);
  const original = op.original_name ? project.get(op.original_name) : undefined;
  const clash = project.get(def.name);
  if (clash && clash !== original) throw new Error(`Un agent « ${def.name} » existe déjà dans ce dossier.`);

  let target: string;
  if (original) {
    target = original.absPath;
  } else {
    target = path.join(projectAgentsDir(cwd), agentFileName(def.name));
    if (existsSync(target)) throw new Error(`Le fichier ${path.relative(cwd, target)} existe déjà.`);
  }
  const abs = insideAgentsDir(cwd, target);
  // Les clés propres à l'agent d'origine (projet ou utilisateur) sont conservées.
  const previous = original?.text ?? (op.original_name ? any.get(op.original_name)?.text : undefined);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, serializeAgent(def, previous), 'utf8');
  return `agent ${def.name} ${original ? 'modifié' : 'créé'} (${path.relative(cwd, abs)})`;
}

/** Recopie les définitions du dossier dans maria.agent_files (seulement ce qui a changé). */
export async function syncAgentFiles(store: Store, workspace: string, cwd: string): Promise<void> {
  if (!store.agentStudio) return;
  const index = await store.agentFilesIndex(workspace);
  if (!index) return;
  const files = localAgentFiles(cwd);
  const changed = files.filter((f) => index.get(f.def.name) !== f.hash);
  if (changed.length > 0) {
    await store.upsertAgentFiles(changed.map((f) => ({ workspace, scope: f.scope, path: f.path, hash: f.hash, ...f.def })));
  }
  const names = new Set(files.map((f) => f.def.name));
  const gone = [...index.keys()].filter((n) => !names.has(n));
  if (gone.length > 0) await store.deleteAgentFiles(workspace, gone);
}
