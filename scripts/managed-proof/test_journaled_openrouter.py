import json
import pathlib
import sys
import tempfile
import unittest
from decimal import Decimal
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).parent))
import journaled_openrouter as adapter

class JournaledCallerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name)/'effects'
        self.model={'id':adapter.client.MODEL,'canonical_slug':adapter.client.MODEL+'-20261023','promptPrice':'.000002','completionPrice':'.00001'}
        self.actor=adapter.JournaledOpenRouter(self.root,adapter.digest('plan'),Decimal('.02'))
        self.response={'id':'gen-unit-journal','model':adapter.client.MODEL,'provider':'unit-provider','usage':{'cost':.0001,'prompt_tokens':1,'completion_tokens':1,'total_tokens':2},'choices':[{'finish_reason':'stop','message':{'content':'{"code":"function solve(){return 4;}"}'}}]}
    def tearDown(self):self.temp.cleanup()
    def test_success_receipt_is_durable_before_return_and_duplicate_never_sends(self):
        with patch.object(adapter,'openrouter_credential',return_value='unit-placeholder'),patch.object(adapter.client,'request_json',return_value=self.response)as network:
            result=self.actor.complete(self.model,'Return four.',Decimal('.02'),adapter.digest('attempt'),max_tokens=32)
            self.assertEqual(result['effectJournal']['confirmedCostNanos'],100000)
            self.assertFalse(result['effectJournal']['requiresReconciliation'])
            with self.assertRaises(RuntimeError):self.actor.complete(self.model,'Return four.',Decimal('.02'),adapter.digest('attempt'),max_tokens=32)
            self.assertEqual(network.call_count,1)
        self.assertEqual(json.loads((self.root/'effects.json').read_text())['attempts'][0]['phase'],'receipt')
    def test_network_loss_records_unknown_and_blocks_different_attempt(self):
        with patch.object(adapter,'openrouter_credential',return_value='unit-placeholder'),patch.object(adapter.client,'request_json',side_effect=TimeoutError())as network:
            for attempt in ['one','two']:
                with self.assertRaises((TimeoutError,RuntimeError)):self.actor.complete(self.model,'Return four.',Decimal('.02'),adapter.digest(attempt),max_tokens=32)
            self.assertEqual(network.call_count,1)
        self.assertTrue(adapter.journal.journal_status(self.root)['requiresReconciliation'])
    def test_unknown_receipt_metering_blocks_later_requests(self):
        raw=dict(self.response);raw['usage']={}
        with patch.object(adapter,'openrouter_credential',return_value='unit-placeholder'),patch.object(adapter.client,'request_json',return_value=raw):
            with self.assertRaises(ValueError):self.actor.complete(self.model,'Return four.',Decimal('.02'),adapter.digest('attempt'),max_tokens=32)
        self.assertTrue(adapter.journal.journal_status(self.root)['requiresReconciliation'])
    def test_budget_or_credential_failure_is_before_network_intent(self):
        with patch.object(adapter,'openrouter_credential',side_effect=RuntimeError('unavailable')),patch.object(adapter.client,'request_json')as network:
            with self.assertRaises(RuntimeError):self.actor.complete(self.model,'x',Decimal('.02'),adapter.digest('one'),max_tokens=32)
            network.assert_not_called();self.assertFalse(self.root.exists())
    def test_explicit_placement_and_fixed_model_only(self):
        actor=adapter.JournaledOpenRouter(self.root,adapter.digest('plan'),Decimal('.02'),allow_ruos_placement=True)
        with patch.object(adapter,'openrouter_credential',return_value='unit-placeholder')as credential,patch.object(adapter.client,'request_json',return_value=self.response):
            actor.complete(self.model,'x',Decimal('.02'),adapter.digest('one'),max_tokens=32)
            credential.assert_called_with(allow_ruos_placement=True)
        bad={**self.model,'id':'foreign/model'}
        with self.assertRaises(ValueError):actor.complete(bad,'x',Decimal('.02'),adapter.digest('two'),max_tokens=32)

if __name__=='__main__':unittest.main()
