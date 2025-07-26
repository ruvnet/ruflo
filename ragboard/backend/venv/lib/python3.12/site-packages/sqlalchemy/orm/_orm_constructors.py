# orm/_orm_constructors.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

import typing
from typing import Any
from typing import Callable
from typing import Collection
from typing import Iterable
from typing import NoReturn
from typing import Optional
from typing import overload
from typing import Type
from typing import TYPE_CHECKING
from typing import Union

from . import mapperlib as mapperlib
from ._typing import _O
from .descriptor_props import Composite
from .descriptor_props import Synonym
from .interfaces import _AttributeOptions
from .properties import MappedColumn
from .properties import MappedSQLExpression
from .query import AliasOption
from .relationships import _RelationshipArgumentType
from .relationships import _RelationshipSecondaryArgument
from .relationships import Relationship
from .relationships import RelationshipProperty
from .session import Session
from .util import _ORMJoin
from .util import AliasedClass
from .util import AliasedInsp
from .util import LoaderCriteriaOption
from .. import sql
from .. import util
from ..exc import InvalidRequestError
from ..sql._typing import _no_kw
from ..sql.base import _NoArg
from ..sql.base import SchemaEventTarget
from ..sql.schema import _InsertSentinelColumnDefault
from ..sql.schema import SchemaConst
from ..sql.selectable import FromClause
from ..util.typing import Annotated
from ..util.typing import Literal

if TYPE_CHECKING:
    from ._typing import _EntityType
    from ._typing import _ORMColumnExprArgument
    from .descriptor_props import _CC
    from .descriptor_props import _CompositeAttrType
    from .interfaces import PropComparator
    from .mapper import Mapper
    from .query import Query
    from .relationships import _LazyLoadArgumentType
    from .relationships import _ORMColCollectionArgument
    from .relationships import _ORMOrderByArgument
    from .relationships import _RelationshipJoinConditionArgument
    from .relationships import ORMBackrefArgument
    from .session import _SessionBind
    from ..sql._typing import _AutoIncrementType
    from ..sql._typing import _ColumnExpressionArgument
    from ..sql._typing import _FromClauseArgument
    from ..sql._typing import _InfoType
    from ..sql._typing import _OnClauseArgument
    from ..sql._typing import _TypeEngineArgument
    from ..sql.elements import ColumnElement
    from ..sql.schema import _ServerDefaultArgument
    from ..sql.schema import FetchedValue
    from ..sql.selectable import Alias
    from ..sql.selectable import Subquery


_T = typing.TypeVar("_T")


@util.deprecated(
    "1.4",
    "The :class:`.AliasOption` object is not necessary "
    "for entities to be matched up to a query that is established "
    "via :meth:`.Query.from_statement` and now does nothing.",
    enable_warnings=False,  # AliasOption itself warns
)
def contains_alias(alias: Union[Alias, Subquery]) -> AliasOption:
    r"""Return a :class:`.MapperOption` that will indicate to the
    :class:`_query.Query`
    that the main table has been aliased.

    """
    return AliasOption(alias)


def mapped_column(
    __name_pos: Optional[
        Union[str, _TypeEngineArgument[Any], SchemaEventTarget]
    ] = None,
    __type_pos: Optional[
        Union[_TypeEngineArgument[Any], SchemaEventTarget]
    ] = None,
    *args: SchemaEventTarget,
    init: Union[_NoArg, bool] = _NoArg.NO_ARG,
    repr: Union[_NoArg, bool] = _NoArg.NO_ARG,  # noqa: A002
    default: Optional[Any] = _NoArg.NO_ARG,
    default_factory: Union[_NoArg, Callable[[], _T]] = _NoArg.NO_ARG,
    compare: Union[_NoArg, bool] = _NoArg.NO_ARG,
    kw_only: Union[_NoArg, bool] = _NoArg.NO_ARG,
    nullable: Optional[
        Union[bool, Literal[SchemaConst.NULL_UNSPECIFIED]]
    ] = SchemaConst.NULL_UNSPECIFIED,
    primary_key: Optional[bool] = False,
    deferred: Union[_NoArg, bool] = _NoArg.NO_ARG,
    deferred_group: Optional[str] = None,
    deferred_raiseload: Optional[bool] = None,
    use_existing_column: bool = False,
    name: Optional[str] = None,
    type_: Optional[_TypeEngineArgument[Any]] = None,
    autoincrement: _AutoIncrementType = "auto",
    doc: Optional[str] = None,
    key: Optional[str] = None,
    index: Optional[bool] = None,
    unique: Optional[bool] = None,
    info: Optional[_InfoType] = None,
    onupdate: Optional[Any] = None,
    insert_default: Optional[Any] = _NoArg.NO_ARG,
    server_default: Optional[_ServerDefaultArgument] = None,
    server_onupdate: Optional[FetchedValue] = None,
    active_history: bool = False,
    quote: Optional[bool] = None,
    system: bool = False,
    comment: Optional[str] = None,
    sort_order: Union[_NoArg, int] = _NoArg.NO_ARG,
    **kw: Any,
) -> MappedColumn[Any]:
    r"""declare a new ORM-mapped :class:`_schema.Column` construct
    for use within :ref:`Declarative Table <orm_declarative_table>`
    configuration.

    The :func:`_orm.mapped_column` function provides an ORM-aware and
    Python-typing-compatible construct which is used with
    :ref:`declarative <orm_declarative_mapping>` mappings to indicate an
    attribute that's mapped to a Core :class:`_schema.Column` object.  It
    provides the equivalent feature as mapping an attribute to a
    :class:`_schema.Column` object directly when using Declarative,
    specifically when using :ref:`Declarative Table <orm_declarative_table>`
    configuration.

    .. versionadded:: 2.0

    :func:`_orm.mapped_column` is normally used with explicit typing along with
    the :class:`_orm.Mapped` annotation type, where it can derive the SQL
    type and nullability for the column based on what's present within the
    :class:`_orm.Mapped` annotation.   It also may be used without annotations
    as a drop-in replacement for how :class:`_schema.Column` is used in
    Declarative mappings in SQLAlchemy 1.x style.

    For usage examples of :func:`_orm.mapped_column`, see the documentation
    at :ref:`orm_declarative_table`.

    .. seealso::

        :ref:`orm_declarative_table` - complete documentation

        :ref:`whatsnew_20_orm_declarative_typing` - migration notes for
        Declarative mappings using 1.x style mappings

    :param __name: String name to give to the :class:`_schema.Column`.  This
     is an optional, positional only argument that if present must be the
     first positional argument passed.  If omitted, the attribute name to
     which the :func:`_orm.mapped_column`  is mapped will be used as the SQL
     column name.
    :param __type: :class:`_types.TypeEngine` type or instance which will
     indicate the datatype to be associated with the :class:`_schema.Column`.
     This is an optional, positional-only argument that if present must
     immediately follow the ``__name`` parameter if present also, or otherwise
     be the first positional parameter.  If omitted, the ultimate type for
     the column may be derived either from the annotated type, or if a
     :class:`_schema.ForeignKey` is present, from the datatype of the
     referenced column.
    :param \*args: Additional positional arguments include constructs such
     as :class:`_schema.ForeignKey`, :class:`_schema.CheckConstraint`,
     and :class:`_schema.Identity`, which are passed through to the constructed
     :class:`_schema.Column`.
    :param nullable: Optional bool, whether the column should be "NULL" or
     "NOT NULL". If omitted, the nullability is derived from the type
     annotation based on whether or not ``typing.Optional`` is present.
     ``nullable`` defaults to ``True`` otherwise for non-primary key columns,
     and ``False`` for primary key columns.
    :param primary_key: optional bool, indicates the :class:`_schema.Column`
     would be part of the table's primary key or not.
    :param deferred: Optional bool - this keyword argument is consumed by the
     ORM declarative process, and is not part of the :class:`_schema.Column`
     itself; instead, it indicates that this column should be "deferred" for
     loading as though mapped by :func:`_orm.deferred`.

     .. seealso::

        :ref:`orm_queryguide_deferred_declarative`

    :param deferred_group: Implies :paramref:`_orm.mapped_column.deferred`
     to ``True``, and set the :paramref:`_orm.deferred.group` parameter.

     .. seealso::

        :ref:`orm_queryguide_deferred_group`

    :param deferred_raiseload: Implies :paramref:`_orm.mapped_column.deferred`
     to ``True``, and set the :paramref:`_orm.deferred.raiseload` parameter.

     .. seealso::

        :ref:`orm_queryguide_deferred_raiseload`

    :param use_existing_column: if True, will attempt to locate the given
     column name on an inherited superclass (typically single inheriting
     superclass), and if present, will not produce a new column, mapping
     to the superclass column as though it were omitted from this class.
     This is used for mixins that add new columns to an inherited superclass.

     .. seealso::

        :ref:`orm_inheritance_column_conflicts`

     .. versionadded:: 2.0.0b4

    :param default: Passed directly to the
     :paramref:`_schema.Column.default` parameter if the
     :paramref:`_orm.mapped_column.insert_default` parameter is not present.
     Additionally, when used with :ref:`orm_declarative_native_dataclasses`,
     indicates a default Python value that should be applied to the keyword
     constructor within the generated ``__init__()`` method.

     Note that in the case of dataclass generation when
     :paramref:`_orm.mapped_column.insert_default` is not present, this means
     the :paramref:`_orm.mapped_column.default` value is used in **two**
     places, both the ``__init__()`` method as well as the
     :paramref:`_schema.Column.default` parameter. While this behavior may
     change in a future release, for the moment this tends to "work out"; a
     default of ``None`` will mean that the :class:`_schema.Column` gets no
     default generator, whereas a default that refers to a non-``None`` Python
     or SQL expression value will be assigned up front on the object when
     ``__init__()`` is called, which is the same value that the Core
     :class:`_sql.Insert` construct would use in any case, leading to the same
     end result.

     .. note:: When using Core level column defaults that are callables to
        be interpreted by the underlying :class:`_schema.Column` in conjunction
        with :ref:`ORM-mapped dataclasses
        <orm_declarative_native_dataclasses>`, especially those that are
        :ref:`context-aware default functions <context_default_functions>`,
        **the** :paramref:`_orm.mapped_column.insert_default` **parameter must
        be used instead**.  This is necessary to disambiguate the callable from
        being interpreted as a dataclass level default.

    :param insert_default: Passed directly to the
     :paramref:`_schema.Column.default` parameter; will supersede the value
     of :paramref:`_orm.mapped_column.default` when present, however
     :paramref:`_orm.mapped_column.default` will always apply to the
     constructor default for a dataclasses mapping.

    :param sort_order: An integer that indicates how this mapped column
     should be sorted compared to the others when the ORM is creating a
     :class:`_schema.Table`. Among mapped columns that have the same
     value the default ordering is used, placing first the mapped columns
     defined in the main class, then the ones in the super classes.
     Defaults to 0. The sort is ascending.

     .. versionadded:: 2.0.4

    :param active_history=False:

        When ``True``, indicates that the "previous" value for a
        scalar attribute should be loaded when replaced, if not
        already loaded. Normally, history tracking logic for
        simple non-primary-key scalar values only needs to be
        aware of the "new" value in order to perform a flush. This
        flag is available for applications that make use of
        :func:`.attributes.get_history` or :meth:`.Session.is_modified`
        which also need to know the "previous" value of the attribute.

        .. versionadded:: 2.0.10


    :param init: Specific to :ref:`orm_declarative_native_dataclasses`,
     specifies if the mapped attribute should be part of the ``__init__()``
     method as generated by the dataclass process.
    :param repr: Specific to :ref:`orm_declarative_native_dataclasses`,
     specifies if the mapped attribute should be part of the ``__repr__()``
     method as generated by the dataclass process.
    :param default_factory: Specific to
     :ref:`orm_declarative_native_dataclasses`,
     specifies a default-value generation function that will take place
     as part of the ``__init__()``
     method as generated by the dataclass process.
    :param compare: Specific to
     :ref:`orm_declarative_native_dataclasses`, indicates if this field
     should be included in comparison operations when generating the
     ``__eq__()`` and ``__ne__()`` methods for the mapped class.

     .. versionadded:: 2.0.0b4

    :param kw_only: Specific to
     :ref:`orm_declarative_native_dataclasses`, indicates if this field
     should be marked as keyword-only when generating the ``__init__()``.

    :param \**kw: All remaining keyword arguments are passed through to the
     constructor for the :class:`_schema.Column`.

    """

    return MappedColumn(
        __name_pos,
        __type_pos,
        *args,
        name=name,
        type_=type_,
        autoincrement=autoincrement,
        insert_default=insert_default,
        attribute_options=_AttributeOptions(
            init, repr, default, default_factory, compare, kw_only
        ),
        doc=doc,
        key=key,
        index=index,
        unique=unique,
        info=info,
        active_history=active_history,
        nullable=nullable,
        onupdate=onupdate,
        primary_key=primary_key,
        server_default=server_default,
        server_onupdate=server_onupdate,
        use_existing_column=use_existing_column,
        quote=quote,
        comment=comment,
        system=system,
        deferred=deferred,
        deferred_group=deferred_group,
        deferred_raiseload=deferred_raiseload,
        sort_order=sort_order,
        **kw,
    )


def orm_insert_sentinel(
    name: Optional[str] = None,
    type_: Optional[_TypeEngineArgument[Any]] = None,
    *,
    default: Optional[Any] = None,
    omit_from_statements: bool = True,
) -> MappedColumn[Any]:
    """Provides a surrogate :func:`_orm.mapped_column` that generates
    a so-called :term:`sentinel` column, allowing efficient bulk
    inserts with deterministic RETURNING sorting for tables that don't
    otherwise have qualifying primary key configurations.

    Use of :func:`_orm.orm_insert_sentinel` is analogous to the use of the
    :func:`_schema.insert_sentinel` construct within a Core
    :class:`_schema.Table` construct.

    Guidelines for adding this construct to a Declarative mapped class
    are the same as that of the :func:`_schema.insert_sentinel` construct;
    the database table itself also needs to have a column with this name
    present.

    For background on how this object is used, see the section
    :ref:`engine_insertmanyvalues_sentinel_columns` as part of the
    section :ref:`engine_insertmanyvalues`.

    .. seealso::

        :func:`_schema.insert_sentinel`

        :ref:`engine_insertmanyvalues`

        :ref:`engine_insertmanyvalues_sentinel_columns`


    .. versionadded:: 2.0.10

    """

    return mapped_column(
        name=name,
        default=default
        if default is not None
        else _InsertSentinelColumnDefault(),
        _omit_from_statements=omit_from_statements,
        insert_sentinel=True,
        use_existing_column=True,
        nullable=True,
    )


@util.deprecated_params(
    **{
        arg: (
            "2.0",
            f"The :paramref:`_orm.column_property.{arg}` parameter is "
            "deprecated for :func:`_orm.column_property`.  This parameter "
            "applies to a writeable-attribute in a Declarative Dataclasses "
            "configuration only, and :func:`_orm.column_property` is treated "
            "as a read-only attribute in this context.",
        )
        for arg in ("init", "kw_only", "default", "default_factory")
    }
)
def column_property(
    column: _ORMColumnExprArgument[_T],
    *additional_columns: _ORMColumnExprArgument[Any],
    group: Optional[str] = None,
    deferred: bool = False,
    raiseload: bool = False,
    comparator_factory: Optional[Type[PropComparator[_T]]] = None,
    init: Union[_NoArg, bool] = _NoArg.NO_ARG,  # noqa: A002
    repr: Union[_NoArg, bool] = _NoArg.NO_ARG,  # noqa: A002
    default: Optional[Any] = _NoArg.NO_ARG,
    default_factory: Union[_NoArg, Callable[[], _T]] = _NoArg.NO_ARG,
    compare: Union[_NoArg, bool] = _NoArg.NO_ARG,
    kw_only: Union[_NoArg, bool] = _NoArg.NO_ARG,
    active_history: bool = False,
    expire_on_flush: bool = True,
    info: Optional[_InfoType] = None,
    doc: Optional[str] = None,
) -> MappedSQLExpression[_T]:
    r"""Provide a column-level property for use with a mapping.

    With Declarative mappings, :func:`_orm.column_property` is used to
    map read-only SQL expressions to a mapped class.

    When using Imperative mappings, :func:`_orm.column_property` also
    takes on the role of mapping table columns with additional features.
    When using fully Declarative mappings, the :func:`_orm.mapped_column`
    construct should be used for this purpose.

    With Declarative Dataclass mappings, :func:`_orm.column_property`
    is considered to be **read only**, and will not be included in the
    Dataclass ``__init__()`` constructor.

    The :func:`_orm.column_property` function returns an instance of
    :class:`.ColumnProperty`.

    .. seealso::

        :ref:`mapper_column_property_sql_expressions` - general use of
        :func:`_orm.column_property` to map SQL expressions

        :ref:`orm_imperative_table_column_options` - usage of
        :func:`_orm.column_property` with Imperative Table mappings to apply
        additional options to a plain :class:`_schema.Column` object

    :param \*cols:
        list of Column objects to be mapped.

    :param active_history=False:

        Used only for Imperative Table mappings, or legacy-style Declarative
        mappings (i.e. which have not been upgraded to
        :func:`_orm.mapped_column`), for column-based attributes that are
        expected to be writeable; use :func:`_orm.mapped_column` with
        :paramref:`_orm.mapped_column.active_history` for Declarative mappings.
        See that parameter for functional details.

    :param comparator_factory: a class which extends
        :class:`.ColumnProperty.Comparator` which provides custom SQL
        clause generation for comparison operations.

    :param group:
        a group name for this property when marked as deferred.

    :param deferred:
        when True, the column property is "deferred", meaning that
        it does not load immediately, and is instead loaded when the
        attribute is first accessed on an instance.  See also
        :func:`~sqlalchemy.orm.deferred`.

    :param doc:
        optional string that will be applied as the doc on the
        class-bound descriptor.

    :param expire_on_flush=True:
        Disable expiry on flush.   A column_property() which refers
        to a SQL expression (and not a single table-bound column)
        is considered to be a "read only" property; populating it
        has no effect on the state of data, and it can only return
        database state.   For this reason a column_property()'s value
        is expired whenever the parent object is involved in a
        flush, that is, has any kind of "dirty" state within a flush.
        Setting this parameter to ``False`` will have the effect of
        leaving any existing value present after the flush proceeds.
        Note that the :class:`.Session` with default expiration
        settings still expires
        all attributes after a :meth:`.Session.commit` call, however.

    :param info: Optional data dictionary which will be populated into the
        :attr:`.MapperProperty.info` attribute of this object.

    :param raiseload: if True, indicates the column should raise an error
        when undeferred, rather than loading the value.  This can be
        altered at query time by using the :func:`.deferred` option with
        raiseload=False.

        .. versionadded:: 1.4

        .. seealso::

            :ref:`orm_queryguide_deferred_raiseload`

    :param init:

    :param default:

    :param default_factory:

    :param kw_only:

    """
    return MappedSQLExpression(
        column,
        *additional_columns,
        attribute_options=_AttributeOptions(
            False if init is _NoArg.NO_ARG else init,
            repr,
            default,
            default_factory,
            compare,
            kw_only,
        ),
        group=group,
        deferred=deferred,
        raiseload=raiseload,
        comparator_factory=comparator_factory,
        active_history=active_history,
        expire_on_flush=expire_on_flush,
        info=info,
        doc=doc,
        _assume_readonly_dc_attributes=True,
    )


@overload
def composite(
    _class_or_attr: _CompositeAttrType[Any],
    *attrs: _CompositeAttrType[Any],
    group: Optional[str] = None,
    deferred: bool = False,
    raiseload: bool = False,
    comparator_factory: Optional[Type[Composite.Comparator[_T]]] = None,
    active_history: bool = False,
    init: Union[_NoArg, bool] = _NoArg.NO_ARG,
    repr: Union[_NoArg, bool] = _NoArg.NO_ARG,  # noqa: A002
    default: Optional[Any] = _NoArg.NO_ARG,
    default_factory: Union[_NoArg, Callable[[], _T]] = _NoArg.NO_ARG,
    compare: Union[_NoArg, bool] = _NoArg.NO_ARG,
    kw_only: Union[_NoArg, bool] = _NoArg.NO_ARG,
    info: Optional[_InfoType] = None,
    doc: Optional[str] = None,
    **__kw: Any,
) -> Composite[Any]:
    ...


@overload
def composite(
    _class_or_attr: Type[_CC],
    *attrs: _CompositeAttrType[Any],
    group: Optional[str] = None,
    deferred: bool = False,
    raiseload: bool = False,
    comparator_factory: Optional[Type[Composite.Comparator[_T]]] = None,
    active_history: bool = False,
    init: Union[_NoArg, bool] = _NoArg.NO_ARG,
    repr: Union[_NoArg, bool] = _NoArg.NO_ARG,  # noqa: A002
    default: Optional[Any] = _NoArg.NO_ARG,
    default_factory: Union[_NoArg, Callable[[], _T]] = _NoArg.NO_ARG,
    compare: Union[_NoArg, bool] = _NoArg.NO_ARG,
    kw_only: Union[_NoArg, bool] = _NoArg.NO_ARG,
    info: Optional[_InfoType] = None,
    doc: Optional[str] = None,
    **__kw: Any,
) -> Composite[_CC]:
    ...


@overload
def composite(
    _class_or_attr: Callable[..., _CC],
    *attrs: _CompositeAttrType[Any],
    group: Optional[str] = None,
    deferred: bool = False,
    raiseload: bool = False,
    comparator_factory: Optional[Type[Composite.Comparator[_T]]] = None,
    active_history: bool = False,
    init: Union[_NoArg, bool] = _NoArg.NO_ARG,
    repr: Union[_NoArg, bool] = _NoArg.NO_ARG,  # noqa: A002
    default: Optional[Any] = _NoArg.NO_ARG,
    default_factory: Union[_NoArg, Callable[[], _T]] = _NoArg.NO_ARG,
    compare: Union[_NoArg, bool] = _NoArg.NO_ARG,
    kw_only: Union[_NoArg, bool] = _NoArg.NO_ARG,
    info: Optional[_InfoType] = None,
    doc: Optional[str] = None,
    **__kw: Any,
) -> Composite[_CC]:
    ...


def composite(
    _class_or_attr: Union[
        None, Type[_CC], Callable[..., _CC], _CompositeAttrType[Any]
    ] = None,
    *attrs: _CompositeAttrType[Any],
    group: Optional[str] = None,
    deferred: bool = False,
    raiseload: bool = False,
    comparator_factory: Optional[Type[Composite.Comparator[_T]]] = None,
    active_history: bool = False,
    init: Union[_NoArg, bool] = _NoArg.NO_ARG,
    repr: Union[_NoArg, bool] = _NoArg.NO_ARG,  # noqa: A002
    default: Optional[Any] = _NoArg.NO_ARG,
    default_factory: Union[_NoArg, Callable[[], _T]] = _NoArg.NO_ARG,
    compare: Union[_NoArg, bool] = _NoArg.NO_ARG,
    kw_only: Union[_NoArg, bool] = _NoArg.NO_ARG,
    info: Optional[_InfoType] = None,
    doc: Optional[str] = None,
    **__kw: Any,
) -> Composite[Any]:
    r"""Return a composite column-based property for use with a Mapper.

    See the mapping documentation section :ref:`mapper_composite` for a
    full usage example.

    The :class:`.MapperProperty` returned by :func:`.composite`
    is the :class:`.Composite`.

    :param class\_:
      The "composite type" class, or any classmethod or callable which
      will produce a new instance of the composite object given the
      column values in order.

    :param \*attrs:
      List of elements to be mapped, which may include:

      * :class:`_schema.Column` objects
      * :func:`_orm.mapped_column` constructs
      * string names of other attributes on the mapped class, which may be
        any other SQL or object-mapped attribute.  This can for
        example allow a composite that refers to a many-to-one relationship

    :param active_history=False:
      When ``True``, indicates that the "previous" value for a
      scalar attribute should be loaded when replaced, if not
      already loaded.  See the same flag on :func:`.column_property`.

    :param group:
      A group name for this property when marked as deferred.

    :param deferred:
      When True, the column property is "deferred", meaning that it does
      not load immediately, and is instead loaded when the attribute is
      first accessed on an instance.  See also
      :func:`~sqlalchemy.orm.deferred`.

    :param comparator_factory:  a class which extends
      :class:`.Composite.Comparator` which provides custom SQL
      clause generation for comparison operations.

    :param doc:
      optional string that will be applied as the doc on the
      class-bound descriptor.

    :param info: Optional data dictionary which will be populated into the
        :attr:`.MapperProperty.info` attribute of this object.

    :param init: Specific to :ref:`orm_declarative_native_dataclasses`,
     specifies if the mapped attribute should be part of the ``__init__()``
     method as generated by the dataclass process.
    :param repr: Specific to :ref:`orm_declarative_native_dataclasses`,
     specifies if the mapped attribute should be part of the ``__repr__()``
     method as generated by the dataclass process.
    :param default_factory: Specific to
     :ref:`orm_declarative_native_dataclasses`,
     specifies a default-value generation function that will take place
     as part of the ``__init__()``
     method as generated by the dataclass process.

    :param compare: Specific to
     :ref:`orm_declarative_native_dataclasses`, indicates if this field
     should be included in comparison operations when generating the
     ``__eq__()`` and ``__ne__()`` methods for the mapped class.

     .. versionadded:: 2.0.0b4

    :param kw_only: Specific to
     :ref:`orm_declarative_native_dataclasses`, indicates if this field
     should be marked as keyword-only when generating the ``__init__()``.

    """
    if __kw:
        raise _no_kw()

    return Composite(
        _class_or_attr,
        *attrs,
        attribute_options=_AttributeOptions(
            init, repr, default, default_factory, compare, kw_only
        ),
        group=group,
        deferred=deferred,
        raiseload=raiseload,
        comparator_factory=comparator_factory,
        active_history=active_history,
        info=info,
        doc=doc,
    )


def with_loader_criteria(
    entity_or_base: _EntityType[Any],
    where_criteria: _ColumnExpressionArgument[bool],
    loader_only: bool = False,
    include_aliases: bool = False,
    propagate_to_loaders: bool = True,
    track_closure_variables: bool = True,
) -> LoaderCriteriaOption:
    """Add additional WHERE criteria to the load for all occurrences of
    a particular entity.

    .. versionadded:: 1.4

    The :func:`_orm.with_loader_criteria` option is intended to add
    limiting criteria to a particular kind of entity in a query,
    **globally**, meaning it will apply to the entity as it appears
    in the SELECT query as well as within any subqueries, join
    conditions, and relationship loads, including both eager and lazy
    loaders, without the need for it to be specified in any particular
    part of the query.    The rendering logic uses the same system used by
    single table inheritance to ensure a certain discriminator is applied
    to a table.

    E.g., using :term:`2.0-style` queries, we can limit the way the
    ``User.addresses`` collection is loaded, regardless of the kind
    of loading used::

        from sqlalchemy.orm import with_loader_criteria

        stmt = select(User).options(
            selectinload(User.addresses),
            with_loader_criteria(Address, Address.email_address != 'foo'))
        )

    Above, the "selectinload" for ``User.addresses`` will apply the
    given filtering criteria to the WHERE clause.

    Another example, where the filtering will be applied to the
    ON clause of the join, in this example using :term:`1.x style`
    queries::

        q = session.query(User).outerjoin(User.addresses).options(
            with_loader_criteria(Address, Address.email_address != 'foo'))
        )

    The primary purpose of :func:`_orm.with_loader_criteria` is to use
    it in the :meth:`_orm.SessionEvents.do_orm_execute` event handler
    to ensure that all occurrences of a particular entity are filtered
    in a certain way, such as filtering for access control roles.    It
    also can be used to apply criteria to relationship loads.  In the
    example below, we can apply a certain set of rules to all queries
    emitted by a particular :class:`_orm.Session`::

        session = Session(bind=engine)

        @event.listens_for("do_orm_execute", session)
        def _add_filtering_criteria(execute_state):

            if (
                execute_state.is_select
                and not execute_state.is_column_load
                and not execute_state.is_relationship_load
            ):
                execute_state.statement = execute_state.statement.options(
                    with_loader_criteria(
                        SecurityRole,
                        lambda cls: cls.role.in_(['some_role']),
                        include_aliases=True
                    )
                )

    In the above example, the :meth:`_orm.SessionEvents.do_orm_execute`
    event will intercept all queries emitted using the
    :class:`_orm.Session`. For those queries which are SELECT statements
    and are not attribute or relationship loads a custom
    :func:`_orm.with_loader_criteria` option is added to the query.    The
    :func:`_orm.with_loader_criteria` option will be used in the given
    statement and will also be automatically propagated to all relationship
    loads that descend from this query.

    The criteria argument given is a ``lambda`` that accepts a ``cls``
    argument.  The given class will expand to include all mapped subclass
    and need not itself be a mapped class.

    .. tip::

       When using :func:`_orm.with_loader_criteria` option in
       conjunction with the :func:`_orm.contains_eager` loader option,
       it's important to note that :func:`_orm.with_loader_criteria` only
       affects the part of the query that determines what SQL is rendered
       in terms of the WHERE and FROM clauses. The
       :func:`_orm.contains_eager` option does not affect the rendering of
       the SELECT statement outside of the columns clause, so does not have
       any interaction with the :func:`_orm.with_loader_criteria` option.
       However, the way things "work" is that :func:`_orm.contains_eager`
       is meant to be used with a query that is already selecting from the
       additional entities in some way, where
       :func:`_orm.with_loader_criteria` can apply it's additional
       criteria.

       In the example below, assuming a mapping relationship as
       ``A -> A.bs -> B``, the given :func:`_orm.with_loader_criteria`
       option will affect the way in which the JOIN is rendered::

            stmt = select(A).join(A.bs).options(
                contains_eager(A.bs),
                with_loader_criteria(B, B.flag == 1)
            )

       Above, the given :func:`_orm.with_loader_criteria` option will
       affect the ON clause of the JOIN that is specified by
       ``.join(A.bs)``, so is applied as expected. The
       :func:`_orm.contains_eager` option has the effect that columns from
       ``B`` are added to the columns clause::

            SELECT
                b.id, b.a_id, b.data, b.flag,
                a.id AS id_1,
                a.data AS data_1
            FROM a JOIN b ON a.id = b.a_id AND b.flag = :flag_1


       The use of the :func:`_orm.contains_eager` option within the above
       statement has no effect on the behavior of the
       :func:`_orm.with_loader_criteria` option. If the
       :func:`_orm.contains_eager` option were omitted, the SQL would be
       the same as regards the FROM and WHERE clauses, where
       :func:`_orm.with_loader_criteria` continues to add its criteria to
       the ON clause of the JOIN. The addition of
       :func:`_orm.contains_eager` only affects the columns clause, in that
       additional columns against ``b`` are added which are then consumed
       by the ORM to produce ``B`` instances.

    .. warning:: The use of a lambda inside of the call to
      :func:`_orm.with_loader_criteria` is only invoked **once per unique
      class**. Custom functions should not be invoked within this lambda.
      See :ref:`engine_lambda_caching` for an overview of the "lambda SQL"
      feature, which is for advanced use only.

    :param entity_or_base: a mapped class, or a class that is a super
     class of a particular set of mapped classes, to which the rule
     will apply.

    :param where_criteria: a Core SQL expression that applies limiting
     criteria.   This may also be a "lambda:" or Python function that
     accepts a target class as an argument, when the given class is
     a base with many different mapped subclasses.

     .. note:: To support pickling, use a module-level Python function to
        produce the SQL expression instead of a lambda or a fixed SQL
        expression, which tend to not be picklable.

    :param include_aliases: if True, apply the rule to :func:`_orm.aliased`
     constructs as well.

    :param propagate_to_loaders: defaults to True, apply to relationship
     loaders such as lazy loaders.   This indicates that the
     option object itself including SQL expression is carried along with
     each loaded instance.  Set to ``False`` to prevent the object from
     being assigned to individual instances.


     .. seealso::

        :ref:`examples_session_orm_events` - includes examples of using
        :func:`_orm.with_loader_criteria`.

        :ref:`do_orm_execute_global_criteria` - basic example on how to
        combine :func:`_orm.with_loader_criteria` with the
        :meth:`_orm.SessionEvents.do_orm_execute` event.

    :param track_closure_variables: when False, closure variables inside
     of a lambda expression will not be used as part of
     any cache key.    This allows more complex expressions to be used
     inside of a lambda expression but requires that the lambda ensures
     it returns the identical SQL every time given a particular class.

     .. versionadded:: 1.4.0b2

    """
    return LoaderCriteriaOption(
        entity_or_base,
        where_criteria,
        loader_only,
        include_aliases,
        propagate_to_loaders,
        track_closure_variables,
    )


def relationship(
    argument: Optional[_RelationshipArgumentType[Any]] = None,
    secondary: Optional[_RelationshipSecondaryArgument] = None,
    *,
    uselist: Optional[bool] = None,
    collection_class: Optional[
        Union[Type[Collection[Any]], Callable[[], Collection[Any]]]
    ] = None,
    primaryjoin: Optional[_RelationshipJoinConditionArgument] = None,
    secondaryjoin: Optional[_RelationshipJoinConditionArgument] = None,
    back_populates: Optional[str] = None,
    order_by: _ORMOrderByArgument = False,
    backref: Optional[ORMBackrefArgument] = None,
    overlaps: Optional[str] = None,
    post_update: bool = False,
    cascade: str = "save-update, merge",
    viewonly: bool = False,
    init: Union[_NoArg, bool] = _NoArg.NO_ARG,
    repr: Union[_NoArg, bool] = _NoArg.NO_ARG,  # noqa: A002
    default: Union[_NoArg, _T] = _NoArg.NO_ARG,
    default_factory: Union[_NoArg, Callable[[], _T]] = _NoArg.NO_ARG,
    compare: Union[_NoArg, bool] = _NoArg.NO_ARG,
    kw_only: Union[_NoArg, bool] = _NoArg.NO_ARG,
    lazy: _LazyLoadArgumentType = "select",
    passive_deletes: Union[Literal["all"], bool] = False,
    passive_updates: bool = True,
    active_history: bool = False,
    enable_typechecks: bool = True,
    foreign_keys: Optional[_ORMColCollectionArgument] = None,
    remote_side: Optional[_ORMColCollectionArgument] = None,
    join_depth: Optional[int] = None,
    comparator_factory: Optional[
        Type[RelationshipProperty.Comparator[Any]]
    ] = None,
    single_parent: bool = False,
    innerjoin: bool = False,
    distinct_target_key: Optional[bool] = None,
    load_on_pending: bool = False,
    query_class: Optional[Type[Query[Any]]] = None,
    info: Optional[_InfoType] = None,
    omit_join: Literal[None, False] = None,
    sync_backref: Optional[bool] = None,
    **kw: Any,
) -> Relationship[Any]:
    """Provide a relationship between two mapped classes.

    This corresponds to a parent-child or associative table relationship.
    The constructed class is an instance of :class:`.Relationship`.

    .. seealso::

        :ref:`tutorial_orm_related_objects` - tutorial introduction
        to :func:`_orm.relationship` in the :ref:`unified_tutorial`

        :ref:`relationship_config_toplevel` - narrative documentation

    :param argument:
      This parameter refers to the class that is to be related.   It
      accepts several forms, including a direct reference to the target
      class itself, the :class:`_orm.Mapper` instance for the target class,
      a Python callable / lambda that will return a reference to the
      class or :class:`_orm.Mapper` when called, and finally a string
      name for the class, which will be resolved from the
      :class:`_orm.registry` in use in order to locate the class, e.g.::

            class SomeClass(Base):
                # ...

                related = relationship("RelatedClass")

      The :paramref:`_orm.relationship.argument` may also be omitted from the
      :func:`_orm.relationship` construct entirely, and instead placed inside
      a :class:`_orm.Mapped` annotation on the left side, which should
      include a Python collection type if the relationship is expected
      to be a collection, such as::

            class SomeClass(Base):
                # ...

                related_items: Mapped[List["RelatedItem"]] = relationship()

      Or for a many-to-one or one-to-one relationship::

            class SomeClass(Base):
                # ...

                related_item: Mapped["RelatedItem"] = relationship()

      .. seealso::

        :ref:`orm_declarative_properties` - further detail
        on relationship configuration when using Declarative.

    :param secondary:
      For a many-to-many relationship, specifies the intermediary
      table, and is typically an instance of :class:`_schema.Table`.
      In less common circumstances, the argument may also be specified
      as an :class:`_expression.Alias` construct, or even a
      :class:`_expression.Join` construct.

      :paramref:`_orm.relationship.secondary` may
      also be passed as a callable function which is evaluated at
      mapper initialization time.  When using Declarative, it may also
      be a string argument noting the name of a :class:`_schema.Table`
      that is
      present in the :class:`_schema.MetaData`
      collection associated with the
      parent-mapped :class:`_schema.Table`.

      .. warning:: When passed as a Python-evaluable string, the
         argument is interpreted using Python's ``eval()`` function.
         **DO NOT PASS UNTRUSTED INPUT TO THIS STRING**.
         See :ref:`declarative_relationship_eval` for details on
         declarative evaluation of :func:`_orm.relationship` arguments.

      The :paramref:`_orm.relationship.secondary` keyword argument is
      typically applied in the case where the intermediary
      :class:`_schema.Table`
      is not otherwise expressed in any direct class mapping. If the
      "secondary" table is also explicitly mapped elsewhere (e.g. as in
      :ref:`association_pattern`), one should consider applying the
      :paramref:`_orm.relationship.viewonly` flag so that this
      :func:`_orm.relationship`
      is not used for persistence operations which
      may conflict with those of the association object pattern.

      .. seealso::

          :ref:`relationships_many_to_many` - Reference example of "many
          to many".

          :ref:`self_referential_many_to_many` - Specifics on using
          many-to-many in a self-referential case.

          :ref:`declarative_many_to_many` - Additional options when using
          Declarative.

          :ref:`association_pattern` - an alternative to
          :paramref:`_orm.relationship.secondary`
          when composing association
          table relationships, allowing additional attributes to be
          specified on the association table.

          :ref:`composite_secondary_join` - a lesser-used pattern which
          in some cases can enable complex :func:`_orm.relationship` SQL
          conditions to be used.

    :param active_history=False:
      When ``True``, indicates that the "previous" value for a
      many-to-one reference should be loaded when replaced, if
      not already loaded. Normally, history tracking logic for
      simple many-to-ones only needs to be aware of the "new"
      value in order to perform a flush. This flag is available
      for applications that make use of
      :func:`.attributes.get_history` which also need to know
      the "previous" value of the attribute.

    :param backref:
      A reference to a string relationship name, or a :func:`_orm.backref`
      construct, which will be used to automatically generate a new
      :func:`_orm.relationship` on the related class, which then refers to this
      one using a bi-directional :paramref:`_orm.relationship.back_populates`
      configuration.

      In modern Python, explicit use of :func:`_orm.relationship`
      with :paramref:`_orm.relationship.back_populates` should be preferred,
      as it is more robust in terms of mapper configuration as well as
      more conceptually straightforward.  It also integrates with
      new :pep:`484` typing features introduced in SQLAlchemy 2.0 which
      is not possible with dynamically generated attributes.

      .. seealso::

        :ref:`relationships_backref` - notes on using
        :paramref:`_orm.relationship.backref`

        :ref:`tutorial_orm_related_objects` - in the :ref:`unified_tutorial`,
        presents an overview of bi-directional relationship configuration
        and behaviors using :paramref:`_orm.relationship.back_populates`

        :func:`.backref` - allows control over :func:`_orm.relationship`
        configuration when using :paramref:`_orm.relationship.backref`.


    :param back_populates:
      Indicates the name of a :func:`_orm.relationship` on the related
      class that will be synchronized with this one.   It is usually
      expected that the :func:`_orm.relationship` on the related class
      also refer to this one.  This allows objects on both sides of
      each :func:`_orm.relationship` to synchronize in-Python state
      changes and also provides directives to the :term:`unit of work`
      flush process how changes along these relationships should
      be persisted.

      .. seealso::

        :ref:`tutorial_orm_related_objects` - in the :ref:`unified_tutorial`,
        presents an overview of bi-directional relationship configuration
        and behaviors.

        :ref:`relationship_patterns` - includes many examples of
        :paramref:`_orm.relationship.back_populates`.

        :paramref:`_orm.relationship.backref` - legacy form which allows
        more succinct configuration, but does not support explicit typing

    :param overlaps:
       A string name or comma-delimited set of names of other relationships
       on either this mapper, a descendant mapper, or a target mapper with
       which this relationship may write to the same foreign keys upon
       persistence.   The only effect this has is to eliminate the
       warning that this relationship will conflict with another upon
       persistence.   This is used for such relationships that are truly
       capable of conflicting with each other on write, but the application
       will ensure that no such conflicts occur.

       .. versionadded:: 1.4

       .. seealso::

            :ref:`error_qzyx` - usage example

    :param cascade:
      A comma-separated list of cascade rules which determines how
      Session operations should be "cascaded" from parent to child.
      This defaults to ``False``, which means the default cascade
      should be used - this default cascade is ``"save-update, merge"``.

      The available cascades are ``save-update``, ``merge``,
      ``expunge``, ``delete``, ``delete-orphan``, and ``refresh-expire``.
      An additional option, ``all`` indicates shorthand for
      ``"save-update, merge, refresh-expire,
      expunge, delete"``, and is often used as in ``"all, delete-orphan"``
      to indicate that related objects should follow along with the
      parent object in all cases, and be deleted when de-associated.

      .. seealso::

        :ref:`unitofwork_cascades` - Full detail on each of the available
        cascade options.

    :param cascade_backrefs=False:
      Legacy; this flag is always False.

      .. versionchanged:: 2.0 "cascade_backrefs" functionality has been
         removed.

    :param collection_class:
      A class or callable that returns a new list-holding object. will
      be used in place of a plain list for storing elements.

      .. seealso::

        :ref:`custom_collections` - Introductory documentation and
        examples.

    :param comparator_factory:
      A class which extends :class:`.Relationship.Comparator`
      which provides custom SQL clause generation for comparison
      operations.

      .. seealso::

        :class:`.PropComparator` - some detail on redefining comparators
        at this level.

        :ref:`custom_comparators` - Brief intro to this feature.


    :param distinct_target_key=None:
      Indicate if a "subquery" eager load should apply the DISTINCT
      keyword to the innermost SELECT statement.  When left as ``None``,
      the DISTINCT keyword will be applied in those cases when the target
      columns do not comprise the full primary key of the target table.
      When set to ``True``, the DISTINCT keyword is applied to the
      innermost SELECT unconditionally.

      It may be desirable to set this flag to False when the DISTINCT is
      reducing performance of the innermost subquery beyond that of what
      duplicate innermost rows may be causing.

      .. seealso::

        :ref:`loading_toplevel` - includes an introduction to subquery
        eager loading.

    :param doc:
      Docstring which will be applied to the resulting descriptor.

    :param foreign_keys:

      A list of columns which are to be used as "foreign key"
      columns, or columns which refer to the value in a remote
      column, within the context of this :func:`_orm.relationship`
      object's :paramref:`_orm.relationship.primaryjoin` condition.
      That is, if the :paramref:`_orm.relationship.primaryjoin`
      condition of this :func:`_orm.relationship` is ``a.id ==
      b.a_id``, and the values in ``b.a_id`` are required to be
      present in ``a.id``, then the "foreign key" column of this
      :func:`_orm.relationship` is ``b.a_id``.

      In normal cases, the :paramref:`_orm.relationship.foreign_keys`
      parameter is **not required.** :func:`_orm.relationship` will
      automatically determine which columns in the
      :paramref:`_orm.relationship.primaryjoin` condition are to be
      considered "foreign key" columns based on those
      :class:`_schema.Column` objects that specify
      :class:`_schema.ForeignKey`,
      or are otherwise listed as referencing columns in a
      :class:`_schema.ForeignKeyConstraint` construct.
      :paramref:`_orm.relationship.foreign_keys` is only needed when:

        1. There is more than one way to construct a join from the local
           table to the remote table, as there are multiple foreign key
           references present.  Setting ``foreign_keys`` will limit the
           :func:`_orm.relationship`
           to consider just those columns specified
           here as "foreign".

        2. The :class:`_schema.Table` being mapped does not actually have
           :class:`_schema.ForeignKey` or
           :class:`_schema.ForeignKeyConstraint`
           constructs present, often because the table
           was reflected from a database that does not support foreign key
           reflection (MySQL MyISAM).

        3. The :paramref:`_orm.relationship.primaryjoin`
           argument is used to
           construct a non-standard join condition, which makes use of
           columns or expressions that do not normally refer to their
           "parent" column, such as a join condition expressed by a
           complex comparison using a SQL function.

      The :func:`_orm.relationship` construct will raise informative
      error messages that suggest the use of the
      :paramref:`_orm.relationship.foreign_keys` parameter when
      presented with an ambiguous condition.   In typical cases,
      if :func:`_orm.relationship` doesn't raise any exceptions, the
      :paramref:`_orm.relationship.foreign_keys` parameter is usually
      not needed.

      :paramref:`_orm.relationship.foreign_keys` may also be passed as a
      callable function which is evaluated at mapper initialization time,
      and may be passed as a Python-evaluable string when using
      Declarative.

      .. warning:: When passed as a Python-evaluable string, the
         argument is interpreted using Python's ``eval()`` function.
         **DO NOT PASS UNTRUSTED INPUT TO THIS STRING**.
         See :ref:`declarative_relationship_eval` for details on
         declarative evaluation of :func:`_orm.relationship` arguments.

      .. seealso::

        :ref:`relationship_foreign_keys`

        :ref:`relationship_custom_foreign`

        :func:`.foreign` - allows direct annotation of the "foreign"
        columns within a :paramref:`_orm.relationship.primaryjoin`
        condition.

    :param info: Optional data dictionary which will be populated into the
        :attr:`.MapperProperty.info` attribute of this object.

    :param innerjoin=False:
      When ``True``, joined eager loads will use an inner join to join
      against related tables instead of an outer join.  The purpose
      of this option is generally one of performance, as inner joins
      generally perform better than outer joins.

      This flag can be set to ``True`` when the relationship references an
      object via many-to-one using local foreign keys that are not
      nullable, or when the reference is one-to-one or a collection that
      is guaranteed to have one or at least one entry.

      The option supports the same "nested" and "unnested" options as
      that of :paramref:`_orm.joinedload.innerjoin`.  See that flag
      for details on nested / unnested behaviors.

      .. seealso::

        :paramref:`_orm.joinedload.innerjoin` - the option as specified by
        loader option, including detail on nesting behavior.

        :ref:`what_kind_of_loading` - Discussion of some details of
        various loader options.


    :param join_depth:
      When non-``None``, an integer value indicating how many levels
      deep "eager" loaders should join on a self-referring or cyclical
      relationship.  The number counts how many times the same Mapper
      shall be present in the loading condition along a particular join
      branch.  When left at its default of ``None``, eager loaders
      will stop chaining when they encounter a the same target mapper
      which is already higher up in the chain.  This option applies
      both to joined- and subquery- eager loaders.

      .. seealso::

        :ref:`self_referential_eager_loading` - Introductory documentation
        and examples.

    :param lazy='select': specifies
      How the related items should be loaded.  Default value is
      ``select``.  Values include:

      * ``select`` - items should be loaded lazily when the property is
        first accessed, using a separate SELECT statement, or identity map
        fetch for simple many-to-one references.

      * ``immediate`` - items should be loaded as the parents are loaded,
        using a separate SELECT statement, or identity map fetch for
        simple many-to-one references.

      * ``joined`` - items should be loaded "eagerly" in the same query as
        that of the parent, using a JOIN or LEFT OUTER JOIN.  Whether
        the join is "outer" or not is determined by the
        :paramref:`_orm.relationship.innerjoin` parameter.

      * ``subquery`` - items should be loaded "eagerly" as the parents are
        loaded, using one additional SQL statement, which issues a JOIN to
        a subquery of the original statement, for each collection
        requested.

      * ``selectin`` - items should be loaded "eagerly" as the parents
        are loaded, using one or more additional SQL statements, which
        issues a JOIN to the immediate parent object, specifying primary
        key identifiers using an IN clause.

      * ``noload`` - no loading should occur at any time.  The related
        collection will remain empty.   The ``noload`` strategy is not
        recommended for general use.  For a general use "never load"
        approach, see :ref:`write_only_relationship`

      * ``raise`` - lazy loading is disallowed; accessing
        the attribute, if its value were not already loaded via eager
        loading, will raise an :exc:`~sqlalchemy.exc.InvalidRequestError`.
        This strategy can be used when objects are to be detached from
        their attached :class:`.Session` after they are loaded.

      * ``raise_on_sql`` - lazy loading that emits SQL is disallowed;
        accessing the attribute, if its value were not already loaded via
        eager loading, will raise an
        :exc:`~sqlalchemy.exc.InvalidRequestError`, **if the lazy load
        needs to emit SQL**.  If the lazy load can pull the related value
        from the identity map or determine that it should be None, the
        value is loaded.  This strategy can be used when objects will
        remain associated with the attached :class:`.Session`, however
        additional SELECT statements should be blocked.

      * ``write_only`` - the attribute will be configured with a special
        "virtual collection" that may receive
        :meth:`_orm.WriteOnlyCollection.add` and
        :meth:`_orm.WriteOnlyCollection.remove` commands to add or remove
        individual objects, but will not under any circumstances load or
        iterate the full set of objects from the database directly. Instead,
        methods such as :meth:`_orm.WriteOnlyCollection.select`,
        :meth:`_orm.WriteOnlyCollection.insert`,
        :meth:`_orm.WriteOnlyCollection.update` and
        :meth:`_orm.WriteOnlyCollection.delete` are provided which generate SQL
        constructs that may be used to load and modify rows in bulk. Used for
        large collections that are never appropriate to load at once into
        memory.

        The ``write_only`` loader style is configured automatically when
        the :class:`_orm.WriteOnlyMapped` annotation is provided on the
        left hand side within a Declarative mapping.  See the section
        :ref:`write_only_relationship` for examples.

        .. versionadded:: 2.0

        .. seealso::

            :ref:`write_only_relationship` - in the :ref:`queryguide_toplevel`

      * ``dynamic`` - the attribute will return a pre-configured
        :class:`_query.Query` object for all read
        operations, onto which further filtering operations can be
        applied before iterating the results.

        The ``dynamic`` loader style is configured automatically when
        the :class:`_orm.DynamicMapped` annotation is provided on the
        left hand side within a Declarative mapping.  See the section
        :ref:`dynamic_relationship` for examples.

        .. legacy::  The "dynamic" lazy loader strategy is the legacy form of
           what is now the "write_only" strategy described in the section
           :ref:`write_only_relationship`.

        .. seealso::

            :ref:`dynamic_relationship` - in the :ref:`queryguide_toplevel`

            :ref:`write_only_relationship` - more generally useful approach
            for large collections that should not fully load into memory

      * True - a synonym for 'select'

      * False - a synonym for 'joined'

      * None - a synonym for 'noload'

      .. seealso::

        :ref:`orm_queryguide_relationship_loaders` - Full documentation on
        relationship loader configuration in the :ref:`queryguide_toplevel`.


    :param load_on_pending=False:
      Indicates loading behavior for transient or pending parent objects.

      When set to ``True``, causes the lazy-loader to
      issue a query for a parent object that is not persistent, meaning it
      has never been flushed.  This may take effect for a pending object
      when autoflush is disabled, or for a transient object that has been
      "attached" to a :class:`.Session` but is not part of its pending
      collection.

      The :paramref:`_orm.relationship.load_on_pending`
      flag does not improve
      behavior when the ORM is used normally - object references should be
      constructed at the object level, not at the foreign key level, so
      that they are present in an ordinary way before a flush proceeds.
      This flag is not not intended for general use.

      .. seealso::

          :meth:`.Session.enable_relationship_loading` - this method
          establishes "load on pending" behavior for the whole object, and
          also allows loading on objects that remain transient or
          detached.

    :param order_by:
      Indicates the ordering that should be applied when loading these
      items.  :paramref:`_orm.relationship.order_by`
      is expected to refer to
      one of the :class:`_schema.Column`
      objects to which the target class is
      mapped, or the attribute itself bound to the target class which
      refers to the column.

      :paramref:`_orm.relationship.order_by`
      may also be passed as a callable
      function which is evaluated at mapper initialization time, and may
      be passed as a Python-evaluable string when using Declarative.

      .. warning:: When passed as a Python-evaluable string, the
         argument is interpreted using Python's ``eval()`` function.
         **DO NOT PASS UNTRUSTED INPUT TO THIS STRING**.
         See :ref:`declarative_relationship_eval` for details on
         declarative evaluation of :func:`_orm.relationship` arguments.

    :param passive_deletes=False:
       Indicates loading behavior during delete operations.

       A value of True indicates that unloaded child items should not
       be loaded during a delete operation on the parent.  Normally,
       when a parent item is deleted, all child items are loaded so
       that they can either be marked as deleted, or have their
       foreign key to the parent set to NULL.  Marking this flag as
       True usually implies an ON DELETE <CASCADE|SET NULL> rule is in
       place which will handle updating/deleting child rows on the
       database side.

       Additionally, setting the flag to the string value 'all' will
       disable the "nulling out" of the child foreign keys, when the parent
       object is deleted and there is no delete or delete-orphan cascade
       enabled.  This is typically used when a triggering or error raise
       scenario is in place on the database side.  Note that the foreign
       key attributes on in-session child objects will not be changed after
       a flush occurs so this is a very special use-case setting.
       Additionally, the "nulling out" will still occur if the child
       object is de-associated with the parent.

       .. seealso::

            :ref:`passive_deletes` - Introductory documentation
            and examples.

    :param passive_updates=True:
      Indicates the persistence behavior to take when a referenced
      primary key value changes in place, indicating that the referencing
      foreign key columns will also need their value changed.

      When True, it is assumed that ``ON UPDATE CASCADE`` is configured on
      the foreign key in the database, and that the database will
      handle propagation of an UPDATE from a source column to
      dependent rows.  When False, the SQLAlchemy
      :func:`_orm.relationship`
      construct will attempt to emit its own UPDATE statements to
      modify related targets.  However note that SQLAlchemy **cannot**
      emit an UPDATE for more than one level of cascade.  Also,
      setting this flag to False is not compatible in the case where
      the database is in fact enforcing referential integrity, unless
      those constraints are explicitly "deferred", if the target backend
      supports it.

      It is highly advised that an application which is employing
      mutable primary keys keeps ``passive_updates`` set to True,
      and instead uses the referential integrity features of the database
      itself in order to handle the change efficiently and fully.

      .. seealso::

          :ref:`passive_updates` - Introductory documentation and
          examples.

          :paramref:`.mapper.passive_updates` - a similar flag which
          takes effect for joined-table inheritance mappings.

    :param post_update:
      This indicates that the relationship should be handled by a
      second UPDATE statement after an INSERT or before a
      DELETE. This flag is used to handle saving bi-directional
      dependencies between two individual rows (i.e. each row
      references the other), where it would otherwise be impossible to
      INSERT or DELETE both rows fully since one row exists before the
      other. Use this flag when a particular mapping arrangement will
      incur two rows that are dependent on each other, such as a table
      that has a one-to-many relationship to a set of child rows, and
      also has a column that references a single child row within that
      list (i.e. both tables contain a foreign key to each other). If
      a flush operation returns an error that a "cyclical
      dependency" was detected, this is a cue that you might want to
      use :paramref:`_orm.relationship.post_update` to "break" the cycle.

      .. seealso::

          :ref:`post_update` - Introductory documentation and examples.

    :param primaryjoin:
      A SQL expression that will be used as the primary
      join of the child object against the parent object, or in a
      many-to-many relationship the join of the parent object to the
      association table. By default, this value is computed based on the
      foreign key relationships of the parent and child tables (or
      association table).

      :paramref:`_orm.relationship.primaryjoin` may also be passed as a
      callable function which is evaluated at mapper initialization time,
      and may be passed as a Python-evaluable string when using
      Declarative.

      .. warning:: When passed as a Python-evaluable string, the
         argument is interpreted using Python's ``eval()`` function.
         **DO NOT PASS UNTRUSTED INPUT TO THIS STRING**.
         See :ref:`declarative_relationship_eval` for details on
         declarative evaluation of :func:`_orm.relationship` arguments.

      .. seealso::

          :ref:`relationship_primaryjoin`

    :param remote_side:
      Used for self-referential relationships, indicates the column or
      list of columns that form the "remote side" of the relationship.

      :paramref:`_orm.relationship.remote_side` may also be passed as a
      callable function which is evaluated at mapper initialization time,
      and may be passed as a Python-evaluable string when using
      Declarative.

      .. warning:: When passed as a Python-evaluable string, the
         argument is interpreted using Python's ``eval()`` function.
         **DO NOT PASS UNTRUSTED INPUT TO THIS STRING**.
         See :ref:`declarative_relationship_eval` for details on
         declarative evaluation of :func:`_orm.relationship` arguments.

      .. seealso::

        :ref:`self_referential` - in-depth explanation of how
        :paramref:`_orm.relationship.remote_side`
        is used to configure self-referential relationships.

        :func:`.remote` - an annotation function that accomplishes the
        same purpose as :paramref:`_orm.relationship.remote_side`,
        typically
        when a custom :paramref:`_orm.relationship.primaryjoin` condition
        is used.

    :param query_class:
      A :class:`_query.Query`
      subclass that will be used internally by the
      ``AppenderQuery`` returned by a "dynamic" relationship, that
      is, a relationship that specifies ``lazy="dynamic"`` or was
      otherwise constructed using the :func:`_orm.dynamic_loader`
      function.

      .. seealso::

        :ref:`dynamic_relationship` - Introduction to "dynamic"
        relationship loaders.

    :param secondaryjoin:
      A SQL expression that will be used as the join of
      an association table to the child object. By default, this value is
      computed based on the foreign key relationships of the association
      and child tables.

      :paramref:`_orm.relationship.secondaryjoin` may also be passed as a
      callable function which is evaluated at mapper initialization time,
      and may be passed as a Python-evaluable string when using
      Declarative.

      .. warning:: When passed as a Python-evaluable string, the
         argument is interpreted using Python's ``eval()`` function.
         **DO NOT PASS UNTRUSTED INPUT TO THIS STRING**.
         See :ref:`declarative_relationship_eval` for details on
         declarative evaluation of :func:`_orm.relationship` arguments.

      .. seealso::

          :ref:`relationship_primaryjoin`

    :param single_parent:
      When True, installs a validator which will prevent objects
      from being associated with more than one parent at a time.
      This is used for many-to-one or many-to-many relationships that
      should be treated either as one-to-one or one-to-many.  Its usage
      is optional, except for :func:`_orm.relationship` constructs which
      are many-to-one or many-to-many and also
      specify the ``delete-orphan`` cascade option.  The
      :func:`_orm.relationship` construct itself will raise an error
      instructing when this option is required.

      .. seealso::

        :ref:`unitofwork_cascades` - includes detail on when the
        :paramref:`_orm.relationship.single_parent`
        flag may be appropriate.

    :param uselist:
      A boolean that indicates if this property should be loaded as a
      list or a scalar. In most cases, this value is determined
      automatically by :func:`_orm.relationship` at mapper configuration
      time.  When using explicit :class:`_orm.Mapped` annotations,
      :paramref:`_orm.relationship.uselist` may be derived from the
      whether or not the annotation within :class:`_orm.Mapped` contains
      a collection class.
      Otherwise, :paramref:`_orm.relationship.uselist` may be derived from
      the type and direction
      of the relationship - one to many forms a list, many to one
      forms a scalar, many to many is a list. If a scalar is desired
      where normally a list would be present, such as a bi-directional
      one-to-one relationship, use an appropriate :class:`_orm.Mapped`
      annotation or set :paramref:`_orm.relationship.uselist` to False.

      The :paramref:`_orm.relationship.uselist`
      flag is also available on an
      existing :func:`_orm.relationship`
      construct as a read-only attribute,
      which can be used to determine if this :func:`_orm.relationship`
      deals
      with collections or scalar attributes::

          >>> User.addresses.property.uselist
          True

      .. seealso::

          :ref:`relationships_one_to_one` - Introduction to the "one to
          one" relationship pattern, which is typically when an alternate
          setting for :paramref:`_orm.relationship.uselist` is involved.

    :param viewonly=False:
      When set to ``True``, the relationship is used only for loading
      objects, and not for any persistence operation.  A
      :func:`_orm.relationship` which specifies
      :paramref:`_orm.relationship.viewonly` can work
      with a wider range of SQL operations within the
      :paramref:`_orm.relationship.primaryjoin` condition, including
      operations that feature the use of a variety of comparison operators
      as well as SQL functions such as :func:`_expression.cast`.  The
      :paramref:`_orm.relationship.viewonly`
      flag is also of general use when defining any kind of
      :func:`_orm.relationship` that doesn't represent
      the full set of related objects, to prevent modifications of the
      collection from resulting in persistence operations.

      .. seealso::

        :ref:`relationship_viewonly_notes` - more details on best practices
        when using :paramref:`_orm.relationship.viewonly`.

    :param sync_backref:
      A boolean that enables the events used to synchronize the in-Python
      attributes when this relationship is target of either
      :paramref:`_orm.relationship.backref` or
      :paramref:`_orm.relationship.back_populates`.

      Defaults to ``None``, which indicates that an automatic value should
      be selected based on the value of the
      :paramref:`_orm.relationship.viewonly` flag.  When left at its
      default, changes in state will be back-populated only if neither
      sides of a relationship is viewonly.

      .. versionadded:: 1.3.17

      .. versionchanged:: 1.4 - A relationship that specifies
         :paramref:`_orm.relationship.viewonly` automatically implies
         that :paramref:`_orm.relationship.sync_backref` is ``False``.

      .. seealso::

        :paramref:`_orm.relationship.viewonly`

    :param omit_join:
      Allows manual control over the "selectin" automatic join
      optimization.  Set to ``False`` to disable the "omit join" feature
      added in SQLAlchemy 1.3; or leave as ``None`` to leave automatic
      optimization in place.

      .. note:: This flag may only be set to ``False``.   It is not
         necessary to set it to ``True`` as the "omit_join" optimization is
         automatically detected; if it is not detected, then the
         optimization is not supported.

         .. versionchanged:: 1.3.11  setting ``omit_join`` to True will now
            emit a warning as this was not the intended use of this flag.

      .. versionadded:: 1.3

    :param init: Specific to :ref:`orm_declarative_native_dataclasses`,
     specifies if the mapped attribute should be part of the ``__init__()``
     method as generated by the dataclass process.
    :param repr: Specific to :ref:`orm_declarative_native_dataclasses`,
     specifies if the mapped attribute should be part of the ``__repr__()``
     method as generated by the dataclass process.
    :param default_factory: Specific to
     :ref:`orm_declarative_native_dataclasses`,
     specifies a default-value generation function that will take place
     as part of the ``__init__()``
     method as generated by the dataclass process.
    :param compare: Specific to
     :ref:`orm_declarative_native_dataclasses`, indicates if this field
     should be included in comparison operations when generating the
     ``__eq__()`` and ``__ne__()`` methods for the mapped class.

     .. versionadded:: 2.0.0b4

    :param kw_only: Specific to
     :ref:`orm_declarative_native_dataclasses`, indicates if this field
     should be marked as keyword-only when generating the ``__init__()``.


    """

    return Relationship(
        argument,
        secondary=secondary,
        uselist=uselist,
        collection_class=collection_class,
        primaryjoin=primaryjoin,
        secondaryjoin=secondaryjoin,
        back_populates=back_populates,
        order_by=order_by,
        backref=backref,
        overlaps=overlaps,
        post_update=post_update,
        cascade=cascade,
        viewonly=viewonly,
        attribute_options=_AttributeOptions(
            init, repr, default, default_factory, compare, kw_only
        ),
        lazy=lazy,
        passive_deletes=passive_deletes,
        passive_updates=passive_updates,
        active_history=active_history,
        enable_typechecks=enable_typechecks,
        foreign_keys=foreign_keys,
        remote_side=remote_side,
        join_depth=join_depth,
        comparator_factory=comparator_factory,
        single_parent=single_parent,
        innerjoin=innerjoin,
        distinct_target_key=distinct_target_key,
        load_on_pending=load_on_pending,
        query_class=query_class,
        info=info,
        omit_join=omit_join,
        sync_backref=sync_backref,
        **kw,
    )


def synonym(
    name: str,
    *,
    map_column: Optional[bool] = None,
    descriptor: Optional[Any] = None,
    comparator_factory: Optional[Type[PropComparator[_T]]] = None,
    init: Union[_NoArg, bool] = _NoArg.NO_ARG,
    repr: Union[_NoArg, bool] = _NoArg.NO_ARG,  # noqa: A002
    default: Union[_NoArg, _T] = _NoArg.NO_ARG,
    default_factory: Union[_NoArg, Callable[[], _T]] = _NoArg.NO_ARG,
    compare: Union[_NoArg, bool] = _NoArg.NO_ARG,
    kw_only: Union[_NoArg, bool] = _NoArg.NO_ARG,
    info: Optional[_InfoType] = None,
    doc: Optional[str] = None,
) -> Synonym[Any]:
    """Denote an attribute name as a synonym to a mapped property,
    in that the attribute will mirror the value and expression behavior
    of another attribute.

    e.g.::

        class MyClass(Base):
            __tablename__ = 'my_table'

            id = Column(Integer, primary_key=True)
            job_status = Column(String(50))

            status = synonym("job_status")


    :param name: the name of the existing mapped property.  This
      can refer to the string name ORM-mapped attribute
      configured on the class, including column-bound attributes
      and relationships.

    :param descriptor: a Python :term:`descriptor` that will be used
      as a getter (and potentially a setter) when this attribute is
      accessed at the instance level.

    :param map_column: **For classical mappings and mappings against
      an existing Table object only**.  if ``True``, the :func:`.synonym`
      construct will locate the :class:`_schema.Column`
      object upon the mapped
      table that would normally be associated with the attribute name of
      this synonym, and produce a new :class:`.ColumnProperty` that instead
      maps this :class:`_schema.Column`
      to the alternate name given as the "name"
      argument of the synonym; in this way, the usual step of redefining
      the mapping of the :class:`_schema.Column`
      to be under a different name is
      unnecessary. This is usually intended to be used when a
      :class:`_schema.Column`
      is to be replaced with an attribute that also uses a
      descriptor, that is, in conjunction with the
      :paramref:`.synonym.descriptor` parameter::

        my_table = Table(
            "my_table", metadata,
            Column('id', Integer, primary_key=True),
            Column('job_status', String(50))
        )

        class MyClass:
            @property
            def _job_status_descriptor(self):
                return "Status: %s" % self._job_status


        mapper(
            MyClass, my_table, properties={
                "job_status": synonym(
                    "_job_status", map_column=True,
                    descriptor=MyClass._job_status_descriptor)
            }
        )

      Above, the attribute named ``_job_status`` is automatically
      mapped to the ``job_status`` column::

        >>> j1 = MyClass()
        >>> j1._job_status = "employed"
        >>> j1.job_status
        Status: employed

      When using Declarative, in order to provide a descriptor in
      conjunction with a synonym, use the
      :func:`sqlalchemy.ext.declarative.synonym_for` helper.  However,
      note that the :ref:`hybrid properties <mapper_hybrids>` feature
      should usually be preferred, particularly when redefining attribute
      behavior.

    :param info: Optional data dictionary which will be populated into the
        :attr:`.InspectionAttr.info` attribute of this object.

    :param comparator_factory: A subclass of :class:`.PropComparator`
      that will provide custom comparison behavior at the SQL expression
      level.

      .. note::

        For the use case of providing an attribute which redefines both
        Python-level and SQL-expression level behavior of an attribute,
        please refer to the Hybrid attribute introduced at
        :ref:`mapper_hybrids` for a more effective technique.

    .. seealso::

        :ref:`synonyms` - Overview of synonyms

        :func:`.synonym_for` - a helper oriented towards Declarative

        :ref:`mapper_hybrids` - The Hybrid Attribute extension provides an
        updated approach to augmenting attribute behavior more flexibly
        than can be achieved with synonyms.

    """
    return Synonym(
        name,
        map_column=map_column,
        descriptor=descriptor,
        comparator_factory=comparator_factory,
        attribute_options=_AttributeOptions(
            init, repr, default, default_factory, compare, kw_only
        ),
        doc=doc,
        info=info,
    )


def create_session(
    bind: Optional[_SessionBind] = None, **kwargs: Any
) -> Session:
    r"""Create a new :class:`.Session`
    with no automation enabled by default.

    This function is used primarily for testing.   The usual
    route to :class:`.Session` creation is via its constructor
    or the :func:`.sessionmaker` function.

    :param bind: optional, a single Connectable to use for all
      database access in the created
      :class:`~sqlalchemy.orm.session.Session`.

    :param \*\*kwargs: optional, passed through to the
      :class:`.Session` constructor.

    :returns: an :class:`~sqlalchemy.orm.session.Session` instance

    The defaults of create_session() are the opposite of that of
    :func:`sessionmaker`; ``autoflush`` and ``expire_on_commit`` are
    False.

    Usage::

      >>> from sqlalchemy.orm import create_session
      >>> session = create_session()

    It is recommended to use :func:`sessionmaker` instead of
    create_session().

    """

    kwargs.setdefault("autoflush", False)
    kwargs.setdefault("expire_on_commit", False)
    return Session(bind=bind, **kwargs)


def _mapper_fn(*arg: Any, **kw: Any) -> NoReturn:
    """Placeholder for the now-removed ``mapper()`` function.

    Classical mappings should be performed using the
    :meth:`_orm.registry.map_imperatively` method.

    This symbol remains in SQLAlchemy 2.0 to suit the deprecated use case
    of using the ``mapper()`` function as a target for ORM event listeners,
    which failed to be marked as deprecated in the 1.4 series.

    Global ORM mapper listeners should instead use the :class:`_orm.Mapper`
    class as the target.

    .. versionchanged:: 2.0  The ``mapper()`` function was removed; the
       symbol remains temporarily as a placeholder for the event listening
       use case.

    """
    raise InvalidRequestError(
        "The 'sqlalchemy.orm.mapper()' function is removed as of "
        "SQLAlchemy 2.0.  Use the "
        "'sqlalchemy.orm.registry.map_imperatively()` "
        "method of the ``sqlalchemy.orm.registry`` class to perform "
        "classical mapping."
    )


def dynamic_loader(
    argument: Optional[_RelationshipArgumentType[Any]] = None, **kw: Any
) -> RelationshipProperty[Any]:
    """Construct a dynamically-loading mapper property.

    This is essentially the same as
    using the ``lazy='dynamic'`` argument with :func:`relationship`::

        dynamic_loader(SomeClass)

        # is the same as

        relationship(SomeClass, lazy="dynamic")

    See the section :ref:`dynamic_relationship` for more details
    on dynamic loading.

    """
    kw["lazy"] = "dynamic"
    return relationship(argument, **kw)


def backref(name: str, **kwargs: Any) -> ORMBackrefArgument:
    """When using the :paramref:`_orm.relationship.backref` parameter,
    provides specific parameters to be used when the new
    :func:`_orm.relationship` is generated.

    E.g.::

        'items':relationship(
            SomeItem, backref=backref('parent', lazy='subquery'))

    The :paramref:`_orm.relationship.backref` parameter is generally
    considered to be legacy; for modern applications, using
    explicit :func:`_orm.relationship` constructs linked together using
    the :paramref:`_orm.relationship.back_populates` parameter should be
    preferred.

    .. seealso::

        :ref:`relationships_backref` - background on backrefs

    """

    return (name, kwargs)


def deferred(
    column: _ORMColumnExprArgument[_T],
    *additional_columns: _ORMColumnExprArgument[Any],
    group: Optional[str] = None,
    raiseload: bool = False,
    comparator_factory: Optional[Type[PropComparator[_T]]] = None,
    init: Union[_NoArg, bool] = _NoArg.NO_ARG,
    repr: Union[_NoArg, bool] = _NoArg.NO_ARG,  # noqa: A002
    default: Optional[Any] = _NoArg.NO_ARG,
    default_factory: Union[_NoArg, Callable[[], _T]] = _NoArg.NO_ARG,
    compare: Union[_NoArg, bool] = _NoArg.NO_ARG,
    kw_only: Union[_NoArg, bool] = _NoArg.NO_ARG,
    active_history: bool = False,
    expire_on_flush: bool = True,
    info: Optional[_InfoType] = None,
    doc: Optional[str] = None,
) -> MappedSQLExpression[_T]:
    r"""Indicate a column-based mapped attribute that by default will
    not load unless accessed.

    When using :func:`_orm.mapped_column`, the same functionality as
    that of :func:`_orm.deferred` construct is provided by using the
    :paramref:`_orm.mapped_column.deferred` parameter.

    :param \*columns: columns to be mapped.  This is typically a single
     :class:`_schema.Column` object,
     however a collection is supported in order
     to support multiple columns mapped under the same attribute.

    :param raiseload: boolean, if True, indicates an exception should be raised
     if the load operation is to take place.

     .. versionadded:: 1.4


    Additional arguments are the same as that of :func:`_orm.column_property`.

    .. seealso::

        :ref:`orm_queryguide_deferred_imperative`

    """
    return MappedSQLExpression(
        column,
        *additional_columns,
        attribute_options=_AttributeOptions(
            init, repr, default, default_factory, compare, kw_only
        ),
        group=group,
        deferred=True,
        raiseload=raiseload,
        comparator_factory=comparator_factory,
        active_history=active_history,
        expire_on_flush=expire_on_flush,
        info=info,
        doc=doc,
    )


def query_expression(
    default_expr: _ORMColumnExprArgument[_T] = sql.null(),
    *,
    repr: Union[_NoArg, bool] = _NoArg.NO_ARG,  # noqa: A002
    compare: Union[_NoArg, bool] = _NoArg.NO_ARG,  # noqa: A002
    expire_on_flush: bool = True,
    info: Optional[_InfoType] = None,
    doc: Optional[str] = None,
) -> MappedSQLExpression[_T]:
    """Indicate an attribute that populates from a query-time SQL expression.

    :param default_expr: Optional SQL expression object that will be used in
        all cases if not assigned later with :func:`_orm.with_expression`.

    .. versionadded:: 1.2

    .. seealso::

        :ref:`orm_queryguide_with_expression` - background and usage examples

    """
    prop = MappedSQLExpression(
        default_expr,
        attribute_options=_AttributeOptions(
            False,
            repr,
            _NoArg.NO_ARG,
            _NoArg.NO_ARG,
            compare,
            _NoArg.NO_ARG,
        ),
        expire_on_flush=expire_on_flush,
        info=info,
        doc=doc,
        _assume_readonly_dc_attributes=True,
    )

    prop.strategy_key = (("query_expression", True),)
    return prop


def clear_mappers() -> None:
    """Remove all mappers from all classes.

    .. versionchanged:: 1.4  This function now locates all
       :class:`_orm.registry` objects and calls upon the
       :meth:`_orm.registry.dispose` method of each.

    This function removes all instrumentation from classes and disposes
    of their associated mappers.  Once called, the classes are unmapped
    and can be later re-mapped with new mappers.

    :func:`.clear_mappers` is *not* for normal use, as there is literally no
    valid usage for it outside of very specific testing scenarios. Normally,
    mappers are permanent structural components of user-defined classes, and
    are never discarded independently of their class.  If a mapped class
    itself is garbage collected, its mapper is automatically disposed of as
    well. As such, :func:`.clear_mappers` is only for usage in test suites
    that re-use the same classes with different mappings, which is itself an
    extremely rare use case - the only such use case is in fact SQLAlchemy's
    own test suite, and possibly the test suites of other ORM extension
    libraries which intend to test various combinations of mapper construction
    upon a fixed set of classes.

    """

    mapperlib._dispose_registries(mapperlib._all_registries(), False)


# I would really like a way to get the Type[] here that shows up
# in a different way in typing tools, however there is no current method
# that is accepted by mypy (subclass of Type[_O] works in pylance, rejected
# by mypy).
AliasedType = Annotated[Type[_O], "aliased"]


@overload
def aliased(
    element: Type[_O],
    alias: Optional[FromClause] = None,
    name: Optional[str] = None,
    flat: bool = False,
    adapt_on_names: bool = False,
) -> AliasedType[_O]:
    ...


@overload
def aliased(
    element: Union[AliasedClass[_O], Mapper[_O], AliasedInsp[_O]],
    alias: Optional[FromClause] = None,
    name: Optional[str] = None,
    flat: bool = False,
    adapt_on_names: bool = False,
) -> AliasedClass[_O]:
    ...


@overload
def aliased(
    element: FromClause,
    alias: None = None,
    name: Optional[str] = None,
    flat: bool = False,
    adapt_on_names: bool = False,
) -> FromClause:
    ...


def aliased(
    element: Union[_EntityType[_O], FromClause],
    alias: Optional[FromClause] = None,
    name: Optional[str] = None,
    flat: bool = False,
    adapt_on_names: bool = False,
) -> Union[AliasedClass[_O], FromClause, AliasedType[_O]]:
    """Produce an alias of the given element, usually an :class:`.AliasedClass`
    instance.

    E.g.::

        my_alias = aliased(MyClass)

        stmt = select(MyClass, my_alias).filter(MyClass.id > my_alias.id)
        result = session.execute(stmt)

    The :func:`.aliased` function is used to create an ad-hoc mapping of a
    mapped class to a new selectable.  By default, a selectable is generated
    from the normally mapped selectable (typically a :class:`_schema.Table`
    ) using the
    :meth:`_expression.FromClause.alias` method. However, :func:`.aliased`
    can also be
    used to link the class to a new :func:`_expression.select` statement.
    Also, the :func:`.with_polymorphic` function is a variant of
    :func:`.aliased` that is intended to specify a so-called "polymorphic
    selectable", that corresponds to the union of several joined-inheritance
    subclasses at once.

    For convenience, the :func:`.aliased` function also accepts plain
    :class:`_expression.FromClause` constructs, such as a
    :class:`_schema.Table` or
    :func:`_expression.select` construct.   In those cases, the
    :meth:`_expression.FromClause.alias`
    method is called on the object and the new
    :class:`_expression.Alias` object returned.  The returned
    :class:`_expression.Alias` is not
    ORM-mapped in this case.

    .. seealso::

        :ref:`tutorial_orm_entity_aliases` - in the :ref:`unified_tutorial`

        :ref:`orm_queryguide_orm_aliases` - in the :ref:`queryguide_toplevel`

    :param element: element to be aliased.  Is normally a mapped class,
     but for convenience can also be a :class:`_expression.FromClause`
     element.

    :param alias: Optional selectable unit to map the element to.  This is
     usually used to link the object to a subquery, and should be an aliased
     select construct as one would produce from the
     :meth:`_query.Query.subquery` method or
     the :meth:`_expression.Select.subquery` or
     :meth:`_expression.Select.alias` methods of the :func:`_expression.select`
     construct.

    :param name: optional string name to use for the alias, if not specified
     by the ``alias`` parameter.  The name, among other things, forms the
     attribute name that will be accessible via tuples returned by a
     :class:`_query.Query` object.  Not supported when creating aliases
     of :class:`_sql.Join` objects.

    :param flat: Boolean, will be passed through to the
     :meth:`_expression.FromClause.alias` call so that aliases of
     :class:`_expression.Join` objects will alias the individual tables
     inside the join, rather than creating a subquery.  This is generally
     supported by all modern databases with regards to right-nested joins
     and generally produces more efficient queries.

    :param adapt_on_names: if True, more liberal "matching" will be used when
     mapping the mapped columns of the ORM entity to those of the
     given selectable - a name-based match will be performed if the
     given selectable doesn't otherwise have a column that corresponds
     to one on the entity.  The use case for this is when associating
     an entity with some derived selectable such as one that uses
     aggregate functions::

        class UnitPrice(Base):
            __tablename__ = 'unit_price'
            ...
            unit_id = Column(Integer)
            price = Column(Numeric)

        aggregated_unit_price = Session.query(
                                    func.sum(UnitPrice.price).label('price')
                                ).group_by(UnitPrice.unit_id).subquery()

        aggregated_unit_price = aliased(UnitPrice,
                    alias=aggregated_unit_price, adapt_on_names=True)

     Above, functions on ``aggregated_unit_price`` which refer to
     ``.price`` will return the
     ``func.sum(UnitPrice.price).label('price')`` column, as it is
     matched on the name "price".  Ordinarily, the "price" function
     wouldn't have any "column correspondence" to the actual
     ``UnitPrice.price`` column as it is not a proxy of the original.

    """
    return AliasedInsp._alias_factory(
        element,
        alias=alias,
        name=name,
        flat=flat,
        adapt_on_names=adapt_on_names,
    )


def with_polymorphic(
    base: Union[Type[_O], Mapper[_O]],
    classes: Union[Literal["*"], Iterable[Type[Any]]],
    selectable: Union[Literal[False, None], FromClause] = False,
    flat: bool = False,
    polymorphic_on: Optional[ColumnElement[Any]] = None,
    aliased: bool = False,
    innerjoin: bool = False,
    adapt_on_names: bool = False,
    _use_mapper_path: bool = False,
) -> AliasedClass[_O]:
    """Produce an :class:`.AliasedClass` construct which specifies
    columns for descendant mappers of the given base.

    Using this method will ensure that each descendant mapper's
    tables are included in the FROM clause, and will allow filter()
    criterion to be used against those tables.  The resulting
    instances will also have those columns already loaded so that
    no "post fetch" of those columns will be required.

    .. seealso::

        :ref:`with_polymorphic` - full discussion of
        :func:`_orm.with_polymorphic`.

    :param base: Base class to be aliased.

    :param classes: a single class or mapper, or list of
        class/mappers, which inherit from the base class.
        Alternatively, it may also be the string ``'*'``, in which case
        all descending mapped classes will be added to the FROM clause.

    :param aliased: when True, the selectable will be aliased.   For a
        JOIN, this means the JOIN will be SELECTed from inside of a subquery
        unless the :paramref:`_orm.with_polymorphic.flat` flag is set to
        True, which is recommended for simpler use cases.

    :param flat: Boolean, will be passed through to the
     :meth:`_expression.FromClause.alias` call so that aliases of
     :class:`_expression.Join` objects will alias the individual tables
     inside the join, rather than creating a subquery.  This is generally
     supported by all modern databases with regards to right-nested joins
     and generally produces more efficient queries.  Setting this flag is
     recommended as long as the resulting SQL is functional.

    :param selectable: a table or subquery that will
        be used in place of the generated FROM clause. This argument is
        required if any of the desired classes use concrete table
        inheritance, since SQLAlchemy currently cannot generate UNIONs
        among tables automatically. If used, the ``selectable`` argument
        must represent the full set of tables and columns mapped by every
        mapped class. Otherwise, the unaccounted mapped columns will
        result in their table being appended directly to the FROM clause
        which will usually lead to incorrect results.

        When left at its default value of ``False``, the polymorphic
        selectable assigned to the base mapper is used for selecting rows.
        However, it may also be passed as ``None``, which will bypass the
        configured polymorphic selectable and instead construct an ad-hoc
        selectable for the target classes given; for joined table inheritance
        this will be a join that includes all target mappers and their
        subclasses.

    :param polymorphic_on: a column to be used as the "discriminator"
        column for the given selectable. If not given, the polymorphic_on
        attribute of the base classes' mapper will be used, if any. This
        is useful for mappings that don't have polymorphic loading
        behavior by default.

    :param innerjoin: if True, an INNER JOIN will be used.  This should
       only be specified if querying for one specific subtype only

    :param adapt_on_names: Passes through the
      :paramref:`_orm.aliased.adapt_on_names`
      parameter to the aliased object.  This may be useful in situations where
      the given selectable is not directly related to the existing mapped
      selectable.

      .. versionadded:: 1.4.33

    """
    return AliasedInsp._with_polymorphic_factory(
        base,
        classes,
        selectable=selectable,
        flat=flat,
        polymorphic_on=polymorphic_on,
        adapt_on_names=adapt_on_names,
        aliased=aliased,
        innerjoin=innerjoin,
        _use_mapper_path=_use_mapper_path,
    )


def join(
    left: _FromClauseArgument,
    right: _FromClauseArgument,
    onclause: Optional[_OnClauseArgument] = None,
    isouter: bool = False,
    full: bool = False,
) -> _ORMJoin:
    r"""Produce an inner join between left and right clauses.

    :func:`_orm.join` is an extension to the core join interface
    provided by :func:`_expression.join()`, where the
    left and right selectable may be not only core selectable
    objects such as :class:`_schema.Table`, but also mapped classes or
    :class:`.AliasedClass` instances.   The "on" clause can
    be a SQL expression or an ORM mapped attribute
    referencing a configured :func:`_orm.relationship`.

    :func:`_orm.join` is not commonly needed in modern usage,
    as its functionality is encapsulated within that of the
    :meth:`_sql.Select.join` and :meth:`_query.Query.join`
    methods. which feature a
    significant amount of automation beyond :func:`_orm.join`
    by itself.  Explicit use of :func:`_orm.join`
    with ORM-enabled SELECT statements involves use of the
    :meth:`_sql.Select.select_from` method, as in::

        from sqlalchemy.orm import join
        stmt = select(User).\
            select_from(join(User, Address, User.addresses)).\
            filter(Address.email_address=='foo@bar.com')

    In modern SQLAlchemy the above join can be written more
    succinctly as::

        stmt = select(User).\
                join(User.addresses).\
                filter(Address.email_address=='foo@bar.com')

    .. warning:: using :func:`_orm.join` directly may not work properly
       with modern ORM options such as :func:`_orm.with_loader_criteria`.
       It is strongly recommended to use the idiomatic join patterns
       provided by methods such as :meth:`.Select.join` and
       :meth:`.Select.join_from` when creating ORM joins.

    .. seealso::

        :ref:`orm_queryguide_joins` - in the :ref:`queryguide_toplevel` for
        background on idiomatic ORM join patterns

    """
    return _ORMJoin(left, right, onclause, isouter, full)


def outerjoin(
    left: _FromClauseArgument,
    right: _FromClauseArgument,
    onclause: Optional[_OnClauseArgument] = None,
    full: bool = False,
) -> _ORMJoin:
    """Produce a left outer join between left and right clauses.

    This is the "outer join" version of the :func:`_orm.join` function,
    featuring the same behavior except that an OUTER JOIN is generated.
    See that function's documentation for other usage details.

    """
    return _ORMJoin(left, right, onclause, True, full)
