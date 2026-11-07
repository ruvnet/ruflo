import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from decimal import Decimal
from unittest.mock import patch
HERE=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import openrouter_client as client
import transfer_pilot as transfer
import edit_ablation as edit

CATALOG={'data':[{'id':client.MODEL,'canonical_slug':client.MODEL+'-20261023','pricing':{'prompt':'.000002','completion':'.00001'},'supported_parameters':['max_tokens','reasoning','response_format']}]}

class TransferTests(unittest.TestCase):
    def test_catalog_exact_model(self):
        self.assertEqual(client.catalog_model(CATALOG)['id'],client.MODEL)
        with self.assertRaises(ValueError):client.catalog_model({'data':[]})
    def test_catalog_requires_bounds(self):
        value=json.loads(json.dumps(CATALOG));value['data'][0]['supported_parameters']=[]
        with self.assertRaises(ValueError):client.catalog_model(value)
    def test_metering_rejects_nonfinite_bool_missing_negative(self):
        for value in [None,True,False,float('nan'),float('inf'),-1,'0.1']:
            with self.subTest(value=value),self.assertRaises(ValueError):client.finite_cost(value)
        self.assertEqual(client.finite_cost(.001),Decimal('.001'))
    def test_call_preserves_fixed_model_and_secret_only_header_transport(self):
        seen=[]
        def sender(url,payload,key):
            seen.append((url,payload,key))
            return {'id':'gen-unit-test','model':client.MODEL,'usage':{'cost':.001,'prompt_tokens':2,'completion_tokens':3,'total_tokens':5},'choices':[{'finish_reason':'stop','message':{'content':'{"code":"function solve(){return 1}"}'}}]}
        result=client.complete(client.catalog_model(CATALOG),'Return one.',Decimal('.1'),sender=sender,key='unit-placeholder')
        self.assertEqual(result['providerReceipt']['generationId'],'gen-unit-test');self.assertEqual(result['providerReceipt']['usage']['total_tokens'],5);self.assertEqual(len(result['requestDigest']),64)
        self.assertTrue(result['finished']);self.assertEqual(seen[0][0],client.COMPLETIONS)
        self.assertEqual(seen[0][1]['reasoning'],{'effort':'none'})
        self.assertFalse(seen[0][1]['provider']['allow_fallbacks'])
        self.assertNotIn('unit-placeholder',json.dumps(result));self.assertNotIn('unit-placeholder',json.dumps(seen[0][1]))
    def test_admission_before_provider(self):
        with patch.object(client,'request_json')as call:
            with self.assertRaises(RuntimeError):client.complete(client.catalog_model(CATALOG),'x',Decimal('.00001'),sender=call,key='unit-placeholder')
            call.assert_not_called()
    def test_missing_model_or_metering_is_unknown_spend(self):
        for response in [{'model':None,'usage':{'cost':.001}},{'model':client.MODEL},{'model':'other/model','usage':{'cost':.001}}]:
            with self.subTest(response=response),self.assertRaises(RuntimeError):client.complete(client.catalog_model(CATALOG),'x',Decimal('.1'),sender=lambda *args:response,key='unit-placeholder')
    def test_incomplete_output_keeps_cost(self):
        response={'id':'gen-unit-test','model':client.MODEL,'usage':{'cost':.001,'prompt_tokens':2,'completion_tokens':3,'total_tokens':5},'choices':[{'finish_reason':'length','message':{'content':'incomplete'}}]}
        result=client.complete(client.catalog_model(CATALOG),'x',Decimal('.1'),sender=lambda *args:response,key='unit-placeholder')
        self.assertFalse(result['finished']);self.assertEqual(result['costUSD'],.001)
    def test_no_implicit_credential(self):
        with patch.dict('os.environ',{},clear=True),self.assertRaises(RuntimeError):client.complete(client.catalog_model(CATALOG),'x',Decimal('.1'))
    def test_no_redirect_or_arbitrary_origin(self):
        with self.assertRaises(RuntimeError):client.NoRedirect().redirect_request(None,None,302,'',{},'https://elsewhere.example')
        with self.assertRaises(ValueError):client.request_json('https://elsewhere.example')
    def test_prompt_and_output_bound(self):
        for prompt,tokens in [('x'*32001,1),('x',True),('x',0),('x',1025)]:
            with self.subTest(tokens=tokens),self.assertRaises(ValueError):client.max_list_cost(client.catalog_model(CATALOG),prompt,tokens)
    def test_training_choice_uses_training_only(self):
        rows=[{'strategy':'baseline','passed':True,'costUSD':.01},{'strategy':'compact','passed':True,'costUSD':.005}]
        self.assertEqual(transfer.choose_training(rows),'compact')
        rows[1]['passed']=False;self.assertEqual(transfer.choose_training(rows),'baseline')
    def test_history_blocks_reuse(self):
        corpus={'training':[],'audit':[{'id':'one','spec':'one','cases':[[[],1]]}]}
        with tempfile.TemporaryDirectory()as root:
            path=pathlib.Path(root)/'history.json';path.write_text(json.dumps({'plan':{'plan':corpus}}))
            with self.assertRaises(ValueError):transfer.reject_history(corpus,[path])
    def test_history_under_transfer_corpus_and_empty_history(self):
        corpus={'training':[],'audit':[{'id':'one','spec':'one','cases':[[[],1]]}]}
        with tempfile.TemporaryDirectory()as root:
            path=pathlib.Path(root)/'history.json'
            for raw in [{'plan':{'plan':{'corpus':corpus}}},{},{'plan':{'plan':{'corpus':{}}}}]:
                path.write_text(json.dumps(raw))
                with self.subTest(raw=raw),self.assertRaises(ValueError):transfer.reject_history(corpus,[path])

    def test_missing_outcomes_keep_denominator(self):
        result=transfer.summarize([],['one','two'])
        self.assertEqual(result['transferred']['missing'],2);self.assertEqual(result['transferred']['total'],2)
    def test_policy_closed_and_frozen(self):
        with tempfile.TemporaryDirectory()as root:
            path=pathlib.Path(root)/'policy.json';base={'version':1,'instruction':'compact','sourcePlanHash':'a'*64,'sourceTrainingDigest':'b'*64,'sourceModel':'source'};path.write_text(json.dumps(base))
            self.assertEqual(transfer.load_policy(path)['instruction'],'compact')
            base['approval']=True;path.write_text(json.dumps(base))
            with self.assertRaises(ValueError):transfer.load_policy(path)
    def test_edit_booster_missing_is_not_fallback(self):
        with patch.object(edit.subprocess,'run',return_value=type('Result',(),{'returncode':3,'stdout':'{"available":false}'})()):
            with self.assertRaises(RuntimeError):edit.booster_apply('one','two','javascript','/tmp')
    def test_edit_bridge_strips_provider_credentials(self):
        value={'available':True,'admitted':False,'output':None}
        with patch.object(edit.subprocess,'run',return_value=type('Result',(),{'returncode':0,'stdout':json.dumps(value)})())as run:
            result=edit.booster_apply('one','two','javascript','/tmp');self.assertFalse(result['admitted'])
            self.assertEqual(set(run.call_args.kwargs['env']),{'PATH','LANG','LC_ALL'})
    def test_edit_manifest_closed(self):
        with tempfile.TemporaryDirectory()as root:
            path=pathlib.Path(root)/'edits.json';path.write_text(json.dumps({'tasks':[{'id':'one','code':'function solve(x){return x}','edit':'add one','language':'javascript','cases':[[[1],2]],'referenceCode':'function solve(x){return x+1}'}]}))
            self.assertEqual(len(edit.load_edits(path)['tasks']),1)
            path.write_text('{"tasks":[],"approved":true}')
            with self.assertRaises(ValueError):edit.load_edits(path)

if __name__=='__main__':unittest.main()
