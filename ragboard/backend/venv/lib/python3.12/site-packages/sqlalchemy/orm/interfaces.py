# orm/interfaces.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""

Contains various base classes used throughout the ORM.

Defines some key base classes prominent within the internals.

This module and the classes within are mostly private, though some attributes
are exposed when inspecting mappings.

"""

from __future__ import annotations

import collections
import dataclasses
import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import ClassVar
from typing import Dict
from typing import Generic
from typing import Iterator
from typing import List
from typing import NamedTuple
from typing import NoReturn
from typing import Optional
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import exc as orm_exc
from . import path_registry
from .base import _MappedAttribute as _MappedAttribute
from .base import EXT_CONTINUE as EXT_CONTINUE  # noqa: F401
from .base import EXT_SKIP as EXT_SKIP  # noqa: F401
from .base import EXT_STOP as EXT_STOP  # noqa: F401
from .base import InspectionAttr as InspectionAttr  # noqa: F401
from .base import InspectionAttrInfo as InspectionAttrInfo
from .base import MANYTOMANY as MANYTOMANY  # noqa: F401
from .base import MANYTOONE as MANYTOONE  # noqa: F401
from .base import NO_KEY as NO_KEY  # noqa: F401
from .base import NO_VALUE as NO_VALUE  # noqa: F401
from .base import NotExtension as NotExtension  # noqa: F401
from .base import ONETOMANY as ONETOMANY  # noqa: F401
from .base import RelationshipDirection as RelationshipDirection  # noqa: F401
from .base import SQLORMOperations
from .. import ColumnElement
from .. import exc as sa_exc
from .. import inspection
from .. import util
from ..sql import operators
from ..sql import roles
from ..sql import visitors
from ..sql.base import _NoArg
from ..sql.base import ExecutableOption
from ..sql.cache_key import HasCacheKey
from ..sql.operators import ColumnOperators
from ..sql.schema import Column
from ..sql.type_api import TypeEngine
from ..util import warn_deprecated
from ..util.typing import RODescriptorReference
from ..util.typing import TypedDict

if typing.TYPE_CHECKING:
    from ._typing import _EntityType
    from ._typing import _IdentityKeyType
    from ._typing import _InstanceDict
    from ._typing import _InternalEntityType
    from ._typing import _ORMAdapterProto
    from .attributes import InstrumentedAttribute
    from .base import Mapped
    from .context import _MapperEntity
    from .context import ORMCompileState
    from .context import QueryContext
    from .decl_api import RegistryType
    from .decl_base import _ClassScanMapperConfig
    from .loading import _PopulatorDict
    from .mapper import Mapper
    from .path_registry import AbstractEntityRegistry
    from .query import Query
    from .session import Session
    from .state import InstanceState
    from .strategy_options import _LoadElement
    from .util import AliasedInsp
    from .util import ORMAdapter
    from ..engine.result import Result
    from ..sql._typing import _ColumnExpressionArgument
    from ..sql._typing import _ColumnsClauseArgument
    from ..sql._typing import _DMLColumnArgument
    from ..sql._typing import _InfoType
    from ..sql.operators import OperatorType
    from ..sql.visitors import _TraverseInternalsType
    from ..util.typing import _AnnotationScanType

_StrategyKey = Tuple[Any, ...]

_T = TypeVar("_T", bound=Any)
_T_co = TypeVar("_T_co", bound=Any, covariant=True)

_TLS = TypeVar("_TLS", bound="Type[LoaderStrategy]")


class ORMStatementRole(roles.StatementRole):
    __slots__ = ()
    _role_name = (
        "Executable SQL or text() construct, including ORM " "aware objects"
    )


class ORMColumnsClauseRole(
    roles.ColumnsClauseRole, roles.TypedColumnsClauseRole[_T]
):
    __slots__ = ()
    _role_name = "ORM mapped entity, aliased entity, or Column expression"


class ORMEntityColumnsClauseRole(ORMColumnsClauseRole[_T]):
    __slots__ = ()
    _role_name = "ORM mapped or aliased entity"


class ORMFromClauseRole(roles.StrictFromClauseRole):
    __slots__ = ()
    _role_name = "ORM mapped entity, aliased entity, or FROM expression"


class ORMColumnDescription(TypedDict):
    name: str
    # TODO: add python_type and sql_type here; combining them
    # into "type" is a bad idea
    type: Union[Type[Any], TypeEngine[Any]]
    aliased: bool
    expr: _ColumnsClauseArgument[Any]
    entity: Optional[_ColumnsClauseArgument[Any]]


class _IntrospectsAnnotations:
    __slots__ = ()

    def found_in_pep593_annotated(self) -> Any:
        """return a copy of this object to use in declarative when the
        object is found inside of an Annotated object."""

        raise NotImplementedError(
            f"Use of the {self.__class__} construct inside of an "
            f"Annotated object is not yet supported."
        )

    def declarative_scan(
        self,
        decl_scan: _ClassScanMapperConfig,
        registry: RegistryType,
        cls: Type[Any],
        originating_module: Optional[str],
        key: str,
        mapped_container: Optional[Type[Mapped[Any]]],
        annotation: Optional[_AnnotationScanType],
        extracted_mapped_annotation: Optional[_AnnotationScanType],
        is_dataclass_field: bool,
    ) -> None:
        """Perform class-specific initializaton at early declarative scanning
        time.

        .. versionadded:: 2.0

        """

    def _raise_for_required(self, key: str, cls: Type[Any]) -> NoReturn:
        raise sa_exc.ArgumentError(
            f"Python typing annotation is required for attribute "
            f'"{cls.__name__}.{key}" when primary argument(s) for '
            f'"{self.__class__.__name__}" construct are None or not present'
        )


class _AttributeOptions(NamedTuple):
    """define Python-local attribute behavior options common to all
    :class:`.MapperProperty` objects.

    Currently this includes dataclass-generation arguments.

    .. versionadded:: 2.0

    """

    dataclasses_init: Union[_NoArg, bool]
    dataclasses_repr: Union[_NoArg, bool]
    dataclasses_default: Union[_NoArg, Any]
    dataclasses_default_factory: Union[_NoArg, Callable[[], Any]]
    dataclasses_compare: Union[_NoArg, bool]
    dataclasses_kw_only: Union[_NoArg, bool]

    def _as_dataclass_field(self, key: str) -> Any:
        """Return a ``dataclasses.Field`` object given these arguments."""

        kw: Dict[str, Any] = {}
        if self.dataclasses_default_factory is not _NoArg.NO_ARG:
            kw["default_factory"] = self.dataclasses_default_factory
        if self.dataclasses_default is not _NoArg.NO_ARG:
            kw["default"] = self.dataclasses_default
        if self.dataclasses_init is not _NoArg.NO_ARG:
            kw["init"] = self.dataclasses_init
        if self.dataclasses_repr is not _NoArg.NO_ARG:
            kw["repr"] = self.dataclasses_repr
        if self.dataclasses_compare is not _NoArg.NO_ARG:
            kw["compare"] = self.dataclasses_compare
        if self.dataclasses_kw_only is not _NoArg.NO_ARG:
            kw["kw_only"] = self.dataclasses_kw_only

        if "default" in kw and callable(kw["default"]):
            # callable defaults are ambiguous. deprecate them in favour of
            # insert_default or default_factory. #9936
            warn_deprecated(
                f"Callable object passed to the ``default`` parameter for "
                f"attribute {key!r} in a ORM-mapped Dataclasses context is "
                "ambiguous, "
                "and this use will raise an error in a future release.  "
                "If this callable is intended to produce Core level INSERT "
                "default values for an underlying ``Column``, use "
                "the ``mapped_column.insert_default`` parameter instead.  "
                "To establish this callable as providing a default value "
                "for instances of the dataclass itself, use the "
                "``default_factory`` dataclasses parameter.",
                "2.0",
            )

        if (
            "init" in kw
            and not kw["init"]
            and "default" in kw
            and not callable(kw["default"])  # ignore callable defaults. #9936
            and "default_factory" not in kw  # illegal but let dc.field raise
        ):
            # fix for #9879
            default = kw.pop("default")
            kw["default_factory"] = lambda: default

        return dataclasses.field(**kw)

    @classmethod
    def _get_arguments_for_make_dataclass(
        cls,
        key: str,
        annotation: _AnnotationScanType,
        mapped_container: Optional[Any],
        elem: _T,
    ) -> Union[
        Tuple[str, _AnnotationScanType],
        Tuple[str, _AnnotationScanType, dataclasses.Field[Any]],
    ]:
        """given attribute key, annotation, and value from a class, return
        the argument tuple we would pass to dataclasses.make_dataclass()
        for this attribute.

        """
        if isinstance(elem, _DCAttributeOptions):
            dc_field = elem._attribute_options._as_dataclass_field(key)

            return (key, annotation, dc_field)
        elif elem is not _NoArg.NO_ARG:
            # why is typing not erroring on this?
            return (key, annotation, elem)
        elif mapped_container is not None:
            # it's Mapped[], but there's no "element", which means declarative
            # did not actually do anything for this field.  this shouldn't
            # happen.
            # previously, this would occur because _scan_attributes would
            # skip a field that's on an already mapped superclass, but it
            # would still include it in the annotations, leading
            # to issue #8718

            assert False, "Mapped[] received without a mapping declaration"

        else:
            # plain dataclass field, not mapped.  Is only possible
            # if __allow_unmapped__ is set up.  I can see this mode causing
            # problems...
            return (key, annotation)


_DEFAULT_ATTRIBUTE_OPTIONS = _AttributeOptions(
    _NoArg.NO_ARG,
    _NoArg.NO_ARG,
    _NoArg.NO_ARG,
    _NoArg.NO_ARG,
    _NoArg.NO_ARG,
    _NoArg.NO_ARG,
)

_DEFAULT_READONLY_ATTRIBUTE_OPTIONS = _AttributeOptions(
    False,
    _NoArg.NO_ARG,
    _NoArg.NO_ARG,
    _NoArg.NO_ARG,
    _NoArg.NO_ARG,
    _NoArg.NO_ARG,
)


class _DCAttributeOptions:
    """mixin for descriptors or configurational objects that include dataclass
    field options.

    This includes :class:`.MapperProperty`, :class:`._MapsColumn` within
    the ORM, but also includes :class:`.AssociationProxy` within ext.
    Can in theory be used for other descriptors that serve a similar role
    as association proxy.   (*maybe* hybrids, not sure yet.)

    """

    __slots__ = ()

    _attribute_options: _AttributeOptions
    """behavioral options for ORM-enabled Python attributes

    .. versionadded:: 2.0

    """

    _has_dataclass_arguments: bool


class _MapsColumns(_DCAttributeOptions, _MappedAttribute[_T]):
    """interface for declarative-capable construct that delivers one or more
    Column objects to the declarative process to be part of a Table.
    """

    __slots__ = ()

    @property
    def mapper_property_to_assign(self) -> Optional[MapperProperty[_T]]:
        """return a MapperProperty to be assigned to the declarative mapping"""
        raise NotImplementedError()

    @property
    def columns_to_assign(self) -> List[Tuple[Column[_T], int]]:
        """A list of Column objects that should be declaratively added to the
        new Table object.

        """
        raise NotImplementedError()


# NOTE: MapperProperty needs to extend _MappedAttribute so that declarative
# typing works, i.e. "Mapped[A] = relationship()".   This introduces an
# inconvenience which is that all the MapperProperty objects are treated
# as descriptors by typing tools, which are misled by this as assignment /
# access to a descriptor attribute wants to move through __get__.
# Therefore, references to MapperProperty as an instance variable, such
# as in PropComparator, may have some special typing workarounds such as the
# use of sqlalchemy.util.typing.DescriptorReference to avoid mis-interpretation
# by typing tools
@inspection._self_inspects
class MapperProperty(
    HasCacheKey,
    _DCAttributeOptions,
    _MappedAttribute[_T],
    InspectionAttrInfo,
    util.MemoizedSlots,
):
    """Represent a particular class attribute mapped by :class:`_orm.Mapper`.

    The most common occurrences of :class:`.MapperProperty` are the
    mapped :class:`_schema.Column`, which is represented in a mapping as
    an instance of :class:`.ColumnProperty`,
    and a reference to another class produced by :func:`_orm.relationship`,
    represented in the mapping as an instance of
    :class:`.Relationship`.

    """

    __slots__ = (
        "_configure_started",
        "_configure_finished",
        "_attribute_options",
        "_has_dataclass_arguments",
        "parent",
        "key",
        "info",
        "doc",
    )

    _cache_key_traversal: _TraverseInternalsType = [
        ("parent", visitors.ExtendedInternalTraversal.dp_has_cache_key),
        ("key", visitors.ExtendedInternalTraversal.dp_string),
    ]

    if not TYPE_CHECKING:
        cascade = None

    is_property = True
    """Part of the InspectionAttr interface; states this object is a
    mapper property.

    """

    comparator: PropComparator[_T]
    """The :class:`_orm.PropComparator` instance that implements SQL
    expression construction on behalf of this mapped attribute."""

    key: str
    """name of class attribute"""

    parent: Mapper[Any]
    """the :class:`.Mapper` managing this property."""

    _is_relationship = False

    _links_to_entity: bool
    """True if this MapperProperty refers to a mapped entity.

    Should only be True for Relationship, False for all others.

    """

    doc: Optional[str]
    """optional documentation string"""

    info: _InfoType
    """Info dictionary associated with the object, allowing user-defined
    data to be associated with this :class:`.InspectionAttr`.

    The dictionary is generated when first accessed.  Alternatively,
    it can be specified as a constructor argument to the
    :func:`.column_property`, :func:`_orm.relationship`, or :func:`.composite`
    functions.

    .. seealso::

        :attr:`.QueryableAttribute.info`

        :attr:`.SchemaItem.info`

    """

    def _memoized_attr_info(self) -> _InfoType:
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

    def setup(
        self,
        context: ORMCompileState,
        query_entity: _MapperEntity,
        path: AbstractEntityRegistry,
        adapter: Optional[ORMAdapter],
        **kwargs: Any,
    ) -> None:
        """Called by Query for the purposes of constructing a SQL statement.

        Each MapperProperty associated with the target mapper processes the
        statement referenced by the query context, adding columns and/or
        criterion as appropriate.

        """

    def create_row_processor(
        self,
        context: ORMCompileState,
        query_entity: _MapperEntity,
        path: AbstractEntityRegistry,
        mapper: Mapper[Any],
        result: Result[Any],
        adapter: Optional[ORMAdapter],
        populators: _PopulatorDict,
    ) -> None:
        """Produce row processing functions and append to the given
        set of populators lists.

        """

    def cascade_iterator(
        self,
        type_: str,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        visited_states: Set[InstanceState[Any]],
        halt_on: Optional[Callable[[InstanceState[Any]], bool]] = None,
    ) -> Iterator[
        Tuple[object, Mapper[Any], InstanceState[Any], _InstanceDict]
    ]:
        """Iterate through instances related to the given instance for
        a particular 'cascade', starting with this MapperProperty.

        Return an iterator3-tuples (instance, mapper, state).

        Note that the 'cascade' collection on this MapperProperty is
        checked first for the given type before cascade_iterator is called.

        This method typically only applies to Relationship.

        """

        return iter(())

    def set_parent(self, parent: Mapper[Any], init: bool) -> None:
        """Set the parent mapper that references this MapperProperty.

        This method is overridden by some subclasses to perform extra
        setup when the mapper is first known.

        """
        self.parent = parent

    def instrument_class(self, mapper: Mapper[Any]) -> None:
        """Hook called by the Mapper to the property to initiate
        instrumentation of the class attribute managed by this
        MapperProperty.

        The MapperProperty here will typically call out to the
        attributes module to set up an InstrumentedAttribute.

        This step is the first of two steps to set up an InstrumentedAttribute,
        and is called early in the mapper setup process.

        The second step is typically the init_class_attribute step,
        called from StrategizedProperty via the post_instrument_class()
        hook.  This step assigns additional state to the InstrumentedAttribute
        (specifically the "impl") which has been determined after the
        MapperProperty has determined what kind of persistence
        management it needs to do (e.g. scalar, object, collection, etc).

        """

    def __init__(
        self,
        attribute_options: Optional[_AttributeOptions] = None,
        _assume_readonly_dc_attributes: bool = False,
    ) -> None:
        self._configure_started = False
        self._configure_finished = False

        if _assume_readonly_dc_attributes:
            default_attrs = _DEFAULT_READONLY_ATTRIBUTE_OPTIONS
        else:
            default_attrs = _DEFAULT_ATTRIBUTE_OPTIONS

        if attribute_options and attribute_options != default_attrs:
            self._has_dataclass_arguments = True
            self._attribute_options = attribute_options
        else:
            self._has_dataclass_arguments = False
            self._attribute_options = default_attrs

    def init(self) -> None:
        """Called after all mappers are created to assemble
        relationships between mappers and perform other post-mapper-creation
        initialization steps.


        """
        self._configure_started = True
        self.do_init()
        self._configure_finished = True

    @property
    def class_attribute(self) -> InstrumentedAttribute[_T]:
        """Return the class-bound descriptor corresponding to this
        :class:`.MapperProperty`.

        This is basically a ``getattr()`` call::

            return getattr(self.parent.class_, self.key)

        I.e. if this :class:`.MapperProperty` were named ``addresses``,
        and the class to which it is mapped is ``User``, this sequence
        is possible::

            >>> from sqlalchemy import inspect
            >>> mapper = inspect(User)
            >>> addresses_property = mapper.attrs.addresses
            >>> addresses_property.class_attribute is User.addresses
            True
            >>> User.addresses.property is addresses_property
            True


        """

        return getattr(self.parent.class_, self.key)  # type: ignore

    def do_init(self) -> None:
        """Perform subclass-specific initialization post-mapper-creation
        steps.

        This is a template method called by the ``MapperProperty``
        object's init() method.

        """

    def post_instrument_class(self, mapper: Mapper[Any]) -> None:
        """Perform instrumentation adjustments that need to occur
        after init() has completed.

        The given Mapper is the Mapper invoking the operation, which
        may not be the same Mapper as self.parent in an inheritance
        scenario; however, Mapper will always at least be a sub-mapper of
        self.parent.

        This method is typically used by StrategizedProperty, which delegates
        it to LoaderStrategy.init_class_attribute() to perform final setup
        on the class-bound InstrumentedAttribute.

        """

    def merge(
        self,
        session: Session,
        source_state: InstanceState[Any],
        source_dict: _InstanceDict,
        dest_state: InstanceState[Any],
        dest_dict: _InstanceDict,
        load: bool,
        _recursive: Dict[Any, object],
        _resolve_conflict_map: Dict[_IdentityKeyType[Any], object],
    ) -> None:
        """Merge the attribute represented by this ``MapperProperty``
        from source to destination object.

        """

    def __repr__(self) -> str:
        return "<%s at 0x%x; %s>" % (
            self.__class__.__name__,
            id(self),
            getattr(self, "key", "no key"),
        )


@inspection._self_inspects
class PropComparator(SQLORMOperations[_T_co], Generic[_T_co], ColumnOperators):
    r"""Defines SQL operations for ORM mapped attributes.

    SQLAlchemy allows for operators to
    be redefined at both the Core and ORM level.  :class:`.PropComparator`
    is the base class of operator redefinition for ORM-level operations,
    including those of :class:`.ColumnProperty`,
    :class:`.Relationship`, and :class:`.Composite`.

    User-defined subclasses of :class:`.PropComparator` may be created. The
    built-in Python comparison and math operator methods, such as
    :meth:`.operators.ColumnOperators.__eq__`,
    :meth:`.operators.ColumnOperators.__lt__`, and
    :meth:`.operators.ColumnOperators.__add__`, can be overridden to provide
    new operator behavior. The custom :class:`.PropComparator` is passed to
    the :class:`.MapperProperty` instance via the ``comparator_factory``
    argument. In each case,
    the appropriate subclass of :class:`.PropComparator` should be used::

        # definition of custom PropComparator subclasses

        from sqlalchemy.orm.properties import \
                                ColumnProperty,\
                                Composite,\
                                Relationship

        class MyColumnComparator(ColumnProperty.Comparator):
            def __eq__(self, other):
                return self.__clause_element__() == other

        class MyRelationshipComparator(Relationship.Comparator):
            def any(self, expression):
                "define the 'any' operation"
                # ...

        class MyCompositeComparator(Composite.Comparator):
            def __gt__(self, other):
                "redefine the 'greater than' operation"

                return sql.and_(*[a>b for a, b in
                                  zip(self.__clause_element__().clauses,
                                      other.__composite_values__())])


        # application of custom PropComparator subclasses

        from sqlalchemy.orm import column_property, relationship, composite
        from sqlalchemy import Column, String

        class SomeMappedClass(Base):
            some_column = column_property(Column("some_column", String),
                                comparator_factory=MyColumnComparator)

            some_relationship = relationship(SomeOtherClass,
                                comparator_factory=MyRelationshipComparator)

            some_composite = composite(
                    Column("a", String), Column("b", String),
                    comparator_factory=MyCompositeComparator
                )

    Note that for column-level operator redefinition, it's usually
    simpler to define the operators at the Core level, using the
    :attr:`.TypeEngine.comparator_factory` attribute.  See
    :ref:`types_operators` for more detail.

    .. seealso::

        :class:`.ColumnProperty.Comparator`

        :class:`.Relationship.Comparator`

        :class:`.Composite.Comparator`

        :class:`.ColumnOperators`

        :ref:`types_operators`

        :attr:`.TypeEngine.comparator_factory`

    """
    __slots__ = "prop", "_parententity", "_adapt_to_entity"

    __visit_name__ = "orm_prop_comparator"

    _parententity: _InternalEntityType[Any]
    _adapt_to_entity: Optional[AliasedInsp[Any]]
    prop: RODescriptorReference[MapperProperty[_T_co]]

    def __init__(
        self,
        prop: MapperProperty[_T],
        parentmapper: _InternalEntityType[Any],
        adapt_to_entity: Optional[AliasedInsp[Any]] = None,
    ):
        self.prop = prop
        self._parententity = adapt_to_entity or parentmapper
        self._adapt_to_entity = adapt_to_entity

    @util.non_memoized_property
    def property(self) -> MapperProperty[_T_co]:
        """Return the :class:`.MapperProperty` associated with this
        :class:`.PropComparator`.


        Return values here will commonly be instances of
        :class:`.ColumnProperty` or :class:`.Relationship`.


        """
        return self.prop

    def __clause_element__(self) -> roles.ColumnsClauseRole:
        raise NotImplementedError("%r" % self)

    def _bulk_update_tuples(
        self, value: Any
    ) -> Sequence[Tuple[_DMLColumnArgument, Any]]:
        """Receive a SQL expression that represents a value in the SET
        clause of an UPDATE statement.

        Return a tuple that can be passed to a :class:`_expression.Update`
        construct.

        """

        return [(cast("_DMLColumnArgument", self.__clause_element__()), value)]

    def adapt_to_entity(
        self, adapt_to_entity: AliasedInsp[Any]
    ) -> PropComparator[_T_co]:
        """Return a copy of this PropComparator which will use the given
        :class:`.AliasedInsp` to produce corresponding expressions.
        """
        return self.__class__(self.prop, self._parententity, adapt_to_entity)

    @util.ro_non_memoized_property
    def _parentmapper(self) -> Mapper[Any]:
        """legacy; this is renamed to _parententity to be
        compatible with QueryableAttribute."""
        return self._parententity.mapper

    def _criterion_exists(
        self,
        criterion: Optional[_ColumnExpressionArgument[bool]] = None,
        **kwargs: Any,
    ) -> ColumnElement[Any]:
        return self.prop.comparator._criterion_exists(criterion, **kwargs)

    @util.ro_non_memoized_property
    def adapter(self) -> Optional[_ORMAdapterProto]:
        """Produce a callable that adapts column expressions
        to suit an aliased version of this comparator.

        """
        if self._adapt_to_entity is None:
            return None
        else:
            return self._adapt_to_entity._orm_adapt_element

    @util.ro_non_memoized_property
    def info(self) -> _InfoType:
        return self.prop.info

    @staticmethod
    def _any_op(a: Any, b: Any, **kwargs: Any) -> Any:
        return a.any(b, **kwargs)

    @staticmethod
    def _has_op(left: Any, other: Any, **kwargs: Any) -> Any:
        return left.has(other, **kwargs)

    @staticmethod
    def _of_type_op(a: Any, class_: Any) -> Any:
        return a.of_type(class_)

    any_op = cast(operators.OperatorType, _any_op)
    has_op = cast(operators.OperatorType, _has_op)
    of_type_op = cast(operators.OperatorType, _of_type_op)

    if typing.TYPE_CHECKING:

        def operate(
            self, op: OperatorType, *other: Any, **kwargs: Any
        ) -> ColumnElement[Any]:
            ...

        def reverse_operate(
            self, op: OperatorType, other: Any, **kwargs: Any
        ) -> ColumnElement[Any]:
            ...

    def of_type(self, class_: _EntityType[Any]) -> PropComparator[_T_co]:
        r"""Redefine this object in terms of a polymorphic subclass,
        :func:`_orm.with_polymorphic` construct, or :func:`_orm.aliased`
        construct.

        Returns a new PropComparator from which further criterion can be
        evaluated.

        e.g.::

            query.join(Company.employees.of_type(Engineer)).\
               filter(Engineer.name=='foo')

        :param \class_: a class or mapper indicating that criterion will be
            against this specific subclass.

        .. seealso::

            :ref:`orm_queryguide_joining_relationships_aliased` - in the
            :ref:`queryguide_toplevel`

            :ref:`inheritance_of_type`

        """

        return self.operate(PropComparator.of_type_op, class_)  # type: ignore

    def and_(
        self, *criteria: _ColumnExpressionArgument[bool]
    ) -> PropComparator[bool]:
        """Add additional criteria to the ON clause that's represented by this
        relationship attribute.

        E.g.::


            stmt = select(User).join(
                User.addresses.and_(Address.email_address != 'foo')
            )

            stmt = select(User).options(
                joinedload(User.addresses.and_(Address.email_address != 'foo'))
            )

        .. versionadded:: 1.4

        .. seealso::

            :ref:`orm_queryguide_join_on_augmented`

            :ref:`loader_option_criteria`

            :func:`.with_loader_criteria`

        """
        return self.operate(operators.and_, *criteria)  # type: ignore

    def any(
        self,
        criterion: Optional[_ColumnExpressionArgument[bool]] = None,
        **kwargs: Any,
    ) -> ColumnElement[bool]:
        r"""Return a SQL expression representing true if this element
        references a member which meets the given criterion.

        The usual implementation of ``any()`` is
        :meth:`.Relationship.Comparator.any`.

        :param criterion: an optional ClauseElement formulated against the
          member class' table or attributes.

        :param \**kwargs: key/value pairs corresponding to member class
          attribute names which will be compared via equality to the
          corresponding values.

        """

        return self.operate(PropComparator.any_op, criterion, **kwargs)

    def has(
        self,
        criterion: Optional[_ColumnExpressionArgument[bool]] = None,
        **kwargs: Any,
    ) -> ColumnElement[bool]:
        r"""Return a SQL expression representing true if this element
        references a member which meets the given criterion.

        The usual implementation of ``has()`` is
        :meth:`.Relationship.Comparator.has`.

        :param criterion: an optional ClauseElement formulated against the
          member class' table or attributes.

        :param \**kwargs: key/value pairs corresponding to member class
          attribute names which will be compared via equality to the
          corresponding values.

        """

        return self.operate(PropComparator.has_op, criterion, **kwargs)


class StrategizedProperty(MapperProperty[_T]):
    """A MapperProperty which uses selectable strategies to affect
    loading behavior.

    There is a single strategy selected by default.  Alternate
    strategies can be selected at Query time through the usage of
    ``StrategizedOption`` objects via the Query.options() method.

    The mechanics of StrategizedProperty are used for every Query
    invocation for every mapped attribute participating in that Query,
    to determine first how the attribute will be rendered in SQL
    and secondly how the attribute will retrieve a value from a result
    row and apply it to a mapped object.  The routines here are very
    performance-critical.

    """

    __slots__ = (
        "_strategies",
        "strategy",
        "_wildcard_token",
        "_default_path_loader_key",
        "strategy_key",
    )
    inherit_cache = True
    strategy_wildcard_key: ClassVar[str]

    strategy_key: _StrategyKey

    _strategies: Dict[_StrategyKey, LoaderStrategy]

    def _memoized_attr__wildcard_token(self) -> Tuple[str]:
        return (
            f"{self.strategy_wildcard_key}:{path_registry._WILDCARD_TOKEN}",
        )

    def _memoized_attr__default_path_loader_key(
        self,
    ) -> Tuple[str, Tuple[str]]:
        return (
            "loader",
            (f"{self.strategy_wildcard_key}:{path_registry._DEFAULT_TOKEN}",),
        )

    def _get_context_loader(
        self, context: ORMCompileState, path: AbstractEntityRegistry
    ) -> Optional[_LoadElement]:
        load: Optional[_LoadElement] = None

        search_path = path[self]

        # search among: exact match, "attr.*", "default" strategy
        # if any.
        for path_key in (
            search_path._loader_key,
            search_path._wildcard_path_loader_key,
            search_path._default_path_loader_key,
        ):
            if path_key in context.attributes:
                load = context.attributes[path_key]
                break

                # note that if strategy_options.Load is placing non-actionable
                # objects in the context like defaultload(), we would
                # need to continue the loop here if we got such an
                # option as below.
                # if load.strategy or load.local_opts:
                #    break

        return load

    def _get_strategy(self, key: _StrategyKey) -> LoaderStrategy:
        try:
            return self._strategies[key]
        except KeyError:
            pass

        # run outside to prevent transfer of exception context
        cls = self._strategy_lookup(self, *key)
        # this previously was setting self._strategies[cls], that's
        # a bad idea; should use strategy key at all times because every
        # strategy has multiple keys at this point
        self._strategies[key] = strategy = cls(self, key)
        return strategy

    def setup(
        self,
        context: ORMCompileState,
        query_entity: _MapperEntity,
        path: AbstractEntityRegistry,
        adapter: Optional[ORMAdapter],
        **kwargs: Any,
    ) -> None:
        loader = self._get_context_loader(context, path)
        if loader and loader.strategy:
            strat = self._get_strategy(loader.strategy)
        else:
            strat = self.strategy
        strat.setup_query(
            context, query_entity, path, loader, adapter, **kwargs
        )

    def create_row_processor(
        self,
        context: ORMCompileState,
        query_entity: _MapperEntity,
        path: AbstractEntityRegistry,
        mapper: Mapper[Any],
        result: Result[Any],
        adapter: Optional[ORMAdapter],
        populators: _PopulatorDict,
    ) -> None:
        loader = self._get_context_loader(context, path)
        if loader and loader.strategy:
            strat = self._get_strategy(loader.strategy)
        else:
            strat = self.strategy
        strat.create_row_processor(
            context,
            query_entity,
            path,
            loader,
            mapper,
            result,
            adapter,
            populators,
        )

    def do_init(self) -> None:
        self._strategies = {}
        self.strategy = self._get_strategy(self.strategy_key)

    def post_instrument_class(self, mapper: Mapper[Any]) -> None:
        if (
            not self.parent.non_primary
            and not mapper.class_manager._attr_has_impl(self.key)
        ):
            self.strategy.init_class_attribute(mapper)

    _all_strategies: collections.defaultdict[
        Type[MapperProperty[Any]], Dict[_StrategyKey, Type[LoaderStrategy]]
    ] = collections.defaultdict(dict)

    @classmethod
    def strategy_for(cls, **kw: Any) -> Callable[[_TLS], _TLS]:
        def decorate(dec_cls: _TLS) -> _TLS:
            # ensure each subclass of the strategy has its
            # own _strategy_keys collection
            if "_strategy_keys" not in dec_cls.__dict__:
                dec_cls._strategy_keys = []
            key = tuple(sorted(kw.items()))
            cls._all_strategies[cls][key] = dec_cls
            dec_cls._strategy_keys.append(key)
            return dec_cls

        return decorate

    @classmethod
    def _strategy_lookup(
        cls, requesting_property: MapperProperty[Any], *key: Any
    ) -> Type[LoaderStrategy]:
        requesting_property.parent._with_polymorphic_mappers

        for prop_cls in cls.__mro__:
            if prop_cls in cls._all_strategies:
                if TYPE_CHECKING:
                    assert issubclass(prop_cls, MapperProperty)
                strategies = cls._all_strategies[prop_cls]
                try:
                    return strategies[key]
                except KeyError:
                    pass

        for property_type, strats in cls._all_strategies.items():
            if key in strats:
                intended_property_type = property_type
                actual_strategy = strats[key]
                break
        else:
            intended_property_type = None
            actual_strategy = None

        raise orm_exc.LoaderStrategyException(
            cls,
            requesting_property,
            intended_property_type,
            actual_strategy,
            key,
        )


class ORMOption(ExecutableOption):
    """Base class for option objects that are passed to ORM queries.

    These options may be consumed by :meth:`.Query.options`,
    :meth:`.Select.options`, or in a more general sense by any
    :meth:`.Executable.options` method.   They are interpreted at
    statement compile time or execution time in modern use.  The
    deprecated :class:`.MapperOption` is consumed at ORM query construction
    time.

    .. versionadded:: 1.4

    """

    __slots__ = ()

    _is_legacy_option = False

    propagate_to_loaders = False
    """if True, indicate this option should be carried along
    to "secondary" SELECT statements that occur for relationship
    lazy loaders as well as attribute load / refresh operations.

    """

    _is_core = False

    _is_user_defined = False

    _is_compile_state = False

    _is_criteria_option = False

    _is_strategy_option = False

    def _adapt_cached_option_to_uncached_option(
        self, context: QueryContext, uncached_opt: ORMOption
    ) -> ORMOption:
        """adapt this option to the "uncached" version of itself in a
        loader strategy context.

        given "self" which is an option from a cached query, as well as the
        corresponding option from the uncached version of the same query,
        return the option we should use in a new query, in the context of a
        loader strategy being asked to load related rows on behalf of that
        cached query, which is assumed to be building a new query based on
        entities passed to us from the cached query.

        Currently this routine chooses between "self" and "uncached" without
        manufacturing anything new. If the option is itself a loader strategy
        option which has a path, that path needs to match to the entities being
        passed to us by the cached query, so the :class:`_orm.Load` subclass
        overrides this to return "self". For all other options, we return the
        uncached form which may have changing state, such as a
        with_loader_criteria() option which will very often have new state.

        This routine could in the future involve
        generating a new option based on both inputs if use cases arise,
        such as if with_loader_criteria() needed to match up to
        ``AliasedClass`` instances given in the parent query.

        However, longer term it might be better to restructure things such that
        ``AliasedClass`` entities are always matched up on their cache key,
        instead of identity, in things like paths and such, so that this whole
        issue of "the uncached option does not match the entities" goes away.
        However this would make ``PathRegistry`` more complicated and difficult
        to debug as well as potentially less performant in that it would be
        hashing enormous cache keys rather than a simple AliasedInsp. UNLESS,
        we could get cache keys overall to be reliably hashed into something
        like an md5 key.

        .. versionadded:: 1.4.41

        """
        if uncached_opt is not None:
            return uncached_opt
        else:
            return self


class CompileStateOption(HasCacheKey, ORMOption):
    """base for :class:`.ORMOption` classes that affect the compilation of
    a SQL query and therefore need to be part of the cache key.

    .. note::  :class:`.CompileStateOption` is generally non-public and
       should not be used as a base class for user-defined options; instead,
       use :class:`.UserDefinedOption`, which is easier to use as it does not
       interact with ORM compilation internals or caching.

    :class:`.CompileStateOption` defines an internal attribute
    ``_is_compile_state=True`` which has the effect of the ORM compilation
    routines for SELECT and other statements will call upon these options when
    a SQL string is being compiled. As such, these classes implement
    :class:`.HasCacheKey` and need to provide robust ``_cache_key_traversal``
    structures.

    The :class:`.CompileStateOption` class is used to implement the ORM
    :class:`.LoaderOption` and :class:`.CriteriaOption` classes.

    .. versionadded:: 1.4.28


    """

    __slots__ = ()

    _is_compile_state = True

    def process_compile_state(self, compile_state: ORMCompileState) -> None:
        """Apply a modification to a given :class:`.ORMCompileState`.

        This method is part of the implementation of a particular
        :class:`.CompileStateOption` and is only invoked internally
        when an ORM query is compiled.

        """

    def process_compile_state_replaced_entities(
        self,
        compile_state: ORMCompileState,
        mapper_entities: Sequence[_MapperEntity],
    ) -> None:
        """Apply a modification to a given :class:`.ORMCompileState`,
        given entities that were replaced by with_only_columns() or
        with_entities().

        This method is part of the implementation of a particular
        :class:`.CompileStateOption` and is only invoked internally
        when an ORM query is compiled.

        .. versionadded:: 1.4.19

        """


class LoaderOption(CompileStateOption):
    """Describe a loader modification to an ORM statement at compilation time.

    .. versionadded:: 1.4

    """

    __slots__ = ()

    def process_compile_state_replaced_entities(
        self,
        compile_state: ORMCompileState,
        mapper_entities: Sequence[_MapperEntity],
    ) -> None:
        self.process_compile_state(compile_state)


class CriteriaOption(CompileStateOption):
    """Describe a WHERE criteria modification to an ORM statement at
    compilation time.

    .. versionadded:: 1.4

    """

    __slots__ = ()

    _is_criteria_option = True

    def get_global_criteria(self, attributes: Dict[str, Any]) -> None:
        """update additional entity criteria options in the given
        attributes dictionary.

        """


class UserDefinedOption(ORMOption):
    """Base class for a user-defined option that can be consumed from the
    :meth:`.SessionEvents.do_orm_execute` event hook.

    """

    __slots__ = ("payload",)

    _is_legacy_option = False

    _is_user_defined = True

    propagate_to_loaders = False
    """if True, indicate this option should be carried along
    to "secondary" Query objects produced during lazy loads
    or refresh operations.

    """

    def __init__(self, payload: Optional[Any] = None):
        self.payload = payload


@util.deprecated_cls(
    "1.4",
    "The :class:`.MapperOption class is deprecated and will be removed "
    "in a future release.   For "
    "modifications to queries on a per-execution basis, use the "
    ":class:`.UserDefinedOption` class to establish state within a "
    ":class:`.Query` or other Core statement, then use the "
    ":meth:`.SessionEvents.before_orm_execute` hook to consume them.",
    constructor=None,
)
class MapperOption(ORMOption):
    """Describe a modification to a Query"""

    __slots__ = ()

    _is_legacy_option = True

    propagate_to_loaders = False
    """if True, indicate this option should be carried along
    to "secondary" Query objects produced during lazy loads
    or refresh operations.

    """

    def process_query(self, query: Query[Any]) -> None:
        """Apply a modification to the given :class:`_query.Query`."""

    def process_query_conditionally(self, query: Query[Any]) -> None:
        """same as process_query(), except that this option may not
        apply to the given query.

        This is typically applied during a lazy load or scalar refresh
        operation to propagate options stated in the original Query to the
        new Query being used for the load.  It occurs for those options that
        specify propagate_to_loaders=True.

        """

        self.process_query(query)


class LoaderStrategy:
    """Describe the loading behavior of a StrategizedProperty object.

    The ``LoaderStrategy`` interacts with the querying process in three
    ways:

    * it controls the configuration of the ``InstrumentedAttribute``
      placed on a class to handle the behavior of the attribute.  this
      may involve setting up class-level callable functions to fire
      off a select operation when the attribute is first accessed
      (i.e. a lazy load)

    * it processes the ``QueryContext`` at statement construction time,
      where it can modify the SQL statement that is being produced.
      For example, simple column attributes will add their represented
      column to the list of selected columns, a joined eager loader
      may establish join clauses to add to the statement.

    * It produces "row processor" functions at result fetching time.
      These "row processor" functions populate a particular attribute
      on a particular mapped instance.

    """

    __slots__ = (
        "parent_property",
        "is_class_level",
        "parent",
        "key",
        "strategy_key",
        "strategy_opts",
    )

    _strategy_keys: ClassVar[List[_StrategyKey]]

    def __init__(
        self, parent: MapperProperty[Any], strategy_key: _StrategyKey
    ):
        self.parent_property = parent
        self.is_class_level = False
        self.parent = self.parent_property.parent
        self.key = self.parent_property.key
        self.strategy_key = strategy_key
        self.strategy_opts = dict(strategy_key)

    def init_class_attribute(self, mapper: Mapper[Any]) -> None:
        pass

    def setup_query(
        self,
        compile_state: ORMCompileState,
        query_entity: _MapperEntity,
        path: AbstractEntityRegistry,
        loadopt: Optional[_LoadElement],
        adapter: Optional[ORMAdapter],
        **kwargs: Any,
    ) -> None:
        """Establish column and other state for a given QueryContext.

        This method fulfills the contract specified by MapperProperty.setup().

        StrategizedProperty delegates its setup() method
        directly to this method.

        """

    def create_row_processor(
        self,
        context: ORMCompileState,
        query_entity: _MapperEntity,
        path: AbstractEntityRegistry,
        loadopt: Optional[_LoadElement],
        mapper: Mapper[Any],
        result: Result[Any],
        adapter: Optional[ORMAdapter],
        populators: _PopulatorDict,
    ) -> None:
        """Establish row processing functions for a given QueryContext.

        This method fulfills the contract specified by
        MapperProperty.create_row_processor().

        StrategizedProperty delegates its create_row_processor() method
        directly to this method.

        """

    def __str__(self) -> str:
        return str(self.parent_property)
