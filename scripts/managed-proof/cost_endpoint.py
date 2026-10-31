"""Preregistered cost-only endpoint. Does not replace Ruflo's quality-lift gate."""
from decimal import Decimal
from math import ceil, comb, isfinite

PRIMARY_ENDPOINT = {
    'id': 'global-prompt-cost-transfer-v1',
    'hypothesis': 'Training-selected global prompt lowers reported cost on fresh microtasks; not context-adaptive routing or model intelligence',
    'controls': ['baseline', 'random'], 'minTasks': 30, 'minCostReduction': .10,
    'pairedSignAlphaPerControl': .025, 'perTaskQualityNoRegression': True,
    'p95NoRegression': True, 'missingOutcomesFail': True, 'includeFailedTaskCosts': True,
    'independence': 'Task IDs are not proof of statistical independence; curator must justify independent pairs',
    'promotionAuthorized': False,
}


def evaluate_cost_endpoint(plan, rows):
    if plan.get('primaryEndpoint') != PRIMARY_ENDPOINT:
        raise ValueError('Cost endpoint was not frozen before execution')
    tasks = [task['id'] for task in plan['audit']]
    observations = {}
    for row in rows:
        if row['split'] != 'audit':
            continue
        key = (row['task'], row['arm'])
        if key in observations or row['task'] not in tasks or row['arm'] not in ['baseline', 'random', 'learned']:
            raise ValueError('Duplicate or foreign audit outcome')
        observations[key] = row
    complete = len(observations) == len(tasks) * 3 and len(tasks) >= PRIMARY_ENDPOINT['minTasks']
    valid = all(not isinstance(row.get('costUSD'), bool) and isinstance(row.get('costUSD'), (int,float)) and isfinite(row['costUSD']) and row['costUSD'] >= 0 and not isinstance(row.get('latencyMs'),bool) and isinstance(row.get('latencyMs'), (int,float)) and isfinite(row['latencyMs']) and row['latencyMs'] >= 0 and type(row.get('passed')) is bool and type(row.get('terminalSuccess')) is bool for row in observations.values())
    comparisons = []
    for control in PRIMARY_ENDPOINT['controls']:
        result = {'control': control, 'complete': complete and valid, 'passed': False}
        if complete and valid:
            pairs = [(observations[(task, control)], observations[(task, 'learned')]) for task in tasks]
            costs = lambda arm: sum(Decimal(str(observations[(task, arm)]['costUSD'])) for task in tasks)
            base_cost, learned_cost = costs(control), costs('learned')
            wins = sum(Decimal(str(c['costUSD'])) < Decimal(str(b['costUSD'])) for b,c in pairs)
            losses = sum(Decimal(str(c['costUSD'])) > Decimal(str(b['costUSD'])) for b,c in pairs)
            n = wins + losses
            p_value = sum(comb(n,k) for k in range(wins,n+1))/2**n if wins and n else 1.
            passed = lambda r: r['passed'] and r['terminalSuccess']
            quality_ok = all(not passed(b) or passed(c) for b,c in pairs) and any(passed(b) for b,c in pairs)
            p95 = lambda arm: sorted(observations[(task,arm)]['latencyMs'] for task in tasks)[ceil(len(tasks)*.95)-1]
            reduction = 1-learned_cost/base_cost if base_cost else None
            result.update({'wins': wins, 'losses': losses, 'ties': len(tasks)-n, 'pValue': p_value,
                           'baselineReportedCostUSD': float(base_cost), 'learnedReportedCostUSD': float(learned_cost),
                           'costReduction': float(reduction) if reduction is not None else None,
                           'perTaskQualityNoRegression': quality_ok, 'baselineP95Ms': p95(control), 'learnedP95Ms': p95('learned'),
                           'passed': reduction is not None and reduction >= Decimal('.10') and p_value <= .025 and quality_ok and p95('learned') <= p95(control)})
        comparisons.append(result)
    return {'endpoint': PRIMARY_ENDPOINT['id'], 'observedGatePassed': all(c['passed'] for c in comparisons),
            'comparisons': comparisons, 'independenceEstablished': False, 'generalAgentImprovementProven': False,
            'qualification': 'Conditional paired test on curated microtasks and SDK-reported list cost; independent-pair assumption and oracle validity require separate evidence.',
            'promotionAuthorized': False}
