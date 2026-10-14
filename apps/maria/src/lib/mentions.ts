// Mentions d'agents dans une mission : « @architect @coder Ajoute… » limite la mission à ces sous-agents, dans cet ordre.

/** Agent disponible dans un dossier de travail (.claude/agents ou agent intégré à Claude Code). */
export interface AgentInfo {
  name: string;
  description: string;
}

const MENTION = /(^|[\s(,;])@([A-Za-z0-9][\w-]*)/g;

/** Forme mentionnable d'un nom d'agent : « Benchmark Suite » s'écrit @Benchmark-Suite. */
export function mentionName(name: string): string {
  return name.trim().replace(/\s+/g, '-');
}

/** Agents mentionnés (noms réels), dans l'ordre de première apparition ; les noms inconnus sont renvoyés à part. */
export function parseMentions(prompt: string, known: readonly string[]): { agents: string[]; unknown: string[] } {
  const byLower = new Map(known.map((name) => [mentionName(name).toLowerCase(), name]));
  const agents: string[] = [];
  const unknown: string[] = [];
  for (const match of prompt.matchAll(MENTION)) {
    const name = byLower.get(match[2].toLowerCase());
    const bucket = name ? agents : unknown;
    const value = name ?? match[2];
    if (!bucket.includes(value)) bucket.push(value);
  }
  return { agents, unknown };
}

/** Mention en cours de frappe juste avant le curseur (« @cod| »), pour l'autocomplétion. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|[\s(,;])@([\w-]*)$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[2].length - 1, query: match[2] };
}
