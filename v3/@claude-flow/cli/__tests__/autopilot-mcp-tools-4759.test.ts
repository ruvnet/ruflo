import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOG_FILE,
  STATE_FILE,
  getLearningLoadError,
  tryLoadLearning,
  type AutopilotState,
} from '../src/autopilot-state.js';
import { autopilotTools } from '../src/mcp-tools/autopilot-tools.js';
import type { MCPToolResult } from '../src/mcp-tools/types.js';

// Team-task discovery reads the home directory even when the project is empty.
vi.mock('node:os', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: vi.fn(),
}));

// Keep real persistence, validation and discovery without initializing AgentDB.
vi.mock('../src/autopilot-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/autopilot-state.js')>(),
  tryLoadLearning: vi.fn(),
  getLearningLoadError: vi.fn(),
}));

const now = Date.UTC(2026, 0, 1);
const initialState: AutopilotState = {
  sessionId: 'fixture-session',
  enabled: true,
  startTime: now - 5000,
  iterations: 3,
  maxIterations: 60,
  timeoutMinutes: 90,
  taskSources: ['team-tasks', 'swarm-tasks', 'file-checklist'],
  lastCheck: now - 1000,
  history: [{ ts: now - 1000, iteration: 3, completed: 1, total: 3 }],
};

function writeFixture(file: string, contents: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents, 'utf8');
}

function writeJson(file: string, data: unknown) {
  writeFixture(file, JSON.stringify(data));
}

function readJson(file: string) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function seedTasks() {
  const team = { id: 'team-1', subject: 'Review the plan', status: 'DONE' };
  const swarm = { id: 'swarm-1', subject: 'Write the patch', status: 'in_progress' };
  const checklist = { id: 'check-1', subject: 'Run the checks', status: 'pending' };

  writeJson(join(homedir(), '.claude', 'tasks', 'fixture-team', '1.json'), team);
  writeJson('.claude-flow/swarm-tasks.json', { tasks: [swarm] });
  writeJson('.claude-flow/data/checklist.json', { items: [{ id: checklist.id, text: checklist.subject }] });

  return { team, swarm, checklist };
}

async function callTool(name: string, input: Record<string, unknown> = {}, isError = false) {
  const tool = autopilotTools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing MCP tool: ${name}`);

  const result = await tool.handler(input) as MCPToolResult;
  expect(result.isError ?? false).toBe(isError);
  expect(result.content).toEqual([{ type: 'text', text: expect.any(String) }]);
  return JSON.parse(result.content[0].text!);
}

describe('autopilot MCP tools (#4759)', () => {
  let originalCwd: string;
  let fixtureRoot: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    fixtureRoot = mkdtempSync(join(tmpdir(), 'ruflo-autopilot-mcp-4759-'));
    const project = join(fixtureRoot, 'project');
    mkdirSync(project);
    process.chdir(project);
    vi.mocked(homedir).mockReturnValue(join(fixtureRoot, 'home'));
    vi.mocked(tryLoadLearning).mockReset().mockResolvedValue(null);
    vi.mocked(getLearningLoadError).mockReset().mockReturnValue(null);
    vi.spyOn(Date, 'now').mockReturnValue(now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('autopilot_status reports elapsed time and rounded task progress', async () => {
    writeJson(STATE_FILE, initialState);
    seedTasks();

    expect(await callTool('autopilot_status')).toEqual({
      enabled: true,
      sessionId: initialState.sessionId,
      iterations: 3,
      maxIterations: 60,
      timeoutMinutes: 90,
      elapsedMs: 5000,
      tasks: { completed: 1, total: 3, percent: 33 },
      taskSources: initialState.taskSources,
    });
  });

  it('autopilot_status falls back to defaults for corrupt state', async () => {
    writeFixture(STATE_FILE, '{');

    expect(await callTool('autopilot_status')).toMatchObject({
      enabled: false,
      iterations: 0,
      maxIterations: 50,
      timeoutMinutes: 240,
      elapsedMs: 0,
      tasks: { completed: 0, total: 0, percent: 100 },
    });
    expect(readFileSync(STATE_FILE, 'utf8')).toBe('{');
  });

  it('autopilot_enable restarts the timer and logs the persisted session', async () => {
    writeJson(STATE_FILE, { ...initialState, enabled: false });

    expect(await callTool('autopilot_enable')).toEqual({
      enabled: true,
      maxIterations: 60,
      timeoutMinutes: 90,
    });
    expect(readJson(STATE_FILE)).toEqual({ ...initialState, enabled: true, startTime: now, iterations: 0 });
    expect(readJson(LOG_FILE)).toEqual([{ ts: now, event: 'enabled', sessionId: initialState.sessionId }]);
  });

  it('autopilot_disable keeps the iteration count and logs it', async () => {
    writeJson(STATE_FILE, initialState);
    const previousEvent = { ts: now - 1000, event: 'enabled', sessionId: initialState.sessionId };
    writeJson(LOG_FILE, [previousEvent]);

    expect(await callTool('autopilot_disable')).toEqual({ enabled: false });
    expect(readJson(STATE_FILE)).toEqual({ ...initialState, enabled: false });
    expect(readJson(LOG_FILE)).toEqual([previousEvent, { ts: now, event: 'disabled', iterations: 3 }]);
  });

  it('autopilot_config persists bounded limits and normalized sources', async () => {
    writeJson(STATE_FILE, initialState);

    const config = {
      maxIterations: 1000,
      timeoutMinutes: 1,
      taskSources: ['file-checklist', 'swarm-tasks'],
    };
    expect(await callTool('autopilot_config', {
      maxIterations: 2000,
      timeoutMinutes: 0,
      taskSources: [' file-checklist ', 'swarm-tasks', 'file-checklist'],
    })).toEqual(config);
    expect(readJson(STATE_FILE)).toEqual({ ...initialState, ...config });
  });

  it('autopilot_config rejects a mixed source list without changing persisted state', async () => {
    writeJson(STATE_FILE, initialState);

    expect(await callTool('autopilot_config', {
      maxIterations: 70,
      taskSources: ['swarm-tasks', 'issues'],
    }, true)).toEqual({
      error: 'Unsupported task source(s): issues',
      validSources: ['team-tasks', 'swarm-tasks', 'file-checklist'],
    });
    expect(readJson(STATE_FILE)).toEqual(initialState);
  });

  it('autopilot_reset clears iteration history and last check while keeping configuration', async () => {
    writeJson(STATE_FILE, initialState);

    expect(await callTool('autopilot_reset')).toEqual({ reset: true, iterations: 0 });
    expect(readJson(STATE_FILE)).toEqual({
      ...initialState,
      iterations: 0,
      startTime: now,
      history: [],
      lastCheck: null,
    });
    expect(readJson(LOG_FILE)).toEqual([{ ts: now, event: 'reset' }]);
  });

  it('autopilot_log returns the last N events in order and defaults to the full log for invalid last', async () => {
    const entries = [
      { ts: now - 2000, event: 'enabled' },
      { ts: now - 1000, event: 'reset' },
      { ts: now, event: 'disabled' },
    ];
    writeJson(LOG_FILE, entries);

    expect(await callTool('autopilot_log', { last: 2 })).toEqual(entries.slice(-2));
    expect(await callTool('autopilot_log', { last: 'invalid' })).toEqual(entries);
  });

  it('autopilot_log returns an empty list for a corrupt log', async () => {
    writeFixture(LOG_FILE, '{');

    expect(await callTool('autopilot_log')).toEqual([]);
  });

  it('autopilot_progress groups tasks by source and counts terminal statuses case-insensitively', async () => {
    const { team, swarm, checklist } = seedTasks();

    expect(await callTool('autopilot_progress')).toEqual({
      overall: { completed: 1, total: 3, percent: 33 },
      bySource: {
        'team-tasks': { completed: 1, total: 1, tasks: [{ ...team, source: 'team-tasks' }] },
        'swarm-tasks': { completed: 0, total: 1, tasks: [{ ...swarm, source: 'swarm-tasks' }] },
        'file-checklist': { completed: 0, total: 1, tasks: [{ ...checklist, source: 'file-checklist' }] },
      },
    });
  });

  it('autopilot_progress skips a malformed task source and keeps valid tasks', async () => {
    const { checklist } = seedTasks();
    writeFixture('.claude-flow/swarm-tasks.json', '{');
    writeJson(STATE_FILE, { ...initialState, taskSources: ['swarm-tasks', 'file-checklist'] });

    const result = await callTool('autopilot_progress');
    expect(result).toEqual({
      overall: { completed: 0, total: 1, percent: 0 },
      bySource: {
        'file-checklist': { completed: 0, total: 1, tasks: [{ ...checklist, source: 'file-checklist' }] },
      },
    });
  });

  it('autopilot_learn returns metrics and success patterns from the learning backend', async () => {
    const metrics = { totalEpisodes: 4 };
    const patterns = [{ action: 'Run focused tests' }];
    const getMetrics = vi.fn().mockResolvedValue(metrics);
    const discoverSuccessPatterns = vi.fn().mockResolvedValue(patterns);
    vi.mocked(tryLoadLearning).mockResolvedValue({
      initialize: async () => true,
      getMetrics,
      discoverSuccessPatterns,
    });

    expect(await callTool('autopilot_learn')).toEqual({ metrics, patterns });
    expect(getMetrics).toHaveBeenCalledOnce();
    expect(discoverSuccessPatterns).toHaveBeenCalledOnce();
  });

  it('autopilot_learn reports why the learning backend is unavailable', async () => {
    vi.mocked(getLearningLoadError).mockReturnValue('Fixture learning initialization failed');

    expect(await callTool('autopilot_learn')).toEqual({
      available: false,
      reason: 'Fixture learning initialization failed',
      patterns: [],
    });
  });

  it('autopilot_history searches the learning backend with the query and bounded limit', async () => {
    const results = [{ id: 'episode-1', subject: 'Check parser inputs' }];
    const recallSimilarTasks = vi.fn().mockResolvedValue(results);
    vi.mocked(tryLoadLearning).mockResolvedValue({ initialize: async () => true, recallSimilarTasks });

    expect(await callTool('autopilot_history', { query: 'parser', limit: 500 })).toEqual({ query: 'parser', results });
    expect(recallSimilarTasks).toHaveBeenCalledExactlyOnceWith('parser', 100);
  });

  it('autopilot_history rejects a missing query before loading the backend', async () => {
    expect(await callTool('autopilot_history')).toEqual({
      query: '',
      results: [],
      error: 'query must be a string',
    });
    expect(tryLoadLearning).not.toHaveBeenCalled();
  });

  it('autopilot_history returns an empty result when the backend is unavailable', async () => {
    expect(await callTool('autopilot_history', { query: 'parser' })).toEqual({
      query: 'parser',
      results: [],
      available: false,
    });
  });

  it('autopilot_predict passes persisted state to the learning backend', async () => {
    writeJson(STATE_FILE, initialState);
    const prediction = { action: 'Run focused tests', confidence: 0.9 };
    const predictNextAction = vi.fn().mockResolvedValue(prediction);
    vi.mocked(tryLoadLearning).mockResolvedValue({ initialize: async () => true, predictNextAction });

    expect(await callTool('autopilot_predict')).toEqual(prediction);
    expect(predictNextAction).toHaveBeenCalledExactlyOnceWith(initialState);
  });

  it('autopilot_predict falls back to the first incomplete task when learning is unavailable', async () => {
    const { swarm } = seedTasks();

    expect(await callTool('autopilot_predict')).toEqual({
      action: `Work on: ${swarm.subject}`,
      confidence: 0.5,
      reason: 'Heuristic (learning not available)',
      remaining: 2,
    });
  });

  it('autopilot_predict returns no action when every task is terminal and learning is unavailable', async () => {
    writeJson(STATE_FILE, { ...initialState, taskSources: ['file-checklist'] });
    writeJson('.claude-flow/data/checklist.json', [{ id: 'check-1', done: true }]);

    expect(await callTool('autopilot_predict')).toEqual({
      action: 'none',
      confidence: 1,
      reason: 'All tasks complete',
    });
  });
});
