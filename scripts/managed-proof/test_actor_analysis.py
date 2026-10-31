import copy
import sys
import pathlib
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from actor_pilot import digest
from analyze_actor_pilot import analyze


class AnalysisTests(unittest.TestCase):
    def setUp(self):
        self.plan = {'seed':4472, 'training': [{'id': 'train'}], 'audit': [{'id': 'audit'}, {'id': 'missing'}], 'strategies': {'baseline': 'a', 'compact': 'b'}}
        self.record = {'hash': digest(self.plan), 'plan': self.plan}
        self.selection = {'selected': 'compact', 'planHash': self.record['hash']}
        self.rows = [{'task': 'train', 'split': 'train', 'arm': s, 'strategy': s, 'passed': True, 'terminalSuccess': True, 'costUSD': c, 'latencyMs': 1} for s, c in [('baseline', .02), ('compact', .01)]]
        self.rows.append({'task': 'audit', 'split': 'audit', 'arm': 'learned', 'strategy': 'compact', 'passed': True, 'terminalSuccess': False, 'costUSD': .01, 'latencyMs': 1})

    def test_missing_and_failed_are_not_dropped(self):
        result = analyze(self.record, self.selection, self.rows)
        self.assertEqual(result['summary']['learned']['total'], 2)
        self.assertEqual(result['summary']['learned']['passed'], 0)
        self.assertEqual(result['summary']['learned']['missing'], 1)
        self.assertFalse(result['liveImprovementProven'])

    def test_duplicate_and_foreign_task_rejected(self):
        with self.assertRaises(ValueError):
            analyze(self.record, self.selection, self.rows + [self.rows[-1]])
        self.rows[-1]['task'] = 'foreign'
        with self.assertRaises(ValueError):
            analyze(self.record, self.selection, self.rows)

    def test_changed_selection_or_plan_rejected(self):
        self.selection['selected'] = 'baseline'
        with self.assertRaises(ValueError):
            analyze(self.record, self.selection, self.rows)
        self.selection['selected'] = 'compact'
        self.plan['seed'] = 9
        with self.assertRaises(ValueError):
            analyze(self.record, self.selection, self.rows)

    def test_nonfinite_metering_and_incomplete_training_rejected(self):
        invalid = copy.deepcopy(self.rows)
        invalid[-1]['costUSD'] = float('nan')
        with self.assertRaises(ValueError):
            analyze(self.record, self.selection, invalid)
        with self.assertRaises(ValueError):
            analyze(self.record, self.selection, self.rows[1:])


if __name__ == '__main__':
    unittest.main()
