# orm/query.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""The Query class and support.

Defines the :class:`_query.Query` class, the central
construct used by the ORM to construct database queries.

The :class:`_query.Query` class should not be confused with the
:class:`_expression.Select` class, which defines database
SELECT operations at the SQL (non-ORM) level.  ``Query`` differs from
``Select`` in that it returns ORM-mapped objects and interacts with an
ORM session, whereas the ``Select`` construct interacts directly with the
database to return iterable result sets.

"""
from __future__ import annotations

import collections.abc as collections_abc
import operator
from typing import Any
from typing import Callable
from typing import cast
from typing import Dict
from typing import Generic
from typing import Iterable
from typing import Iterator
from typing import List
from typing import Mapping
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import attributes
from . import interfaces
from . import loading
from . import util as orm_util
from ._typing import _O
from .base import _assertions
from .context import _column_descriptions
from .context import _determine_last_joined_entity
from .context import _legacy_filter_by_entity_zero
from .context import FromStatement
from .context import ORMCompileState
from .context import QueryContext
from .interfaces import ORMColumnDescription
from .interfaces import ORMColumnsClauseRole
from .util import AliasedClass
from .util import object_mapper
from .util import with_parent
from .. import exc as sa_exc
from .. import inspect
from .. import inspection
from .. import log
from .. import sql
from .. import util
from ..engine import Result
from ..engine import Row
from ..event import dispatcher
from ..event import EventTarget
from ..sql import coercions
from ..sql import expression
from ..sql import roles
from ..sql import Select
from ..sql import util as sql_util
from ..sql import visitors
from ..sql._typing import _FromClauseArgument
from ..sql._typing import _TP
from ..sql.annotation import SupportsCloneAnnotations
from ..sql.base import _entity_namespace_key
from ..sql.base import _generative
from ..sql.base import _NoArg
from ..sql.base import Executable
from ..sql.base import Generative
from ..sql.elements import BooleanClauseList
from ..sql.expression import Exists
from ..sql.selectable import _MemoizedSelectEntities
from ..sql.selectable import _SelectFromElements
from ..sql.selectable import ForUpdateArg
from ..sql.selectable import HasHints
from ..sql.selectable import HasPrefixes
from ..sql.selectable import HasSuffixes
from ..sql.selectable import LABEL_STYLE_TABLENAME_PLUS_COL
from ..sql.selectable import SelectLabelStyle
from ..util.typing import Literal
from ..util.typing import Self


if TYPE_CHECKING:
    from ._typing import _EntityType
    from ._typing import _ExternalEntityType
    from ._typing import _InternalEntityType
    from ._typing import SynchronizeSessionArgument
    from .mapper import Mapper
    from .path_registry import PathRegistry
    from .session import _PKIdentityArgument
    from .session import Session
    from .state import InstanceState
    from ..engine.cursor import CursorResult
    from ..engine.interfaces import _ImmutableExecuteOptions
    from ..engine.interfaces import CompiledCacheType
    from ..engine.interfaces import IsolationLevel
    from ..engine.interfaces import SchemaTranslateMapType
    from ..engine.result import FrozenResult
    from ..engine.result import ScalarResult
    from ..sql._typing import _ColumnExpressionArgument
    from ..sql._typing import _ColumnExpressionOrStrLabelArgument
    from ..sql._typing import _ColumnsClauseArgument
    from ..sql._typing import _DMLColumnArgument
    from ..sql._typing import _JoinTargetArgument
    from ..sql._typing import _LimitOffsetType
    from ..sql._typing import _MAYBE_ENTITY
    from ..sql._typing import _no_kw
    from ..sql._typing import _NOT_ENTITY
    from ..sql._typing import _OnClauseArgument
    from ..sql._typing import _PropagateAttrsType
    from ..sql._typing import _T0
    from ..sql._typing import _T1
    from ..sql._typing import _T2
    from ..sql._typing import _T3
    from ..sql._typing import _T4
    from ..sql._typing import _T5
    from ..sql._typing import _T6
    from ..sql._typing import _T7
    from ..sql._typing import _TypedColumnClauseArgument as _TCCA
    from ..sql.base import CacheableOptions
    from ..sql.base import ExecutableOption
    from ..sql.elements import ColumnElement
    from ..sql.elements import Label
    from ..sql.selectable import _ForUpdateOfArgument
    from ..sql.selectable import _JoinTargetElement
    from ..sql.selectable import _SetupJoinsElement
    from ..sql.selectable import Alias
    from ..sql.selectable import CTE
    from ..sql.selectable import ExecutableReturnsRows
    from ..sql.selectable import FromClause
    from ..sql.selectable import ScalarSelect
    from ..sql.selectable import Subquery


__all__ = ["Query", "QueryContext"]

_T = TypeVar("_T", bound=Any)


@inspection._self_inspects
@log.class_logger
class Query(
    _SelectFromElements,
    SupportsCloneAnnotations,
    HasPrefixes,
    HasSuffixes,
    HasHints,
    EventTarget,
    log.Identified,
    Generative,
    Executable,
    Generic[_T],
):

    """ORM-level SQL construction object.

    .. legacy:: The ORM :class:`.Query` object is a legacy construct
       as of SQLAlchemy 2.0.   See the notes at the top of
       :ref:`query_api_toplevel` for an overview, including links to migration
       documentation.

    :class:`_query.Query` objects are normally initially generated using the
    :meth:`~.Session.query` method of :class:`.Session`, and in
    less common cases by instantiating the :class:`_query.Query` directly and
    associating with a :class:`.Session` using the
    :meth:`_query.Query.with_session`
    method.

    """

    # elements that are in Core and can be cached in the same way
    _where_criteria: Tuple[ColumnElement[Any], ...] = ()
    _having_criteria: Tuple[ColumnElement[Any], ...] = ()

    _order_by_clauses: Tuple[ColumnElement[Any], ...] = ()
    _group_by_clauses: Tuple[ColumnElement[Any], ...] = ()
    _limit_clause: Optional[ColumnElement[Any]] = None
    _offset_clause: Optional[ColumnElement[Any]] = None

    _distinct: bool = False
    _distinct_on: Tuple[ColumnElement[Any], ...] = ()

    _for_update_arg: Optional[ForUpdateArg] = None
    _correlate: Tuple[FromClause, ...] = ()
    _auto_correlate: bool = True
    _from_obj: Tuple[FromClause, ...] = ()
    _setup_joins: Tuple[_SetupJoinsElement, ...] = ()

    _label_style: SelectLabelStyle = SelectLabelStyle.LABEL_STYLE_LEGACY_ORM

    _memoized_select_entities = ()

    _compile_options: Union[
        Type[CacheableOptions], CacheableOptions
    ] = ORMCompileState.default_compile_options

    _with_options: Tuple[ExecutableOption, ...]
    load_options = QueryContext.default_load_options + {
        "_legacy_uniquing": True
    }

    _params: util.immutabledict[str, Any] = util.EMPTY_DICT

    # local Query builder state, not needed for
    # compilation or execution
    _enable_assertions = True

    _statement: Optional[ExecutableReturnsRows] = None

    session: Session

    dispatch: dispatcher[Query[_T]]

    # mirrors that of ClauseElement, used to propagate the "orm"
    # plugin as well as the "subject" of the plugin, e.g. the mapper
    # we are querying against.
    @util.memoized_property
    def _propagate_attrs(self) -> _PropagateAttrsType:
        return util.EMPTY_DICT

    def __init__(
        self,
        entities: Union[
            _ColumnsClauseArgument[Any], Sequence[_ColumnsClauseArgument[Any]]
        ],
        session: Optional[Session] = None,
    ):
        """Construct a :class:`_query.Query` directly.

        E.g.::

            q = Query([User, Address], session=some_session)

        The above is equivalent to::

            q = some_session.query(User, Address)

        :param entities: a sequence of entities and/or SQL expressions.

        :param session: a :class:`.Session` with which the
         :class:`_query.Query`
         will be associated.   Optional; a :class:`_query.Query`
         can be associated
         with a :class:`.Session` generatively via the
         :meth:`_query.Query.with_session` method as well.

        .. seealso::

            :meth:`.Session.query`

            :meth:`_query.Query.with_session`

        """

        # session is usually present.  There's one case in subqueryloader
        # where it stores a Query without a Session and also there are tests
        # for the query(Entity).with_session(session) API which is likely in
        # some old recipes, however these are legacy as select() can now be
        # used.
        self.session = session  # type: ignore
        self._set_entities(entities)

    def _set_propagate_attrs(self, values: Mapping[str, Any]) -> Self:
        self._propagate_attrs = util.immutabledict(values)
        return self

    def _set_entities(
        self,
        entities: Union[
            _ColumnsClauseArgument[Any], Iterable[_ColumnsClauseArgument[Any]]
        ],
    ) -> None:
        self._raw_columns = [
            coercions.expect(
                roles.ColumnsClauseRole,
                ent,
                apply_propagate_attrs=self,
                post_inspect=True,
            )
            for ent in util.to_list(entities)
        ]

    def tuples(self: Query[_O]) -> Query[Tuple[_O]]:
        """return a tuple-typed form of this :class:`.Query`.

        This method invokes the :meth:`.Query.only_return_tuples`
        method with a value of ``True``, which by itself ensures that this
        :class:`.Query` will always return :class:`.Row` objects, even
        if the query is made against a single entity.  It then also
        at the typing level will return a "typed" query, if possible,
        that will type result rows as ``Tuple`` objects with typed
        elements.

        This method can be compared to the :meth:`.Result.tuples` method,
        which returns "self", but from a typing perspective returns an object
        that will yield typed ``Tuple`` objects for results.   Typing
        takes effect only if this :class:`.Query` object is a typed
        query object already.

        .. versionadded:: 2.0

        .. seealso::

            :meth:`.Result.tuples` - v2 equivalent method.

        """
        return self.only_return_tuples(True)  # type: ignore

    def _entity_from_pre_ent_zero(self) -> Optional[_InternalEntityType[Any]]:
        if not self._raw_columns:
            return None

        ent = self._raw_columns[0]

        if "parententity" in ent._annotations:
            return ent._annotations["parententity"]  # type: ignore
        elif "bundle" in ent._annotations:
            return ent._annotations["bundle"]  # type: ignore
        else:
            # label, other SQL expression
            for element in visitors.iterate(ent):
                if "parententity" in element._annotations:
                    return element._annotations["parententity"]  # type: ignore  # noqa: E501
            else:
                return None

    def _only_full_mapper_zero(self, methname: str) -> Mapper[Any]:
        if (
            len(self._raw_columns) != 1
            or "parententity" not in self._raw_columns[0]._annotations
            or not self._raw_columns[0].is_selectable
        ):
            raise sa_exc.InvalidRequestError(
                "%s() can only be used against "
                "a single mapped class." % methname
            )

        return self._raw_columns[0]._annotations["parententity"]  # type: ignore  # noqa: E501

    def _set_select_from(
        self, obj: Iterable[_FromClauseArgument], set_base_alias: bool
    ) -> None:
        fa = [
            coercions.expect(
                roles.StrictFromClauseRole,
                elem,
                allow_select=True,
                apply_propagate_attrs=self,
            )
            for elem in obj
        ]

        self._compile_options += {"_set_base_alias": set_base_alias}
        self._from_obj = tuple(fa)

    @_generative
    def _set_lazyload_from(self, state: InstanceState[Any]) -> Self:
        self.load_options += {"_lazy_loaded_from": state}
        return self

    def _get_condition(self) -> None:
        """used by legacy BakedQuery"""
        self._no_criterion_condition("get", order_by=False, distinct=False)

    def _get_existing_condition(self) -> None:
        self._no_criterion_assertion("get", order_by=False, distinct=False)

    def _no_criterion_assertion(
        self, meth: str, order_by: bool = True, distinct: bool = True
    ) -> None:
        if not self._enable_assertions:
            return
        if (
            self._where_criteria
            or self._statement is not None
            or self._from_obj
            or self._setup_joins
            or self._limit_clause is not None
            or self._offset_clause is not None
            or self._group_by_clauses
            or (order_by and self._order_by_clauses)
            or (distinct and self._distinct)
        ):
            raise sa_exc.InvalidRequestError(
                "Query.%s() being called on a "
                "Query with existing criterion. " % meth
            )

    def _no_criterion_condition(
        self, meth: str, order_by: bool = True, distinct: bool = True
    ) -> None:
        self._no_criterion_assertion(meth, order_by, distinct)

        self._from_obj = self._setup_joins = ()
        if self._statement is not None:
            self._compile_options += {"_statement": None}
        self._where_criteria = ()
        self._distinct = False

        self._order_by_clauses = self._group_by_clauses = ()

    def _no_clauseelement_condition(self, meth: str) -> None:
        if not self._enable_assertions:
            return
        if self._order_by_clauses:
            raise sa_exc.InvalidRequestError(
                "Query.%s() being called on a "
                "Query with existing criterion. " % meth
            )
        self._no_criterion_condition(meth)

    def _no_statement_condition(self, meth: str) -> None:
        if not self._enable_assertions:
            return
        if self._statement is not None:
            raise sa_exc.InvalidRequestError(
                (
                    "Query.%s() being called on a Query with an existing full "
                    "statement - can't apply criterion."
                )
                % meth
            )

    def _no_limit_offset(self, meth: str) -> None:
        if not self._enable_assertions:
            return
        if self._limit_clause is not None or self._offset_clause is not None:
            raise sa_exc.InvalidRequestError(
                "Query.%s() being called on a Query which already has LIMIT "
                "or OFFSET applied.  Call %s() before limit() or offset() "
                "are applied." % (meth, meth)
            )

    @property
    def _has_row_limiting_clause(self) -> bool:
        return (
            self._limit_clause is not None or self._offset_clause is not None
        )

    def _get_options(
        self,
        populate_existing: Optional[bool] = None,
        version_check: Optional[bool] = None,
        only_load_props: Optional[Sequence[str]] = None,
        refresh_state: Optional[InstanceState[Any]] = None,
        identity_token: Optional[Any] = None,
    ) -> Self:
        load_options: Dict[str, Any] = {}
        compile_options: Dict[str, Any] = {}

        if version_check:
            load_options["_version_check"] = version_check
        if populate_existing:
            load_options["_populate_existing"] = populate_existing
        if refresh_state:
            load_options["_refresh_state"] = refresh_state
            compile_options["_for_refresh_state"] = True
        if only_load_props:
            compile_options["_only_load_props"] = frozenset(only_load_props)
        if identity_token:
            load_options["_identity_token"] = identity_token

        if load_options:
            self.load_options += load_options
        if compile_options:
            self._compile_options += compile_options

        return self

    def _clone(self, **kw: Any) -> Self:
        return self._generate()

    def _get_select_statement_only(self) -> Select[_T]:
        if self._statement is not None:
            raise sa_exc.InvalidRequestError(
                "Can't call this method on a Query that uses from_statement()"
            )
        return cast("Select[_T]", self.statement)

    @property
    def statement(self) -> Union[Select[_T], FromStatement[_T]]:
        """The full SELECT statement represented by this Query.

        The statement by default will not have disambiguating labels
        applied to the construct unless with_labels(True) is called
        first.

        """

        # .statement can return the direct future.Select() construct here, as
        # long as we are not using subsequent adaption features that
        # are made against raw entities, e.g. from_self(), with_polymorphic(),
        # select_entity_from().  If these features are being used, then
        # the Select() we return will not have the correct .selected_columns
        # collection and will not embed in subsequent queries correctly.
        # We could find a way to make this collection "correct", however
        # this would not be too different from doing the full compile as
        # we are doing in any case, the Select() would still not have the
        # proper state for other attributes like whereclause, order_by,
        # and these features are all deprecated in any case.
        #
        # for these reasons, Query is not a Select, it remains an ORM
        # object for which __clause_element__() must be called in order for
        # it to provide a real expression object.
        #
        # from there, it starts to look much like Query itself won't be
        # passed into the execute process and won't generate its own cache
        # key; this will all occur in terms of the ORM-enabled Select.
        if not self._compile_options._set_base_alias:
            # if we don't have legacy top level aliasing features in use
            # then convert to a future select() directly
            stmt = self._statement_20(for_statement=True)
        else:
            stmt = self._compile_state(for_statement=True).statement

        if self._params:
            stmt = stmt.params(self._params)

        return stmt

    def _final_statement(self, legacy_query_style: bool = True) -> Select[Any]:
        """Return the 'final' SELECT statement for this :class:`.Query`.

        This is used by the testing suite only and is fairly inefficient.

        This is the Core-only select() that will be rendered by a complete
        compilation of this query, and is what .statement used to return
        in 1.3.


        """

        q = self._clone()

        return q._compile_state(
            use_legacy_query_style=legacy_query_style
        ).statement  # type: ignore

    def _statement_20(
        self, for_statement: bool = False, use_legacy_query_style: bool = True
    ) -> Union[Select[_T], FromStatement[_T]]:
        # TODO: this event needs to be deprecated, as it currently applies
        # only to ORM query and occurs at this spot that is now more
        # or less an artificial spot
        if self.dispatch.before_compile:
            for fn in self.dispatch.before_compile:
                new_query = fn(self)
                if new_query is not None and new_query is not self:
                    self = new_query
                    if not fn._bake_ok:  # type: ignore
                        self._compile_options += {"_bake_ok": False}

        compile_options = self._compile_options
        compile_options += {
            "_for_statement": for_statement,
            "_use_legacy_query_style": use_legacy_query_style,
        }

        stmt: Union[Select[_T], FromStatement[_T]]

        if self._statement is not None:
            stmt = FromStatement(self._raw_columns, self._statement)
            stmt.__dict__.update(
                _with_options=self._with_options,
                _with_context_options=self._with_context_options,
                _compile_options=compile_options,
                _execution_options=self._execution_options,
                _propagate_attrs=self._propagate_attrs,
            )
        else:
            # Query / select() internal attributes are 99% cross-compatible
            stmt = Select._create_raw_select(**self.__dict__)
            stmt.__dict__.update(
                _label_style=self._label_style,
                _compile_options=compile_options,
                _propagate_attrs=self._propagate_attrs,
            )
            stmt.__dict__.pop("session", None)

        # ensure the ORM context is used to compile the statement, even
        # if it has no ORM entities.  This is so ORM-only things like
        # _legacy_joins are picked up that wouldn't be picked up by the
        # Core statement context
        if "compile_state_plugin" not in stmt._propagate_attrs:
            stmt._propagate_attrs = stmt._propagate_attrs.union(
                {"compile_state_plugin": "orm", "plugin_subject": None}
            )

        return stmt

    def subquery(
        self,
        name: Optional[str] = None,
        with_labels: bool = False,
        reduce_columns: bool = False,
    ) -> Subquery:
        """Return the full SELECT statement represented by
        this :class:`_query.Query`, embedded within an
        :class:`_expression.Alias`.

        Eager JOIN generation within the query is disabled.

        .. seealso::

            :meth:`_sql.Select.subquery` - v2 comparable method.

        :param name: string name to be assigned as the alias;
            this is passed through to :meth:`_expression.FromClause.alias`.
            If ``None``, a name will be deterministically generated
            at compile time.

        :param with_labels: if True, :meth:`.with_labels` will be called
         on the :class:`_query.Query` first to apply table-qualified labels
         to all columns.

        :param reduce_columns: if True,
         :meth:`_expression.Select.reduce_columns` will
         be called on the resulting :func:`_expression.select` construct,
         to remove same-named columns where one also refers to the other
         via foreign key or WHERE clause equivalence.

        """
        q = self.enable_eagerloads(False)
        if with_labels:
            q = q.set_label_style(LABEL_STYLE_TABLENAME_PLUS_COL)

        stmt = q._get_select_statement_only()

        if TYPE_CHECKING:
            assert isinstance(stmt, Select)

        if reduce_columns:
            stmt = stmt.reduce_columns()
        return stmt.subquery(name=name)

    def cte(
        self,
        name: Optional[str] = None,
        recursive: bool = False,
        nesting: bool = False,
    ) -> CTE:
        r"""Return the full SELECT statement represented by this
        :class:`_query.Query` represented as a common table expression (CTE).

        Parameters and usage are the same as those of the
        :meth:`_expression.SelectBase.cte` method; see that method for
        further details.

        Here is the `PostgreSQL WITH
        RECURSIVE example
        <https://www.postgresql.org/docs/current/static/queries-with.html>`_.
        Note that, in this example, the ``included_parts`` cte and the
        ``incl_alias`` alias of it are Core selectables, which
        means the columns are accessed via the ``.c.`` attribute.  The
        ``parts_alias`` object is an :func:`_orm.aliased` instance of the
        ``Part`` entity, so column-mapped attributes are available
        directly::

            from sqlalchemy.orm import aliased

            class Part(Base):
                __tablename__ = 'part'
                part = Column(String, primary_key=True)
                sub_part = Column(String, primary_key=True)
                quantity = Column(Integer)

            included_parts = session.query(
                            Part.sub_part,
                            Part.part,
                            Part.quantity).\
                                filter(Part.part=="our part").\
                                cte(name="included_parts", recursive=True)

            incl_alias = aliased(included_parts, name="pr")
            parts_alias = aliased(Part, name="p")
            included_parts = included_parts.union_all(
                session.query(
                    parts_alias.sub_part,
                    parts_alias.part,
                    parts_alias.quantity).\
                        filter(parts_alias.part==incl_alias.c.sub_part)
                )

            q = session.query(
                    included_parts.c.sub_part,
                    func.sum(included_parts.c.quantity).
                        label('total_quantity')
                ).\
                group_by(included_parts.c.sub_part)

        .. seealso::

            :meth:`_sql.Select.cte` - v2 equivalent method.

        """
        return (
            self.enable_eagerloads(False)
            ._get_select_statement_only()
            .cte(name=name, recursive=recursive, nesting=nesting)
        )

    def label(self, name: Optional[str]) -> Label[Any]:
        """Return the full SELECT statement represented by this
        :class:`_query.Query`, converted
        to a scalar subquery with a label of the given name.

        .. seealso::

            :meth:`_sql.Select.label` - v2 comparable method.

        """

        return (
            self.enable_eagerloads(False)
            ._get_select_statement_only()
            .label(name)
        )

    @overload
    def as_scalar(
        self: Query[Tuple[_MAYBE_ENTITY]],
    ) -> ScalarSelect[_MAYBE_ENTITY]:
        ...

    @overload
    def as_scalar(
        self: Query[Tuple[_NOT_ENTITY]],
    ) -> ScalarSelect[_NOT_ENTITY]:
        ...

    @overload
    def as_scalar(self) -> ScalarSelect[Any]:
        ...

    @util.deprecated(
        "1.4",
        "The :meth:`_query.Query.as_scalar` method is deprecated and will be "
        "removed in a future release.  Please refer to "
        ":meth:`_query.Query.scalar_subquery`.",
    )
    def as_scalar(self) -> ScalarSelect[Any]:
        """Return the full SELECT statement represented by this
        :class:`_query.Query`, converted to a scalar subquery.

        """
        return self.scalar_subquery()

    @overload
    def scalar_subquery(
        self: Query[Tuple[_MAYBE_ENTITY]],
    ) -> ScalarSelect[Any]:
        ...

    @overload
    def scalar_subquery(
        self: Query[Tuple[_NOT_ENTITY]],
    ) -> ScalarSelect[_NOT_ENTITY]:
        ...

    @overload
    def scalar_subquery(self) -> ScalarSelect[Any]:
        ...

    def scalar_subquery(self) -> ScalarSelect[Any]:
        """Return the full SELECT statement represented by this
        :class:`_query.Query`, converted to a scalar subquery.

        Analogous to
        :meth:`sqlalchemy.sql.expression.SelectBase.scalar_subquery`.

        .. versionchanged:: 1.4 The :meth:`_query.Query.scalar_subquery`
           method replaces the :meth:`_query.Query.as_scalar` method.

        .. seealso::

            :meth:`_sql.Select.scalar_subquery` - v2 comparable method.

        """

        return (
            self.enable_eagerloads(False)
            ._get_select_statement_only()
            .scalar_subquery()
        )

    @property
    def selectable(self) -> Union[Select[_T], FromStatement[_T]]:
        """Return the :class:`_expression.Select` object emitted by this
        :class:`_query.Query`.

        Used for :func:`_sa.inspect` compatibility, this is equivalent to::

            query.enable_eagerloads(False).with_labels().statement

        """
        return self.__clause_element__()

    def __clause_element__(self) -> Union[Select[_T], FromStatement[_T]]:
        return (
            self._with_compile_options(
                _enable_eagerloads=False, _render_for_subquery=True
            )
            .set_label_style(LABEL_STYLE_TABLENAME_PLUS_COL)
            .statement
        )

    @overload
    def only_return_tuples(
        self: Query[_O], value: Literal[True]
    ) -> RowReturningQuery[Tuple[_O]]:
        ...

    @overload
    def only_return_tuples(
        self: Query[_O], value: Literal[False]
    ) -> Query[_O]:
        ...

    @_generative
    def only_return_tuples(self, value: bool) -> Query[Any]:
        """When set to True, the query results will always be a
        :class:`.Row` object.

        This can change a query that normally returns a single entity
        as a scalar to return a :class:`.Row` result in all cases.

        .. seealso::

            :meth:`.Query.tuples` - returns tuples, but also at the typing
            level will type results as ``Tuple``.

            :meth:`_query.Query.is_single_entity`

            :meth:`_engine.Result.tuples` - v2 comparable method.

        """
        self.load_options += dict(_only_return_tuples=value)
        return self

    @property
    def is_single_entity(self) -> bool:
        """Indicates if this :class:`_query.Query`
        returns tuples or single entities.

        Returns True if this query returns a single entity for each instance
        in its result list, and False if this query returns a tuple of entities
        for each result.

        .. versionadded:: 1.3.11

        .. seealso::

            :meth:`_query.Query.only_return_tuples`

        """
        return (
            not self.load_options._only_return_tuples
            and len(self._raw_columns) == 1
            and "parententity" in self._raw_columns[0]._annotations
            and isinstance(
                self._raw_columns[0]._annotations["parententity"],
                ORMColumnsClauseRole,
            )
        )

    @_generative
    def enable_eagerloads(self, value: bool) -> Self:
        """Control whether or not eager joins and subqueries are
        rendered.

        When set to False, the returned Query will not render
        eager joins regardless of :func:`~sqlalchemy.orm.joinedload`,
        :func:`~sqlalchemy.orm.subqueryload` options
        or mapper-level ``lazy='joined'``/``lazy='subquery'``
        configurations.

        This is used primarily when nesting the Query's
        statement into a subquery or other
        selectable, or when using :meth:`_query.Query.yield_per`.

        """
        self._compile_options += {"_enable_eagerloads": value}
        return self

    @_generative
    def _with_compile_options(self, **opt: Any) -> Self:
        self._compile_options += opt
        return self

    @util.became_legacy_20(
        ":meth:`_orm.Query.with_labels` and :meth:`_orm.Query.apply_labels`",
        alternative="Use set_label_style(LABEL_STYLE_TABLENAME_PLUS_COL) "
        "instead.",
    )
    def with_labels(self) -> Self:
        return self.set_label_style(
            SelectLabelStyle.LABEL_STYLE_TABLENAME_PLUS_COL
        )

    apply_labels = with_labels

    @property
    def get_label_style(self) -> SelectLabelStyle:
        """
        Retrieve the current label style.

        .. versionadded:: 1.4

        .. seealso::

            :meth:`_sql.Select.get_label_style` - v2 equivalent method.

        """
        return self._label_style

    def set_label_style(self, style: SelectLabelStyle) -> Self:
        """Apply column labels to the return value of Query.statement.

        Indicates that this Query's `statement` accessor should return
        a SELECT statement that applies labels to all columns in the
        form <tablename>_<columnname>; this is commonly used to
        disambiguate columns from multiple tables which have the same
        name.

        When the `Query` actually issues SQL to load rows, it always
        uses column labeling.

        .. note:: The :meth:`_query.Query.set_label_style` method *only* applies
           the output of :attr:`_query.Query.statement`, and *not* to any of
           the result-row invoking systems of :class:`_query.Query` itself,
           e.g.
           :meth:`_query.Query.first`, :meth:`_query.Query.all`, etc.
           To execute
           a query using :meth:`_query.Query.set_label_style`, invoke the
           :attr:`_query.Query.statement` using :meth:`.Session.execute`::

                result = session.execute(
                    query
                    .set_label_style(LABEL_STYLE_TABLENAME_PLUS_COL)
                    .statement
                )

        .. versionadded:: 1.4


        .. seealso::

            :meth:`_sql.Select.set_label_style` - v2 equivalent method.

        """  # noqa
        if self._label_style is not style:
            self = self._generate()
            self._label_style = style
        return self

    @_generative
    def enable_assertions(self, value: bool) -> Self:
        """Control whether assertions are generated.

        When set to False, the returned Query will
        not assert its state before certain operations,
        including that LIMIT/OFFSET has not been applied
        when filter() is called, no criterion exists
        when get() is called, and no "from_statement()"
        exists when filter()/order_by()/group_by() etc.
        is called.  This more permissive mode is used by
        custom Query subclasses to specify criterion or
        other modifiers outside of the usual usage patterns.

        Care should be taken to ensure that the usage
        pattern is even possible.  A statement applied
        by from_statement() will override any criterion
        set by filter() or order_by(), for example.

        """
        self._enable_assertions = value
        return self

    @property
    def whereclause(self) -> Optional[ColumnElement[bool]]:
        """A readonly attribute which returns the current WHERE criterion for
        this Query.

        This returned value is a SQL expression construct, or ``None`` if no
        criterion has been established.

        .. seealso::

            :attr:`_sql.Select.whereclause` - v2 equivalent property.

        """
        return BooleanClauseList._construct_for_whereclause(
            self._where_criteria
        )

    @_generative
    def _with_current_path(self, path: PathRegistry) -> Self:
        """indicate that this query applies to objects loaded
        within a certain path.

        Used by deferred loaders (see strategies.py) which transfer
        query options from an originating query to a newly generated
        query intended for the deferred load.

        """
        self._compile_options += {"_current_path": path}
        return self

    @_generative
    def yield_per(self, count: int) -> Self:
        r"""Yield only ``count`` rows at a time.

        The purpose of this method is when fetching very large result sets
        (> 10K rows), to batch results in sub-collections and yield them
        out partially, so that the Python interpreter doesn't need to declare
        very large areas of memory which is both time consuming and leads
        to excessive memory use.   The performance from fetching hundreds of
        thousands of rows can often double when a suitable yield-per setting
        (e.g. approximately 1000) is used, even with DBAPIs that buffer
        rows (which are most).

        As of SQLAlchemy 1.4, the :meth:`_orm.Query.yield_per` method is
        equivalent to using the ``yield_per`` execution option at the ORM
        level. See the section :ref:`orm_queryguide_yield_per` for further
        background on this option.

        .. seealso::

            :ref:`orm_queryguide_yield_per`

        """
        self.load_options += {"_yield_per": count}
        return self

    @util.became_legacy_20(
        ":meth:`_orm.Query.get`",
        alternative="The method is now available as :meth:`_orm.Session.get`",
    )
    def get(self, ident: _PKIdentityArgument) -> Optional[Any]:
        """Return an instance based on the given primary key identifier,
        or ``None`` if not found.

        E.g.::

            my_user = session.query(User).get(5)

            some_object = session.query(VersionedFoo).get((5, 10))

            some_object = session.query(VersionedFoo).get(
                {"id": 5, "version_id": 10})

        :meth:`_query.Query.get` is special in that it provides direct
        access to the identity map of the owning :class:`.Session`.
        If the given primary key identifier is present
        in the local identity map, the object is returned
        directly from this collection and no SQL is emitted,
        unless the object has been marked fully expired.
        If not present,
        a SELECT is performed in order to locate the object.

        :meth:`_query.Query.get` also will perform a check if
        the object is present in the identity map and
        marked as expired - a SELECT
        is emitted to refresh the object as well as to
        ensure that the row is still present.
        If not, :class:`~sqlalchemy.orm.exc.ObjectDeletedError` is raised.

        :meth:`_query.Query.get` is only used to return a single
        mapped instance, not multiple instances or
        individual column constructs, and strictly
        on a single primary key value.  The originating
        :class:`_query.Query` must be constructed in this way,
        i.e. against a single mapped entity,
        with no additional filtering criterion.  Loading
        options via :meth:`_query.Query.options` may be applied
        however, and will be used if the object is not
        yet locally present.

        :param ident: A scalar, tuple, or dictionary representing the
         primary key.  For a composite (e.g. multiple column) primary key,
         a tuple or dictionary should be passed.

         For a single-column primary key, the scalar calling form is typically
         the most expedient.  If the primary key of a row is the value "5",
         the call looks like::

            my_object = query.get(5)

         The tuple form contains primary key values typically in
         the order in which they correspond to the mapped
         :class:`_schema.Table`
         object's primary key columns, or if the
         :paramref:`_orm.Mapper.primary_key` configuration parameter were
         used, in
         the order used for that parameter. For example, if the primary key
         of a row is represented by the integer
         digits "5, 10" the call would look like::

             my_object = query.get((5, 10))

         The dictionary form should include as keys the mapped attribute names
         corresponding to each element of the primary key.  If the mapped class
         has the attributes ``id``, ``version_id`` as the attributes which
         store the object's primary key value, the call would look like::

            my_object = query.get({"id": 5, "version_id": 10})

         .. versionadded:: 1.3 the :meth:`_query.Query.get`
            method now optionally
            accepts a dictionary of attribute names to values in order to
            indicate a primary key identifier.


        :return: The object instance, or ``None``.

        """
        self._no_criterion_assertion("get", order_by=False, distinct=False)

        # we still implement _get_impl() so that baked query can override
        # it
        return self._get_impl(ident, loading.load_on_pk_identity)

    def _get_impl(
        self,
        primary_key_identity: _PKIdentityArgument,
        db_load_fn: Callable[..., Any],
        identity_token: Optional[Any] = None,
    ) -> Optional[Any]:
        mapper = self._only_full_mapper_zero("get")
        return self.session._get_impl(
            mapper,
            primary_key_identity,
            db_load_fn,
            populate_existing=self.load_options._populate_existing,
            with_for_update=self._for_update_arg,
            options=self._with_options,
            identity_token=identity_token,
            execution_options=self._execution_options,
        )

    @property
    def lazy_loaded_from(self) -> Optional[InstanceState[Any]]:
        """An :class:`.InstanceState` that is using this :class:`_query.Query`
        for a lazy load operation.

        .. deprecated:: 1.4  This attribute should be viewed via the
           :attr:`.ORMExecuteState.lazy_loaded_from` attribute, within
           the context of the :meth:`.SessionEvents.do_orm_execute`
           event.

        .. seealso::

            :attr:`.ORMExecuteState.lazy_loaded_from`

        """
        return self.load_options._lazy_loaded_from  # type: ignore

    @property
    def _current_path(self) -> PathRegistry:
        return self._compile_options._current_path  # type: ignore

    @_generative
    def correlate(
        self,
        *fromclauses: Union[Literal[None, False], _FromClauseArgument],
    ) -> Self:
        """Return a :class:`.Query` construct which will correlate the given
        FROM clauses to that of an enclosing :class:`.Query` or
        :func:`~.expression.select`.

        The method here accepts mapped classes, :func:`.aliased` constructs,
        and :class:`_orm.Mapper` constructs as arguments, which are resolved
        into expression constructs, in addition to appropriate expression
        constructs.

        The correlation arguments are ultimately passed to
        :meth:`_expression.Select.correlate`
        after coercion to expression constructs.

        The correlation arguments take effect in such cases
        as when :meth:`_query.Query.from_self` is used, or when
        a subquery as returned by :meth:`_query.Query.subquery` is
        embedded in another :func:`_expression.select` construct.

        .. seealso::

            :meth:`_sql.Select.correlate` - v2 equivalent method.

        """

        self._auto_correlate = False
        if fromclauses and fromclauses[0] in {None, False}:
            self._correlate = ()
        else:
            self._correlate = self._correlate + tuple(
                coercions.expect(roles.FromClauseRole, f) for f in fromclauses
            )
        return self

    @_generative
    def autoflush(self, setting: bool) -> Self:
        """Return a Query with a specific 'autoflush' setting.

        As of SQLAlchemy 1.4, the :meth:`_orm.Query.autoflush` method
        is equivalent to using the ``autoflush`` execution option at the
        ORM level. See the section :ref:`orm_queryguide_autoflush` for
        further background on this option.

        """
        self.load_options += {"_autoflush": setting}
        return self

    @_generative
    def populate_existing(self) -> Self:
        """Return a :class:`_query.Query`
        that will expire and refresh all instances
        as they are loaded, or reused from the current :class:`.Session`.

        As of SQLAlchemy 1.4, the :meth:`_orm.Query.populate_existing` method
        is equivalent to using the ``populate_existing`` execution option at
        the ORM level. See the section :ref:`orm_queryguide_populate_existing`
        for further background on this option.

        """
        self.load_options += {"_populate_existing": True}
        return self

    @_generative
    def _with_invoke_all_eagers(self, value: bool) -> Self:
        """Set the 'invoke all eagers' flag which causes joined- and
        subquery loaders to traverse into already-loaded related objects
        and collections.

        Default is that of :attr:`_query.Query._invoke_all_eagers`.

        """
        self.load_options += {"_invoke_all_eagers": value}
        return self

    @util.became_legacy_20(
        ":meth:`_orm.Query.with_parent`",
        alternative="Use the :func:`_orm.with_parent` standalone construct.",
    )
    @util.preload_module("sqlalchemy.orm.relationships")
    def with_parent(
        self,
        instance: object,
        property: Optional[  # noqa: A002
            attributes.QueryableAttribute[Any]
        ] = None,
        from_entity: Optional[_ExternalEntityType[Any]] = None,
    ) -> Self:
        """Add filtering criterion that relates the given instance
        to a child object or collection, using its attribute state
        as well as an established :func:`_orm.relationship()`
        configuration.

        The method uses the :func:`.with_parent` function to generate
        the clause, the result of which is passed to
        :meth:`_query.Query.filter`.

        Parameters are the same as :func:`.with_parent`, with the exception
        that the given property can be None, in which case a search is
        performed against this :class:`_query.Query` object's target mapper.

        :param instance:
          An instance which has some :func:`_orm.relationship`.

        :param property:
          Class bound attribute which indicates
          what relationship from the instance should be used to reconcile the
          parent/child relationship.

        :param from_entity:
          Entity in which to consider as the left side.  This defaults to the
          "zero" entity of the :class:`_query.Query` itself.

        """
        relationships = util.preloaded.orm_relationships

        if from_entity:
            entity_zero = inspect(from_entity)
        else:
            entity_zero = _legacy_filter_by_entity_zero(self)
        if property is None:
            # TODO: deprecate, property has to be supplied
            mapper = object_mapper(instance)

            for prop in mapper.iterate_properties:
                if (
                    isinstance(prop, relationships.RelationshipProperty)
                    and prop.mapper is entity_zero.mapper  # type: ignore
                ):
                    property = prop  # type: ignore  # noqa: A001
                    break
            else:
                raise sa_exc.InvalidRequestError(
                    "Could not locate a property which relates instances "
                    "of class '%s' to instances of class '%s'"
                    % (
                        entity_zero.mapper.class_.__name__,  # type: ignore
                        instance.__class__.__name__,
                    )
                )

        return self.filter(
            with_parent(
                instance,
                property,  # type: ignore
                entity_zero.entity,  # type: ignore
            )
        )

    @_generative
    def add_entity(
        self,
        entity: _EntityType[Any],
        alias: Optional[Union[Alias, Subquery]] = None,
    ) -> Query[Any]:
        """add a mapped entity to the list of result columns
        to be returned.

        .. seealso::

            :meth:`_sql.Select.add_columns` - v2 comparable method.
        """

        if alias is not None:
            # TODO: deprecate
            entity = AliasedClass(entity, alias)

        self._raw_columns = list(self._raw_columns)

        self._raw_columns.append(
            coercions.expect(
                roles.ColumnsClauseRole, entity, apply_propagate_attrs=self
            )
        )
        return self

    @_generative
    def with_session(self, session: Session) -> Self:
        """Return a :class:`_query.Query` that will use the given
        :class:`.Session`.

        While the :class:`_query.Query`
        object is normally instantiated using the
        :meth:`.Session.query` method, it is legal to build the
        :class:`_query.Query`
        directly without necessarily using a :class:`.Session`.  Such a
        :class:`_query.Query` object, or any :class:`_query.Query`
        already associated
        with a different :class:`.Session`, can produce a new
        :class:`_query.Query`
        object associated with a target session using this method::

            from sqlalchemy.orm import Query

            query = Query([MyClass]).filter(MyClass.id == 5)

            result = query.with_session(my_session).one()

        """

        self.session = session
        return self

    def _legacy_from_self(
        self, *entities: _ColumnsClauseArgument[Any]
    ) -> Self:
        # used for query.count() as well as for the same
        # function in BakedQuery, as well as some old tests in test_baked.py.

        fromclause = (
            self.set_label_style(LABEL_STYLE_TABLENAME_PLUS_COL)
            .correlate(None)
            .subquery()
            ._anonymous_fromclause()
        )

        q = self._from_selectable(fromclause)

        if entities:
            q._set_entities(entities)
        return q

    @_generative
    def _set_enable_single_crit(self, val: bool) -> Self:
        self._compile_options += {"_enable_single_crit": val}
        return self

    @_generative
    def _from_selectable(
        self, fromclause: FromClause, set_entity_from: bool = True
    ) -> Self:
        for attr in (
            "_where_criteria",
            "_order_by_clauses",
            "_group_by_clauses",
            "_limit_clause",
            "_offset_clause",
            "_last_joined_entity",
            "_setup_joins",
            "_memoized_select_entities",
            "_distinct",
            "_distinct_on",
            "_having_criteria",
            "_prefixes",
            "_suffixes",
        ):
            self.__dict__.pop(attr, None)
        self._set_select_from([fromclause], set_entity_from)
        self._compile_options += {
            "_enable_single_crit": False,
        }

        return self

    @util.deprecated(
        "1.4",
        ":meth:`_query.Query.values` "
        "is deprecated and will be removed in a "
        "future release.  Please use :meth:`_query.Query.with_entities`",
    )
    def values(self, *columns: _ColumnsClauseArgument[Any]) -> Iterable[Any]:
        """Return an iterator yielding result tuples corresponding
        to the given list of columns

        """
        return self._values_no_warn(*columns)

    _values = values

    def _values_no_warn(
        self, *columns: _ColumnsClauseArgument[Any]
    ) -> Iterable[Any]:
        if not columns:
            return iter(())
        q = self._clone().enable_eagerloads(False)
        q._set_entities(columns)
        if not q.load_options._yield_per:
            q.load_options += {"_yield_per": 10}
        return iter(q)

    @util.deprecated(
        "1.4",
        ":meth:`_query.Query.value` "
        "is deprecated and will be removed in a "
        "future release.  Please use :meth:`_query.Query.with_entities` "
        "in combination with :meth:`_query.Query.scalar`",
    )
    def value(self, column: _ColumnExpressionArgument[Any]) -> Any:
        """Return a scalar result corresponding to the given
        column expression.

        """
        try:
            return next(self._values_no_warn(column))[0]  # type: ignore
        except StopIteration:
            return None

    @overload
    def with_entities(self, _entity: _EntityType[_O]) -> Query[_O]:
        ...

    @overload
    def with_entities(
        self,
        _colexpr: roles.TypedColumnsClauseRole[_T],
    ) -> RowReturningQuery[Tuple[_T]]:
        ...

    # START OVERLOADED FUNCTIONS self.with_entities RowReturningQuery 2-8

    # code within this block is **programmatically,
    # statically generated** by tools/generate_tuple_map_overloads.py

    @overload
    def with_entities(
        self, __ent0: _TCCA[_T0], __ent1: _TCCA[_T1]
    ) -> RowReturningQuery[Tuple[_T0, _T1]]:
        ...

    @overload
    def with_entities(
        self, __ent0: _TCCA[_T0], __ent1: _TCCA[_T1], __ent2: _TCCA[_T2]
    ) -> RowReturningQuery[Tuple[_T0, _T1, _T2]]:
        ...

    @overload
    def with_entities(
        self,
        __ent0: _TCCA[_T0],
        __ent1: _TCCA[_T1],
        __ent2: _TCCA[_T2],
        __ent3: _TCCA[_T3],
    ) -> RowReturningQuery[Tuple[_T0, _T1, _T2, _T3]]:
        ...

    @overload
    def with_entities(
        self,
        __ent0: _TCCA[_T0],
        __ent1: _TCCA[_T1],
        __ent2: _TCCA[_T2],
        __ent3: _TCCA[_T3],
        __ent4: _TCCA[_T4],
    ) -> RowReturningQuery[Tuple[_T0, _T1, _T2, _T3, _T4]]:
        ...

    @overload
    def with_entities(
        self,
        __ent0: _TCCA[_T0],
        __ent1: _TCCA[_T1],
        __ent2: _TCCA[_T2],
        __ent3: _TCCA[_T3],
        __ent4: _TCCA[_T4],
        __ent5: _TCCA[_T5],
    ) -> RowReturningQuery[Tuple[_T0, _T1, _T2, _T3, _T4, _T5]]:
        ...

    @overload
    def with_entities(
        self,
        __ent0: _TCCA[_T0],
        __ent1: _TCCA[_T1],
        __ent2: _TCCA[_T2],
        __ent3: _TCCA[_T3],
        __ent4: _TCCA[_T4],
        __ent5: _TCCA[_T5],
        __ent6: _TCCA[_T6],
    ) -> RowReturningQuery[Tuple[_T0, _T1, _T2, _T3, _T4, _T5, _T6]]:
        ...

    @overload
    def with_entities(
        self,
        __ent0: _TCCA[_T0],
        __ent1: _TCCA[_T1],
        __ent2: _TCCA[_T2],
        __ent3: _TCCA[_T3],
        __ent4: _TCCA[_T4],
        __ent5: _TCCA[_T5],
        __ent6: _TCCA[_T6],
        __ent7: _TCCA[_T7],
    ) -> RowReturningQuery[Tuple[_T0, _T1, _T2, _T3, _T4, _T5, _T6, _T7]]:
        ...

    # END OVERLOADED FUNCTIONS self.with_entities

    @overload
    def with_entities(
        self, *entities: _ColumnsClauseArgument[Any]
    ) -> Query[Any]:
        ...

    @_generative
    def with_entities(
        self, *entities: _ColumnsClauseArgument[Any], **__kw: Any
    ) -> Query[Any]:
        r"""Return a new :class:`_query.Query`
        replacing the SELECT list with the
        given entities.

        e.g.::

            # Users, filtered on some arbitrary criterion
            # and then ordered by related email address
            q = session.query(User).\
                        join(User.address).\
                        filter(User.name.like('%ed%')).\
                        order_by(Address.email)

            # given *only* User.id==5, Address.email, and 'q', what
            # would the *next* User in the result be ?
            subq = q.with_entities(Address.email).\
                        order_by(None).\
                        filter(User.id==5).\
                        subquery()
            q = q.join((subq, subq.c.email < Address.email)).\
                        limit(1)

        .. seealso::

            :meth:`_sql.Select.with_only_columns` - v2 comparable method.
        """
        if __kw:
            raise _no_kw()

        # Query has all the same fields as Select for this operation
        # this could in theory be based on a protocol but not sure if it's
        # worth it
        _MemoizedSelectEntities._generate_for_statement(self)  # type: ignore
        self._set_entities(entities)
        return self

    @_generative
    def add_columns(
        self, *column: _ColumnExpressionArgument[Any]
    ) -> Query[Any]:
        """Add one or more column expressions to the list
        of result columns to be returned.

        .. seealso::

            :meth:`_sql.Select.add_columns` - v2 comparable method.
        """

        self._raw_columns = list(self._raw_columns)

        self._raw_columns.extend(
            coercions.expect(
                roles.ColumnsClauseRole,
                c,
                apply_propagate_attrs=self,
                post_inspect=True,
            )
            for c in column
        )
        return self

    @util.deprecated(
        "1.4",
        ":meth:`_query.Query.add_column` "
        "is deprecated and will be removed in a "
        "future release.  Please use :meth:`_query.Query.add_columns`",
    )
    def add_column(self, column: _ColumnExpressionArgument[Any]) -> Query[Any]:
        """Add a column expression to the list of result columns to be
        returned.

        """
        return self.add_columns(column)

    @_generative
    def options(self, *args: ExecutableOption) -> Self:
        """Return a new :class:`_query.Query` object,
        applying the given list of
        mapper options.

        Most supplied options regard changing how column- and
        relationship-mapped attributes are loaded.

        .. seealso::

            :ref:`loading_columns`

            :ref:`relationship_loader_options`

        """

        opts = tuple(util.flatten_iterator(args))
        if self._compile_options._current_path:
            # opting for lower method overhead for the checks
            for opt in opts:
                if not opt._is_core and opt._is_legacy_option:  # type: ignore
                    opt.process_query_conditionally(self)  # type: ignore
        else:
            for opt in opts:
                if not opt._is_core and opt._is_legacy_option:  # type: ignore
                    opt.process_query(self)  # type: ignore

        self._with_options += opts
        return self

    def with_transformation(
        self, fn: Callable[[Query[Any]], Query[Any]]
    ) -> Query[Any]:
        """Return a new :class:`_query.Query` object transformed by
        the given function.

        E.g.::

            def filter_something(criterion):
                def transform(q):
                    return q.filter(criterion)
                return transform

            q = q.with_transformation(filter_something(x==5))

        This allows ad-hoc recipes to be created for :class:`_query.Query`
        objects.

        """
        return fn(self)

    def get_execution_options(self) -> _ImmutableExecuteOptions:
        """Get the non-SQL options which will take effect during execution.

        .. versionadded:: 1.3

        .. seealso::

            :meth:`_query.Query.execution_options`

            :meth:`_sql.Select.get_execution_options` - v2 comparable method.

        """
        return self._execution_options

    @overload
    def execution_options(
        self,
        *,
        compiled_cache: Optional[CompiledCacheType] = ...,
        logging_token: str = ...,
        isolation_level: IsolationLevel = ...,
        no_parameters: bool = False,
        stream_results: bool = False,
        max_row_buffer: int = ...,
        yield_per: int = ...,
        insertmanyvalues_page_size: int = ...,
        schema_translate_map: Optional[SchemaTranslateMapType] = ...,
        populate_existing: bool = False,
        autoflush: bool = False,
        **opt: Any,
    ) -> Self:
        ...

    @overload
    def execution_options(self, **opt: Any) -> Self:
        ...

    @_generative
    def execution_options(self, **kwargs: Any) -> Self:
        """Set non-SQL options which take effect during execution.

        Options allowed here include all of those accepted by
        :meth:`_engine.Connection.execution_options`, as well as a series
        of ORM specific options:

        ``populate_existing=True`` - equivalent to using
        :meth:`_orm.Query.populate_existing`

        ``autoflush=True|False`` - equivalent to using
        :meth:`_orm.Query.autoflush`

        ``yield_per=<value>`` - equivalent to using
        :meth:`_orm.Query.yield_per`

        Note that the ``stream_results`` execution option is enabled
        automatically if the :meth:`~sqlalchemy.orm.query.Query.yield_per()`
        method or execution option is used.

        .. versionadded:: 1.4 - added ORM options to
           :meth:`_orm.Query.execution_options`

        The execution options may also be specified on a per execution basis
        when using :term:`2.0 style` queries via the
        :paramref:`_orm.Session.execution_options` parameter.

        .. warning:: The
           :paramref:`_engine.Connection.execution_options.stream_results`
           parameter should not be used at the level of individual ORM
           statement executions, as the :class:`_orm.Session` will not track
           objects from different schema translate maps within a single
           session.  For multiple schema translate maps within the scope of a
           single :class:`_orm.Session`, see :ref:`examples_sharding`.


        .. seealso::

            :ref:`engine_stream_results`

            :meth:`_query.Query.get_execution_options`

            :meth:`_sql.Select.execution_options` - v2 equivalent method.

        """
        self._execution_options = self._execution_options.union(kwargs)
        return self

    @_generative
    def with_for_update(
        self,
        *,
        nowait: bool = False,
        read: bool = False,
        of: Optional[_ForUpdateOfArgument] = None,
        skip_locked: bool = False,
        key_share: bool = False,
    ) -> Self:
        """return a new :class:`_query.Query`
        with the specified options for the
        ``FOR UPDATE`` clause.

        The behavior of this method is identical to that of
        :meth:`_expression.GenerativeSelect.with_for_update`.
        When called with no arguments,
        the resulting ``SELECT`` statement will have a ``FOR UPDATE`` clause
        appended.  When additional arguments are specified, backend-specific
        options such as ``FOR UPDATE NOWAIT`` or ``LOCK IN SHARE MODE``
        can take effect.

        E.g.::

            q = sess.query(User).populate_existing().with_for_update(nowait=True, of=User)

        The above query on a PostgreSQL backend will render like::

            SELECT users.id AS users_id FROM users FOR UPDATE OF users NOWAIT

        .. warning::

            Using ``with_for_update`` in the context of eager loading
            relationships is not officially supported or recommended by
            SQLAlchemy and may not work with certain queries on various
            database backends.  When ``with_for_update`` is successfully used
            with a query that involves :func:`_orm.joinedload`, SQLAlchemy will
            attempt to emit SQL that locks all involved tables.

        .. note::  It is generally a good idea to combine the use of the
           :meth:`_orm.Query.populate_existing` method when using the
           :meth:`_orm.Query.with_for_update` method.   The purpose of
           :meth:`_orm.Query.populate_existing` is to force all the data read
           from the SELECT to be populated into the ORM objects returned,
           even if these objects are already in the :term:`identity map`.

        .. seealso::

            :meth:`_expression.GenerativeSelect.with_for_update`
            - Core level method with
            full argument and behavioral description.

            :meth:`_orm.Query.populate_existing` - overwrites attributes of
            objects already loaded in the identity map.

        """  # noqa: E501

        self._for_update_arg = ForUpdateArg(
            read=read,
            nowait=nowait,
            of=of,
            skip_locked=skip_locked,
            key_share=key_share,
        )
        return self

    @_generative
    def params(
        self, __params: Optional[Dict[str, Any]] = None, **kw: Any
    ) -> Self:
        r"""Add values for bind parameters which may have been
        specified in filter().

        Parameters may be specified using \**kwargs, or optionally a single
        dictionary as the first positional argument. The reason for both is
        that \**kwargs is convenient, however some parameter dictionaries
        contain unicode keys in which case \**kwargs cannot be used.

        """
        if __params:
            kw.update(__params)
        self._params = self._params.union(kw)
        return self

    def where(self, *criterion: _ColumnExpressionArgument[bool]) -> Self:
        """A synonym for :meth:`.Query.filter`.

        .. versionadded:: 1.4

        .. seealso::

            :meth:`_sql.Select.where` - v2 equivalent method.

        """
        return self.filter(*criterion)

    @_generative
    @_assertions(_no_statement_condition, _no_limit_offset)
    def filter(self, *criterion: _ColumnExpressionArgument[bool]) -> Self:
        r"""Apply the given filtering criterion to a copy
        of this :class:`_query.Query`, using SQL expressions.

        e.g.::

            session.query(MyClass).filter(MyClass.name == 'some name')

        Multiple criteria may be specified as comma separated; the effect
        is that they will be joined together using the :func:`.and_`
        function::

            session.query(MyClass).\
                filter(MyClass.name == 'some name', MyClass.id > 5)

        The criterion is any SQL expression object applicable to the
        WHERE clause of a select.   String expressions are coerced
        into SQL expression constructs via the :func:`_expression.text`
        construct.

        .. seealso::

            :meth:`_query.Query.filter_by` - filter on keyword expressions.

            :meth:`_sql.Select.where` - v2 equivalent method.

        """
        for crit in list(criterion):
            crit = coercions.expect(
                roles.WhereHavingRole, crit, apply_propagate_attrs=self
            )

            self._where_criteria += (crit,)
        return self

    @util.memoized_property
    def _last_joined_entity(
        self,
    ) -> Optional[Union[_InternalEntityType[Any], _JoinTargetElement]]:
        if self._setup_joins:
            return _determine_last_joined_entity(
                self._setup_joins,
            )
        else:
            return None

    def _filter_by_zero(self) -> Any:
        """for the filter_by() method, return the target entity for which
        we will attempt to derive an expression from based on string name.

        """

        if self._setup_joins:
            _last_joined_entity = self._last_joined_entity
            if _last_joined_entity is not None:
                return _last_joined_entity

        # discussion related to #7239
        # special check determines if we should try to derive attributes
        # for filter_by() from the "from object", i.e., if the user
        # called query.select_from(some selectable).filter_by(some_attr=value).
        # We don't want to do that in the case that methods like
        # from_self(), select_entity_from(), or a set op like union() were
        # called; while these methods also place a
        # selectable in the _from_obj collection, they also set up
        # the _set_base_alias boolean which turns on the whole "adapt the
        # entity to this selectable" thing, meaning the query still continues
        # to construct itself in terms of the lead entity that was passed
        # to query(), e.g. query(User).from_self() is still in terms of User,
        # and not the subquery that from_self() created.   This feature of
        # "implicitly adapt all occurrences of entity X to some arbitrary
        # subquery" is the main thing I am trying to do away with in 2.0 as
        # users should now used aliased() for that, but I can't entirely get
        # rid of it due to query.union() and other set ops relying upon it.
        #
        # compare this to the base Select()._filter_by_zero() which can
        # just return self._from_obj[0] if present, because there is no
        # "_set_base_alias" feature.
        #
        # IOW, this conditional essentially detects if
        # "select_from(some_selectable)" has been called, as opposed to
        # "select_entity_from()", "from_self()"
        # or "union() / some_set_op()".
        if self._from_obj and not self._compile_options._set_base_alias:
            return self._from_obj[0]

        return self._raw_columns[0]

    def filter_by(self, **kwargs: Any) -> Self:
        r"""Apply the given filtering criterion to a copy
        of this :class:`_query.Query`, using keyword expressions.

        e.g.::

            session.query(MyClass).filter_by(name = 'some name')

        Multiple criteria may be specified as comma separated; the effect
        is that they will be joined together using the :func:`.and_`
        function::

            session.query(MyClass).\
                filter_by(name = 'some name', id = 5)

        The keyword expressions are extracted from the primary
        entity of the query, or the last entity that was the
        target of a call to :meth:`_query.Query.join`.

        .. seealso::

            :meth:`_query.Query.filter` - filter on SQL expressions.

            :meth:`_sql.Select.filter_by` - v2 comparable method.

        """
        from_entity = self._filter_by_zero()

        clauses = [
            _entity_namespace_key(from_entity, key) == value
            for key, value in kwargs.items()
        ]
        return self.filter(*clauses)

    @_generative
    def order_by(
        self,
        __first: Union[
            Literal[None, False, _NoArg.NO_ARG],
            _ColumnExpressionOrStrLabelArgument[Any],
        ] = _NoArg.NO_ARG,
        *clauses: _ColumnExpressionOrStrLabelArgument[Any],
    ) -> Self:
        """Apply one or more ORDER BY criteria to the query and return
        the newly resulting :class:`_query.Query`.

        e.g.::

            q = session.query(Entity).order_by(Entity.id, Entity.name)

        Calling this method multiple times is equivalent to calling it once
        with all the clauses concatenated. All existing ORDER BY criteria may
        be cancelled by passing ``None`` by itself.  New ORDER BY criteria may
        then be added by invoking :meth:`_orm.Query.order_by` again, e.g.::

            # will erase all ORDER BY and ORDER BY new_col alone
            q = q.order_by(None).order_by(new_col)

        .. seealso::

            These sections describe ORDER BY in terms of :term:`2.0 style`
            invocation but apply to :class:`_orm.Query` as well:

            :ref:`tutorial_order_by` - in the :ref:`unified_tutorial`

            :ref:`tutorial_order_by_label` - in the :ref:`unified_tutorial`

            :meth:`_sql.Select.order_by` - v2 equivalent method.

        """

        for assertion in (self._no_statement_condition, self._no_limit_offset):
            assertion("order_by")

        if not clauses and (__first is None or __first is False):
            self._order_by_clauses = ()
        elif __first is not _NoArg.NO_ARG:
            criterion = tuple(
                coercions.expect(roles.OrderByRole, clause)
                for clause in (__first,) + clauses
            )
            self._order_by_clauses += criterion

        return self

    @_generative
    def group_by(
        self,
        __first: Union[
            Literal[None, False, _NoArg.NO_ARG],
            _ColumnExpressionOrStrLabelArgument[Any],
        ] = _NoArg.NO_ARG,
        *clauses: _ColumnExpressionOrStrLabelArgument[Any],
    ) -> Self:
        """Apply one or more GROUP BY criterion to the query and return
        the newly resulting :class:`_query.Query`.

        All existing GROUP BY settings can be suppressed by
        passing ``None`` - this will suppress any GROUP BY configured
        on mappers as well.

        .. seealso::

            These sections describe GROUP BY in terms of :term:`2.0 style`
            invocation but apply to :class:`_orm.Query` as well:

            :ref:`tutorial_group_by_w_aggregates` - in the
            :ref:`unified_tutorial`

            :ref:`tutorial_order_by_label` - in the :ref:`unified_tutorial`

            :meth:`_sql.Select.group_by` - v2 equivalent method.

        """

        for assertion in (self._no_statement_condition, self._no_limit_offset):
            assertion("group_by")

        if not clauses and (__first is None or __first is False):
            self._group_by_clauses = ()
        elif __first is not _NoArg.NO_ARG:
            criterion = tuple(
                coercions.expect(roles.GroupByRole, clause)
                for clause in (__first,) + clauses
            )
            self._group_by_clauses += criterion
        return self

    @_generative
    @_assertions(_no_statement_condition, _no_limit_offset)
    def having(self, *having: _ColumnExpressionArgument[bool]) -> Self:
        r"""Apply a HAVING criterion to the query and return the
        newly resulting :class:`_query.Query`.

        :meth:`_query.Query.having` is used in conjunction with
        :meth:`_query.Query.group_by`.

        HAVING criterion makes it possible to use filters on aggregate
        functions like COUNT, SUM, AVG, MAX, and MIN, eg.::

            q = session.query(User.id).\
                        join(User.addresses).\
                        group_by(User.id).\
                        having(func.count(Address.id) > 2)

        .. seealso::

            :meth:`_sql.Select.having` - v2 equivalent method.

        """

        for criterion in having:
            having_criteria = coercions.expect(
                roles.WhereHavingRole, criterion
            )
            self._having_criteria += (having_criteria,)
        return self

    def _set_op(self, expr_fn: Any, *q: Query[Any]) -> Self:
        list_of_queries = (self,) + q
        return self._from_selectable(expr_fn(*(list_of_queries)).subquery())

    def union(self, *q: Query[Any]) -> Self:
        """Produce a UNION of this Query against one or more queries.

        e.g.::

            q1 = sess.query(SomeClass).filter(SomeClass.foo=='bar')
            q2 = sess.query(SomeClass).filter(SomeClass.bar=='foo')

            q3 = q1.union(q2)

        The method accepts multiple Query objects so as to control
        the level of nesting.  A series of ``union()`` calls such as::

            x.union(y).union(z).all()

        will nest on each ``union()``, and produces::

            SELECT * FROM (SELECT * FROM (SELECT * FROM X UNION
                            SELECT * FROM y) UNION SELECT * FROM Z)

        Whereas::

            x.union(y, z).all()

        produces::

            SELECT * FROM (SELECT * FROM X UNION SELECT * FROM y UNION
                            SELECT * FROM Z)

        Note that many database backends do not allow ORDER BY to
        be rendered on a query called within UNION, EXCEPT, etc.
        To disable all ORDER BY clauses including those configured
        on mappers, issue ``query.order_by(None)`` - the resulting
        :class:`_query.Query` object will not render ORDER BY within
        its SELECT statement.

        .. seealso::

            :meth:`_sql.Select.union` - v2 equivalent method.

        """
        return self._set_op(expression.union, *q)

    def union_all(self, *q: Query[Any]) -> Self:
        """Produce a UNION ALL of this Query against one or more queries.

        Works the same way as :meth:`~sqlalchemy.orm.query.Query.union`. See
        that method for usage examples.

        .. seealso::

            :meth:`_sql.Select.union_all` - v2 equivalent method.

        """
        return self._set_op(expression.union_all, *q)

    def intersect(self, *q: Query[Any]) -> Self:
        """Produce an INTERSECT of this Query against one or more queries.

        Works the same way as :meth:`~sqlalchemy.orm.query.Query.union`. See
        that method for usage examples.

        .. seealso::

            :meth:`_sql.Select.intersect` - v2 equivalent method.

        """
        return self._set_op(expression.intersect, *q)

    def intersect_all(self, *q: Query[Any]) -> Self:
        """Produce an INTERSECT ALL of this Query against one or more queries.

        Works the same way as :meth:`~sqlalchemy.orm.query.Query.union`. See
        that method for usage examples.

        .. seealso::

            :meth:`_sql.Select.intersect_all` - v2 equivalent method.

        """
        return self._set_op(expression.intersect_all, *q)

    def except_(self, *q: Query[Any]) -> Self:
        """Produce an EXCEPT of this Query against one or more queries.

        Works the same way as :meth:`~sqlalchemy.orm.query.Query.union`. See
        that method for usage examples.

        .. seealso::

            :meth:`_sql.Select.except_` - v2 equivalent method.

        """
        return self._set_op(expression.except_, *q)

    def except_all(self, *q: Query[Any]) -> Self:
        """Produce an EXCEPT ALL of this Query against one or more queries.

        Works the same way as :meth:`~sqlalchemy.orm.query.Query.union`. See
        that method for usage examples.

        .. seealso::

            :meth:`_sql.Select.except_all` - v2 equivalent method.

        """
        return self._set_op(expression.except_all, *q)

    @_generative
    @_assertions(_no_statement_condition, _no_limit_offset)
    def join(
        self,
        target: _JoinTargetArgument,
        onclause: Optional[_OnClauseArgument] = None,
        *,
        isouter: bool = False,
        full: bool = False,
    ) -> Self:
        r"""Create a SQL JOIN against this :class:`_query.Query`
        object's criterion
        and apply generatively, returning the newly resulting
        :class:`_query.Query`.

        **Simple Relationship Joins**

        Consider a mapping between two classes ``User`` and ``Address``,
        with a relationship ``User.addresses`` representing a collection
        of ``Address`` objects associated with each ``User``.   The most
        common usage of :meth:`_query.Query.join`
        is to create a JOIN along this
        relationship, using the ``User.addresses`` attribute as an indicator
        for how this should occur::

            q = session.query(User).join(User.addresses)

        Where above, the call to :meth:`_query.Query.join` along
        ``User.addresses`` will result in SQL approximately equivalent to::

            SELECT user.id, user.name
            FROM user JOIN address ON user.id = address.user_id

        In the above example we refer to ``User.addresses`` as passed to
        :meth:`_query.Query.join` as the "on clause", that is, it indicates
        how the "ON" portion of the JOIN should be constructed.

        To construct a chain of joins, multiple :meth:`_query.Query.join`
        calls may be used.  The relationship-bound attribute implies both
        the left and right side of the join at once::

            q = session.query(User).\
                    join(User.orders).\
                    join(Order.items).\
                    join(Item.keywords)

        .. note:: as seen in the above example, **the order in which each
           call to the join() method occurs is important**.    Query would not,
           for example, know how to join correctly if we were to specify
           ``User``, then ``Item``, then ``Order``, in our chain of joins; in
           such a case, depending on the arguments passed, it may raise an
           error that it doesn't know how to join, or it may produce invalid
           SQL in which case the database will raise an error. In correct
           practice, the
           :meth:`_query.Query.join` method is invoked in such a way that lines
           up with how we would want the JOIN clauses in SQL to be
           rendered, and each call should represent a clear link from what
           precedes it.

        **Joins to a Target Entity or Selectable**

        A second form of :meth:`_query.Query.join` allows any mapped entity or
        core selectable construct as a target.   In this usage,
        :meth:`_query.Query.join` will attempt to create a JOIN along the
        natural foreign key relationship between two entities::

            q = session.query(User).join(Address)

        In the above calling form, :meth:`_query.Query.join` is called upon to
        create the "on clause" automatically for us.  This calling form will
        ultimately raise an error if either there are no foreign keys between
        the two entities, or if there are multiple foreign key linkages between
        the target entity and the entity or entities already present on the
        left side such that creating a join requires more information.  Note
        that when indicating a join to a target without any ON clause, ORM
        configured relationships are not taken into account.

        **Joins to a Target with an ON Clause**

        The third calling form allows both the target entity as well
        as the ON clause to be passed explicitly.    A example that includes
        a SQL expression as the ON clause is as follows::

            q = session.query(User).join(Address, User.id==Address.user_id)

        The above form may also use a relationship-bound attribute as the
        ON clause as well::

            q = session.query(User).join(Address, User.addresses)

        The above syntax can be useful for the case where we wish
        to join to an alias of a particular target entity.  If we wanted
        to join to ``Address`` twice, it could be achieved using two
        aliases set up using the :func:`~sqlalchemy.orm.aliased` function::

            a1 = aliased(Address)
            a2 = aliased(Address)

            q = session.query(User).\
                    join(a1, User.addresses).\
                    join(a2, User.addresses).\
                    filter(a1.email_address=='ed@foo.com').\
                    filter(a2.email_address=='ed@bar.com')

        The relationship-bound calling form can also specify a target entity
        using the :meth:`_orm.PropComparator.of_type` method; a query
        equivalent to the one above would be::

            a1 = aliased(Address)
            a2 = aliased(Address)

            q = session.query(User).\
                    join(User.addresses.of_type(a1)).\
                    join(User.addresses.of_type(a2)).\
                    filter(a1.email_address == 'ed@foo.com').\
                    filter(a2.email_address == 'ed@bar.com')

        **Augmenting Built-in ON Clauses**

        As a substitute for providing a full custom ON condition for an
        existing relationship, the :meth:`_orm.PropComparator.and_` function
        may be applied to a relationship attribute to augment additional
        criteria into the ON clause; the additional criteria will be combined
        with the default criteria using AND::

            q = session.query(User).join(
                User.addresses.and_(Address.email_address != 'foo@bar.com')
            )

        .. versionadded:: 1.4

        **Joining to Tables and Subqueries**


        The target of a join may also be any table or SELECT statement,
        which may be related to a target entity or not.   Use the
        appropriate ``.subquery()`` method in order to make a subquery
        out of a query::

            subq = session.query(Address).\
                filter(Address.email_address == 'ed@foo.com').\
                subquery()


            q = session.query(User).join(
                subq, User.id == subq.c.user_id
            )

        Joining to a subquery in terms of a specific relationship and/or
        target entity may be achieved by linking the subquery to the
        entity using :func:`_orm.aliased`::

            subq = session.query(Address).\
                filter(Address.email_address == 'ed@foo.com').\
                subquery()

            address_subq = aliased(Address, subq)

            q = session.query(User).join(
                User.addresses.of_type(address_subq)
            )


        **Controlling what to Join From**

        In cases where the left side of the current state of
        :class:`_query.Query` is not in line with what we want to join from,
        the :meth:`_query.Query.select_from` method may be used::

            q = session.query(Address).select_from(User).\
                            join(User.addresses).\
                            filter(User.name == 'ed')

        Which will produce SQL similar to::

            SELECT address.* FROM user
                JOIN address ON user.id=address.user_id
                WHERE user.name = :name_1

        .. seealso::

            :meth:`_sql.Select.join` - v2 equivalent method.

        :param \*props: Incoming arguments for :meth:`_query.Query.join`,
         the props collection in modern use should be considered to be a  one
         or two argument form, either as a single "target" entity or ORM
         attribute-bound relationship, or as a target entity plus an "on
         clause" which  may be a SQL expression or ORM attribute-bound
         relationship.

        :param isouter=False: If True, the join used will be a left outer join,
         just as if the :meth:`_query.Query.outerjoin` method were called.

        :param full=False: render FULL OUTER JOIN; implies ``isouter``.

        """

        join_target = coercions.expect(
            roles.JoinTargetRole,
            target,
            apply_propagate_attrs=self,
            legacy=True,
        )
        if onclause is not None:
            onclause_element = coercions.expect(
                roles.OnClauseRole, onclause, legacy=True
            )
        else:
            onclause_element = None

        self._setup_joins += (
            (
                join_target,
                onclause_element,
                None,
                {
                    "isouter": isouter,
                    "full": full,
                },
            ),
        )

        self.__dict__.pop("_last_joined_entity", None)
        return self

    def outerjoin(
        self,
        target: _JoinTargetArgument,
        onclause: Optional[_OnClauseArgument] = None,
        *,
        full: bool = False,
    ) -> Self:
        """Create a left outer join against this ``Query`` object's criterion
        and apply generatively, returning the newly resulting ``Query``.

        Usage is the same as the ``join()`` method.

        .. seealso::

            :meth:`_sql.Select.outerjoin` - v2 equivalent method.

        """
        return self.join(target, onclause=onclause, isouter=True, full=full)

    @_generative
    @_assertions(_no_statement_condition)
    def reset_joinpoint(self) -> Self:
        """Return a new :class:`.Query`, where the "join point" has
        been reset back to the base FROM entities of the query.

        This method is usually used in conjunction with the
        ``aliased=True`` feature of the :meth:`~.Query.join`
        method.  See the example in :meth:`~.Query.join` for how
        this is used.

        """
        self._last_joined_entity = None

        return self

    @_generative
    @_assertions(_no_clauseelement_condition)
    def select_from(self, *from_obj: _FromClauseArgument) -> Self:
        r"""Set the FROM clause of this :class:`.Query` explicitly.

        :meth:`.Query.select_from` is often used in conjunction with
        :meth:`.Query.join` in order to control which entity is selected
        from on the "left" side of the join.

        The entity or selectable object here effectively replaces the
        "left edge" of any calls to :meth:`~.Query.join`, when no
        joinpoint is otherwise established - usually, the default "join
        point" is the leftmost entity in the :class:`~.Query` object's
        list of entities to be selected.

        A typical example::

            q = session.query(Address).select_from(User).\
                join(User.addresses).\
                filter(User.name == 'ed')

        Which produces SQL equivalent to::

            SELECT address.* FROM user
            JOIN address ON user.id=address.user_id
            WHERE user.name = :name_1

        :param \*from_obj: collection of one or more entities to apply
         to the FROM clause.  Entities can be mapped classes,
         :class:`.AliasedClass` objects, :class:`.Mapper` objects
         as well as core :class:`.FromClause` elements like subqueries.

        .. seealso::

            :meth:`~.Query.join`

            :meth:`.Query.select_entity_from`

            :meth:`_sql.Select.select_from` - v2 equivalent method.

        """

        self._set_select_from(from_obj, False)
        return self

    def __getitem__(self, item: Any) -> Any:
        return orm_util._getitem(
            self,
            item,
        )

    @_generative
    @_assertions(_no_statement_condition)
    def slice(
        self,
        start: int,
        stop: int,
    ) -> Self:
        """Computes the "slice" of the :class:`_query.Query` represented by
        the given indices and returns the resulting :class:`_query.Query`.

        The start and stop indices behave like the argument to Python's
        built-in :func:`range` function. This method provides an
        alternative to using ``LIMIT``/``OFFSET`` to get a slice of the
        query.

        For example, ::

            session.query(User).order_by(User.id).slice(1, 3)

        renders as

        .. sourcecode:: sql

           SELECT users.id AS users_id,
                  users.name AS users_name
           FROM users ORDER BY users.id
           LIMIT ? OFFSET ?
           (2, 1)

        .. seealso::

           :meth:`_query.Query.limit`

           :meth:`_query.Query.offset`

           :meth:`_sql.Select.slice` - v2 equivalent method.

        """

        self._limit_clause, self._offset_clause = sql_util._make_slice(
            self._limit_clause, self._offset_clause, start, stop
        )
        return self

    @_generative
    @_assertions(_no_statement_condition)
    def limit(self, limit: _LimitOffsetType) -> Self:
        """Apply a ``LIMIT`` to the query and return the newly resulting
        ``Query``.

        .. seealso::

            :meth:`_sql.Select.limit` - v2 equivalent method.

        """
        self._limit_clause = sql_util._offset_or_limit_clause(limit)
        return self

    @_generative
    @_assertions(_no_statement_condition)
    def offset(self, offset: _LimitOffsetType) -> Self:
        """Apply an ``OFFSET`` to the query and return the newly resulting
        ``Query``.

        .. seealso::

            :meth:`_sql.Select.offset` - v2 equivalent method.
        """
        self._offset_clause = sql_util._offset_or_limit_clause(offset)
        return self

    @_generative
    @_assertions(_no_statement_condition)
    def distinct(self, *expr: _ColumnExpressionArgument[Any]) -> Self:
        r"""Apply a ``DISTINCT`` to the query and return the newly resulting
        ``Query``.


        .. note::

            The ORM-level :meth:`.distinct` call includes logic that will
            automatically add columns from the ORDER BY of the query to the
            columns clause of the SELECT statement, to satisfy the common need
            of the database backend that ORDER BY columns be part of the SELECT
            list when DISTINCT is used.   These columns *are not* added to the
            list of columns actually fetched by the :class:`_query.Query`,
            however,
            so would not affect results. The columns are passed through when
            using the :attr:`_query.Query.statement` accessor, however.

            .. deprecated:: 2.0  This logic is deprecated and will be removed
               in SQLAlchemy 2.0.     See :ref:`migration_20_query_distinct`
               for a description of this use case in 2.0.

        .. seealso::

            :meth:`_sql.Select.distinct` - v2 equivalent method.

        :param \*expr: optional column expressions.  When present,
         the PostgreSQL dialect will render a ``DISTINCT ON (<expressions>)``
         construct.

         .. deprecated:: 1.4 Using \*expr in other dialects is deprecated
            and will raise :class:`_exc.CompileError` in a future version.

        """
        if expr:
            self._distinct = True
            self._distinct_on = self._distinct_on + tuple(
                coercions.expect(roles.ByOfRole, e) for e in expr
            )
        else:
            self._distinct = True
        return self

    def all(self) -> List[_T]:
        """Return the results represented by this :class:`_query.Query`
        as a list.

        This results in an execution of the underlying SQL statement.

        .. warning::  The :class:`_query.Query` object,
           when asked to return either
           a sequence or iterator that consists of full ORM-mapped entities,
           will **deduplicate entries based on primary key**.  See the FAQ for
           more details.

            .. seealso::

                :ref:`faq_query_deduplicating`

        .. seealso::

            :meth:`_engine.Result.all` - v2 comparable method.

            :meth:`_engine.Result.scalars` - v2 comparable method.
        """
        return self._iter().all()  # type: ignore

    @_generative
    @_assertions(_no_clauseelement_condition)
    def from_statement(self, statement: ExecutableReturnsRows) -> Self:
        """Execute the given SELECT statement and return results.

        This method bypasses all internal statement compilation, and the
        statement is executed without modification.

        The statement is typically either a :func:`_expression.text`
        or :func:`_expression.select` construct, and should return the set
        of columns
        appropriate to the entity class represented by this
        :class:`_query.Query`.

        .. seealso::

            :meth:`_sql.Select.from_statement` - v2 comparable method.

        """
        statement = coercions.expect(
            roles.SelectStatementRole, statement, apply_propagate_attrs=self
        )
        self._statement = statement
        return self

    def first(self) -> Optional[_T]:
        """Return the first result of this ``Query`` or
        None if the result doesn't contain any row.

        first() applies a limit of one within the generated SQL, so that
        only one primary entity row is generated on the server side
        (note this may consist of multiple result rows if join-loaded
        collections are present).

        Calling :meth:`_query.Query.first`
        results in an execution of the underlying
        query.

        .. seealso::

            :meth:`_query.Query.one`

            :meth:`_query.Query.one_or_none`

            :meth:`_engine.Result.first` - v2 comparable method.

            :meth:`_engine.Result.scalars` - v2 comparable method.

        """
        # replicates limit(1) behavior
        if self._statement is not None:
            return self._iter().first()  # type: ignore
        else:
            return self.limit(1)._iter().first()  # type: ignore

    def one_or_none(self) -> Optional[_T]:
        """Return at most one result or raise an exception.

        Returns ``None`` if the query selects
        no rows.  Raises ``sqlalchemy.orm.exc.MultipleResultsFound``
        if multiple object identities are returned, or if multiple
        rows are returned for a query that returns only scalar values
        as opposed to full identity-mapped entities.

        Calling :meth:`_query.Query.one_or_none`
        results in an execution of the
        underlying query.

        .. seealso::

            :meth:`_query.Query.first`

            :meth:`_query.Query.one`

            :meth:`_engine.Result.one_or_none` - v2 comparable method.

            :meth:`_engine.Result.scalar_one_or_none` - v2 comparable method.

        """
        return self._iter().one_or_none()  # type: ignore

    def one(self) -> _T:
        """Return exactly one result or raise an exception.

        Raises ``sqlalchemy.orm.exc.NoResultFound`` if the query selects
        no rows.  Raises ``sqlalchemy.orm.exc.MultipleResultsFound``
        if multiple object identities are returned, or if multiple
        rows are returned for a query that returns only scalar values
        as opposed to full identity-mapped entities.

        Calling :meth:`.one` results in an execution of the underlying query.

        .. seealso::

            :meth:`_query.Query.first`

            :meth:`_query.Query.one_or_none`

            :meth:`_engine.Result.one` - v2 comparable method.

            :meth:`_engine.Result.scalar_one` - v2 comparable method.

        """
        return self._iter().one()  # type: ignore

    def scalar(self) -> Any:
        """Return the first element of the first result or None
        if no rows present.  If multiple rows are returned,
        raises MultipleResultsFound.

          >>> session.query(Item).scalar()
          <Item>
          >>> session.query(Item.id).scalar()
          1
          >>> session.query(Item.id).filter(Item.id < 0).scalar()
          None
          >>> session.query(Item.id, Item.name).scalar()
          1
          >>> session.query(func.count(Parent.id)).scalar()
          20

        This results in an execution of the underlying query.

        .. seealso::

            :meth:`_engine.Result.scalar` - v2 comparable method.

        """
        # TODO: not sure why we can't use result.scalar() here
        try:
            ret = self.one()
            if not isinstance(ret, collections_abc.Sequence):
                return ret
            return ret[0]
        except sa_exc.NoResultFound:
            return None

    def __iter__(self) -> Iterator[_T]:
        result = self._iter()
        try:
            yield from result  # type: ignore
        except GeneratorExit:
            # issue #8710 - direct iteration is not re-usable after
            # an iterable block is broken, so close the result
            result._soft_close()
            raise

    def _iter(self) -> Union[ScalarResult[_T], Result[_T]]:
        # new style execution.
        params = self._params

        statement = self._statement_20()
        result: Union[ScalarResult[_T], Result[_T]] = self.session.execute(
            statement,
            params,
            execution_options={"_sa_orm_load_options": self.load_options},
        )

        # legacy: automatically set scalars, unique
        if result._attributes.get("is_single_entity", False):
            result = cast("Result[_T]", result).scalars()

        if (
            result._attributes.get("filtered", False)
            and not self.load_options._yield_per
        ):
            result = result.unique()

        return result

    def __str__(self) -> str:
        statement = self._statement_20()

        try:
            bind = (
                self._get_bind_args(statement, self.session.get_bind)
                if self.session
                else None
            )
        except sa_exc.UnboundExecutionError:
            bind = None

        return str(statement.compile(bind))

    def _get_bind_args(self, statement: Any, fn: Any, **kw: Any) -> Any:
        return fn(clause=statement, **kw)

    @property
    def column_descriptions(self) -> List[ORMColumnDescription]:
        """Return metadata about the columns which would be
        returned by this :class:`_query.Query`.

        Format is a list of dictionaries::

            user_alias = aliased(User, name='user2')
            q = sess.query(User, User.id, user_alias)

            # this expression:
            q.column_descriptions

            # would return:
            [
                {
                    'name':'User',
                    'type':User,
                    'aliased':False,
                    'expr':User,
                    'entity': User
                },
                {
                    'name':'id',
                    'type':Integer(),
                    'aliased':False,
                    'expr':User.id,
                    'entity': User
                },
                {
                    'name':'user2',
                    'type':User,
                    'aliased':True,
                    'expr':user_alias,
                    'entity': user_alias
                }
            ]

        .. seealso::

            This API is available using :term:`2.0 style` queries as well,
            documented at:

            * :ref:`queryguide_inspection`

            * :attr:`.Select.column_descriptions`

        """

        return _column_descriptions(self, legacy=True)

    @util.deprecated(
        "2.0",
        "The :meth:`_orm.Query.instances` method is deprecated and will "
        "be removed in a future release. "
        "Use the Select.from_statement() method or aliased() construct in "
        "conjunction with Session.execute() instead.",
    )
    def instances(
        self,
        result_proxy: CursorResult[Any],
        context: Optional[QueryContext] = None,
    ) -> Any:
        """Return an ORM result given a :class:`_engine.CursorResult` and
        :class:`.QueryContext`.

        """
        if context is None:
            util.warn_deprecated(
                "Using the Query.instances() method without a context "
                "is deprecated and will be disallowed in a future release.  "
                "Please make use of :meth:`_query.Query.from_statement` "
                "for linking ORM results to arbitrary select constructs.",
                version="1.4",
            )
            compile_state = self._compile_state(for_statement=False)

            context = QueryContext(
                compile_state,
                compile_state.statement,
                self._params,
                self.session,
                self.load_options,
            )

        result = loading.instances(result_proxy, context)

        # legacy: automatically set scalars, unique
        if result._attributes.get("is_single_entity", False):
            result = result.scalars()  # type: ignore

        if result._attributes.get("filtered", False):
            result = result.unique()

        # TODO: isn't this supposed to be a list?
        return result

    @util.became_legacy_20(
        ":meth:`_orm.Query.merge_result`",
        alternative="The method is superseded by the "
        ":func:`_orm.merge_frozen_result` function.",
        enable_warnings=False,  # warnings occur via loading.merge_result
    )
    def merge_result(
        self,
        iterator: Union[
            FrozenResult[Any], Iterable[Sequence[Any]], Iterable[object]
        ],
        load: bool = True,
    ) -> Union[FrozenResult[Any], Iterable[Any]]:
        """Merge a result into this :class:`_query.Query` object's Session.

        Given an iterator returned by a :class:`_query.Query`
        of the same structure
        as this one, return an identical iterator of results, with all mapped
        instances merged into the session using :meth:`.Session.merge`. This
        is an optimized method which will merge all mapped instances,
        preserving the structure of the result rows and unmapped columns with
        less method overhead than that of calling :meth:`.Session.merge`
        explicitly for each value.

        The structure of the results is determined based on the column list of
        this :class:`_query.Query` - if these do not correspond,
        unchecked errors
        will occur.

        The 'load' argument is the same as that of :meth:`.Session.merge`.

        For an example of how :meth:`_query.Query.merge_result` is used, see
        the source code for the example :ref:`examples_caching`, where
        :meth:`_query.Query.merge_result` is used to efficiently restore state
        from a cache back into a target :class:`.Session`.

        """

        return loading.merge_result(self, iterator, load)

    def exists(self) -> Exists:
        """A convenience method that turns a query into an EXISTS subquery
        of the form EXISTS (SELECT 1 FROM ... WHERE ...).

        e.g.::

            q = session.query(User).filter(User.name == 'fred')
            session.query(q.exists())

        Producing SQL similar to::

            SELECT EXISTS (
                SELECT 1 FROM users WHERE users.name = :name_1
            ) AS anon_1

        The EXISTS construct is usually used in the WHERE clause::

            session.query(User.id).filter(q.exists()).scalar()

        Note that some databases such as SQL Server don't allow an
        EXISTS expression to be present in the columns clause of a
        SELECT.    To select a simple boolean value based on the exists
        as a WHERE, use :func:`.literal`::

            from sqlalchemy import literal

            session.query(literal(True)).filter(q.exists()).scalar()

        .. seealso::

            :meth:`_sql.Select.exists` - v2 comparable method.

        """

        # .add_columns() for the case that we are a query().select_from(X),
        # so that ".statement" can be produced (#2995) but also without
        # omitting the FROM clause from a query(X) (#2818);
        # .with_only_columns() after we have a core select() so that
        # we get just "SELECT 1" without any entities.

        inner = (
            self.enable_eagerloads(False)
            .add_columns(sql.literal_column("1"))
            .set_label_style(LABEL_STYLE_TABLENAME_PLUS_COL)
            ._get_select_statement_only()
            .with_only_columns(1)
        )

        ezero = self._entity_from_pre_ent_zero()
        if ezero is not None:
            inner = inner.select_from(ezero)

        return sql.exists(inner)

    def count(self) -> int:
        r"""Return a count of rows this the SQL formed by this :class:`Query`
        would return.

        This generates the SQL for this Query as follows::

            SELECT count(1) AS count_1 FROM (
                SELECT <rest of query follows...>
            ) AS anon_1

        The above SQL returns a single row, which is the aggregate value
        of the count function; the :meth:`_query.Query.count`
        method then returns
        that single integer value.

        .. warning::

            It is important to note that the value returned by
            count() is **not the same as the number of ORM objects that this
            Query would return from a method such as the .all() method**.
            The :class:`_query.Query` object,
            when asked to return full entities,
            will **deduplicate entries based on primary key**, meaning if the
            same primary key value would appear in the results more than once,
            only one object of that primary key would be present.  This does
            not apply to a query that is against individual columns.

            .. seealso::

                :ref:`faq_query_deduplicating`

        For fine grained control over specific columns to count, to skip the
        usage of a subquery or otherwise control of the FROM clause, or to use
        other aggregate functions, use :attr:`~sqlalchemy.sql.expression.func`
        expressions in conjunction with :meth:`~.Session.query`, i.e.::

            from sqlalchemy import func

            # count User records, without
            # using a subquery.
            session.query(func.count(User.id))

            # return count of user "id" grouped
            # by "name"
            session.query(func.count(User.id)).\
                    group_by(User.name)

            from sqlalchemy import distinct

            # count distinct "name" values
            session.query(func.count(distinct(User.name)))

        .. seealso::

            :ref:`migration_20_query_usage`

        """
        col = sql.func.count(sql.literal_column("*"))
        return (  # type: ignore
            self._legacy_from_self(col).enable_eagerloads(False).scalar()
        )

    def delete(
        self, synchronize_session: SynchronizeSessionArgument = "auto"
    ) -> int:
        r"""Perform a DELETE with an arbitrary WHERE clause.

        Deletes rows matched by this query from the database.

        E.g.::

            sess.query(User).filter(User.age == 25).\
                delete(synchronize_session=False)

            sess.query(User).filter(User.age == 25).\
                delete(synchronize_session='evaluate')

        .. warning::

            See the section :ref:`orm_expression_update_delete` for important
            caveats and warnings, including limitations when using bulk UPDATE
            and DELETE with mapper inheritance configurations.

        :param synchronize_session: chooses the strategy to update the
         attributes on objects in the session.   See the section
         :ref:`orm_expression_update_delete` for a discussion of these
         strategies.

        :return: the count of rows matched as returned by the database's
          "row count" feature.

        .. seealso::

            :ref:`orm_expression_update_delete`

        """

        bulk_del = BulkDelete(self)
        if self.dispatch.before_compile_delete:
            for fn in self.dispatch.before_compile_delete:
                new_query = fn(bulk_del.query, bulk_del)
                if new_query is not None:
                    bulk_del.query = new_query

                self = bulk_del.query

        delete_ = sql.delete(*self._raw_columns)  # type: ignore
        delete_._where_criteria = self._where_criteria
        result: CursorResult[Any] = self.session.execute(
            delete_,
            self._params,
            execution_options=self._execution_options.union(
                {"synchronize_session": synchronize_session}
            ),
        )
        bulk_del.result = result  # type: ignore
        self.session.dispatch.after_bulk_delete(bulk_del)
        result.close()

        return result.rowcount

    def update(
        self,
        values: Dict[_DMLColumnArgument, Any],
        synchronize_session: SynchronizeSessionArgument = "auto",
        update_args: Optional[Dict[Any, Any]] = None,
    ) -> int:
        r"""Perform an UPDATE with an arbitrary WHERE clause.

        Updates rows matched by this query in the database.

        E.g.::

            sess.query(User).filter(User.age == 25).\
                update({User.age: User.age - 10}, synchronize_session=False)

            sess.query(User).filter(User.age == 25).\
                update({"age": User.age - 10}, synchronize_session='evaluate')

        .. warning::

            See the section :ref:`orm_expression_update_delete` for important
            caveats and warnings, including limitations when using arbitrary
            UPDATE and DELETE with mapper inheritance configurations.

        :param values: a dictionary with attributes names, or alternatively
         mapped attributes or SQL expressions, as keys, and literal
         values or sql expressions as values.   If :ref:`parameter-ordered
         mode <tutorial_parameter_ordered_updates>` is desired, the values can
         be passed as a list of 2-tuples; this requires that the
         :paramref:`~sqlalchemy.sql.expression.update.preserve_parameter_order`
         flag is passed to the :paramref:`.Query.update.update_args` dictionary
         as well.

        :param synchronize_session: chooses the strategy to update the
         attributes on objects in the session.   See the section
         :ref:`orm_expression_update_delete` for a discussion of these
         strategies.

        :param update_args: Optional dictionary, if present will be passed
         to the underlying :func:`_expression.update`
         construct as the ``**kw`` for
         the object.  May be used to pass dialect-specific arguments such
         as ``mysql_limit``, as well as other special arguments such as
         :paramref:`~sqlalchemy.sql.expression.update.preserve_parameter_order`.

        :return: the count of rows matched as returned by the database's
         "row count" feature.


        .. seealso::

            :ref:`orm_expression_update_delete`

        """

        update_args = update_args or {}

        bulk_ud = BulkUpdate(self, values, update_args)

        if self.dispatch.before_compile_update:
            for fn in self.dispatch.before_compile_update:
                new_query = fn(bulk_ud.query, bulk_ud)
                if new_query is not None:
                    bulk_ud.query = new_query
            self = bulk_ud.query

        upd = sql.update(*self._raw_columns)  # type: ignore

        ppo = update_args.pop("preserve_parameter_order", False)
        if ppo:
            upd = upd.ordered_values(*values)  # type: ignore
        else:
            upd = upd.values(values)
        if update_args:
            upd = upd.with_dialect_options(**update_args)

        upd._where_criteria = self._where_criteria
        result: CursorResult[Any] = self.session.execute(
            upd,
            self._params,
            execution_options=self._execution_options.union(
                {"synchronize_session": synchronize_session}
            ),
        )
        bulk_ud.result = result  # type: ignore
        self.session.dispatch.after_bulk_update(bulk_ud)
        result.close()
        return result.rowcount

    def _compile_state(
        self, for_statement: bool = False, **kw: Any
    ) -> ORMCompileState:
        """Create an out-of-compiler ORMCompileState object.

        The ORMCompileState object is normally created directly as a result
        of the SQLCompiler.process() method being handed a Select()
        or FromStatement() object that uses the "orm" plugin.   This method
        provides a means of creating this ORMCompileState object directly
        without using the compiler.

        This method is used only for deprecated cases, which include
        the .from_self() method for a Query that has multiple levels
        of .from_self() in use, as well as the instances() method.  It is
        also used within the test suite to generate ORMCompileState objects
        for test purposes.

        """

        stmt = self._statement_20(for_statement=for_statement, **kw)
        assert for_statement == stmt._compile_options._for_statement

        # this chooses between ORMFromStatementCompileState and
        # ORMSelectCompileState.  We could also base this on
        # query._statement is not None as we have the ORM Query here
        # however this is the more general path.
        compile_state_cls = cast(
            ORMCompileState,
            ORMCompileState._get_plugin_class_for_plugin(stmt, "orm"),
        )

        return compile_state_cls.create_for_statement(stmt, None)

    def _compile_context(self, for_statement: bool = False) -> QueryContext:
        compile_state = self._compile_state(for_statement=for_statement)
        context = QueryContext(
            compile_state,
            compile_state.statement,
            self._params,
            self.session,
            self.load_options,
        )

        return context


class AliasOption(interfaces.LoaderOption):
    inherit_cache = False

    @util.deprecated(
        "1.4",
        "The :class:`.AliasOption` object is not necessary "
        "for entities to be matched up to a query that is established "
        "via :meth:`.Query.from_statement` and now does nothing.",
    )
    def __init__(self, alias: Union[Alias, Subquery]):
        r"""Return a :class:`.MapperOption` that will indicate to the
        :class:`_query.Query`
        that the main table has been aliased.

        """

    def process_compile_state(self, compile_state: ORMCompileState) -> None:
        pass


class BulkUD:
    """State used for the orm.Query version of update() / delete().

    This object is now specific to Query only.

    """

    def __init__(self, query: Query[Any]):
        self.query = query.enable_eagerloads(False)
        self._validate_query_state()
        self.mapper = self.query._entity_from_pre_ent_zero()

    def _validate_query_state(self) -> None:
        for attr, methname, notset, op in (
            ("_limit_clause", "limit()", None, operator.is_),
            ("_offset_clause", "offset()", None, operator.is_),
            ("_order_by_clauses", "order_by()", (), operator.eq),
            ("_group_by_clauses", "group_by()", (), operator.eq),
            ("_distinct", "distinct()", False, operator.is_),
            (
                "_from_obj",
                "join(), outerjoin(), select_from(), or from_self()",
                (),
                operator.eq,
            ),
            (
                "_setup_joins",
                "join(), outerjoin(), select_from(), or from_self()",
                (),
                operator.eq,
            ),
        ):
            if not op(getattr(self.query, attr), notset):
                raise sa_exc.InvalidRequestError(
                    "Can't call Query.update() or Query.delete() "
                    "when %s has been called" % (methname,)
                )

    @property
    def session(self) -> Session:
        return self.query.session


class BulkUpdate(BulkUD):
    """BulkUD which handles UPDATEs."""

    def __init__(
        self,
        query: Query[Any],
        values: Dict[_DMLColumnArgument, Any],
        update_kwargs: Optional[Dict[Any, Any]],
    ):
        super().__init__(query)
        self.values = values
        self.update_kwargs = update_kwargs


class BulkDelete(BulkUD):
    """BulkUD which handles DELETEs."""


class RowReturningQuery(Query[Row[_TP]]):
    if TYPE_CHECKING:

        def tuples(self) -> Query[_TP]:  # type: ignore
            ...
