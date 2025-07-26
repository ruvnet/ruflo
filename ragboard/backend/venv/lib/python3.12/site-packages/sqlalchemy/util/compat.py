# util/compat.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

"""Handle Python version/platform incompatibilities."""

from __future__ import annotations

import base64
import dataclasses
import hashlib
import inspect
import operator
import platform
import sys
import typing
from typing import Any
from typing import Callable
from typing import Dict
from typing import Iterable
from typing import List
from typing import Mapping
from typing import Optional
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import Type
from typing import TypeVar


py312 = sys.version_info >= (3, 12)
py311 = sys.version_info >= (3, 11)
py310 = sys.version_info >= (3, 10)
py39 = sys.version_info >= (3, 9)
py38 = sys.version_info >= (3, 8)
pypy = platform.python_implementation() == "PyPy"
cpython = platform.python_implementation() == "CPython"

win32 = sys.platform.startswith("win")
osx = sys.platform.startswith("darwin")
arm = "aarch" in platform.machine().lower()
is64bit = sys.maxsize > 2**32

has_refcount_gc = bool(cpython)

dottedgetter = operator.attrgetter

_T_co = TypeVar("_T_co", covariant=True)


class FullArgSpec(typing.NamedTuple):
    args: List[str]
    varargs: Optional[str]
    varkw: Optional[str]
    defaults: Optional[Tuple[Any, ...]]
    kwonlyargs: List[str]
    kwonlydefaults: Dict[str, Any]
    annotations: Dict[str, Any]


def inspect_getfullargspec(func: Callable[..., Any]) -> FullArgSpec:
    """Fully vendored version of getfullargspec from Python 3.3."""

    if inspect.ismethod(func):
        func = func.__func__
    if not inspect.isfunction(func):
        raise TypeError(f"{func!r} is not a Python function")

    co = func.__code__
    if not inspect.iscode(co):
        raise TypeError(f"{co!r} is not a code object")

    nargs = co.co_argcount
    names = co.co_varnames
    nkwargs = co.co_kwonlyargcount
    args = list(names[:nargs])
    kwonlyargs = list(names[nargs : nargs + nkwargs])

    nargs += nkwargs
    varargs = None
    if co.co_flags & inspect.CO_VARARGS:
        varargs = co.co_varnames[nargs]
        nargs = nargs + 1
    varkw = None
    if co.co_flags & inspect.CO_VARKEYWORDS:
        varkw = co.co_varnames[nargs]

    return FullArgSpec(
        args,
        varargs,
        varkw,
        func.__defaults__,
        kwonlyargs,
        func.__kwdefaults__,
        func.__annotations__,
    )


if py39:
    # python stubs don't have a public type for this. not worth
    # making a protocol
    def md5_not_for_security() -> Any:
        return hashlib.md5(usedforsecurity=False)

else:

    def md5_not_for_security() -> Any:
        return hashlib.md5()


if typing.TYPE_CHECKING or py38:
    from importlib import metadata as importlib_metadata
else:
    import importlib_metadata  # noqa


if typing.TYPE_CHECKING or py39:
    # pep 584 dict union
    dict_union = operator.or_  # noqa
else:

    def dict_union(a: dict, b: dict) -> dict:
        a = a.copy()
        a.update(b)
        return a


if py310:
    anext_ = anext
else:
    _NOT_PROVIDED = object()
    from collections.abc import AsyncIterator

    async def anext_(async_iterator, default=_NOT_PROVIDED):
        """vendored from https://github.com/python/cpython/pull/8895"""

        if not isinstance(async_iterator, AsyncIterator):
            raise TypeError(
                f"anext expected an AsyncIterator, got {type(async_iterator)}"
            )
        anxt = type(async_iterator).__anext__
        try:
            return await anxt(async_iterator)
        except StopAsyncIteration:
            if default is _NOT_PROVIDED:
                raise
            return default


def importlib_metadata_get(group):
    ep = importlib_metadata.entry_points()
    if typing.TYPE_CHECKING or hasattr(ep, "select"):
        return ep.select(group=group)
    else:
        return ep.get(group, ())


def b(s):
    return s.encode("latin-1")


def b64decode(x: str) -> bytes:
    return base64.b64decode(x.encode("ascii"))


def b64encode(x: bytes) -> str:
    return base64.b64encode(x).decode("ascii")


def decode_backslashreplace(text: bytes, encoding: str) -> str:
    return text.decode(encoding, errors="backslashreplace")


def cmp(a, b):
    return (a > b) - (a < b)


def _formatannotation(annotation, base_module=None):
    """vendored from python 3.7"""

    if isinstance(annotation, str):
        return annotation

    if getattr(annotation, "__module__", None) == "typing":
        return repr(annotation).replace("typing.", "").replace("~", "")
    if isinstance(annotation, type):
        if annotation.__module__ in ("builtins", base_module):
            return repr(annotation.__qualname__)
        return annotation.__module__ + "." + annotation.__qualname__
    elif isinstance(annotation, typing.TypeVar):
        return repr(annotation).replace("~", "")
    return repr(annotation).replace("~", "")


def inspect_formatargspec(
    args: List[str],
    varargs: Optional[str] = None,
    varkw: Optional[str] = None,
    defaults: Optional[Sequence[Any]] = None,
    kwonlyargs: Optional[Sequence[str]] = (),
    kwonlydefaults: Optional[Mapping[str, Any]] = {},
    annotations: Mapping[str, Any] = {},
    formatarg: Callable[[str], str] = str,
    formatvarargs: Callable[[str], str] = lambda name: "*" + name,
    formatvarkw: Callable[[str], str] = lambda name: "**" + name,
    formatvalue: Callable[[Any], str] = lambda value: "=" + repr(value),
    formatreturns: Callable[[Any], str] = lambda text: " -> " + str(text),
    formatannotation: Callable[[Any], str] = _formatannotation,
) -> str:
    """Copy formatargspec from python 3.7 standard library.

    Python 3 has deprecated formatargspec and requested that Signature
    be used instead, however this requires a full reimplementation
    of formatargspec() in terms of creating Parameter objects and such.
    Instead of introducing all the object-creation overhead and having
    to reinvent from scratch, just copy their compatibility routine.

    Ultimately we would need to rewrite our "decorator" routine completely
    which is not really worth it right now, until all Python 2.x support
    is dropped.

    """

    kwonlydefaults = kwonlydefaults or {}
    annotations = annotations or {}

    def formatargandannotation(arg):
        result = formatarg(arg)
        if arg in annotations:
            result += ": " + formatannotation(annotations[arg])
        return result

    specs = []
    if defaults:
        firstdefault = len(args) - len(defaults)
    else:
        firstdefault = -1

    for i, arg in enumerate(args):
        spec = formatargandannotation(arg)
        if defaults and i >= firstdefault:
            spec = spec + formatvalue(defaults[i - firstdefault])
        specs.append(spec)

    if varargs is not None:
        specs.append(formatvarargs(formatargandannotation(varargs)))
    else:
        if kwonlyargs:
            specs.append("*")

    if kwonlyargs:
        for kwonlyarg in kwonlyargs:
            spec = formatargandannotation(kwonlyarg)
            if kwonlydefaults and kwonlyarg in kwonlydefaults:
                spec += formatvalue(kwonlydefaults[kwonlyarg])
            specs.append(spec)

    if varkw is not None:
        specs.append(formatvarkw(formatargandannotation(varkw)))

    result = "(" + ", ".join(specs) + ")"
    if "return" in annotations:
        result += formatreturns(formatannotation(annotations["return"]))
    return result


def dataclass_fields(cls: Type[Any]) -> Iterable[dataclasses.Field[Any]]:
    """Return a sequence of all dataclasses.Field objects associated
    with a class as an already processed dataclass.

    The class must **already be a dataclass** for Field objects to be returned.

    """

    if dataclasses.is_dataclass(cls):
        return dataclasses.fields(cls)
    else:
        return []


def local_dataclass_fields(cls: Type[Any]) -> Iterable[dataclasses.Field[Any]]:
    """Return a sequence of all dataclasses.Field objects associated with
    an already processed dataclass, excluding those that originate from a
    superclass.

    The class must **already be a dataclass** for Field objects to be returned.

    """

    if dataclasses.is_dataclass(cls):
        super_fields: Set[dataclasses.Field[Any]] = set()
        for sup in cls.__bases__:
            super_fields.update(dataclass_fields(sup))
        return [f for f in dataclasses.fields(cls) if f not in super_fields]
    else:
        return []
