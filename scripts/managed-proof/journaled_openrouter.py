"""Closed official-provider caller with durable intents. Never a generic MCP runner.

The archived transfer/edit runs did not use this adapter. The fixed CLI canary
makes one bounded request; future transfer/edit hosts can use the same class.
"""
import argparse
from decimal import Decimal, ROUND_CEILING
import hashlib
import json
import pathlib
import sys

HERE=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'booster-transfer'))
import openrouter_client as client
import effect_journal as journal
from ruos_credential import openrouter_credential


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()


def nanos(usd):
    value=Decimal(str(usd))
    if not value.is_finite() or value<0:
        raise ValueError('Invalid USD measurement')
    return int((value*1000000000).to_integral_value(rounding=ROUND_CEILING))


class JournaledOpenRouter:
    def __init__(self,root,plan_hash,budget_usd,*,allow_ruos_placement=False):
        budget=Decimal(str(budget_usd))
        if not budget.is_finite() or not 0<budget<=1 or not isinstance(plan_hash,str) or not journal.HASH.fullmatch(plan_hash):
            raise ValueError('Invalid frozen host campaign')
        self.root=pathlib.Path(root);self.plan_hash=plan_hash;self.budget=nanos(budget);self.allow_placement=allow_ruos_placement

    def complete(self,model,prompt,remaining,attempt_id,*,max_tokens=768):
        if model.get('id')!=client.MODEL or not isinstance(attempt_id,str) or not journal.HASH.fullmatch(attempt_id):
            raise ValueError('Fixed provider/model and stable attempt required')
        reserve=client.max_list_cost(model,prompt,max_tokens)
        if reserve>remaining:
            raise RuntimeError('Insufficient admission budget')
        credential=openrouter_credential(allow_ruos_placement=self.allow_placement)
        summary=None

        def send(url,payload,key):
            nonlocal summary
            if url!=client.COMPLETIONS:
                raise ValueError('Fixed official completion endpoint required')
            request_digest=digest(payload)
            grant=journal.begin_attempt(self.root,self.plan_hash,self.budget,attempt_id,request_digest,nanos(reserve))
            try:
                raw=client.request_json(url,payload,key)
                identities={model['id'],model.get('canonical_slug')}
                if not isinstance(raw,dict) or raw.get('model') not in identities or not isinstance(raw.get('usage'),dict):
                    raise RuntimeError('Unknown provider identity or metering')
                cost=client.finite_cost(raw['usage'].get('cost'))
                receipt=client.provider_receipt(raw,cost)
                summary=journal.commit_receipt(self.root,grant,receipt['generationId'],nanos(cost),digest(receipt))
                return raw
            except Exception:
                journal.mark_unknown(self.root,grant)
                raise

        result=client.complete(model,prompt,remaining,max_tokens=max_tokens,sender=send,key=credential)
        return {**result,'effectJournal':summary}


def main():
    parser=argparse.ArgumentParser(description='One fixed Kimi journal canary, not an arbitrary program/key runner')
    parser.add_argument('--root',required=True)
    parser.add_argument('--ruos-placement',action='store_true')
    args=parser.parse_args()
    model=client.catalog_model(client.request_json(client.CATALOG))
    plan=digest({'kind':'fixed-journal-canary','model':model,'runnerHash':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()})
    actor=JournaledOpenRouter(args.root,plan,Decimal('.02'),allow_ruos_placement=args.ruos_placement)
    result=actor.complete(model,'Return JSON {"code":"function solve(){return 4;}"} exactly.',Decimal('.02'),digest('fixed-once'),max_tokens=32)
    print(json.dumps({'kind':'fixed-journal-canary','model':result['model'],'finished':result['finished'],
                      'costUSD':result['costUSD'],'providerReceipt':result['providerReceipt'],
                      'requestDigest':result['requestDigest'],'outputHash':digest(result['content']),
                      'effectJournal':result['effectJournal'],'promotionAuthorized':False}))


if __name__=='__main__':main()
