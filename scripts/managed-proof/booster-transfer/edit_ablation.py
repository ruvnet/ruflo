"""Model edit generation with paired direct/Agent Booster application.

Both application arms share ONE provider generation. Costs must not be counted
as two model calls. Neither confidence nor successful merge proves correctness.
"""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import time
from decimal import Decimal
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
import effect_journal as journal
from journaled_openrouter import JournaledOpenRouter
from verified_application import application_contract,select_verified_application
from actor_pilot import digest,run_oracle
from openrouter_client import MODEL,CATALOG,catalog_model,complete,request_json


def booster_apply(code,edit,language,cwd):
    path=pathlib.Path(__file__).with_name('booster_apply.mjs')
    try:
        tools=pathlib.Path(cwd).resolve(strict=True)
        if not tools.is_dir():raise ValueError('Invalid tools directory')
        command=['bwrap','--unshare-all','--die-with-parent','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--clearenv','--ro-bind',str(tools),'/tools','--ro-bind',str(path.resolve()),'/booster_apply.mjs','--chdir','/tools','/usr/bin/node','--max-old-space-size=64','/booster_apply.mjs']
        child=subprocess.run(command,input=json.dumps({'code':code,'edit':edit,'language':language}),
                             env={'PATH':os.defpath,'LANG':'C','LC_ALL':'C'},capture_output=True,text=True,timeout=10)
        if len(child.stdout.encode())>128000:
            raise ValueError('Booster response exceeded bound')
        result=json.loads(child.stdout)
        if child.returncode or result.get('available') is not True:
            raise ValueError('Booster unavailable')
        return result
    except (subprocess.TimeoutExpired,ValueError,KeyError,OSError):
        raise RuntimeError('Pinned Agent Booster execution unavailable') from None


def load_edits(path):
    file=pathlib.Path(path)
    if file.is_symlink() or not file.is_file() or file.stat().st_size>128000:
        raise ValueError('Bounded host edit manifest required')
    raw=json.loads(file.read_text())
    if not isinstance(raw,dict) or set(raw)!={'tasks'} or not isinstance(raw['tasks'],list) or not 1<=len(raw['tasks'])<=30:
        raise ValueError('Bounded edit tasks required')
    seen=set()
    for task in raw['tasks']:
        if not isinstance(task,dict) or set(task)!={'id','code','edit','language','cases','referenceCode'} or not isinstance(task['id'],str) or task['id'] in seen or not 1<=len(task['id'])<=64 or task['language']!='javascript' or any(not isinstance(task[k],str) or not 1<=len(task[k])<=16000 for k in ['code','edit','referenceCode']) or not isinstance(task['cases'],list) or not 1<=len(task['cases'])<=30:
            raise ValueError('Invalid closed edit task')
        if any(not isinstance(c,list) or len(c)!=2 or not isinstance(c[0],list) for c in task['cases']):
            raise ValueError('Invalid independent edit cases')
        json.dumps(task,allow_nan=False);seen.add(task['id'])
    return raw


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--manifest',required=True);parser.add_argument('--root',required=True)
    parser.add_argument('--journal-root');parser.add_argument('--ruos-placement',action='store_true');parser.add_argument('--booster-cwd',required=True);parser.add_argument('--budget',default='.25');args=parser.parse_args()
    budget=Decimal(args.budget)
    if not budget.is_finite() or not 0<budget<=Decimal('.50') or not pathlib.Path(args.booster_cwd).is_absolute():
        raise ValueError('Invalid host budget or installed package directory')
    corpus=load_edits(args.manifest);root=journal.prepare_root(args.root);journal_root=pathlib.Path(args.journal_root) if args.journal_root else root/'effects'
    model=catalog_model(request_json(CATALOG),MODEL)
    plan={'kind':'paired-agent-booster-merge','version':3,'applicationContract':'complete-source','durableEffectJournal':journal.SCHEMA,'model':model,'tasks':corpus['tasks'],'budgetUSD':str(budget),
          'sameGenerationBothArms':True,'confidenceIsVerification':False,'nodeModule':'agent-booster@0.2.2',
          'runnerHash':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
          'bridgeHash':hashlib.sha256(pathlib.Path(__file__).with_name('booster_apply.mjs').read_bytes()).hexdigest(),
          'oracleHash':hashlib.sha256((pathlib.Path(__file__).resolve().parent.parent/'actor_pilot.py').read_bytes()).hexdigest(),
          'helperSha256':{name:hashlib.sha256((pathlib.Path(__file__).parent/name).read_bytes()).hexdigest() for name in ['openrouter_client.py','booster_apply.mjs']},
          'oracleHelperSha256':{name:hashlib.sha256((pathlib.Path(__file__).resolve().parent.parent/name).read_bytes()).hexdigest() for name in ['actor_pilot.py','actor_pilot_v1.py','cost_endpoint.py','effect_journal.py','ruos_credential.py','journaled_openrouter.py','verified_application.py']},
          'proofEligible':False}
    with (root/'plan.json').open('x')as file:
        json.dump({'hash':digest(plan),'plan':plan},file,indent=2);file.flush();os.fsync(file.fileno())
    journal.sync_directory(root)
    caller=JournaledOpenRouter(journal_root,digest(plan),budget,allow_ruos_placement=args.ruos_placement)
    rows=[];spent=Decimal(0);error=None;deadline=time.monotonic()+300
    try:
        # Dependency preflight BEFORE any provider call.
        booster_apply('function solve(x){return x+1;}','function solve(x){return x+2;}','javascript',args.booster_cwd)
        reference_checks={task['id']:{'referencePassed':run_oracle(task['referenceCode'],task),'originalRejected':not run_oracle(task['code'],task)} for task in corpus['tasks']}
        (root/'reference-checks.json').write_text(json.dumps(reference_checks,indent=2))
        if not all(check['referencePassed'] and check['originalRejected'] for check in reference_checks.values()):
            raise ValueError('Independent reference preflight failed')
        for task in corpus['tasks']:
            if time.monotonic()>=deadline:raise RuntimeError('Overall edit ablation deadline exceeded')
            prompt='Apply the requested edit to the full JavaScript source. Return JSON with only field code containing the complete updated source. Preserve solve signature; use only core ECMAScript and finite plain JSON values. Do not mutate inputs or use tools. Source:\n'+task['code']+'\nRequested edit:\n'+task['edit']
            started=time.monotonic();row={'task':task['id'],'providerCostUSD':None,'directPassed':False,'boosterPassed':False}
            try:
                response=caller.complete(model,prompt,budget-spent,digest({'plan':digest(plan),'task':task['id'],'phase':'edit-generation'}))
                spent+=Decimal(str(response['costUSD']));row['providerCostUSD']=response['costUSD'];row['providerReceipt']=response['providerReceipt'];row['requestDigest']=response['requestDigest'];row['effectJournal']=response['effectJournal'];row['generationHash']=digest(response['content'])
                candidate=json.loads(response['content'])['code']
                if not response['finished'] or not isinstance(candidate,str) or len(candidate)>20000:raise ValueError('Invalid bounded edit generation')
                row['candidateCode']=candidate;row['directPassed']=run_oracle(candidate,task)
                try:
                    applied=booster_apply(task['code'],candidate,task['language'],args.booster_cwd)
                except RuntimeError:
                    applied={'available':False,'version':'0.2.2','admitted':False,'output':None,'confidence':None,'strategy':None,'latencyMs':None}
                    row['boosterUnavailable']=True
                row['boosterAdmitted']=applied['admitted'];row['boosterConfidence']=applied['confidence'];row['boosterStrategy']=applied['strategy'];row['boosterLatencyMs']=applied['latencyMs']
                row['boosterCode']=applied['output'];row['boosterPassed']=bool(applied['admitted'] and run_oracle(applied['output'],task))
                contract=application_contract('complete-source',task['code'],candidate,task)
                verified=select_verified_application(task['code'],candidate,applied,task,contract)
                row['verifiedApplication']=verified;row['verifiedSelectedPassed']=verified['accepted']
            finally:
                row['latencyMs']=round((time.monotonic()-started)*1000);rows.append(row);(root/'rows.json').write_text(json.dumps(rows,indent=2))
    except Exception as exc:error=type(exc).__name__
    finally:
        result={'kind':plan['kind'],'tasks':len(corpus['tasks']),'completedGenerations':len(rows),'knownProviderCostUSD':float(spent),
                'unknownSpend':any(r['providerCostUSD']is None for r in rows),'directPassed':sum(r['directPassed']for r in rows),
                'boosterPassed':sum(r['boosterPassed']for r in rows),'verifiedSelectedPassed':sum(r.get('verifiedSelectedPassed',False)for r in rows),'sameGenerationBothArms':True,'terminalError':error,
                'durableEffectJournalEnabled':True,'boosterIsPromptLearning':False,'transferProven':False,'promotionAuthorized':False}
        (root/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
    if error:raise SystemExit(2)
if __name__=='__main__':main()
