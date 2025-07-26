"""Functional-style utilities."""
import inspect
from collections import UserList
from functools import partial
from itertools import islice, tee, zip_longest
from typing import Any, Callable

from kombu.utils.functional import LRUCache, dictfilter, is_list, lazy, maybe_evaluate, maybe_list, memoize
from vine import promise

from celery.utils.log import get_logger

logger = get_logger(__name__)

__all__ = (
    'LRUCache', 'is_list', 'maybe_list', 'memoize', 'mlazy', 'noop',
    'first', 'firstmethod', 'chunks', 'padlist', 'mattrgetter', 'uniq',
    'regen', 'dictfilter', 'lazy', 'maybe_evaluate', 'head_from_fun',
    'maybe', 'fun_accepts_kwargs',
)

FUNHEAD_TEMPLATE = """
def {fun_name}({fun_args}):
    return {fun_value}
"""


class DummyContext:

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        pass


class mlazy(lazy):
    """Memoized lazy evaluation.

    The function is only evaluated once, every subsequent access
    will return the same value.
    """

    #: Set to :const:`True` after the object has been evaluated.
    evaluated = False
    _value = None

    def evaluate(self):
        if not self.evaluated:
            self._value = super().evaluate()
            self.evaluated = True
        return self._value


def noop(*args, **kwargs):
    """No operation.

    Takes any arguments/keyword arguments and does nothing.
    """


def pass1(arg, *args, **kwargs):
    """Return the first positional argument."""
    return arg


def evaluate_promises(it):
    for value in it:
        if isinstance(value, promise):
            value = value()
        yield value


def first(predicate, it):
    """Return the first element in ``it`` that ``predicate`` accepts.

    If ``predicate`` is None it will return the first item that's not
    :const:`None`.
    """
    return next(
        (v for v in evaluate_promises(it) if (
            predicate(v) if predicate is not None else v is not None)),
        None,
    )


def firstmethod(method, on_call=None):
    """Multiple dispatch.

    Return a function that with a list of instances,
    finds the first instance that gives a value for the given method.

    The list can also contain lazy instances
    (:class:`~kombu.utils.functional.lazy`.)
    """

    def _matcher(it, *args, **kwargs):
        for obj in it:
            try:
                meth = getattr(maybe_evaluate(obj), method)
                reply = (on_call(meth, *args, **kwargs) if on_call
                         else meth(*args, **kwargs))
            except AttributeError:
                pass
            else:
                if reply is not None:
                    return reply

    return _matcher


def chunks(it, n):
    """Split an iterator into chunks with `n` elements each.

    Warning:
        ``it`` must be an actual iterator, if you pass this a
        concrete sequence will get you repeating elements.

        So ``chunks(iter(range(1000)), 10)`` is fine, but
        ``chunks(range(1000), 10)`` is not.

    Example:
        # n == 2
        >>> x = chunks(iter([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 2)
        >>> list(x)
        [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10]]

        # n == 3
        >>> x = chunks(iter([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 3)
        >>> list(x)
        [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10]]
    """
    for item in it:
        yield [item] + list(islice(it, n - 1))


def padlist(container, size, default=None):
    """Pad list with default elements.

    Example:
        >>> first, last, city = padlist(['George', 'Costanza', 'NYC'], 3)
        ('George', 'Costanza', 'NYC')
        >>> first, last, city = padlist(['George', 'Costanza'], 3)
        ('George', 'Costanza', None)
        >>> first, last, city, planet = padlist(
        ...     ['George', 'Costanza', 'NYC'], 4, default='Earth',
        ... )
        ('George', 'Costanza', 'NYC', 'Earth')
    """
    return list(container)[:size] + [default] * (size - len(container))


def mattrgetter(*attrs):
    """Get attributes, ignoring attribute errors.

    Like :func:`operator.itemgetter` but return :const:`None` on missing
    attributes instead of raising :exc:`AttributeError`.
    """
    return lambda obj: {attr: getattr(obj, attr, None) for attr in attrs}


def uniq(it):
    """Return all unique elements in ``it``, preserving order."""
    seen = set()
    return (seen.add(obj) or obj for obj in it if obj not in seen)


def lookahead(it):
    """Yield pairs of (current, next) items in `it`.

    `next` is None if `current` is the last item.
    Example:
        >>> list(lookahead(x for x in range(6)))
        [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, None)]
    """
    a, b = tee(it)
    next(b, None)
    return zip_longest(a, b)


def regen(it):
    """Convert iterator to an object that can be consumed multiple times.

    ``Regen`` takes any iterable, and if the object is an
    generator it will cache the evaluated list on first access,
    so that the generator can be "consumed" multiple times.
    """
    if isinstance(it, (list, tuple)):
        return it
    return _regen(it)


class _regen(UserList, list):
    # must be subclass of list so that json can encode.

    def __init__(self, it):
        # pylint: disable=super-init-not-called
        # UserList creates a new list and sets .data, so we don't
        # want to call init here.
        self.__it = it
        self.__consumed = []
        self.__done = False

    def __reduce__(self):
        return list, (self.data,)

    def map(self, func):
        self.__consumed = [func(el) for el in self.__consumed]
        self.__it = map(func, self.__it)

    def __length_hint__(self):
        return self.__it.__length_hint__()

    def __lookahead_consume(self, limit=None):
        if not self.__done and (limit is None or limit > 0):
            it = iter(self.__it)
            try:
                now = next(it)
            except StopIteration:
                return
            self.__consumed.append(now)
            # Maintain a single look-ahead to ensure we set `__done` when the
            # underlying iterator gets exhausted
            while not self.__done:
                try:
                    next_ = next(it)
                    self.__consumed.append(next_)
                except StopIteration:
                    self.__done = True
                    break
                finally:
                    yield now
                now = next_
                # We can break out when `limit` is exhausted
                if limit is not None:
                    limit -= 1
                    if limit <= 0:
                        break

    def __iter__(self):
        yield from self.__consumed
        yield from self.__lookahead_consume()

    def __getitem__(self, index):
        if index < 0:
            return self.data[index]
        # Consume elements up to the desired index prior to attempting to
        # access it from within `__consumed`
        consume_count = index - len(self.__consumed) + 1
        for _ in self.__lookahead_consume(limit=consume_count):
            pass
        return self.__consumed[index]

    def __bool__(self):
        if len(self.__consumed):
            return True

        try:
            next(iter(self))
        except StopIteration:
            return False
        else:
            return True

    @property
    def data(self):
        if not self.__done:
            self.__consumed.extend(self.__it)
            self.__done = True
        return self.__consumed

    def __repr__(self):
        return "<{}: [{}{}]>".format(
            self.__class__.__name__,
            ", ".join(repr(e) for e in self.__consumed),
            "..." if not self.__done else "",
        )


def _argsfromspec(spec, replace_defaults=True):
    if spec.defaults:
        split = len(spec.defaults)
        defaults = (list(range(len(spec.defaults))) if replace_defaults
                    else spec.defaults)
        positional = spec.args[:-split]
        optional = list(zip(spec.args[-split:], defaults))
    else:
        positional, optional = spec.args, []

    varargs = spec.varargs
    varkw = spec.varkw
    if spec.kwonlydefaults:
        kwonlyargs = set(spec.kwonlyargs) - set(spec.kwonlydefaults.keys())
        if replace_defaults:
            kwonlyargs_optional = [
                (kw, i) for i, kw in enumerate(spec.kwonlydefaults.keys())
            ]
        else:
            kwonlyargs_optional = list(spec.kwonlydefaults.items())
    else:
        kwonlyargs, kwonlyargs_optional = spec.kwonlyargs, []

    return ', '.join(filter(None, [
        ', '.join(positional),
        ', '.join(f'{k}={v}' for k, v in optional),
        f'*{varargs}' if varargs else None,
        '*' if (kwonlyargs or kwonlyargs_optional) and not varargs else None,
        ', '.join(kwonlyargs) if kwonlyargs else None,
        ', '.join(f'{k}="{v}"' for k, v in kwonlyargs_optional),
        f'**{varkw}' if varkw else None,
    ]))


def head_from_fun(fun: Callable[..., Any], bound: bool = False) -> str:
    """Generate signature function from actual function."""
    # we could use inspect.Signature here, but that implementation
    # is very slow since it implements the argument checking
    # in pure-Python.  Instead we use exec to create a new function
    # with an empty body, meaning it has the same performance as
    # as just calling a function.
    is_function = inspect.isfunction(fun)
    is_callable = callable(fun)
    is_cython = fun.__class__.__name__ == 'cython_function_or_method'
    is_method = inspect.ismethod(fun)

    if not is_function and is_callable and not is_method and not is_cython:
        name, fun = fun.__class__.__name__, fun.__call__
    else:
        name = fun.__name__
    definition = FUNHEAD_TEMPLATE.format(
        fun_name=name,
        fun_args=_argsfromspec(inspect.getfullargspec(fun)),
        fun_value=1,
    )
    logger.debug(definition)
    namespace = {'__name__': fun.__module__}
    # pylint: disable=exec-used
    # Tasks are rarely, if ever, created at runtime - exec here is fine.
    exec(definition, namespace)
    result = namespace[name]
    result._source = definition
    if bound:
        return partial(result, object())
    return result


def arity_greater(fun, n):
    argspec = inspect.getfullargspec(fun)
    return argspec.varargs or len(argspec.args) > n


def fun_takes_argument(name, fun, position=None):
    spec = inspect.getfullargspec(fun)
    return (
        spec.varkw or spec.varargs or
        (len(spec.args) >= position if position else name in spec.args)
    )


def fun_accepts_kwargs(fun):
    """Return true if function accepts arbitrary keyword arguments."""
    return any(
        p for p in inspect.signature(fun).parameters.values()
        if p.kind == p.VAR_KEYWORD
    )


def maybe(typ, val):
    """Call typ on value if val is defined."""
    return typ(val) if val is not None else val


def seq_concat_item(seq, item):
    """Return copy of sequence seq with item added.

    Returns:
        Sequence: if seq is a tuple, the result will be a tuple,
           otherwise it depends on the implementation of ``__add__``.
    """
    return seq + (item,) if isinstance(seq, tuple) else seq + [item]


def seq_concat_seq(a, b):
    """Concatenate two sequences: ``a + b``.

    Returns:
        Sequence: The return value will depend on the largest sequence
            - if b is larger and is a tuple, the return value will be a tuple.
            - if a is larger and is a list, the return value will be a list,
    """
    # find the type of the largest sequence
    prefer = type(max([a, b], key=len))
    # convert the smallest list to the type of the largest sequence.
    if not isinstance(a, prefer):
        a = prefer(a)
    if not isinstance(b, prefer):
        b = prefer(b)
    return a + b


def is_numeric_value(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)
