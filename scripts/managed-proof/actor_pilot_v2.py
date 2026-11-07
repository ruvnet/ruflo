"""Hardened opt-in host pilot. Independent from managed MCP and proof admission.

The archived v1 is the exact executed campaign source. This runner is a new
version: freeze a fresh campaign and runtime contract before using it. No model
output is executed outside bubblewrap. Reported list cost is not a billing audit.
"""
import argparse
import hashlib
import json
import math
import os
import pathlib
import random
import re
import subprocess
import time

from actor_pilot_v1 import TRAIN, AUDIT, STRATEGIES
from cost_endpoint import PRIMARY_ENDPOINT


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def measured_cost(raw):
    cost = raw.get('total_cost_usd')
    if isinstance(cost, bool) or not isinstance(cost, (int, float)) or not math.isfinite(cost) or cost < 0:
        raise ValueError('Missing or invalid reported metering')
    return float(cost)


def sandbox_source(code, cases):
    # Construct arguments INSIDE the VM realm. Host-realm object injection gives
    # untrusted code an unnecessary constructor bridge. The OS boundary is bwrap.
    return ('const assert=require("node:assert/strict"),vm=require("node:vm");'
            'const ctx=vm.createContext({},{codeGeneration:{strings:false,wasm:false}});'
            'vm.runInContext(' + json.dumps(code + ';globalThis.answer=solve') + ',ctx,{timeout:500});'
            'const cases=JSON.parse(' + json.dumps(json.dumps(cases)) + ');'
            'for(const [args,expected] of cases){'
            'vm.runInContext("globalThis.args=JSON.parse("+JSON.stringify(JSON.stringify(args))+")",ctx,{timeout:500});'
            'const before=vm.runInContext("JSON.stringify(args)",ctx,{timeout:500});'
            'const actual=vm.runInContext("answer(...args)",ctx,{timeout:500});'
            'assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)),expected);'
            'assert.equal(vm.runInContext("JSON.stringify(args)",ctx,{timeout:500}),before);}'
            'console.log("PASS")')


def run_oracle(code, task):
    cmd = ['bwrap', '--unshare-all', '--die-with-parent', '--ro-bind', '/usr', '/usr',
           '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64', '--proc', '/proc',
           '--dev', '/dev', '--tmpfs', '/tmp', '--clearenv', '/usr/bin/node',
           '--max-old-space-size=64', '-e', sandbox_source(code, task['cases'])]
    # No unbounded capture of generated-code stdout/stderr. 64 MB is a JS old
    # heap setting, NOT a total RSS, tmpfs, process-count or host-memory limit.
    try:
        return subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=4).returncode == 0
    except subprocess.TimeoutExpired:
        return False


def fresh_manifest(path):
    file = pathlib.Path(path)
    if file.is_symlink() or not file.is_file() or file.stat().st_size > 128000:
        raise ValueError('Bounded regular host manifest required')
    value = json.loads(file.read_text())
    if not isinstance(value, dict) or set(value) != {'training', 'audit'}:
        raise ValueError('Closed training/audit manifest required')
    if not isinstance(value['training'], list) or not 3 <= len(value['training']) <= 10 or not isinstance(value['audit'], list) or not 30 <= len(value['audit']) <= 100:
        raise ValueError('Manifest needs 3..10 training and 30..100 audit tasks')
    tasks = value['training'] + value['audit']
    published_ids = {t['id'] for t in TRAIN + AUDIT}
    published_inputs = {digest({'spec': t['spec'], 'cases': t['cases']}) for t in TRAIN + AUDIT}
    ids, inputs = set(), set()
    for task in tasks:
        if not isinstance(task, dict) or set(task) != {'id', 'spec', 'parameters', 'returnType', 'cases', 'referenceCode'} or not isinstance(task['id'], str) or not re.fullmatch('[a-z][a-z0-9-]{0,63}', task['id']) or not isinstance(task['spec'], str) or not 1 <= len(task['spec']) <= 4000 or not isinstance(task['cases'], list) or not 1 <= len(task['cases']) <= 30 or any(not isinstance(c, list) or len(c) != 2 or not isinstance(c[0], list) for c in task['cases']):
            raise ValueError('Invalid bounded task contract')
        if not isinstance(task['parameters'], list) or len(task['parameters']) > 8 or len(set(task['parameters'])) != len(task['parameters']) or any(not isinstance(name, str) or not re.fullmatch('[a-z][A-Za-z0-9_]{0,31}', name) for name in task['parameters']) or task['returnType'] not in ['null','boolean','number','string','array','object','json'] or not isinstance(task['referenceCode'], str) or not 1 <= len(task['referenceCode']) < 20000 or any(len(case[0]) != len(task['parameters']) for case in task['cases']):
            raise ValueError('Explicit signature, JSON return type and reference code required')
        json.dumps(task, allow_nan=False)
        identity = digest({'spec': task['spec'], 'cases': task['cases']})
        if task['id'] in ids or identity in inputs or task['id'] in published_ids or identity in published_inputs:
            raise ValueError('Published, duplicate or overlapping task requires a genuinely fresh corpus')
        ids.add(task['id']); inputs.add(identity)
    return value


def summarize(rows, audit):
    return {arm: {'passed': sum(bool(r['passed']) for r in rows if r['split'] == 'audit' and r['arm'] == arm),
                  'total': len(audit),
                  'missing': len(audit) - sum(1 for r in rows if r['split'] == 'audit' and r['arm'] == arm),
                  'knownReportedCostUSD': sum(r['costUSD'] for r in rows if r['split'] == 'audit' and r['arm'] == arm and r['costUSD'] is not None)}
            for arm in ['baseline', 'random', 'learned']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--manifest', required=True, help='Fresh host-owned training/audit JSON, not the published v1 corpus')
    parser.add_argument('--budget', type=float, default=.99)
    parser.add_argument('--cli', default='/home/ruv/.local/bin/claude-ruflo')
    args = parser.parse_args()
    if not math.isfinite(args.budget) or not 0 < args.budget <= 1:
        raise SystemExit('Pilot budget must be finite, positive and at most one USD')
    if not os.path.isabs(args.cli):
        raise SystemExit('Host-owned absolute Claude executable required')
    corpus = fresh_manifest(args.manifest)
    train, audit = corpus['training'], corpus['audit']
    root = pathlib.Path(args.root)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    plan = {'version': 2, 'training': train, 'audit': audit, 'strategies': STRATEGIES,
            'seed': 4472, 'costLimit': args.budget, 'primaryEndpoint':PRIMARY_ENDPOINT, 'runtime': 'Core ECMAScript in a Node vm context; no Buffer, TextEncoder, URLSearchParams, require, filesystem or network in solve. No mutation of input arguments.',
            'runnerHash': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
            'independentFamilies': 'unestablished: curated programming microtasks, not a representative agent workload corpus'}
    # Exclusive creation prevents silent overwrite/reuse of an existing holdout.
    with (root / 'plan.json').open('x') as handle:
        json.dump({'hash': digest(plan), 'plan': plan}, handle, indent=2)
    spent, rows, selected, error = 0., [], None, None

    def actor(task, strategy, split, arm):
        nonlocal spent
        remaining = args.budget - spent
        if remaining < .025:
            raise RuntimeError('Aggregate reported-cost admission cap reached')
        prompt = ('Implement JavaScript function solve('+','.join(task['parameters'])+'). Return a finite JSON-serializable '+task['returnType']+' value, never BigInt or undefined. Do not mutate inputs. Runtime: ' + plan['runtime'] + ' '
                  + task['spec'] + ' ' + STRATEGIES[strategy] + ' Return valid JSON, no Markdown.')
        cmd = [args.cli, '-p', prompt, '--tools', '', '--restricted', '--setting-sources', '',
               '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence',
               '--max-budget-usd', str(min(.025, remaining)), '--output-format', 'json']
        started = time.monotonic()
        row = {'task': task['id'], 'split': split, 'arm': arm, 'strategy': strategy, 'passed': False,
               'costUSD': None, 'terminalSuccess': False, 'status': 'failed', 'outputHash': digest(''), 'output': '', 'modelUsage': {}}
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=50, cwd=root)
            raw = json.loads(result.stdout)
            row['costUSD'] = measured_cost(raw)
            spent += row['costUSD']
            row['terminalSuccess'] = result.returncode == 0 and raw.get('is_error') is False
            row['output'] = raw.get('result', '') if isinstance(raw.get('result', ''), str) else ''
            row['outputHash'] = digest(row['output'])
            row['modelUsage'] = raw.get('modelUsage', {})
            try:
                code = json.loads(row['output'])['code']
                row['passed'] = bool(row['terminalSuccess'] and isinstance(code, str) and len(code) < 20000 and run_oracle(code, task))
            except (KeyError, ValueError, TypeError):
                pass
            row['status'] = 'finished' if row['terminalSuccess'] else 'failed'
        except subprocess.TimeoutExpired:
            row['status'] = 'timeout'
            raise
        finally:
            row['latencyMs'] = round((time.monotonic() - started) * 1000)
            rows.append(row)
            (root / 'rows.json').write_text(json.dumps(rows, indent=2))
            print(json.dumps({k: v for k, v in row.items() if k not in ['output', 'modelUsage']}), flush=True)
        if row['costUSD'] is None:
            raise RuntimeError('Unknown spend; no later admission allowed')

    try:
        # All reference contracts must pass the exact frozen oracle before ANY paid inference.
        reference_checks={task['id']:run_oracle(task['referenceCode'],task) for task in train+audit}
        (root/'reference-checks.json').write_text(json.dumps(reference_checks,indent=2))
        if not all(reference_checks.values()):
            raise RuntimeError('Reference oracle validation failed; no actor admission')
        for task in train:
            for strategy in STRATEGIES:
                actor(task, strategy, 'train', strategy)
        scores = {s: (sum(r['passed'] for r in rows if r['strategy'] == s), -sum(r['costUSD'] for r in rows if r['strategy'] == s)) for s in STRATEGIES}
        selected = max(scores, key=scores.get)
        (root / 'selection.json').write_text(json.dumps({'selected': selected, 'trainingScores': scores, 'planHash': digest(plan)}))
        rng = random.Random(4472)
        schedule = [(task, arm, 'baseline' if arm == 'baseline' else selected if arm == 'learned' else rng.choice(list(STRATEGIES))) for task in audit for arm in ['baseline', 'random', 'learned']]
        rng.shuffle(schedule)
        for task, arm, strategy in schedule:
            actor(task, strategy, 'audit', arm)
    except Exception as exc:
        # Exception type is diagnostic without reflecting credentials/provider text.
        error = type(exc).__name__
    finally:
        result = {'version': 2, 'planHash': digest(plan), 'selected': selected,
                  'trainingCalls': sum(r['split'] == 'train' for r in rows), 'auditCalls': sum(r['split'] == 'audit' for r in rows),
                  'plannedAuditCalls': len(audit) * 3, 'knownReportedCostUSD': spent, 'meteringUncertain': any(r['costUSD'] is None for r in rows),
                  'summary': summarize(rows, audit), 'terminalError': error,
                  'claim': 'pilot-only; no established adaptive or general agent improvement', 'defaultsChanged': False}
        (root / 'result.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result), flush=True)
    if error:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
