// Source-bound microbenchmark; no builds, credentials or model calls required.
// node v3/@claude-flow/security/scripts/benchmark-authority.mjs [baseline-ref]
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
const file = 'v3/@claude-flow/security/src/policy/envelope.ts';
const ref = process.argv[2] ?? '1c411e5b55e326d929d649b04d49902553d1d39d';
const inputs = [['baseline',execFileSync('git',['show',`${ref}:${file}`],{encoding:'utf8'})],['candidate',readFileSync(file,'utf8')]];
for (const [name, source] of inputs) {
  const js = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  const api = await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  const action = {type:'memory.read',tool:'memory_search',tokens:100};
  const envelope = {tools:['memory_*'],maxTokens:1000,network:false};
  let allowed = 0;
  for (let i=0;i<10000;i++) allowed += Number(api.checkCapabilityEnvelope(action,envelope).allowed);
  const samples=[];
  for(let round=0;round<7;round++) {
    const start=performance.now();
    for(let i=0;i<100000;i++) allowed += Number(api.checkCapabilityEnvelope(action,envelope).allowed);
    samples.push((performance.now()-start)*1000/100000);
  }
  if(allowed !== 710000) throw new Error('benchmark decision mismatch');
  samples.sort((a,b)=>a-b);
  console.log(JSON.stringify({name,baselineRef:ref,node:process.version,iterations:100000,rounds:7,medianMicroseconds:samples[3],samples}));
}
