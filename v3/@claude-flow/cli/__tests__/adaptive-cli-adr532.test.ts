import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import adaptive from '../src/commands/adaptive.js';
import { makeCase } from '../src/services/adaptive-bench.js';

const get = (name:string) => adaptive.subcommands?.find(c=>c.name===name);
const ctx = (cwd:string,flags:Record<string,unknown>) => ({cwd,flags,args:[]}) as any;

describe('ADR-532 real Ruflo CLI entrypoint',()=>{
  it('registers observe-only plan and benchmark subcommands',()=>{
    expect(adaptive.name).toBe('adaptive');
    expect(get('plan')).toBeDefined();
    expect(get('bench')).toBeDefined();
  });
  it('plans valid JSON without executing a handler or modifying the workspace',async()=>{
    const root=mkdtempSync(join(tmpdir(),'ruflo-adaptive-cli-'));
    try{
      writeFileSync(join(root,'plan.json'),JSON.stringify(makeCase(0)));
      const before=readdirSync(root);
      const result=await get('plan')!.action!(ctx(root,{path:'plan.json',json:true,concurrency:4,strategy:'auto'}));
      expect(result.success).toBe(true);
      expect((result.data as any).executed).toBe(false);
      expect((result.data as any).nodes).toBe(6);
      expect(readdirSync(root)).toEqual(before);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it('refuses a manifest reached through a symlink to another directory',async()=>{
    const root=mkdtempSync(join(tmpdir(),'ruflo-adaptive-root-'));
    const outside=mkdtempSync(join(tmpdir(),'ruflo-adaptive-outside-'));
    try{
      writeFileSync(join(outside,'plan.json'),JSON.stringify(makeCase(0)));
      symlinkSync(outside,join(root,'linked'),'dir');
      const result=await get('plan')!.action!(ctx(root,{path:'linked/plan.json',json:true}));
      expect(result.success).toBe(false);
    }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
  });
  it('refuses privileged plan effects before execution',async()=>{
    const root=mkdtempSync(join(tmpdir(),'ruflo-adaptive-privileged-'));
    try{
      const p=makeCase(0);p.steps[0].effect='write';
      writeFileSync(join(root,'plan.json'),JSON.stringify(p));
      const result=await get('plan')!.action!(ctx(root,{path:'plan.json'}));
      expect(result.success).toBe(false);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it('runs a deterministic synthetic benchmark via the CLI entrypoint',async()=>{
    const root=mkdtempSync(join(tmpdir(),'ruflo-adaptive-bench-'));
    try{
      const before=readdirSync(root);
      const result=await get('bench')!.action!(ctx(root,{dev:5,holdout:30}));
      expect(result.success).toBe(true);
      expect((result.data as any).holdout.correctness).toBe(30);
      expect(readdirSync(root)).toEqual(before);
    }finally{rmSync(root,{recursive:true,force:true});}
  },30000);
});
