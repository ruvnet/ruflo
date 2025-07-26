# util/langhelpers.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

"""Routines to help with the creation, loading and introspection of
modules, classes, hierarchies, attributes, functions, and methods.

"""
from __future__ import annotations

import collections
import enum
from functools import update_wrapper
import inspect
import itertools
import operator
import re
import sys
import textwrap
import threading
import types
from types import CodeType
from typing import Any
from typing import Callable
from typing import cast
from typing import Dict
from typing import FrozenSet
from typing import Generic
from typing import Iterator
from typing import List
from typing import Mapping
from typing import NoReturn
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union
import warnings

from . import _collections
from . import compat
from ._has_cy import HAS_CYEXTENSION
from .typing import Literal
from .. import exc

_T = TypeVar("_T")
_T_co = TypeVar("_T_co", covariant=True)
_F = TypeVar("_F", bound=Callable[..., Any])
_MP = TypeVar("_MP", bound="memoized_property[Any]")
_MA = TypeVar("_MA", bound="HasMemoized.memoized_attribute[Any]")
_HP = TypeVar("_HP", bound="hybridproperty[Any]")
_HM = TypeVar("_HM", bound="hybridmethod[Any]")


if compat.py310:

    def get_annotations(obj: Any) -> Mapping[str, Any]:
        return inspect.get_annotations(obj)

else:

    def get_annotations(obj: Any) -> Mapping[str, Any]:
        # it's been observed that cls.__annotations__ can be non present.
        # it's not clear what causes this, running under tox py37/38 it
        # happens, running straight pytest it doesnt

        # https://docs.python.org/3/howto/annotations.html#annotations-howto
        if isinstance(obj, type):
            ann = obj.__dict__.get("__annotations__", None)
        else:
            ann = getattr(obj, "__annotations__", None)

        if ann is None:
            return _collections.EMPTY_DICT
        else:
            return cast("Mapping[str, Any]", ann)


def md5_hex(x: Any) -> str:
    x = x.encode("utf-8")
    m = compat.md5_not_for_security()
    m.update(x)
    return cast(str, m.hexdigest())


class safe_reraise:
    """Reraise an exception after invoking some
    handler code.

    Stores the existing exception info before
    invoking so that it is maintained across a potential
    coroutine context switch.

    e.g.::

        try:
            sess.commit()
        except:
            with safe_reraise():
                sess.rollback()

    TODO: we should at some point evaluate current behaviors in this regard
    based on current greenlet, gevent/eventlet implementations in Python 3, and
    also see the degree to which our own asyncio (based on greenlet also) is
    impacted by this. .rollback() will cause IO / context switch to occur in
    all these scenarios; what happens to the exception context from an
    "except:" block if we don't explicitly store it? Original issue was #2703.

    """

    __slots__ = ("_exc_info",)

    _exc_info: Union[
        None,
        Tuple[
            Type[BaseException],
            BaseException,
            types.TracebackType,
        ],
        Tuple[None, None, None],
    ]

    def __enter__(self) -> None:
        self._exc_info = sys.exc_info()

    def __exit__(
        self,
        type_: Optional[Type[BaseException]],
        value: Optional[BaseException],
        traceback: Optional[types.TracebackType],
    ) -> NoReturn:
        assert self._exc_info is not None
        # see #2703 for notes
        if type_ is None:
            exc_type, exc_value, exc_tb = self._exc_info
            assert exc_value is not None
            self._exc_info = None  # remove potential circular references
            raise exc_value.with_traceback(exc_tb)
        else:
            self._exc_info = None  # remove potential circular references
            assert value is not None
            raise value.with_traceback(traceback)


def walk_subclasses(cls: Type[_T]) -> Iterator[Type[_T]]:
    seen: Set[Any] = set()

    stack = [cls]
    while stack:
        cls = stack.pop()
        if cls in seen:
            continue
        else:
            seen.add(cls)
        stack.extend(cls.__subclasses__())
        yield cls


def string_or_unprintable(element: Any) -> str:
    if isinstance(element, str):
        return element
    else:
        try:
            return str(element)
        except Exception:
            return "unprintable element %r" % element


def clsname_as_plain_name(cls: Type[Any]) -> str:
    return " ".join(
        n.lower() for n in re.findall(r"([A-Z][a-z]+|SQL)", cls.__name__)
    )


def method_is_overridden(
    instance_or_cls: Union[Type[Any], object],
    against_method: Callable[..., Any],
) -> bool:
    """Return True if the two class methods don't match."""

    if not isinstance(instance_or_cls, type):
        current_cls = instance_or_cls.__class__
    else:
        current_cls = instance_or_cls

    method_name = against_method.__name__

    current_method: types.MethodType = getattr(current_cls, method_name)

    return current_method != against_method


def decode_slice(slc: slice) -> Tuple[Any, ...]:
    """decode a slice object as sent to __getitem__.

    takes into account the 2.5 __index__() method, basically.

    """
    ret: List[Any] = []
    for x in slc.start, slc.stop, slc.step:
        if hasattr(x, "__index__"):
            x = x.__index__()
        ret.append(x)
    return tuple(ret)


def _unique_symbols(used: Sequence[str], *bases: str) -> Iterator[str]:
    used_set = set(used)
    for base in bases:
        pool = itertools.chain(
            (base,),
            map(lambda i: base + str(i), range(1000)),
        )
        for sym in pool:
            if sym not in used_set:
                used_set.add(sym)
                yield sym
                break
        else:
            raise NameError("exhausted namespace for symbol base %s" % base)


def map_bits(fn: Callable[[int], Any], n: int) -> Iterator[Any]:
    """Call the given function given each nonzero bit from n."""

    while n:
        b = n & (~n + 1)
        yield fn(b)
        n ^= b


_Fn = TypeVar("_Fn", bound="Callable[..., Any]")

# this seems to be in flux in recent mypy versions


def decorator(target: Callable[..., Any]) -> Callable[[_Fn], _Fn]:
    """A signature-matching decorator factory."""

    def decorate(fn: _Fn) -> _Fn:
        if not inspect.isfunction(fn) and not inspect.ismethod(fn):
            raise Exception("not a decoratable function")

        spec = compat.inspect_getfullargspec(fn)
        env: Dict[str, Any] = {}

        spec = _update_argspec_defaults_into_env(spec, env)

        names = (
            tuple(cast("Tuple[str, ...]", spec[0]))
            + cast("Tuple[str, ...]", spec[1:3])
            + (fn.__name__,)
        )
        targ_name, fn_name = _unique_symbols(names, "target", "fn")

        metadata: Dict[str, Optional[str]] = dict(target=targ_name, fn=fn_name)
        metadata.update(format_argspec_plus(spec, grouped=False))
        metadata["name"] = fn.__name__

        if inspect.iscoroutinefunction(fn):
            metadata["prefix"] = "async "
            metadata["target_prefix"] = "await "
        else:
            metadata["prefix"] = ""
            metadata["target_prefix"] = ""

        # look for __ positional arguments.  This is a convention in
        # SQLAlchemy that arguments should be passed positionally
        # rather than as keyword
        # arguments.  note that apply_pos doesn't currently work in all cases
        # such as when a kw-only indicator "*" is present, which is why
        # we limit the use of this to just that case we can detect.  As we add
        # more kinds of methods that use @decorator, things may have to
        # be further improved in this area
        if "__" in repr(spec[0]):
            code = (
                """\
%(prefix)sdef %(name)s%(grouped_args)s:
    return %(target_prefix)s%(target)s(%(fn)s, %(apply_pos)s)
"""
                % metadata
            )
        else:
            code = (
                """\
%(prefix)sdef %(name)s%(grouped_args)s:
    return %(target_prefix)s%(target)s(%(fn)s, %(apply_kw)s)
"""
                % metadata
            )

        mod = sys.modules[fn.__module__]
        env.update(vars(mod))
        env.update({targ_name: target, fn_name: fn, "__name__": fn.__module__})

        decorated = cast(
            types.FunctionType,
            _exec_code_in_env(code, env, fn.__name__),
        )
        decorated.__defaults__ = getattr(fn, "__func__", fn).__defaults__

        decorated.__wrapped__ = fn  # type: ignore
        return cast(_Fn, update_wrapper(decorated, fn))

    return update_wrapper(decorate, target)


def _update_argspec_defaults_into_env(spec, env):
    """given a FullArgSpec, convert defaults to be symbol names in an env."""

    if spec.defaults:
        new_defaults = []
        i = 0
        for arg in spec.defaults:
            if type(arg).__module__ not in ("builtins", "__builtin__"):
                name = "x%d" % i
                env[name] = arg
                new_defaults.append(name)
                i += 1
            else:
                new_defaults.append(arg)
        elem = list(spec)
        elem[3] = tuple(new_defaults)
        return compat.FullArgSpec(*elem)
    else:
        return spec


def _exec_code_in_env(
    code: Union[str, types.CodeType], env: Dict[str, Any], fn_name: str
) -> Callable[..., Any]:
    exec(code, env)
    return env[fn_name]  # type: ignore[no-any-return]


_PF = TypeVar("_PF")
_TE = TypeVar("_TE")


class PluginLoader:
    def __init__(
        self, group: str, auto_fn: Optional[Callable[..., Any]] = None
    ):
        self.group = group
        self.impls: Dict[str, Any] = {}
        self.auto_fn = auto_fn

    def clear(self):
        self.impls.clear()

    def load(self, name: str) -> Any:
        if name in self.impls:
            return self.impls[name]()

        if self.auto_fn:
            loader = self.auto_fn(name)
            if loader:
                self.impls[name] = loader
                return loader()

        for impl in compat.importlib_metadata_get(self.group):
            if impl.name == name:
                self.impls[name] = impl.load
                return impl.load()

        raise exc.NoSuchModuleError(
            "Can't load plugin: %s:%s" % (self.group, name)
        )

    def register(self, name: str, modulepath: str, objname: str) -> None:
        def load():
            mod = __import__(modulepath)
            for token in modulepath.split(".")[1:]:
                mod = getattr(mod, token)
            return getattr(mod, objname)

        self.impls[name] = load


def _inspect_func_args(fn):
    try:
        co_varkeywords = inspect.CO_VARKEYWORDS
    except AttributeError:
        # https://docs.python.org/3/library/inspect.html
        # The flags are specific to CPython, and may not be defined in other
        # Python implementations. Furthermore, the flags are an implementation
        # detail, and can be removed or deprecated in future Python releases.
        spec = compat.inspect_getfullargspec(fn)
        return spec[0], bool(spec[2])
    else:
        # use fn.__code__ plus flags to reduce method call overhead
        co = fn.__code__
        nargs = co.co_argcount
        return (
            list(co.co_varnames[:nargs]),
            bool(co.co_flags & co_varkeywords),
        )


@overload
def get_cls_kwargs(
    cls: type,
    *,
    _set: Optional[Set[str]] = None,
    raiseerr: Literal[True] = ...,
) -> Set[str]:
    ...


@overload
def get_cls_kwargs(
    cls: type, *, _set: Optional[Set[str]] = None, raiseerr: bool = False
) -> Optional[Set[str]]:
    ...


def get_cls_kwargs(
    cls: type, *, _set: Optional[Set[str]] = None, raiseerr: bool = False
) -> Optional[Set[str]]:
    r"""Return the full set of inherited kwargs for the given `cls`.

    Probes a class's __init__ method, collecting all named arguments.  If the
    __init__ defines a \**kwargs catch-all, then the constructor is presumed
    to pass along unrecognized keywords to its base classes, and the
    collection process is repeated recursively on each of the bases.

    Uses a subset of inspect.getfullargspec() to cut down on method overhead,
    as this is used within the Core typing system to create copies of type
    objects which is a performance-sensitive operation.

    No anonymous tuple arguments please !

    """
    toplevel = _set is None
    if toplevel:
        _set = set()
    assert _set is not None

    ctr = cls.__dict__.get("__init__", False)

    has_init = (
        ctr
        and isinstance(ctr, types.FunctionType)
        and isinstance(ctr.__code__, types.CodeType)
    )

    if has_init:
        names, has_kw = _inspect_func_args(ctr)
        _set.update(names)

        if not has_kw and not toplevel:
            if raiseerr:
                raise TypeError(
                    f"given cls {cls} doesn't have an __init__ method"
                )
            else:
                return None
    else:
        has_kw = False

    if not has_init or has_kw:
        for c in cls.__bases__:
            if get_cls_kwargs(c, _set=_set) is None:
                break

    _set.discard("self")
    return _set


def get_func_kwargs(func: Callable[..., Any]) -> List[str]:
    """Return the set of legal kwargs for the given `func`.

    Uses getargspec so is safe to call for methods, functions,
    etc.

    """

    return compat.inspect_getfullargspec(func)[0]


def get_callable_argspec(
    fn: Callable[..., Any], no_self: bool = False, _is_init: bool = False
) -> compat.FullArgSpec:
    """Return the argument signature for any callable.

    All pure-Python callables are accepted, including
    functions, methods, classes, objects with __call__;
    builtins and other edge cases like functools.partial() objects
    raise a TypeError.

    """
    if inspect.isbuiltin(fn):
        raise TypeError("Can't inspect builtin: %s" % fn)
    elif inspect.isfunction(fn):
        if _is_init and no_self:
            spec = compat.inspect_getfullargspec(fn)
            return compat.FullArgSpec(
                spec.args[1:],
                spec.varargs,
                spec.varkw,
                spec.defaults,
                spec.kwonlyargs,
                spec.kwonlydefaults,
                spec.annotations,
            )
        else:
            return compat.inspect_getfullargspec(fn)
    elif inspect.ismethod(fn):
        if no_self and (_is_init or fn.__self__):
            spec = compat.inspect_getfullargspec(fn.__func__)
            return compat.FullArgSpec(
                spec.args[1:],
                spec.varargs,
                spec.varkw,
                spec.defaults,
                spec.kwonlyargs,
                spec.kwonlydefaults,
                spec.annotations,
            )
        else:
            return compat.inspect_getfullargspec(fn.__func__)
    elif inspect.isclass(fn):
        return get_callable_argspec(
            fn.__init__, no_self=no_self, _is_init=True
        )
    elif hasattr(fn, "__func__"):
        return compat.inspect_getfullargspec(fn.__func__)
    elif hasattr(fn, "__call__"):
        if inspect.ismethod(fn.__call__):
            return get_callable_argspec(fn.__call__, no_self=no_self)
        else:
            raise TypeError("Can't inspect callable: %s" % fn)
    else:
        raise TypeError("Can't inspect callable: %s" % fn)


def format_argspec_plus(
    fn: Union[Callable[..., Any], compat.FullArgSpec], grouped: bool = True
) -> Dict[str, Optional[str]]:
    """Returns a dictionary of formatted, introspected function arguments.

    A enhanced variant of inspect.formatargspec to support code generation.

    fn
       An inspectable callable or tuple of inspect getargspec() results.
    grouped
      Defaults to True; include (parens, around, argument) lists

    Returns:

    args
      Full inspect.formatargspec for fn
    self_arg
      The name of the first positional argument, varargs[0], or None
      if the function defines no positional arguments.
    apply_pos
      args, re-written in calling rather than receiving syntax.  Arguments are
      passed positionally.
    apply_kw
      Like apply_pos, except keyword-ish args are passed as keywords.
    apply_pos_proxied
      Like apply_pos but omits the self/cls argument

    Example::

      >>> format_argspec_plus(lambda self, a, b, c=3, **d: 123)
      {'grouped_args': '(self, a, b, c=3, **d)',
       'self_arg': 'self',
       'apply_kw': '(self, a, b, c=c, **d)',
       'apply_pos': '(self, a, b, c, **d)'}

    """
    if callable(fn):
        spec = compat.inspect_getfullargspec(fn)
    else:
        spec = fn

    args = compat.inspect_formatargspec(*spec)

    apply_pos = compat.inspect_formatargspec(
        spec[0], spec[1], spec[2], None, spec[4]
    )

    if spec[0]:
        self_arg = spec[0][0]

        apply_pos_proxied = compat.inspect_formatargspec(
            spec[0][1:], spec[1], spec[2], None, spec[4]
        )

    elif spec[1]:
        # I'm not sure what this is
        self_arg = "%s[0]" % spec[1]

        apply_pos_proxied = apply_pos
    else:
        self_arg = None
        apply_pos_proxied = apply_pos

    num_defaults = 0
    if spec[3]:
        num_defaults += len(cast(Tuple[Any], spec[3]))
    if spec[4]:
        num_defaults += len(spec[4])

    name_args = spec[0] + spec[4]

    defaulted_vals: Union[List[str], Tuple[()]]

    if num_defaults:
        defaulted_vals = name_args[0 - num_defaults :]
    else:
        defaulted_vals = ()

    apply_kw = compat.inspect_formatargspec(
        name_args,
        spec[1],
        spec[2],
        defaulted_vals,
        formatvalue=lambda x: "=" + str(x),
    )

    if spec[0]:
        apply_kw_proxied = compat.inspect_formatargspec(
            name_args[1:],
            spec[1],
            spec[2],
            defaulted_vals,
            formatvalue=lambda x: "=" + str(x),
        )
    else:
        apply_kw_proxied = apply_kw

    if grouped:
        return dict(
            grouped_args=args,
            self_arg=self_arg,
            apply_pos=apply_pos,
            apply_kw=apply_kw,
            apply_pos_proxied=apply_pos_proxied,
            apply_kw_proxied=apply_kw_proxied,
        )
    else:
        return dict(
            grouped_args=args,
            self_arg=self_arg,
            apply_pos=apply_pos[1:-1],
            apply_kw=apply_kw[1:-1],
            apply_pos_proxied=apply_pos_proxied[1:-1],
            apply_kw_proxied=apply_kw_proxied[1:-1],
        )


def format_argspec_init(method, grouped=True):
    """format_argspec_plus with considerations for typical __init__ methods

    Wraps format_argspec_plus with error handling strategies for typical
    __init__ cases::

      object.__init__ -> (self)
      other unreflectable (usually C) -> (self, *args, **kwargs)

    """
    if method is object.__init__:
        grouped_args = "(self)"
        args = "(self)" if grouped else "self"
        proxied = "()" if grouped else ""
    else:
        try:
            return format_argspec_plus(method, grouped=grouped)
        except TypeError:
            grouped_args = "(self, *args, **kwargs)"
            args = grouped_args if grouped else "self, *args, **kwargs"
            proxied = "(*args, **kwargs)" if grouped else "*args, **kwargs"
    return dict(
        self_arg="self",
        grouped_args=grouped_args,
        apply_pos=args,
        apply_kw=args,
        apply_pos_proxied=proxied,
        apply_kw_proxied=proxied,
    )


def create_proxy_methods(
    target_cls: Type[Any],
    target_cls_sphinx_name: str,
    proxy_cls_sphinx_name: str,
    classmethods: Sequence[str] = (),
    methods: Sequence[str] = (),
    attributes: Sequence[str] = (),
    use_intermediate_variable: Sequence[str] = (),
) -> Callable[[_T], _T]:
    """A class decorator indicating attributes should refer to a proxy
    class.

    This decorator is now a "marker" that does nothing at runtime.  Instead,
    it is consumed by the tools/generate_proxy_methods.py script to
    statically generate proxy methods and attributes that are fully
    recognized by typing tools such as mypy.

    """

    def decorate(cls):
        return cls

    return decorate


def getargspec_init(method):
    """inspect.getargspec with considerations for typical __init__ methods

    Wraps inspect.getargspec with error handling for typical __init__ cases::

      object.__init__ -> (self)
      other unreflectable (usually C) -> (self, *args, **kwargs)

    """
    try:
        return compat.inspect_getfullargspec(method)
    except TypeError:
        if method is object.__init__:
            return (["self"], None, None, None)
        else:
            return (["self"], "args", "kwargs", None)


def unbound_method_to_callable(func_or_cls):
    """Adjust the incoming callable such that a 'self' argument is not
    required.

    """

    if isinstance(func_or_cls, types.MethodType) and not func_or_cls.__self__:
        return func_or_cls.__func__
    else:
        return func_or_cls


def generic_repr(
    obj: Any,
    additional_kw: Sequence[Tuple[str, Any]] = (),
    to_inspect: Optional[Union[object, List[object]]] = None,
    omit_kwarg: Sequence[str] = (),
) -> str:
    """Produce a __repr__() based on direct association of the __init__()
    specification vs. same-named attributes present.

    """
    if to_inspect is None:
        to_inspect = [obj]
    else:
        to_inspect = _collections.to_list(to_inspect)

    missing = object()

    pos_args = []
    kw_args: _collections.OrderedDict[str, Any] = _collections.OrderedDict()
    vargs = None
    for i, insp in enumerate(to_inspect):
        try:
            spec = compat.inspect_getfullargspec(insp.__init__)
        except TypeError:
            continue
        else:
            default_len = len(spec.defaults) if spec.defaults else 0
            if i == 0:
                if spec.varargs:
                    vargs = spec.varargs
                if default_len:
                    pos_args.extend(spec.args[1:-default_len])
                else:
                    pos_args.extend(spec.args[1:])
            else:
                kw_args.update(
                    [(arg, missing) for arg in spec.args[1:-default_len]]
                )

            if default_len:
                assert spec.defaults
                kw_args.update(
                    [
                        (arg, default)
                        for arg, default in zip(
                            spec.args[-default_len:], spec.defaults
                        )
                    ]
                )
    output: List[str] = []

    output.extend(repr(getattr(obj, arg, None)) for arg in pos_args)

    if vargs is not None and hasattr(obj, vargs):
        output.extend([repr(val) for val in getattr(obj, vargs)])

    for arg, defval in kw_args.items():
        if arg in omit_kwarg:
            continue
        try:
            val = getattr(obj, arg, missing)
            if val is not missing and val != defval:
                output.append("%s=%r" % (arg, val))
        except Exception:
            pass

    if additional_kw:
        for arg, defval in additional_kw:
            try:
                val = getattr(obj, arg, missing)
                if val is not missing and val != defval:
                    output.append("%s=%r" % (arg, val))
            except Exception:
                pass

    return "%s(%s)" % (obj.__class__.__name__, ", ".join(output))


class portable_instancemethod:
    """Turn an instancemethod into a (parent, name) pair
    to produce a serializable callable.

    """

    __slots__ = "target", "name", "kwargs", "__weakref__"

    def __getstate__(self):
        return {
            "target": self.target,
            "name": self.name,
            "kwargs": self.kwargs,
        }

    def __setstate__(self, state):
        self.target = state["target"]
        self.name = state["name"]
        self.kwargs = state.get("kwargs", ())

    def __init__(self, meth, kwargs=()):
        self.target = meth.__self__
        self.name = meth.__name__
        self.kwargs = kwargs

    def __call__(self, *arg, **kw):
        kw.update(self.kwargs)
        return getattr(self.target, self.name)(*arg, **kw)


def class_hierarchy(cls):
    """Return an unordered sequence of all classes related to cls.

    Traverses diamond hierarchies.

    Fibs slightly: subclasses of builtin types are not returned.  Thus
    class_hierarchy(class A(object)) returns (A, object), not A plus every
    class systemwide that derives from object.

    """

    hier = {cls}
    process = list(cls.__mro__)
    while process:
        c = process.pop()
        bases = (_ for _ in c.__bases__ if _ not in hier)

        for b in bases:
            process.append(b)
            hier.add(b)

        if c.__module__ == "builtins" or not hasattr(c, "__subclasses__"):
            continue

        for s in [
            _
            for _ in (
                c.__subclasses__()
                if not issubclass(c, type)
                else c.__subclasses__(c)
            )
            if _ not in hier
        ]:
            process.append(s)
            hier.add(s)
    return list(hier)


def iterate_attributes(cls):
    """iterate all the keys and attributes associated
    with a class, without using getattr().

    Does not use getattr() so that class-sensitive
    descriptors (i.e. property.__get__()) are not called.

    """
    keys = dir(cls)
    for key in keys:
        for c in cls.__mro__:
            if key in c.__dict__:
                yield (key, c.__dict__[key])
                break


def monkeypatch_proxied_specials(
    into_cls,
    from_cls,
    skip=None,
    only=None,
    name="self.proxy",
    from_instance=None,
):
    """Automates delegation of __specials__ for a proxying type."""

    if only:
        dunders = only
    else:
        if skip is None:
            skip = (
                "__slots__",
                "__del__",
                "__getattribute__",
                "__metaclass__",
                "__getstate__",
                "__setstate__",
            )
        dunders = [
            m
            for m in dir(from_cls)
            if (
                m.startswith("__")
                and m.endswith("__")
                and not hasattr(into_cls, m)
                and m not in skip
            )
        ]

    for method in dunders:
        try:
            maybe_fn = getattr(from_cls, method)
            if not hasattr(maybe_fn, "__call__"):
                continue
            maybe_fn = getattr(maybe_fn, "__func__", maybe_fn)
            fn = cast(types.FunctionType, maybe_fn)

        except AttributeError:
            continue
        try:
            spec = compat.inspect_getfullargspec(fn)
            fn_args = compat.inspect_formatargspec(spec[0])
            d_args = compat.inspect_formatargspec(spec[0][1:])
        except TypeError:
            fn_args = "(self, *args, **kw)"
            d_args = "(*args, **kw)"

        py = (
            "def %(method)s%(fn_args)s: "
            "return %(name)s.%(method)s%(d_args)s" % locals()
        )

        env: Dict[str, types.FunctionType] = (
            from_instance is not None and {name: from_instance} or {}
        )
        exec(py, env)
        try:
            env[method].__defaults__ = fn.__defaults__
        except AttributeError:
            pass
        setattr(into_cls, method, env[method])


def methods_equivalent(meth1, meth2):
    """Return True if the two methods are the same implementation."""

    return getattr(meth1, "__func__", meth1) is getattr(
        meth2, "__func__", meth2
    )


def as_interface(obj, cls=None, methods=None, required=None):
    """Ensure basic interface compliance for an instance or dict of callables.

    Checks that ``obj`` implements public methods of ``cls`` or has members
    listed in ``methods``. If ``required`` is not supplied, implementing at
    least one interface method is sufficient. Methods present on ``obj`` that
    are not in the interface are ignored.

    If ``obj`` is a dict and ``dict`` does not meet the interface
    requirements, the keys of the dictionary are inspected. Keys present in
    ``obj`` that are not in the interface will raise TypeErrors.

    Raises TypeError if ``obj`` does not meet the interface criteria.

    In all passing cases, an object with callable members is returned.  In the
    simple case, ``obj`` is returned as-is; if dict processing kicks in then
    an anonymous class is returned.

    obj
      A type, instance, or dictionary of callables.
    cls
      Optional, a type.  All public methods of cls are considered the
      interface.  An ``obj`` instance of cls will always pass, ignoring
      ``required``..
    methods
      Optional, a sequence of method names to consider as the interface.
    required
      Optional, a sequence of mandatory implementations. If omitted, an
      ``obj`` that provides at least one interface method is considered
      sufficient.  As a convenience, required may be a type, in which case
      all public methods of the type are required.

    """
    if not cls and not methods:
        raise TypeError("a class or collection of method names are required")

    if isinstance(cls, type) and isinstance(obj, cls):
        return obj

    interface = set(methods or [m for m in dir(cls) if not m.startswith("_")])
    implemented = set(dir(obj))

    complies = operator.ge
    if isinstance(required, type):
        required = interface
    elif not required:
        required = set()
        complies = operator.gt
    else:
        required = set(required)

    if complies(implemented.intersection(interface), required):
        return obj

    # No dict duck typing here.
    if not isinstance(obj, dict):
        qualifier = complies is operator.gt and "any of" or "all of"
        raise TypeError(
            "%r does not implement %s: %s"
            % (obj, qualifier, ", ".join(interface))
        )

    class AnonymousInterface:
        """A callable-holding shell."""

    if cls:
        AnonymousInterface.__name__ = "Anonymous" + cls.__name__
    found = set()

    for method, impl in dictlike_iteritems(obj):
        if method not in interface:
            raise TypeError("%r: unknown in this interface" % method)
        if not callable(impl):
            raise TypeError("%r=%r is not callable" % (method, impl))
        setattr(AnonymousInterface, method, staticmethod(impl))
        found.add(method)

    if complies(found, required):
        return AnonymousInterface

    raise TypeError(
        "dictionary does not contain required keys %s"
        % ", ".join(required - found)
    )


_GFD = TypeVar("_GFD", bound="generic_fn_descriptor[Any]")


class generic_fn_descriptor(Generic[_T_co]):
    """Descriptor which proxies a function when the attribute is not
    present in dict

    This superclass is organized in a particular way with "memoized" and
    "non-memoized" implementation classes that are hidden from type checkers,
    as Mypy seems to not be able to handle seeing multiple kinds of descriptor
    classes used for the same attribute.

    """

    fget: Callable[..., _T_co]
    __doc__: Optional[str]
    __name__: str

    def __init__(self, fget: Callable[..., _T_co], doc: Optional[str] = None):
        self.fget = fget
        self.__doc__ = doc or fget.__doc__
        self.__name__ = fget.__name__

    @overload
    def __get__(self: _GFD, obj: None, cls: Any) -> _GFD:
        ...

    @overload
    def __get__(self, obj: object, cls: Any) -> _T_co:
        ...

    def __get__(self: _GFD, obj: Any, cls: Any) -> Union[_GFD, _T_co]:
        raise NotImplementedError()

    if TYPE_CHECKING:

        def __set__(self, instance: Any, value: Any) -> None:
            ...

        def __delete__(self, instance: Any) -> None:
            ...

    def _reset(self, obj: Any) -> None:
        raise NotImplementedError()

    @classmethod
    def reset(cls, obj: Any, name: str) -> None:
        raise NotImplementedError()


class _non_memoized_property(generic_fn_descriptor[_T_co]):
    """a plain descriptor that proxies a function.

    primary rationale is to provide a plain attribute that's
    compatible with memoized_property which is also recognized as equivalent
    by mypy.

    """

    if not TYPE_CHECKING:

        def __get__(self, obj, cls):
            if obj is None:
                return self
            return self.fget(obj)


class _memoized_property(generic_fn_descriptor[_T_co]):
    """A read-only @property that is only evaluated once."""

    if not TYPE_CHECKING:

        def __get__(self, obj, cls):
            if obj is None:
                return self
            obj.__dict__[self.__name__] = result = self.fget(obj)
            return result

    def _reset(self, obj):
        _memoized_property.reset(obj, self.__name__)

    @classmethod
    def reset(cls, obj, name):
        obj.__dict__.pop(name, None)


# despite many attempts to get Mypy to recognize an overridden descriptor
# where one is memoized and the other isn't, there seems to be no reliable
# way other than completely deceiving the type checker into thinking there
# is just one single descriptor type everywhere.  Otherwise, if a superclass
# has non-memoized and subclass has memoized, that requires
# "class memoized(non_memoized)".  but then if a superclass has memoized and
# superclass has non-memoized, the class hierarchy of the descriptors
# would need to be reversed; "class non_memoized(memoized)".  so there's no
# way to achieve this.
# additional issues, RO properties:
# https://github.com/python/mypy/issues/12440
if TYPE_CHECKING:
    # allow memoized and non-memoized to be freely mixed by having them
    # be the same class
    memoized_property = generic_fn_descriptor
    non_memoized_property = generic_fn_descriptor

    # for read only situations, mypy only sees @property as read only.
    # read only is needed when a subtype specializes the return type
    # of a property, meaning assignment needs to be disallowed
    ro_memoized_property = property
    ro_non_memoized_property = property

else:
    memoized_property = ro_memoized_property = _memoized_property
    non_memoized_property = ro_non_memoized_property = _non_memoized_property


def memoized_instancemethod(fn: _F) -> _F:
    """Decorate a method memoize its return value.

    Best applied to no-arg methods: memoization is not sensitive to
    argument values, and will always return the same value even when
    called with different arguments.

    """

    def oneshot(self, *args, **kw):
        result = fn(self, *args, **kw)

        def memo(*a, **kw):
            return result

        memo.__name__ = fn.__name__
        memo.__doc__ = fn.__doc__
        self.__dict__[fn.__name__] = memo
        return result

    return update_wrapper(oneshot, fn)  # type: ignore


class HasMemoized:
    """A mixin class that maintains the names of memoized elements in a
    collection for easy cache clearing, generative, etc.

    """

    if not TYPE_CHECKING:
        # support classes that want to have __slots__ with an explicit
        # slot for __dict__.  not sure if that requires base __slots__ here.
        __slots__ = ()

    _memoized_keys: FrozenSet[str] = frozenset()

    def _reset_memoizations(self) -> None:
        for elem in self._memoized_keys:
            self.__dict__.pop(elem, None)

    def _assert_no_memoizations(self) -> None:
        for elem in self._memoized_keys:
            assert elem not in self.__dict__

    def _set_memoized_attribute(self, key: str, value: Any) -> None:
        self.__dict__[key] = value
        self._memoized_keys |= {key}

    class memoized_attribute(memoized_property[_T]):
        """A read-only @property that is only evaluated once.

        :meta private:

        """

        fget: Callable[..., _T]
        __doc__: Optional[str]
        __name__: str

        def __init__(self, fget: Callable[..., _T], doc: Optional[str] = None):
            self.fget = fget
            self.__doc__ = doc or fget.__doc__
            self.__name__ = fget.__name__

        @overload
        def __get__(self: _MA, obj: None, cls: Any) -> _MA:
            ...

        @overload
        def __get__(self, obj: Any, cls: Any) -> _T:
            ...

        def __get__(self, obj, cls):
            if obj is None:
                return self
            obj.__dict__[self.__name__] = result = self.fget(obj)
            obj._memoized_keys |= {self.__name__}
            return result

    @classmethod
    def memoized_instancemethod(cls, fn: _F) -> _F:
        """Decorate a method memoize its return value.

        :meta private:

        """

        def oneshot(self: Any, *args: Any, **kw: Any) -> Any:
            result = fn(self, *args, **kw)

            def memo(*a, **kw):
                return result

            memo.__name__ = fn.__name__
            memo.__doc__ = fn.__doc__
            self.__dict__[fn.__name__] = memo
            self._memoized_keys |= {fn.__name__}
            return result

        return update_wrapper(oneshot, fn)  # type: ignore


if TYPE_CHECKING:
    HasMemoized_ro_memoized_attribute = property
else:
    HasMemoized_ro_memoized_attribute = HasMemoized.memoized_attribute


class MemoizedSlots:
    """Apply memoized items to an object using a __getattr__ scheme.

    This allows the functionality of memoized_property and
    memoized_instancemethod to be available to a class using __slots__.

    """

    __slots__ = ()

    def _fallback_getattr(self, key):
        raise AttributeError(key)

    def __getattr__(self, key: str) -> Any:
        if key.startswith("_memoized_attr_") or key.startswith(
            "_memoized_method_"
        ):
            raise AttributeError(key)
        # to avoid recursion errors when interacting with other __getattr__
        # schemes that refer to this one, when testing for memoized method
        # look at __class__ only rather than going into __getattr__ again.
        elif hasattr(self.__class__, f"_memoized_attr_{key}"):
            value = getattr(self, f"_memoized_attr_{key}")()
            setattr(self, key, value)
            return value
        elif hasattr(self.__class__, f"_memoized_method_{key}"):
            fn = getattr(self, f"_memoized_method_{key}")

            def oneshot(*args, **kw):
                result = fn(*args, **kw)

                def memo(*a, **kw):
                    return result

                memo.__name__ = fn.__name__
                memo.__doc__ = fn.__doc__
                setattr(self, key, memo)
                return result

            oneshot.__doc__ = fn.__doc__
            return oneshot
        else:
            return self._fallback_getattr(key)


# from paste.deploy.converters
def asbool(obj: Any) -> bool:
    if isinstance(obj, str):
        obj = obj.strip().lower()
        if obj in ["true", "yes", "on", "y", "t", "1"]:
            return True
        elif obj in ["false", "no", "off", "n", "f", "0"]:
            return False
        else:
            raise ValueError("String is not true/false: %r" % obj)
    return bool(obj)


def bool_or_str(*text: str) -> Callable[[str], Union[str, bool]]:
    """Return a callable that will evaluate a string as
    boolean, or one of a set of "alternate" string values.

    """

    def bool_or_value(obj: str) -> Union[str, bool]:
        if obj in text:
            return obj
        else:
            return asbool(obj)

    return bool_or_value


def asint(value: Any) -> Optional[int]:
    """Coerce to integer."""

    if value is None:
        return value
    return int(value)


def coerce_kw_type(
    kw: Dict[str, Any],
    key: str,
    type_: Type[Any],
    flexi_bool: bool = True,
    dest: Optional[Dict[str, Any]] = None,
) -> None:
    r"""If 'key' is present in dict 'kw', coerce its value to type 'type\_' if
    necessary.  If 'flexi_bool' is True, the string '0' is considered false
    when coercing to boolean.
    """

    if dest is None:
        dest = kw

    if (
        key in kw
        and (not isinstance(type_, type) or not isinstance(kw[key], type_))
        and kw[key] is not None
    ):
        if type_ is bool and flexi_bool:
            dest[key] = asbool(kw[key])
        else:
            dest[key] = type_(kw[key])


def constructor_key(obj: Any, cls: Type[Any]) -> Tuple[Any, ...]:
    """Produce a tuple structure that is cacheable using the __dict__ of
    obj to retrieve values

    """
    names = get_cls_kwargs(cls)
    return (cls,) + tuple(
        (k, obj.__dict__[k]) for k in names if k in obj.__dict__
    )


def constructor_copy(obj: _T, cls: Type[_T], *args: Any, **kw: Any) -> _T:
    """Instantiate cls using the __dict__ of obj as constructor arguments.

    Uses inspect to match the named arguments of ``cls``.

    """

    names = get_cls_kwargs(cls)
    kw.update(
        (k, obj.__dict__[k]) for k in names.difference(kw) if k in obj.__dict__
    )
    return cls(*args, **kw)


def counter() -> Callable[[], int]:
    """Return a threadsafe counter function."""

    lock = threading.Lock()
    counter = itertools.count(1)

    # avoid the 2to3 "next" transformation...
    def _next():
        with lock:
            return next(counter)

    return _next


def duck_type_collection(
    specimen: Any, default: Optional[Type[Any]] = None
) -> Optional[Type[Any]]:
    """Given an instance or class, guess if it is or is acting as one of
    the basic collection types: list, set and dict.  If the __emulates__
    property is present, return that preferentially.
    """

    if hasattr(specimen, "__emulates__"):
        # canonicalize set vs sets.Set to a standard: the builtin set
        if specimen.__emulates__ is not None and issubclass(
            specimen.__emulates__, set
        ):
            return set
        else:
            return specimen.__emulates__  # type: ignore

    isa = issubclass if isinstance(specimen, type) else isinstance
    if isa(specimen, list):
        return list
    elif isa(specimen, set):
        return set
    elif isa(specimen, dict):
        return dict

    if hasattr(specimen, "append"):
        return list
    elif hasattr(specimen, "add"):
        return set
    elif hasattr(specimen, "set"):
        return dict
    else:
        return default


def assert_arg_type(
    arg: Any, argtype: Union[Tuple[Type[Any], ...], Type[Any]], name: str
) -> Any:
    if isinstance(arg, argtype):
        return arg
    else:
        if isinstance(argtype, tuple):
            raise exc.ArgumentError(
                "Argument '%s' is expected to be one of type %s, got '%s'"
                % (name, " or ".join("'%s'" % a for a in argtype), type(arg))
            )
        else:
            raise exc.ArgumentError(
                "Argument '%s' is expected to be of type '%s', got '%s'"
                % (name, argtype, type(arg))
            )


def dictlike_iteritems(dictlike):
    """Return a (key, value) iterator for almost any dict-like object."""

    if hasattr(dictlike, "items"):
        return list(dictlike.items())

    getter = getattr(dictlike, "__getitem__", getattr(dictlike, "get", None))
    if getter is None:
        raise TypeError("Object '%r' is not dict-like" % dictlike)

    if hasattr(dictlike, "iterkeys"):

        def iterator():
            for key in dictlike.iterkeys():
                assert getter is not None
                yield key, getter(key)

        return iterator()
    elif hasattr(dictlike, "keys"):
        return iter((key, getter(key)) for key in dictlike.keys())
    else:
        raise TypeError("Object '%r' is not dict-like" % dictlike)


class classproperty(property):
    """A decorator that behaves like @property except that operates
    on classes rather than instances.

    The decorator is currently special when using the declarative
    module, but note that the
    :class:`~.sqlalchemy.ext.declarative.declared_attr`
    decorator should be used for this purpose with declarative.

    """

    fget: Callable[[Any], Any]

    def __init__(self, fget: Callable[[Any], Any], *arg: Any, **kw: Any):
        super().__init__(fget, *arg, **kw)
        self.__doc__ = fget.__doc__

    def __get__(self, obj: Any, cls: Optional[type] = None) -> Any:
        return self.fget(cls)


class hybridproperty(Generic[_T]):
    def __init__(self, func: Callable[..., _T]):
        self.func = func
        self.clslevel = func

    def __get__(self, instance: Any, owner: Any) -> _T:
        if instance is None:
            clsval = self.clslevel(owner)
            return clsval
        else:
            return self.func(instance)

    def classlevel(self, func: Callable[..., Any]) -> hybridproperty[_T]:
        self.clslevel = func
        return self


class rw_hybridproperty(Generic[_T]):
    def __init__(self, func: Callable[..., _T]):
        self.func = func
        self.clslevel = func
        self.setfn: Optional[Callable[..., Any]] = None

    def __get__(self, instance: Any, owner: Any) -> _T:
        if instance is None:
            clsval = self.clslevel(owner)
            return clsval
        else:
            return self.func(instance)

    def __set__(self, instance: Any, value: Any) -> None:
        assert self.setfn is not None
        self.setfn(instance, value)

    def setter(self, func: Callable[..., Any]) -> rw_hybridproperty[_T]:
        self.setfn = func
        return self

    def classlevel(self, func: Callable[..., Any]) -> rw_hybridproperty[_T]:
        self.clslevel = func
        return self


class hybridmethod(Generic[_T]):
    """Decorate a function as cls- or instance- level."""

    def __init__(self, func: Callable[..., _T]):
        self.func = self.__func__ = func
        self.clslevel = func

    def __get__(self, instance: Any, owner: Any) -> Callable[..., _T]:
        if instance is None:
            return self.clslevel.__get__(owner, owner.__class__)  # type:ignore
        else:
            return self.func.__get__(instance, owner)  # type:ignore

    def classlevel(self, func: Callable[..., Any]) -> hybridmethod[_T]:
        self.clslevel = func
        return self


class symbol(int):
    """A constant symbol.

    >>> symbol('foo') is symbol('foo')
    True
    >>> symbol('foo')
    <symbol 'foo>

    A slight refinement of the MAGICCOOKIE=object() pattern.  The primary
    advantage of symbol() is its repr().  They are also singletons.

    Repeated calls of symbol('name') will all return the same instance.

    """

    name: str

    symbols: Dict[str, symbol] = {}
    _lock = threading.Lock()

    def __new__(
        cls,
        name: str,
        doc: Optional[str] = None,
        canonical: Optional[int] = None,
    ) -> symbol:
        with cls._lock:
            sym = cls.symbols.get(name)
            if sym is None:
                assert isinstance(name, str)
                if canonical is None:
                    canonical = hash(name)
                sym = int.__new__(symbol, canonical)
                sym.name = name
                if doc:
                    sym.__doc__ = doc

                # NOTE: we should ultimately get rid of this global thing,
                # however, currently it is to support pickling.  The best
                # change would be when we are on py3.11 at a minimum, we
                # switch to stdlib enum.IntFlag.
                cls.symbols[name] = sym
            else:
                if canonical and canonical != sym:
                    raise TypeError(
                        f"Can't replace canonical symbol for {name!r} "
                        f"with new int value {canonical}"
                    )
            return sym

    def __reduce__(self):
        return symbol, (self.name, "x", int(self))

    def __str__(self):
        return repr(self)

    def __repr__(self):
        return f"symbol({self.name!r})"


class _IntFlagMeta(type):
    def __init__(
        cls,
        classname: str,
        bases: Tuple[Type[Any], ...],
        dict_: Dict[str, Any],
        **kw: Any,
    ) -> None:
        items: List[symbol]
        cls._items = items = []
        for k, v in dict_.items():
            if isinstance(v, int):
                sym = symbol(k, canonical=v)
            elif not k.startswith("_"):
                raise TypeError("Expected integer values for IntFlag")
            else:
                continue
            setattr(cls, k, sym)
            items.append(sym)

        cls.__members__ = _collections.immutabledict(
            {sym.name: sym for sym in items}
        )

    def __iter__(self) -> Iterator[symbol]:
        raise NotImplementedError(
            "iter not implemented to ensure compatibility with "
            "Python 3.11 IntFlag.  Please use __members__.  See "
            "https://github.com/python/cpython/issues/99304"
        )


class _FastIntFlag(metaclass=_IntFlagMeta):
    """An 'IntFlag' copycat that isn't slow when performing bitwise
    operations.

    the ``FastIntFlag`` class will return ``enum.IntFlag`` under TYPE_CHECKING
    and ``_FastIntFlag`` otherwise.

    """


if TYPE_CHECKING:
    from enum import IntFlag

    FastIntFlag = IntFlag
else:
    FastIntFlag = _FastIntFlag


_E = TypeVar("_E", bound=enum.Enum)


def parse_user_argument_for_enum(
    arg: Any,
    choices: Dict[_E, List[Any]],
    name: str,
    resolve_symbol_names: bool = False,
) -> Optional[_E]:
    """Given a user parameter, parse the parameter into a chosen value
    from a list of choice objects, typically Enum values.

    The user argument can be a string name that matches the name of a
    symbol, or the symbol object itself, or any number of alternate choices
    such as True/False/ None etc.

    :param arg: the user argument.
    :param choices: dictionary of enum values to lists of possible
        entries for each.
    :param name: name of the argument.   Used in an :class:`.ArgumentError`
        that is raised if the parameter doesn't match any available argument.

    """
    for enum_value, choice in choices.items():
        if arg is enum_value:
            return enum_value
        elif resolve_symbol_names and arg == enum_value.name:
            return enum_value
        elif arg in choice:
            return enum_value

    if arg is None:
        return None

    raise exc.ArgumentError(f"Invalid value for '{name}': {arg!r}")


_creation_order = 1


def set_creation_order(instance: Any) -> None:
    """Assign a '_creation_order' sequence to the given instance.

    This allows multiple instances to be sorted in order of creation
    (typically within a single thread; the counter is not particularly
    threadsafe).

    """
    global _creation_order
    instance._creation_order = _creation_order
    _creation_order += 1


def warn_exception(func: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """executes the given function, catches all exceptions and converts to
    a warning.

    """
    try:
        return func(*args, **kwargs)
    except Exception:
        warn("%s('%s') ignored" % sys.exc_info()[0:2])


def ellipses_string(value, len_=25):
    try:
        if len(value) > len_:
            return "%s..." % value[0:len_]
        else:
            return value
    except TypeError:
        return value


class _hash_limit_string(str):
    """A string subclass that can only be hashed on a maximum amount
    of unique values.

    This is used for warnings so that we can send out parameterized warnings
    without the __warningregistry__ of the module,  or the non-overridable
    "once" registry within warnings.py, overloading memory,


    """

    _hash: int

    def __new__(
        cls, value: str, num: int, args: Sequence[Any]
    ) -> _hash_limit_string:
        interpolated = (value % args) + (
            " (this warning may be suppressed after %d occurrences)" % num
        )
        self = super().__new__(cls, interpolated)
        self._hash = hash("%s_%d" % (value, hash(interpolated) % num))
        return self

    def __hash__(self) -> int:
        return self._hash

    def __eq__(self, other: Any) -> bool:
        return hash(self) == hash(other)


def warn(msg: str, code: Optional[str] = None) -> None:
    """Issue a warning.

    If msg is a string, :class:`.exc.SAWarning` is used as
    the category.

    """
    if code:
        _warnings_warn(exc.SAWarning(msg, code=code))
    else:
        _warnings_warn(msg, exc.SAWarning)


def warn_limited(msg: str, args: Sequence[Any]) -> None:
    """Issue a warning with a parameterized string, limiting the number
    of registrations.

    """
    if args:
        msg = _hash_limit_string(msg, 10, args)
    _warnings_warn(msg, exc.SAWarning)


_warning_tags: Dict[CodeType, Tuple[str, Type[Warning]]] = {}


def tag_method_for_warnings(
    message: str, category: Type[Warning]
) -> Callable[[_F], _F]:
    def go(fn):
        _warning_tags[fn.__code__] = (message, category)
        return fn

    return go


_not_sa_pattern = re.compile(r"^(?:sqlalchemy\.(?!testing)|alembic\.)")


def _warnings_warn(
    message: Union[str, Warning],
    category: Optional[Type[Warning]] = None,
    stacklevel: int = 2,
) -> None:
    # adjust the given stacklevel to be outside of SQLAlchemy
    try:
        frame = sys._getframe(stacklevel)
    except ValueError:
        # being called from less than 3 (or given) stacklevels, weird,
        # but don't crash
        stacklevel = 0
    except:
        # _getframe() doesn't work, weird interpreter issue, weird,
        # ok, but don't crash
        stacklevel = 0
    else:
        stacklevel_found = warning_tag_found = False
        while frame is not None:
            # using __name__ here requires that we have __name__ in the
            # __globals__ of the decorated string functions we make also.
            # we generate this using {"__name__": fn.__module__}
            if not stacklevel_found and not re.match(
                _not_sa_pattern, frame.f_globals.get("__name__", "")
            ):
                # stop incrementing stack level if an out-of-SQLA line
                # were found.
                stacklevel_found = True

                # however, for the warning tag thing, we have to keep
                # scanning up the whole traceback

            if frame.f_code in _warning_tags:
                warning_tag_found = True
                (_suffix, _category) = _warning_tags[frame.f_code]
                category = category or _category
                message = f"{message} ({_suffix})"

            frame = frame.f_back  # type: ignore[assignment]

            if not stacklevel_found:
                stacklevel += 1
            elif stacklevel_found and warning_tag_found:
                break

    if category is not None:
        warnings.warn(message, category, stacklevel=stacklevel + 1)
    else:
        warnings.warn(message, stacklevel=stacklevel + 1)


def only_once(
    fn: Callable[..., _T], retry_on_exception: bool
) -> Callable[..., Optional[_T]]:
    """Decorate the given function to be a no-op after it is called exactly
    once."""

    once = [fn]

    def go(*arg: Any, **kw: Any) -> Optional[_T]:
        # strong reference fn so that it isn't garbage collected,
        # which interferes with the event system's expectations
        strong_fn = fn  # noqa
        if once:
            once_fn = once.pop()
            try:
                return once_fn(*arg, **kw)
            except:
                if retry_on_exception:
                    once.insert(0, once_fn)
                raise

        return None

    return go


_SQLA_RE = re.compile(r"sqlalchemy/([a-z_]+/){0,2}[a-z_]+\.py")
_UNITTEST_RE = re.compile(r"unit(?:2|test2?/)")


def chop_traceback(
    tb: List[str],
    exclude_prefix: re.Pattern[str] = _UNITTEST_RE,
    exclude_suffix: re.Pattern[str] = _SQLA_RE,
) -> List[str]:
    """Chop extraneous lines off beginning and end of a traceback.

    :param tb:
      a list of traceback lines as returned by ``traceback.format_stack()``

    :param exclude_prefix:
      a regular expression object matching lines to skip at beginning of
      ``tb``

    :param exclude_suffix:
      a regular expression object matching lines to skip at end of ``tb``
    """
    start = 0
    end = len(tb) - 1
    while start <= end and exclude_prefix.search(tb[start]):
        start += 1
    while start <= end and exclude_suffix.search(tb[end]):
        end -= 1
    return tb[start : end + 1]


NoneType = type(None)


def attrsetter(attrname):
    code = "def set(obj, value):" "    obj.%s = value" % attrname
    env = locals().copy()
    exec(code, env)
    return env["set"]


class TypingOnly:
    """A mixin class that marks a class as 'typing only', meaning it has
    absolutely no methods, attributes, or runtime functionality whatsoever.

    """

    __slots__ = ()

    def __init_subclass__(cls) -> None:
        if TypingOnly in cls.__bases__:
            remaining = set(cls.__dict__).difference(
                {
                    "__module__",
                    "__doc__",
                    "__slots__",
                    "__orig_bases__",
                    "__annotations__",
                }
            )
            if remaining:
                raise AssertionError(
                    f"Class {cls} directly inherits TypingOnly but has "
                    f"additional attributes {remaining}."
                )
        super().__init_subclass__()


class EnsureKWArg:
    r"""Apply translation of functions to accept \**kw arguments if they
    don't already.

    Used to ensure cross-compatibility with third party legacy code, for things
    like compiler visit methods that need to accept ``**kw`` arguments,
    but may have been copied from old code that didn't accept them.

    """

    ensure_kwarg: str
    """a regular expression that indicates method names for which the method
    should accept ``**kw`` arguments.

    The class will scan for methods matching the name template and decorate
    them if necessary to ensure ``**kw`` parameters are accepted.

    """

    def __init_subclass__(cls) -> None:
        fn_reg = cls.ensure_kwarg
        clsdict = cls.__dict__
        if fn_reg:
            for key in clsdict:
                m = re.match(fn_reg, key)
                if m:
                    fn = clsdict[key]
                    spec = compat.inspect_getfullargspec(fn)
                    if not spec.varkw:
                        wrapped = cls._wrap_w_kw(fn)
                        setattr(cls, key, wrapped)
        super().__init_subclass__()

    @classmethod
    def _wrap_w_kw(cls, fn: Callable[..., Any]) -> Callable[..., Any]:
        def wrap(*arg: Any, **kw: Any) -> Any:
            return fn(*arg)

        return update_wrapper(wrap, fn)


def wrap_callable(wrapper, fn):
    """Augment functools.update_wrapper() to work with objects with
    a ``__call__()`` method.

    :param fn:
      object with __call__ method

    """
    if hasattr(fn, "__name__"):
        return update_wrapper(wrapper, fn)
    else:
        _f = wrapper
        _f.__name__ = fn.__class__.__name__
        if hasattr(fn, "__module__"):
            _f.__module__ = fn.__module__

        if hasattr(fn.__call__, "__doc__") and fn.__call__.__doc__:
            _f.__doc__ = fn.__call__.__doc__
        elif fn.__doc__:
            _f.__doc__ = fn.__doc__

        return _f


def quoted_token_parser(value):
    """Parse a dotted identifier with accommodation for quoted names.

    Includes support for SQL-style double quotes as a literal character.

    E.g.::

        >>> quoted_token_parser("name")
        ["name"]
        >>> quoted_token_parser("schema.name")
        ["schema", "name"]
        >>> quoted_token_parser('"Schema"."Name"')
        ['Schema', 'Name']
        >>> quoted_token_parser('"Schema"."Name""Foo"')
        ['Schema', 'Name""Foo']

    """

    if '"' not in value:
        return value.split(".")

    # 0 = outside of quotes
    # 1 = inside of quotes
    state = 0
    result: List[List[str]] = [[]]
    idx = 0
    lv = len(value)
    while idx < lv:
        char = value[idx]
        if char == '"':
            if state == 1 and idx < lv - 1 and value[idx + 1] == '"':
                result[-1].append('"')
                idx += 1
            else:
                state ^= 1
        elif char == "." and state == 0:
            result.append([])
        else:
            result[-1].append(char)
        idx += 1

    return ["".join(token) for token in result]


def add_parameter_text(params: Any, text: str) -> Callable[[_F], _F]:
    params = _collections.to_list(params)

    def decorate(fn):
        doc = fn.__doc__ is not None and fn.__doc__ or ""
        if doc:
            doc = inject_param_text(doc, {param: text for param in params})
        fn.__doc__ = doc
        return fn

    return decorate


def _dedent_docstring(text: str) -> str:
    split_text = text.split("\n", 1)
    if len(split_text) == 1:
        return text
    else:
        firstline, remaining = split_text
    if not firstline.startswith(" "):
        return firstline + "\n" + textwrap.dedent(remaining)
    else:
        return textwrap.dedent(text)


def inject_docstring_text(
    given_doctext: Optional[str], injecttext: str, pos: int
) -> str:
    doctext: str = _dedent_docstring(given_doctext or "")
    lines = doctext.split("\n")
    if len(lines) == 1:
        lines.append("")
    injectlines = textwrap.dedent(injecttext).split("\n")
    if injectlines[0]:
        injectlines.insert(0, "")

    blanks = [num for num, line in enumerate(lines) if not line.strip()]
    blanks.insert(0, 0)

    inject_pos = blanks[min(pos, len(blanks) - 1)]

    lines = lines[0:inject_pos] + injectlines + lines[inject_pos:]
    return "\n".join(lines)


_param_reg = re.compile(r"(\s+):param (.+?):")


def inject_param_text(doctext: str, inject_params: Dict[str, str]) -> str:
    doclines = collections.deque(doctext.splitlines())
    lines = []

    # TODO: this is not working for params like ":param case_sensitive=True:"

    to_inject = None
    while doclines:
        line = doclines.popleft()

        m = _param_reg.match(line)

        if to_inject is None:
            if m:
                param = m.group(2).lstrip("*")
                if param in inject_params:
                    # default indent to that of :param: plus one
                    indent = " " * len(m.group(1)) + " "

                    # but if the next line has text, use that line's
                    # indentation
                    if doclines:
                        m2 = re.match(r"(\s+)\S", doclines[0])
                        if m2:
                            indent = " " * len(m2.group(1))

                    to_inject = indent + inject_params[param]
        elif m:
            lines.extend(["\n", to_inject, "\n"])
            to_inject = None
        elif not line.rstrip():
            lines.extend([line, to_inject, "\n"])
            to_inject = None
        elif line.endswith("::"):
            # TODO: this still won't cover if the code example itself has
            # blank lines in it, need to detect those via indentation.
            lines.extend([line, doclines.popleft()])
            continue
        lines.append(line)

    return "\n".join(lines)


def repr_tuple_names(names: List[str]) -> Optional[str]:
    """Trims a list of strings from the middle and return a string of up to
    four elements. Strings greater than 11 characters will be truncated"""
    if len(names) == 0:
        return None
    flag = len(names) <= 4
    names = names[0:4] if flag else names[0:3] + names[-1:]
    res = ["%s.." % name[:11] if len(name) > 11 else name for name in names]
    if flag:
        return ", ".join(res)
    else:
        return "%s, ..., %s" % (", ".join(res[0:3]), res[-1])


def has_compiled_ext(raise_=False):
    if HAS_CYEXTENSION:
        return True
    elif raise_:
        raise ImportError(
            "cython extensions were expected to be installed, "
            "but are not present"
        )
    else:
        return False
