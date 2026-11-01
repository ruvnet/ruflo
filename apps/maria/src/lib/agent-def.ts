// Définition d'un agent Claude Code (fichier .claude/agents/<nom>.md : en-tête YAML + instructions).
// Partagé par l'atelier d'agents (aperçu du fichier) et le worker (lecture et écriture des fichiers).

export interface AgentDef {
  name: string;
  description: string;
  /** null = tous les outils de la mission (champ `tools` absent). */
  tools: string[] | null;
  /** null = modèle de la mission (`inherit`). */
  model: string | null;
  color: string | null;
  body: string;
}

/** Ligne de maria.agent_files, publiée par le worker. */
export interface AgentFile extends AgentDef {
  workspace: string;
  scope: 'project' | 'user';
  path: string;
  hash: string;
  updated_at: string;
}

export interface AgentOp {
  id: string;
  workspace: string;
  op: 'save' | 'delete';
  original_name: string | null;
  content: AgentDef | null;
  status: 'pending' | 'done' | 'error';
  error: string | null;
  created_at: string;
}

export const AGENT_NAME = /^[A-Za-z0-9][\w -]{0,63}$/;

export const TOOL_GROUPS: Array<{ label: string; tools: Array<{ id: string; hint: string }> }> = [
  { label: 'Lecture', tools: [{ id: 'Read', hint: 'Lire un fichier' }, { id: 'Glob', hint: 'Trouver des fichiers' }, { id: 'Grep', hint: 'Chercher dans le code' }] },
  { label: 'Écriture', tools: [{ id: 'Edit', hint: 'Modifier un fichier' }, { id: 'Write', hint: 'Créer un fichier' }, { id: 'NotebookEdit', hint: 'Modifier un notebook' }] },
  { label: 'Exécution', tools: [{ id: 'Bash', hint: 'Lancer des commandes' }] },
  { label: 'Web', tools: [{ id: 'WebFetch', hint: 'Lire une page web' }, { id: 'WebSearch', hint: 'Chercher sur le web' }] },
  { label: 'Équipe', tools: [{ id: 'Agent', hint: 'Déléguer à un autre agent' }, { id: 'TodoWrite', hint: 'Liste de tâches' }] },
];

export const MODELS: Array<{ id: string | null; label: string; hint: string }> = [
  { id: null, label: 'Hérité', hint: 'Celui de la mission' },
  { id: 'haiku', label: 'Haiku', hint: 'Rapide et économique' },
  { id: 'sonnet', label: 'Sonnet', hint: 'Équilibré' },
  { id: 'opus', label: 'Opus', hint: 'Raisonnement poussé' },
];

/** Couleurs acceptées par Claude Code pour un sous-agent. */
export const AGENT_COLORS: Array<{ id: string; hex: string }> = [
  { id: 'purple', hex: '#a78bfa' },
  { id: 'blue', hex: '#60a5fa' },
  { id: 'cyan', hex: '#22d3ee' },
  { id: 'green', hex: '#4ade80' },
  { id: 'yellow', hex: '#facc15' },
  { id: 'orange', hex: '#fb923c' },
  { id: 'red', hex: '#fb7185' },
  { id: 'pink', hex: '#f472b6' },
];

const MANAGED = new Set(['name', 'description', 'tools', 'model', 'color']);

interface HeaderBlock {
  key: string | null;
  lines: string[];
}

/** Découpe l'en-tête YAML en blocs de premier niveau (une clé et ses lignes de suite). */
function headerBlocks(header: string): HeaderBlock[] {
  const blocks: HeaderBlock[] = [];
  for (const line of header.split(/\r?\n/)) {
    const key = /^([A-Za-z_][\w-]*):/.exec(line)?.[1];
    if (key) blocks.push({ key, lines: [line] });
    else if (blocks.length > 0) blocks[blocks.length - 1].lines.push(line);
    else blocks.push({ key: null, lines: [line] });
  }
  return blocks;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      return JSON.parse(v) as string;
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/** Valeur d'un bloc : scalaire, bloc littéral (| ou >) ou liste (« - a » ou [a, b]). */
function blockValue(block: HeaderBlock): string | string[] {
  const first = block.lines[0].slice(block.lines[0].indexOf(':') + 1).trim();
  const rest = block.lines.slice(1);
  if (/^[|>][+-]?$/.test(first)) {
    const kept = rest.filter((l, i) => l.trim() || i < rest.length - 1);
    const indent = Math.min(...kept.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length));
    const lines = kept.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
    return (first.startsWith('>') ? lines.join(' ').replace(/ {2,}/g, ' ') : lines.join('\n')).trim();
  }
  if (first.startsWith('[') && first.endsWith(']')) {
    return first.slice(1, -1).split(',').map(unquote).filter(Boolean);
  }
  if (!first && rest.some((l) => /^\s*-\s/.test(l))) {
    return rest.filter((l) => /^\s*-\s/.test(l)).map((l) => unquote(l.replace(/^\s*-\s/, ''))).filter(Boolean);
  }
  return unquote([first, ...rest.map((l) => l.trim())].join(' ').trim());
}

const HEADER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Lit une définition d'agent complète ; null si l'en-tête ou le nom est invalide. */
export function parseAgentDef(text: string): AgentDef | null {
  const m = HEADER.exec(text);
  if (!m) return null;
  const values = new Map<string, string | string[]>();
  for (const block of headerBlocks(m[1])) if (block.key && MANAGED.has(block.key)) values.set(block.key, blockValue(block));
  const str = (key: string) => {
    const v = values.get(key);
    return Array.isArray(v) ? v.join(', ') : (v ?? '');
  };
  const name = str('name');
  if (!AGENT_NAME.test(name)) return null;
  const rawTools = values.get('tools');
  const tools = rawTools === undefined ? null : (Array.isArray(rawTools) ? rawTools : rawTools.split(',')).map((t) => t.trim()).filter(Boolean);
  const model = str('model');
  return {
    name,
    description: str('description'),
    tools: tools && tools.length > 0 ? tools : null,
    model: model && model !== 'inherit' ? model : null,
    color: str('color') || null,
    body: text.slice(m[0].length).replace(/^\s*\n/, '').trimEnd(),
  };
}

function yamlScalar(value: string): string {
  return /^[A-Za-z0-9][\w .,()/@+*-]*$/.test(value) && !/:\s|\s#/.test(value) ? value : JSON.stringify(value);
}

/**
 * Écrit le fichier d'un agent. Les clés d'en-tête que MarIA ne gère pas (type, capabilities, hooks…
 * des agents Ruflo) sont recopiées telles quelles depuis `previous`.
 */
export function serializeAgent(def: AgentDef, previous?: string): string {
  const lines = [`name: ${yamlScalar(def.name.trim())}`, `description: ${yamlScalar(def.description.replace(/\s+/g, ' ').trim())}`];
  if (def.tools && def.tools.length > 0) lines.push(`tools: ${def.tools.join(', ')}`);
  if (def.model) lines.push(`model: ${yamlScalar(def.model)}`);
  if (def.color) lines.push(`color: ${yamlScalar(def.color)}`);
  const header = previous ? HEADER.exec(previous)?.[1] : undefined;
  if (header) {
    for (const block of headerBlocks(header)) if (block.key && !MANAGED.has(block.key)) lines.push(...block.lines);
  }
  return `---\n${lines.join('\n')}\n---\n\n${def.body.trim()}\n`;
}

/** Nom de fichier d'un nouvel agent : « Security Reviewer » → security-reviewer.md. */
export function agentFileName(name: string): string {
  return `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'}.md`;
}
