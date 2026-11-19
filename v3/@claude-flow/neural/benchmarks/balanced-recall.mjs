// From the neural package after build: node benchmarks/balanced-recall.mjs 23
// Run each implementation in a fresh process. No network, model, or external dependency.
import { SONAManager } from '../dist/sona-manager.js';
import { performance } from 'node:perf_hooks';
const seed = Number(process.argv[2] ?? 11);
let state = seed >>> 0;
const rand = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const vector = () => Float32Array.from({length: 64}, () => rand() - 0.5);
const cosine = (a,b) => {
  let dot=0, na=0, nb=0;
  for (let j=0;j<a.length;j++) { dot+=a[j]*b[j]; na+=a[j]**2; nb+=b[j]**2; }
  return na && nb ? dot/Math.sqrt(na*nb) : 0;
};
const times = []; let wrong=0;
for (let stream=-10;stream<100;stream++) {
  const manager=new SONAManager('balanced'); await manager.initialize();
  const patterns=[];
  function add(embedding) {
    const p=manager.storePattern({name:String(patterns.length),strategy:'fixture',domain:'bench',
      embedding,successRate:1,qualityHistory:[],evolutionHistory:[],usageCount:0});
    patterns.push(p);return p;
  }
  const q=vector(), near=new Float32Array(q);
  near[63]=-near[63];
  for(let n=0;n<16;n++)add(vector());
  const a=add(q.slice()), b=add(near);
  for(let i=0;i<40;i++) {
    if(i===10)manager.updatePatternUsage(a.patternId,0.125);
    if(i===16)add(q.slice());
    if(i===25)b.embedding[63]=q[63]*1.25;
    const query=i%4===0?near:q;
    const k=1+(i%3);
    const start=performance.now();
    const result=await manager.findSimilarPatterns(query,k);
    const elapsed=performance.now()-start;
    const expected=patterns.map(p=>({p,s:cosine(query,p.embedding)})).sort((a,b)=>b.s-a.s).slice(0,k);
    // Duplicate vectors tie exactly in both scorers; insertion order breaks ties.
    const correct=result.length===k && result.every((r,j)=>r.pattern===expected[j].p &&
      Math.abs(r.similarity-expected[j].s)<=1e-6 &&
      Math.abs(r.confidence-expected[j].s*expected[j].p.successRate)<=1e-6);
    if(stream>=0){times.push(elapsed*1000); if(!correct)wrong++;}
  }
  await manager.cleanup();
}
times.sort((a,b)=>a-b);
console.log(JSON.stringify({seed, streams:100, queries:times.length, mismatches:wrong,
  p95Us:times[Math.ceil(.95*times.length)-1], peakRSSKiB:process.resourceUsage().maxRSS}));
// Report the cost of giving up a valid cache hit on larger stationary corpora.
const frozen=new SONAManager('balanced'); await frozen.initialize();
const singleQuery=vector(), hot=[];
for(let i=0;i<256;i++) frozen.storePattern({name:String(i),strategy:'fixture',domain:'bench',
  embedding:vector(),successRate:1,qualityHistory:[],evolutionHistory:[],usageCount:0});
for(let i=0;i<2500;i++) {
  const start=performance.now();await frozen.findSimilarPatterns(singleQuery,3);
  if(i>=500)hot.push((performance.now()-start)*1000);
}
hot.sort((a,b)=>a-b);
console.log(JSON.stringify({seed,profile:'stationary',queries:hot.length,
  p95Us:hot[Math.ceil(.95*hot.length)-1],peakRSSKiB:process.resourceUsage().maxRSS}));
await frozen.cleanup();
if(wrong)process.exitCode=1;
