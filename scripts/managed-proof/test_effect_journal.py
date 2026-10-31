import hashlib
import json
import pathlib
import sys
import subprocess
import os
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).parent))
import effect_journal as journal

h=lambda value:hashlib.sha256(value.encode()).hexdigest()
class PowerLoss(BaseException):pass

class EffectJournalTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name)/'journal';self.calls=[]
    def tearDown(self):self.temp.cleanup()
    def send(self):self.calls.append('provider');return {'generationId':'gen-test-one','costNanos':7,'receiptHash':h('provider-receipt')}
    def execute(self,attempt='one',fault=None):return journal.execute_once(self.root,h('plan'),100,h(attempt),h('request'+attempt),10,self.send,lambda r:r,fault)
    def test_success_duplicate_attempt_never_resends(self):
        result=self.execute();self.assertEqual(result['journal']['confirmedCostNanos'],7)
        with self.assertRaises(RuntimeError):self.execute()
        self.assertEqual(self.calls,['provider'])
    def test_crash_after_send_before_receipt_fences_same_and_new_attempts(self):
        def fail(phase):
            if phase=='after-send':raise PowerLoss()
        with self.assertRaises(PowerLoss):self.execute(fault=fail)
        state=journal.journal_status(self.root);self.assertTrue(state['requiresReconciliation']);self.assertEqual(state['reservedUnknownCostNanos'],10)
        for attempt in ['one','two']:
            with self.assertRaises(RuntimeError):self.execute(attempt)
        self.assertEqual(len(self.calls),1)
    def test_crash_before_send_is_also_not_assumed_safe_to_retry(self):
        with self.assertRaises(PowerLoss):self.execute(fault=lambda phase:(_ for _ in ()).throw(PowerLoss()))
        self.assertEqual(self.calls,[]);self.assertTrue(journal.journal_status(self.root)['requiresReconciliation'])
        with self.assertRaises(RuntimeError):self.execute()
    def test_exception_or_missing_metering_preserves_unknown_intent(self):
        def send():raise TimeoutError()
        with self.assertRaises(TimeoutError):journal.execute_once(self.root,h('plan'),100,h('one'),h('r'),10,send,lambda r:r)
        self.assertTrue(journal.journal_status(self.root)['requiresReconciliation'])
    def test_actual_child_hard_exit_after_send_then_restart_blocks_duplicate(self):
        counter=self.root.parent/'fake-provider-count'
        script="""import os,sys,pathlib,hashlib
sys.path.insert(0,HELPER)
import effect_journal as j
h=lambda v:hashlib.sha256(v.encode()).hexdigest()
def send():
 fd=os.open(COUNTER,os.O_CREAT|os.O_WRONLY|os.O_EXCL,0o600)
 os.write(fd,b'one-effect');os.fsync(fd);os.close(fd)
 return {'generationId':'gen-child','costNanos':7,'receiptHash':h('receipt')}
def crash(phase):
 if phase=='after-send':os._exit(73)
j.execute_once(ROOT,h('plan'),100,h('one'),h('requestone'),10,send,lambda r:r,crash)
"""
        script=script.replace('HELPER',repr(str(pathlib.Path(journal.__file__).parent))).replace('COUNTER',repr(str(counter))).replace('ROOT',repr(str(self.root)))
        child=subprocess.run([sys.executable,'-c',script],env={'PATH':os.defpath},capture_output=True,timeout=5)
        self.assertEqual(child.returncode,73);self.assertEqual(counter.read_text(),'one-effect')
        self.assertTrue(journal.journal_status(self.root)['requiresReconciliation'])
        with self.assertRaises(RuntimeError):self.execute()
        with self.assertRaises(RuntimeError):self.execute('two')
        self.assertEqual(self.calls,[]);self.assertEqual(counter.read_text(),'one-effect')

    def test_parent_directory_fsync_failure_never_grants_send(self):
        original=journal.os.fsync;parent_inode=self.root.parent.stat().st_ino
        def sync(fd):
            if os.fstat(fd).st_ino==parent_inode:raise OSError('parent-not-durable')
            return original(fd)
        with patch.object(journal.os,'fsync',side_effect=sync):
            with self.assertRaises(OSError):self.execute()
        self.assertEqual(self.calls,[])
        self.assertFalse((self.root/'effects.json').exists())

    def test_missing_ancestor_is_not_recursively_created_as_durable(self):
        target=self.root.parent/'missing'/'child'
        with self.assertRaises(FileNotFoundError):journal.begin_attempt(target,h('plan'),100,h('one'),h('r'),10)
        self.assertFalse(target.parent.exists())

    def test_provider_reconciliation_commits_once_without_resend(self):
        grant=journal.begin_attempt(self.root,h('plan'),100,h('one'),h('request'),10)
        journal.mark_unknown(self.root,grant)
        first=journal.commit_receipt(self.root,grant,'gen-reconciled',9,h('receipt'))
        again=journal.commit_receipt(self.root,grant,'gen-reconciled',9,h('receipt'))
        self.assertFalse(first['duplicate']);self.assertTrue(again['duplicate']);self.assertEqual(again['confirmedCostNanos'],9)
        self.assertFalse(again['requiresReconciliation']);self.assertEqual(self.calls,[])
        with self.assertRaises(ValueError):journal.commit_receipt(self.root,grant,'gen-reconciled',8,h('receipt'))
    def test_actual_cost_overrun_is_recorded_then_future_admission_denied(self):
        grant=journal.begin_attempt(self.root,h('plan'),10,h('one'),h('r'),10)
        result=journal.commit_receipt(self.root,grant,'gen-overrun',12,h('receipt'));self.assertTrue(result['budgetExceeded']);self.assertEqual(result['confirmedCostNanos'],12)
        with self.assertRaises(RuntimeError):journal.begin_attempt(self.root,h('plan'),10,h('two'),h('r2'),1)
    def test_duplicate_generation_or_changed_identity_denied(self):
        grant=journal.begin_attempt(self.root,h('plan'),100,h('one'),h('r'),10);journal.commit_receipt(self.root,grant,'gen-same',1,h('receipt'))
        with self.assertRaises(ValueError):journal.begin_attempt(self.root,h('other-plan'),100,h('two'),h('r2'),10)
        with self.assertRaises(ValueError):journal.begin_attempt(self.root,h('plan'),101,h('two'),h('r2'),10)
        other=journal.begin_attempt(self.root,h('plan'),100,h('two'),h('r2'),10)
        with self.assertRaises(ValueError):journal.commit_receipt(self.root,other,'gen-same',1,h('receipt'))
        self.assertTrue(journal.journal_status(self.root)['requiresReconciliation'])
    def test_fsync_failure_before_grant_never_calls_provider(self):
        with patch.object(journal.os,'fsync',side_effect=OSError('unsupported')):
            with self.assertRaises((OSError,ValueError)):self.execute()
        self.assertEqual(self.calls,[])
    def test_intent_and_receipt_file_and_directory_fsync_before_success(self):
        original=journal.os.fsync;calls=[]
        with patch.object(journal.os,'fsync',side_effect=lambda fd:(calls.append(fd),original(fd))[1]):self.execute()
        self.assertGreaterEqual(len(calls),6)
        state=json.loads((self.root/'effects.json').read_text());self.assertEqual(state['attempts'][0]['phase'],'receipt')
    def test_stale_lock_corrupt_file_and_symlink_fail_closed(self):
        self.root.mkdir(mode=0o700);(self.root/'effects.lock').write_text('stale')
        with self.assertRaises(RuntimeError):self.execute()
        (self.root/'effects.lock').unlink();(self.root/'effects.json').write_text('bad-json');(self.root/'effects.json').chmod(0o600)
        with self.assertRaises(ValueError):self.execute()
        (self.root/'effects.json').unlink();(self.root/'effects.json').symlink_to('/dev/null')
        with self.assertRaises((OSError,ValueError)):self.execute()
        self.assertEqual(self.calls,[])
    def test_booleans_and_changed_request_grant_rejected(self):
        with self.assertRaises(ValueError):journal.begin_attempt(self.root,h('plan'),True,h('one'),h('r'),10)
        grant=journal.begin_attempt(self.root,h('plan'),100,h('one'),h('r'),10);grant['requestDigest']=h('changed')
        with self.assertRaises(ValueError):journal.commit_receipt(self.root,grant,'gen-one',1,h('receipt'))
    def test_crash_after_durable_receipt_does_not_allow_another_send(self):
        def fail(phase):
            if phase=='after-receipt':raise PowerLoss()
        with self.assertRaises(PowerLoss):self.execute(fault=fail)
        self.assertFalse(journal.journal_status(self.root)['requiresReconciliation'])
        with self.assertRaises(RuntimeError):self.execute()
        self.assertEqual(len(self.calls),1)

if __name__=='__main__':unittest.main()
