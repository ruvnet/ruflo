"""Host-only semantic application guard. Confidence is admission, not acceptance."""
import hashlib
import math
from actor_pilot import digest,run_oracle


def code_hash(code):
    return hashlib.sha256(code.encode()).hexdigest()


def application_contract(kind,original,candidate,task):
    """Host-issued from the frozen request format, never from model approval flags."""
    if kind not in ['complete-source','partial-edit']:
        raise ValueError('Closed application format required')
    return {'version':1,'format':kind,'language':'javascript','originalHash':code_hash(original),
            'candidateHash':code_hash(candidate),'taskHash':digest(task)}


def select_verified_application(original,candidate,booster_result,task,contract,*,oracle=run_oracle):
    if not isinstance(original,str) or not isinstance(candidate,str) or not 1<=len(original.encode())<=64000 or not 1<=len(candidate.encode())<=64000 or not isinstance(contract,dict) or set(contract)!={'version','format','language','originalHash','candidateHash','taskHash'} or type(contract['version'])is not int or contract['version']!=1 or contract['format']not in ['complete-source','partial-edit'] or contract['language']!='javascript' or contract['originalHash']!=code_hash(original) or contract['candidateHash']!=code_hash(candidate) or contract['taskHash']!=digest(task):
        raise ValueError('Stale, expanded or mismatched host application contract')
    def passed(code):
        try:return oracle(code,task) is True
        except Exception:return False
    result=booster_result
    shape=isinstance(result,dict) and set(result)=={'available','version','admitted','output','confidence','strategy','latencyMs'}
    confidence=result.get('confidence')if shape else None
    admitted=bool(shape and result['available']is True and result['version']=='0.2.2' and result['admitted']is True and type(confidence)in[int,float] and math.isfinite(confidence) and .5<=confidence<=1 and isinstance(result['output'],str) and 1<=len(result['output'].encode())<=64000)
    booster_passed=bool(admitted and passed(result['output']))
    if booster_passed:
        return {'accepted':True,'selected':'booster','output':result['output'],'boosterOraclePassed':True,'directOraclePassed':None,'confidenceIsVerification':False,'promotionAuthorized':False}
    # A partial patch must NEVER be substituted as a complete file, even if a
    # narrow isolated test happens to accept it. Only the host's full-source
    # request contract permits the already-generated complete source fallback.
    direct_passed=bool(contract['format']=='complete-source' and passed(candidate))
    return {'accepted':direct_passed,'selected':'verified-full-source'if direct_passed else None,
            'output':candidate if direct_passed else None,'boosterOraclePassed':False,
            'directOraclePassed':direct_passed,'confidenceIsVerification':False,'promotionAuthorized':False}
