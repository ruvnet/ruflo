# orm/relationships.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Heuristics related to join conditions as used in
:func:`_orm.relationship`.

Provides the :class:`.JoinCondition` object, which encapsulates
SQL annotation and aliasing behavior focused on the `primaryjoin`
and `secondaryjoin` aspects of :func:`_orm.relationship`.

"""
from __future__ import annotations

import collections
from collections import abc
import dataclasses
import inspect as _py_inspect
import re
import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import Collection
from typing import Dict
from typing import Generic
from typing import Iterable
from typing import Iterator
from typing import List
from typing import NamedTuple
from typing import NoReturn
from typing import Optional
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import Type
from typing import TypeVar
from typing import Union
import weakref

from . import attributes
from . import strategy_options
from ._typing import insp_is_aliased_class
from ._typing import is_has_collection_adapter
from .base import _DeclarativeMapped
from .base import _is_mapped_class
from .base import class_mapper
from .base import DynamicMapped
from .base import LoaderCallableStatus
from .base import PassiveFlag
from .base import state_str
from .base import WriteOnlyMapped
from .interfaces import _AttributeOptions
from .interfaces import _IntrospectsAnnotations
from .interfaces import MANYTOMANY
from .interfaces import MANYTOONE
from .interfaces import ONETOMANY
from .interfaces import PropComparator
from .interfaces import RelationshipDirection
from .interfaces import StrategizedProperty
from .util import _orm_annotate
from .util import _orm_deannotate
from .util import CascadeOptions
from .. import exc as sa_exc
from .. import Exists
from .. import log
from .. import schema
from .. import sql
from .. import util
from ..inspection import inspect
from ..sql import coercions
from ..sql import expression
from ..sql import operators
from ..sql import roles
from ..sql import visitors
from ..sql._typing import _ColumnExpressionArgument
from ..sql._typing import _HasClauseElement
from ..sql.annotation import _safe_annotate
from ..sql.elements import ColumnClause
from ..sql.elements import ColumnElement
from ..sql.util import _deep_annotate
from ..sql.util import _deep_deannotate
from ..sql.util import _shallow_annotate
from ..sql.util import adapt_criterion_to_null
from ..sql.util import ClauseAdapter
from ..sql.util import join_condition
from ..sql.util import selectables_overlap
from ..sql.util import visit_binary_product
from ..util.typing import de_optionalize_union_types
from ..util.typing import Literal
from ..util.typing import resolve_name_to_real_class_name

if typing.TYPE_CHECKING:
    from ._typing import _EntityType
    from ._typing import _ExternalEntityType
    from ._typing import _IdentityKeyType
    from ._typing import _InstanceDict
    from ._typing import _InternalEntityType
    from ._typing import _O
    from ._typing import _RegistryType
    from .base import Mapped
    from .clsregistry import _class_resolver
    from .clsregistry import _ModNS
    from .decl_base import _ClassScanMapperConfig
    from .dependency import DependencyProcessor
    from .mapper import Mapper
    from .query import Query
    from .session import Session
    from .state import InstanceState
    from .strategies import LazyLoader
    from .util import AliasedClass
    from .util import AliasedInsp
    from ..sql._typing import _CoreAdapterProto
    from ..sql._typing import _EquivalentColumnMap
    from ..sql._typing import _InfoType
    from ..sql.annotation import _AnnotationDict
    from ..sql.annotation import SupportsAnnotations
    from ..sql.elements import BinaryExpression
    from ..sql.elements import BindParameter
    from ..sql.elements import ClauseElement
    from ..sql.schema import Table
    from ..sql.selectable import FromClause
    from ..util.typing import _AnnotationScanType
    from ..util.typing import RODescriptorReference

_T = TypeVar("_T", bound=Any)
_T1 = TypeVar("_T1", bound=Any)
_T2 = TypeVar("_T2", bound=Any)

_PT = TypeVar("_PT", bound=Any)

_PT2 = TypeVar("_PT2", bound=Any)


_RelationshipArgumentType = Union[
    str,
    Type[_T],
    Callable[[], Type[_T]],
    "Mapper[_T]",
    "AliasedClass[_T]",
    Callable[[], "Mapper[_T]"],
    Callable[[], "AliasedClass[_T]"],
]

_LazyLoadArgumentType = Literal[
    "select",
    "joined",
    "selectin",
    "subquery",
    "raise",
    "raise_on_sql",
    "noload",
    "immediate",
    "write_only",
    "dynamic",
    True,
    False,
    None,
]


_RelationshipJoinConditionArgument = Union[
    str, _ColumnExpressionArgument[bool]
]
_RelationshipSecondaryArgument = Union[
    "FromClause", str, Callable[[], "FromClause"]
]
_ORMOrderByArgument = Union[
    Literal[False],
    str,
    _ColumnExpressionArgument[Any],
    Callable[[], _ColumnExpressionArgument[Any]],
    Callable[[], Iterable[_ColumnExpressionArgument[Any]]],
    Iterable[Union[str, _ColumnExpressionArgument[Any]]],
]
ORMBackrefArgument = Union[str, Tuple[str, Dict[str, Any]]]

_ORMColCollectionElement = Union[
    ColumnClause[Any],
    _HasClauseElement[Any],
    roles.DMLColumnRole,
    "Mapped[Any]",
]
_ORMColCollectionArgument = Union[
    str,
    Sequence[_ORMColCollectionElement],
    Callable[[], Sequence[_ORMColCollectionElement]],
    Callable[[], _ORMColCollectionElement],
    _ORMColCollectionElement,
]


_CEA = TypeVar("_CEA", bound=_ColumnExpressionArgument[Any])

_CE = TypeVar("_CE", bound="ColumnElement[Any]")


_ColumnPairIterable = Iterable[Tuple[ColumnElement[Any], ColumnElement[Any]]]

_ColumnPairs = Sequence[Tuple[ColumnElement[Any], ColumnElement[Any]]]

_MutableColumnPairs = List[Tuple[ColumnElement[Any], ColumnElement[Any]]]


def remote(expr: _CEA) -> _CEA:
    """Annotate a portion of a primaryjoin expression
    with a 'remote' annotation.

    See the section :ref:`relationship_custom_foreign` for a
    description of use.

    .. seealso::

        :ref:`relationship_custom_foreign`

        :func:`.foreign`

    """
    return _annotate_columns(  # type: ignore
        coercions.expect(roles.ColumnArgumentRole, expr), {"remote": True}
    )


def foreign(expr: _CEA) -> _CEA:
    """Annotate a portion of a primaryjoin expression
    with a 'foreign' annotation.

    See the section :ref:`relationship_custom_foreign` for a
    description of use.

    .. seealso::

        :ref:`relationship_custom_foreign`

        :func:`.remote`

    """

    return _annotate_columns(  # type: ignore
        coercions.expect(roles.ColumnArgumentRole, expr), {"foreign": True}
    )


@dataclasses.dataclass
class _RelationshipArg(Generic[_T1, _T2]):
    """stores a user-defined parameter value that must be resolved and
    parsed later at mapper configuration time.

    """

    __slots__ = "name", "argument", "resolved"
    name: str
    argument: _T1
    resolved: Optional[_T2]

    def _is_populated(self) -> bool:
        return self.argument is not None

    def _resolve_against_registry(
        self, clsregistry_resolver: Callable[[str, bool], _class_resolver]
    ) -> None:
        attr_value = self.argument

        if isinstance(attr_value, str):
            self.resolved = clsregistry_resolver(
                attr_value, self.name == "secondary"
            )()
        elif callable(attr_value) and not _is_mapped_class(attr_value):
            self.resolved = attr_value()
        else:
            self.resolved = attr_value


_RelationshipOrderByArg = Union[Literal[False], Tuple[ColumnElement[Any], ...]]


class _RelationshipArgs(NamedTuple):
    """stores user-passed parameters that are resolved at mapper configuration
    time.

    """

    secondary: _RelationshipArg[
        Optional[_RelationshipSecondaryArgument],
        Optional[FromClause],
    ]
    primaryjoin: _RelationshipArg[
        Optional[_RelationshipJoinConditionArgument],
        Optional[ColumnElement[Any]],
    ]
    secondaryjoin: _RelationshipArg[
        Optional[_RelationshipJoinConditionArgument],
        Optional[ColumnElement[Any]],
    ]
    order_by: _RelationshipArg[_ORMOrderByArgument, _RelationshipOrderByArg]
    foreign_keys: _RelationshipArg[
        Optional[_ORMColCollectionArgument], Set[ColumnElement[Any]]
    ]
    remote_side: _RelationshipArg[
        Optional[_ORMColCollectionArgument], Set[ColumnElement[Any]]
    ]


@log.class_logger
class RelationshipProperty(
    _IntrospectsAnnotations, StrategizedProperty[_T], log.Identified
):
    """Describes an object property that holds a single item or list
    of items that correspond to a related database table.

    Public constructor is the :func:`_orm.relationship` function.

    .. seealso::

        :ref:`relationship_config_toplevel`

    """

    strategy_wildcard_key = strategy_options._RELATIONSHIP_TOKEN
    inherit_cache = True
    """:meta private:"""

    _links_to_entity = True
    _is_relationship = True

    _overlaps: Sequence[str]

    _lazy_strategy: LazyLoader

    _persistence_only = dict(
        passive_deletes=False,
        passive_updates=True,
        enable_typechecks=True,
        active_history=False,
        cascade_backrefs=False,
    )

    _dependency_processor: Optional[DependencyProcessor] = None

    primaryjoin: ColumnElement[bool]
    secondaryjoin: Optional[ColumnElement[bool]]
    secondary: Optional[FromClause]
    _join_condition: JoinCondition
    order_by: _RelationshipOrderByArg

    _user_defined_foreign_keys: Set[ColumnElement[Any]]
    _calculated_foreign_keys: Set[ColumnElement[Any]]

    remote_side: Set[ColumnElement[Any]]
    local_columns: Set[ColumnElement[Any]]

    synchronize_pairs: _ColumnPairs
    secondary_synchronize_pairs: Optional[_ColumnPairs]

    local_remote_pairs: Optional[_ColumnPairs]

    direction: RelationshipDirection

    _init_args: _RelationshipArgs

    def __init__(
        self,
        argument: Optional[_RelationshipArgumentType[_T]] = None,
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
        attribute_options: Optional[_AttributeOptions] = None,
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
        doc: Optional[str] = None,
        bake_queries: Literal[True] = True,
        cascade_backrefs: Literal[False] = False,
        _local_remote_pairs: Optional[_ColumnPairs] = None,
        _legacy_inactive_history_style: bool = False,
    ):
        super().__init__(attribute_options=attribute_options)

        self.uselist = uselist
        self.argument = argument

        self._init_args = _RelationshipArgs(
            _RelationshipArg("secondary", secondary, None),
            _RelationshipArg("primaryjoin", primaryjoin, None),
            _RelationshipArg("secondaryjoin", secondaryjoin, None),
            _RelationshipArg("order_by", order_by, None),
            _RelationshipArg("foreign_keys", foreign_keys, None),
            _RelationshipArg("remote_side", remote_side, None),
        )

        self.post_update = post_update
        self.viewonly = viewonly
        if viewonly:
            self._warn_for_persistence_only_flags(
                passive_deletes=passive_deletes,
                passive_updates=passive_updates,
                enable_typechecks=enable_typechecks,
                active_history=active_history,
                cascade_backrefs=cascade_backrefs,
            )
        if viewonly and sync_backref:
            raise sa_exc.ArgumentError(
                "sync_backref and viewonly cannot both be True"
            )
        self.sync_backref = sync_backref
        self.lazy = lazy
        self.single_parent = single_parent
        self.collection_class = collection_class
        self.passive_deletes = passive_deletes

        if cascade_backrefs:
            raise sa_exc.ArgumentError(
                "The 'cascade_backrefs' parameter passed to "
                "relationship() may only be set to False."
            )

        self.passive_updates = passive_updates
        self.enable_typechecks = enable_typechecks
        self.query_class = query_class
        self.innerjoin = innerjoin
        self.distinct_target_key = distinct_target_key
        self.doc = doc
        self.active_history = active_history
        self._legacy_inactive_history_style = _legacy_inactive_history_style

        self.join_depth = join_depth
        if omit_join:
            util.warn(
                "setting omit_join to True is not supported; selectin "
                "loading of this relationship may not work correctly if this "
                "flag is set explicitly.  omit_join optimization is "
                "automatically detected for conditions under which it is "
                "supported."
            )

        self.omit_join = omit_join
        self.local_remote_pairs = _local_remote_pairs
        self.load_on_pending = load_on_pending
        self.comparator_factory = (
            comparator_factory or RelationshipProperty.Comparator
        )
        util.set_creation_order(self)

        if info is not None:
            self.info.update(info)

        self.strategy_key = (("lazy", self.lazy),)

        self._reverse_property: Set[RelationshipProperty[Any]] = set()

        if overlaps:
            self._overlaps = set(re.split(r"\s*,\s*", overlaps))  # type: ignore  # noqa: E501
        else:
            self._overlaps = ()

        # mypy ignoring the @property setter
        self.cascade = cascade  # type: ignore

        self.back_populates = back_populates

        if self.back_populates:
            if backref:
                raise sa_exc.ArgumentError(
                    "backref and back_populates keyword arguments "
                    "are mutually exclusive"
                )
            self.backref = None
        else:
            self.backref = backref

    def _warn_for_persistence_only_flags(self, **kw: Any) -> None:
        for k, v in kw.items():
            if v != self._persistence_only[k]:
                # we are warning here rather than warn deprecated as this is a
                # configuration mistake, and Python shows regular warnings more
                # aggressively than deprecation warnings by default. Unlike the
                # case of setting viewonly with cascade, the settings being
                # warned about here are not actively doing the wrong thing
                # against viewonly=True, so it is not as urgent to have these
                # raise an error.
                util.warn(
                    "Setting %s on relationship() while also "
                    "setting viewonly=True does not make sense, as a "
                    "viewonly=True relationship does not perform persistence "
                    "operations. This configuration may raise an error "
                    "in a future release." % (k,)
                )

    def instrument_class(self, mapper: Mapper[Any]) -> None:
        attributes.register_descriptor(
            mapper.class_,
            self.key,
            comparator=self.comparator_factory(self, mapper),
            parententity=mapper,
            doc=self.doc,
        )

    class Comparator(util.MemoizedSlots, PropComparator[_PT]):
        """Produce boolean, comparison, and other operators for
        :class:`.RelationshipProperty` attributes.

        See the documentation for :class:`.PropComparator` for a brief
        overview of ORM level operator definition.

        .. seealso::

            :class:`.PropComparator`

            :class:`.ColumnProperty.Comparator`

            :class:`.ColumnOperators`

            :ref:`types_operators`

            :attr:`.TypeEngine.comparator_factory`

        """

        __slots__ = (
            "entity",
            "mapper",
            "property",
            "_of_type",
            "_extra_criteria",
        )

        prop: RODescriptorReference[RelationshipProperty[_PT]]
        _of_type: Optional[_EntityType[_PT]]

        def __init__(
            self,
            prop: RelationshipProperty[_PT],
            parentmapper: _InternalEntityType[Any],
            adapt_to_entity: Optional[AliasedInsp[Any]] = None,
            of_type: Optional[_EntityType[_PT]] = None,
            extra_criteria: Tuple[ColumnElement[bool], ...] = (),
        ):
            """Construction of :class:`.RelationshipProperty.Comparator`
            is internal to the ORM's attribute mechanics.

            """
            self.prop = prop
            self._parententity = parentmapper
            self._adapt_to_entity = adapt_to_entity
            if of_type:
                self._of_type = of_type
            else:
                self._of_type = None
            self._extra_criteria = extra_criteria

        def adapt_to_entity(
            self, adapt_to_entity: AliasedInsp[Any]
        ) -> RelationshipProperty.Comparator[Any]:
            return self.__class__(
                self.prop,
                self._parententity,
                adapt_to_entity=adapt_to_entity,
                of_type=self._of_type,
            )

        entity: _InternalEntityType[_PT]
        """The target entity referred to by this
        :class:`.RelationshipProperty.Comparator`.

        This is either a :class:`_orm.Mapper` or :class:`.AliasedInsp`
        object.

        This is the "target" or "remote" side of the
        :func:`_orm.relationship`.

        """

        mapper: Mapper[_PT]
        """The target :class:`_orm.Mapper` referred to by this
        :class:`.RelationshipProperty.Comparator`.

        This is the "target" or "remote" side of the
        :func:`_orm.relationship`.

        """

        def _memoized_attr_entity(self) -> _InternalEntityType[_PT]:
            if self._of_type:
                return inspect(self._of_type)  # type: ignore
            else:
                return self.prop.entity

        def _memoized_attr_mapper(self) -> Mapper[_PT]:
            return self.entity.mapper

        def _source_selectable(self) -> FromClause:
            if self._adapt_to_entity:
                return self._adapt_to_entity.selectable
            else:
                return self.property.parent._with_polymorphic_selectable

        def __clause_element__(self) -> ColumnElement[bool]:
            adapt_from = self._source_selectable()
            if self._of_type:
                of_type_entity = inspect(self._of_type)
            else:
                of_type_entity = None

            (
                pj,
                sj,
                source,
                dest,
                secondary,
                target_adapter,
            ) = self.prop._create_joins(
                source_selectable=adapt_from,
                source_polymorphic=True,
                of_type_entity=of_type_entity,
                alias_secondary=True,
                extra_criteria=self._extra_criteria,
            )
            if sj is not None:
                return pj & sj
            else:
                return pj

        def of_type(self, class_: _EntityType[Any]) -> PropComparator[_PT]:
            r"""Redefine this object in terms of a polymorphic subclass.

            See :meth:`.PropComparator.of_type` for an example.


            """
            return RelationshipProperty.Comparator(
                self.prop,
                self._parententity,
                adapt_to_entity=self._adapt_to_entity,
                of_type=class_,
                extra_criteria=self._extra_criteria,
            )

        def and_(
            self, *criteria: _ColumnExpressionArgument[bool]
        ) -> PropComparator[Any]:
            """Add AND criteria.

            See :meth:`.PropComparator.and_` for an example.

            .. versionadded:: 1.4

            """
            exprs = tuple(
                coercions.expect(roles.WhereHavingRole, clause)
                for clause in util.coerce_generator_arg(criteria)
            )

            return RelationshipProperty.Comparator(
                self.prop,
                self._parententity,
                adapt_to_entity=self._adapt_to_entity,
                of_type=self._of_type,
                extra_criteria=self._extra_criteria + exprs,
            )

        def in_(self, other: Any) -> NoReturn:
            """Produce an IN clause - this is not implemented
            for :func:`_orm.relationship`-based attributes at this time.

            """
            raise NotImplementedError(
                "in_() not yet supported for "
                "relationships.  For a simple "
                "many-to-one, use in_() against "
                "the set of foreign key values."
            )

        # https://github.com/python/mypy/issues/4266
        __hash__ = None  # type: ignore

        def __eq__(self, other: Any) -> ColumnElement[bool]:  # type: ignore[override]  # noqa: E501
            """Implement the ``==`` operator.

            In a many-to-one context, such as::

              MyClass.some_prop == <some object>

            this will typically produce a
            clause such as::

              mytable.related_id == <some id>

            Where ``<some id>`` is the primary key of the given
            object.

            The ``==`` operator provides partial functionality for non-
            many-to-one comparisons:

            * Comparisons against collections are not supported.
              Use :meth:`~.Relationship.Comparator.contains`.
            * Compared to a scalar one-to-many, will produce a
              clause that compares the target columns in the parent to
              the given target.
            * Compared to a scalar many-to-many, an alias
              of the association table will be rendered as
              well, forming a natural join that is part of the
              main body of the query. This will not work for
              queries that go beyond simple AND conjunctions of
              comparisons, such as those which use OR. Use
              explicit joins, outerjoins, or
              :meth:`~.Relationship.Comparator.has` for
              more comprehensive non-many-to-one scalar
              membership tests.
            * Comparisons against ``None`` given in a one-to-many
              or many-to-many context produce a NOT EXISTS clause.

            """
            if other is None or isinstance(other, expression.Null):
                if self.property.direction in [ONETOMANY, MANYTOMANY]:
                    return ~self._criterion_exists()
                else:
                    return _orm_annotate(
                        self.property._optimized_compare(
                            None, adapt_source=self.adapter
                        )
                    )
            elif self.property.uselist:
                raise sa_exc.InvalidRequestError(
                    "Can't compare a collection to an object or collection; "
                    "use contains() to test for membership."
                )
            else:
                return _orm_annotate(
                    self.property._optimized_compare(
                        other, adapt_source=self.adapter
                    )
                )

        def _criterion_exists(
            self,
            criterion: Optional[_ColumnExpressionArgument[bool]] = None,
            **kwargs: Any,
        ) -> Exists:
            where_criteria = (
                coercions.expect(roles.WhereHavingRole, criterion)
                if criterion is not None
                else None
            )

            if getattr(self, "_of_type", None):
                info: Optional[_InternalEntityType[Any]] = inspect(
                    self._of_type
                )
                assert info is not None
                target_mapper, to_selectable, is_aliased_class = (
                    info.mapper,
                    info.selectable,
                    info.is_aliased_class,
                )
                if self.property._is_self_referential and not is_aliased_class:
                    to_selectable = to_selectable._anonymous_fromclause()

                single_crit = target_mapper._single_table_criterion
                if single_crit is not None:
                    if where_criteria is not None:
                        where_criteria = single_crit & where_criteria
                    else:
                        where_criteria = single_crit
            else:
                is_aliased_class = False
                to_selectable = None

            if self.adapter:
                source_selectable = self._source_selectable()
            else:
                source_selectable = None

            (
                pj,
                sj,
                source,
                dest,
                secondary,
                target_adapter,
            ) = self.property._create_joins(
                dest_selectable=to_selectable,
                source_selectable=source_selectable,
            )

            for k in kwargs:
                crit = getattr(self.property.mapper.class_, k) == kwargs[k]
                if where_criteria is None:
                    where_criteria = crit
                else:
                    where_criteria = where_criteria & crit

            # annotate the *local* side of the join condition, in the case
            # of pj + sj this is the full primaryjoin, in the case of just
            # pj its the local side of the primaryjoin.
            if sj is not None:
                j = _orm_annotate(pj) & sj
            else:
                j = _orm_annotate(pj, exclude=self.property.remote_side)

            if (
                where_criteria is not None
                and target_adapter
                and not is_aliased_class
            ):
                # limit this adapter to annotated only?
                where_criteria = target_adapter.traverse(where_criteria)

            # only have the "joined left side" of what we
            # return be subject to Query adaption.  The right
            # side of it is used for an exists() subquery and
            # should not correlate or otherwise reach out
            # to anything in the enclosing query.
            if where_criteria is not None:
                where_criteria = where_criteria._annotate(
                    {"no_replacement_traverse": True}
                )

            crit = j & sql.True_._ifnone(where_criteria)

            if secondary is not None:
                ex = (
                    sql.exists(1)
                    .where(crit)
                    .select_from(dest, secondary)
                    .correlate_except(dest, secondary)
                )
            else:
                ex = (
                    sql.exists(1)
                    .where(crit)
                    .select_from(dest)
                    .correlate_except(dest)
                )
            return ex

        def any(
            self,
            criterion: Optional[_ColumnExpressionArgument[bool]] = None,
            **kwargs: Any,
        ) -> ColumnElement[bool]:
            """Produce an expression that tests a collection against
            particular criterion, using EXISTS.

            An expression like::

                session.query(MyClass).filter(
                    MyClass.somereference.any(SomeRelated.x==2)
                )


            Will produce a query like::

                SELECT * FROM my_table WHERE
                EXISTS (SELECT 1 FROM related WHERE related.my_id=my_table.id
                AND related.x=2)

            Because :meth:`~.Relationship.Comparator.any` uses
            a correlated subquery, its performance is not nearly as
            good when compared against large target tables as that of
            using a join.

            :meth:`~.Relationship.Comparator.any` is particularly
            useful for testing for empty collections::

                session.query(MyClass).filter(
                    ~MyClass.somereference.any()
                )

            will produce::

                SELECT * FROM my_table WHERE
                NOT (EXISTS (SELECT 1 FROM related WHERE
                related.my_id=my_table.id))

            :meth:`~.Relationship.Comparator.any` is only
            valid for collections, i.e. a :func:`_orm.relationship`
            that has ``uselist=True``.  For scalar references,
            use :meth:`~.Relationship.Comparator.has`.

            """
            if not self.property.uselist:
                raise sa_exc.InvalidRequestError(
                    "'any()' not implemented for scalar "
                    "attributes. Use has()."
                )

            return self._criterion_exists(criterion, **kwargs)

        def has(
            self,
            criterion: Optional[_ColumnExpressionArgument[bool]] = None,
            **kwargs: Any,
        ) -> ColumnElement[bool]:
            """Produce an expression that tests a scalar reference against
            particular criterion, using EXISTS.

            An expression like::

                session.query(MyClass).filter(
                    MyClass.somereference.has(SomeRelated.x==2)
                )


            Will produce a query like::

                SELECT * FROM my_table WHERE
                EXISTS (SELECT 1 FROM related WHERE
                related.id==my_table.related_id AND related.x=2)

            Because :meth:`~.Relationship.Comparator.has` uses
            a correlated subquery, its performance is not nearly as
            good when compared against large target tables as that of
            using a join.

            :meth:`~.Relationship.Comparator.has` is only
            valid for scalar references, i.e. a :func:`_orm.relationship`
            that has ``uselist=False``.  For collection references,
            use :meth:`~.Relationship.Comparator.any`.

            """
            if self.property.uselist:
                raise sa_exc.InvalidRequestError(
                    "'has()' not implemented for collections.  " "Use any()."
                )
            return self._criterion_exists(criterion, **kwargs)

        def contains(
            self, other: _ColumnExpressionArgument[Any], **kwargs: Any
        ) -> ColumnElement[bool]:
            """Return a simple expression that tests a collection for
            containment of a particular item.

            :meth:`~.Relationship.Comparator.contains` is
            only valid for a collection, i.e. a
            :func:`_orm.relationship` that implements
            one-to-many or many-to-many with ``uselist=True``.

            When used in a simple one-to-many context, an
            expression like::

                MyClass.contains(other)

            Produces a clause like::

                mytable.id == <some id>

            Where ``<some id>`` is the value of the foreign key
            attribute on ``other`` which refers to the primary
            key of its parent object. From this it follows that
            :meth:`~.Relationship.Comparator.contains` is
            very useful when used with simple one-to-many
            operations.

            For many-to-many operations, the behavior of
            :meth:`~.Relationship.Comparator.contains`
            has more caveats. The association table will be
            rendered in the statement, producing an "implicit"
            join, that is, includes multiple tables in the FROM
            clause which are equated in the WHERE clause::

                query(MyClass).filter(MyClass.contains(other))

            Produces a query like::

                SELECT * FROM my_table, my_association_table AS
                my_association_table_1 WHERE
                my_table.id = my_association_table_1.parent_id
                AND my_association_table_1.child_id = <some id>

            Where ``<some id>`` would be the primary key of
            ``other``. From the above, it is clear that
            :meth:`~.Relationship.Comparator.contains`
            will **not** work with many-to-many collections when
            used in queries that move beyond simple AND
            conjunctions, such as multiple
            :meth:`~.Relationship.Comparator.contains`
            expressions joined by OR. In such cases subqueries or
            explicit "outer joins" will need to be used instead.
            See :meth:`~.Relationship.Comparator.any` for
            a less-performant alternative using EXISTS, or refer
            to :meth:`_query.Query.outerjoin`
            as well as :ref:`orm_queryguide_joins`
            for more details on constructing outer joins.

            kwargs may be ignored by this operator but are required for API
            conformance.
            """
            if not self.prop.uselist:
                raise sa_exc.InvalidRequestError(
                    "'contains' not implemented for scalar "
                    "attributes.  Use =="
                )

            clause = self.prop._optimized_compare(
                other, adapt_source=self.adapter
            )

            if self.prop.secondaryjoin is not None:
                clause.negation_clause = self.__negated_contains_or_equals(
                    other
                )

            return clause

        def __negated_contains_or_equals(
            self, other: Any
        ) -> ColumnElement[bool]:
            if self.prop.direction == MANYTOONE:
                state = attributes.instance_state(other)

                def state_bindparam(
                    local_col: ColumnElement[Any],
                    state: InstanceState[Any],
                    remote_col: ColumnElement[Any],
                ) -> BindParameter[Any]:
                    dict_ = state.dict
                    return sql.bindparam(
                        local_col.key,
                        type_=local_col.type,
                        unique=True,
                        callable_=self.prop._get_attr_w_warn_on_none(
                            self.prop.mapper, state, dict_, remote_col
                        ),
                    )

                def adapt(col: _CE) -> _CE:
                    if self.adapter:
                        return self.adapter(col)
                    else:
                        return col

                if self.property._use_get:
                    return sql.and_(
                        *[
                            sql.or_(
                                adapt(x)
                                != state_bindparam(adapt(x), state, y),
                                adapt(x) == None,
                            )
                            for (x, y) in self.property.local_remote_pairs
                        ]
                    )

            criterion = sql.and_(
                *[
                    x == y
                    for (x, y) in zip(
                        self.property.mapper.primary_key,
                        self.property.mapper.primary_key_from_instance(other),
                    )
                ]
            )

            return ~self._criterion_exists(criterion)

        def __ne__(self, other: Any) -> ColumnElement[bool]:  # type: ignore[override]  # noqa: E501
            """Implement the ``!=`` operator.

            In a many-to-one context, such as::

              MyClass.some_prop != <some object>

            This will typically produce a clause such as::

              mytable.related_id != <some id>

            Where ``<some id>`` is the primary key of the
            given object.

            The ``!=`` operator provides partial functionality for non-
            many-to-one comparisons:

            * Comparisons against collections are not supported.
              Use
              :meth:`~.Relationship.Comparator.contains`
              in conjunction with :func:`_expression.not_`.
            * Compared to a scalar one-to-many, will produce a
              clause that compares the target columns in the parent to
              the given target.
            * Compared to a scalar many-to-many, an alias
              of the association table will be rendered as
              well, forming a natural join that is part of the
              main body of the query. This will not work for
              queries that go beyond simple AND conjunctions of
              comparisons, such as those which use OR. Use
              explicit joins, outerjoins, or
              :meth:`~.Relationship.Comparator.has` in
              conjunction with :func:`_expression.not_` for
              more comprehensive non-many-to-one scalar
              membership tests.
            * Comparisons against ``None`` given in a one-to-many
              or many-to-many context produce an EXISTS clause.

            """
            if other is None or isinstance(other, expression.Null):
                if self.property.direction == MANYTOONE:
                    return _orm_annotate(
                        ~self.property._optimized_compare(
                            None, adapt_source=self.adapter
                        )
                    )

                else:
                    return self._criterion_exists()
            elif self.property.uselist:
                raise sa_exc.InvalidRequestError(
                    "Can't compare a collection"
                    " to an object or collection; use "
                    "contains() to test for membership."
                )
            else:
                return _orm_annotate(self.__negated_contains_or_equals(other))

        def _memoized_attr_property(self) -> RelationshipProperty[_PT]:
            self.prop.parent._check_configure()
            return self.prop

    def _with_parent(
        self,
        instance: object,
        alias_secondary: bool = True,
        from_entity: Optional[_EntityType[Any]] = None,
    ) -> ColumnElement[bool]:
        assert instance is not None
        adapt_source: Optional[_CoreAdapterProto] = None
        if from_entity is not None:
            insp: Optional[_InternalEntityType[Any]] = inspect(from_entity)
            assert insp is not None
            if insp_is_aliased_class(insp):
                adapt_source = insp._adapter.adapt_clause
        return self._optimized_compare(
            instance,
            value_is_parent=True,
            adapt_source=adapt_source,
            alias_secondary=alias_secondary,
        )

    def _optimized_compare(
        self,
        state: Any,
        value_is_parent: bool = False,
        adapt_source: Optional[_CoreAdapterProto] = None,
        alias_secondary: bool = True,
    ) -> ColumnElement[bool]:
        if state is not None:
            try:
                state = inspect(state)
            except sa_exc.NoInspectionAvailable:
                state = None

            if state is None or not getattr(state, "is_instance", False):
                raise sa_exc.ArgumentError(
                    "Mapped instance expected for relationship "
                    "comparison to object.   Classes, queries and other "
                    "SQL elements are not accepted in this context; for "
                    "comparison with a subquery, "
                    "use %s.has(**criteria)." % self
                )
        reverse_direction = not value_is_parent

        if state is None:
            return self._lazy_none_clause(
                reverse_direction, adapt_source=adapt_source
            )

        if not reverse_direction:
            criterion, bind_to_col = (
                self._lazy_strategy._lazywhere,
                self._lazy_strategy._bind_to_col,
            )
        else:
            criterion, bind_to_col = (
                self._lazy_strategy._rev_lazywhere,
                self._lazy_strategy._rev_bind_to_col,
            )

        if reverse_direction:
            mapper = self.mapper
        else:
            mapper = self.parent

        dict_ = attributes.instance_dict(state.obj())

        def visit_bindparam(bindparam: BindParameter[Any]) -> None:
            if bindparam._identifying_key in bind_to_col:
                bindparam.callable = self._get_attr_w_warn_on_none(
                    mapper,
                    state,
                    dict_,
                    bind_to_col[bindparam._identifying_key],
                )

        if self.secondary is not None and alias_secondary:
            criterion = ClauseAdapter(
                self.secondary._anonymous_fromclause()
            ).traverse(criterion)

        criterion = visitors.cloned_traverse(
            criterion, {}, {"bindparam": visit_bindparam}
        )

        if adapt_source:
            criterion = adapt_source(criterion)
        return criterion

    def _get_attr_w_warn_on_none(
        self,
        mapper: Mapper[Any],
        state: InstanceState[Any],
        dict_: _InstanceDict,
        column: ColumnElement[Any],
    ) -> Callable[[], Any]:
        """Create the callable that is used in a many-to-one expression.

        E.g.::

            u1 = s.query(User).get(5)

            expr = Address.user == u1

        Above, the SQL should be "address.user_id = 5". The callable
        returned by this method produces the value "5" based on the identity
        of ``u1``.

        """

        # in this callable, we're trying to thread the needle through
        # a wide variety of scenarios, including:
        #
        # * the object hasn't been flushed yet and there's no value for
        #   the attribute as of yet
        #
        # * the object hasn't been flushed yet but it has a user-defined
        #   value
        #
        # * the object has a value but it's expired and not locally present
        #
        # * the object has a value but it's expired and not locally present,
        #   and the object is also detached
        #
        # * The object hadn't been flushed yet, there was no value, but
        #   later, the object has been expired and detached, and *now*
        #   they're trying to evaluate it
        #
        # * the object had a value, but it was changed to a new value, and
        #   then expired
        #
        # * the object had a value, but it was changed to a new value, and
        #   then expired, then the object was detached
        #
        # * the object has a user-set value, but it's None and we don't do
        #   the comparison correctly for that so warn
        #

        prop = mapper.get_property_by_column(column)

        # by invoking this method, InstanceState will track the last known
        # value for this key each time the attribute is to be expired.
        # this feature was added explicitly for use in this method.
        state._track_last_known_value(prop.key)

        lkv_fixed = state._last_known_values

        def _go() -> Any:
            assert lkv_fixed is not None
            last_known = to_return = lkv_fixed[prop.key]
            existing_is_available = (
                last_known is not LoaderCallableStatus.NO_VALUE
            )

            # we support that the value may have changed.  so here we
            # try to get the most recent value including re-fetching.
            # only if we can't get a value now due to detachment do we return
            # the last known value
            current_value = mapper._get_state_attr_by_column(
                state,
                dict_,
                column,
                passive=PassiveFlag.PASSIVE_OFF
                if state.persistent
                else PassiveFlag.PASSIVE_NO_FETCH ^ PassiveFlag.INIT_OK,
            )

            if current_value is LoaderCallableStatus.NEVER_SET:
                if not existing_is_available:
                    raise sa_exc.InvalidRequestError(
                        "Can't resolve value for column %s on object "
                        "%s; no value has been set for this column"
                        % (column, state_str(state))
                    )
            elif current_value is LoaderCallableStatus.PASSIVE_NO_RESULT:
                if not existing_is_available:
                    raise sa_exc.InvalidRequestError(
                        "Can't resolve value for column %s on object "
                        "%s; the object is detached and the value was "
                        "expired" % (column, state_str(state))
                    )
            else:
                to_return = current_value
            if to_return is None:
                util.warn(
                    "Got None for value of column %s; this is unsupported "
                    "for a relationship comparison and will not "
                    "currently produce an IS comparison "
                    "(but may in a future release)" % column
                )
            return to_return

        return _go

    def _lazy_none_clause(
        self,
        reverse_direction: bool = False,
        adapt_source: Optional[_CoreAdapterProto] = None,
    ) -> ColumnElement[bool]:
        if not reverse_direction:
            criterion, bind_to_col = (
                self._lazy_strategy._lazywhere,
                self._lazy_strategy._bind_to_col,
            )
        else:
            criterion, bind_to_col = (
                self._lazy_strategy._rev_lazywhere,
                self._lazy_strategy._rev_bind_to_col,
            )

        criterion = adapt_criterion_to_null(criterion, bind_to_col)

        if adapt_source:
            criterion = adapt_source(criterion)
        return criterion

    def __str__(self) -> str:
        return str(self.parent.class_.__name__) + "." + self.key

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
        if load:
            for r in self._reverse_property:
                if (source_state, r) in _recursive:
                    return

        if "merge" not in self._cascade:
            return

        if self.key not in source_dict:
            return

        if self.uselist:
            impl = source_state.get_impl(self.key)

            assert is_has_collection_adapter(impl)
            instances_iterable = impl.get_collection(source_state, source_dict)

            # if this is a CollectionAttributeImpl, then empty should
            # be False, otherwise "self.key in source_dict" should not be
            # True
            assert not instances_iterable.empty if impl.collection else True

            if load:
                # for a full merge, pre-load the destination collection,
                # so that individual _merge of each item pulls from identity
                # map for those already present.
                # also assumes CollectionAttributeImpl behavior of loading
                # "old" list in any case
                dest_state.get_impl(self.key).get(
                    dest_state, dest_dict, passive=PassiveFlag.PASSIVE_MERGE
                )

            dest_list = []
            for current in instances_iterable:
                current_state = attributes.instance_state(current)
                current_dict = attributes.instance_dict(current)
                _recursive[(current_state, self)] = True
                obj = session._merge(
                    current_state,
                    current_dict,
                    load=load,
                    _recursive=_recursive,
                    _resolve_conflict_map=_resolve_conflict_map,
                )
                if obj is not None:
                    dest_list.append(obj)

            if not load:
                coll = attributes.init_state_collection(
                    dest_state, dest_dict, self.key
                )
                for c in dest_list:
                    coll.append_without_event(c)
            else:
                dest_impl = dest_state.get_impl(self.key)
                assert is_has_collection_adapter(dest_impl)
                dest_impl.set(
                    dest_state,
                    dest_dict,
                    dest_list,
                    _adapt=False,
                    passive=PassiveFlag.PASSIVE_MERGE,
                )
        else:
            current = source_dict[self.key]
            if current is not None:
                current_state = attributes.instance_state(current)
                current_dict = attributes.instance_dict(current)
                _recursive[(current_state, self)] = True
                obj = session._merge(
                    current_state,
                    current_dict,
                    load=load,
                    _recursive=_recursive,
                    _resolve_conflict_map=_resolve_conflict_map,
                )
            else:
                obj = None

            if not load:
                dest_dict[self.key] = obj
            else:
                dest_state.get_impl(self.key).set(
                    dest_state, dest_dict, obj, None
                )

    def _value_as_iterable(
        self,
        state: InstanceState[_O],
        dict_: _InstanceDict,
        key: str,
        passive: PassiveFlag = PassiveFlag.PASSIVE_OFF,
    ) -> Sequence[Tuple[InstanceState[_O], _O]]:
        """Return a list of tuples (state, obj) for the given
        key.

        returns an empty list if the value is None/empty/PASSIVE_NO_RESULT
        """

        impl = state.manager[key].impl
        x = impl.get(state, dict_, passive=passive)
        if x is LoaderCallableStatus.PASSIVE_NO_RESULT or x is None:
            return []
        elif is_has_collection_adapter(impl):
            return [
                (attributes.instance_state(o), o)
                for o in impl.get_collection(state, dict_, x, passive=passive)
            ]
        else:
            return [(attributes.instance_state(x), x)]

    def cascade_iterator(
        self,
        type_: str,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        visited_states: Set[InstanceState[Any]],
        halt_on: Optional[Callable[[InstanceState[Any]], bool]] = None,
    ) -> Iterator[Tuple[Any, Mapper[Any], InstanceState[Any], _InstanceDict]]:
        # assert type_ in self._cascade

        # only actively lazy load on the 'delete' cascade
        if type_ != "delete" or self.passive_deletes:
            passive = PassiveFlag.PASSIVE_NO_INITIALIZE
        else:
            passive = PassiveFlag.PASSIVE_OFF | PassiveFlag.NO_RAISE

        if type_ == "save-update":
            tuples = state.manager[self.key].impl.get_all_pending(state, dict_)
        else:
            tuples = self._value_as_iterable(
                state, dict_, self.key, passive=passive
            )

        skip_pending = (
            type_ == "refresh-expire" and "delete-orphan" not in self._cascade
        )

        for instance_state, c in tuples:
            if instance_state in visited_states:
                continue

            if c is None:
                # would like to emit a warning here, but
                # would not be consistent with collection.append(None)
                # current behavior of silently skipping.
                # see [ticket:2229]
                continue

            assert instance_state is not None
            instance_dict = attributes.instance_dict(c)

            if halt_on and halt_on(instance_state):
                continue

            if skip_pending and not instance_state.key:
                continue

            instance_mapper = instance_state.manager.mapper

            if not instance_mapper.isa(self.mapper.class_manager.mapper):
                raise AssertionError(
                    "Attribute '%s' on class '%s' "
                    "doesn't handle objects "
                    "of type '%s'"
                    % (self.key, self.parent.class_, c.__class__)
                )

            visited_states.add(instance_state)

            yield c, instance_mapper, instance_state, instance_dict

    @property
    def _effective_sync_backref(self) -> bool:
        if self.viewonly:
            return False
        else:
            return self.sync_backref is not False

    @staticmethod
    def _check_sync_backref(
        rel_a: RelationshipProperty[Any], rel_b: RelationshipProperty[Any]
    ) -> None:
        if rel_a.viewonly and rel_b.sync_backref:
            raise sa_exc.InvalidRequestError(
                "Relationship %s cannot specify sync_backref=True since %s "
                "includes viewonly=True." % (rel_b, rel_a)
            )
        if (
            rel_a.viewonly
            and not rel_b.viewonly
            and rel_b.sync_backref is not False
        ):
            rel_b.sync_backref = False

    def _add_reverse_property(self, key: str) -> None:
        other = self.mapper.get_property(key, _configure_mappers=False)
        if not isinstance(other, RelationshipProperty):
            raise sa_exc.InvalidRequestError(
                "back_populates on relationship '%s' refers to attribute '%s' "
                "that is not a relationship.  The back_populates parameter "
                "should refer to the name of a relationship on the target "
                "class." % (self, other)
            )
        # viewonly and sync_backref cases
        # 1. self.viewonly==True and other.sync_backref==True -> error
        # 2. self.viewonly==True and other.viewonly==False and
        #    other.sync_backref==None -> warn sync_backref=False, set to False
        self._check_sync_backref(self, other)
        # 3. other.viewonly==True and self.sync_backref==True -> error
        # 4. other.viewonly==True and self.viewonly==False and
        #    self.sync_backref==None -> warn sync_backref=False, set to False
        self._check_sync_backref(other, self)

        self._reverse_property.add(other)
        other._reverse_property.add(self)

        other._setup_entity()

        if not other.mapper.common_parent(self.parent):
            raise sa_exc.ArgumentError(
                "reverse_property %r on "
                "relationship %s references relationship %s, which "
                "does not reference mapper %s"
                % (key, self, other, self.parent)
            )

        if (
            other._configure_started
            and self.direction in (ONETOMANY, MANYTOONE)
            and self.direction == other.direction
        ):
            raise sa_exc.ArgumentError(
                "%s and back-reference %s are "
                "both of the same direction %r.  Did you mean to "
                "set remote_side on the many-to-one side ?"
                % (other, self, self.direction)
            )

    @util.memoized_property
    def entity(self) -> _InternalEntityType[_T]:
        """Return the target mapped entity, which is an inspect() of the
        class or aliased class that is referenced by this
        :class:`.RelationshipProperty`.

        """
        self.parent._check_configure()
        return self.entity

    @util.memoized_property
    def mapper(self) -> Mapper[_T]:
        """Return the targeted :class:`_orm.Mapper` for this
        :class:`.RelationshipProperty`.

        """
        return self.entity.mapper

    def do_init(self) -> None:
        self._check_conflicts()
        self._process_dependent_arguments()
        self._setup_entity()
        self._setup_registry_dependencies()
        self._setup_join_conditions()
        self._check_cascade_settings(self._cascade)
        self._post_init()
        self._generate_backref()
        self._join_condition._warn_for_conflicting_sync_targets()
        super().do_init()
        self._lazy_strategy = cast(
            "LazyLoader", self._get_strategy((("lazy", "select"),))
        )

    def _setup_registry_dependencies(self) -> None:
        self.parent.mapper.registry._set_depends_on(
            self.entity.mapper.registry
        )

    def _process_dependent_arguments(self) -> None:
        """Convert incoming configuration arguments to their
        proper form.

        Callables are resolved, ORM annotations removed.

        """

        # accept callables for other attributes which may require
        # deferred initialization.  This technique is used
        # by declarative "string configs" and some recipes.
        init_args = self._init_args

        for attr in (
            "order_by",
            "primaryjoin",
            "secondaryjoin",
            "secondary",
            "foreign_keys",
            "remote_side",
        ):
            rel_arg = getattr(init_args, attr)

            rel_arg._resolve_against_registry(self._clsregistry_resolvers[1])

        # remove "annotations" which are present if mapped class
        # descriptors are used to create the join expression.
        for attr in "primaryjoin", "secondaryjoin":
            rel_arg = getattr(init_args, attr)
            val = rel_arg.resolved
            if val is not None:
                rel_arg.resolved = _orm_deannotate(
                    coercions.expect(
                        roles.ColumnArgumentRole, val, argname=attr
                    )
                )

        secondary = init_args.secondary.resolved
        if secondary is not None and _is_mapped_class(secondary):
            raise sa_exc.ArgumentError(
                "secondary argument %s passed to to relationship() %s must "
                "be a Table object or other FROM clause; can't send a mapped "
                "class directly as rows in 'secondary' are persisted "
                "independently of a class that is mapped "
                "to that same table." % (secondary, self)
            )

        # ensure expressions in self.order_by, foreign_keys,
        # remote_side are all columns, not strings.
        if (
            init_args.order_by.resolved is not False
            and init_args.order_by.resolved is not None
        ):
            self.order_by = tuple(
                coercions.expect(
                    roles.ColumnArgumentRole, x, argname="order_by"
                )
                for x in util.to_list(init_args.order_by.resolved)
            )
        else:
            self.order_by = False

        self._user_defined_foreign_keys = util.column_set(
            coercions.expect(
                roles.ColumnArgumentRole, x, argname="foreign_keys"
            )
            for x in util.to_column_set(init_args.foreign_keys.resolved)
        )

        self.remote_side = util.column_set(
            coercions.expect(
                roles.ColumnArgumentRole, x, argname="remote_side"
            )
            for x in util.to_column_set(init_args.remote_side.resolved)
        )

    def declarative_scan(
        self,
        decl_scan: _ClassScanMapperConfig,
        registry: _RegistryType,
        cls: Type[Any],
        originating_module: Optional[str],
        key: str,
        mapped_container: Optional[Type[Mapped[Any]]],
        annotation: Optional[_AnnotationScanType],
        extracted_mapped_annotation: Optional[_AnnotationScanType],
        is_dataclass_field: bool,
    ) -> None:
        argument = extracted_mapped_annotation

        if extracted_mapped_annotation is None:
            if self.argument is None:
                self._raise_for_required(key, cls)
            else:
                return

        argument = extracted_mapped_annotation
        assert originating_module is not None

        is_write_only = mapped_container is not None and issubclass(
            mapped_container, WriteOnlyMapped
        )
        if is_write_only:
            self.lazy = "write_only"
            self.strategy_key = (("lazy", self.lazy),)

        is_dynamic = mapped_container is not None and issubclass(
            mapped_container, DynamicMapped
        )
        if is_dynamic:
            self.lazy = "dynamic"
            self.strategy_key = (("lazy", self.lazy),)

        argument = de_optionalize_union_types(argument)

        if hasattr(argument, "__origin__"):
            arg_origin = argument.__origin__
            if isinstance(arg_origin, type) and issubclass(
                arg_origin, abc.Collection
            ):
                if self.collection_class is None:
                    if _py_inspect.isabstract(arg_origin):
                        raise sa_exc.ArgumentError(
                            f"Collection annotation type {arg_origin} cannot "
                            "be instantiated; please provide an explicit "
                            "'collection_class' parameter "
                            "(e.g. list, set, etc.) to the "
                            "relationship() function to accompany this "
                            "annotation"
                        )

                    self.collection_class = arg_origin

            elif not is_write_only and not is_dynamic:
                self.uselist = False

            if argument.__args__:  # type: ignore
                if isinstance(arg_origin, type) and issubclass(
                    arg_origin, typing.Mapping
                ):
                    type_arg = argument.__args__[-1]  # type: ignore
                else:
                    type_arg = argument.__args__[0]  # type: ignore
                if hasattr(type_arg, "__forward_arg__"):
                    str_argument = type_arg.__forward_arg__

                    argument = resolve_name_to_real_class_name(
                        str_argument, originating_module
                    )
                else:
                    argument = type_arg
            else:
                raise sa_exc.ArgumentError(
                    f"Generic alias {argument} requires an argument"
                )
        elif hasattr(argument, "__forward_arg__"):
            argument = argument.__forward_arg__

            argument = resolve_name_to_real_class_name(
                argument, originating_module
            )

        if (
            self.collection_class is None
            and not is_write_only
            and not is_dynamic
        ):
            self.uselist = False

        # ticket #8759
        # if a lead argument was given to relationship(), like
        # `relationship("B")`, use that, don't replace it with class we
        # found in the annotation.  The declarative_scan() method call here is
        # still useful, as we continue to derive collection type and do
        # checking of the annotation in any case.
        if self.argument is None:
            self.argument = cast("_RelationshipArgumentType[_T]", argument)

    @util.preload_module("sqlalchemy.orm.mapper")
    def _setup_entity(self, __argument: Any = None) -> None:
        if "entity" in self.__dict__:
            return

        mapperlib = util.preloaded.orm_mapper

        if __argument:
            argument = __argument
        else:
            argument = self.argument

        resolved_argument: _ExternalEntityType[Any]

        if isinstance(argument, str):
            # we might want to cleanup clsregistry API to make this
            # more straightforward
            resolved_argument = cast(
                "_ExternalEntityType[Any]",
                self._clsregistry_resolve_name(argument)(),
            )
        elif callable(argument) and not isinstance(
            argument, (type, mapperlib.Mapper)
        ):
            resolved_argument = argument()
        else:
            resolved_argument = argument

        entity: _InternalEntityType[Any]

        if isinstance(resolved_argument, type):
            entity = class_mapper(resolved_argument, configure=False)
        else:
            try:
                entity = inspect(resolved_argument)
            except sa_exc.NoInspectionAvailable:
                entity = None  # type: ignore

            if not hasattr(entity, "mapper"):
                raise sa_exc.ArgumentError(
                    "relationship '%s' expects "
                    "a class or a mapper argument (received: %s)"
                    % (self.key, type(resolved_argument))
                )

        self.entity = entity
        self.target = self.entity.persist_selectable

    def _setup_join_conditions(self) -> None:
        self._join_condition = jc = JoinCondition(
            parent_persist_selectable=self.parent.persist_selectable,
            child_persist_selectable=self.entity.persist_selectable,
            parent_local_selectable=self.parent.local_table,
            child_local_selectable=self.entity.local_table,
            primaryjoin=self._init_args.primaryjoin.resolved,
            secondary=self._init_args.secondary.resolved,
            secondaryjoin=self._init_args.secondaryjoin.resolved,
            parent_equivalents=self.parent._equivalent_columns,
            child_equivalents=self.mapper._equivalent_columns,
            consider_as_foreign_keys=self._user_defined_foreign_keys,
            local_remote_pairs=self.local_remote_pairs,
            remote_side=self.remote_side,
            self_referential=self._is_self_referential,
            prop=self,
            support_sync=not self.viewonly,
            can_be_synced_fn=self._columns_are_mapped,
        )
        self.primaryjoin = jc.primaryjoin
        self.secondaryjoin = jc.secondaryjoin
        self.secondary = jc.secondary
        self.direction = jc.direction
        self.local_remote_pairs = jc.local_remote_pairs
        self.remote_side = jc.remote_columns
        self.local_columns = jc.local_columns
        self.synchronize_pairs = jc.synchronize_pairs
        self._calculated_foreign_keys = jc.foreign_key_columns
        self.secondary_synchronize_pairs = jc.secondary_synchronize_pairs

    @property
    def _clsregistry_resolve_arg(
        self,
    ) -> Callable[[str, bool], _class_resolver]:
        return self._clsregistry_resolvers[1]

    @property
    def _clsregistry_resolve_name(
        self,
    ) -> Callable[[str], Callable[[], Union[Type[Any], Table, _ModNS]]]:
        return self._clsregistry_resolvers[0]

    @util.memoized_property
    @util.preload_module("sqlalchemy.orm.clsregistry")
    def _clsregistry_resolvers(
        self,
    ) -> Tuple[
        Callable[[str], Callable[[], Union[Type[Any], Table, _ModNS]]],
        Callable[[str, bool], _class_resolver],
    ]:
        _resolver = util.preloaded.orm_clsregistry._resolver

        return _resolver(self.parent.class_, self)

    def _check_conflicts(self) -> None:
        """Test that this relationship is legal, warn about
        inheritance conflicts."""
        if self.parent.non_primary and not class_mapper(
            self.parent.class_, configure=False
        ).has_property(self.key):
            raise sa_exc.ArgumentError(
                "Attempting to assign a new "
                "relationship '%s' to a non-primary mapper on "
                "class '%s'.  New relationships can only be added "
                "to the primary mapper, i.e. the very first mapper "
                "created for class '%s' "
                % (
                    self.key,
                    self.parent.class_.__name__,
                    self.parent.class_.__name__,
                )
            )

    @property
    def cascade(self) -> CascadeOptions:
        """Return the current cascade setting for this
        :class:`.RelationshipProperty`.
        """
        return self._cascade

    @cascade.setter
    def cascade(self, cascade: Union[str, CascadeOptions]) -> None:
        self._set_cascade(cascade)

    def _set_cascade(self, cascade_arg: Union[str, CascadeOptions]) -> None:
        cascade = CascadeOptions(cascade_arg)

        if self.viewonly:
            cascade = CascadeOptions(
                cascade.intersection(CascadeOptions._viewonly_cascades)
            )

        if "mapper" in self.__dict__:
            self._check_cascade_settings(cascade)
        self._cascade = cascade

        if self._dependency_processor:
            self._dependency_processor.cascade = cascade

    def _check_cascade_settings(self, cascade: CascadeOptions) -> None:
        if (
            cascade.delete_orphan
            and not self.single_parent
            and (self.direction is MANYTOMANY or self.direction is MANYTOONE)
        ):
            raise sa_exc.ArgumentError(
                "For %(direction)s relationship %(rel)s, delete-orphan "
                "cascade is normally "
                'configured only on the "one" side of a one-to-many '
                "relationship, "
                'and not on the "many" side of a many-to-one or many-to-many '
                "relationship.  "
                "To force this relationship to allow a particular "
                '"%(relatedcls)s" object to be referenced by only '
                'a single "%(clsname)s" object at a time via the '
                "%(rel)s relationship, which "
                "would allow "
                "delete-orphan cascade to take place in this direction, set "
                "the single_parent=True flag."
                % {
                    "rel": self,
                    "direction": "many-to-one"
                    if self.direction is MANYTOONE
                    else "many-to-many",
                    "clsname": self.parent.class_.__name__,
                    "relatedcls": self.mapper.class_.__name__,
                },
                code="bbf0",
            )

        if self.passive_deletes == "all" and (
            "delete" in cascade or "delete-orphan" in cascade
        ):
            raise sa_exc.ArgumentError(
                "On %s, can't set passive_deletes='all' in conjunction "
                "with 'delete' or 'delete-orphan' cascade" % self
            )

        if cascade.delete_orphan:
            self.mapper.primary_mapper()._delete_orphans.append(
                (self.key, self.parent.class_)
            )

    def _persists_for(self, mapper: Mapper[Any]) -> bool:
        """Return True if this property will persist values on behalf
        of the given mapper.

        """

        return (
            self.key in mapper.relationships
            and mapper.relationships[self.key] is self
        )

    def _columns_are_mapped(self, *cols: ColumnElement[Any]) -> bool:
        """Return True if all columns in the given collection are
        mapped by the tables referenced by this :class:`.RelationshipProperty`.

        """

        secondary = self._init_args.secondary.resolved
        for c in cols:
            if secondary is not None and secondary.c.contains_column(c):
                continue
            if not self.parent.persist_selectable.c.contains_column(
                c
            ) and not self.target.c.contains_column(c):
                return False
        return True

    def _generate_backref(self) -> None:
        """Interpret the 'backref' instruction to create a
        :func:`_orm.relationship` complementary to this one."""

        if self.parent.non_primary:
            return
        if self.backref is not None and not self.back_populates:
            kwargs: Dict[str, Any]
            if isinstance(self.backref, str):
                backref_key, kwargs = self.backref, {}
            else:
                backref_key, kwargs = self.backref
            mapper = self.mapper.primary_mapper()

            if not mapper.concrete:
                check = set(mapper.iterate_to_root()).union(
                    mapper.self_and_descendants
                )
                for m in check:
                    if m.has_property(backref_key) and not m.concrete:
                        raise sa_exc.ArgumentError(
                            "Error creating backref "
                            "'%s' on relationship '%s': property of that "
                            "name exists on mapper '%s'"
                            % (backref_key, self, m)
                        )

            # determine primaryjoin/secondaryjoin for the
            # backref.  Use the one we had, so that
            # a custom join doesn't have to be specified in
            # both directions.
            if self.secondary is not None:
                # for many to many, just switch primaryjoin/
                # secondaryjoin.   use the annotated
                # pj/sj on the _join_condition.
                pj = kwargs.pop(
                    "primaryjoin",
                    self._join_condition.secondaryjoin_minus_local,
                )
                sj = kwargs.pop(
                    "secondaryjoin",
                    self._join_condition.primaryjoin_minus_local,
                )
            else:
                pj = kwargs.pop(
                    "primaryjoin",
                    self._join_condition.primaryjoin_reverse_remote,
                )
                sj = kwargs.pop("secondaryjoin", None)
                if sj:
                    raise sa_exc.InvalidRequestError(
                        "Can't assign 'secondaryjoin' on a backref "
                        "against a non-secondary relationship."
                    )

            foreign_keys = kwargs.pop(
                "foreign_keys", self._user_defined_foreign_keys
            )
            parent = self.parent.primary_mapper()
            kwargs.setdefault("viewonly", self.viewonly)
            kwargs.setdefault("post_update", self.post_update)
            kwargs.setdefault("passive_updates", self.passive_updates)
            kwargs.setdefault("sync_backref", self.sync_backref)
            self.back_populates = backref_key
            relationship = RelationshipProperty(
                parent,
                self.secondary,
                primaryjoin=pj,
                secondaryjoin=sj,
                foreign_keys=foreign_keys,
                back_populates=self.key,
                **kwargs,
            )
            mapper._configure_property(
                backref_key, relationship, warn_for_existing=True
            )

        if self.back_populates:
            self._add_reverse_property(self.back_populates)

    @util.preload_module("sqlalchemy.orm.dependency")
    def _post_init(self) -> None:
        dependency = util.preloaded.orm_dependency

        if self.uselist is None:
            self.uselist = self.direction is not MANYTOONE
        if not self.viewonly:
            self._dependency_processor = (  # type: ignore
                dependency.DependencyProcessor.from_relationship
            )(self)

    @util.memoized_property
    def _use_get(self) -> bool:
        """memoize the 'use_get' attribute of this RelationshipLoader's
        lazyloader."""

        strategy = self._lazy_strategy
        return strategy.use_get

    @util.memoized_property
    def _is_self_referential(self) -> bool:
        return self.mapper.common_parent(self.parent)

    def _create_joins(
        self,
        source_polymorphic: bool = False,
        source_selectable: Optional[FromClause] = None,
        dest_selectable: Optional[FromClause] = None,
        of_type_entity: Optional[_InternalEntityType[Any]] = None,
        alias_secondary: bool = False,
        extra_criteria: Tuple[ColumnElement[bool], ...] = (),
    ) -> Tuple[
        ColumnElement[bool],
        Optional[ColumnElement[bool]],
        FromClause,
        FromClause,
        Optional[FromClause],
        Optional[ClauseAdapter],
    ]:
        aliased = False

        if alias_secondary and self.secondary is not None:
            aliased = True

        if source_selectable is None:
            if source_polymorphic and self.parent.with_polymorphic:
                source_selectable = self.parent._with_polymorphic_selectable

        if of_type_entity:
            dest_mapper = of_type_entity.mapper
            if dest_selectable is None:
                dest_selectable = of_type_entity.selectable
                aliased = True
        else:
            dest_mapper = self.mapper

        if dest_selectable is None:
            dest_selectable = self.entity.selectable
            if self.mapper.with_polymorphic:
                aliased = True

            if self._is_self_referential and source_selectable is None:
                dest_selectable = dest_selectable._anonymous_fromclause()
                aliased = True
        elif (
            dest_selectable is not self.mapper._with_polymorphic_selectable
            or self.mapper.with_polymorphic
        ):
            aliased = True

        single_crit = dest_mapper._single_table_criterion
        aliased = aliased or (
            source_selectable is not None
            and (
                source_selectable
                is not self.parent._with_polymorphic_selectable
                or source_selectable._is_subquery
            )
        )

        (
            primaryjoin,
            secondaryjoin,
            secondary,
            target_adapter,
            dest_selectable,
        ) = self._join_condition.join_targets(
            source_selectable,
            dest_selectable,
            aliased,
            single_crit,
            extra_criteria,
        )
        if source_selectable is None:
            source_selectable = self.parent.local_table
        if dest_selectable is None:
            dest_selectable = self.entity.local_table
        return (
            primaryjoin,
            secondaryjoin,
            source_selectable,
            dest_selectable,
            secondary,
            target_adapter,
        )


def _annotate_columns(element: _CE, annotations: _AnnotationDict) -> _CE:
    def clone(elem: _CE) -> _CE:
        if isinstance(elem, expression.ColumnClause):
            elem = elem._annotate(annotations.copy())  # type: ignore
        elem._copy_internals(clone=clone)
        return elem

    if element is not None:
        element = clone(element)
    clone = None  # type: ignore # remove gc cycles
    return element


class JoinCondition:
    primaryjoin_initial: Optional[ColumnElement[bool]]
    primaryjoin: ColumnElement[bool]
    secondaryjoin: Optional[ColumnElement[bool]]
    secondary: Optional[FromClause]
    prop: RelationshipProperty[Any]

    synchronize_pairs: _ColumnPairs
    secondary_synchronize_pairs: _ColumnPairs
    direction: RelationshipDirection

    parent_persist_selectable: FromClause
    child_persist_selectable: FromClause
    parent_local_selectable: FromClause
    child_local_selectable: FromClause

    _local_remote_pairs: Optional[_ColumnPairs]

    def __init__(
        self,
        parent_persist_selectable: FromClause,
        child_persist_selectable: FromClause,
        parent_local_selectable: FromClause,
        child_local_selectable: FromClause,
        *,
        primaryjoin: Optional[ColumnElement[bool]] = None,
        secondary: Optional[FromClause] = None,
        secondaryjoin: Optional[ColumnElement[bool]] = None,
        parent_equivalents: Optional[_EquivalentColumnMap] = None,
        child_equivalents: Optional[_EquivalentColumnMap] = None,
        consider_as_foreign_keys: Any = None,
        local_remote_pairs: Optional[_ColumnPairs] = None,
        remote_side: Any = None,
        self_referential: Any = False,
        prop: RelationshipProperty[Any],
        support_sync: bool = True,
        can_be_synced_fn: Callable[..., bool] = lambda *c: True,
    ):
        self.parent_persist_selectable = parent_persist_selectable
        self.parent_local_selectable = parent_local_selectable
        self.child_persist_selectable = child_persist_selectable
        self.child_local_selectable = child_local_selectable
        self.parent_equivalents = parent_equivalents
        self.child_equivalents = child_equivalents
        self.primaryjoin_initial = primaryjoin
        self.secondaryjoin = secondaryjoin
        self.secondary = secondary
        self.consider_as_foreign_keys = consider_as_foreign_keys
        self._local_remote_pairs = local_remote_pairs
        self._remote_side = remote_side
        self.prop = prop
        self.self_referential = self_referential
        self.support_sync = support_sync
        self.can_be_synced_fn = can_be_synced_fn

        self._determine_joins()
        assert self.primaryjoin is not None

        self._sanitize_joins()
        self._annotate_fks()
        self._annotate_remote()
        self._annotate_local()
        self._annotate_parentmapper()
        self._setup_pairs()
        self._check_foreign_cols(self.primaryjoin, True)
        if self.secondaryjoin is not None:
            self._check_foreign_cols(self.secondaryjoin, False)
        self._determine_direction()
        self._check_remote_side()
        self._log_joins()

    def _log_joins(self) -> None:
        log = self.prop.logger
        log.info("%s setup primary join %s", self.prop, self.primaryjoin)
        log.info("%s setup secondary join %s", self.prop, self.secondaryjoin)
        log.info(
            "%s synchronize pairs [%s]",
            self.prop,
            ",".join(
                "(%s => %s)" % (l, r) for (l, r) in self.synchronize_pairs
            ),
        )
        log.info(
            "%s secondary synchronize pairs [%s]",
            self.prop,
            ",".join(
                "(%s => %s)" % (l, r)
                for (l, r) in self.secondary_synchronize_pairs or []
            ),
        )
        log.info(
            "%s local/remote pairs [%s]",
            self.prop,
            ",".join(
                "(%s / %s)" % (l, r) for (l, r) in self.local_remote_pairs
            ),
        )
        log.info(
            "%s remote columns [%s]",
            self.prop,
            ",".join("%s" % col for col in self.remote_columns),
        )
        log.info(
            "%s local columns [%s]",
            self.prop,
            ",".join("%s" % col for col in self.local_columns),
        )
        log.info("%s relationship direction %s", self.prop, self.direction)

    def _sanitize_joins(self) -> None:
        """remove the parententity annotation from our join conditions which
        can leak in here based on some declarative patterns and maybe others.

        "parentmapper" is relied upon both by the ORM evaluator as well as
        the use case in _join_fixture_inh_selfref_w_entity
        that relies upon it being present, see :ticket:`3364`.

        """

        self.primaryjoin = _deep_deannotate(
            self.primaryjoin, values=("parententity", "proxy_key")
        )
        if self.secondaryjoin is not None:
            self.secondaryjoin = _deep_deannotate(
                self.secondaryjoin, values=("parententity", "proxy_key")
            )

    def _determine_joins(self) -> None:
        """Determine the 'primaryjoin' and 'secondaryjoin' attributes,
        if not passed to the constructor already.

        This is based on analysis of the foreign key relationships
        between the parent and target mapped selectables.

        """
        if self.secondaryjoin is not None and self.secondary is None:
            raise sa_exc.ArgumentError(
                "Property %s specified with secondary "
                "join condition but "
                "no secondary argument" % self.prop
            )

        # find a join between the given mapper's mapped table and
        # the given table. will try the mapper's local table first
        # for more specificity, then if not found will try the more
        # general mapped table, which in the case of inheritance is
        # a join.
        try:
            consider_as_foreign_keys = self.consider_as_foreign_keys or None
            if self.secondary is not None:
                if self.secondaryjoin is None:
                    self.secondaryjoin = join_condition(
                        self.child_persist_selectable,
                        self.secondary,
                        a_subset=self.child_local_selectable,
                        consider_as_foreign_keys=consider_as_foreign_keys,
                    )
                if self.primaryjoin_initial is None:
                    self.primaryjoin = join_condition(
                        self.parent_persist_selectable,
                        self.secondary,
                        a_subset=self.parent_local_selectable,
                        consider_as_foreign_keys=consider_as_foreign_keys,
                    )
                else:
                    self.primaryjoin = self.primaryjoin_initial
            else:
                if self.primaryjoin_initial is None:
                    self.primaryjoin = join_condition(
                        self.parent_persist_selectable,
                        self.child_persist_selectable,
                        a_subset=self.parent_local_selectable,
                        consider_as_foreign_keys=consider_as_foreign_keys,
                    )
                else:
                    self.primaryjoin = self.primaryjoin_initial
        except sa_exc.NoForeignKeysError as nfe:
            if self.secondary is not None:
                raise sa_exc.NoForeignKeysError(
                    "Could not determine join "
                    "condition between parent/child tables on "
                    "relationship %s - there are no foreign keys "
                    "linking these tables via secondary table '%s'.  "
                    "Ensure that referencing columns are associated "
                    "with a ForeignKey or ForeignKeyConstraint, or "
                    "specify 'primaryjoin' and 'secondaryjoin' "
                    "expressions." % (self.prop, self.secondary)
                ) from nfe
            else:
                raise sa_exc.NoForeignKeysError(
                    "Could not determine join "
                    "condition between parent/child tables on "
                    "relationship %s - there are no foreign keys "
                    "linking these tables.  "
                    "Ensure that referencing columns are associated "
                    "with a ForeignKey or ForeignKeyConstraint, or "
                    "specify a 'primaryjoin' expression." % self.prop
                ) from nfe
        except sa_exc.AmbiguousForeignKeysError as afe:
            if self.secondary is not None:
                raise sa_exc.AmbiguousForeignKeysError(
                    "Could not determine join "
                    "condition between parent/child tables on "
                    "relationship %s - there are multiple foreign key "
                    "paths linking the tables via secondary table '%s'.  "
                    "Specify the 'foreign_keys' "
                    "argument, providing a list of those columns which "
                    "should be counted as containing a foreign key "
                    "reference from the secondary table to each of the "
                    "parent and child tables." % (self.prop, self.secondary)
                ) from afe
            else:
                raise sa_exc.AmbiguousForeignKeysError(
                    "Could not determine join "
                    "condition between parent/child tables on "
                    "relationship %s - there are multiple foreign key "
                    "paths linking the tables.  Specify the "
                    "'foreign_keys' argument, providing a list of those "
                    "columns which should be counted as containing a "
                    "foreign key reference to the parent table." % self.prop
                ) from afe

    @property
    def primaryjoin_minus_local(self) -> ColumnElement[bool]:
        return _deep_deannotate(self.primaryjoin, values=("local", "remote"))

    @property
    def secondaryjoin_minus_local(self) -> ColumnElement[bool]:
        assert self.secondaryjoin is not None
        return _deep_deannotate(self.secondaryjoin, values=("local", "remote"))

    @util.memoized_property
    def primaryjoin_reverse_remote(self) -> ColumnElement[bool]:
        """Return the primaryjoin condition suitable for the
        "reverse" direction.

        If the primaryjoin was delivered here with pre-existing
        "remote" annotations, the local/remote annotations
        are reversed.  Otherwise, the local/remote annotations
        are removed.

        """
        if self._has_remote_annotations:

            def replace(element: _CE, **kw: Any) -> Optional[_CE]:
                if "remote" in element._annotations:
                    v = dict(element._annotations)
                    del v["remote"]
                    v["local"] = True
                    return element._with_annotations(v)
                elif "local" in element._annotations:
                    v = dict(element._annotations)
                    del v["local"]
                    v["remote"] = True
                    return element._with_annotations(v)

                return None

            return visitors.replacement_traverse(self.primaryjoin, {}, replace)
        else:
            if self._has_foreign_annotations:
                # TODO: coverage
                return _deep_deannotate(
                    self.primaryjoin, values=("local", "remote")
                )
            else:
                return _deep_deannotate(self.primaryjoin)

    def _has_annotation(self, clause: ClauseElement, annotation: str) -> bool:
        for col in visitors.iterate(clause, {}):
            if annotation in col._annotations:
                return True
        else:
            return False

    @util.memoized_property
    def _has_foreign_annotations(self) -> bool:
        return self._has_annotation(self.primaryjoin, "foreign")

    @util.memoized_property
    def _has_remote_annotations(self) -> bool:
        return self._has_annotation(self.primaryjoin, "remote")

    def _annotate_fks(self) -> None:
        """Annotate the primaryjoin and secondaryjoin
        structures with 'foreign' annotations marking columns
        considered as foreign.

        """
        if self._has_foreign_annotations:
            return

        if self.consider_as_foreign_keys:
            self._annotate_from_fk_list()
        else:
            self._annotate_present_fks()

    def _annotate_from_fk_list(self) -> None:
        def check_fk(element: _CE, **kw: Any) -> Optional[_CE]:
            if element in self.consider_as_foreign_keys:
                return element._annotate({"foreign": True})
            return None

        self.primaryjoin = visitors.replacement_traverse(
            self.primaryjoin, {}, check_fk
        )
        if self.secondaryjoin is not None:
            self.secondaryjoin = visitors.replacement_traverse(
                self.secondaryjoin, {}, check_fk
            )

    def _annotate_present_fks(self) -> None:
        if self.secondary is not None:
            secondarycols = util.column_set(self.secondary.c)
        else:
            secondarycols = set()

        def is_foreign(
            a: ColumnElement[Any], b: ColumnElement[Any]
        ) -> Optional[ColumnElement[Any]]:
            if isinstance(a, schema.Column) and isinstance(b, schema.Column):
                if a.references(b):
                    return a
                elif b.references(a):
                    return b

            if secondarycols:
                if a in secondarycols and b not in secondarycols:
                    return a
                elif b in secondarycols and a not in secondarycols:
                    return b

            return None

        def visit_binary(binary: BinaryExpression[Any]) -> None:
            if not isinstance(
                binary.left, sql.ColumnElement
            ) or not isinstance(binary.right, sql.ColumnElement):
                return

            if (
                "foreign" not in binary.left._annotations
                and "foreign" not in binary.right._annotations
            ):
                col = is_foreign(binary.left, binary.right)
                if col is not None:
                    if col.compare(binary.left):
                        binary.left = binary.left._annotate({"foreign": True})
                    elif col.compare(binary.right):
                        binary.right = binary.right._annotate(
                            {"foreign": True}
                        )

        self.primaryjoin = visitors.cloned_traverse(
            self.primaryjoin, {}, {"binary": visit_binary}
        )
        if self.secondaryjoin is not None:
            self.secondaryjoin = visitors.cloned_traverse(
                self.secondaryjoin, {}, {"binary": visit_binary}
            )

    def _refers_to_parent_table(self) -> bool:
        """Return True if the join condition contains column
        comparisons where both columns are in both tables.

        """
        pt = self.parent_persist_selectable
        mt = self.child_persist_selectable
        result = False

        def visit_binary(binary: BinaryExpression[Any]) -> None:
            nonlocal result
            c, f = binary.left, binary.right
            if (
                isinstance(c, expression.ColumnClause)
                and isinstance(f, expression.ColumnClause)
                and pt.is_derived_from(c.table)
                and pt.is_derived_from(f.table)
                and mt.is_derived_from(c.table)
                and mt.is_derived_from(f.table)
            ):
                result = True

        visitors.traverse(self.primaryjoin, {}, {"binary": visit_binary})
        return result

    def _tables_overlap(self) -> bool:
        """Return True if parent/child tables have some overlap."""

        return selectables_overlap(
            self.parent_persist_selectable, self.child_persist_selectable
        )

    def _annotate_remote(self) -> None:
        """Annotate the primaryjoin and secondaryjoin
        structures with 'remote' annotations marking columns
        considered as part of the 'remote' side.

        """
        if self._has_remote_annotations:
            return

        if self.secondary is not None:
            self._annotate_remote_secondary()
        elif self._local_remote_pairs or self._remote_side:
            self._annotate_remote_from_args()
        elif self._refers_to_parent_table():
            self._annotate_selfref(
                lambda col: "foreign" in col._annotations, False
            )
        elif self._tables_overlap():
            self._annotate_remote_with_overlap()
        else:
            self._annotate_remote_distinct_selectables()

    def _annotate_remote_secondary(self) -> None:
        """annotate 'remote' in primaryjoin, secondaryjoin
        when 'secondary' is present.

        """

        assert self.secondary is not None
        fixed_secondary = self.secondary

        def repl(element: _CE, **kw: Any) -> Optional[_CE]:
            if fixed_secondary.c.contains_column(element):
                return element._annotate({"remote": True})
            return None

        self.primaryjoin = visitors.replacement_traverse(
            self.primaryjoin, {}, repl
        )

        assert self.secondaryjoin is not None
        self.secondaryjoin = visitors.replacement_traverse(
            self.secondaryjoin, {}, repl
        )

    def _annotate_selfref(
        self, fn: Callable[[ColumnElement[Any]], bool], remote_side_given: bool
    ) -> None:
        """annotate 'remote' in primaryjoin, secondaryjoin
        when the relationship is detected as self-referential.

        """

        def visit_binary(binary: BinaryExpression[Any]) -> None:
            equated = binary.left.compare(binary.right)
            if isinstance(binary.left, expression.ColumnClause) and isinstance(
                binary.right, expression.ColumnClause
            ):
                # assume one to many - FKs are "remote"
                if fn(binary.left):
                    binary.left = binary.left._annotate({"remote": True})
                if fn(binary.right) and not equated:
                    binary.right = binary.right._annotate({"remote": True})
            elif not remote_side_given:
                self._warn_non_column_elements()

        self.primaryjoin = visitors.cloned_traverse(
            self.primaryjoin, {}, {"binary": visit_binary}
        )

    def _annotate_remote_from_args(self) -> None:
        """annotate 'remote' in primaryjoin, secondaryjoin
        when the 'remote_side' or '_local_remote_pairs'
        arguments are used.

        """
        if self._local_remote_pairs:
            if self._remote_side:
                raise sa_exc.ArgumentError(
                    "remote_side argument is redundant "
                    "against more detailed _local_remote_side "
                    "argument."
                )

            remote_side = [r for (l, r) in self._local_remote_pairs]
        else:
            remote_side = self._remote_side

        if self._refers_to_parent_table():
            self._annotate_selfref(lambda col: col in remote_side, True)
        else:

            def repl(element: _CE, **kw: Any) -> Optional[_CE]:
                # use set() to avoid generating ``__eq__()`` expressions
                # against each element
                if element in set(remote_side):
                    return element._annotate({"remote": True})
                return None

            self.primaryjoin = visitors.replacement_traverse(
                self.primaryjoin, {}, repl
            )

    def _annotate_remote_with_overlap(self) -> None:
        """annotate 'remote' in primaryjoin, secondaryjoin
        when the parent/child tables have some set of
        tables in common, though is not a fully self-referential
        relationship.

        """

        def visit_binary(binary: BinaryExpression[Any]) -> None:
            binary.left, binary.right = proc_left_right(
                binary.left, binary.right
            )
            binary.right, binary.left = proc_left_right(
                binary.right, binary.left
            )

        check_entities = (
            self.prop is not None and self.prop.mapper is not self.prop.parent
        )

        def proc_left_right(
            left: ColumnElement[Any], right: ColumnElement[Any]
        ) -> Tuple[ColumnElement[Any], ColumnElement[Any]]:
            if isinstance(left, expression.ColumnClause) and isinstance(
                right, expression.ColumnClause
            ):
                if self.child_persist_selectable.c.contains_column(
                    right
                ) and self.parent_persist_selectable.c.contains_column(left):
                    right = right._annotate({"remote": True})
            elif (
                check_entities
                and right._annotations.get("parentmapper") is self.prop.mapper
            ):
                right = right._annotate({"remote": True})
            elif (
                check_entities
                and left._annotations.get("parentmapper") is self.prop.mapper
            ):
                left = left._annotate({"remote": True})
            else:
                self._warn_non_column_elements()

            return left, right

        self.primaryjoin = visitors.cloned_traverse(
            self.primaryjoin, {}, {"binary": visit_binary}
        )

    def _annotate_remote_distinct_selectables(self) -> None:
        """annotate 'remote' in primaryjoin, secondaryjoin
        when the parent/child tables are entirely
        separate.

        """

        def repl(element: _CE, **kw: Any) -> Optional[_CE]:
            if self.child_persist_selectable.c.contains_column(element) and (
                not self.parent_local_selectable.c.contains_column(element)
                or self.child_local_selectable.c.contains_column(element)
            ):
                return element._annotate({"remote": True})
            return None

        self.primaryjoin = visitors.replacement_traverse(
            self.primaryjoin, {}, repl
        )

    def _warn_non_column_elements(self) -> None:
        util.warn(
            "Non-simple column elements in primary "
            "join condition for property %s - consider using "
            "remote() annotations to mark the remote side." % self.prop
        )

    def _annotate_local(self) -> None:
        """Annotate the primaryjoin and secondaryjoin
        structures with 'local' annotations.

        This annotates all column elements found
        simultaneously in the parent table
        and the join condition that don't have a
        'remote' annotation set up from
        _annotate_remote() or user-defined.

        """
        if self._has_annotation(self.primaryjoin, "local"):
            return

        if self._local_remote_pairs:
            local_side = util.column_set(
                [l for (l, r) in self._local_remote_pairs]
            )
        else:
            local_side = util.column_set(self.parent_persist_selectable.c)

        def locals_(element: _CE, **kw: Any) -> Optional[_CE]:
            if "remote" not in element._annotations and element in local_side:
                return element._annotate({"local": True})
            return None

        self.primaryjoin = visitors.replacement_traverse(
            self.primaryjoin, {}, locals_
        )

    def _annotate_parentmapper(self) -> None:
        def parentmappers_(element: _CE, **kw: Any) -> Optional[_CE]:
            if "remote" in element._annotations:
                return element._annotate({"parentmapper": self.prop.mapper})
            elif "local" in element._annotations:
                return element._annotate({"parentmapper": self.prop.parent})
            return None

        self.primaryjoin = visitors.replacement_traverse(
            self.primaryjoin, {}, parentmappers_
        )

    def _check_remote_side(self) -> None:
        if not self.local_remote_pairs:
            raise sa_exc.ArgumentError(
                "Relationship %s could "
                "not determine any unambiguous local/remote column "
                "pairs based on join condition and remote_side "
                "arguments.  "
                "Consider using the remote() annotation to "
                "accurately mark those elements of the join "
                "condition that are on the remote side of "
                "the relationship." % (self.prop,)
            )
        else:
            not_target = util.column_set(
                self.parent_persist_selectable.c
            ).difference(self.child_persist_selectable.c)

            for _, rmt in self.local_remote_pairs:
                if rmt in not_target:
                    util.warn(
                        "Expression %s is marked as 'remote', but these "
                        "column(s) are local to the local side.  The "
                        "remote() annotation is needed only for a "
                        "self-referential relationship where both sides "
                        "of the relationship refer to the same tables."
                        % (rmt,)
                    )

    def _check_foreign_cols(
        self, join_condition: ColumnElement[bool], primary: bool
    ) -> None:
        """Check the foreign key columns collected and emit error
        messages."""

        can_sync = False

        foreign_cols = self._gather_columns_with_annotation(
            join_condition, "foreign"
        )

        has_foreign = bool(foreign_cols)

        if primary:
            can_sync = bool(self.synchronize_pairs)
        else:
            can_sync = bool(self.secondary_synchronize_pairs)

        if (
            self.support_sync
            and can_sync
            or (not self.support_sync and has_foreign)
        ):
            return

        # from here below is just determining the best error message
        # to report.  Check for a join condition using any operator
        # (not just ==), perhaps they need to turn on "viewonly=True".
        if self.support_sync and has_foreign and not can_sync:
            err = (
                "Could not locate any simple equality expressions "
                "involving locally mapped foreign key columns for "
                "%s join condition "
                "'%s' on relationship %s."
                % (
                    primary and "primary" or "secondary",
                    join_condition,
                    self.prop,
                )
            )
            err += (
                "  Ensure that referencing columns are associated "
                "with a ForeignKey or ForeignKeyConstraint, or are "
                "annotated in the join condition with the foreign() "
                "annotation. To allow comparison operators other than "
                "'==', the relationship can be marked as viewonly=True."
            )

            raise sa_exc.ArgumentError(err)
        else:
            err = (
                "Could not locate any relevant foreign key columns "
                "for %s join condition '%s' on relationship %s."
                % (
                    primary and "primary" or "secondary",
                    join_condition,
                    self.prop,
                )
            )
            err += (
                "  Ensure that referencing columns are associated "
                "with a ForeignKey or ForeignKeyConstraint, or are "
                "annotated in the join condition with the foreign() "
                "annotation."
            )
            raise sa_exc.ArgumentError(err)

    def _determine_direction(self) -> None:
        """Determine if this relationship is one to many, many to one,
        many to many.

        """
        if self.secondaryjoin is not None:
            self.direction = MANYTOMANY
        else:
            parentcols = util.column_set(self.parent_persist_selectable.c)
            targetcols = util.column_set(self.child_persist_selectable.c)

            # fk collection which suggests ONETOMANY.
            onetomany_fk = targetcols.intersection(self.foreign_key_columns)

            # fk collection which suggests MANYTOONE.

            manytoone_fk = parentcols.intersection(self.foreign_key_columns)

            if onetomany_fk and manytoone_fk:
                # fks on both sides.  test for overlap of local/remote
                # with foreign key.
                # we will gather columns directly from their annotations
                # without deannotating, so that we can distinguish on a column
                # that refers to itself.

                # 1. columns that are both remote and FK suggest
                # onetomany.
                onetomany_local = self._gather_columns_with_annotation(
                    self.primaryjoin, "remote", "foreign"
                )

                # 2. columns that are FK but are not remote (e.g. local)
                # suggest manytoone.
                manytoone_local = {
                    c
                    for c in self._gather_columns_with_annotation(
                        self.primaryjoin, "foreign"
                    )
                    if "remote" not in c._annotations
                }

                # 3. if both collections are present, remove columns that
                # refer to themselves.  This is for the case of
                # and_(Me.id == Me.remote_id, Me.version == Me.version)
                if onetomany_local and manytoone_local:
                    self_equated = self.remote_columns.intersection(
                        self.local_columns
                    )
                    onetomany_local = onetomany_local.difference(self_equated)
                    manytoone_local = manytoone_local.difference(self_equated)

                # at this point, if only one or the other collection is
                # present, we know the direction, otherwise it's still
                # ambiguous.

                if onetomany_local and not manytoone_local:
                    self.direction = ONETOMANY
                elif manytoone_local and not onetomany_local:
                    self.direction = MANYTOONE
                else:
                    raise sa_exc.ArgumentError(
                        "Can't determine relationship"
                        " direction for relationship '%s' - foreign "
                        "key columns within the join condition are present "
                        "in both the parent and the child's mapped tables.  "
                        "Ensure that only those columns referring "
                        "to a parent column are marked as foreign, "
                        "either via the foreign() annotation or "
                        "via the foreign_keys argument." % self.prop
                    )
            elif onetomany_fk:
                self.direction = ONETOMANY
            elif manytoone_fk:
                self.direction = MANYTOONE
            else:
                raise sa_exc.ArgumentError(
                    "Can't determine relationship "
                    "direction for relationship '%s' - foreign "
                    "key columns are present in neither the parent "
                    "nor the child's mapped tables" % self.prop
                )

    def _deannotate_pairs(
        self, collection: _ColumnPairIterable
    ) -> _MutableColumnPairs:
        """provide deannotation for the various lists of
        pairs, so that using them in hashes doesn't incur
        high-overhead __eq__() comparisons against
        original columns mapped.

        """
        return [(x._deannotate(), y._deannotate()) for x, y in collection]

    def _setup_pairs(self) -> None:
        sync_pairs: _MutableColumnPairs = []
        lrp: util.OrderedSet[
            Tuple[ColumnElement[Any], ColumnElement[Any]]
        ] = util.OrderedSet([])
        secondary_sync_pairs: _MutableColumnPairs = []

        def go(
            joincond: ColumnElement[bool],
            collection: _MutableColumnPairs,
        ) -> None:
            def visit_binary(
                binary: BinaryExpression[Any],
                left: ColumnElement[Any],
                right: ColumnElement[Any],
            ) -> None:
                if (
                    "remote" in right._annotations
                    and "remote" not in left._annotations
                    and self.can_be_synced_fn(left)
                ):
                    lrp.add((left, right))
                elif (
                    "remote" in left._annotations
                    and "remote" not in right._annotations
                    and self.can_be_synced_fn(right)
                ):
                    lrp.add((right, left))
                if binary.operator is operators.eq and self.can_be_synced_fn(
                    left, right
                ):
                    if "foreign" in right._annotations:
                        collection.append((left, right))
                    elif "foreign" in left._annotations:
                        collection.append((right, left))

            visit_binary_product(visit_binary, joincond)

        for joincond, collection in [
            (self.primaryjoin, sync_pairs),
            (self.secondaryjoin, secondary_sync_pairs),
        ]:
            if joincond is None:
                continue
            go(joincond, collection)

        self.local_remote_pairs = self._deannotate_pairs(lrp)
        self.synchronize_pairs = self._deannotate_pairs(sync_pairs)
        self.secondary_synchronize_pairs = self._deannotate_pairs(
            secondary_sync_pairs
        )

    _track_overlapping_sync_targets: weakref.WeakKeyDictionary[
        ColumnElement[Any],
        weakref.WeakKeyDictionary[
            RelationshipProperty[Any], ColumnElement[Any]
        ],
    ] = weakref.WeakKeyDictionary()

    def _warn_for_conflicting_sync_targets(self) -> None:
        if not self.support_sync:
            return

        # we would like to detect if we are synchronizing any column
        # pairs in conflict with another relationship that wishes to sync
        # an entirely different column to the same target.   This is a
        # very rare edge case so we will try to minimize the memory/overhead
        # impact of this check
        for from_, to_ in [
            (from_, to_) for (from_, to_) in self.synchronize_pairs
        ] + [
            (from_, to_) for (from_, to_) in self.secondary_synchronize_pairs
        ]:
            # save ourselves a ton of memory and overhead by only
            # considering columns that are subject to a overlapping
            # FK constraints at the core level.   This condition can arise
            # if multiple relationships overlap foreign() directly, but
            # we're going to assume it's typically a ForeignKeyConstraint-
            # level configuration that benefits from this warning.

            if to_ not in self._track_overlapping_sync_targets:
                self._track_overlapping_sync_targets[
                    to_
                ] = weakref.WeakKeyDictionary({self.prop: from_})
            else:
                other_props = []
                prop_to_from = self._track_overlapping_sync_targets[to_]

                for pr, fr_ in prop_to_from.items():
                    if (
                        not pr.mapper._dispose_called
                        and pr not in self.prop._reverse_property
                        and pr.key not in self.prop._overlaps
                        and self.prop.key not in pr._overlaps
                        # note: the "__*" symbol is used internally by
                        # SQLAlchemy as a general means of suppressing the
                        # overlaps warning for some extension cases, however
                        # this is not currently
                        # a publicly supported symbol and may change at
                        # any time.
                        and "__*" not in self.prop._overlaps
                        and "__*" not in pr._overlaps
                        and not self.prop.parent.is_sibling(pr.parent)
                        and not self.prop.mapper.is_sibling(pr.mapper)
                        and not self.prop.parent.is_sibling(pr.mapper)
                        and not self.prop.mapper.is_sibling(pr.parent)
                        and (
                            self.prop.key != pr.key
                            or not self.prop.parent.common_parent(pr.parent)
                        )
                    ):
                        other_props.append((pr, fr_))

                if other_props:
                    util.warn(
                        "relationship '%s' will copy column %s to column %s, "
                        "which conflicts with relationship(s): %s. "
                        "If this is not the intention, consider if these "
                        "relationships should be linked with "
                        "back_populates, or if viewonly=True should be "
                        "applied to one or more if they are read-only. "
                        "For the less common case that foreign key "
                        "constraints are partially overlapping, the "
                        "orm.foreign() "
                        "annotation can be used to isolate the columns that "
                        "should be written towards.   To silence this "
                        "warning, add the parameter 'overlaps=\"%s\"' to the "
                        "'%s' relationship."
                        % (
                            self.prop,
                            from_,
                            to_,
                            ", ".join(
                                sorted(
                                    "'%s' (copies %s to %s)" % (pr, fr_, to_)
                                    for (pr, fr_) in other_props
                                )
                            ),
                            ",".join(sorted(pr.key for pr, fr in other_props)),
                            self.prop,
                        ),
                        code="qzyx",
                    )
                self._track_overlapping_sync_targets[to_][self.prop] = from_

    @util.memoized_property
    def remote_columns(self) -> Set[ColumnElement[Any]]:
        return self._gather_join_annotations("remote")

    @util.memoized_property
    def local_columns(self) -> Set[ColumnElement[Any]]:
        return self._gather_join_annotations("local")

    @util.memoized_property
    def foreign_key_columns(self) -> Set[ColumnElement[Any]]:
        return self._gather_join_annotations("foreign")

    def _gather_join_annotations(
        self, annotation: str
    ) -> Set[ColumnElement[Any]]:
        s = set(
            self._gather_columns_with_annotation(self.primaryjoin, annotation)
        )
        if self.secondaryjoin is not None:
            s.update(
                self._gather_columns_with_annotation(
                    self.secondaryjoin, annotation
                )
            )
        return {x._deannotate() for x in s}

    def _gather_columns_with_annotation(
        self, clause: ColumnElement[Any], *annotation: Iterable[str]
    ) -> Set[ColumnElement[Any]]:
        annotation_set = set(annotation)
        return {
            cast(ColumnElement[Any], col)
            for col in visitors.iterate(clause, {})
            if annotation_set.issubset(col._annotations)
        }

    def join_targets(
        self,
        source_selectable: Optional[FromClause],
        dest_selectable: FromClause,
        aliased: bool,
        single_crit: Optional[ColumnElement[bool]] = None,
        extra_criteria: Tuple[ColumnElement[bool], ...] = (),
    ) -> Tuple[
        ColumnElement[bool],
        Optional[ColumnElement[bool]],
        Optional[FromClause],
        Optional[ClauseAdapter],
        FromClause,
    ]:
        """Given a source and destination selectable, create a
        join between them.

        This takes into account aliasing the join clause
        to reference the appropriate corresponding columns
        in the target objects, as well as the extra child
        criterion, equivalent column sets, etc.

        """
        # place a barrier on the destination such that
        # replacement traversals won't ever dig into it.
        # its internal structure remains fixed
        # regardless of context.
        dest_selectable = _shallow_annotate(
            dest_selectable, {"no_replacement_traverse": True}
        )

        primaryjoin, secondaryjoin, secondary = (
            self.primaryjoin,
            self.secondaryjoin,
            self.secondary,
        )

        # adjust the join condition for single table inheritance,
        # in the case that the join is to a subclass
        # this is analogous to the
        # "_adjust_for_single_table_inheritance()" method in Query.

        if single_crit is not None:
            if secondaryjoin is not None:
                secondaryjoin = secondaryjoin & single_crit
            else:
                primaryjoin = primaryjoin & single_crit

        if extra_criteria:

            def mark_unrelated_columns_as_ok_to_adapt(
                elem: SupportsAnnotations, annotations: _AnnotationDict
            ) -> SupportsAnnotations:
                """note unrelated columns in the "extra criteria" as OK
                to adapt, even though they are not part of our "local"
                or "remote" side.

                see #9779 for this case

                """

                parentmapper_for_element = elem._annotations.get(
                    "parentmapper", None
                )
                if (
                    parentmapper_for_element is not self.prop.parent
                    and parentmapper_for_element is not self.prop.mapper
                ):
                    return _safe_annotate(elem, annotations)
                else:
                    return elem

            extra_criteria = tuple(
                _deep_annotate(
                    elem,
                    {"ok_to_adapt_in_join_condition": True},
                    annotate_callable=mark_unrelated_columns_as_ok_to_adapt,
                )
                for elem in extra_criteria
            )

            if secondaryjoin is not None:
                secondaryjoin = secondaryjoin & sql.and_(*extra_criteria)
            else:
                primaryjoin = primaryjoin & sql.and_(*extra_criteria)

        if aliased:
            if secondary is not None:
                secondary = secondary._anonymous_fromclause(flat=True)
                primary_aliasizer = ClauseAdapter(
                    secondary, exclude_fn=_ColInAnnotations("local")
                )
                secondary_aliasizer = ClauseAdapter(
                    dest_selectable, equivalents=self.child_equivalents
                ).chain(primary_aliasizer)
                if source_selectable is not None:
                    primary_aliasizer = ClauseAdapter(
                        secondary, exclude_fn=_ColInAnnotations("local")
                    ).chain(
                        ClauseAdapter(
                            source_selectable,
                            equivalents=self.parent_equivalents,
                        )
                    )

                secondaryjoin = secondary_aliasizer.traverse(secondaryjoin)
            else:
                primary_aliasizer = ClauseAdapter(
                    dest_selectable,
                    exclude_fn=_ColInAnnotations("local"),
                    equivalents=self.child_equivalents,
                )
                if source_selectable is not None:
                    primary_aliasizer.chain(
                        ClauseAdapter(
                            source_selectable,
                            exclude_fn=_ColInAnnotations("remote"),
                            equivalents=self.parent_equivalents,
                        )
                    )
                secondary_aliasizer = None

            primaryjoin = primary_aliasizer.traverse(primaryjoin)
            target_adapter = secondary_aliasizer or primary_aliasizer
            target_adapter.exclude_fn = None
        else:
            target_adapter = None
        return (
            primaryjoin,
            secondaryjoin,
            secondary,
            target_adapter,
            dest_selectable,
        )

    def create_lazy_clause(
        self, reverse_direction: bool = False
    ) -> Tuple[
        ColumnElement[bool],
        Dict[str, ColumnElement[Any]],
        Dict[ColumnElement[Any], ColumnElement[Any]],
    ]:
        binds: Dict[ColumnElement[Any], BindParameter[Any]] = {}
        equated_columns: Dict[ColumnElement[Any], ColumnElement[Any]] = {}

        has_secondary = self.secondaryjoin is not None

        if has_secondary:
            lookup = collections.defaultdict(list)
            for l, r in self.local_remote_pairs:
                lookup[l].append((l, r))
                equated_columns[r] = l
        elif not reverse_direction:
            for l, r in self.local_remote_pairs:
                equated_columns[r] = l
        else:
            for l, r in self.local_remote_pairs:
                equated_columns[l] = r

        def col_to_bind(
            element: ColumnElement[Any], **kw: Any
        ) -> Optional[BindParameter[Any]]:
            if (
                (not reverse_direction and "local" in element._annotations)
                or reverse_direction
                and (
                    (has_secondary and element in lookup)
                    or (not has_secondary and "remote" in element._annotations)
                )
            ):
                if element not in binds:
                    binds[element] = sql.bindparam(
                        None, None, type_=element.type, unique=True
                    )
                return binds[element]
            return None

        lazywhere = self.primaryjoin
        if self.secondaryjoin is None or not reverse_direction:
            lazywhere = visitors.replacement_traverse(
                lazywhere, {}, col_to_bind
            )

        if self.secondaryjoin is not None:
            secondaryjoin = self.secondaryjoin
            if reverse_direction:
                secondaryjoin = visitors.replacement_traverse(
                    secondaryjoin, {}, col_to_bind
                )
            lazywhere = sql.and_(lazywhere, secondaryjoin)

        bind_to_col = {binds[col].key: col for col in binds}

        return lazywhere, bind_to_col, equated_columns


class _ColInAnnotations:
    """Serializable object that tests for a name in c._annotations."""

    __slots__ = ("name",)

    def __init__(self, name: str):
        self.name = name

    def __call__(self, c: ClauseElement) -> bool:
        return (
            self.name in c._annotations
            or "ok_to_adapt_in_join_condition" in c._annotations
        )


class Relationship(  # type: ignore
    RelationshipProperty[_T],
    _DeclarativeMapped[_T],
    WriteOnlyMapped[_T],  # not compatible with Mapped[_T]
    DynamicMapped[_T],  # not compatible with Mapped[_T]
):
    """Describes an object property that holds a single item or list
    of items that correspond to a related database table.

    Public constructor is the :func:`_orm.relationship` function.

    .. seealso::

        :ref:`relationship_config_toplevel`

    .. versionchanged:: 2.0 Added :class:`_orm.Relationship` as a Declarative
       compatible subclass for :class:`_orm.RelationshipProperty`.

    """

    inherit_cache = True
    """:meta private:"""
