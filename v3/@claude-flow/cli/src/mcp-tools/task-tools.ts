/**
 * Task MCP Tools for CLI
 *
 * Tool definitions for task management with file persistence.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readRecordStore } from './record-store.js';
import { type MCPTool, getProjectCwd } from './types.js';
import { validateIdentifier, validateText } from './validate-input.js';

// Storage paths
const STORAGE_DIR = '.claude-flow';
const TASK_DIR = 'tasks';
const TASK_FILE = 'store.json';

export const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'cancelled'] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

// Spellings agents write for the same five states (seen in the wild: "complete").
const STATUS_ALIASES: Readonly<Record<string, TaskStatus>> = {
  complete: 'completed', done: 'completed', canceled: 'cancelled',
  running: 'in_progress', 'in-progress': 'in_progress', inprogress: 'in_progress',
};

/** The canonical status for a written one (trimmed, any case, known aliases), or null when it is none of the five. */
export function statusOf(value: unknown): TaskStatus | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if ((TASK_STATUSES as readonly string[]).includes(key)) return key as TaskStatus;
  return Object.hasOwn(STATUS_ALIASES, key) ? STATUS_ALIASES[key] : null;
}

interface TaskRecord {
  taskId: string;
  type: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: TaskStatus;
  progress: number;
  assignedTo: string[];
  tags: string[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result?: Record<string, unknown>;
}

interface TaskStore {
  tasks: Record<string, TaskRecord>;
  version: string;
}

function getTaskDir(): string {
  return join(getProjectCwd(), STORAGE_DIR, TASK_DIR);
}

function getTaskPath(): string {
  return join(getTaskDir(), TASK_FILE);
}

function ensureTaskDir(): void {
  const dir = getTaskDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadTaskStore(): TaskStore {
  return readRecordStore(getTaskPath(), 'tasks', () => ({ tasks: {}, version: '3.0.0' }));
}

function saveTaskStore(store: TaskStore): void {
  ensureTaskDir();
  writeFileSync(getTaskPath(), JSON.stringify(store, null, 2), 'utf-8');
}

type AgentRow = Record<string, unknown>;

/**
 * Apply an agent-state change to every store that holds the agent.
 *
 * `hive-mind_spawn` keeps its workers in `.claude-flow/agents.json`, not the
 * canonical `.claude-flow/agents/store.json` (#1916). Syncing only the
 * canonical store meant assigning a task to a hive worker never marked it
 * busy, and completing one never counted it: `hive-mind status` showed the
 * worker idle with 0 completed while its task sat in the queue.
 */
function updateAgents(agentIds: string[], mutate: (agent: AgentRow) => void): void {
  if (agentIds.length === 0) return;
  const paths = [
    join(getProjectCwd(), STORAGE_DIR, 'agents', 'store.json'),
    join(getProjectCwd(), STORAGE_DIR, 'agents.json'),
  ];
  for (const path of paths) {
    try {
      if (!existsSync(path)) continue;
      const store = JSON.parse(readFileSync(path, 'utf-8')) as { agents?: Record<string, AgentRow> };
      if (!store.agents) continue;
      let touched = false;
      for (const id of agentIds) {
        if (Object.prototype.hasOwnProperty.call(store.agents, id) && store.agents[id]) {
          mutate(store.agents[id]);
          touched = true;
        }
      }
      if (touched) writeFileSync(path, JSON.stringify(store, null, 2), 'utf-8');
    } catch {
      // Best-effort agent sync: a corrupt agent store must not fail the task op.
    }
  }
}

/** Return agents still holding `taskId` to idle. */
function releaseAgents(agentIds: string[], taskId: string): void {
  updateAgents(agentIds, (agent) => {
    if (agent.currentTask === taskId) {
      agent.status = 'idle';
      agent.currentTask = null;
    }
  });
}

/**
 * Stores `task_assign` may bind an agent from.
 *
 * The canonical file is `.claude-flow/agents/store.json`. `hive-mind_spawn`
 * writes its workers to `.claude-flow/agents.json` instead (#1916), so an id
 * that exists in either store is a real agent. A corrupt canonical store
 * throws, matching the read this handler already performed, so a bad file is
 * never replaced. The hive file stays best-effort: a corrupt copy must not
 * hide agents that are present in the canonical store.
 */
function assignableAgentStores(): Array<Record<string, AgentRow>> {
  const canonical = readRecordStore<{ agents: Record<string, AgentRow> }>(
    join(getProjectCwd(), STORAGE_DIR, 'agents', 'store.json'),
    'agents',
    () => ({ agents: {} }),
  );
  const stores: Array<Record<string, AgentRow>> = [canonical.agents];
  const hivePath = join(getProjectCwd(), STORAGE_DIR, 'agents.json');
  try {
    if (!existsSync(hivePath)) return stores;
    const parsed = JSON.parse(readFileSync(hivePath, 'utf-8')) as { agents?: unknown };
    const agents = parsed?.agents;
    if (agents && typeof agents === 'object' && !Array.isArray(agents)) {
      stores.push(agents as Record<string, AgentRow>);
    }
  } catch {
    // Best-effort, same as updateAgents.
  }
  return stores;
}

function agentIsAssignable(id: string, stores: Array<Record<string, AgentRow>>): boolean {
  return stores.some((agents) =>
    Object.prototype.hasOwnProperty.call(agents, id) && Boolean(agents[id]),
  );
}

interface SwarmRecordLite {
  swarmId?: string;
  status?: string;
  agents?: string[];
  tasks?: string[];
  createdAt?: string;
  updatedAt?: string;
}

function getSwarmStatePath(): string {
  return join(getProjectCwd(), STORAGE_DIR, 'swarm', 'swarm-state.json');
}

function selectPrimaryRunningSwarm(swarms: Record<string, SwarmRecordLite>): SwarmRecordLite | null {
  const running = Object.values(swarms).filter((s) => s && s.status === 'running');
  if (running.length === 0) return null;
  running.sort((a, b) => {
    const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tB - tA;
  });
  return running[0] ?? null;
}

/**
 * Sync task/agent lifecycle activity onto the active running swarm record so
 * live dashboards and topology views reflect current `updatedAt`, `tasks`, and `agents`.
 */
export function touchSwarmActivity(
  taskId: string | null = null,
  removeTaskId = false,
  agentIds: string[] = [],
): void {
  const nowIso = new Date().toISOString();
  let updatedSwarmId: string | null = null;
  try {
    const swarmPath = getSwarmStatePath();
    if (existsSync(swarmPath)) {
      const store = JSON.parse(readFileSync(swarmPath, 'utf-8')) as {
        swarms?: Record<string, SwarmRecordLite>;
      };
      if (store?.swarms) {
        const target = selectPrimaryRunningSwarm(store.swarms);
        if (target) {
          target.updatedAt = nowIso;
          if (!Array.isArray(target.tasks)) target.tasks = [];
          if (taskId) {
            if (removeTaskId) {
              target.tasks = target.tasks.filter((id) => id !== taskId);
            } else if (!target.tasks.includes(taskId)) {
              target.tasks.push(taskId);
            }
          }
          if (!Array.isArray(target.agents)) target.agents = [];
          for (const agentId of agentIds) {
            if (typeof agentId === 'string' && agentId && !target.agents.includes(agentId)) {
              target.agents.push(agentId);
            }
          }
          writeFileSync(swarmPath, JSON.stringify(store, null, 2), 'utf-8');
          updatedSwarmId = typeof target.swarmId === 'string' ? target.swarmId : null;
        }
      }
    }
  } catch {
    // Best-effort swarm telemetry: never block task or agent operations.
  }

  try {
    const legacyPath = join(getProjectCwd(), '.swarm', 'state.json');
    if (existsSync(legacyPath)) {
      const legacy = JSON.parse(readFileSync(legacyPath, 'utf-8')) as Record<string, unknown>;
      const legacyId = (legacy.swarmId ?? legacy.id) as string | undefined;
      if (!updatedSwarmId || !legacyId || legacyId === updatedSwarmId) {
        legacy.updatedAt = nowIso;
        writeFileSync(legacyPath, JSON.stringify(legacy, null, 2), 'utf-8');
      }
    }
  } catch {
    // Best-effort legacy pointer sync.
  }
}

const ASSIGNEE_KEYS = ['assignTo', 'assignedTo', 'agentIds', 'agentId'] as const;

/**
 * Normalize assignee parameters across MCP callers (`assignTo`, `assignedTo`,
 * `agentIds`, `agentId` as string or array of strings) while preserving the strict
 * array error contract when `assignTo` is explicitly passed.
 */
export function normalizeAgentIdList(
  input: Record<string, unknown>,
  options: { requireArrayForAssignTo?: boolean } = {},
): { ids: string[]; provided: boolean; error?: string } {
  if (options.requireArrayForAssignTo && input.assignTo !== undefined) {
    if (
      !Array.isArray(input.assignTo)
      || !input.assignTo.every((id) => validateIdentifier(id, 'assignTo').valid)
    ) {
      return { ids: [], provided: true, error: 'assignTo must be an array of agent ids' };
    }
    return { ids: [...new Set(input.assignTo as string[])], provided: true };
  }

  for (const key of ASSIGNEE_KEYS) {
    const raw = input[key];
    if (raw === undefined) continue;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return { ids: [], provided: true };
      const check = validateIdentifier(trimmed, key);
      if (!check.valid) {
        return { ids: [], provided: true, error: `${key} must be a valid agent id or array of agent ids` };
      }
      return { ids: [trimmed], provided: true };
    }
    if (Array.isArray(raw)) {
      if (!raw.every((id) => validateIdentifier(id, key).valid)) {
        return { ids: [], provided: true, error: `${key} must be an array of agent ids` };
      }
      return { ids: [...new Set(raw as string[])], provided: true };
    }
    return { ids: [], provided: true, error: `${key} must be a valid agent id or array of agent ids` };
  }

  return { ids: [], provided: false };
}

/**
 * Match a task to an idle worker belonging to the active running swarm when the
 * caller omitted assignee fields. Returns `[]` if no running swarm has a free worker,
 * leaving non-swarm task creation behavior unchanged.
 */
export function resolveAgentsForTask(type: string, description: string): string[] {
  try {
    const swarmPath = getSwarmStatePath();
    if (!existsSync(swarmPath)) return [];
    const swarmStore = JSON.parse(readFileSync(swarmPath, 'utf-8')) as {
      swarms?: Record<string, SwarmRecordLite>;
    };
    const runningSwarm = swarmStore?.swarms ? selectPrimaryRunningSwarm(swarmStore.swarms) : null;
    const memberIds = Array.isArray(runningSwarm?.agents) ? runningSwarm.agents : [];
    if (memberIds.length === 0) return [];

    const stores = assignableAgentStores();
    const candidates: Array<{ id: string; record: AgentRow }> = [];
    for (const id of memberIds) {
      for (const agents of stores) {
        const rec = Object.prototype.hasOwnProperty.call(agents, id) ? agents[id] : undefined;
        if (rec && rec.status === 'idle') {
          candidates.push({ id, record: rec });
          break;
        }
      }
    }
    if (candidates.length === 0) return [];

    const haystack = `${type} ${description}`.toLowerCase();
    const preferredTypes: string[] = [];
    if (/ui|ux|design|layout|figma|css|tailwind|frontend|vue|react/.test(haystack)) {
      preferredTypes.push('ui-ux-designer', 'uiux', 'designer', 'frontend', 'coder');
    } else if (/test|spec|vitest|jest|qa|verify|audit|e2e/.test(haystack)) {
      preferredTypes.push('tester', 'qa', 'reviewer');
    } else if (/review|security|lint|inspect/.test(haystack)) {
      preferredTypes.push('reviewer', 'security-auditor', 'tester');
    } else if (/architect|plan|adr|schema|design/.test(haystack)) {
      preferredTypes.push('architect', 'system-architect', 'coder');
    } else {
      preferredTypes.push('coder', 'developer', 'engineer', 'programmer');
    }

    for (const targetType of preferredTypes) {
      const hit = candidates.find(({ id, record }) => {
        const roleText = `${String(record.agentType ?? '')} ${String(record.name ?? '')} ${id}`.toLowerCase();
        return roleText.includes(targetType);
      });
      if (hit) return [hit.id];
    }

    return [candidates[0].id];
  } catch {
    return [];
  }
}

export const taskTools: MCPTool[] = [
  {
    name: 'task_create',
    description: 'Create a new task Use when native TodoWrite is wrong because you need cross-session task persistence, agent assignment, dependency tracking, or completion analytics in the .swarm/memory.db. For in-session checklists native TodoWrite is simpler and faster.',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Task type (feature, bugfix, research, refactor)' },
        description: { type: 'string', description: 'Task description' },
        priority: { type: 'string', description: 'Task priority (low, normal, high, critical)' },
        assignTo: { type: 'array', items: { type: 'string' }, description: 'Agent IDs to assign (also accepts assignedTo, agentIds, agentId)' },
        assignedTo: { type: 'array', items: { type: 'string' }, description: 'Alias for assignTo' },
        agentIds: { type: 'array', items: { type: 'string' }, description: 'Alias for assignTo' },
        agentId: { type: 'string', description: 'Single agent ID alias for assignTo' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Task tags' },
      },
      required: ['type', 'description'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vType = validateIdentifier(input.type, 'type');
      if (!vType.valid) return { success: false, error: vType.error };
      const vDesc = validateText(input.description, 'description');
      if (!vDesc.valid) return { success: false, error: vDesc.error };
      const parsedAssign = normalizeAgentIdList(input, { requireArrayForAssignTo: true });
      if (parsedAssign.error) {
        return { success: false, error: parsedAssign.error };
      }

      const assignedTo = parsedAssign.provided
        ? parsedAssign.ids
        : resolveAgentsForTask(input.type as string, input.description as string);

      const store = loadTaskStore();
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const nowIso = new Date().toISOString();

      const task: TaskRecord = {
        taskId,
        type: input.type as string,
        description: input.description as string,
        priority: (input.priority as TaskRecord['priority']) || 'normal',
        status: assignedTo.length > 0 ? 'in_progress' : 'pending',
        progress: 0,
        assignedTo,
        tags: (input.tags as string[]) || [],
        createdAt: nowIso,
        startedAt: assignedTo.length > 0 ? nowIso : null,
        completedAt: null,
      };

      store.tasks[taskId] = task;
      saveTaskStore(store);

      // Assigning at creation must mark the workers busy, as task_assign and task_update do;
      // otherwise they read idle while holding the task, and task_complete or task_cancel,
      // which only release a worker whose currentTask is this task, never free them either.
      updateAgents(task.assignedTo, (agent) => {
        agent.status = 'busy';
        agent.currentTask = taskId;
      });
      touchSwarmActivity(taskId, false, task.assignedTo);

      return {
        taskId,
        type: task.type,
        description: task.description,
        priority: task.priority,
        status: task.status,
        createdAt: task.createdAt,
        assignedTo: task.assignedTo,
        tags: task.tags,
      };
    },
  },
  {
    name: 'task_status',
    description: 'Get task status Use when native TodoWrite is wrong because you need cross-session task persistence, agent assignment, dependency tracking, or completion analytics in the .swarm/memory.db. For in-session checklists native TodoWrite is simpler and faster.',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.taskId, 'taskId');
      if (!vId.valid) return { success: false, error: vId.error };

      const store = loadTaskStore();
      const taskId = input.taskId as string;
      const task = store.tasks[taskId];

      if (task) {
        return {
          taskId: task.taskId,
          type: task.type,
          description: task.description,
          status: task.status,
          progress: task.progress,
          priority: task.priority,
          assignedTo: task.assignedTo,
          tags: task.tags,
          createdAt: task.createdAt,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          result: task.result || null,
        };
      }

      return {
        taskId,
        status: 'not_found',
        error: 'Task not found',
      };
    },
  },
  {
    name: 'task_list',
    description: 'List all tasks Use when native TodoWrite is wrong because you need cross-session task persistence, agent assignment, dependency tracking, or completion analytics in the .swarm/memory.db. For in-session checklists native TodoWrite is simpler and faster.',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status' },
        type: { type: 'string', description: 'Filter by type' },
        assignedTo: { type: 'string', description: 'Filter by assigned agent' },
        priority: { type: 'string', description: 'Filter by priority' },
        limit: { type: 'number', description: 'Max tasks to return' },
      },
    },
    handler: async (input) => {
      const store = loadTaskStore();
      let tasks = Object.values(store.tasks);

      // Apply filters
      if (input.status) {
        // Support comma-separated status values. 'all' (sent by `status tasks`) means no status filter.
        // Each value goes through statusOf, the reader task_update uses, so "done", "canceled",
        // "running" or "Completed" match the stored status rather than matching nothing.
        const statuses = (input.status as string).split(',').map(s => s.trim()).map(s => statusOf(s) ?? s);
        if (!statuses.includes('all')) {
          tasks = tasks.filter(t => statuses.includes(t.status));
        }
      }
      if (input.type) {
        tasks = tasks.filter(t => t.type === input.type);
      }
      if (input.assignedTo) {
        tasks = tasks.filter(t => t.assignedTo.includes(input.assignedTo as string));
      }
      if (input.priority) {
        tasks = tasks.filter(t => t.priority === input.priority);
      }

      // Sort by creation date (newest first)
      tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Count matches before applying the limit so callers can tell when the list was truncated
      const total = tasks.length;

      // Apply limit
      const limit = (input.limit as number) || 50;
      tasks = tasks.slice(0, limit);

      return {
        tasks: tasks.map(t => ({
          taskId: t.taskId,
          type: t.type,
          description: t.description,
          status: t.status,
          progress: t.progress,
          priority: t.priority,
          assignedTo: t.assignedTo,
          createdAt: t.createdAt,
        })),
        total,
        filters: {
          status: input.status,
          type: input.type,
          assignedTo: input.assignedTo,
          priority: input.priority,
        },
      };
    },
  },
  {
    name: 'task_complete',
    description: 'Mark task as complete Use when native TodoWrite is wrong because you need cross-session task persistence, agent assignment, dependency tracking, or completion analytics in the .swarm/memory.db. For in-session checklists native TodoWrite is simpler and faster.',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        result: { type: 'object', description: 'Task result data' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.taskId, 'taskId');
      if (!vId.valid) return { success: false, error: vId.error };

      const store = loadTaskStore();
      const taskId = input.taskId as string;
      const task = store.tasks[taskId];

      if (task) {
        if (task.status === 'completed') {
          return { taskId: task.taskId, status: task.status, completedAt: task.completedAt, result: task.result };
        }
        task.status = 'completed';
        task.progress = 100;
        task.completedAt = new Date().toISOString();
        task.result = (input.result as Record<string, unknown>) || {};
        saveTaskStore(store);

        // Sync assigned agents back to idle and increment taskCount. Credited only to a worker
        // still holding this task, as task_update does, so completing a reopened task again
        // (complete -> pending -> complete, no reassignment) never counts the same work twice.
        updateAgents(task.assignedTo, (agent) => {
          if (agent.currentTask === taskId) {
            agent.status = 'idle';
            agent.currentTask = null;
            agent.taskCount = ((agent.taskCount as number) || 0) + 1;
          }
        });
        touchSwarmActivity(taskId, true);

        return {
          taskId: task.taskId,
          status: task.status,
          completedAt: task.completedAt,
          result: task.result,
        };
      }

      return {
        taskId,
        status: 'not_found',
        error: 'Task not found',
      };
    },
  },
  {
    name: 'task_update',
    description: 'Update task status or progress Use when native TodoWrite is wrong because you need cross-session task persistence, agent assignment, dependency tracking, or completion analytics in the .swarm/memory.db. For in-session checklists native TodoWrite is simpler and faster.',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        // No schema enum: the HTTP/WebSocket registry validates enums before the handler, which would refuse the aliases there
        // while stdio accepted them. The handler is the one place that normalises and refuses, for every transport.
        status: { type: 'string', description: 'New status: pending, in_progress, completed, failed or cancelled' },
        progress: { type: 'number', description: 'Progress percentage (0-100)' },
        assignTo: { type: 'array', items: { type: 'string' }, description: 'Agent IDs to assign' },
        result: { type: 'object', description: 'Result data (e.g. the failure of a failed task)' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.taskId, 'taskId');
      if (!vId.valid) return { success: false, error: vId.error };
      // A status outside the five is stored as written otherwise, and every reader that buckets
      // by status (task_list filters, the console kanban) then miscounts it: "complete" read as pending.
      const status = input.status === undefined ? undefined : statusOf(input.status);
      if (status === null) {
        return { success: false, error: `status must be one of ${TASK_STATUSES.join(', ')}` };
      }

      const parsedAssign = normalizeAgentIdList(input, { requireArrayForAssignTo: true });
      if (parsedAssign.error) {
        return { success: false, error: parsedAssign.error };
      }

      const store = loadTaskStore();
      const taskId = input.taskId as string;
      const task = store.tasks[taskId];

      if (task) {
        // Worker effects run AFTER the task store is saved, as task_complete does: a failed save must not leave
        // workers freed and counted against a task that still reads unfinished.
        let afterSave: (() => void) | undefined;
        const previouslyAssigned = Array.isArray(task.assignedTo) ? [...task.assignedTo] : [];
        if (status !== undefined) {
          const newStatus = status;
          const wasCompleted = task.status === 'completed';
          task.status = newStatus;
          if (newStatus === 'in_progress' && !task.startedAt) {
            task.startedAt = new Date().toISOString();
          }
          // Reopening a finished task (completed/failed/cancelled -> pending/in_progress) makes it unfinished
          // again, so it must not keep reporting the completedAt of the run that was undone.
          if (newStatus === 'pending' || newStatus === 'in_progress') {
            task.completedAt = null;
          }
          // A finished task frees its workers, as task_complete and task_cancel do; otherwise a worker
          // whose task was finished through task_update stays `busy` forever, and a later task_complete
          // returns early because the status already reads completed.
          if (newStatus === 'failed' || newStatus === 'cancelled') {
            task.completedAt = new Date().toISOString();
            afterSave = () => releaseAgents(previouslyAssigned, taskId);
          }
          if (newStatus === 'completed' && !wasCompleted) {
            task.completedAt = new Date().toISOString();
            // Credited only to a worker still holding this task, so complete -> pending -> complete
            // (no reassignment in between) never counts the same work twice.
            afterSave = () => updateAgents(previouslyAssigned, (agent) => {
              if (agent.currentTask === taskId) {
                agent.status = 'idle';
                agent.currentTask = null;
                agent.taskCount = ((agent.taskCount as number) || 0) + 1;
              }
            });
          }
        }
        if (typeof input.progress === 'number') {
          task.progress = Math.min(100, Math.max(0, input.progress as number));
        }
        // Completing is 100% whatever progress the same call carried.
        if (task.status === 'completed') task.progress = 100;
        if (parsedAssign.provided) {
          task.assignedTo = parsedAssign.ids;
          // Reassignment must update the same worker stores as task_assign.
          // Terminal transitions release/credit the workers that held the task
          // before this update; replacement assignees did not perform that work.
          if (!['completed', 'failed', 'cancelled'].includes(task.status)) {
            afterSave = () => {
              releaseAgents(previouslyAssigned.filter(id => !task.assignedTo.includes(id)), taskId);
              // Echoing retained assignees must not take them from another task or re-credit completed work.
              updateAgents(task.assignedTo.filter(id => !previouslyAssigned.includes(id)), agent => {
                agent.status = 'busy';
                agent.currentTask = taskId;
              });
            };
          } else if (!afterSave) {
            afterSave = () => releaseAgents(previouslyAssigned, taskId);
          }
        }
        if (input.result && typeof input.result === 'object') {
          task.result = input.result as Record<string, unknown>;
        }
        saveTaskStore(store);
        afterSave?.();
        const isTerminal = ['completed', 'failed', 'cancelled'].includes(task.status);
        touchSwarmActivity(taskId, isTerminal, isTerminal ? [] : task.assignedTo);

        return {
          success: true,
          taskId: task.taskId,
          status: task.status,
          progress: task.progress,
          assignedTo: task.assignedTo,
        };
      }

      return {
        success: false,
        taskId,
        error: 'Task not found',
      };
    },
  },
  {
    name: 'task_assign',
    description: 'Assign a task to one or more agents Use when native TodoWrite is wrong because you need cross-session task persistence, agent assignment, dependency tracking, or completion analytics in the .swarm/memory.db. For in-session checklists native TodoWrite is simpler and faster.',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to assign' },
        agentIds: { type: 'array', items: { type: 'string' }, description: 'Agent IDs to assign (also accepts assignTo, assignedTo, agentId)' },
        assignTo: { type: 'array', items: { type: 'string' }, description: 'Alias for agentIds' },
        assignedTo: { type: 'array', items: { type: 'string' }, description: 'Alias for agentIds' },
        agentId: { type: 'string', description: 'Single agent ID alias for agentIds' },
        unassign: { type: 'boolean', description: 'Unassign all agents from task' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.taskId, 'taskId');
      if (!vId.valid) return { success: false, error: vId.error };

      const store = loadTaskStore();
      const taskId = input.taskId as string;
      const task = store.tasks[taskId];

      if (!task) {
        return { taskId, error: 'Task not found' };
      }

      // Completed and cancelled tasks are terminal (#4725). Assigning a
      // completed task marks the agent busy, and task_complete then returns
      // without releasing it; task_cancel refuses a finished task too, so
      // nothing ever sets that agent back to idle.
      if (task.status === 'completed' || task.status === 'cancelled') {
        return {
          success: false,
          taskId,
          status: task.status,
          error: `Cannot assign a ${task.status} task`,
        };
      }

      const previouslyAssigned = [...task.assignedTo];
      const agentStores = assignableAgentStores();
      if (input.unassign) {
        // Revert previously assigned agents to idle
        releaseAgents(previouslyAssigned, taskId);
        task.assignedTo = [];
      } else {
        const parsedAssign = normalizeAgentIdList(input);
        if (parsedAssign.error) {
          return {
            success: false,
            taskId,
            status: task.status,
            error: parsedAssign.error,
          };
        }
        const agentIds = parsedAssign.ids;
        // An id in neither store is a ghost owner: the task would go
        // in_progress with nobody to do the work (#4725).
        const missing = agentIds.filter((id) => !agentIsAssignable(id, agentStores));
        if (missing.length > 0) {
          const listed = missing.join(', ');
          return {
            success: false,
            taskId,
            status: task.status,
            error: missing.length === 1 ? `Agent not found: ${listed}` : `Agents not found: ${listed}`,
          };
        }
        // Revert old agents to idle
        releaseAgents(previouslyAssigned.filter((id) => !agentIds.includes(id)), taskId);
        // Set new agents to active
        updateAgents(agentIds, (agent) => {
          agent.status = 'busy';
          agent.currentTask = taskId;
        });
        task.assignedTo = agentIds;
        // Auto-transition task to in_progress if pending
        if (task.status === 'pending' && agentIds.length > 0) {
          task.status = 'in_progress';
          if (!task.startedAt) {
            task.startedAt = new Date().toISOString();
          }
        }
      }

      saveTaskStore(store);
      touchSwarmActivity(taskId, Boolean(input.unassign), input.unassign ? [] : task.assignedTo);

      return {
        taskId: task.taskId,
        assignedTo: task.assignedTo,
        previouslyAssigned,
        status: task.status,
      };
    },
  },
  {
    name: 'task_cancel',
    description: 'Cancel a task Use when native TodoWrite is wrong because you need cross-session task persistence, agent assignment, dependency tracking, or completion analytics in the .swarm/memory.db. For in-session checklists native TodoWrite is simpler and faster.',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        reason: { type: 'string', description: 'Cancellation reason' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.taskId, 'taskId');
      if (!vId.valid) return { success: false, error: vId.error };
      if (input.reason) {
        const v = validateText(input.reason, 'reason');
        if (!v.valid) return { success: false, error: v.error };
      }

      const store = loadTaskStore();
      const taskId = input.taskId as string;
      const task = store.tasks[taskId];

      if (task) {
        const previousStatus = task.status;
        // A finished task keeps its outcome: cancelling it used to overwrite a
        // completed task's result and completedAt with a cancel reason.
        if (previousStatus === 'completed' || previousStatus === 'failed' || previousStatus === 'cancelled') {
          return {
            success: false,
            taskId,
            status: previousStatus,
            previousStatus,
            error: `Task is already ${previousStatus}`,
          };
        }

        task.status = 'cancelled';
        task.completedAt = new Date().toISOString();
        task.result = { cancelReason: input.reason || 'Cancelled by user' };
        saveTaskStore(store);
        releaseAgents(task.assignedTo, taskId);
        touchSwarmActivity(taskId, true);

        return {
          success: true,
          taskId: task.taskId,
          status: task.status,
          previousStatus,
          cancelledAt: task.completedAt,
        };
      }

      return {
        success: false,
        taskId,
        error: 'Task not found',
      };
    },
  },
  {
    // #1916: the `ruflo task retry <id>` CLI subcommand referenced an
    // unregistered `task_retry` tool. Re-queues a finished/cancelled task by
    // cloning its spec into a fresh pending task (the original is left intact
    // as history).
    name: 'task_retry',
    description: 'Re-queue a failed/cancelled/completed task by cloning its spec into a fresh pending task (the original record is kept as history). Use when native TodoWrite is wrong because you need the original task\'s persisted spec (type, priority, assignees, tags) and a stable taskId chain across runs rather than hand-retyping a checklist item. For ad-hoc re-runs, native TodoWrite is fine.',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID of the task to retry' },
        resetState: { type: 'boolean', description: 'Reset progress/result on the new task (default true)' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      const v = validateIdentifier(input.taskId, 'taskId');
      if (!v.valid) return { success: false, error: v.error };

      const store = loadTaskStore();
      const taskId = input.taskId as string;
      const original = store.tasks[taskId];
      if (!original) return { success: false, taskId, error: 'Task not found' };

      const retainState = input.resetState === false;
      const newTaskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const retry: TaskRecord = {
        taskId: newTaskId,
        type: original.type,
        description: original.description,
        priority: original.priority,
        status: 'pending',
        progress: retainState ? original.progress ?? 0 : 0,
        assignedTo: [...original.assignedTo],
        tags: [...original.tags, 'retry-of:' + taskId],
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      };
      if (retainState && original.result !== undefined) retry.result = original.result;
      store.tasks[newTaskId] = retry;
      saveTaskStore(store);

      updateAgents(retry.assignedTo, (agent) => {
        agent.status = 'busy';
        agent.currentTask = newTaskId;
      });
      touchSwarmActivity(newTaskId, false, retry.assignedTo);

      return {
        taskId,
        newTaskId,
        previousStatus: original.status,
        status: 'pending',
      };
    },
  },
];
