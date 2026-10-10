import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RvfEventLog } from '../v3/@claude-flow/shared/src/events/rvf-event-log.ts';
for(const tail of [Buffer.from([0,0]),Buffer.from([0,0,0,100,123])]) test(`new events survive reopening after ${tail.length}-byte incomplete tail`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rvf-tail-')); const path=join(dir,'events.rvf'); let log=new RvfEventLog({logPath:path});
 const event=id=>({id,aggregateId:'a',aggregateType:'Task',type:'Created',timestamp:Number(id),version:0,payload:{}});
 try{
  await log.initialize();await log.append(event('1'));await log.close();appendFileSync(path,tail);
  log=new RvfEventLog({logPath:path});await log.initialize();await log.append(event('2'));await log.close();
  log=new RvfEventLog({logPath:path});await log.initialize();
  assert.deepEqual((await log.getEvents('a')).map(e=>e.id),['1','2']);
 }finally{await log.close();rmSync(dir,{recursive:true,force:true});}
});
