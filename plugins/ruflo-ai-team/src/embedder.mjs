// Semantic embeddings through Cognitum's managed /v1/embeddings (ADR-218): OpenAI-shaped,
// 384-dim, `embeddings:run` scope. The key belongs to this service, never to a tenant, and is
// read from the environment only. Failures never reach a tool caller: the vector memory falls
// back to the labelled lexical index, and this client backs off after an error.

export const EMBEDDING_MODEL = 'cognitum-embed';
export const EMBEDDING_DIMENSIONS = 384;
const DEFAULT_URL = 'https://api.cognitum.one/v1/embeddings';
const MAX_BATCH = 64;
const MAX_TEXT = 8000;

export class EmbedError extends Error { constructor(message) { super(message); this.name = 'EmbedError'; } }

const unit = (vector) => {
  let norm = 0; for (const n of vector) norm += n * n;
  norm = Math.sqrt(norm) || 1;
  return Float32Array.from(vector, (n) => n / norm);
};

export class CognitumEmbedder {
  #apiKey; #url; #fetch; #now; #cooldownMs; #timeoutMs; #blockedUntil = 0;
  constructor({ apiKey, url = DEFAULT_URL, fetchImpl = fetch, now = Date.now, cooldownMs = 30_000, timeoutMs = 5000 } = {}) {
    if (!apiKey) throw new EmbedError('embeddings key is required');
    this.#apiKey = apiKey; this.#url = url; this.#fetch = fetchImpl; this.#now = now; this.#cooldownMs = cooldownMs; this.#timeoutMs = timeoutMs;
    this.model = EMBEDDING_MODEL; this.dimensions = EMBEDDING_DIMENSIONS;
  }
  get available() { return this.#now() >= this.#blockedUntil; }
  async embed(texts) {
    if (!this.available) throw new EmbedError('embeddings temporarily unavailable');
    const out = [];
    try {
      for (let i = 0; i < texts.length; i += MAX_BATCH) out.push(...await this.#batch(texts.slice(i, i + MAX_BATCH)));
    } catch (error) {
      this.#blockedUntil = this.#now() + this.#cooldownMs;
      // Deliberately a fresh message: the underlying error may carry request details.
      throw new EmbedError(`embeddings request failed (${error instanceof EmbedError ? error.message : error?.name || 'error'})`);
    }
    return out;
  }
  async #batch(texts) {
    const response = await this.#fetch(this.#url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.#apiKey}` },
      body: JSON.stringify({ model: this.model, input: texts.map((t) => String(t).slice(0, MAX_TEXT)) }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) throw new EmbedError(`status ${response.status}`);
    const data = (await response.json())?.data;
    if (!Array.isArray(data) || data.length !== texts.length) throw new EmbedError('unexpected response shape');
    return [...data].sort((a, b) => a.index - b.index).map((row) => {
      const v = row?.embedding;
      if (!Array.isArray(v) || v.length !== this.dimensions || !v.every(Number.isFinite)) throw new EmbedError('invalid embedding');
      return unit(v);
    });
  }
}

export function embedderFromEnv(env = process.env) {
  const apiKey = env.RUFLO_AI_TEAM_EMBEDDINGS_KEY;
  if (!apiKey) return null;
  const raw = env.RUFLO_AI_TEAM_EMBEDDINGS_URL || DEFAULT_URL;
  const url = new URL(raw);
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !loopback) throw new EmbedError('embeddings URL must use https');
  if (!loopback && url.hostname !== 'cognitum.one' && !url.hostname.endsWith('.cognitum.one')) throw new EmbedError('embeddings URL host must be a cognitum.one host');
  return new CognitumEmbedder({ apiKey, url: url.toString() });
}
