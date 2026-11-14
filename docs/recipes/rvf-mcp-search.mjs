import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { RvfDatabase } from '@ruvector/rvf';

const dir = await mkdtemp(join(tmpdir(), 'ruflo-rvf-search-'));
const file = join(dir, 'demo.rvf');
const sha256 = async () => createHash('sha256').update(await readFile(file)).digest('hex');
const client = new Client({ name: 'ruflo-rvf-search-recipe', version: '1.0.0' });
const server = fileURLToPath(new URL('./node_modules/@ruvector/rvf-mcp-server/dist/cli.js', import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath, args: [server, '--transport', 'stdio', '--data-dir', dir],
  stderr: 'ignore',
});
const call = (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 5000 });
function data(result) {
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}

try {
  const db = await RvfDatabase.create(file, { dimensions: 3, metric: 'l2' }, 'node');
  try {
    await db.ingestBatch([
      { id: '1', vector: new Float32Array([1, 0, 0]) },
      { id: '2', vector: new Float32Array([0, 1, 0]) },
      { id: '3', vector: new Float32Array([0, 0, 1]) },
    ]);
  } finally {
    await db.close();
  }

  const before = await sha256();
  await client.connect(transport, { timeout: 5000 });
  const opened = data(await call('rvf_open_store', { path: 'demo.rvf', readOnly: true }));
  assert.equal(opened.readOnly, true);
  const { storeId } = opened;
  const search = data(await call('rvf_query', { storeId, vector: [1, 0, 0], k: 1 }));
  assert.equal(search.results.length, 1);
  assert.equal(String(search.results[0].id), '1');

  const write = await call('rvf_ingest', { storeId, entries: [{ id: '4', vector: [1, 0, 0] }] });
  assert.match(write.content[0]?.text ?? '', /^Error: store is read-only$/);
  const escaped = await call('rvf_open_store', { path: '../outside.rvf', readOnly: true });
  assert.match(escaped.content[0]?.text ?? '', /^Error: store path must not contain/);

  data(await call('rvf_close_store', { storeId }));
  assert.equal(await sha256(), before, 'read-only queries must not change the RVF');
  console.log('Nearest vector: 1; read-only write rejected; traversal rejected; RVF unchanged.');
} finally {
  try {
    await client.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
