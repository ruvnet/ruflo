"""Future host-only effect admission journal. NOT used by the archived actor runs.

An intent is durably committed before send(). Outstanding intents block all later
admission until host/provider reconciliation supplies a receipt. This is not a
provider idempotency key, billing cap, signed authority or exactly-once transport.
"""
import contextlib
import hashlib
import json
import os
import pathlib
import re
import stat
import tempfile

SCHEMA = 'ruflo.host-effect-journal/v1'
UNIT = 'usd-nanos'
MAX_INTEGER = 9007199254740991
MAX_ATTEMPTS = 4096
MAX_BYTES = 4000000
HASH = re.compile('[a-f0-9]{64}')
GENERATION = re.compile(r'(?:gen-|chatcmpl-)[A-Za-z0-9._:/-]{1,180}')


def _number(value):
    return type(value) is int and 0 <= value <= MAX_INTEGER


def _hash(value):
    return isinstance(value, str) and HASH.fullmatch(value) is not None


def _validate(state):
    if not isinstance(state, dict) or set(state) != {'schema','unit','planHash','budgetNanos','attempts'} or state['schema'] != SCHEMA or state['unit'] != UNIT or not _hash(state['planHash']) or not _number(state['budgetNanos']) or not isinstance(state['attempts'], list) or len(state['attempts']) > MAX_ATTEMPTS:
        raise ValueError('Invalid journal state; host inspection required')
    seen, generations = set(), set()
    for item in state['attempts']:
        if not isinstance(item, dict) or set(item) != {'attemptId','requestDigest','reserveNanos','phase','costNanos','generationId','receiptHash'} or not _hash(item['attemptId']) or item['attemptId'] in seen or not _hash(item['requestDigest']) or not _number(item['reserveNanos']) or item['reserveNanos'] == 0 or item['phase'] not in ['intent','unknown','receipt']:
            raise ValueError('Invalid journal attempt')
        seen.add(item['attemptId'])
        if item['phase'] == 'receipt':
            if not _number(item['costNanos']) or not isinstance(item['generationId'], str) or not GENERATION.fullmatch(item['generationId']) or item['generationId'] in generations or not _hash(item['receiptHash']):
                raise ValueError('Invalid journal receipt')
            generations.add(item['generationId'])
        elif any(item[k] is not None for k in ['costNanos','generationId','receiptHash']):
            raise ValueError('Unconfirmed attempt must not claim metering')
    return state


def _root(root):
    root = pathlib.Path(root)
    parent=root.parent
    parent_info=parent.lstat()
    if not stat.S_ISDIR(parent_info.st_mode) or parent.is_symlink():
        raise ValueError('Preexisting durable parent directory required')
    try:
        root.mkdir(mode=0o700)
    except FileExistsError:
        pass
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or root.is_symlink() or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('Owner-only regular host journal directory required')
    # The journal directory itself is a parent entry. Sync it even on retry
    # after an earlier creation/fsync failure; child-directory fsync is not enough.
    parent_fd=os.open(parent,os.O_RDONLY)
    try:
        os.fsync(parent_fd)
    finally:
        os.close(parent_fd)
    return root


def _read(root):
    path = root/'effects.json'
    try:
        before=path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(before.st_mode):
        raise ValueError('Journal symlink or nonregular file rejected')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > MAX_BYTES:
            raise ValueError('Invalid bounded journal file')
        data = os.read(fd, MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError('Journal size limit exceeded')
        return _validate(json.loads(data))
    finally:
        os.close(fd)


def _write(root, state):
    _validate(state)
    data = json.dumps(state, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    if len(data) > MAX_BYTES:
        raise ValueError('Journal size limit exceeded')
    fd, temporary = tempfile.mkstemp(prefix='.effect-', dir=root)
    try:
        with os.fdopen(fd, 'wb') as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, root/'effects.json')
        directory = os.open(root, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        # Only this transaction's exclusive temporary file can be removed.
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextlib.contextmanager
def _locked(root):
    root = _root(root)
    try:
        fd = os.open(root/'effects.lock', os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    except FileExistsError:
        raise RuntimeError('Journal busy; stale locks require host reconciliation') from None
    try:
        # Preflight directory durability before the caller can receive a grant.
        directory = os.open(root, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        yield root
    finally:
        os.close(fd)
        os.unlink(root/'effects.lock')


def _summary(state):
    confirmed = sum(a['costNanos'] for a in state['attempts'] if a['phase'] == 'receipt')
    reserved = sum(a['reserveNanos'] for a in state['attempts'] if a['phase'] != 'receipt')
    return {'planHash':state['planHash'], 'unit':UNIT, 'confirmedCostNanos':confirmed,
            'reservedUnknownCostNanos':reserved, 'requiresReconciliation':reserved > 0,
            'budgetExceeded':confirmed+reserved > state['budgetNanos'], 'attempts':len(state['attempts'])}


def begin_attempt(root, plan_hash, budget_nanos, attempt_id, request_digest, reserve_nanos):
    """Returns only after intent and directory fsync. Duplicate/unknown attempts never grant send."""
    if not all(_hash(x) for x in [plan_hash, attempt_id, request_digest]) or not _number(budget_nanos) or not _number(reserve_nanos) or reserve_nanos == 0:
        raise ValueError('Invalid stable attempt or conservative reserve')
    with _locked(root) as path:
        state = _read(path) or {'schema':SCHEMA,'unit':UNIT,'planHash':plan_hash,'budgetNanos':budget_nanos,'attempts':[]}
        if state['planHash'] != plan_hash or state['budgetNanos'] != budget_nanos:
            raise ValueError('Frozen campaign identity or budget changed')
        if any(a['attemptId'] == attempt_id for a in state['attempts']):
            raise RuntimeError('Attempt already consumed; do not repeat the provider effect')
        summary = _summary(state)
        if summary['requiresReconciliation']:
            raise RuntimeError('Unknown effect requires provider reconciliation before further admission')
        if len(state['attempts']) >= MAX_ATTEMPTS or summary['confirmedCostNanos'] + reserve_nanos > budget_nanos:
            raise RuntimeError('Campaign attempt or reported-cost admission bound reached')
        state['attempts'].append({'attemptId':attempt_id,'requestDigest':request_digest,'reserveNanos':reserve_nanos,
                                  'phase':'intent','costNanos':None,'generationId':None,'receiptHash':None})
        _write(path,state)
        return {'planHash':plan_hash,'attemptId':attempt_id,'requestDigest':request_digest}


def _bound(state, grant):
    if not isinstance(grant,dict) or set(grant) != {'planHash','attemptId','requestDigest'} or state['planHash'] != grant['planHash']:
        raise ValueError('Wrong campaign grant')
    item = next((a for a in state['attempts'] if a['attemptId'] == grant['attemptId']), None)
    if item is None or item['requestDigest'] != grant['requestDigest']:
        raise ValueError('Unknown or altered request intent')
    return item


def commit_receipt(root, grant, generation_id, cost_nanos, receipt_hash):
    """Host/provider-reconciled receipt, not a model approval flag. Actual overruns remain recorded."""
    if not isinstance(generation_id,str) or not GENERATION.fullmatch(generation_id) or not _number(cost_nanos) or not _hash(receipt_hash):
        raise ValueError('Invalid provider receipt or metering')
    with _locked(root) as path:
        state = _read(path)
        if state is None:
            raise ValueError('Missing journal intent')
        item = _bound(state,grant)
        if item['phase'] == 'receipt':
            if (item['generationId'], item['costNanos'], item['receiptHash']) != (generation_id,cost_nanos,receipt_hash):
                raise ValueError('Conflicting immutable receipt')
            return {**_summary(state),'duplicate':True}
        if any(a['generationId'] == generation_id for a in state['attempts'] if a is not item):
            raise ValueError('Provider generation already assigned to another attempt')
        item.update({'phase':'receipt','generationId':generation_id,'costNanos':cost_nanos,'receiptHash':receipt_hash})
        _write(path,state)
        return {**_summary(state),'duplicate':False}


def mark_unknown(root, grant):
    with _locked(root) as path:
        state = _read(path)
        if state is None:
            raise ValueError('Missing journal intent')
        item = _bound(state,grant)
        if item['phase'] != 'receipt':
            item['phase'] = 'unknown'
            _write(path,state)
        return _summary(state)


def journal_status(root):
    with _locked(root) as path:
        state = _read(path)
        return _summary(state) if state else {'requiresReconciliation':False,'attempts':0,'unit':UNIT}


def execute_once(root, plan_hash, budget_nanos, attempt_id, request_digest, reserve_nanos, send, parse_receipt, fault=None):
    """Future opt-in seam; no current runner imports it. Fault hooks are host-owned tests only."""
    grant = begin_attempt(root,plan_hash,budget_nanos,attempt_id,request_digest,reserve_nanos)
    try:
        if fault: fault('after-intent')
        response = send()
        if fault: fault('after-send')
        receipt = parse_receipt(response)
        summary = commit_receipt(root,grant,receipt['generationId'],receipt['costNanos'],receipt['receiptHash'])
        if fault: fault('after-receipt')
        return {'response':response,'journal':summary}
    except Exception:
        # A process kill/BaseException can bypass this handler; the durable intent
        # still fences all new sends. Never infer that a timeout means no effect.
        mark_unknown(root,grant)
        raise


def prepare_root(root):
    """Create only the final campaign directory and fsync its existing parent."""
    return _root(root)


def sync_directory(root):
    fd=os.open(root,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
