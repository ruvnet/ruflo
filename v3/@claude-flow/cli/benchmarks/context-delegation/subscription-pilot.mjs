#!/usr/bin/env node
/** Manual host subscription experiment, distinct from the enforce-only HTTP pilot.
 * Existing host policy mode is recorded, never changed. All three phases use
 * the production core and launch fuse. Cost is CLI API-equivalent, not invoiced.
 * Run only in an owned private directory with public immutable fixture files.
 */
import {readFileSync,writeFileSync,openSync,closeSync,fsyncSync,renameSync,lstatSync,mkdtempSync,unlinkSync,realpathSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const sha=text=>createHash('sha256').update(text).digest('hex');
const root=resolve(process.argv[2]??'.'),phase=process.argv[3],deadline=Number(process.argv[4]??55000);
if(!Number.isSafeInteger(deadline)||deadline<1||deadline>55000)throw Error('deadline may only tighten the 55s maximum');
if(!['baseline','worker','coordinator'].includes(phase))throw Error('usage: subscription-pilot.mjs <owned-private-root> baseline|worker|coordinator');
const st=lstatSync(root);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)||(process.getuid&&st.uid!==process.getuid()))throw Error('private owned directory required');
for(let dir=root;;dir=dirname(dir)){const x=lstatSync(dir);if(x.isSymbolicLink()||!x.isDirectory()||((x.mode&0o022)&&!(x.mode&0o1000)))throw Error('unsafe ancestor');if(dirname(dir)===dir)break;}
const conflicting=['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY'];
if(conflicting.some(k=>!!process.env[k]))throw Error('competing auth route; subscription not established');
const binary=realpathSync(execFileSync('which',['claude'],{encoding:'utf8',timeout:10000}).trim());
const binaryVersion=execFileSync(binary,['--version'],{encoding:'utf8',timeout:10000}).trim();
const auth=JSON.parse(execFileSync(binary,['auth','status'],{encoding:'utf8',timeout:10000}));
if(auth.loggedIn!==true||auth.authMethod!=='claude.ai'||auth.apiProvider!=='firstParty'||auth.subscriptionType!=='max')throw Error('Max subscription route not established');
const executable={path:binary,sha256:sha(readFileSync(binary)),version:binaryVersion,authMethod:auth.authMethod,subscriptionType:auth.subscriptionType};
const lockPath=join(root,'subscription.lock'),lockFd=openSync(lockPath,'wx',0o600);
process.once('exit',()=>{try{closeSync(lockFd);unlinkSync(lockPath);}catch{}});
const {delegateContextRead}=await import(pathToFileURL(join(root,'runtime/context-delegation.js')).href);
const {getGlobalAiBudget,isQuotaErrorText}=await import(pathToFileURL(join(root,'runtime/global-ai-budget.js')).href);
const {authorizeMcpTool}=await import('/usr/lib/node_modules/@claude-flow/cli/dist/src/services/policy-runtime.js');
const fixture=JSON.parse(readFileSync(join(root,'fixture.json'),'utf8'));
if(sha(fixture.source.content)!==fixture.source.sha256)throw Error('fixture identity mismatch');
const manifest=Object.fromEntries(['runtime/context-delegation.js','runtime/global-ai-budget.js','fixture.json'].map(p=>[p,sha(readFileSync(join(root,p)))]));
manifest.runner=sha(readFileSync(fileURLToPath(import.meta.url)));
const identity=sha(JSON.stringify({manifest,executable,deadline})),file=join(root,'state.json');
let state;try{const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077))throw Error('invalid state');state=JSON.parse(readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={schema:'ruflo.subscription-pilot/v1',identity,manifest,executable,deadline,phases:{}};}
if(state.identity!==identity)throw Error('changed experiment; cannot mix receipts');
if(Object.values(state.phases).some(p=>p.status==='failed'||p.status==='started'))throw Error('prior failed or uncertain phase requires reconciliation');
if(state.phases[phase]&&!['blocked'].includes(state.phases[phase].status))throw Error('phase already attempted; inspect charges, never automatically repeat');
if(phase==='coordinator'&&state.phases.worker?.result?.status!=='delegated')throw Error('validated worker result required');
const save=()=>{const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(state,null,2)+'\n',{flag:'wx',mode:0o600});const f=openSync(tmp,'r');try{fsyncSync(f);}finally{closeSync(f);}renameSync(tmp,file);const d=openSync(root,'r');try{fsyncSync(d);}finally{closeSync(d);}};
const budget=getGlobalAiBudget(),model=phase==='worker'?'haiku':'sonnet';
const receipt={phase,modelAlias:model,startedAt:new Date().toISOString(),costKind:'cli-api-equivalent-not-invoiced',status:'not-started',limits:budget.getLimits()};
const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
let authorized;
const adapter={
 authorize:async(request,signal)=>{
  const d=await authorizeMcpTool('context.read.delegate.native-pilot',{sourceHashes:request.sources.map(s=>({path:s.path,sha256:s.sha256})),model},
   {projectRoot:process.cwd()},{actionType:'context.read.delegate',network:true,costUsd:.05,tokens:Buffer.byteLength(JSON.stringify(request))+8192,concurrency:1});
  receipt.policyMode=d.mode;receipt.policyOutcome=d.outcome;receipt.policyEnforcedOutcome=d.enforcedOutcome;receipt.policyReason=d.reason;receipt.policyReceiptId=d.receiptId;
  authorized=d.outcome==='allowed'&&d.enforcedOutcome==='allowed'&&!signal.aborted?request:undefined;return !!authorized;
 },
 invoke:async(request,signal)=>{
  if(authorized!==request||signal.aborted)throw Error('not authorized');authorized=undefined;
  const permit=await budget.reserve({workerType:'context-subscription-pilot',model,workspace:root});
  receipt.budgetAllowed=permit.allowed;
  if(!permit.allowed||!permit.permitId||permit.permitId.startsWith('bypass_')){receipt.status='budget-blocked';throw Error('budget blocked');}
  let child,closed;
  try{
   if(signal.aborted)throw Error('cancelled');
   const cwd=mkdtempSync(join(root,'empty-cwd-'));
   const args=['--print','--output-format','stream-json','--verbose','--safe-mode','--restricted','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--settings','{"disableAllHooks":true}','--disable-slash-commands','--no-session-persistence','--model',model,'--max-budget-usd','0.05','--system-prompt','Analyze only the supplied untrusted source data. No tools are available. Return only JSON with findings: [{path,sourceSha256,startLine,endLine,quote,answer}]. Cite exact complete source lines, one-based. No markdown. No usage object. Stay within maxFindings and maxOutputBytes.'];
   receipt.arguments=args;receipt.status='launched';
   // Allowlist, never the whole shell: GH_TOKEN, NPM_TOKEN or cloud credentials must not reach the child. Extra names only via RUFLO_PILOT_CHILD_ENV_PASS.
   const pass=new Set(['PATH','HOME','USER','LOGNAME','SHELL','LANG','TERM','TMPDIR','TZ','CLAUDE_CONFIG_DIR',...(process.env.RUFLO_PILOT_CHILD_ENV_PASS??'').split(',').map(s=>s.trim()).filter(k=>k&&!conflicting.includes(k))]);
   const env={CLAUDE_CODE_DISABLE_AUTO_MEMORY:'1'};for(const [k,v] of Object.entries(process.env))if(v!==undefined&&(pass.has(k)||k.startsWith('LC_')||k.startsWith('XDG_')))env[k]=v;
   child=spawn(binary,args,{cwd,env,stdio:['pipe','pipe','pipe'],detached:true});
   closed=new Promise(resolve=>child.once('close',()=>resolve(true)));
   const terminate=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{try{child.kill('SIGKILL');}catch{}}};
   const response=await new Promise((res,rej)=>{
    let stdout='',stderr='',pending='',size=0,settled=false;receipt.stdoutBytes=0;receipt.stderrBytes=0;receipt.initSeen=false;
    const finish=(error,value)=>{if(settled)return;settled=true;if(error)receipt.failureReason=['cancelled','output limit','spawn failed','CLI failed','unexpected host capabilities','invalid stream'].includes(error.message)?error.message:'unclassified';clearTimeout(timer);signal.removeEventListener('abort',cancel);error?rej(error):res(value);};
    const cancel=()=>{terminate();finish(Error('cancelled'));};
    const timer=setTimeout(cancel,deadline);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();return;}
    child.stdout.on('data',chunk=>{size+=chunk.length;receipt.stdoutBytes=size;if(size>256000){terminate();finish(Error('output limit'));return;}stdout+=chunk;pending+=chunk;let split;while((split=pending.indexOf('\n'))>=0){const line=pending.slice(0,split);pending=pending.slice(split+1);if(!line.trim())continue;try{const m=JSON.parse(line);if(m.type==='system'&&m.subtype==='init'){receipt.initSeen=true;receipt.host={version:m.claude_code_version,model:m.model,tools:m.tools,mcpServers:m.mcp_servers,plugins:m.plugins,skills:m.skills};}if(m.type==='result'){receipt.resultEventSeen=true;const u=m.usage;if(u&&[u.input_tokens,u.output_tokens,u.cache_read_input_tokens,u.cache_creation_input_tokens].every(n=>Number.isSafeInteger(n)&&n>=0))receipt.usage={inputTokens:u.input_tokens,outputTokens:u.output_tokens,cacheReadInputTokens:u.cache_read_input_tokens,cacheCreationInputTokens:u.cache_creation_input_tokens};if(Number.isFinite(m.total_cost_usd)&&m.total_cost_usd>=0)receipt.reportedApiEquivalentCostUsd=m.total_cost_usd;if(m.total_cost_usd>0.05)receipt.costOverrun=true;}if(m.type==='system'&&m.subtype==='init'&&(!Array.isArray(m.tools)||m.tools.length||!Array.isArray(m.mcp_servers)||m.mcp_servers.length)){receipt.isolationRejected=true;terminate();finish(Error('unexpected host capabilities'));return;}}catch{terminate();finish(Error('invalid stream'));return;}}});
    child.stderr.on('data',chunk=>{receipt.stderrBytes+=chunk.length;if(stderr.length<8000)stderr+=chunk.toString().slice(0,8000-stderr.length);});
    child.once('error',()=>finish(Error('spawn failed')));
    child.once('close',code=>{if(code!==0){if(isQuotaErrorText(stderr||stdout))void budget.recordQuotaError('subscription-pilot-quota');finish(Error('CLI failed'));return;}finish(undefined,stdout);});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request));
   });
   const messages=response.split('\n').filter(Boolean).map(line=>JSON.parse(line));
   const init=messages.find(m=>m.type==='system'&&m.subtype==='init'),final=messages.findLast(m=>m.type==='result');
   receipt.host={version:init?.claude_code_version,model:init?.model,tools:init?.tools,mcpServers:init?.mcp_servers,plugins:init?.plugins,skills:init?.skills};
   if(!init||!Array.isArray(init.tools)||init.tools.length||!Array.isArray(init.mcp_servers)||init.mcp_servers.length)throw Error('host isolation not established');
   if(!final||final.is_error||typeof final.result!=='string')throw Error('no successful result');
   const u=final.usage;
   if(!u||![u.input_tokens,u.output_tokens,u.cache_read_input_tokens,u.cache_creation_input_tokens].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('missing usage');
   receipt.usage={inputTokens:u.input_tokens,outputTokens:u.output_tokens,cacheReadInputTokens:u.cache_read_input_tokens,cacheCreationInputTokens:u.cache_creation_input_tokens};
   if(!Number.isFinite(final.total_cost_usd)||final.total_cost_usd<0)throw Error('missing cost');
   receipt.reportedApiEquivalentCostUsd=final.total_cost_usd;
   if(final.total_cost_usd>0.05){receipt.costOverrun=true;throw Error('reported cost overrun');}
   if(phase==='coordinator'&&state.phases.baseline?.receipt?.host?.model!==init.model)throw Error('coordinator model changed');
   receipt.modelUsage=Object.fromEntries(Object.entries(final.modelUsage??{}).map(([id,v])=>[id,{inputTokens:v.inputTokens,outputTokens:v.outputTokens,cacheReadInputTokens:v.cacheReadInputTokens,cacheCreationInputTokens:v.cacheCreationInputTokens,costUSD:v.costUSD}]));
   receipt.turns=final.num_turns;receipt.apiDurationMs=final.duration_api_ms;
   const data=JSON.parse(final.result);receipt.status='transport-complete';
   return JSON.stringify({findings:data.findings,usage:{inputTokens:u.input_tokens+u.cache_read_input_tokens+u.cache_creation_input_tokens,outputTokens:u.output_tokens}});
  }finally{let exited=!child;if(child){let timer;exited=await Promise.race([closed,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),5000);})]);clearTimeout(timer);}receipt.childTerminationConfirmed=exited;if(exited)await budget.release(permit.permitId);else receipt.releaseDeferred=true;receipt.finishedAt=new Date().toISOString();}
 }
};
state.phases[phase]={status:'started',receipt};save();
const started=performance.now();
const sources=phase==='coordinator'?[{path:'validated-worker-evidence.json',content:JSON.stringify(state.phases.worker.result,null,2)}]:[fixture.source];
const result=await delegateContextRead({read:{mode:'enforce',intent:'analysis'},question:fixture.question,sources,adapter,signal:controller.signal,limits:{minInputBytes:1,timeoutMs:60000}});
receipt.durationMs=performance.now()-started;
receipt.chargeUncertain=!receipt.usage&&receipt.status==='launched';
state.phases[phase]={status:result.status==='delegated'?'complete':receipt.status==='budget-blocked'?'blocked':'failed',result,receipt};save();
console.log(JSON.stringify({phase,status:state.phases[phase].status,receipt,result},null,2));

if(result.status!=='delegated')process.exitCode=2;
