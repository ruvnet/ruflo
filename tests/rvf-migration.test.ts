/**
 * RVF Migration Utility Tests
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { RvfMigrator } from '../v3/@claude-flow/memory/src/rvf-migration.js';
import { RvfBackend } from '../v3/@claude-flow/memory/src/rvf-backend.js';

describe('RvfMigrator', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rvf-mig-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('detectFormat', () => {
    it('detects RVF format by magic bytes', async () => {
      const p = join(tmpDir, 'test.rvf');
      // RVF magic: 0x52 0x56 0x46 0x00
      writeFileSync(p, Buffer.from([0x52, 0x56, 0x46, 0x00, 0x00, 0x00, 0x00, 0x00]));
      assert.equal(await RvfMigrator.detectFormat(p), 'rvf');
    });

    it('detects JSON format', async () => {
      const p = join(tmpDir, 'test.json');
      writeFileSync(p, '[{"id":"1"}]');
      assert.equal(await RvfMigrator.detectFormat(p), 'json');
    });

    it('detects JSON object format', async () => {
      const p = join(tmpDir, 'test.json');
      writeFileSync(p, '{"id":"1"}');
      assert.equal(await RvfMigrator.detectFormat(p), 'json');
    });

    it('returns unknown for non-existent file', async () => {
      assert.equal(await RvfMigrator.detectFormat(join(tmpDir, 'nope')), 'unknown');
    });

    it('returns unknown for unrecognized format', async () => {
      const p = join(tmpDir, 'garbage.bin');
      writeFileSync(p, Buffer.from([0xFF, 0xFE, 0xFD, 0xFC]));
      assert.equal(await RvfMigrator.detectFormat(p), 'unknown');
    });
  });

  describe('fromJsonFile', () => {
    it('migrates a JSON array to RVF', async () => {
      const jsonPath = join(tmpDir, 'source.json');
      const rvfPath = join(tmpDir, 'target.rvf');

      const entries = [
        { id: 'e1', key: 'k1', content: 'hello world', namespace: 'test', type: 'semantic', tags: ['a'], metadata: {} },
        { id: 'e2', key: 'k2', content: 'second entry', namespace: 'test', type: 'document', tags: ['b'], metadata: {} },
      ];
      writeFileSync(jsonPath, JSON.stringify(entries));

      const result = await RvfMigrator.fromJsonFile(jsonPath, rvfPath);
      assert.equal(result.success, true);
      assert.equal(result.entriesMigrated, 2);
      assert.equal(result.sourceFormat, 'json');
      assert.equal(result.targetFormat, 'rvf');
      assert.equal(result.errors.length, 0);
      assert.ok(result.durationMs >= 0);

      // Verify the RVF file is readable
      const backend = new RvfBackend({ databasePath: rvfPath });
      await backend.initialize();
      const e1 = await backend.get('e1');
      assert.ok(e1);
      assert.equal(e1.content, 'hello world');
      await backend.shutdown();
    });

    it('migrates single JSON object (not array)', async () => {
      const jsonPath = join(tmpDir, 'single.json');
      const rvfPath = join(tmpDir, 'single.rvf');

      writeFileSync(jsonPath, JSON.stringify({ id: 'solo', key: 'k', content: 'one entry', namespace: 'ns' }));
      const result = await RvfMigrator.fromJsonFile(jsonPath, rvfPath);
      assert.equal(result.success, true);
      assert.equal(result.entriesMigrated, 1);
    });

    it('reports error on invalid JSON', async () => {
      const jsonPath = join(tmpDir, 'bad.json');
      const rvfPath = join(tmpDir, 'bad.rvf');
      writeFileSync(jsonPath, 'not valid json{{{');

      const result = await RvfMigrator.fromJsonFile(jsonPath, rvfPath);
      assert.equal(result.success, false);
      assert.equal(result.entriesMigrated, 0);
      assert.ok(result.errors.length > 0);
    });

    it('fills in default fields for sparse entries', async () => {
      const jsonPath = join(tmpDir, 'sparse.json');
      const rvfPath = join(tmpDir, 'sparse.rvf');

      writeFileSync(jsonPath, JSON.stringify([{ content: 'minimal' }]));
      const result = await RvfMigrator.fromJsonFile(jsonPath, rvfPath);
      assert.equal(result.success, true);
      assert.equal(result.entriesMigrated, 1);

      const backend = new RvfBackend({ databasePath: rvfPath });
      await backend.initialize();
      const entries = await backend.query({ type: 'hybrid', limit: 100 });
      assert.equal(entries.length, 1);
      assert.equal(entries[0].content, 'minimal');
      assert.equal(entries[0].namespace, 'default');
      assert.ok(entries[0].id); // auto-generated
      await backend.shutdown();
    });

    it('reports progress via callback', async () => {
      const jsonPath = join(tmpDir, 'progress.json');
      const rvfPath = join(tmpDir, 'progress.rvf');

      const entries = Array.from({ length: 10 }, (_, i) => ({
        id: `e${i}`, key: `k${i}`, content: `content ${i}`,
      }));
      writeFileSync(jsonPath, JSON.stringify(entries));

      const progressCalls: Array<{ current: number; total: number; phase: string }> = [];
      await RvfMigrator.fromJsonFile(jsonPath, rvfPath, {
        batchSize: 3,
        onProgress: (p) => progressCalls.push({ ...p }),
      });

      assert.ok(progressCalls.length > 0);
      assert.equal(progressCalls[progressCalls.length - 1].total, 10);
    });
  });

  describe('toJsonFile', () => {
    it('exports RVF to JSON and back', async () => {
      const rvfPath = join(tmpDir, 'roundtrip.rvf');
      const jsonPath = join(tmpDir, 'export.json');

      // Create RVF with entries
      const backend = new RvfBackend({ databasePath: rvfPath });
      await backend.initialize();
      await backend.store({
        id: 'rt1', key: 'k1', content: 'roundtrip test', namespace: 'ns',
        type: 'semantic', tags: ['rt'], metadata: {}, accessLevel: 'private',
        createdAt: Date.now(), updatedAt: Date.now(), version: 1,
        references: [], accessCount: 0, lastAccessedAt: Date.now(),
      });
      await backend.shutdown();

      // Export to JSON
      const result = await RvfMigrator.toJsonFile(rvfPath, jsonPath);
      assert.equal(result.success, true);
      assert.equal(result.entriesMigrated, 1);
      assert.equal(result.sourceFormat, 'rvf');
      assert.equal(result.targetFormat, 'json');

      // Verify JSON file
      const exported = JSON.parse(readFileSync(jsonPath, 'utf-8'));
      assert.ok(Array.isArray(exported));
      assert.equal(exported.length, 1);
      assert.equal(exported[0].id, 'rt1');
      assert.equal(exported[0].content, 'roundtrip test');
    });
  });

  describe('autoMigrate', () => {
    it('auto-detects JSON and migrates', async () => {
      const jsonPath = join(tmpDir, 'auto.json');
      const rvfPath = join(tmpDir, 'auto.rvf');

      writeFileSync(jsonPath, JSON.stringify([
        { id: 'am1', key: 'k', content: 'auto migrate test' },
      ]));

      const result = await RvfMigrator.autoMigrate(jsonPath, rvfPath);
      assert.equal(result.success, true);
      assert.equal(result.entriesMigrated, 1);
      assert.equal(result.sourceFormat, 'json');
    });

    it('returns no-op for RVF source', async () => {
      const rvfPath = join(tmpDir, 'existing.rvf');
      const targetPath = join(tmpDir, 'target.rvf');

      // Create a valid RVF file with at least one entry so it persists
      const backend = new RvfBackend({ databasePath: rvfPath });
      await backend.initialize();
      await backend.store({
        id: 'x', key: 'k', content: 'test', type: 'semantic', namespace: 'ns',
        tags: [], metadata: {}, accessLevel: 'private',
        createdAt: Date.now(), updatedAt: Date.now(), version: 1,
        references: [], accessCount: 0, lastAccessedAt: Date.now(),
      });
      await backend.shutdown();

      const result = await RvfMigrator.autoMigrate(rvfPath, targetPath);
      assert.equal(result.success, true);
      assert.equal(result.entriesMigrated, 0);
      assert.equal(result.sourceFormat, 'rvf');
    });

    it('returns error for unknown format', async () => {
      const result = await RvfMigrator.autoMigrate(join(tmpDir, 'nonexistent'), join(tmpDir, 'out.rvf'));
      assert.equal(result.success, false);
      assert.ok(result.errors.length > 0);
    });
  });

  describe('embeddings migration', () => {
    it('preserves embeddings through JSON roundtrip', async () => {
      const jsonPath = join(tmpDir, 'emb.json');
      const rvfPath = join(tmpDir, 'emb.rvf');
      const jsonOutPath = join(tmpDir, 'emb-out.json');

      const embedding = [0.1, 0.2, 0.3, 0.4];
      writeFileSync(jsonPath, JSON.stringify([
        { id: 'emb1', key: 'k', content: 'with embedding', embedding },
      ]));

      await RvfMigrator.fromJsonFile(jsonPath, rvfPath);
      await RvfMigrator.toJsonFile(rvfPath, jsonOutPath);

      const exported = JSON.parse(readFileSync(jsonOutPath, 'utf-8'));
      assert.equal(exported.length, 1);
      assert.ok(Array.isArray(exported[0].embedding));
      // Check values are close (float32 precision)
      for (let i = 0; i < embedding.length; i++) {
        assert.ok(Math.abs(exported[0].embedding[i] - embedding[i]) < 0.001);
      }
    });
  });
});
