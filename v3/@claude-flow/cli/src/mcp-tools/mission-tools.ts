/**
 * Durable mission MCP tools.
 *
 * A mission is a small persisted DAG. Agent calls are dispatched by this
 * runtime; external actions are deliberately handed to the caller as durable
 * intents. Ruflo cannot infer whether an arbitrary remote side effect happened
 * after a crash, so uncertain work requires an explicit receipt/reconciliation.
 */

import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { type MCPTool, getProjectCwd } from './types.js';
import { executeAgentTask } from './agent-execute-core.js';

type StepKind = 'agent' | 'signal' | 'action';
type StepStatus = 'pending' | 'running' | 'waiting' | 'ambiguous' | 'completed' | 'failed';
type MissionStatus = 'ready' | 'running' | 'waiting' | 'ambiguous' | 'completed' | 'failed';
type SignalType = 'string' | 'number' | 'boolean' | 'object' | 'approval';

interface MissionStep {
  stepId: string;
  kind: StepKind;
  dependsOn: string[];
  status: StepStatus;
  agentId?: string;
  prompt?: string;
  signalName?: string;
  valueType?: SignalType;
  actionName?: string;
  request?: Record<string, unknown>;
  idempotencyKey?: string;
  ownerPid?: number;
  ownerRunId?: string;
  result?: unknown;
  receipt?: string;
  error?: string;
}

interface MissionEvent {
  at: string;
  type: string;
  stepId?: string;
  detail?: string;
}

interface MissionRecord {
  version: 1;
  missionId: string;
  name: string;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
  steps: MissionStep[];
  events: MissionEvent[];
}

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MISSION_ID = /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i;
const MISSION_DIR = join('.claude-flow', 'missions');
const RUN_ID = randomUUID();
const MAX_PAYLOAD_BYTES = 256_000;
const MAX_EVENTS = 2048;
const MAX_DETAIL_CHARS = 2000;
const MAX_RECORD_BYTES = 40_000_000;
const STALE_LOCK_MS = 60_000;

function boundedDetail(value: string): string {
  return value.length <= MAX_DETAIL_CHARS ? value : `${value.slice(0, MAX_DETAIL_CHARS - 12)}…[truncated]`;
}

function payloadBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Payload is not JSON serializable');
  return Buffer.byteLength(serialized, 'utf8');
}

function directory(): string {
  return join(getProjectCwd(), MISSION_DIR);
}

function validMissionId(id: unknown): id is string {
  return typeof id === 'string' && MISSION_ID.test(id);
}

function pathFor(id: string): string {
  return join(directory(), `${id}.json`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function event(record: MissionRecord, type: string, stepId?: string, detail?: string): void {
  if (record.events.length >= MAX_EVENTS) throw new Error('Mission event limit reached');
  record.events.push({ at: new Date().toISOString(), type, ...(stepId ? { stepId } : {}), ...(detail ? { detail: boundedDetail(detail) } : {}) });
}

function load(id: string): MissionRecord | undefined {
  const path = pathFor(id);
  if (!existsSync(path)) return undefined;
  if (statSync(path).size > MAX_RECORD_BYTES) throw new Error('Mission record is too large');
  const record = JSON.parse(readFileSync(path, 'utf8')) as MissionRecord;
  if (record.version !== 1 || record.missionId !== id || !Array.isArray(record.steps) ||
      !Array.isArray(record.events) || record.events.length > MAX_EVENTS || typeof record.name !== 'string' ||
      !['ready', 'running', 'waiting', 'ambiguous', 'completed', 'failed'].includes(record.status)) {
    throw new Error('Invalid mission record');
  }
  // Parse success is not proof that the persisted state is safe to dispatch.
  // Refuse unknown step kinds/statuses and damaged action intents.
  validateSteps(record.steps);
  for (const entry of record.events) {
    if (!isObject(entry) || typeof entry.type !== 'string' || typeof entry.at !== 'string' ||
        (entry.detail !== undefined && (typeof entry.detail !== 'string' || entry.detail.length > MAX_DETAIL_CHARS))) {
      throw new Error('Invalid mission event');
    }
  }
  for (const step of record.steps) {
    if (!['pending', 'running', 'waiting', 'ambiguous', 'completed', 'failed'].includes(step.status)) throw new Error('Invalid mission step status');
    if (step.status === 'running' && (step.kind !== 'agent' || !Number.isInteger(step.ownerPid) || typeof step.ownerRunId !== 'string')) throw new Error('Invalid running mission step');
    if (step.kind === 'action' && step.status === 'waiting' && step.idempotencyKey !== `${id}:${step.stepId}`) throw new Error('Invalid action intent');
    if (step.error !== undefined && (typeof step.error !== 'string' || step.error.length > MAX_DETAIL_CHARS)) throw new Error('Invalid mission error');
    if (step.receipt !== undefined && (typeof step.receipt !== 'string' || step.receipt.length > MAX_DETAIL_CHARS)) throw new Error('Invalid mission receipt');
    if (step.result !== undefined && payloadBytes(step.result) > MAX_PAYLOAD_BYTES) throw new Error('Mission result is too large');
  }
  return record;
}

function persist(record: MissionRecord): void {
  mkdirSync(directory(), { recursive: true, mode: 0o700 });
  record.updatedAt = new Date().toISOString();
  const target = pathFor(record.missionId);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const serialized = JSON.stringify(record, null, 2);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES) throw new Error('Mission record is too large');
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, serialized);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, target);
    // Rename is atomic, and syncing the directory makes the name durable on
    // filesystems that support directory fsync.
    try {
      const dirFd = openSync(directory(), 'r');
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    } catch { /* Directory fsync is not available on every platform. */ }
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* already moved */ }
    throw error;
  }
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

function withLock<T>(id: string, operation: () => T): T {
  mkdirSync(directory(), { recursive: true, mode: 0o700 });
  const lockPath = `${pathFor(id)}.lock`;
  let fd: number | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fd = openSync(lockPath, 'wx', 0o600);
      try {
        writeFileSync(fd, String(process.pid));
        fsyncSync(fd);
      } catch (error) {
        closeSync(fd);
        fd = undefined;
        try { unlinkSync(lockPath); } catch { /* already removed */ }
        throw error;
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = Number(readFileSync(lockPath, 'utf8'));
      // An empty owner can only be reclaimed after a grace period; another
      // process may still be between open and write.
      const lockAge = Date.now() - statSync(lockPath).mtimeMs;
      if (lockAge < STALE_LOCK_MS && (processAlive(owner) || (!owner && lockAge < 10_000))) {
        throw new Error('Mission is busy; retry after the current transition');
      }
      try { unlinkSync(lockPath); } catch { /* another process claimed it */ }
    }
  }
  if (fd === undefined) throw new Error('Mission is busy; retry');
  try { return operation(); }
  finally {
    closeSync(fd);
    try { unlinkSync(lockPath); } catch { /* already removed */ }
  }
}

function mutate<T>(id: string, operation: (record: MissionRecord) => T): T {
  return withLock(id, () => {
    const record = load(id);
    if (!record) throw new Error('Mission not found');
    const result = operation(record);
    persist(record);
    return result;
  });
}

function validateSteps(raw: unknown): MissionStep[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 64) throw new Error('steps must contain 1 to 64 entries');
  const ids = new Set<string>();
  const steps = raw.map((input, index): MissionStep => {
    if (!isObject(input)) throw new Error(`steps[${index}] must be an object`);
    const stepId = input.stepId;
    if (typeof stepId !== 'string' || !ID.test(stepId) || ids.has(stepId)) throw new Error(`Invalid or duplicate stepId at steps[${index}]`);
    ids.add(stepId);
    const kind = input.kind;
    if (kind !== 'agent' && kind !== 'signal' && kind !== 'action') throw new Error(`Invalid kind for ${stepId}`);
    const dependsOn = input.dependsOn === undefined ? [] : input.dependsOn;
    if (!Array.isArray(dependsOn) || !dependsOn.every((dep) => typeof dep === 'string' && ID.test(dep)) || new Set(dependsOn).size !== dependsOn.length) {
      throw new Error(`Invalid dependencies for ${stepId}`);
    }
    const step: MissionStep = { stepId, kind, dependsOn, status: 'pending' };
    if (kind === 'agent') {
      if (typeof input.agentId !== 'string' || !ID.test(input.agentId) || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 20_000) {
        throw new Error(`agent step ${stepId} needs agentId and prompt`);
      }
      step.agentId = input.agentId;
      step.prompt = input.prompt;
    } else if (kind === 'signal') {
      if (typeof input.signalName !== 'string' || !ID.test(input.signalName) || !['string', 'number', 'boolean', 'object', 'approval'].includes(String(input.valueType))) {
        throw new Error(`signal step ${stepId} needs signalName and valueType`);
      }
      step.signalName = input.signalName;
      step.valueType = input.valueType as SignalType;
    } else {
      if (typeof input.actionName !== 'string' || !ID.test(input.actionName) || !isObject(input.request)) {
        throw new Error(`action step ${stepId} needs actionName and request`);
      }
      if (payloadBytes(input.request) > MAX_PAYLOAD_BYTES) throw new Error(`action request ${stepId} is too large`);
      step.actionName = input.actionName;
      step.request = input.request;
    }
    return step;
  });
  const byId = new Map(steps.map((step) => [step.stepId, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('Mission dependencies contain a cycle');
    if (visited.has(id)) return;
    const step = byId.get(id);
    if (!step) throw new Error(`Unknown dependency ${id}`);
    visiting.add(id);
    for (const dependency of step.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const step of steps) visit(step.stepId);
  return steps;
}

function snapshot(record: MissionRecord): Record<string, unknown> {
  return {
    success: true,
    missionId: record.missionId,
    name: record.name,
    status: record.status,
    steps: record.steps.map(({ stepId, kind, dependsOn, status, ownerPid, ownerRunId, result, receipt, error }) => ({
      stepId, kind, dependsOn, status, ...(status === 'running' ? { ownerPid, ownerRunId } : {}), result, receipt, error,
    })),
    pendingSignals: record.steps.filter((step) => step.kind === 'signal' && step.status === 'waiting')
      .map(({ stepId, signalName, valueType }) => ({ stepId, signalName, valueType })),
    pendingActions: record.steps.filter((step) => step.kind === 'action' && (step.status === 'waiting' || step.status === 'ambiguous'))
      .map(({ stepId, actionName, request, idempotencyKey, status }) => ({ stepId, actionName, request, idempotencyKey, status, needsReconciliation: true })),
    events: record.events,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function refreshStatus(record: MissionRecord): void {
  if (record.steps.some((step) => step.status === 'failed')) record.status = 'failed';
  else if (record.steps.some((step) => step.status === 'ambiguous')) record.status = 'ambiguous';
  else if (record.steps.every((step) => step.status === 'completed')) record.status = 'completed';
  else if (record.steps.some((step) => step.status === 'running')) record.status = 'running';
  else if (record.steps.some((step) => step.status === 'waiting')) record.status = 'waiting';
  else record.status = 'ready';
}

function readyStep(record: MissionRecord): MissionStep | undefined {
  return record.steps.find((step) => step.status === 'pending' && step.dependsOn.every((id) => record.steps.find((candidate) => candidate.stepId === id)?.status === 'completed'));
}

function validateSignal(value: unknown, type: SignalType): boolean {
  if (type === 'approval') return typeof value === 'boolean';
  if (type === 'object') return isObject(value);
  return typeof value === type && (type !== 'number' || Number.isFinite(value));
}

function failure(error: unknown): { success: false; error: string } {
  return { success: false, error: error instanceof Error ? error.message : String(error) };
}

export const missionTools: MCPTool[] = [
  {
    name: 'mission_create',
    description: 'Create a persisted DAG mission with agent, signal, and external-action steps. Use when workflow_create is wrong because work must wait across restarts and retain action receipts.',
    category: 'workflow',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, steps: { type: 'array' } }, required: ['name', 'steps'] },
    handler: async (input) => {
      try {
        if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) throw new Error('name must be 1 to 200 characters');
        const steps = validateSteps(input.steps);
        const now = new Date().toISOString();
        const record: MissionRecord = {
          version: 1, missionId: randomUUID(), name: input.name, status: 'ready',
          createdAt: now, updatedAt: now, steps, events: [{ at: now, type: 'mission_created' }],
        };
        withLock(record.missionId, () => persist(record));
        return snapshot(record);
      } catch (error) { return failure(error); }
    },
  },
  {
    name: 'mission_advance',
    description: 'Execute ready agent steps and arm signal/action waits. Use when workflow_execute is wrong because an uncertain call must block automatic replay until reconciliation.',
    category: 'workflow',
    inputSchema: { type: 'object', properties: { missionId: { type: 'string' } }, required: ['missionId'] },
    handler: async (input) => {
      try {
        if (!validMissionId(input.missionId)) throw new Error('Invalid missionId');
        const missionId = input.missionId;
        // Each transition is persisted before returning or invoking a provider.
        // No lock is held over an awaited network call.
        for (let transitions = 0; transitions < 130; transitions++) {
          const claimed = mutate(missionId, (record) => {
            for (const step of record.steps) {
              if (step.status === 'running' && (!processAlive(step.ownerPid ?? 0) ||
                  (step.ownerPid === process.pid && step.ownerRunId !== RUN_ID))) {
                step.status = 'ambiguous';
                step.error = 'Runner stopped before recording a provider result';
                event(record, 'execution_uncertain', step.stepId);
              }
            }
            refreshStatus(record);
            if (record.status === 'failed' || record.status === 'ambiguous' || record.status === 'completed' || record.status === 'running') {
              return { state: snapshot(record) };
            }
            const step = readyStep(record);
            if (!step) return { state: snapshot(record) };
            if (step.kind === 'signal') {
              step.status = 'waiting';
              event(record, 'signal_waiting', step.stepId, step.signalName);
            } else if (step.kind === 'action') {
              step.status = 'waiting';
              step.idempotencyKey ??= `${missionId}:${step.stepId}`;
              event(record, 'action_intent_issued', step.stepId, step.actionName);
            } else {
              step.status = 'running';
              step.ownerPid = process.pid;
              step.ownerRunId = RUN_ID;
              event(record, 'agent_dispatched', step.stepId);
            }
            refreshStatus(record);
            return step.kind === 'agent'
              ? { dispatch: { stepId: step.stepId, agentId: step.agentId!, prompt: step.prompt! } }
              : { continue: true };
          });
          if ('state' in claimed) return claimed.state;
          if ('continue' in claimed) continue;
          const { stepId, agentId, prompt } = claimed.dispatch!;
          let result: Awaited<ReturnType<typeof executeAgentTask>> | undefined;
          let error: string | undefined;
          let storageError: string | undefined;
          try {
            result = await executeAgentTask({ agentId, prompt });
            if (!result.success) error = result.error || 'Agent call did not confirm success';
            if (!error && payloadBytes(result) > MAX_PAYLOAD_BYTES) storageError = `Agent result exceeds ${MAX_PAYLOAD_BYTES} bytes`;
          } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
          const state = mutate(missionId, (record) => {
            const step = record.steps.find((candidate) => candidate.stepId === stepId)!;
            // A live operator may have reconciled the call. Never overwrite
            // its receipt with a late response.
            if (step.status === 'running' && step.ownerPid === process.pid && step.ownerRunId === RUN_ID) {
              if (error) {
                step.status = 'ambiguous';
                step.error = boundedDetail(error);
                event(record, 'execution_uncertain', stepId, error);
              } else if (storageError) {
                step.status = 'failed';
                step.error = storageError;
                event(record, 'agent_result_rejected', stepId, storageError);
              } else {
                step.status = 'completed';
                step.result = result;
                event(record, 'agent_completed', stepId);
              }
              delete step.ownerPid;
              delete step.ownerRunId;
            }
            refreshStatus(record);
            return snapshot(record);
          });
          if (state.status === 'ambiguous' || state.status === 'failed') return state;
        }
        throw new Error('Mission transition limit exceeded');
      } catch (error) { return failure(error); }
    },
  },
  {
    name: 'mission_signal',
    description: 'Deliver a typed value to an armed signal wait; approval=false denies the mission. Use when workflow_resume is wrong because a human or external event must be recorded.',
    category: 'workflow',
    inputSchema: { type: 'object', properties: { missionId: { type: 'string' }, stepId: { type: 'string' }, value: {} }, required: ['missionId', 'stepId', 'value'] },
    handler: async (input) => {
      try {
        if (!validMissionId(input.missionId) || typeof input.stepId !== 'string' || !ID.test(input.stepId)) throw new Error('Invalid missionId or stepId');
        return mutate(input.missionId, (record) => {
          const step = record.steps.find((candidate) => candidate.stepId === input.stepId);
          if (!step || step.kind !== 'signal' || step.status !== 'waiting') throw new Error('Signal step is not waiting');
          if (!validateSignal(input.value, step.valueType!)) throw new Error(`Signal requires ${step.valueType}`);
          if (payloadBytes(input.value) > MAX_PAYLOAD_BYTES) throw new Error(`Signal exceeds ${MAX_PAYLOAD_BYTES} bytes`);
          step.result = input.value;
          step.status = step.valueType === 'approval' && input.value === false ? 'failed' : 'completed';
          event(record, step.status === 'failed' ? 'approval_denied' : 'signal_received', step.stepId);
          refreshStatus(record);
          return snapshot(record);
        });
      } catch (error) { return failure(error); }
    },
  },
  {
    name: 'mission_reconcile',
    description: 'Resolve an uncertain agent call or external action with provider evidence. Use when mission_advance is wrong because the outcome of a side effect cannot be inferred safely.',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        missionId: { type: 'string' }, stepId: { type: 'string' },
        outcome: { type: 'string', enum: ['completed', 'failed', 'not_started'] },
        receipt: { type: 'string', description: 'Provider receipt or operator evidence of outcome' },
        idempotencyKey: { type: 'string', description: 'Required for an external action; must match its issued key' },
      },
      required: ['missionId', 'stepId', 'outcome', 'receipt'],
    },
    handler: async (input) => {
      try {
        if (!validMissionId(input.missionId) || typeof input.stepId !== 'string' || !ID.test(input.stepId)) throw new Error('Invalid missionId or stepId');
        if (!['completed', 'failed', 'not_started'].includes(String(input.outcome))) throw new Error('Invalid reconciliation outcome');
        const receipt = input.receipt;
        if (typeof receipt !== 'string' || !receipt.trim() || receipt.length > 2000) throw new Error('A nonempty provider receipt or operator evidence is required');
        return mutate(input.missionId, (record) => {
          const step = record.steps.find((candidate) => candidate.stepId === input.stepId);
          if (!step || (step.kind !== 'agent' && step.kind !== 'action')) throw new Error('Step cannot be reconciled');
          if (step.kind === 'action') {
            if (step.status !== 'waiting' && step.status !== 'ambiguous') throw new Error('Action is not awaiting reconciliation');
            if (input.idempotencyKey !== step.idempotencyKey) throw new Error('Action idempotencyKey mismatch');
          } else if (step.status !== 'ambiguous') {
            throw new Error('Agent call is not ambiguous; an active call cannot be reconciled');
          }
          step.receipt = receipt;
          if (input.outcome === 'not_started') {
            step.status = 'pending';
            delete step.error;
          } else {
            step.status = input.outcome as 'completed' | 'failed';
          }
          event(record, 'step_reconciled', step.stepId, String(input.outcome));
          refreshStatus(record);
          return snapshot(record);
        });
      } catch (error) { return failure(error); }
    },
  },
  {
    name: 'mission_recover',
    description: 'Mark a running agent call uncertain with explicit operator evidence. Use when mission_advance is wrong because a reused PID or lost worker makes liveness inconclusive.',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: { missionId: { type: 'string' }, stepId: { type: 'string' }, ownerPid: { type: 'number' }, evidence: { type: 'string' } },
      required: ['missionId', 'stepId', 'ownerPid', 'evidence'],
    },
    handler: async (input) => {
      try {
        if (!validMissionId(input.missionId) || typeof input.stepId !== 'string' || !ID.test(input.stepId)) throw new Error('Invalid missionId or stepId');
        const evidence = input.evidence;
        if (!Number.isInteger(input.ownerPid) || typeof evidence !== 'string' || !evidence.trim() || evidence.length > 2000) {
          throw new Error('Observed ownerPid and operator evidence are required');
        }
        return mutate(input.missionId, (record) => {
          const step = record.steps.find((candidate) => candidate.stepId === input.stepId);
          if (!step || step.kind !== 'agent' || step.status !== 'running' || step.ownerPid !== input.ownerPid) throw new Error('Running step or ownerPid changed');
          if (step.ownerPid === process.pid && step.ownerRunId === RUN_ID) throw new Error('Cannot recover an agent call owned by this live runner');
          step.status = 'ambiguous';
          step.error = 'Operator marked previous runner uncertain';
          event(record, 'execution_uncertain', step.stepId, evidence);
          delete step.ownerPid;
          delete step.ownerRunId;
          refreshStatus(record);
          return snapshot(record);
        });
      } catch (error) { return failure(error); }
    },
  },
  {
    name: 'mission_status',
    description: 'Read persisted mission state and its transition history. Use when workflow_status is wrong because pending typed signals, action intents, and uncertainty need inspection.',
    category: 'workflow',
    inputSchema: { type: 'object', properties: { missionId: { type: 'string' } }, required: ['missionId'] },
    handler: async (input) => {
      try {
        if (!validMissionId(input.missionId)) throw new Error('Invalid missionId');
        const record = load(input.missionId);
        if (!record) throw new Error('Mission not found');
        return snapshot(record);
      } catch (error) { return failure(error); }
    },
  },
];
