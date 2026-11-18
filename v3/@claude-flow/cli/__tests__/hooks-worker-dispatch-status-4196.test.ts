import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ call: vi.fn(), table: vi.fn(), warn: vi.fn() }));
vi.mock('../src/mcp-client.js', () => ({ callMCPTool: mocks.call, MCPClientError: class extends Error {} }));
vi.mock('../src/output.js', () => ({
  output: new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'printTable') return mocks.table;
      if (prop === 'printWarning') return mocks.warn;
      if (prop === 'createSpinner') return () => ({ start() {}, succeed() {}, fail() {}, stop() {} });
      return (value: unknown) => value;
    },
  }),
}));
import { hooksCommand } from '../src/commands/hooks.js';
import { resolveTargetCommand } from '../src/command-resolution.js';
import { CommandParser } from '../src/parser.js';

const worker = hooksCommand.subcommands!.find(c => c.name === 'worker')!;
const dispatch = worker.subcommands!.find(c => c.name === 'dispatch')!;
const run = () => dispatch.action!({ args: [], flags: { trigger: 'document' } } as any);
const toolResult = (status: string, note?: string) => ({
  success: true, workerId: 'worker_1', trigger: 'document', context: 'default', priority: 'normal',
  config: { description: 'd', estimatedDuration: '1m', capabilities: ['a'] }, status, note,
});
const statusCell = () => mocks.table.mock.calls[0][0].data.find((r: { field: string }) => r.field === 'Status').value;

beforeEach(() => { mocks.call.mockReset(); mocks.table.mockReset(); mocks.warn.mockReset(); });

describe('hooks worker dispatch status (#4196)', () => {
  it('does not report "completed" when no daemon ran anything, and shows why', async () => {
    mocks.call.mockResolvedValue(toolResult('no-daemon', 'No worker daemon detected.'));
    await run();
    expect(statusCell()).not.toContain('completed');
    expect(statusCell()).toContain('no-daemon');
    expect(mocks.warn).toHaveBeenCalledWith('No worker daemon detected.');
  });

  it('reports a queued worker as queued', async () => {
    mocks.call.mockResolvedValue(toolResult('queued'));
    await run();
    expect(statusCell()).toContain('queued');
    expect(statusCell()).not.toContain('completed');
  });

  it('still reports a real completed status as completed', async () => {
    mocks.call.mockResolvedValue(toolResult('completed'));
    await run();
    expect(statusCell()).toContain('completed');
  });
});

describe('hooks worker detect flags (#4717)', () => {
  function detect(...options: string[]) {
    const parser = new CommandParser();
    parser.registerCommand(hooksCommand);
    const { command, flags, positional } = parser.parse([
      'hooks', 'worker', 'detect', '-p', 'security audit', ...options,
    ]);
    const { target, args } = resolveTargetCommand(hooksCommand, command, positional);
    expect(target.name).toBe('detect');
    expect(parser.validateFlags(flags, target)).toEqual([]);
    return target.action!({ args, flags, cwd: process.cwd(), interactive: false });
  }

  it.each([
    { options: ['--auto-dispatch', '--min-confidence', '0.8'], autoDispatch: true, minConfidence: 0.8 },
    { options: ['--no-auto-dispatch', '--min-confidence', '0'], autoDispatch: false, minConfidence: 0 },
    { options: [], autoDispatch: undefined, minConfidence: 0.5 },
  ])('forwards autoDispatch=$autoDispatch and minConfidence=$minConfidence', async ({
    options, autoDispatch, minConfidence,
  }) => {
    const prompt = 'security audit';
    mocks.call.mockResolvedValue({ prompt, detection: { detected: false, confidence: 0 }, triggersFound: 0 });
    expect(await detect(...options)).toMatchObject({ success: true });
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith('hooks_worker-detect', {
      prompt, autoDispatch, minConfidence,
    });
  });

  it('shows the server warning when auto-dispatch only creates synthetic records', async () => {
    const note = 'No executor ran: these worker records are synthetic placeholders.';
    mocks.call.mockResolvedValue({
      prompt: 'security audit',
      detection: { detected: true, confidence: 1 },
      triggersFound: 1,
      autoDispatched: true,
      autoDispatchStatus: 'synthetic-completed',
      workerIds: ['worker_1'],
      note,
    });
    expect(await detect('--auto-dispatch')).toMatchObject({ success: true });
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(note);
  });
});
