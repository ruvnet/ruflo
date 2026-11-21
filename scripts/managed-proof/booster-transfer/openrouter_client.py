"""Host-only bounded OpenRouter transport. Credentials stay in executor env."""
import json
import hashlib
import re
import math
import os
import urllib.error
import urllib.request
from decimal import Decimal

ORIGIN = 'https://openrouter.ai'
CATALOG = ORIGIN + '/api/v1/models'
COMPLETIONS = ORIGIN + '/api/v1/chat/completions'
MODEL = 'moonshotai/kimi-k3.1-pro'
MAX_BYTES = 256000

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Provider redirect rejected')


def finite_cost(value):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or value < 0:
        raise ValueError('Missing or invalid provider metering')
    return Decimal(str(value))


def request_json(url, payload=None, key=None):
    if url not in (CATALOG, COMPLETIONS):
        raise ValueError('Provider origin or endpoint rejected')
    headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}
    if key:
        headers['Authorization'] = 'Bearer ' + key
    request = urllib.request.Request(url, data=None if payload is None else json.dumps(payload).encode(), headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=60) as response:
            limit = 4000000 if url == CATALOG else MAX_BYTES
            body = response.read(limit + 1)
            if len(body) > limit:
                raise ValueError('Provider response exceeded bound')
            return json.loads(body)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        # Never reflect provider responses, authorization headers or credential text.
        raise RuntimeError('Provider request failed; spend may be unknown') from None


def catalog_model(catalog, model_id=MODEL):
    if not isinstance(catalog, dict) or not isinstance(catalog.get('data'), list):
        raise ValueError('Invalid provider catalog')
    matches = [row for row in catalog['data'] if isinstance(row, dict) and row.get('id') == model_id]
    if len(matches) != 1:
        raise ValueError('Requested model unavailable; no implicit substitute')
    row = matches[0]
    params = row.get('supported_parameters', [])
    if not isinstance(params, list) or not {'max_tokens', 'reasoning', 'response_format'}.issubset(params):
        raise ValueError('Model lacks required bounded request parameters')
    pricing = row.get('pricing', {})
    try:
        prompt, completion = Decimal(pricing['prompt']), Decimal(pricing['completion'])
    except (KeyError, TypeError, ValueError):
        raise ValueError('Invalid catalog pricing') from None
    if not prompt.is_finite() or not completion.is_finite() or prompt < 0 or completion < 0:
        raise ValueError('Invalid catalog pricing')
    return {'id': row['id'], 'canonical_slug': row.get('canonical_slug'), 'promptPrice': str(prompt),
            'completionPrice': str(completion), 'supported_parameters': params}


def max_list_cost(model, prompt, max_tokens):
    if not isinstance(prompt, str) or not 1 <= len(prompt.encode()) <= 32000 or not isinstance(max_tokens, int) or isinstance(max_tokens, bool) or not 1 <= max_tokens <= 1024:
        raise ValueError('Prompt or output token bound exceeded')
    # Bytes plus conservative chat-envelope allowance. This is a planning ceiling,
    # not an account-level billing cap or a tokenizer guarantee for every provider.
    return Decimal(model['promptPrice']) * (len(prompt.encode()) + 4096) + Decimal(model['completionPrice']) * max_tokens


def provider_receipt(raw, cost):
    generation = raw.get('id')
    if not isinstance(generation,str) or not re.fullmatch(r'(?:gen-|chatcmpl-)[A-Za-z0-9._:/-]{1,180}',generation):
        raise RuntimeError('Provider generation receipt unavailable; no later admission')
    usage={'cost':float(cost)}
    for key in ['prompt_tokens','completion_tokens','total_tokens']:
        value=raw['usage'].get(key)
        if value is not None:
            if isinstance(value,bool) or not isinstance(value,int) or not 0<=value<=1000000000000:
                raise RuntimeError('Invalid token receipt; no later admission')
            usage[key]=value
    for key,allowed in [('prompt_tokens_details',['cached_tokens','cache_write_tokens','audio_tokens']),('completion_tokens_details',['reasoning_tokens','audio_tokens','accepted_prediction_tokens','rejected_prediction_tokens'])]:
        details=raw['usage'].get(key)
        if isinstance(details,dict):
            safe={}
            for name in allowed:
                if name in details:
                    value=details[name]
                    if isinstance(value,bool) or not isinstance(value,int) or not 0<=value<=1000000000000:raise RuntimeError('Invalid token detail receipt')
                    safe[name]=value
            usage[key]=safe
    details=raw['usage'].get('cost_details')
    if isinstance(details,dict):
        usage['cost_details']={key:float(finite_cost(details[key])) for key in ['upstream_inference_cost','upstream_inference_prompt_cost','upstream_inference_completions_cost'] if details.get(key) is not None}
    provider=raw.get('provider')
    if provider is not None and (not isinstance(provider,str) or not 1<=len(provider)<=120 or any(ord(c)<32 for c in provider)):
        raise RuntimeError('Invalid provider identity receipt')
    return {'generationId':generation,'provider':provider,'model':raw['model'],'usage':usage}


def complete(model, prompt, remaining, *, max_tokens=768, sender=request_json, key=None):
    if max_list_cost(model, prompt, max_tokens) > remaining:
        raise RuntimeError('Insufficient remaining admission budget')
    credential = key if key is not None else os.environ.get('OPENROUTER_API_KEY')
    if not isinstance(credential, str) or not credential or '\n' in credential or '\r' in credential:
        raise RuntimeError('OpenRouter executor credential unavailable')
    payload = {'model': model['id'], 'messages': [{'role': 'user', 'content': prompt}], 'max_tokens': max_tokens,
               'stream': False, 'reasoning': {'effort': 'none'}, 'provider': {'allow_fallbacks': False},
               'response_format': {'type': 'json_object'}, 'usage': {'include': True}}
    raw = sender(COMPLETIONS, payload, credential)
    identities = {model['id']} | ({model['canonical_slug']} if isinstance(model.get('canonical_slug'), str) else set())
    if not isinstance(raw, dict) or raw.get('model') not in identities:
        raise RuntimeError('Provider model identity mismatch; spend uncertain')
    usage = raw.get('usage')
    if not isinstance(usage, dict):
        raise RuntimeError('Provider metering unavailable; no later request permitted')
    cost = finite_cost(usage.get('cost'))
    receipt=provider_receipt(raw,cost)
    request_digest=hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    try:
        choice = raw['choices'][0]
        content = choice['message']['content']
        if choice['finish_reason'] != 'stop' or not isinstance(content, str) or len(content.encode()) > 64000:
            raise ValueError()
    except (KeyError, IndexError, TypeError, ValueError):
        return {'content': '', 'costUSD': float(cost), 'finished': False, 'model': raw.get('model'),'providerReceipt':receipt,'requestDigest':request_digest}
    return {'content': content, 'costUSD': float(cost), 'finished': True, 'model': raw['model'],'providerReceipt':receipt,'requestDigest':request_digest}
