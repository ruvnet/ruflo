# orm/exc.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""SQLAlchemy ORM exceptions."""

from __future__ import annotations

from typing import Any
from typing import Optional
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar

from .. import exc as sa_exc
from .. import util
from ..exc import MultipleResultsFound  # noqa
from ..exc import NoResultFound  # noqa

if TYPE_CHECKING:
    from .interfaces import LoaderStrategy
    from .interfaces import MapperProperty
    from .state import InstanceState

_T = TypeVar("_T", bound=Any)

NO_STATE = (AttributeError, KeyError)
"""Exception types that may be raised by instrumentation implementations."""


class StaleDataError(sa_exc.SQLAlchemyError):
    """An operation encountered database state that is unaccounted for.

    Conditions which cause this to happen include:

    * A flush may have attempted to update or delete rows
      and an unexpected number of rows were matched during
      the UPDATE or DELETE statement.   Note that when
      version_id_col is used, rows in UPDATE or DELETE statements
      are also matched against the current known version
      identifier.

    * A mapped object with version_id_col was refreshed,
      and the version number coming back from the database does
      not match that of the object itself.

    * A object is detached from its parent object, however
      the object was previously attached to a different parent
      identity which was garbage collected, and a decision
      cannot be made if the new parent was really the most
      recent "parent".

    """


ConcurrentModificationError = StaleDataError


class FlushError(sa_exc.SQLAlchemyError):
    """A invalid condition was detected during flush()."""


class UnmappedError(sa_exc.InvalidRequestError):
    """Base for exceptions that involve expected mappings not present."""


class ObjectDereferencedError(sa_exc.SQLAlchemyError):
    """An operation cannot complete due to an object being garbage
    collected.

    """


class DetachedInstanceError(sa_exc.SQLAlchemyError):
    """An attempt to access unloaded attributes on a
    mapped instance that is detached."""

    code = "bhk3"


class UnmappedInstanceError(UnmappedError):
    """An mapping operation was requested for an unknown instance."""

    @util.preload_module("sqlalchemy.orm.base")
    def __init__(self, obj: object, msg: Optional[str] = None):
        base = util.preloaded.orm_base

        if not msg:
            try:
                base.class_mapper(type(obj))
                name = _safe_cls_name(type(obj))
                msg = (
                    "Class %r is mapped, but this instance lacks "
                    "instrumentation.  This occurs when the instance "
                    "is created before sqlalchemy.orm.mapper(%s) "
                    "was called." % (name, name)
                )
            except UnmappedClassError:
                msg = f"Class '{_safe_cls_name(type(obj))}' is not mapped"
                if isinstance(obj, type):
                    msg += (
                        "; was a class (%s) supplied where an instance was "
                        "required?" % _safe_cls_name(obj)
                    )
        UnmappedError.__init__(self, msg)

    def __reduce__(self) -> Any:
        return self.__class__, (None, self.args[0])


class UnmappedClassError(UnmappedError):
    """An mapping operation was requested for an unknown class."""

    def __init__(self, cls: Type[_T], msg: Optional[str] = None):
        if not msg:
            msg = _default_unmapped(cls)
        UnmappedError.__init__(self, msg)

    def __reduce__(self) -> Any:
        return self.__class__, (None, self.args[0])


class ObjectDeletedError(sa_exc.InvalidRequestError):
    """A refresh operation failed to retrieve the database
    row corresponding to an object's known primary key identity.

    A refresh operation proceeds when an expired attribute is
    accessed on an object, or when :meth:`_query.Query.get` is
    used to retrieve an object which is, upon retrieval, detected
    as expired.   A SELECT is emitted for the target row
    based on primary key; if no row is returned, this
    exception is raised.

    The true meaning of this exception is simply that
    no row exists for the primary key identifier associated
    with a persistent object.   The row may have been
    deleted, or in some cases the primary key updated
    to a new value, outside of the ORM's management of the target
    object.

    """

    @util.preload_module("sqlalchemy.orm.base")
    def __init__(self, state: InstanceState[Any], msg: Optional[str] = None):
        base = util.preloaded.orm_base

        if not msg:
            msg = (
                "Instance '%s' has been deleted, or its "
                "row is otherwise not present." % base.state_str(state)
            )

        sa_exc.InvalidRequestError.__init__(self, msg)

    def __reduce__(self) -> Any:
        return self.__class__, (None, self.args[0])


class UnmappedColumnError(sa_exc.InvalidRequestError):
    """Mapping operation was requested on an unknown column."""


class LoaderStrategyException(sa_exc.InvalidRequestError):
    """A loader strategy for an attribute does not exist."""

    def __init__(
        self,
        applied_to_property_type: Type[Any],
        requesting_property: MapperProperty[Any],
        applies_to: Optional[Type[MapperProperty[Any]]],
        actual_strategy_type: Optional[Type[LoaderStrategy]],
        strategy_key: Tuple[Any, ...],
    ):
        if actual_strategy_type is None:
            sa_exc.InvalidRequestError.__init__(
                self,
                "Can't find strategy %s for %s"
                % (strategy_key, requesting_property),
            )
        else:
            assert applies_to is not None
            sa_exc.InvalidRequestError.__init__(
                self,
                'Can\'t apply "%s" strategy to property "%s", '
                'which is a "%s"; this loader strategy is intended '
                'to be used with a "%s".'
                % (
                    util.clsname_as_plain_name(actual_strategy_type),
                    requesting_property,
                    util.clsname_as_plain_name(applied_to_property_type),
                    util.clsname_as_plain_name(applies_to),
                ),
            )


def _safe_cls_name(cls: Type[Any]) -> str:
    cls_name: Optional[str]
    try:
        cls_name = ".".join((cls.__module__, cls.__name__))
    except AttributeError:
        cls_name = getattr(cls, "__name__", None)
        if cls_name is None:
            cls_name = repr(cls)
    return cls_name


@util.preload_module("sqlalchemy.orm.base")
def _default_unmapped(cls: Type[Any]) -> Optional[str]:
    base = util.preloaded.orm_base

    try:
        mappers = base.manager_of_class(cls).mappers  # type: ignore
    except (
        UnmappedClassError,
        TypeError,
    ) + NO_STATE:
        mappers = {}
    name = _safe_cls_name(cls)

    if not mappers:
        return f"Class '{name}' is not mapped"
    else:
        return None
