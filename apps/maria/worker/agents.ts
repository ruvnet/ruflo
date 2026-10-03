// Agents disponibles dans un dossier de travail : définitions .claude/agents (projet et utilisateur) + agents intégrés.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentInfo } from '../src/lib/mentions';

const BUILTIN: AgentInfo[] = [
  { name: 'general-purpose', description: 'Agent généraliste de Claude Code (recherche, tâches en plusieurs étapes)' },
  { name: 'Explore', description: 'Recherche en lecture seule dans le code (intégré à Claude Code)' },
  { name: 'Plan', description: "Conçoit un plan d'implémentation (intégré à Claude Code)" },
];
const MAX_DESCRIPTION = 160;

function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join(e.parentPath, e.name));
}

function unquote(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2');
}

/** Lit `name` et `description` dans l'en-tête YAML d'une définition d'agent. */
export function parseAgentFile(text: string): AgentInfo | null {
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!header) return null;
  const field = (key: string) => new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(header[1])?.[1];
  const name = unquote(field('name') ?? '');
  // Les espaces sont acceptés (« Benchmark Suite » se mentionne @Benchmark-Suite).
  if (!/^[A-Za-z0-9][\w -]*$/.test(name)) return null;
  const raw = unquote(field('description') ?? '');
  const description = /^[|>]/.test(raw) ? '' : raw;
  return { name, description: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION)}…` : description };
}

/** Agents utilisables dans `cwd` ; une définition du projet l'emporte sur celle de l'utilisateur et sur les intégrés. */
export function listAgents(cwd: string): AgentInfo[] {
  const byName = new Map<string, AgentInfo>();
  for (const agent of BUILTIN) byName.set(agent.name, agent);
  for (const dir of [path.join(os.homedir(), '.claude', 'agents'), path.join(cwd, '.claude', 'agents')]) {
    for (const file of markdownFiles(dir)) {
      try {
        const agent = parseAgentFile(readFileSync(file, 'utf8'));
        if (agent) byName.set(agent.name, agent);
      } catch {
        /* fichier illisible : ignoré */
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
