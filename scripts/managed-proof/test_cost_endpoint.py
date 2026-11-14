import copy
import pathlib
import sys
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from cost_endpoint import PRIMARY_ENDPOINT,evaluate_cost_endpoint

class CostEndpointTests(unittest.TestCase):
    def fixture(self):
        plan={'audit':[{'id':str(i)} for i in range(30)],'primaryEndpoint':copy.deepcopy(PRIMARY_ENDPOINT)}
        rows=[{'task':str(i),'split':'audit','arm':arm,'costUSD':.005 if arm=='learned' else .01,'latencyMs':1,'passed':True,'terminalSuccess':True} for i in range(30) for arm in ['baseline','random','learned']]
        return plan,rows
    def test_positive_is_conditional_not_general_proof(self):
        p,r=self.fixture();v=evaluate_cost_endpoint(p,r);self.assertTrue(v['observedGatePassed']);self.assertFalse(v['generalAgentImprovementProven']);self.assertTrue(all(c['pValue']<=.025 for c in v['comparisons']))
    def test_missing_unknown_cost_and_quality_regression_fail(self):
        for kind in ['missing','unknown','regression','latency']:
            p,r=self.fixture()
            if kind=='missing':r.pop()
            if kind=='unknown':r[-1]['costUSD']=None
            if kind=='regression':r[-1]['passed']=False
            if kind=='latency':
                for row in r:
                    if row['arm']=='learned':row['latencyMs']=2
            with self.subTest(kind=kind):self.assertFalse(evaluate_cost_endpoint(p,r)['observedGatePassed'])
    def test_undeclared_endpoint_rejected(self):
        p,r=self.fixture();del p['primaryEndpoint'];self.assertRaises(ValueError,evaluate_cost_endpoint,p,r)

if __name__=='__main__':unittest.main()
