# inspection.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""The inspection module provides the :func:`_sa.inspect` function,
which delivers runtime information about a wide variety
of SQLAlchemy objects, both within the Core as well as the
ORM.

The :func:`_sa.inspect` function is the entry point to SQLAlchemy's
public API for viewing the configuration and construction
of in-memory objects.   Depending on the type of object
passed to :func:`_sa.inspect`, the return value will either be
a related object which provides a known interface, or in many
cases it will return the object itself.

The rationale for :func:`_sa.inspect` is twofold.  One is that
it replaces the need to be aware of a large variety of "information
getting" functions in SQLAlchemy, such as
:meth:`_reflection.Inspector.from_engine` (deprecated in 1.4),
:func:`.orm.attributes.instance_state`, :func:`_orm.class_mapper`,
and others.    The other is that the return value of :func:`_sa.inspect`
is guaranteed to obey a documented API, thus allowing third party
tools which build on top of SQLAlchemy configurations to be constructed
in a forwards-compatible way.

"""
from __future__ import annotations

from typing import Any
from typing import Callable
from typing import Dict
from typing import Generic
from typing import Optional
from typing import overload
from typing import Type
from typing import TypeVar
from typing import Union

from . import exc
from .util.typing import Literal
from .util.typing import Protocol

_T = TypeVar("_T", bound=Any)
_TCov = TypeVar("_TCov", bound=Any, covariant=True)
_F = TypeVar("_F", bound=Callable[..., Any])

_IN = TypeVar("_IN", bound=Any)

_registrars: Dict[type, Union[Literal[True], Callable[[Any], Any]]] = {}


class Inspectable(Generic[_T]):
    """define a class as inspectable.

    This allows typing to set up a linkage between an object that
    can be inspected and the type of inspection it returns.

    Unfortunately we cannot at the moment get all classes that are
    returned by inspection to suit this interface as we get into
    MRO issues.

    """

    __slots__ = ()


class _InspectableTypeProtocol(Protocol[_TCov]):
    """a protocol defining a method that's used when a type (ie the class
    itself) is passed to inspect().

    """

    def _sa_inspect_type(self) -> _TCov:
        ...


class _InspectableProtocol(Protocol[_TCov]):
    """a protocol defining a method that's used when an instance is
    passed to inspect().

    """

    def _sa_inspect_instance(self) -> _TCov:
        ...


@overload
def inspect(
    subject: Type[_InspectableTypeProtocol[_IN]], raiseerr: bool = True
) -> _IN:
    ...


@overload
def inspect(subject: _InspectableProtocol[_IN], raiseerr: bool = True) -> _IN:
    ...


@overload
def inspect(subject: Inspectable[_IN], raiseerr: bool = True) -> _IN:
    ...


@overload
def inspect(subject: Any, raiseerr: Literal[False] = ...) -> Optional[Any]:
    ...


@overload
def inspect(subject: Any, raiseerr: bool = True) -> Any:
    ...


def inspect(subject: Any, raiseerr: bool = True) -> Any:
    """Produce an inspection object for the given target.

    The returned value in some cases may be the
    same object as the one given, such as if a
    :class:`_orm.Mapper` object is passed.   In other
    cases, it will be an instance of the registered
    inspection type for the given object, such as
    if an :class:`_engine.Engine` is passed, an
    :class:`_reflection.Inspector` object is returned.

    :param subject: the subject to be inspected.
    :param raiseerr: When ``True``, if the given subject
     does not
     correspond to a known SQLAlchemy inspected type,
     :class:`sqlalchemy.exc.NoInspectionAvailable`
     is raised.  If ``False``, ``None`` is returned.

    """
    type_ = type(subject)
    for cls in type_.__mro__:
        if cls in _registrars:
            reg = _registrars.get(cls, None)
            if reg is None:
                continue
            elif reg is True:
                return subject
            ret = reg(subject)
            if ret is not None:
                return ret
    else:
        reg = ret = None

    if raiseerr and (reg is None or ret is None):
        raise exc.NoInspectionAvailable(
            "No inspection system is "
            "available for object of type %s" % type_
        )
    return ret


def _inspects(
    *types: Type[Any],
) -> Callable[[_F], _F]:
    def decorate(fn_or_cls: _F) -> _F:
        for type_ in types:
            if type_ in _registrars:
                raise AssertionError(
                    "Type %s is already " "registered" % type_
                )
            _registrars[type_] = fn_or_cls
        return fn_or_cls

    return decorate


_TT = TypeVar("_TT", bound="Type[Any]")


def _self_inspects(cls: _TT) -> _TT:
    if cls in _registrars:
        raise AssertionError("Type %s is already " "registered" % cls)
    _registrars[cls] = True
    return cls
