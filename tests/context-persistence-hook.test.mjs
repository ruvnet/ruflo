import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// Import the module under test
const mod = await import('../.claude/helpers/context-persistence-hook.mjs');
const {
  JsonFileBackend,
  createHashEmbedding,
  hashContent,
  parseTranscript,
  extractTextContent,
  extractToolCalls,
  extractFilePaths,
  chunkTranscript,
  extractSummary,
  buildEntry,
  storeChunks,
  retrieveContext,
  NAMESPACE,
} = mod;

// Test fixtures
const TMP_DIR = join(__dirname, '.tmp-ctx-test');
const TMP_ARCHIVE = join(TMP_DIR, 'test-archive.json');
const TMP_TRANSCRIPT = join(TMP_DIR, 'test-transcript.jsonl');

function makeUserMsg(text) {
  return { role: 'user', content: [{ type: 'text', text }] };
}

function makeAssistantMsg(text, toolCalls = []) {
  const content = [{ type: 'text', text }];
  for (const tc of toolCalls) {
    content.push({ type: 'tool_use', name: tc.name, input: tc.input });
  }
  return { role: 'assistant', content };
}

function makeToolResultMsg(toolUseId, content) {
  return { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] };
}

// Setup / teardown
before(() => {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
});

after(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
});

// ============================================================================
// Tests
// ============================================================================

describe('JsonFileBackend', () => {
  it('should initialize empty', async () => {
    const backend = new JsonFileBackend(join(TMP_DIR, 'empty.json'));
    await backend.initialize();
    const count = await backend.count();
    assert.equal(count, 0);
    await backend.shutdown();
  });

  it('should store and query entries', async () => {
    const path = join(TMP_DIR, 'store-test.json');
    const backend = new JsonFileBackend(path);
    await backend.initialize();

    await backend.store({ id: '1', namespace: 'ns1', content: 'hello', metadata: {} });
    await backend.store({ id: '2', namespace: 'ns2', content: 'world', metadata: {} });

    const all = await backend.query({});
    assert.equal(all.length, 2);

    const ns1 = await backend.query({ namespace: 'ns1' });
    assert.equal(ns1.length, 1);
    assert.equal(ns1[0].content, 'hello');

    await backend.shutdown();
  });

  it('should persist and reload', async () => {
    const path = join(TMP_DIR, 'persist-test.json');
    const b1 = new JsonFileBackend(path);
    await b1.initialize();
    await b1.store({ id: 'x', namespace: 'test', content: 'persisted', metadata: {} });
    await b1.shutdown();

    const b2 = new JsonFileBackend(path);
    await b2.initialize();
    const results = await b2.query({ namespace: 'test' });
    assert.equal(results.length, 1);
    assert.equal(results[0].content, 'persisted');
    await b2.shutdown();
  });

  it('should bulk insert entries', async () => {
    const path = join(TMP_DIR, 'bulk-test.json');
    const backend = new JsonFileBackend(path);
    await backend.initialize();

    const entries = [
      { id: 'b1', namespace: 'ns', content: 'a', metadata: {} },
      { id: 'b2', namespace: 'ns', content: 'b', metadata: {} },
      { id: 'b3', namespace: 'ns', content: 'c', metadata: {} },
    ];
    await backend.bulkInsert(entries);
    const count = await backend.count('ns');
    assert.equal(count, 3);
    await backend.shutdown();
  });
});

describe('createHashEmbedding', () => {
  it('should produce 768-dimensional embedding', () => {
    const emb = createHashEmbedding('hello world');
    assert.equal(emb.length, 768);
    assert.ok(emb instanceof Float32Array);
  });

  it('should be L2-normalized', () => {
    const emb = createHashEmbedding('test embedding normalization');
    let norm = 0;
    for (let i = 0; i < emb.length; i++) norm += emb[i] * emb[i];
    norm = Math.sqrt(norm);
    assert.ok(Math.abs(norm - 1.0) < 0.001, `Norm should be ~1.0, got ${norm}`);
  });

  it('should be deterministic', () => {
    const a = createHashEmbedding('deterministic test');
    const b = createHashEmbedding('deterministic test');
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i], b[i]);
    }
  });

  it('should produce different embeddings for different text', () => {
    const a = createHashEmbedding('hello');
    const b = createHashEmbedding('goodbye');
    let same = true;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) { same = false; break; }
    }
    assert.ok(!same, 'Different texts should produce different embeddings');
  });

  it('should support custom dimensions', () => {
    const emb = createHashEmbedding('test', 128);
    assert.equal(emb.length, 128);
  });
});

describe('hashContent', () => {
  it('should produce SHA-256 hex string', () => {
    const h = hashContent('hello');
    assert.equal(h.length, 64);
    assert.match(h, /^[a-f0-9]{64}$/);
  });

  it('should be deterministic', () => {
    assert.equal(hashContent('same'), hashContent('same'));
  });

  it('should differ for different content', () => {
    assert.notEqual(hashContent('a'), hashContent('b'));
  });
});

describe('parseTranscript', () => {
  it('should parse JSONL file', () => {
    const lines = [
      JSON.stringify({ role: 'user', content: [{ type: 'text', text: 'hello' }] }),
      JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'hi' }] }),
    ];
    writeFileSync(TMP_TRANSCRIPT, lines.join('\n'), 'utf-8');
    const msgs = parseTranscript(TMP_TRANSCRIPT);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'user');
  });

  it('should return empty for missing file', () => {
    const msgs = parseTranscript('/nonexistent/file.jsonl');
    assert.equal(msgs.length, 0);
  });

  it('should skip malformed lines', () => {
    writeFileSync(TMP_TRANSCRIPT, '{"role":"user"}\nnot json\n{"role":"assistant"}\n', 'utf-8');
    const msgs = parseTranscript(TMP_TRANSCRIPT);
    assert.equal(msgs.length, 2);
  });
});

describe('extractTextContent', () => {
  it('should extract from content array', () => {
    const msg = { content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }] };
    assert.equal(extractTextContent(msg), 'hello\nworld');
  });

  it('should extract from string content', () => {
    const msg = { content: 'simple string' };
    assert.equal(extractTextContent(msg), 'simple string');
  });

  it('should handle null/undefined', () => {
    assert.equal(extractTextContent(null), '');
    assert.equal(extractTextContent(undefined), '');
  });

  it('should skip non-text blocks', () => {
    const msg = { content: [
      { type: 'text', text: 'keep' },
      { type: 'tool_use', name: 'Read' },
      { type: 'text', text: 'this' },
    ]};
    assert.equal(extractTextContent(msg), 'keep\nthis');
  });
});

describe('extractToolCalls', () => {
  it('should extract tool_use blocks', () => {
    const msg = { content: [
      { type: 'text', text: 'hello' },
      { type: 'tool_use', name: 'Edit', input: { file_path: '/src/a.ts' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
    ]};
    const calls = extractToolCalls(msg);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].name, 'Edit');
    assert.equal(calls[1].name, 'Bash');
  });

  it('should return empty for no tool calls', () => {
    const msg = { content: [{ type: 'text', text: 'hello' }] };
    assert.deepEqual(extractToolCalls(msg), []);
  });

  it('should handle null message', () => {
    assert.deepEqual(extractToolCalls(null), []);
  });
});

describe('extractFilePaths', () => {
  it('should extract file_path and path', () => {
    const calls = [
      { name: 'Edit', input: { file_path: '/src/a.ts' } },
      { name: 'Glob', input: { path: '/src' } },
      { name: 'Bash', input: { command: 'ls' } },
    ];
    const paths = extractFilePaths(calls);
    assert.ok(paths.includes('/src/a.ts'));
    assert.ok(paths.includes('/src'));
    assert.equal(paths.length, 2);
  });

  it('should deduplicate paths', () => {
    const calls = [
      { name: 'Read', input: { file_path: '/src/a.ts' } },
      { name: 'Edit', input: { file_path: '/src/a.ts' } },
    ];
    const paths = extractFilePaths(calls);
    assert.equal(paths.length, 1);
  });
});

describe('chunkTranscript', () => {
  it('should group user+assistant pairs into chunks', () => {
    const messages = [
      makeUserMsg('first question'),
      makeAssistantMsg('first answer'),
      makeUserMsg('second question'),
      makeAssistantMsg('second answer'),
    ];
    const chunks = chunkTranscript(messages);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].turnIndex, 0);
    assert.equal(chunks[1].turnIndex, 1);
  });

  it('should skip synthetic tool result messages', () => {
    const messages = [
      makeUserMsg('do something'),
      makeAssistantMsg('running tool', [{ name: 'Bash', input: { command: 'ls' } }]),
      makeToolResultMsg('id1', 'file1.txt'),
      makeAssistantMsg('done'),
    ];
    const chunks = chunkTranscript(messages);
    assert.equal(chunks.length, 1);
  });

  it('should filter out non user/assistant messages', () => {
    const messages = [
      { role: 'system', content: 'init' },
      makeUserMsg('hello'),
      makeAssistantMsg('hi'),
    ];
    const chunks = chunkTranscript(messages);
    assert.equal(chunks.length, 1);
  });

  it('should handle empty messages', () => {
    assert.deepEqual(chunkTranscript([]), []);
  });
});

describe('extractSummary', () => {
  it('should produce summary within 300 chars', () => {
    const chunk = {
      userMessage: makeUserMsg('Implement user authentication with OAuth2 and JWT tokens'),
      assistantMessage: makeAssistantMsg('I\'ll implement OAuth2 authentication. First, let me set up the JWT token validation.'),
      toolCalls: [
        { name: 'Edit', input: { file_path: '/src/auth.ts' } },
        { name: 'Write', input: { file_path: '/src/jwt.ts' } },
      ],
      turnIndex: 0,
    };
    const summary = extractSummary(chunk);
    assert.ok(summary.length <= 300, `Summary too long: ${summary.length}`);
    assert.ok(summary.includes('OAuth2') || summary.includes('authentication'));
    assert.ok(summary.includes('Edit'));
  });

  it('should handle empty chunk', () => {
    const chunk = {
      userMessage: null,
      assistantMessage: null,
      toolCalls: [],
      turnIndex: 0,
    };
    const summary = extractSummary(chunk);
    assert.ok(summary.length <= 300);
  });
});

describe('buildEntry', () => {
  it('should produce valid memory entry', () => {
    const chunk = {
      userMessage: makeUserMsg('test question'),
      assistantMessage: makeAssistantMsg('test answer'),
      toolCalls: [{ name: 'Read', input: { file_path: '/src/x.ts' } }],
      turnIndex: 5,
    };
    const entry = buildEntry(chunk, 'session-123', 'auto', '2026-02-10T00:00:00Z');

    assert.ok(entry.id.startsWith('ctx-'));
    assert.ok(entry.key.startsWith('transcript:session-123:5:'));
    assert.equal(entry.type, 'episodic');
    assert.equal(entry.namespace, NAMESPACE);
    assert.ok(entry.tags.includes('transcript'));
    assert.ok(entry.tags.includes('session-123'));
    assert.ok(entry.tags.includes('Read'));
    assert.equal(entry.metadata.sessionId, 'session-123');
    assert.equal(entry.metadata.chunkIndex, 5);
    assert.ok(entry.metadata.contentHash);
    assert.ok(entry.metadata.summary);
    assert.deepEqual(entry.metadata.filePaths, ['/src/x.ts']);
  });
});

describe('storeChunks', () => {
  it('should store chunks and dedup duplicates', async () => {
    const path = join(TMP_DIR, 'dedup-test.json');
    const backend = new JsonFileBackend(path);
    await backend.initialize();

    const chunks = [
      {
        userMessage: makeUserMsg('hello'),
        assistantMessage: makeAssistantMsg('hi'),
        toolCalls: [],
        turnIndex: 0,
      },
    ];

    // First store
    const r1 = await storeChunks(backend, chunks, 'sess1', 'auto');
    assert.equal(r1.stored, 1);
    assert.equal(r1.deduped, 0);

    // Second store with same content = deduped
    const r2 = await storeChunks(backend, chunks, 'sess1', 'auto');
    assert.equal(r2.stored, 0);
    assert.equal(r2.deduped, 1);

    await backend.shutdown();
  });
});

describe('retrieveContext', () => {
  it('should build restoration text within budget', async () => {
    const path = join(TMP_DIR, 'retrieve-test.json');
    const backend = new JsonFileBackend(path);
    await backend.initialize();

    // Insert some entries
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`,
      namespace: NAMESPACE,
      content: `Turn ${i} content`,
      type: 'episodic',
      metadata: {
        sessionId: 'sess-abc',
        chunkIndex: i,
        summary: `Summary of turn ${i}`,
        toolNames: ['Read', 'Edit'],
        filePaths: ['/src/file.ts'],
      },
    }));
    await backend.bulkInsert(entries);

    const ctx = await retrieveContext(backend, 'sess-abc', 4000);
    assert.ok(ctx.includes('Restored Context'));
    assert.ok(ctx.includes('5 archived turns'));
    assert.ok(ctx.includes('Summary of turn'));
    assert.ok(ctx.length <= 4000);

    await backend.shutdown();
  });

  it('should return empty for unknown session', async () => {
    const path = join(TMP_DIR, 'empty-retrieve.json');
    const backend = new JsonFileBackend(path);
    await backend.initialize();

    const ctx = await retrieveContext(backend, 'unknown-session', 4000);
    assert.equal(ctx, '');

    await backend.shutdown();
  });

  it('should respect budget constraint', async () => {
    const path = join(TMP_DIR, 'budget-test.json');
    const backend = new JsonFileBackend(path);
    await backend.initialize();

    // Insert many entries
    const entries = Array.from({ length: 50 }, (_, i) => ({
      id: `bg${i}`,
      namespace: NAMESPACE,
      content: 'x'.repeat(200),
      type: 'episodic',
      metadata: {
        sessionId: 'budget-sess',
        chunkIndex: i,
        summary: `Long summary text for turn number ${i} that takes up space in the output`,
        toolNames: ['Edit', 'Write', 'Bash'],
        filePaths: ['/src/very/long/file/path/component.tsx'],
      },
    }));
    await backend.bulkInsert(entries);

    const ctx = await retrieveContext(backend, 'budget-sess', 500);
    assert.ok(ctx.length <= 600, `Context too long: ${ctx.length}`); // budget + footer

    await backend.shutdown();
  });
});

describe('no-op conditions', () => {
  it('should not restore on non-compact SessionStart', async () => {
    // The doSessionStart function checks source === 'compact'
    // We test the retrieveContext directly since doSessionStart reads stdin
    const path = join(TMP_DIR, 'noop-test.json');
    const backend = new JsonFileBackend(path);
    await backend.initialize();

    // Even with data, non-matching session returns empty
    await backend.store({
      id: 'noop1',
      namespace: NAMESPACE,
      content: 'data',
      metadata: { sessionId: 'other-session', chunkIndex: 0 },
    });

    const ctx = await retrieveContext(backend, 'my-session', 4000);
    assert.equal(ctx, '');
    await backend.shutdown();
  });
});
