import type { MissionEvent, StreamEvent, ToolResultBlock, ToolUseBlock } from './types';

export type FeedItem = { key: string; at: string } & (
  | { kind: 'info'; level: 'info' | 'warn' | 'error'; text: string }
  | { kind: 'text'; agent: string; text: string }
  | { kind: 'tool'; agent: string; tool: string; detail: string; id: string }
  | { kind: 'tool_result'; agent: string; isError: boolean; text: string; toolUseId: string }
  | { kind: 'done'; isError: boolean; text: string }
);

const MAIN_AGENT = 'MarIA';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** Résumé lisible de l'appel d'outil, ex. « npm test » pour Bash ou le chemin pour Edit. */
export function describeTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash':
      return str(input.command);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return str(input.file_path);
    case 'NotebookEdit':
      return str(input.notebook_path);
    case 'Grep':
    case 'Glob':
      return `${str(input.pattern)}${input.path ? ` dans ${str(input.path)}` : ''}`;
    case 'WebFetch':
      return str(input.url);
    case 'WebSearch':
      return str(input.query);
    case 'Task':
    case 'Agent':
      return `${str(input.subagent_type) || 'agent'} : ${str(input.description)}`;
    default:
      return truncate(JSON.stringify(input), 160);
  }
}

function resultText(block: ToolResultBlock): string {
  if (typeof block.content === 'string') return block.content;
  return (block.content ?? []).map((c) => c.text ?? '').join(' ');
}

/**
 * Transforme les événements bruts en lignes de fil d'activité.
 * Les messages émis par un sous-agent portent parent_tool_use_id : on les attribue
 * au subagent_type de l'appel Task/Agent correspondant (« qui fait quoi »).
 */
export function buildFeed(events: MissionEvent[]): FeedItem[] {
  const agentByToolUse = new Map<string, string>();
  const resultEvents: Array<{ item: Extract<FeedItem, { kind: 'done' }>; event: StreamEvent }> = [];
  let sessionShown = false;
  const items: FeedItem[] = [];

  for (const { id, payload: e, created_at: at } of events) {
    const agent = (e.parent_tool_use_id && agentByToolUse.get(e.parent_tool_use_id)) || MAIN_AGENT;
    const content = Array.isArray(e.message?.content) ? e.message.content : [];

    switch (e.type) {
      case 'maria':
        items.push({ key: `${id}`, at, kind: 'info', level: e.level ?? 'info', text: e.text ?? '' });
        break;
      case 'system':
        // Les commandes lancées en arrière-plan émettent aussi task_notification : on ne garde que les sous-agents.
        if (e.subtype === 'task_notification' && e.tool_use_id && agentByToolUse.has(e.tool_use_id)) {
          const name = agentByToolUse.get(e.tool_use_id);
          const label = e.status === 'completed' ? 'a terminé' : e.status === 'failed' ? 'a échoué' : `s’est arrêté (${e.status ?? '?'})`;
          items.push({ key: `${id}`, at, kind: 'info', level: e.status === 'failed' ? 'error' : 'info', text: `Sous-agent ${name} ${label}.` });
        }
        // Avec des sous-agents asynchrones, Claude Code renvoie un init à chaque reprise : on n'affiche que le premier.
        if (e.subtype === 'init' && !sessionShown) {
          sessionShown = true;
          items.push({
            key: `${id}`,
            at,
            kind: 'info',
            level: 'info',
            text: `Session Claude Code ouverte${e.model ? ` — modèle ${e.model}` : ''}${e.tools ? `, ${e.tools.length} outils` : ''}`,
          });
        }
        break;
      case 'assistant':
        content.forEach((block, i) => {
          if (block.type === 'text') {
            const text = (block as { text: string }).text.trim();
            if (text) items.push({ key: `${id}-${i}`, at, kind: 'text', agent, text });
          } else if (block.type === 'tool_use') {
            const tool = block as ToolUseBlock;
            if ((tool.name === 'Task' || tool.name === 'Agent') && typeof tool.input?.subagent_type === 'string') {
              agentByToolUse.set(tool.id, tool.input.subagent_type);
            }
            items.push({ key: `${id}-${i}`, at, kind: 'tool', agent, tool: tool.name, detail: describeTool(tool.name, tool.input ?? {}), id: tool.id });
          }
        });
        break;
      case 'user':
        content.forEach((block, i) => {
          if (block.type !== 'tool_result') return;
          const res = block as ToolResultBlock;
          items.push({ key: `${id}-${i}`, at, kind: 'tool_result', agent, isError: !!res.is_error, text: truncate(resultText(res), 600), toolUseId: res.tool_use_id });
        });
        break;
      case 'result': {
        const denials = e.permission_denials ?? [];
        if (denials.length > 0) {
          const list = [...new Set(denials.map((d) => `${d.tool_name}: ${describeTool(d.tool_name, d.tool_input ?? {})}`))];
          items.push({
            key: `${id}-denials`,
            at,
            kind: 'info',
            level: 'warn',
            text: `${denials.length} action(s) refusée(s) (par toi, ou sans réponse dans le délai). Pour ne plus avoir à les valider, ajoute-les à MARIA_ALLOWED_TOOLS :\n${list.join('\n')}`,
          });
        }
        const item: Extract<FeedItem, { kind: 'done' }> = { key: `${id}`, at, kind: 'done', isError: !!e.is_error, text: summarizeResult(e, true) };
        resultEvents.push({ item, event: e });
        items.push(item);
        break;
      }
    }
  }
  // Avec des sous-agents asynchrones, Claude Code émet un résultat par tour : seul le dernier clôt la mission.
  // Le coût est cumulé depuis le début : on ne l'affiche que sur la ligne finale.
  for (const { item, event } of resultEvents.slice(0, -1)) {
    item.text = summarizeResult(event, false).replace(/^(Terminé|Échec)/, 'Tour terminé');
  }
  return items;
}

function summarizeResult(e: StreamEvent, withCost: boolean): string {
  const parts: string[] = [];
  if (e.duration_ms != null) parts.push(`${Math.round(e.duration_ms / 1000)} s`);
  if (e.num_turns != null) parts.push(`${e.num_turns} tours`);
  if (withCost && e.total_cost_usd != null) parts.push(`$${e.total_cost_usd.toFixed(4)}`);
  return `${e.is_error ? 'Échec' : 'Terminé'}${parts.length ? ` — ${parts.join(' · ')}` : ''}`;
}
