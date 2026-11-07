/** Fixed local strategies. The subprocess receives no expected labels or signing keys. */
import { evidenceOf,manifestOf,observationOf,scopeOf } from '../v3/@claude-flow/cli/src/services/managed-learning.js';
import { accept,type PromotionVerdict } from '../v3/@claude-flow/cli/src/services/harness-benchmark.js';
const [strategy,encoded]=process.argv.slice(2);
if (!['baseline','strict'].includes(strategy??'') || !encoded || encoded.length>16_000) process.exit(2);
const task=JSON.parse(encoded) as {kind:string;value:unknown};
let accepted=false;
try {
  if(strategy==='baseline') accepted=typeof task.value==='object'&&task.value!==null&&!Array.isArray(task.value);
  else {
    switch(task.kind){
      case 'scope': scopeOf(task.value);accepted=true;break;
      case 'manifest': manifestOf(task.value);accepted=true;break;
      case 'observation': observationOf(task.value);accepted=true;break;
      case 'evidence': evidenceOf(task.value);accepted=true;break;
      case 'gate': accepted=accept(task.value as PromotionVerdict).accept;break;
      default:process.exit(2);
    }
  }
}catch{accepted=false;}
console.log(JSON.stringify({accepted}));
