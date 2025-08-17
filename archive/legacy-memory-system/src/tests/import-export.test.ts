/**
 * SPARC Memory Bank - Import/Export Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ImportExportManager } from '../io/import-export';
import { MemoryItem } from '../types';

describe('ImportExportManager', () => {
  let importExport: ImportExportManager;
  let testItems: MemoryItem[];

  beforeEach(() => {
    importExport = new ImportExportManager();
    
    testItems = [
      {
        id: 'item1',
        category: 'users',
        key: 'alice',
        value: { name: 'Alice', age: 30 },
        metadata: {
          timestamp: Date.now(),
          namespace: 'app1',
          tags: ['active', 'premium']
        }
      },
      {
        id: 'item2',
        category: 'users',
        key: 'bob',
        value: { name: 'Bob', age: 25 },
        metadata: {
          timestamp: Date.now(),
          namespace: 'app1',
          tags: ['active']
        }
      },
      {
        id: 'item3',
        category: 'posts',
        key: 'post1',
        value: { title: 'Hello World', content: 'Test post' },
        metadata: {
          timestamp: Date.now(),
          namespace: 'app1',
          tags: ['featured']
        }
      }
    ];
  });

  describe('JSON Format', () => {
    it('should export to JSON format', async () => {
      const exported = await importExport.export(testItems, {
        format: 'json',
        includeMetadata: true
      });

      expect(typeof exported).toBe('string');
      const parsed = JSON.parse(exported as string);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3);
      expect(parsed[0].id).toBe('item1');
      expect(parsed[0].metadata).toBeDefined();
    });

    it('should export JSON without metadata', async () => {
      const exported = await importExport.export(testItems, {
        format: 'json',
        includeMetadata: false
      });

      const parsed = JSON.parse(exported as string);
      expect(parsed[0].metadata).toBeUndefined();
    });

    it('should import from JSON', async () => {
      const json = JSON.stringify(testItems);
      const imported = await importExport.import(json, {
        format: 'json'
      });

      expect(imported).toHaveLength(3);
      expect(imported[0].id).toBe('item1');
      expect(imported[0].value).toEqual({ name: 'Alice', age: 30 });
    });

    it('should import JSON snapshot format', async () => {
      const snapshot = {
        version: '1.0',
        timestamp: Date.now(),
        nodeId: 'test-node',
        items: testItems
      };

      const json = JSON.stringify(snapshot);
      const imported = await importExport.import(json, {
        format: 'json'
      });

      expect(imported).toHaveLength(3);
    });
  });

  describe('Markdown Format', () => {
    it('should export to Markdown format', async () => {
      const exported = await importExport.export(testItems, {
        format: 'markdown',
        includeMetadata: true
      });

      expect(typeof exported).toBe('string');
      const markdown = exported as string;
      
      expect(markdown).toContain('# Memory Export');
      expect(markdown).toContain('## users');
      expect(markdown).toContain('### alice');
      expect(markdown).toContain('### bob');
      expect(markdown).toContain('## posts');
      expect(markdown).toContain('### post1');
      expect(markdown).toContain('**Metadata**:');
    });

    it('should export Markdown without metadata', async () => {
      const exported = await importExport.export(testItems, {
        format: 'markdown',
        includeMetadata: false
      });

      const markdown = exported as string;
      expect(markdown).not.toContain('**Metadata**:');
    });

    it('should import from Markdown', async () => {
      const markdown = `# Memory Export

## users

### alice

**Metadata**:
- timestamp: ${Date.now()}
- namespace: "app1"
- tags: ["active", "premium"]

**Value**:
\`\`\`json
{
  "name": "Alice",
  "age": 30
}
\`\`\`

---

### bob

**Value**:
Bob's data

---

## posts

### post1

**Value**:
Simple post content

---
`;

      const imported = await importExport.import(markdown, {
        format: 'markdown'
      });

      expect(imported).toHaveLength(3);
      
      const alice = imported.find(i => i.key === 'alice');
      expect(alice).toBeDefined();
      expect(alice?.category).toBe('users');
      expect(alice?.value).toEqual({ name: 'Alice', age: 30 });
      expect(alice?.metadata?.tags).toEqual(['active', 'premium']);

      const bob = imported.find(i => i.key === 'bob');
      expect(bob?.value).toBe("Bob's data");
    });
  });

  describe('CSV Format', () => {
    it('should export to CSV format', async () => {
      const exported = await importExport.export(testItems, {
        format: 'csv',
        includeMetadata: true
      });

      const csv = exported as string;
      const lines = csv.split('\n');
      
      expect(lines[0]).toBe('id,category,key,value,timestamp,namespace,tags');
      expect(lines).toHaveLength(4); // header + 3 items

      // Check first data row
      const firstRow = lines[1].split(',');
      expect(firstRow[0]).toBe('item1');
      expect(firstRow[1]).toBe('users');
      expect(firstRow[2]).toBe('alice');
    });

    it('should handle CSV special characters', async () => {
      const itemWithComma: MemoryItem = {
        id: 'special',
        category: 'test',
        key: 'key,with,commas',
        value: { text: 'Value with "quotes" and, commas' }
      };

      const exported = await importExport.export([itemWithComma], {
        format: 'csv',
        includeMetadata: false
      });

      const csv = exported as string;
      expect(csv).toContain('"key,with,commas"');
      expect(csv).toContain('""quotes""');
    });

    it('should import from CSV', async () => {
      const csv = `id,category,key,value,timestamp,namespace,tags
item1,users,alice,"{""name"":""Alice"",""age"":30}",1234567890,app1,active;premium
item2,users,bob,"{""name"":""Bob""}",1234567891,app1,active`;

      const imported = await importExport.import(csv, {
        format: 'csv'
      });

      expect(imported).toHaveLength(2);
      
      const alice = imported[0];
      expect(alice.id).toBe('item1');
      expect(alice.value).toEqual({ name: 'Alice', age: 30 });
      expect(alice.metadata?.tags).toEqual(['active', 'premium']);
    });
  });

  describe('Compression', () => {
    it('should compress and decompress data', async () => {
      const exported = await importExport.export(testItems, {
        format: 'json',
        includeMetadata: true,
        compress: true
      });

      expect(Buffer.isBuffer(exported)).toBe(true);
      
      // Should be smaller than uncompressed
      const uncompressed = JSON.stringify(testItems);
      expect((exported as Buffer).length).toBeLessThan(uncompressed.length);

      // Should decompress correctly
      const imported = await importExport.import(exported, {
        format: 'json',
        compress: true
      });

      expect(imported).toHaveLength(3);
      expect(imported[0].id).toBe('item1');
    });
  });

  describe('Encryption', () => {
    it('should encrypt and decrypt data', async () => {
      const key = 'test-encryption-key-32-chars-long';
      
      const exported = await importExport.export(testItems, {
        format: 'json',
        includeMetadata: true,
        encryption: {
          algorithm: 'aes-256-cbc',
          key
        }
      });

      expect(Buffer.isBuffer(exported)).toBe(true);
      
      // Encrypted data should not contain readable JSON
      const exportedStr = exported.toString();
      expect(exportedStr).not.toContain('item1');
      expect(exportedStr).not.toContain('Alice');

      // Should decrypt correctly
      const imported = await importExport.import(exported, {
        format: 'json',
        encryption: {
          algorithm: 'aes-256-cbc',
          key
        }
      });

      expect(imported).toHaveLength(3);
      expect(imported[0].id).toBe('item1');
      expect(imported[0].value).toEqual({ name: 'Alice', age: 30 });
    });

    it('should handle compression and encryption together', async () => {
      const key = 'test-encryption-key-32-chars-long';
      
      const exported = await importExport.export(testItems, {
        format: 'json',
        includeMetadata: true,
        compress: true,
        encryption: {
          algorithm: 'aes-256-cbc',
          key
        }
      });

      const imported = await importExport.import(exported, {
        format: 'json',
        compress: true,
        encryption: {
          algorithm: 'aes-256-cbc',
          key
        }
      });

      expect(imported).toHaveLength(3);
      expect(imported[0].id).toBe('item1');
    });
  });

  describe('Snapshot Management', () => {
    it('should create snapshot', () => {
      const snapshot = importExport.createSnapshot(testItems, 'test-node');

      expect(snapshot.version).toBe('1.0');
      expect(snapshot.nodeId).toBe('test-node');
      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.items).toHaveLength(3);
      expect(snapshot.metadata?.itemCount).toBe(3);
      expect(snapshot.metadata?.categories).toContain('users');
      expect(snapshot.metadata?.categories).toContain('posts');
      expect(snapshot.metadata?.namespaces).toContain('app1');
    });

    it('should validate snapshot', () => {
      const validSnapshot = {
        version: '1.0',
        timestamp: Date.now(),
        nodeId: 'test',
        items: testItems
      };

      expect(importExport.validateSnapshot(validSnapshot)).toBe(true);

      const invalidSnapshots = [
        null,
        {},
        { version: '1.0' },
        { version: '1.0', timestamp: Date.now() },
        { version: '1.0', timestamp: Date.now(), nodeId: 'test' },
        { version: '1.0', timestamp: Date.now(), nodeId: 'test', items: 'not-array' }
      ];

      for (const invalid of invalidSnapshots) {
        expect(importExport.validateSnapshot(invalid)).toBe(false);
      }
    });
  });

  describe('Error Handling', () => {
    it('should throw on unsupported format', async () => {
      await expect(
        importExport.export(testItems, { format: 'unsupported' as any })
      ).rejects.toThrow('Unsupported export format');

      await expect(
        importExport.import('data', { format: 'unsupported' as any })
      ).rejects.toThrow('Unsupported import format');
    });

    it('should throw on invalid JSON import', async () => {
      await expect(
        importExport.import('invalid json', { format: 'json' })
      ).rejects.toThrow();
    });
  });
});