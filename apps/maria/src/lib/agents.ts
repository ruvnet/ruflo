import { describeTool } from './feed';
import type { MissionEvent, ToolResultBlock, ToolUseBlock } from './types';

export type AgentStatus = 'running' | 'done' | 'error' | 'interrupted';

/** Sous-agent Claude Code lancé via l'outil Agent (ou Task, son ancien nom). */
export interface SubAgentRun {
  id: string;
  type: string;
  description: string;
  status: AgentStatus;
  actions: number;
  lastAction: string | null;
  /** Agent qui l'a lancé (null = agent principal). */
  parentId: string | null;
}

export interface AgentsSummary {
  mainActions: number;
  subAgents: SubAgentRun[];
  /** Appels aux outils MCP de Ruflo (swarm_init, agent_spawn…), par nom court. */
  rufloCalls: Record<string, number>;
}

const AGENT_TOOLS = new Set(['Agent', 'Task']);
const RUFLO_PREFIX = 'mcp__claude-flow__';

function resultText(block: ToolResultBlock): string {
  if (typeof block.content === 'string') return block.content;
  return (block.content ?? []).map((c) => c.text ?? '').join(' ');
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Reconstitue les agents d'une mission à partir des événements stream-json :
 * un appel Agent/Task ouvre un sous-agent, ses messages portent parent_tool_use_id,
 * et le tool_result correspondant le clôt.
 */
export function buildAgents(events: MissionEvent[], missionFinished: boolean): AgentsSummary {
  const runs = new Map<string, SubAgentRun>();
  const rufloCalls: Record<string, number> = {};
  let mainActions = 0;

  // Statut final annoncé par Claude Code (task_notification), qui fait foi même pour les agents asynchrones.
  const finalStatus = new Map<string, AgentStatus>();
  const background = new Set<string>();

  for (const { payload: e } of events) {
    if (e.type === 'system' && e.tool_use_id) {
      if (e.subtype === 'task_started' && e.is_backgrounded) background.add(e.tool_use_id);
      if (e.subtype === 'task_notification') {
        finalStatus.set(e.tool_use_id, e.status === 'completed' ? 'done' : e.status === 'failed' ? 'error' : 'interrupted');
      }
      if (e.subtype === 'task_progress') {
        const run = runs.get(e.tool_use_id);
        if (run && (e.usage?.tool_uses ?? 0) > run.actions) run.actions = e.usage?.tool_uses ?? run.actions;
      }
      continue;
    }
    const content = Array.isArray(e.message?.content) ? e.message.content : [];
    const owner = e.parent_tool_use_id ? runs.get(e.parent_tool_use_id) : undefined;

    if (e.type === 'assistant') {
      for (const block of content) {
        if (block.type !== 'tool_use') continue;
        const tool = block as ToolUseBlock;
        const input = tool.input ?? {};

        if (owner) {
          owner.actions++;
          owner.lastAction = `${tool.name} ${describeTool(tool.name, input)}`.trim();
        } else {
          mainActions++;
        }
        if (tool.name.startsWith(RUFLO_PREFIX)) {
          const short = tool.name.slice(RUFLO_PREFIX.length);
          rufloCalls[short] = (rufloCalls[short] ?? 0) + 1;
        }
        if (AGENT_TOOLS.has(tool.name)) {
          runs.set(tool.id, {
            id: tool.id,
            type: str(input.subagent_type) || 'general-purpose',
            description: str(input.description),
            status: 'running',
            actions: 0,
            lastAction: null,
            parentId: owner?.id ?? null,
          });
        }
      }
    } else if (e.type === 'user') {
      for (const block of content) {
        if (block.type !== 'tool_result') continue;
        const res = block as ToolResultBlock;
        const run = runs.get(res.tool_use_id);
        if (!run) continue;
        if (res.is_error) run.status = 'error';
        // Agent asynchrone : ce résultat signale seulement son lancement.
        else if (!background.has(run.id) && !resultText(res).includes('Async agent launched')) run.status = 'done';
      }
    }
  }

  for (const [id, status] of finalStatus) {
    const run = runs.get(id);
    if (run) run.status = status;
  }
  const subAgents = [...runs.values()];
  if (missionFinished) {
    for (const run of subAgents) if (run.status === 'running') run.status = 'interrupted';
  }
  return { mainActions, subAgents, rufloCalls };
}
