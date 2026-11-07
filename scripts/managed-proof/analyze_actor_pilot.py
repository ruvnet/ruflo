"""Read-only description of archived v1 evidence. Never converts pilot scores to proof."""
import argparse
import hashlib
import json
import math
import pathlib
import random

from actor_pilot import digest, measured_cost


def analyze(plan_record, selection, rows):
    plan = plan_record['plan']
    if plan_record['hash'] != digest(plan) or selection['planHash'] != plan_record['hash']:
        raise ValueError('Plan or selection hash mismatch')
    train_ids = [t['id'] for t in plan['training']]
    audit_ids = [t['id'] for t in plan['audit']]
    strategies = list(plan['strategies'])
    rng = random.Random(plan['seed'])
    random_choices = {task_id: rng.choice(strategies) for task_id in audit_ids}
    if len(set(train_ids + audit_ids)) != len(train_ids + audit_ids) or len(strategies) != 2:
        raise ValueError('Training/audit overlap or unexpected strategy family')
    seen = set()
    normalized = []
    for row in rows:
        split, arm, task, strategy = row['split'], row['arm'], row['task'], row['strategy']
        if split not in ['train', 'audit'] or strategy not in strategies:
            raise ValueError('Unknown result split or strategy')
        valid_ids = train_ids if split == 'train' else audit_ids
        valid_arms = strategies if split == 'train' else ['baseline', 'random', 'learned']
        if task not in valid_ids or arm not in valid_arms or (split == 'train' and arm != strategy):
            raise ValueError('Unknown task or result arm')
        key = (split, task, arm)
        if key in seen:
            raise ValueError('Duplicate outcome')
        seen.add(key)
        cost = measured_cost({'total_cost_usd': row['costUSD']})
        if type(row['passed']) is not bool or type(row['terminalSuccess']) is not bool or isinstance(row['latencyMs'], bool) or not isinstance(row['latencyMs'], (int, float)) or not math.isfinite(row['latencyMs']) or row['latencyMs'] < 0:
            raise ValueError('Invalid outcome measurements')
        normalized.append({**row, 'passed': row['passed'] and row['terminalSuccess'], 'costUSD': cost})
    if sum(r['split'] == 'train' for r in normalized) != len(train_ids) * len(strategies):
        raise ValueError('Incomplete training selection')
    scores = {s: (sum(r['passed'] for r in normalized if r['split'] == 'train' and r['strategy'] == s),
                  -sum(r['costUSD'] for r in normalized if r['split'] == 'train' and r['strategy'] == s)) for s in strategies}
    chosen = max(scores, key=scores.get)
    if selection['selected'] != chosen:
        raise ValueError('Selection does not match declared training rule')
    for row in normalized:
        if row['split'] == 'audit' and row['arm'] == 'learned' and row['strategy'] != chosen:
            raise ValueError('Learned arm does not use frozen selection')
        if row['split'] == 'audit' and row['arm'] == 'random' and row['strategy'] != random_choices[row['task']]:
            raise ValueError('Random arm changed frozen schedule')
        if row['split'] == 'audit' and row['arm'] == 'baseline' and row['strategy'] != 'baseline':
            raise ValueError('Baseline arm changed strategy')
    summary = {}
    for arm in ['baseline', 'random', 'learned']:
        group = [r for r in normalized if r['split'] == 'audit' and r['arm'] == arm]
        times = sorted(r['latencyMs'] for r in group)
        summary[arm] = {'passed': sum(r['passed'] for r in group), 'total': len(audit_ids),
                        'observed': len(group), 'missing': len(audit_ids) - len(group),
                        'reportedCostUSD': sum(r['costUSD'] for r in group),
                        'observedP95Ms': times[max(0, math.ceil(len(times) * .95) - 1)] if times else None}
    baseline_cost = summary['baseline']['reportedCostUSD']
    cost_reduction = 1 - summary['learned']['reportedCostUSD'] / baseline_cost if baseline_cost else None
    passes = {(r['task'], r['arm']): r['passed'] for r in normalized if r['split'] == 'audit'}
    regressions = [task_id for task_id in audit_ids if passes.get((task_id, 'baseline'), False) and not passes.get((task_id, 'learned'), False)]
    return {'schema': 'ruflo.live-actor-pilot-analysis/v1', 'planHash': plan_record['hash'], 'selected': chosen,
            'trainingCalls': len(train_ids) * len(strategies), 'auditCalls': sum(r['split'] == 'audit' for r in normalized),
            'reportedCostUSD': sum(r['costUSD'] for r in normalized), 'summary': summary,
            'observedLearnedCostReduction': cost_reduction,
            'observedPairedRegressions': regressions, 'observedPerTaskNoRegression': not regressions,
            'observedAggregateQualityNoRegression': summary['learned']['passed'] >= summary['baseline']['passed'],
            'liveModelInferenceExecuted': True, 'liveImprovementProven': False, 'promotionAuthorized': False,
            'limitations': ['Descriptive SDK-reported list-cost and host-oracle scores, not invoice audit.',
                            'No separately signed registration/oracle chain and no established independent task families.',
                            'The selected prompt may be a better static default; no separate static-best control executed.',
                            ('The v1 prompt omitted the exact VM runtime contract; TextEncoder/URLSearchParams are absent.' if plan.get('version',1)==1 else 'The v2 prompt declared core ECMAScript and explicit finite JSON signatures; recorded oracle validity remains conditional on its implemented cases.'),
                            'The selector uses float USD; native managed learning uses integer cents and was not this selector.',
                            'Cost-only observations cannot satisfy the preregistered quality-lift proof gate.']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('root')
    args = parser.parse_args()
    root = pathlib.Path(args.root)
    result = analyze(*[json.loads((root / name).read_text()) for name in ['plan.json', 'selection.json', 'rows.json']])
    result['artifactHashes'] = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in ['plan.json', 'selection.json', 'rows.json']}
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
