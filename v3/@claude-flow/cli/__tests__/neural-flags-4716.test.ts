import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTargetCommand } from '../src/command-resolution.js';
import { neuralCommand } from '../src/commands/neural.js';
import { CommandParser } from '../src/parser.js';
import { output } from '../src/output.js';
import type { ParsedFlags } from '../src/types.js';

const { runNativeTraining, trainRouter, writeFileSync } = vi.hoisted(() => ({
  runNativeTraining: vi.fn(async () => ({ steps: 1, finalLoss: 0, checkpointPath: 'mock-checkpoint' })),
  trainRouter: vi.fn(() => ({ router: { toJSON: () => ({}) }, lambda: 0.01, looQuality: 0.9 })),
  writeFileSync: vi.fn(),
}));

vi.mock('../src/services/ruvector-training.js', () => ({
  OperatorType: { COORDINATION: 0, GENERAL: 1 },
}));
vi.mock('../src/memory/memory-initializer.js', () => ({
  generateEmbedding: async () => ({ embedding: [1] }),
}));
vi.mock('../src/memory/intelligence.js', () => ({
  initializeIntelligence: vi.fn(),
  recordStep: vi.fn(),
  recordTrajectory: vi.fn(),
  flushPatterns: vi.fn(),
  getIntelligenceStats: () => ({ reasoningBankSize: 0 }),
  getPersistenceStatus: () => ({ dataDir: '.', patternsFile: 'mock-patterns' }),
}));
vi.mock('../src/services/native-training.js', () => ({ runNativeTraining }));
vi.mock('../src/ruvector/neural-router.js', () => ({
  neuralRouterStatus: async () => ({ config: { seedCorpusPath: 'corpus.json' } }),
}));
vi.mock('@metaharness/router', () => ({ trainRouter }));

// Keep all test inputs and outputs in memory, even for the file-backed handlers.
vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(),
  existsSync: (file: string) => ['corpus.json', 'bandit.json'].includes(file),
  readFileSync: (file: string) => file === 'corpus.json'
    ? JSON.stringify([{ embedding: [1], scores: { haiku: 1 } }])
    : JSON.stringify({ priors: { low: { haiku: { alpha: 3, beta: 1 } } } }),
  writeFileSync,
  statSync: () => ({ size: 2 }),
}));

vi.mock('../src/output.js', () => ({
  output: {
    writeln: vi.fn(),
    printTable: vi.fn(),
    printError: vi.fn(),
    bold: (text: string) => text,
    dim: (text: string) => text,
    success: (text: string) => text,
    createSpinner: () => ({ start() {}, setText() {}, succeed() {}, fail() {} }),
  },
}));

const parser = new CommandParser({ allowUnknownFlags: true });
parser.registerCommand(neuralCommand);

async function run(
  argv: string[],
  legacyFlags: Record<string, ParsedFlags[string]> = {},
  removeParsedKeys: string[] = [],
) {
  const parsed = parser.parse(['neural', ...argv]);
  const { target, args } = resolveTargetCommand(neuralCommand, parsed.command, parsed.positional);
  expect(parser.validateFlags(parsed.flags, target)).toEqual([]);
  const flags = { ...parsed.flags, ...legacyFlags };
  for (const key of removeParsedKeys) delete flags[key];
  return target.action!({ args, flags, cwd: process.cwd(), interactive: false });
}

beforeEach(() => vi.clearAllMocks());

describe('neural flag lookup (#4716)', () => {
  const train = ['train', '--backend', 'native', '--no-wasm', '--epochs', '1', '--dim', '1'];

  it('passes argv learning rate, batch size and zero validation split to native training', async () => {
    const result = await run(
      [...train, '--learning-rate', '0.5', '--batch-size', '4', '--val-split', '0'],
      { 'val-split': '0.2' },
    );
    expect(result).toMatchObject({ success: true });
    expect(runNativeTraining).toHaveBeenCalledWith(expect.objectContaining({
      learningRate: 0.5, batchSize: 4, validationSplit: 0,
    }));
  });

  it('preserves legacy training keys for direct callers', async () => {
    const result = await run(train, {
      'learning-rate': '0.2', 'batch-size': '3', 'val-split': '0.25',
    }, ['learningRate', 'batchSize', 'valSplit']);
    expect(result).toMatchObject({ success: true });
    expect(runNativeTraining).toHaveBeenCalledWith(expect.objectContaining({
      learningRate: 0.2, batchSize: 3, validationSplit: 0.25,
    }));
  });

  it('keeps the training defaults when flags are omitted', async () => {
    const result = await run(train);
    expect(result).toMatchObject({ success: true });
    expect(runNativeTraining).toHaveBeenCalledWith(expect.objectContaining({
      learningRate: 0.01, batchSize: 32, validationSplit: 0.1,
    }));
  });

  it.each([
    { label: 'argv negation', argv: ['--no-strip-pii'], legacy: { 'strip-pii': true }, remove: [], expected: false },
    { label: 'legacy false', argv: [], legacy: { 'strip-pii': false }, remove: ['stripPii'], expected: false },
    { label: 'default', argv: [], legacy: undefined, remove: [], expected: true },
  ])('exports the correct PII setting with $label', async ({ argv, legacy, remove, expected }) => {
    const result = await run(['export', '--no-sign', ...argv], legacy, remove);
    expect(result).toMatchObject({ success: true });
    expect(output.writeln).toHaveBeenCalledWith(expect.stringContaining(`"piiStripped": ${expected}`));
  });

  it.each([
    { label: 'argv', argv: ['--quality-bar', '0.6'], legacy: undefined, remove: [], expected: 0.6 },
    { label: 'explicit zero', argv: ['--quality-bar', '0'], legacy: undefined, remove: [], expected: 0 },
    { label: 'legacy key', argv: [], legacy: { 'quality-bar': '0.7' }, remove: ['qualityBar'], expected: 0.7 },
    { label: 'default', argv: [], legacy: undefined, remove: [], expected: 0.8 },
  ])('passes the router quality bar from $label to training', async ({ argv, legacy, remove, expected }) => {
    const result = await run(['router', 'train', '--corpus', 'corpus.json', ...argv], legacy, remove);
    expect(result).toMatchObject({ success: true });
    expect(trainRouter).toHaveBeenCalledWith(expect.any(Array), expect.any(Object), expect.objectContaining({
      qualityBar: expected,
    }));
  });

  it.each([
    { label: 'argv', argv: ['--cold-threshold', '2'], legacy: undefined, remove: [], expected: 2, cold: false },
    { label: 'explicit zero', argv: ['--cold-threshold', '0'], legacy: undefined, remove: [], expected: 0, cold: false },
    { label: 'legacy key', argv: [], legacy: { 'cold-threshold': '1' }, remove: ['coldThreshold'], expected: 1, cold: false },
    { label: 'default', argv: [], legacy: undefined, remove: [], expected: 4, cold: true },
  ])('classifies bandit cells using the cold threshold from $label', async ({ argv, legacy, remove, expected, cold }) => {
    const result = await run(['router', 'bandit-state', '--path', 'bandit.json', '--format', 'json', ...argv], legacy, remove);
    expect(result).toMatchObject({
      success: true,
      data: { coldThreshold: expected, priors: [{ samples: 2, cold }] },
    });
  });
});
