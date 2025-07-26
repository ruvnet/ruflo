"""Streaming, truncating, non-recursive version of :func:`repr`.

Differences from regular :func:`repr`:

- Sets are represented the Python 3 way: ``{1, 2}`` vs ``set([1, 2])``.
- Unicode strings does not have the ``u'`` prefix, even on Python 2.
- Empty set formatted as ``set()`` (Python 3), not ``set([])`` (Python 2).
- Longs don't have the ``L`` suffix.

Very slow with no limits, super quick with limits.
"""
import traceback
from collections import deque, namedtuple
from decimal import Decimal
from itertools import chain
from numbers import Number
from pprint import _recursion
from typing import Any, AnyStr, Callable, Dict, Iterator, List, Sequence, Set, Tuple  # noqa

from .text import truncate

__all__ = ('saferepr', 'reprstream')

#: Node representing literal text.
#:   - .value: is the literal text value
#:   - .truncate: specifies if this text can be truncated, for things like
#:                LIT_DICT_END this will be False, as we always display
#:                the ending brackets, e.g:  [[[1, 2, 3, ...,], ..., ]]
#:   - .direction: If +1 the current level is increment by one,
#:                 if -1 the current level is decremented by one, and
#:                 if 0 the current level is unchanged.
_literal = namedtuple('_literal', ('value', 'truncate', 'direction'))

#: Node representing a dictionary key.
_key = namedtuple('_key', ('value',))

#: Node representing quoted text, e.g. a string value.
_quoted = namedtuple('_quoted', ('value',))


#: Recursion protection.
_dirty = namedtuple('_dirty', ('objid',))

#: Types that are repsented as chars.
chars_t = (bytes, str)

#: Types that are regarded as safe to call repr on.
safe_t = (Number,)

#: Set types.
set_t = (frozenset, set)

LIT_DICT_START = _literal('{', False, +1)
LIT_DICT_KVSEP = _literal(': ', True, 0)
LIT_DICT_END = _literal('}', False, -1)
LIT_LIST_START = _literal('[', False, +1)
LIT_LIST_END = _literal(']', False, -1)
LIT_LIST_SEP = _literal(', ', True, 0)
LIT_SET_START = _literal('{', False, +1)
LIT_SET_END = _literal('}', False, -1)
LIT_TUPLE_START = _literal('(', False, +1)
LIT_TUPLE_END = _literal(')', False, -1)
LIT_TUPLE_END_SV = _literal(',)', False, -1)


def saferepr(o, maxlen=None, maxlevels=3, seen=None):
    # type: (Any, int, int, Set) -> str
    """Safe version of :func:`repr`.

    Warning:
        Make sure you set the maxlen argument, or it will be very slow
        for recursive objects.  With the maxlen set, it's often faster
        than built-in repr.
    """
    return ''.join(_saferepr(
        o, maxlen=maxlen, maxlevels=maxlevels, seen=seen
    ))


def _chaindict(mapping,
               LIT_DICT_KVSEP=LIT_DICT_KVSEP,
               LIT_LIST_SEP=LIT_LIST_SEP):
    # type: (Dict, _literal, _literal) -> Iterator[Any]
    size = len(mapping)
    for i, (k, v) in enumerate(mapping.items()):
        yield _key(k)
        yield LIT_DICT_KVSEP
        yield v
        if i < (size - 1):
            yield LIT_LIST_SEP


def _chainlist(it, LIT_LIST_SEP=LIT_LIST_SEP):
    # type: (List) -> Iterator[Any]
    size = len(it)
    for i, v in enumerate(it):
        yield v
        if i < (size - 1):
            yield LIT_LIST_SEP


def _repr_empty_set(s):
    # type: (Set) -> str
    return f'{type(s).__name__}()'


def _safetext(val):
    # type: (AnyStr) -> str
    if isinstance(val, bytes):
        try:
            val.encode('utf-8')
        except UnicodeDecodeError:
            # is bytes with unrepresentable characters, attempt
            # to convert back to unicode
            return val.decode('utf-8', errors='backslashreplace')
    return val


def _format_binary_bytes(val, maxlen, ellipsis='...'):
    # type: (bytes, int, str) -> str
    if maxlen and len(val) > maxlen:
        # we don't want to copy all the data, just take what we need.
        chunk = memoryview(val)[:maxlen].tobytes()
        return _bytes_prefix(f"'{_repr_binary_bytes(chunk)}{ellipsis}'")
    return _bytes_prefix(f"'{_repr_binary_bytes(val)}'")


def _bytes_prefix(s):
    return 'b' + s


def _repr_binary_bytes(val):
    # type: (bytes) -> str
    try:
        return val.decode('utf-8')
    except UnicodeDecodeError:
        # possibly not unicode, but binary data so format as hex.
        return val.hex()


def _format_chars(val, maxlen):
    # type: (AnyStr, int) -> str
    if isinstance(val, bytes):  # pragma: no cover
        return _format_binary_bytes(val, maxlen)
    else:
        return "'{}'".format(truncate(val, maxlen).replace("'", "\\'"))


def _repr(obj):
    # type: (Any) -> str
    try:
        return repr(obj)
    except Exception as exc:
        stack = '\n'.join(traceback.format_stack())
        return f'<Unrepresentable {type(obj)!r}{id(obj):#x}: {exc!r} {stack!r}>'


def _saferepr(o, maxlen=None, maxlevels=3, seen=None):
    # type: (Any, int, int, Set) -> str
    stack = deque([iter([o])])
    for token, it in reprstream(stack, seen=seen, maxlevels=maxlevels):
        if maxlen is not None and maxlen <= 0:
            yield ', ...'
            # move rest back to stack, so that we can include
            # dangling parens.
            stack.append(it)
            break
        if isinstance(token, _literal):
            val = token.value
        elif isinstance(token, _key):
            val = saferepr(token.value, maxlen, maxlevels)
        elif isinstance(token, _quoted):
            val = _format_chars(token.value, maxlen)
        else:
            val = _safetext(truncate(token, maxlen))
        yield val
        if maxlen is not None:
            maxlen -= len(val)
    for rest1 in stack:
        # maxlen exceeded, process any dangling parens.
        for rest2 in rest1:
            if isinstance(rest2, _literal) and not rest2.truncate:
                yield rest2.value


def _reprseq(val, lit_start, lit_end, builtin_type, chainer):
    # type: (Sequence, _literal, _literal, Any, Any) -> Tuple[Any, ...]
    if type(val) is builtin_type:
        return lit_start, lit_end, chainer(val)
    return (
        _literal(f'{type(val).__name__}({lit_start.value}', False, +1),
        _literal(f'{lit_end.value})', False, -1),
        chainer(val)
    )


def reprstream(stack, seen=None, maxlevels=3, level=0, isinstance=isinstance):
    """Streaming repr, yielding tokens."""
    # type: (deque, Set, int, int, Callable) -> Iterator[Any]
    seen = seen or set()
    append = stack.append
    popleft = stack.popleft
    is_in_seen = seen.__contains__
    discard_from_seen = seen.discard
    add_to_seen = seen.add

    while stack:
        lit_start = lit_end = None
        it = popleft()
        for val in it:
            orig = val
            if isinstance(val, _dirty):
                discard_from_seen(val.objid)
                continue
            elif isinstance(val, _literal):
                level += val.direction
                yield val, it
            elif isinstance(val, _key):
                yield val, it
            elif isinstance(val, Decimal):
                yield _repr(val), it
            elif isinstance(val, safe_t):
                yield str(val), it
            elif isinstance(val, chars_t):
                yield _quoted(val), it
            elif isinstance(val, range):  # pragma: no cover
                yield _repr(val), it
            else:
                if isinstance(val, set_t):
                    if not val:
                        yield _repr_empty_set(val), it
                        continue
                    lit_start, lit_end, val = _reprseq(
                        val, LIT_SET_START, LIT_SET_END, set, _chainlist,
                    )
                elif isinstance(val, tuple):
                    lit_start, lit_end, val = (
                        LIT_TUPLE_START,
                        LIT_TUPLE_END_SV if len(val) == 1 else LIT_TUPLE_END,
                        _chainlist(val))
                elif isinstance(val, dict):
                    lit_start, lit_end, val = (
                        LIT_DICT_START, LIT_DICT_END, _chaindict(val))
                elif isinstance(val, list):
                    lit_start, lit_end, val = (
                        LIT_LIST_START, LIT_LIST_END, _chainlist(val))
                else:
                    # other type of object
                    yield _repr(val), it
                    continue

                if maxlevels and level >= maxlevels:
                    yield f'{lit_start.value}...{lit_end.value}', it
                    continue

                objid = id(orig)
                if is_in_seen(objid):
                    yield _recursion(orig), it
                    continue
                add_to_seen(objid)

                # Recurse into the new list/tuple/dict/etc by tacking
                # the rest of our iterable onto the new it: this way
                # it works similar to a linked list.
                append(chain([lit_start], val, [_dirty(objid), lit_end], it))
                break
