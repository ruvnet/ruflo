import json
import pathlib
import subprocess
import sys
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from actor_pilot import sandbox_source
from verified_application import application_contract,select_verified_application

ROOT=pathlib.Path(__file__).resolve().parents[2]

class VerifiedApplicationTests(unittest.TestCase):
    def setUp(self):
        fixture=json.loads((ROOT/'docs/validation/managed-booster-counterexample.json').read_text());self.task=fixture['task'];self.row=fixture['row'];self.original=self.task['code'];self.candidate=self.row['candidateCode'];self.booster={'available':True,'version':'0.2.2','admitted':self.row['boosterAdmitted'],'output':self.row['boosterCode'],'confidence':self.row['boosterConfidence'],'strategy':self.row['boosterStrategy'],'latencyMs':self.row['boosterLatencyMs']}
    @staticmethod
    def oracle(code,task):
        # Known archived fixture only. Live hosts use the bubblewrap oracle.
        return subprocess.run(['node','-e',sandbox_source(code,task['cases'])],capture_output=True,timeout=2).returncode==0
    def test_actual_confident_mismerge_never_selected(self):
        self.assertGreaterEqual(self.booster['confidence'],.5);self.assertTrue(self.booster['admitted'])
        self.assertFalse(self.oracle(self.booster['output'],self.task));self.assertTrue(self.oracle(self.candidate,self.task))
        contract=application_contract('complete-source',self.original,self.candidate,self.task)
        result=select_verified_application(self.original,self.candidate,self.booster,self.task,contract,oracle=self.oracle)
        self.assertTrue(result['accepted']);self.assertEqual(result['selected'],'verified-full-source');self.assertFalse(result['boosterOraclePassed']);self.assertEqual(result['output'],self.candidate)
    def test_partial_edit_never_gets_direct_fallback(self):
        contract=application_contract('partial-edit',self.original,self.candidate,self.task)
        result=select_verified_application(self.original,self.candidate,self.booster,self.task,contract,oracle=self.oracle)
        self.assertFalse(result['accepted']);self.assertIsNone(result['output'])
    def test_verified_booster_is_allowed_for_partial_contract(self):
        result={**self.booster,'output':self.candidate}
        contract=application_contract('partial-edit',self.original,self.candidate,self.task)
        selected=select_verified_application(self.original,self.candidate,result,self.task,contract,oracle=self.oracle)
        self.assertTrue(selected['accepted']);self.assertEqual(selected['selected'],'booster')
    def test_stale_or_model_expanded_contract_rejected(self):
        contract=application_contract('complete-source',self.original,self.candidate,self.task)
        for changed in [{**contract,'approved':True},{**contract,'version':True},{**contract,'candidateHash':'0'*64}]:
            with self.subTest(changed=changed),self.assertRaises(ValueError):select_verified_application(self.original,self.candidate,self.booster,self.task,changed,oracle=self.oracle)
    def test_unknown_engine_does_not_get_trusted_but_verified_full_source_can(self):
        result={**self.booster,'version':'other'};contract=application_contract('complete-source',self.original,self.candidate,self.task)
        selected=select_verified_application(self.original,self.candidate,result,self.task,contract,oracle=self.oracle)
        self.assertEqual(selected['selected'],'verified-full-source');self.assertFalse(selected['confidenceIsVerification'])
    def test_non_boolean_oracle_cannot_grant_acceptance(self):
        contract=application_contract('complete-source',self.original,self.candidate,self.task)
        for value in ['false',{'passed':False},1]:
            with self.subTest(value=value):self.assertFalse(select_verified_application(self.original,self.candidate,self.booster,self.task,contract,oracle=lambda *args:value)['accepted'])

    def test_unavailable_oracle_never_accepts_either_path(self):
        contract=application_contract('complete-source',self.original,self.candidate,self.task)
        def unavailable(*args):raise RuntimeError()
        result=select_verified_application(self.original,self.candidate,self.booster,self.task,contract,oracle=unavailable)
        self.assertFalse(result['accepted'])

if __name__=='__main__':unittest.main()
