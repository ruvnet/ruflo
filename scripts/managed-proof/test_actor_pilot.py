"""Offline tests for the unexecuted v2 hardening, not live performance claims."""
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import actor_pilot


class PilotHardening(unittest.TestCase):
    def test_cost_is_finite_numeric_and_not_boolean(self):
        for value in [None, True, False, float('nan'), float('inf'), float('-inf'), -1, '0.01']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                actor_pilot.measured_cost({'total_cost_usd': value})
        self.assertEqual(actor_pilot.measured_cost({'total_cost_usd': 0}), 0)
        self.assertEqual(actor_pilot.measured_cost({'total_cost_usd': .01}), .01)

    def test_missing_outcomes_remain_in_denominator(self):
        rows = [{'split': 'audit', 'arm': 'learned', 'passed': False, 'costUSD': None}]
        result = actor_pilot.summarize(rows, [{'id': 'one'}, {'id': 'two'}])
        self.assertEqual(result['learned']['total'], 2)
        self.assertEqual(result['learned']['passed'], 0)
        self.assertEqual(result['learned']['missing'], 1)
        self.assertEqual(result['baseline']['missing'], 2)

    def run_js(self, code, args, expected):
        return subprocess.run(['node', '-e', actor_pilot.sandbox_source(code, [[args, expected]])], capture_output=True, timeout=2).returncode

    def test_vm_arguments_are_isolated(self):
        self.assertEqual(self.run_js('function solve(a){return a.reduce((n,x)=>n+x,0)}', [[1, 2]], 3), 0)
        self.assertNotEqual(self.run_js('function solve(a){return a.constructor.constructor("return process")().env.HOME}', [[]], None), 0)

    def test_input_mutation_is_rejected(self):
        self.assertNotEqual(self.run_js('function solve(a){a.push(9);return 1}', [[]], 1), 0)

    def test_prototype_named_expected_keys_are_preserved(self):
        code='function solve(){const out=Object.create(null);out["__proto__"]=1;return out}'
        self.assertEqual(self.run_js(code,[],{'__proto__':1}),0)
        self.assertNotEqual(self.run_js('function solve(){return {}}',[],{'__proto__':1}),0)

    def test_nonfinite_tojson_and_accessors_are_rejected(self):
        for code in ['function solve(){return NaN}', 'function solve(){return Infinity}', 'function solve(){return {toJSON(){return null}}}', 'function solve(){return {get x(){while(true){}}}}']:
            with self.subTest(code=code):self.assertNotEqual(self.run_js(code,[],None),0)
        self.assertNotEqual(self.run_js('function solve(){return {x:undefined}}',[],{}),0)

    def test_pristine_intrinsics_preserve_output_and_mutation_checks(self):
        self.assertNotEqual(self.run_js('JSON.stringify=()=>"[]";function solve(a){a.push(9);return 1}',[[]],1),0)
        self.assertEqual(self.run_js('JSON.stringify=()=>"wrong";Object.prototype.toJSON=()=>null;function solve(){return {a:1}}',[],{'a':1}),0)

    def test_dynamic_codegen_and_loops_are_rejected(self):
        self.assertNotEqual(self.run_js('function solve(){return eval("1")}', [], 1), 0)
        self.assertNotEqual(self.run_js('function solve(){while(true){}}', [], None), 0)

    def test_published_and_duplicate_manifests_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            manifest=pathlib.Path(root,'manifest.json')
            manifest.write_text(json.dumps({'training':actor_pilot.TRAIN,'audit':actor_pilot.AUDIT}))
            with self.assertRaises(ValueError):actor_pilot.fresh_manifest(manifest)
            tasks=[{'id':'fresh'+str(i),'spec':'Return constant '+str(i),'parameters':[],'returnType':'number','referenceCode':'function solve(){return '+str(i)+'}', 'cases':[[[],i]]} for i in range(33)]
            tasks[-1]['spec']=tasks[0]['spec'];tasks[-1]['cases']=tasks[0]['cases']
            manifest.write_text(json.dumps({'training':tasks[:3],'audit':tasks[3:]}))
            with self.assertRaises(ValueError):actor_pilot.fresh_manifest(manifest)

    def test_bad_reference_stops_before_any_actor_call(self):
        with tempfile.TemporaryDirectory() as root:
            manifest=pathlib.Path(root,'fresh.json')
            tasks=[{'id':'fresh'+str(i),'spec':'Return constant '+str(i),'parameters':[],'returnType':'number','referenceCode':'function solve(){return '+str(i)+'}', 'cases':[[[],i]]} for i in range(33)]
            manifest.write_text(json.dumps({'training':tasks[:3],'audit':tasks[3:]}))
            argv=['actor_pilot.py','--root',root,'--manifest',str(manifest),'--cli','/host/fixed-claude']
            with patch.object(sys,'argv',argv),patch('actor_pilot.run_oracle',return_value=False),patch('actor_pilot.subprocess.run') as actor:
                with self.assertRaises(SystemExit):actor_pilot.main()
                actor.assert_not_called()
            result=json.loads(pathlib.Path(root,'result.json').read_text())
            self.assertEqual(result['trainingCalls'],0);self.assertEqual(result['auditCalls'],0)

    def test_oracle_output_is_not_captured(self):
        with patch('actor_pilot.subprocess.run') as run:
            run.return_value.returncode = 0
            self.assertTrue(actor_pilot.run_oracle('function solve(){return 1}', {'cases': [[[], 1]]}))
            self.assertEqual(run.call_args.kwargs['stdout'], subprocess.DEVNULL)
            self.assertEqual(run.call_args.kwargs['stderr'], subprocess.DEVNULL)

    def test_timeout_stops_campaign_and_writes_terminal_artifact(self):
        with tempfile.TemporaryDirectory() as root:
            manifest=pathlib.Path(root,'fresh.json')
            tasks=[{'id':'fresh'+str(i),'spec':'Return constant '+str(i),'parameters':[],'returnType':'number','referenceCode':'function solve(){return '+str(i)+'}', 'cases':[[[],i]]} for i in range(33)]
            manifest.write_text(json.dumps({'training':tasks[:3],'audit':tasks[3:]}))
            argv = ['actor_pilot.py', '--root', root, '--manifest',str(manifest),'--cli', '/host/fixed-claude']
            with patch.object(sys, 'argv', argv), patch('actor_pilot.run_oracle',return_value=True), patch('actor_pilot.subprocess.run', side_effect=subprocess.TimeoutExpired('actor', 50)):
                with self.assertRaises(SystemExit):
                    actor_pilot.main()
            result = json.loads(pathlib.Path(root, 'result.json').read_text())
            rows = json.loads(pathlib.Path(root, 'rows.json').read_text())
            self.assertTrue(result['meteringUncertain'])
            self.assertEqual(result['terminalError'], 'TimeoutExpired')
            self.assertEqual(result['auditCalls'], 0)
            self.assertEqual(rows[0]['status'], 'timeout')
            self.assertEqual(result['summary']['learned']['missing'], 30)
            with patch.object(sys, 'argv', argv), self.assertRaises(FileExistsError):
                actor_pilot.main()


if __name__ == '__main__':
    unittest.main()
