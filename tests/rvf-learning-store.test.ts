/**
 * Tests for RvfLearningStore
 *
 * Covers initialization, pattern/LoRA/EWC/trajectory CRUD, persistence
 * with RVLS magic header, stats, error handling, and edge cases.
 *
 * Run: npx tsx --test tests/rvf-learning-store.test.ts
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  RvfLearningStore,
  type PatternRecord,
  type LoraRecord,
  type EwcRecord,
  type TrajectoryRecord,
} from '../v3/@claude-flow/memory/src/rvf-learning-store.js';

// ===== Fixtures =====

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rvf-test-'));
}

function makePattern(overrides: Partial<PatternRecord> = {}): PatternRecord {
  return {
    id: 'p1',
    type: 'query_response',
    embedding: [0.1, 0.2, 0.3],
    successRate: 0.95,
    useCount: 10,
    lastUsed: new Date().toISOString(),
    ...overrides,
  };
}

function makeLora(overrides: Partial<LoraRecord> = {}): LoraRecord {
  return {
    id: 'lora-1',
    config: { rank: 8 },
    weights: 'base64weights==',
    frozen: false,
    numParameters: 1024,
    ...overrides,
  };
}

function makeEwc(overrides: Partial<EwcRecord> = {}): EwcRecord {
  return {
    tasksLearned: 5,
    protectionStrength: 0.8,
    forgettingRate: 0.02,
    taskWeights: { task1: [0.1, 0.2], task2: [0.3, 0.4] },
    ...overrides,
  };
}

function makeTrajectory(overrides: Partial<TrajectoryRecord> = {}): TrajectoryRecord {
  return {
    id: 'traj-1',
    steps: [
      { type: 'query', input: 'hello', output: 'world', durationMs: 50, confidence: 0.9 },
    ],
    outcome: 'success',
    durationMs: 100,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ===== Tests =====

describe('RvfLearningStore', () => {
  let dir: string;
  let storePath: string;
  let store: RvfLearningStore;

  beforeEach(() => {
    dir = tmpDir();
    storePath = path.join(dir, 'test.rvls');
    store = new RvfLearningStore({ storePath, autoPersistInterval: 0 });
  });

  afterEach(async () => {
    try { await store.close(); } catch { /* already closed or not initialized */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ===== 1. Initialize =====

  describe('initialize', () => {
    it('creates parent directory if it does not exist', async () => {
      const nested = path.join(dir, 'deep', 'nested', 'store.rvls');
      const s = new RvfLearningStore({ storePath: nested, autoPersistInterval: 0 });
      await s.initialize();
      assert.ok(fs.existsSync(path.dirname(nested)));
      await s.close();
    });

    it('loads existing data on init', async () => {
      await store.initialize();
      await store.savePatterns([makePattern()]);
      await store.persist();
      await store.close();

      const store2 = new RvfLearningStore({ storePath, autoPersistInterval: 0 });
      await store2.initialize();
      const patterns = await store2.loadPatterns();
      assert.equal(patterns.length, 1);
      assert.equal(patterns[0].id, 'p1');
      await store2.close();
    });

    it('is idempotent when called twice', async () => {
      await store.initialize();
      await store.initialize(); // should not throw
      const count = await store.getPatternCount();
      assert.equal(count, 0);
    });
  });

  // ===== 2. Patterns =====

  describe('patterns', () => {
    before(async () => {});

    it('savePatterns stores and loadPatterns retrieves', async () => {
      await store.initialize();
      const saved = await store.savePatterns([makePattern(), makePattern({ id: 'p2' })]);
      assert.equal(saved, 2);
      const loaded = await store.loadPatterns();
      assert.equal(loaded.length, 2);
      const ids = loaded.map((p) => p.id).sort();
      assert.deepEqual(ids, ['p1', 'p2']);
    });

    it('getPatternCount returns correct count', async () => {
      await store.initialize();
      assert.equal(await store.getPatternCount(), 0);
      await store.savePatterns([makePattern()]);
      assert.equal(await store.getPatternCount(), 1);
      await store.savePatterns([makePattern({ id: 'p2' }), makePattern({ id: 'p3' })]);
      assert.equal(await store.getPatternCount(), 3);
    });

    it('updates existing pattern when ID matches', async () => {
      await store.initialize();
      await store.savePatterns([makePattern({ successRate: 0.5 })]);
      await store.savePatterns([makePattern({ successRate: 0.99 })]);
      assert.equal(await store.getPatternCount(), 1);
      const loaded = await store.loadPatterns();
      assert.equal(loaded[0].successRate, 0.99);
    });
  });

  // ===== 3. LoRA =====

  describe('lora', () => {
    it('saveLoraAdapter stores and loadLoraAdapters retrieves', async () => {
      await store.initialize();
      await store.saveLoraAdapter(makeLora());
      const adapters = await store.loadLoraAdapters();
      assert.equal(adapters.length, 1);
      assert.equal(adapters[0].id, 'lora-1');
      assert.equal(adapters[0].numParameters, 1024);
    });

    it('deleteLoraAdapter removes adapter and returns true', async () => {
      await store.initialize();
      await store.saveLoraAdapter(makeLora());
      const deleted = await store.deleteLoraAdapter('lora-1');
      assert.equal(deleted, true);
      const adapters = await store.loadLoraAdapters();
      assert.equal(adapters.length, 0);
    });

    it('deleteLoraAdapter returns false for nonexistent ID', async () => {
      await store.initialize();
      const deleted = await store.deleteLoraAdapter('nope');
      assert.equal(deleted, false);
    });
  });

  // ===== 4. EWC =====

  describe('ewc', () => {
    it('saveEwcState stores and loadEwcState retrieves', async () => {
      await store.initialize();
      await store.saveEwcState(makeEwc());
      const state = await store.loadEwcState();
      assert.ok(state);
      assert.equal(state.tasksLearned, 5);
      assert.equal(state.protectionStrength, 0.8);
    });

    it('loadEwcState returns null when no state stored', async () => {
      await store.initialize();
      const state = await store.loadEwcState();
      assert.equal(state, null);
    });

    it('saveEwcState replaces previous state', async () => {
      await store.initialize();
      await store.saveEwcState(makeEwc({ tasksLearned: 3 }));
      await store.saveEwcState(makeEwc({ tasksLearned: 10 }));
      const state = await store.loadEwcState();
      assert.ok(state);
      assert.equal(state.tasksLearned, 10);
    });
  });

  // ===== 5. Trajectories =====

  describe('trajectories', () => {
    it('appendTrajectory adds a record', async () => {
      await store.initialize();
      await store.appendTrajectory(makeTrajectory());
      assert.equal(await store.getTrajectoryCount(), 1);
    });

    it('getTrajectories returns newest first', async () => {
      await store.initialize();
      await store.appendTrajectory(makeTrajectory({ id: 't1', timestamp: '2026-01-01' }));
      await store.appendTrajectory(makeTrajectory({ id: 't2', timestamp: '2026-01-02' }));
      await store.appendTrajectory(makeTrajectory({ id: 't3', timestamp: '2026-01-03' }));
      const trajs = await store.getTrajectories();
      assert.equal(trajs.length, 3);
      assert.equal(trajs[0].id, 't3'); // newest (last appended) first
      assert.equal(trajs[2].id, 't1');
    });

    it('getTrajectoryCount returns correct count', async () => {
      await store.initialize();
      assert.equal(await store.getTrajectoryCount(), 0);
      await store.appendTrajectory(makeTrajectory({ id: 't1' }));
      await store.appendTrajectory(makeTrajectory({ id: 't2' }));
      assert.equal(await store.getTrajectoryCount(), 2);
    });

    it('limit parameter restricts results', async () => {
      await store.initialize();
      for (let i = 0; i < 5; i++) {
        await store.appendTrajectory(makeTrajectory({ id: `t${i}` }));
      }
      const limited = await store.getTrajectories(2);
      assert.equal(limited.length, 2);
      assert.equal(limited[0].id, 't4'); // newest first
      assert.equal(limited[1].id, 't3');
    });
  });

  // ===== 6. Persistence =====

  describe('persistence', () => {
    it('persist() writes file to disk', async () => {
      await store.initialize();
      await store.savePatterns([makePattern()]);
      assert.ok(!fs.existsSync(storePath)); // not yet persisted
      await store.persist();
      assert.ok(fs.existsSync(storePath));
    });

    it('data survives close and reinitialize', async () => {
      await store.initialize();
      await store.savePatterns([makePattern(), makePattern({ id: 'p2' })]);
      await store.saveLoraAdapter(makeLora());
      await store.saveEwcState(makeEwc());
      await store.appendTrajectory(makeTrajectory());
      await store.persist();
      await store.close();

      const store2 = new RvfLearningStore({ storePath, autoPersistInterval: 0 });
      await store2.initialize();
      assert.equal(await store2.getPatternCount(), 2);
      assert.equal((await store2.loadLoraAdapters()).length, 1);
      assert.ok(await store2.loadEwcState());
      assert.equal(await store2.getTrajectoryCount(), 1);
      await store2.close();
    });

    it('file starts with RVLS magic header', async () => {
      await store.initialize();
      await store.savePatterns([makePattern()]);
      await store.persist();
      const content = fs.readFileSync(storePath, 'utf-8');
      assert.ok(content.startsWith('RVLS\n'));
    });

    it('skips persist when store is not dirty', async () => {
      await store.initialize();
      await store.persist(); // nothing changed, should be no-op
      assert.ok(!fs.existsSync(storePath));
    });

    it('close() auto-persists dirty state', async () => {
      await store.initialize();
      await store.savePatterns([makePattern()]);
      await store.close();
      assert.ok(fs.existsSync(storePath));

      const store2 = new RvfLearningStore({ storePath, autoPersistInterval: 0 });
      await store2.initialize();
      assert.equal(await store2.getPatternCount(), 1);
      await store2.close();
    });
  });

  // ===== 7. Stats =====

  describe('stats', () => {
    it('returns correct counts and file size', async () => {
      await store.initialize();
      await store.savePatterns([makePattern(), makePattern({ id: 'p2' })]);
      await store.saveLoraAdapter(makeLora());
      await store.saveEwcState(makeEwc());
      await store.appendTrajectory(makeTrajectory());
      await store.appendTrajectory(makeTrajectory({ id: 't2' }));
      await store.persist();

      const stats = await store.getStats();
      assert.equal(stats.patterns, 2);
      assert.equal(stats.loraAdapters, 1);
      assert.equal(stats.trajectories, 2);
      assert.equal(stats.hasEwcState, true);
      assert.ok(stats.fileSizeBytes > 0);
    });

    it('fileSizeBytes is 0 when nothing persisted', async () => {
      await store.initialize();
      const stats = await store.getStats();
      assert.equal(stats.fileSizeBytes, 0);
      assert.equal(stats.hasEwcState, false);
    });
  });

  // ===== 8. Error Handling =====

  describe('error handling', () => {
    it('operations before initialize throw', async () => {
      const uninit = new RvfLearningStore({ storePath, autoPersistInterval: 0 });
      await assert.rejects(() => uninit.savePatterns([makePattern()]), {
        message: /not been initialized/,
      });
      await assert.rejects(() => uninit.loadPatterns(), { message: /not been initialized/ });
      await assert.rejects(() => uninit.getPatternCount(), { message: /not been initialized/ });
      await assert.rejects(() => uninit.saveLoraAdapter(makeLora()), {
        message: /not been initialized/,
      });
      await assert.rejects(() => uninit.loadLoraAdapters(), { message: /not been initialized/ });
      await assert.rejects(() => uninit.deleteLoraAdapter('x'), {
        message: /not been initialized/,
      });
      await assert.rejects(() => uninit.saveEwcState(makeEwc()), {
        message: /not been initialized/,
      });
      await assert.rejects(() => uninit.loadEwcState(), { message: /not been initialized/ });
      await assert.rejects(() => uninit.appendTrajectory(makeTrajectory()), {
        message: /not been initialized/,
      });
      await assert.rejects(() => uninit.getTrajectories(), { message: /not been initialized/ });
      await assert.rejects(() => uninit.getTrajectoryCount(), {
        message: /not been initialized/,
      });
      await assert.rejects(() => uninit.getStats(), { message: /not been initialized/ });
    });

    it('corrupt file is handled gracefully (bad header)', async () => {
      fs.writeFileSync(storePath, 'NOT_RVLS\n{"type":"pattern","data":{}}\n');
      await store.initialize(); // should not throw
      assert.equal(await store.getPatternCount(), 0);
    });

    it('corrupt file is handled gracefully (bad JSON lines)', async () => {
      fs.writeFileSync(storePath, 'RVLS\n{invalid json}\n{"type":"pattern","data":' +
        JSON.stringify(makePattern()) + '}\n');
      await store.initialize(); // should not throw, skips bad line
      assert.equal(await store.getPatternCount(), 1);
    });
  });

  // ===== 9. Edge Cases =====

  describe('edge cases', () => {
    it('empty store returns empty arrays and zero counts', async () => {
      await store.initialize();
      assert.deepEqual(await store.loadPatterns(), []);
      assert.deepEqual(await store.loadLoraAdapters(), []);
      assert.equal(await store.loadEwcState(), null);
      assert.deepEqual(await store.getTrajectories(), []);
      assert.equal(await store.getPatternCount(), 0);
      assert.equal(await store.getTrajectoryCount(), 0);
    });

    it('large number of entries persists and reloads correctly', async () => {
      await store.initialize();
      const patterns: PatternRecord[] = [];
      for (let i = 0; i < 200; i++) {
        patterns.push(makePattern({ id: `p${i}`, useCount: i }));
      }
      await store.savePatterns(patterns);
      for (let i = 0; i < 50; i++) {
        await store.appendTrajectory(makeTrajectory({ id: `t${i}` }));
      }
      await store.persist();
      await store.close();

      const store2 = new RvfLearningStore({ storePath, autoPersistInterval: 0 });
      await store2.initialize();
      assert.equal(await store2.getPatternCount(), 200);
      assert.equal(await store2.getTrajectoryCount(), 50);
      const last = (await store2.loadPatterns()).find((p) => p.id === 'p199');
      assert.ok(last);
      assert.equal(last.useCount, 199);
      await store2.close();
    });

    it('savePatterns returns count of items passed', async () => {
      await store.initialize();
      assert.equal(await store.savePatterns([]), 0);
      assert.equal(await store.savePatterns([makePattern()]), 1);
    });

    it('stored data is a copy, not a reference', async () => {
      await store.initialize();
      const p = makePattern();
      await store.savePatterns([p]);
      p.successRate = 0.0; // mutate original
      const loaded = await store.loadPatterns();
      assert.equal(loaded[0].successRate, 0.95); // should still be original value
    });

    it('getTrajectories with limit larger than count returns all', async () => {
      await store.initialize();
      await store.appendTrajectory(makeTrajectory({ id: 't1' }));
      const result = await store.getTrajectories(100);
      assert.equal(result.length, 1);
    });
  });
});
