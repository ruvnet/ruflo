import { createHash } from 'node:crypto';
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, embedderFromEnv } from './embedder.mjs';

export function featureVector(text, dimensions = 256) {
  const vector = new Float32Array(dimensions);
  const tokens = String(text).toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
  for (const token of tokens) {
    const digest = createHash('sha256').update(token).digest();
    const slot = digest.readUInt32BE(0) % dimensions;
    vector[slot] += (digest[4] & 1) ? 1 : -1;
  }
  let norm = 0; for (const n of vector) norm += n * n;
  norm = Math.sqrt(norm) || 1; for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  return vector;
}

// Stored vectors are an index detail: never return them to a tool caller.
const publicMemory = ({ embedding: _embedding, ...memory }) => memory;
const cosine = (a, b) => { let total = 0; for (let i = 0; i < a.length; i++) total += a[i] * b[i]; return total; };

export class TenantVectorMemory {
  constructor(store, { dimensions = 256, VectorDb, maxIndexes = 64, embedder = null, maxEmbedPerBuild = 128 } = {}) { this.embedder=embedder; this.maxEmbedPerBuild=maxEmbedPerBuild; this.store=store; this.dimensions=dimensions; this.VectorDb=VectorDb; this.maxIndexes=maxIndexes; this.indexes=new Map(); this.generation=0; }
  #rememberIndex(key, value, generation) {
    // A mutation during asynchronous construction must keep this snapshot uncached.
    if (generation !== this.generation) return value;
    if (this.indexes.has(key)) this.indexes.delete(key);
    this.indexes.set(key, value);
    while (this.indexes.size > this.maxIndexes) this.indexes.delete(this.indexes.keys().next().value);
    return value;
  }
  // Embeds what is missing (bounded per build) and persists each vector so a cold start or a
  // second instance does not pay for it again. Returns null when the embeddings service fails,
  // so the caller falls back to the labelled lexical index rather than a half-semantic one.
  async #semanticItems(tenantId, memories) {
    const usable = (m) => m.embeddingModel === EMBEDDING_MODEL && Array.isArray(m.embedding) && m.embedding.length === EMBEDDING_DIMENSIONS;
    const items = memories.filter(usable).map((m) => ({ m, v: Float32Array.from(m.embedding) }));
    const missing = memories.filter((m) => !usable(m));
    const batch = missing.slice(0, this.maxEmbedPerBuild);
    if (batch.length) {
      let vectors;
      try { vectors = await this.embedder.embed(batch.map((m) => m.text)); } catch { return null; }
      for (let i = 0; i < batch.length; i++) {
        items.push({ m: batch[i], v: vectors[i] });
        // Best effort: a failed write only costs a re-embed next time.
        try { await this.store.setEmbedding?.(tenantId, batch[i].id, { vector: vectors[i], model: EMBEDDING_MODEL, contentHash: batch[i].contentHash }); } catch { /* ignore */ }
      }
    }
    return { items, unindexed: missing.length - batch.length };
  }
  async #index(tenantId, teamId) {
    const key=`${tenantId}:${teamId||'*'}`; if(this.indexes.has(key))return this.indexes.get(key);
    const generation=this.generation;
    const memories=await this.store.listMemories(tenantId,{teamId});
    if (this.embedder?.available) {
      const semantic=await this.#semanticItems(tenantId,memories);
      if (semantic) {
        const value={kind:EMBEDDING_MODEL,degraded:semantic.unindexed>0,unindexed:semantic.unindexed,items:semantic.items};
        // A partial index is not cached, so the next search continues embedding the rest.
        return semantic.unindexed>0?value:this.#rememberIndex(key,value,generation);
      }
    }
    if (this.VectorDb) {
      const db=new this.VectorDb({dimensions:this.dimensions,maxElements:Math.max(1000,memories.length+100)});
      for(const m of memories) await db.insert({id:m.id,vector:featureVector(m.text,this.dimensions)});
      const value={kind:'ruvector-native',degraded:false,db,items:new Map(memories.map(m=>[m.id,m]))}; return this.#rememberIndex(key,value,generation);
    }
    const value={kind:'lexical-degraded',degraded:true,items:memories.map(m=>({m,v:featureVector(m.text,this.dimensions)}))}; return this.#rememberIndex(key,value,generation);
  }
  // Best-effort embed-on-write so the first search after a write does not pay for it.
  async embedOne(tenantId, memory) {
    if (!this.embedder?.available) return false;
    try {
      const [vector] = await this.embedder.embed([memory.text]);
      return await this.store.setEmbedding?.(tenantId, memory.id, { vector, model: EMBEDDING_MODEL, contentHash: memory.contentHash }) ?? false;
    } catch { return false; }
  }
  invalidate(tenantId) { this.generation++; for(const key of this.indexes.keys())if(key.startsWith(`${tenantId}:`))this.indexes.delete(key); }
  async search(tenantId,{teamId,query,limit=5}) {
    const idx=await this.#index(tenantId,teamId);
    if(idx.kind===EMBEDDING_MODEL){
      let queryVector=null; try{ [queryVector]=await this.embedder.embed([query]); }catch{ /* fall through to lexical */ }
      if(queryVector)return {backend:idx.kind,degraded:idx.degraded,...(idx.unindexed?{unindexed:idx.unindexed}:{}),results:idx.items.map(x=>({score:cosine(queryVector,x.v),memory:publicMemory(x.m)})).sort((a,b)=>b.score-a.score).slice(0,limit)};
      return this.#lexical(await this.store.listMemories(tenantId,{teamId}),query,limit);
    }
    const vector=featureVector(query,this.dimensions);
    if(idx.kind==='ruvector-native') return {backend:idx.kind,degraded:idx.degraded,results:(await idx.db.search({vector,k:limit})).map(r=>({score:r.score,memory:idx.items.get(r.id)})).filter(x=>x.memory)};
    return {backend:idx.kind,degraded:idx.degraded,results:idx.items.map(x=>({score:cosine(vector,x.v),memory:publicMemory(x.m)})).sort((a,b)=>b.score-a.score).slice(0,limit)};
  }
  #lexical(memories,query,limit){ const vector=featureVector(query,this.dimensions); return {backend:'lexical-degraded',degraded:true,results:memories.map(m=>({score:cosine(vector,featureVector(m.text,this.dimensions)),memory:publicMemory(m)})).sort((a,b)=>b.score-a.score).slice(0,limit)}; }
}

export async function vectorMemoryFromEnv(store, { embedder = embedderFromEnv() } = {}) {
  // Native acceleration is opt-in. Some platform bindings create a persistent
  // database at the process working directory even when no storage path is
  // requested. Defaulting to the portable backend prevents accidental shared
  // state and keeps every deployment honest about its degraded search mode.
  if (process.env.RUFLO_AI_TEAM_VECTOR !== 'native') return new TenantVectorMemory(store,{embedder});
  try {
    const module = await import('@ruvector/core'); const VectorDb = module.VectorDb || module.default?.VectorDb; if(!VectorDb)throw new Error('VectorDb export missing');
    // Package wrappers and native optional dependencies can drift independently.
    // Prove this exact binary accepts our configured dimension before advertising it.
    const probe = new VectorDb({dimensions:256,maxElements:2}); const id='__ruflo_probe__';
    await probe.insert({id,vector:new Float32Array(256)}); await probe.search({vector:new Float32Array(256),k:1}); await probe.delete(id);
    return new TenantVectorMemory(store,{VectorDb,embedder});
  }
  catch { return new TenantVectorMemory(store,{embedder}); }
}
