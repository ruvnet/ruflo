# orm/base.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Constants and rudimental functions used throughout the ORM.

"""

from __future__ import annotations

from enum import Enum
import operator
import typing
from typing import Any
from typing import Callable
from typing import Dict
from typing import Generic
from typing import no_type_check
from typing import Optional
from typing import overload
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import exc
from ._typing import insp_is_mapper
from .. import exc as sa_exc
from .. import inspection
from .. import util
from ..sql import roles
from ..sql.elements import SQLColumnExpression
from ..sql.elements import SQLCoreOperations
from ..util import FastIntFlag
from ..util.langhelpers import TypingOnly
from ..util.typing import Literal

if typing.TYPE_CHECKING:
    from ._typing import _EntityType
    from ._typing import _ExternalEntityType
    from ._typing import _InternalEntityType
    from .attributes import InstrumentedAttribute
    from .dynamic import AppenderQuery
    from .instrumentation import ClassManager
    from .interfaces import PropComparator
    from .mapper import Mapper
    from .state import InstanceState
    from .util import AliasedClass
    from .writeonly import WriteOnlyCollection
    from ..sql._typing import _ColumnExpressionArgument
    from ..sql._typing import _InfoType
    from ..sql.elements import ColumnElement
    from ..sql.operators import OperatorType

_T = TypeVar("_T", bound=Any)
_T_co = TypeVar("_T_co", bound=Any, covariant=True)

_O = TypeVar("_O", bound=object)


class LoaderCallableStatus(Enum):
    PASSIVE_NO_RESULT = 0
    """Symbol returned by a loader callable or other attribute/history
    retrieval operation when a value could not be determined, based
    on loader callable flags.
    """

    PASSIVE_CLASS_MISMATCH = 1
    """Symbol indicating that an object is locally present for a given
    primary key identity but it is not of the requested class.  The
    return value is therefore None and no SQL should be emitted."""

    ATTR_WAS_SET = 2
    """Symbol returned by a loader callable to indicate the
    retrieved value, or values, were assigned to their attributes
    on the target object.
    """

    ATTR_EMPTY = 3
    """Symbol used internally to indicate an attribute had no callable."""

    NO_VALUE = 4
    """Symbol which may be placed as the 'previous' value of an attribute,
    indicating no value was loaded for an attribute when it was modified,
    and flags indicated we were not to load it.
    """

    NEVER_SET = NO_VALUE
    """
    Synonymous with NO_VALUE

    .. versionchanged:: 1.4   NEVER_SET was merged with NO_VALUE

    """


(
    PASSIVE_NO_RESULT,
    PASSIVE_CLASS_MISMATCH,
    ATTR_WAS_SET,
    ATTR_EMPTY,
    NO_VALUE,
) = tuple(LoaderCallableStatus)

NEVER_SET = NO_VALUE


class PassiveFlag(FastIntFlag):
    """Bitflag interface that passes options onto loader callables"""

    NO_CHANGE = 0
    """No callables or SQL should be emitted on attribute access
    and no state should change
    """

    CALLABLES_OK = 1
    """Loader callables can be fired off if a value
    is not present.
    """

    SQL_OK = 2
    """Loader callables can emit SQL at least on scalar value attributes."""

    RELATED_OBJECT_OK = 4
    """Callables can use SQL to load related objects as well
    as scalar value attributes.
    """

    INIT_OK = 8
    """Attributes should be initialized with a blank
    value (None or an empty collection) upon get, if no other
    value can be obtained.
    """

    NON_PERSISTENT_OK = 16
    """Callables can be emitted if the parent is not persistent."""

    LOAD_AGAINST_COMMITTED = 32
    """Callables should use committed values as primary/foreign keys during a
    load.
    """

    NO_AUTOFLUSH = 64
    """Loader callables should disable autoflush.""",

    NO_RAISE = 128
    """Loader callables should not raise any assertions"""

    DEFERRED_HISTORY_LOAD = 256
    """indicates special load of the previous value of an attribute"""

    INCLUDE_PENDING_MUTATIONS = 512

    # pre-packaged sets of flags used as inputs
    PASSIVE_OFF = (
        RELATED_OBJECT_OK | NON_PERSISTENT_OK | INIT_OK | CALLABLES_OK | SQL_OK
    )
    "Callables can be emitted in all cases."

    PASSIVE_RETURN_NO_VALUE = PASSIVE_OFF ^ INIT_OK
    """PASSIVE_OFF ^ INIT_OK"""

    PASSIVE_NO_INITIALIZE = PASSIVE_RETURN_NO_VALUE ^ CALLABLES_OK
    "PASSIVE_RETURN_NO_VALUE ^ CALLABLES_OK"

    PASSIVE_NO_FETCH = PASSIVE_OFF ^ SQL_OK
    "PASSIVE_OFF ^ SQL_OK"

    PASSIVE_NO_FETCH_RELATED = PASSIVE_OFF ^ RELATED_OBJECT_OK
    "PASSIVE_OFF ^ RELATED_OBJECT_OK"

    PASSIVE_ONLY_PERSISTENT = PASSIVE_OFF ^ NON_PERSISTENT_OK
    "PASSIVE_OFF ^ NON_PERSISTENT_OK"

    PASSIVE_MERGE = PASSIVE_OFF | NO_RAISE
    """PASSIVE_OFF | NO_RAISE

    Symbol used specifically for session.merge() and similar cases

    """


(
    NO_CHANGE,
    CALLABLES_OK,
    SQL_OK,
    RELATED_OBJECT_OK,
    INIT_OK,
    NON_PERSISTENT_OK,
    LOAD_AGAINST_COMMITTED,
    NO_AUTOFLUSH,
    NO_RAISE,
    DEFERRED_HISTORY_LOAD,
    INCLUDE_PENDING_MUTATIONS,
    PASSIVE_OFF,
    PASSIVE_RETURN_NO_VALUE,
    PASSIVE_NO_INITIALIZE,
    PASSIVE_NO_FETCH,
    PASSIVE_NO_FETCH_RELATED,
    PASSIVE_ONLY_PERSISTENT,
    PASSIVE_MERGE,
) = PassiveFlag.__members__.values()

DEFAULT_MANAGER_ATTR = "_sa_class_manager"
DEFAULT_STATE_ATTR = "_sa_instance_state"


class EventConstants(Enum):
    EXT_CONTINUE = 1
    EXT_STOP = 2
    EXT_SKIP = 3
    NO_KEY = 4
    """indicates an :class:`.AttributeEvent` event that did not have any
    key argument.

    .. versionadded:: 2.0

    """


EXT_CONTINUE, EXT_STOP, EXT_SKIP, NO_KEY = tuple(EventConstants)


class RelationshipDirection(Enum):
    """enumeration which indicates the 'direction' of a
    :class:`_orm.RelationshipProperty`.

    :class:`.RelationshipDirection` is accessible from the
    :attr:`_orm.Relationship.direction` attribute of
    :class:`_orm.RelationshipProperty`.

    """

    ONETOMANY = 1
    """Indicates the one-to-many direction for a :func:`_orm.relationship`.

    This symbol is typically used by the internals but may be exposed within
    certain API features.

    """

    MANYTOONE = 2
    """Indicates the many-to-one direction for a :func:`_orm.relationship`.

    This symbol is typically used by the internals but may be exposed within
    certain API features.

    """

    MANYTOMANY = 3
    """Indicates the many-to-many direction for a :func:`_orm.relationship`.

    This symbol is typically used by the internals but may be exposed within
    certain API features.

    """


ONETOMANY, MANYTOONE, MANYTOMANY = tuple(RelationshipDirection)


class InspectionAttrExtensionType(Enum):
    """Symbols indicating the type of extension that a
    :class:`.InspectionAttr` is part of."""


class NotExtension(InspectionAttrExtensionType):
    NOT_EXTENSION = "not_extension"
    """Symbol indicating an :class:`InspectionAttr` that's
    not part of sqlalchemy.ext.

    Is assigned to the :attr:`.InspectionAttr.extension_type`
    attribute.

    """


_never_set = frozenset([NEVER_SET])

_none_set = frozenset([None, NEVER_SET, PASSIVE_NO_RESULT])

_SET_DEFERRED_EXPIRED = util.symbol("SET_DEFERRED_EXPIRED")

_DEFER_FOR_STATE = util.symbol("DEFER_FOR_STATE")

_RAISE_FOR_STATE = util.symbol("RAISE_FOR_STATE")


_F = TypeVar("_F", bound=Callable[..., Any])
_Self = TypeVar("_Self")


def _assertions(
    *assertions: Any,
) -> Callable[[_F], _F]:
    @util.decorator
    def generate(fn: _F, self: _Self, *args: Any, **kw: Any) -> _Self:
        for assertion in assertions:
            assertion(self, fn.__name__)
        fn(self, *args, **kw)
        return self

    return generate


if TYPE_CHECKING:

    def manager_of_class(cls: Type[_O]) -> ClassManager[_O]:
        ...

    @overload
    def opt_manager_of_class(cls: AliasedClass[Any]) -> None:
        ...

    @overload
    def opt_manager_of_class(
        cls: _ExternalEntityType[_O],
    ) -> Optional[ClassManager[_O]]:
        ...

    def opt_manager_of_class(
        cls: _ExternalEntityType[_O],
    ) -> Optional[ClassManager[_O]]:
        ...

    def instance_state(instance: _O) -> InstanceState[_O]:
        ...

    def instance_dict(instance: object) -> Dict[str, Any]:
        ...

else:
    # these can be replaced by sqlalchemy.ext.instrumentation
    # if augmented class instrumentation is enabled.

    def manager_of_class(cls):
        try:
            return cls.__dict__[DEFAULT_MANAGER_ATTR]
        except KeyError as ke:
            raise exc.UnmappedClassError(
                cls, f"Can't locate an instrumentation manager for class {cls}"
            ) from ke

    def opt_manager_of_class(cls):
        return cls.__dict__.get(DEFAULT_MANAGER_ATTR)

    instance_state = operator.attrgetter(DEFAULT_STATE_ATTR)

    instance_dict = operator.attrgetter("__dict__")


def instance_str(instance: object) -> str:
    """Return a string describing an instance."""

    return state_str(instance_state(instance))


def state_str(state: InstanceState[Any]) -> str:
    """Return a string describing an instance via its InstanceState."""

    if state is None:
        return "None"
    else:
        return "<%s at 0x%x>" % (state.class_.__name__, id(state.obj()))


def state_class_str(state: InstanceState[Any]) -> str:
    """Return a string describing an instance's class via its
    InstanceState.
    """

    if state is None:
        return "None"
    else:
        return "<%s>" % (state.class_.__name__,)


def attribute_str(instance: object, attribute: str) -> str:
    return instance_str(instance) + "." + attribute


def state_attribute_str(state: InstanceState[Any], attribute: str) -> str:
    return state_str(state) + "." + attribute


def object_mapper(instance: _T) -> Mapper[_T]:
    """Given an object, return the primary Mapper associated with the object
    instance.

    Raises :class:`sqlalchemy.orm.exc.UnmappedInstanceError`
    if no mapping is configured.

    This function is available via the inspection system as::

        inspect(instance).mapper

    Using the inspection system will raise
    :class:`sqlalchemy.exc.NoInspectionAvailable` if the instance is
    not part of a mapping.

    """
    return object_state(instance).mapper


def object_state(instance: _T) -> InstanceState[_T]:
    """Given an object, return the :class:`.InstanceState`
    associated with the object.

    Raises :class:`sqlalchemy.orm.exc.UnmappedInstanceError`
    if no mapping is configured.

    Equivalent functionality is available via the :func:`_sa.inspect`
    function as::

        inspect(instance)

    Using the inspection system will raise
    :class:`sqlalchemy.exc.NoInspectionAvailable` if the instance is
    not part of a mapping.

    """
    state = _inspect_mapped_object(instance)
    if state is None:
        raise exc.UnmappedInstanceError(instance)
    else:
        return state


@inspection._inspects(object)
def _inspect_mapped_object(instance: _T) -> Optional[InstanceState[_T]]:
    try:
        return instance_state(instance)
    except (exc.UnmappedClassError,) + exc.NO_STATE:
        return None


def _class_to_mapper(
    class_or_mapper: Union[Mapper[_T], Type[_T]]
) -> Mapper[_T]:
    # can't get mypy to see an overload for this
    insp = inspection.inspect(class_or_mapper, False)
    if insp is not None:
        return insp.mapper  # type: ignore
    else:
        assert isinstance(class_or_mapper, type)
        raise exc.UnmappedClassError(class_or_mapper)


def _mapper_or_none(
    entity: Union[Type[_T], _InternalEntityType[_T]]
) -> Optional[Mapper[_T]]:
    """Return the :class:`_orm.Mapper` for the given class or None if the
    class is not mapped.
    """

    # can't get mypy to see an overload for this
    insp = inspection.inspect(entity, False)
    if insp is not None:
        return insp.mapper  # type: ignore
    else:
        return None


def _is_mapped_class(entity: Any) -> bool:
    """Return True if the given object is a mapped class,
    :class:`_orm.Mapper`, or :class:`.AliasedClass`.
    """

    insp = inspection.inspect(entity, False)
    return (
        insp is not None
        and not insp.is_clause_element
        and (insp.is_mapper or insp.is_aliased_class)
    )


def _is_aliased_class(entity: Any) -> bool:
    insp = inspection.inspect(entity, False)
    return insp is not None and getattr(insp, "is_aliased_class", False)


@no_type_check
def _entity_descriptor(entity: _EntityType[Any], key: str) -> Any:
    """Return a class attribute given an entity and string name.

    May return :class:`.InstrumentedAttribute` or user-defined
    attribute.

    """
    insp = inspection.inspect(entity)
    if insp.is_selectable:
        description = entity
        entity = insp.c
    elif insp.is_aliased_class:
        entity = insp.entity
        description = entity
    elif hasattr(insp, "mapper"):
        description = entity = insp.mapper.class_
    else:
        description = entity

    try:
        return getattr(entity, key)
    except AttributeError as err:
        raise sa_exc.InvalidRequestError(
            "Entity '%s' has no property '%s'" % (description, key)
        ) from err


if TYPE_CHECKING:

    def _state_mapper(state: InstanceState[_O]) -> Mapper[_O]:
        ...

else:
    _state_mapper = util.dottedgetter("manager.mapper")


def _inspect_mapped_class(
    class_: Type[_O], configure: bool = False
) -> Optional[Mapper[_O]]:
    try:
        class_manager = opt_manager_of_class(class_)
        if class_manager is None or not class_manager.is_mapped:
            return None
        mapper = class_manager.mapper
    except exc.NO_STATE:
        return None
    else:
        if configure:
            mapper._check_configure()
        return mapper


def _parse_mapper_argument(arg: Union[Mapper[_O], Type[_O]]) -> Mapper[_O]:
    insp = inspection.inspect(arg, raiseerr=False)
    if insp_is_mapper(insp):
        return insp

    raise sa_exc.ArgumentError(f"Mapper or mapped class expected, got {arg!r}")


def class_mapper(class_: Type[_O], configure: bool = True) -> Mapper[_O]:
    """Given a class, return the primary :class:`_orm.Mapper` associated
    with the key.

    Raises :exc:`.UnmappedClassError` if no mapping is configured
    on the given class, or :exc:`.ArgumentError` if a non-class
    object is passed.

    Equivalent functionality is available via the :func:`_sa.inspect`
    function as::

        inspect(some_mapped_class)

    Using the inspection system will raise
    :class:`sqlalchemy.exc.NoInspectionAvailable` if the class is not mapped.

    """
    mapper = _inspect_mapped_class(class_, configure=configure)
    if mapper is None:
        if not isinstance(class_, type):
            raise sa_exc.ArgumentError(
                "Class object expected, got '%r'." % (class_,)
            )
        raise exc.UnmappedClassError(class_)
    else:
        return mapper


class InspectionAttr:
    """A base class applied to all ORM objects and attributes that are
    related to things that can be returned by the :func:`_sa.inspect` function.

    The attributes defined here allow the usage of simple boolean
    checks to test basic facts about the object returned.

    While the boolean checks here are basically the same as using
    the Python isinstance() function, the flags here can be used without
    the need to import all of these classes, and also such that
    the SQLAlchemy class system can change while leaving the flags
    here intact for forwards-compatibility.

    """

    __slots__ = ()

    is_selectable = False
    """Return True if this object is an instance of
    :class:`_expression.Selectable`."""

    is_aliased_class = False
    """True if this object is an instance of :class:`.AliasedClass`."""

    is_instance = False
    """True if this object is an instance of :class:`.InstanceState`."""

    is_mapper = False
    """True if this object is an instance of :class:`_orm.Mapper`."""

    is_bundle = False
    """True if this object is an instance of :class:`.Bundle`."""

    is_property = False
    """True if this object is an instance of :class:`.MapperProperty`."""

    is_attribute = False
    """True if this object is a Python :term:`descriptor`.

    This can refer to one of many types.   Usually a
    :class:`.QueryableAttribute` which handles attributes events on behalf
    of a :class:`.MapperProperty`.   But can also be an extension type
    such as :class:`.AssociationProxy` or :class:`.hybrid_property`.
    The :attr:`.InspectionAttr.extension_type` will refer to a constant
    identifying the specific subtype.

    .. seealso::

        :attr:`_orm.Mapper.all_orm_descriptors`

    """

    _is_internal_proxy = False
    """True if this object is an internal proxy object.

    .. versionadded:: 1.2.12

    """

    is_clause_element = False
    """True if this object is an instance of
    :class:`_expression.ClauseElement`."""

    extension_type: InspectionAttrExtensionType = NotExtension.NOT_EXTENSION
    """The extension type, if any.
    Defaults to :attr:`.interfaces.NotExtension.NOT_EXTENSION`

    .. seealso::

        :class:`.HybridExtensionType`

        :class:`.AssociationProxyExtensionType`

    """


class InspectionAttrInfo(InspectionAttr):
    """Adds the ``.info`` attribute to :class:`.InspectionAttr`.

    The rationale for :class:`.InspectionAttr` vs. :class:`.InspectionAttrInfo`
    is that the former is compatible as a mixin for classes that specify
    ``__slots__``; this is essentially an implementation artifact.

    """

    __slots__ = ()

    @util.ro_memoized_property
    def info(self) -> _InfoType:
        """Info dictionary associated with the object, allowing user-defined
        data to be associated with this :class:`.InspectionAttr`.

        The dictionary is generated when first accessed.  Alternatively,
        it can be specified as a constructor argument to the
        :func:`.column_property`, :func:`_orm.relationship`, or
        :func:`.composite`
        functions.

        .. seealso::

            :attr:`.QueryableAttribute.info`

            :attr:`.SchemaItem.info`

        """
        return {}


class SQLORMOperations(SQLCoreOperations[_T_co], TypingOnly):
    __slots__ = ()

    if typing.TYPE_CHECKING:

        def of_type(self, class_: _EntityType[Any]) -> PropComparator[_T_co]:
            ...

        def and_(
            self, *criteria: _ColumnExpressionArgument[bool]
        ) -> PropComparator[bool]:
            ...

        def any(  # noqa: A001
            self,
            criterion: Optional[_ColumnExpressionArgument[bool]] = None,
            **kwargs: Any,
        ) -> ColumnElement[bool]:
            ...

        def has(
            self,
            criterion: Optional[_ColumnExpressionArgument[bool]] = None,
            **kwargs: Any,
        ) -> ColumnElement[bool]:
            ...


class ORMDescriptor(Generic[_T_co], TypingOnly):
    """Represent any Python descriptor that provides a SQL expression
    construct at the class level."""

    __slots__ = ()

    if typing.TYPE_CHECKING:

        @overload
        def __get__(
            self, instance: Any, owner: Literal[None]
        ) -> ORMDescriptor[_T_co]:
            ...

        @overload
        def __get__(
            self, instance: Literal[None], owner: Any
        ) -> SQLCoreOperations[_T_co]:
            ...

        @overload
        def __get__(self, instance: object, owner: Any) -> _T_co:
            ...

        def __get__(
            self, instance: object, owner: Any
        ) -> Union[ORMDescriptor[_T_co], SQLCoreOperations[_T_co], _T_co]:
            ...


class _MappedAnnotationBase(Generic[_T_co], TypingOnly):
    """common class for Mapped and similar ORM container classes.

    these are classes that can appear on the left side of an ORM declarative
    mapping, containing a mapped class or in some cases a collection
    surrounding a mapped class.

    """

    __slots__ = ()


class SQLORMExpression(
    SQLORMOperations[_T_co], SQLColumnExpression[_T_co], TypingOnly
):
    """A type that may be used to indicate any ORM-level attribute or
    object that acts in place of one, in the context of SQL expression
    construction.

    :class:`.SQLORMExpression` extends from the Core
    :class:`.SQLColumnExpression` to add additional SQL methods that are ORM
    specific, such as :meth:`.PropComparator.of_type`, and is part of the bases
    for :class:`.InstrumentedAttribute`. It may be used in :pep:`484` typing to
    indicate arguments or return values that should behave as ORM-level
    attribute expressions.

    .. versionadded:: 2.0.0b4


    """

    __slots__ = ()


class Mapped(
    SQLORMExpression[_T_co],
    ORMDescriptor[_T_co],
    _MappedAnnotationBase[_T_co],
    roles.DDLConstraintColumnRole,
):
    """Represent an ORM mapped attribute on a mapped class.

    This class represents the complete descriptor interface for any class
    attribute that will have been :term:`instrumented` by the ORM
    :class:`_orm.Mapper` class.   Provides appropriate information to type
    checkers such as pylance and mypy so that ORM-mapped attributes
    are correctly typed.

    The most prominent use of :class:`_orm.Mapped` is in
    the :ref:`Declarative Mapping <orm_explicit_declarative_base>` form
    of :class:`_orm.Mapper` configuration, where used explicitly it drives
    the configuration of ORM attributes such as :func:`_orm.mapped_class`
    and :func:`_orm.relationship`.

    .. seealso::

        :ref:`orm_explicit_declarative_base`

        :ref:`orm_declarative_table`

    .. tip::

        The :class:`_orm.Mapped` class represents attributes that are handled
        directly by the :class:`_orm.Mapper` class. It does not include other
        Python descriptor classes that are provided as extensions, including
        :ref:`hybrids_toplevel` and the :ref:`associationproxy_toplevel`.
        While these systems still make use of ORM-specific superclasses
        and structures, they are not :term:`instrumented` by the
        :class:`_orm.Mapper` and instead provide their own functionality
        when they are accessed on a class.

    .. versionadded:: 1.4


    """

    __slots__ = ()

    if typing.TYPE_CHECKING:

        @overload
        def __get__(
            self, instance: None, owner: Any
        ) -> InstrumentedAttribute[_T_co]:
            ...

        @overload
        def __get__(self, instance: object, owner: Any) -> _T_co:
            ...

        def __get__(
            self, instance: Optional[object], owner: Any
        ) -> Union[InstrumentedAttribute[_T_co], _T_co]:
            ...

        @classmethod
        def _empty_constructor(cls, arg1: Any) -> Mapped[_T_co]:
            ...

        def __set__(
            self, instance: Any, value: Union[SQLCoreOperations[_T_co], _T_co]
        ) -> None:
            ...

        def __delete__(self, instance: Any) -> None:
            ...


class _MappedAttribute(Generic[_T_co], TypingOnly):
    """Mixin for attributes which should be replaced by mapper-assigned
    attributes.

    """

    __slots__ = ()


class _DeclarativeMapped(Mapped[_T_co], _MappedAttribute[_T_co]):
    """Mixin for :class:`.MapperProperty` subclasses that allows them to
    be compatible with ORM-annotated declarative mappings.

    """

    __slots__ = ()

    # MappedSQLExpression, Relationship, Composite etc. dont actually do
    # SQL expression behavior.  yet there is code that compares them with
    # __eq__(), __ne__(), etc.   Since #8847 made Mapped even more full
    # featured including ColumnOperators, we need to have those methods
    # be no-ops for these objects, so return NotImplemented to fall back
    # to normal comparison behavior.
    def operate(self, op: OperatorType, *other: Any, **kwargs: Any) -> Any:
        return NotImplemented

    __sa_operate__ = operate

    def reverse_operate(
        self, op: OperatorType, other: Any, **kwargs: Any
    ) -> Any:
        return NotImplemented


class DynamicMapped(_MappedAnnotationBase[_T_co]):
    """Represent the ORM mapped attribute type for a "dynamic" relationship.

    The :class:`_orm.DynamicMapped` type annotation may be used in an
    :ref:`Annotated Declarative Table <orm_declarative_mapped_column>` mapping
    to indicate that the ``lazy="dynamic"`` loader strategy should be used
    for a particular :func:`_orm.relationship`.

    .. legacy::  The "dynamic" lazy loader strategy is the legacy form of what
       is now the "write_only" strategy described in the section
       :ref:`write_only_relationship`.

    E.g.::

        class User(Base):
            __tablename__ = "user"
            id: Mapped[int] = mapped_column(primary_key=True)
            addresses: DynamicMapped[Address] = relationship(
                cascade="all,delete-orphan"
            )

    See the section :ref:`dynamic_relationship` for background.

    .. versionadded:: 2.0

    .. seealso::

        :ref:`dynamic_relationship` - complete background

        :class:`.WriteOnlyMapped` - fully 2.0 style version

    """

    __slots__ = ()

    if TYPE_CHECKING:

        @overload
        def __get__(
            self, instance: None, owner: Any
        ) -> InstrumentedAttribute[_T_co]:
            ...

        @overload
        def __get__(
            self, instance: object, owner: Any
        ) -> AppenderQuery[_T_co]:
            ...

        def __get__(
            self, instance: Optional[object], owner: Any
        ) -> Union[InstrumentedAttribute[_T_co], AppenderQuery[_T_co]]:
            ...

        def __set__(
            self, instance: Any, value: typing.Collection[_T_co]
        ) -> None:
            ...


class WriteOnlyMapped(_MappedAnnotationBase[_T_co]):
    """Represent the ORM mapped attribute type for a "write only" relationship.

    The :class:`_orm.WriteOnlyMapped` type annotation may be used in an
    :ref:`Annotated Declarative Table <orm_declarative_mapped_column>` mapping
    to indicate that the ``lazy="write_only"`` loader strategy should be used
    for a particular :func:`_orm.relationship`.

    E.g.::

        class User(Base):
            __tablename__ = "user"
            id: Mapped[int] = mapped_column(primary_key=True)
            addresses: WriteOnlyMapped[Address] = relationship(
                cascade="all,delete-orphan"
            )

    See the section :ref:`write_only_relationship` for background.

    .. versionadded:: 2.0

    .. seealso::

        :ref:`write_only_relationship` - complete background

        :class:`.DynamicMapped` - includes legacy :class:`_orm.Query` support

    """

    __slots__ = ()

    if TYPE_CHECKING:

        @overload
        def __get__(
            self, instance: None, owner: Any
        ) -> InstrumentedAttribute[_T_co]:
            ...

        @overload
        def __get__(
            self, instance: object, owner: Any
        ) -> WriteOnlyCollection[_T_co]:
            ...

        def __get__(
            self, instance: Optional[object], owner: Any
        ) -> Union[InstrumentedAttribute[_T_co], WriteOnlyCollection[_T_co]]:
            ...

        def __set__(
            self, instance: Any, value: typing.Collection[_T_co]
        ) -> None:
            ...
