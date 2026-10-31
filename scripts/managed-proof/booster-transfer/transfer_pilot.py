"""Opt-in cross-model prompt-transfer diagnostic. No native routing or promotion."""
import argparse
import hashlib
import json
import os
import pathlib
import random
import sys
import time
from decimal import Decimal

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import effect_journal as journal
from journaled_openrouter import JournaledOpenRouter
from actor_pilot import fresh_manifest, run_oracle, digest
from actor_pilot_v1 import STRATEGIES
from openrouter_client import MODEL, CATALOG, catalog_model, complete, request_json

HASH = __import__('re').compile(r'[a-f0-9]{64}')
ARMS = ['untuned', 'transferred', 'target_native']


def load_policy(path):
    p = pathlib.Path(path)
    if p.is_symlink() or not p.is_file() or p.stat().st_size > 128000:
        raise ValueError('Bounded host source policy required')
    p = json.loads(p.read_text())
    if not isinstance(p, dict) or set(p) != {'version', 'instruction', 'sourcePlanHash', 'sourceTrainingDigest', 'sourceModel'} or type(p['version']) is not int or p['version'] != 1 or not isinstance(p['instruction'], str) or not 1 <= len(p['instruction']) <= 4000 or not all(isinstance(p[k], str) and HASH.fullmatch(p[k]) for k in ['sourcePlanHash', 'sourceTrainingDigest']) or not isinstance(p['sourceModel'], str) or len(p['sourceModel']) > 120:
        raise ValueError('Invalid frozen source policy')
    return p


def reject_history(corpus, paths):
    consumed_ids, consumed_inputs = set(), set()
    for path in paths:
        p = pathlib.Path(path)
        if p.is_symlink() or not p.is_file() or p.stat().st_size > 2000000:
            raise ValueError('Bounded consumed-campaign receipt required')
        raw = json.loads(p.read_text())
        plan = raw.get('plan', raw)
        plan = plan.get('plan', plan)
        if not isinstance(plan,dict):raise ValueError('Invalid consumed plan')
        corpus_plan=plan.get('corpus',plan)
        if not isinstance(corpus_plan,dict) or not isinstance(corpus_plan.get('training'),list) or not isinstance(corpus_plan.get('audit'),list) or not corpus_plan['audit'] or len(corpus_plan['training'])>100 or len(corpus_plan['audit'])>300:raise ValueError('Missing consumed corpus')
        for task in corpus_plan['training'] + corpus_plan['audit']:
            if not isinstance(task,dict) or not isinstance(task.get('id'),str) or not isinstance(task.get('spec'),str) or not isinstance(task.get('cases'),list):raise ValueError('Invalid consumed task')
            consumed_ids.add(task['id'])
            consumed_inputs.add(digest({'spec': task['spec'], 'cases': task['cases']}))
    for task in corpus['training'] + corpus['audit']:
        if task['id'] in consumed_ids or digest({'spec': task['spec'], 'cases': task['cases']}) in consumed_inputs:
            raise ValueError('Consumed corpus cannot establish a fresh transfer claim')


def choose_training(rows):
    if not rows or any(r['costUSD'] is None for r in rows):
        raise ValueError('Complete metered target training required')
    return max(STRATEGIES, key=lambda strategy: (sum(r['passed'] for r in rows if r['strategy'] == strategy),
                -sum(Decimal(str(r['costUSD'])) for r in rows if r['strategy'] == strategy)))


def summarize(rows, audit):
    result = {}
    for arm in ARMS:
        selected = [r for r in rows if r['split'] == 'audit' and r['arm'] == arm]
        result[arm] = {'passed': sum(r['passed'] for r in selected), 'total': len(audit), 'missing': len(audit)-len(selected),
                       'knownProviderCostUSD': float(sum(Decimal(str(r['costUSD'])) for r in selected if r['costUSD'] is not None))}
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--journal-root')
    parser.add_argument('--ruos-placement',action='store_true')
    parser.add_argument('--source-policy', required=True)
    parser.add_argument('--root', required=True)
    parser.add_argument('--budget', default='.50')
    parser.add_argument('--history', action='append', default=[])
    parser.add_argument('--diagnostic-reuse', action='store_true', help='Explicit public-benchmark reuse; never fresh confirmation')
    args = parser.parse_args()
    budget = Decimal(args.budget)
    if not budget.is_finite() or not 0 < budget <= Decimal('.50'):
        raise ValueError('Initial transfer budget must be positive and at most $0.50')
    corpus, policy = fresh_manifest(args.manifest), load_policy(args.source_policy)
    if not args.diagnostic_reuse:
        if not args.history:
            raise ValueError('Fresh mode requires consumed campaign history; no implicit clean slate')
        reject_history(corpus, args.history)
    # Fetch only the fixed official catalog. No secret is needed for discovery.
    model = catalog_model(request_json(CATALOG), MODEL)
    root = journal.prepare_root(args.root)
    journal_root=pathlib.Path(args.journal_root) if args.journal_root else root/'effects'
    oracle = pathlib.Path(__file__).resolve().parent.parent / 'actor_pilot.py'
    plan = {'version': 2, 'durableEffectJournal':journal.SCHEMA, 'kind': 'openrouter-prompt-transfer', 'model': model, 'sourcePolicy': policy,
            'corpus': corpus, 'budgetUSD': str(budget), 'maxTokens': 768, 'reasoning': 'none',
            'seed': 4474, 'diagnosticReuse': args.diagnostic_reuse, 'proofEligible': False,
            'oracleSha256': hashlib.sha256(oracle.read_bytes()).hexdigest(),
            'helperSha256':{name:hashlib.sha256((pathlib.Path(__file__).parent/name).read_bytes()).hexdigest() for name in ['openrouter_client.py']},
            'oracleHelperSha256':{name:hashlib.sha256((oracle.parent/name).read_bytes()).hexdigest() for name in ['actor_pilot.py','actor_pilot_v1.py','cost_endpoint.py','effect_journal.py','ruos_credential.py','journaled_openrouter.py']},
            'runnerSha256': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
            'modelDoesNotLearnWeights': True, 'boosterUsed': False,
            'limits': 'Task-level prompt transfer only; fresh schema is not proof of independent tasks or correct oracle. No automatic promotion.'}
    with (root/'plan.json').open('x') as file:
        json.dump({'hash': digest(plan), 'plan': plan}, file, indent=2);file.flush();os.fsync(file.fileno())
    journal.sync_directory(root)
    caller=JournaledOpenRouter(journal_root,digest(plan),budget,allow_ruos_placement=args.ruos_placement)
    rows, spent, target_choice, error = [], Decimal(0), None, None
    deadline = time.monotonic() + 600

    def actor(task, strategy, instruction, split, arm):
        nonlocal spent
        if time.monotonic() >= deadline:
            raise RuntimeError('Overall transfer deadline exceeded')
        prompt = ('Implement JavaScript function solve('+','.join(task['parameters'])+'). Use only core ECMAScript; no require, process, Buffer, TextEncoder, URL or other Node/browser API. Return a finite JSON-serializable '+task['returnType']+' value, never BigInt, undefined, NaN or Infinity. Do not mutate input. '
                  +task['spec']+' '+instruction+' Return valid JSON, no Markdown.')
        started = time.monotonic()
        row = {'task': task['id'], 'split': split, 'arm': arm, 'strategy': strategy, 'passed': False,
               'costUSD': None, 'finished': False, 'outputHash': digest(''), 'output': ''}
        try:
            response = caller.complete(model,prompt,budget-spent,digest({'plan':digest(plan),'split':split,'task':task['id'],'arm':arm,'strategy':strategy}))
            row['costUSD'] = response['costUSD']; spent += Decimal(str(response['costUSD']))
            row['finished'] = response['finished']; row['model'] = response['model'];row['providerReceipt']=response['providerReceipt'];row['requestDigest']=response['requestDigest'];row['effectJournal']=response['effectJournal']
            row['output'] = response['content']; row['outputHash'] = digest(response['content'])
            try:
                code = json.loads(response['content'])['code']
                row['passed'] = bool(response['finished'] and isinstance(code,str) and len(code)<20000 and run_oracle(code,task))
            except (KeyError, ValueError, TypeError):
                pass
        finally:
            row['latencyMs'] = round((time.monotonic()-started)*1000)
            rows.append(row); (root/'rows.json').write_text(json.dumps(rows,indent=2))
            print(json.dumps({k:v for k,v in row.items() if k!='output'}),flush=True)

    try:
        refs = {t['id']:run_oracle(t['referenceCode'],t) for t in corpus['training']+corpus['audit']}
        (root/'reference-checks.json').write_text(json.dumps(refs,indent=2))
        if not all(refs.values()):
            raise ValueError('Independent reference preflight failed; no inference admitted')
        for task in corpus['training']:
            for strategy,instruction in STRATEGIES.items():
                actor(task,strategy,instruction,'train',strategy)
        target_choice = choose_training(rows)
        (root/'selection.json').write_text(json.dumps({'targetChoice':target_choice,'sourcePolicyHash':digest(policy),'planHash':digest(plan)}))
        schedule=[(task,arm) for task in corpus['audit'] for arm in ARMS]
        random.Random(plan['seed']).shuffle(schedule)
        for task,arm in schedule:
            strategy = 'baseline' if arm=='untuned' else 'transferred' if arm=='transferred' else target_choice
            instruction = policy['instruction'] if arm=='transferred' else STRATEGIES[strategy]
            actor(task,strategy,instruction,'audit',arm)
    except Exception as exc:
        error = type(exc).__name__
    finally:
        result={'kind':plan['kind'],'planHash':digest(plan),'model':model['id'],'targetChoice':target_choice,
                'knownProviderCostUSD':float(spent),'unknownSpend':any(r['costUSD'] is None for r in rows),
                'summary':summarize(rows,corpus['audit']),'calls':len(rows),'terminalError':error,
                'diagnosticReuse':args.diagnostic_reuse,'durableEffectJournalEnabled':True,'transferProven':False,'modelWeightLearning':False,
                'promotionAuthorized':False,'defaultsChanged':False}
        (root/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
    if error:
        raise SystemExit(2)

if __name__=='__main__':
    main()
