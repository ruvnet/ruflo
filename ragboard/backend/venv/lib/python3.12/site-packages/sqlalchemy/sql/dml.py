# sql/dml.py
# Copyright (C) 2009-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
"""
Provide :class:`_expression.Insert`, :class:`_expression.Update` and
:class:`_expression.Delete`.

"""
from __future__ import annotations

import collections.abc as collections_abc
import operator
from typing import Any
from typing import cast
from typing import Dict
from typing import Iterable
from typing import List
from typing import MutableMapping
from typing import NoReturn
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import coercions
from . import roles
from . import util as sql_util
from ._typing import _TP
from ._typing import _unexpected_kw
from ._typing import is_column_element
from ._typing import is_named_from_clause
from .base import _entity_namespace_key
from .base import _exclusive_against
from .base import _from_objects
from .base import _generative
from .base import _select_iterables
from .base import ColumnCollection
from .base import CompileState
from .base import DialectKWArgs
from .base import Executable
from .base import Generative
from .base import HasCompileState
from .elements import BooleanClauseList
from .elements import ClauseElement
from .elements import ColumnClause
from .elements import ColumnElement
from .elements import Null
from .selectable import Alias
from .selectable import ExecutableReturnsRows
from .selectable import FromClause
from .selectable import HasCTE
from .selectable import HasPrefixes
from .selectable import Join
from .selectable import SelectLabelStyle
from .selectable import TableClause
from .selectable import TypedReturnsRows
from .sqltypes import NullType
from .visitors import InternalTraversal
from .. import exc
from .. import util
from ..util.typing import Self
from ..util.typing import TypeGuard

if TYPE_CHECKING:
    from ._typing import _ColumnExpressionArgument
    from ._typing import _ColumnsClauseArgument
    from ._typing import _DMLColumnArgument
    from ._typing import _DMLColumnKeyMapping
    from ._typing import _DMLTableArgument
    from ._typing import _T0  # noqa
    from ._typing import _T1  # noqa
    from ._typing import _T2  # noqa
    from ._typing import _T3  # noqa
    from ._typing import _T4  # noqa
    from ._typing import _T5  # noqa
    from ._typing import _T6  # noqa
    from ._typing import _T7  # noqa
    from ._typing import _TypedColumnClauseArgument as _TCCA  # noqa
    from .base import ReadOnlyColumnCollection
    from .compiler import SQLCompiler
    from .elements import KeyedColumnElement
    from .selectable import _ColumnsClauseElement
    from .selectable import _SelectIterable
    from .selectable import Select
    from .selectable import Selectable

    def isupdate(dml: DMLState) -> TypeGuard[UpdateDMLState]:
        ...

    def isdelete(dml: DMLState) -> TypeGuard[DeleteDMLState]:
        ...

    def isinsert(dml: DMLState) -> TypeGuard[InsertDMLState]:
        ...

else:
    isupdate = operator.attrgetter("isupdate")
    isdelete = operator.attrgetter("isdelete")
    isinsert = operator.attrgetter("isinsert")


_T = TypeVar("_T", bound=Any)

_DMLColumnElement = Union[str, ColumnClause[Any]]
_DMLTableElement = Union[TableClause, Alias, Join]


class DMLState(CompileState):
    _no_parameters = True
    _dict_parameters: Optional[MutableMapping[_DMLColumnElement, Any]] = None
    _multi_parameters: Optional[
        List[MutableMapping[_DMLColumnElement, Any]]
    ] = None
    _ordered_values: Optional[List[Tuple[_DMLColumnElement, Any]]] = None
    _parameter_ordering: Optional[List[_DMLColumnElement]] = None
    _primary_table: FromClause
    _supports_implicit_returning = True

    isupdate = False
    isdelete = False
    isinsert = False

    statement: UpdateBase

    def __init__(
        self, statement: UpdateBase, compiler: SQLCompiler, **kw: Any
    ):
        raise NotImplementedError()

    @classmethod
    def get_entity_description(cls, statement: UpdateBase) -> Dict[str, Any]:
        return {
            "name": statement.table.name
            if is_named_from_clause(statement.table)
            else None,
            "table": statement.table,
        }

    @classmethod
    def get_returning_column_descriptions(
        cls, statement: UpdateBase
    ) -> List[Dict[str, Any]]:
        return [
            {
                "name": c.key,
                "type": c.type,
                "expr": c,
            }
            for c in statement._all_selected_columns
        ]

    @property
    def dml_table(self) -> _DMLTableElement:
        return self.statement.table

    if TYPE_CHECKING:

        @classmethod
        def get_plugin_class(cls, statement: Executable) -> Type[DMLState]:
            ...

    @classmethod
    def _get_multi_crud_kv_pairs(
        cls,
        statement: UpdateBase,
        multi_kv_iterator: Iterable[Dict[_DMLColumnArgument, Any]],
    ) -> List[Dict[_DMLColumnElement, Any]]:
        return [
            {
                coercions.expect(roles.DMLColumnRole, k): v
                for k, v in mapping.items()
            }
            for mapping in multi_kv_iterator
        ]

    @classmethod
    def _get_crud_kv_pairs(
        cls,
        statement: UpdateBase,
        kv_iterator: Iterable[Tuple[_DMLColumnArgument, Any]],
        needs_to_be_cacheable: bool,
    ) -> List[Tuple[_DMLColumnElement, Any]]:
        return [
            (
                coercions.expect(roles.DMLColumnRole, k),
                v
                if not needs_to_be_cacheable
                else coercions.expect(
                    roles.ExpressionElementRole,
                    v,
                    type_=NullType(),
                    is_crud=True,
                ),
            )
            for k, v in kv_iterator
        ]

    def _make_extra_froms(
        self, statement: DMLWhereBase
    ) -> Tuple[FromClause, List[FromClause]]:
        froms: List[FromClause] = []

        all_tables = list(sql_util.tables_from_leftmost(statement.table))
        primary_table = all_tables[0]
        seen = {primary_table}

        consider = statement._where_criteria
        if self._dict_parameters:
            consider += tuple(self._dict_parameters.values())

        for crit in consider:
            for item in _from_objects(crit):
                if not seen.intersection(item._cloned_set):
                    froms.append(item)
                seen.update(item._cloned_set)

        froms.extend(all_tables[1:])
        return primary_table, froms

    def _process_values(self, statement: ValuesBase) -> None:
        if self._no_parameters:
            self._dict_parameters = statement._values
            self._no_parameters = False

    def _process_select_values(self, statement: ValuesBase) -> None:
        assert statement._select_names is not None
        parameters: MutableMapping[_DMLColumnElement, Any] = {
            name: Null() for name in statement._select_names
        }

        if self._no_parameters:
            self._no_parameters = False
            self._dict_parameters = parameters
        else:
            # this condition normally not reachable as the Insert
            # does not allow this construction to occur
            assert False, "This statement already has parameters"

    def _no_multi_values_supported(self, statement: ValuesBase) -> NoReturn:
        raise exc.InvalidRequestError(
            "%s construct does not support "
            "multiple parameter sets." % statement.__visit_name__.upper()
        )

    def _cant_mix_formats_error(self) -> NoReturn:
        raise exc.InvalidRequestError(
            "Can't mix single and multiple VALUES "
            "formats in one INSERT statement; one style appends to a "
            "list while the other replaces values, so the intent is "
            "ambiguous."
        )


@CompileState.plugin_for("default", "insert")
class InsertDMLState(DMLState):
    isinsert = True

    include_table_with_column_exprs = False

    _has_multi_parameters = False

    def __init__(
        self,
        statement: Insert,
        compiler: SQLCompiler,
        disable_implicit_returning: bool = False,
        **kw: Any,
    ):
        self.statement = statement
        self._primary_table = statement.table

        if disable_implicit_returning:
            self._supports_implicit_returning = False

        self.isinsert = True
        if statement._select_names:
            self._process_select_values(statement)
        if statement._values is not None:
            self._process_values(statement)
        if statement._multi_values:
            self._process_multi_values(statement)

    @util.memoized_property
    def _insert_col_keys(self) -> List[str]:
        # this is also done in crud.py -> _key_getters_for_crud_column
        return [
            coercions.expect(roles.DMLColumnRole, col, as_key=True)
            for col in self._dict_parameters or ()
        ]

    def _process_values(self, statement: ValuesBase) -> None:
        if self._no_parameters:
            self._has_multi_parameters = False
            self._dict_parameters = statement._values
            self._no_parameters = False
        elif self._has_multi_parameters:
            self._cant_mix_formats_error()

    def _process_multi_values(self, statement: ValuesBase) -> None:
        for parameters in statement._multi_values:
            multi_parameters: List[MutableMapping[_DMLColumnElement, Any]] = [
                {
                    c.key: value
                    for c, value in zip(statement.table.c, parameter_set)
                }
                if isinstance(parameter_set, collections_abc.Sequence)
                else parameter_set
                for parameter_set in parameters
            ]

            if self._no_parameters:
                self._no_parameters = False
                self._has_multi_parameters = True
                self._multi_parameters = multi_parameters
                self._dict_parameters = self._multi_parameters[0]
            elif not self._has_multi_parameters:
                self._cant_mix_formats_error()
            else:
                assert self._multi_parameters
                self._multi_parameters.extend(multi_parameters)


@CompileState.plugin_for("default", "update")
class UpdateDMLState(DMLState):
    isupdate = True

    include_table_with_column_exprs = False

    def __init__(self, statement: Update, compiler: SQLCompiler, **kw: Any):
        self.statement = statement

        self.isupdate = True
        if statement._ordered_values is not None:
            self._process_ordered_values(statement)
        elif statement._values is not None:
            self._process_values(statement)
        elif statement._multi_values:
            self._no_multi_values_supported(statement)
        t, ef = self._make_extra_froms(statement)
        self._primary_table = t
        self._extra_froms = ef

        self.is_multitable = mt = ef
        self.include_table_with_column_exprs = bool(
            mt and compiler.render_table_with_column_in_update_from
        )

    def _process_ordered_values(self, statement: ValuesBase) -> None:
        parameters = statement._ordered_values

        if self._no_parameters:
            self._no_parameters = False
            assert parameters is not None
            self._dict_parameters = dict(parameters)
            self._ordered_values = parameters
            self._parameter_ordering = [key for key, value in parameters]
        else:
            raise exc.InvalidRequestError(
                "Can only invoke ordered_values() once, and not mixed "
                "with any other values() call"
            )


@CompileState.plugin_for("default", "delete")
class DeleteDMLState(DMLState):
    isdelete = True

    def __init__(self, statement: Delete, compiler: SQLCompiler, **kw: Any):
        self.statement = statement

        self.isdelete = True
        t, ef = self._make_extra_froms(statement)
        self._primary_table = t
        self._extra_froms = ef
        self.is_multitable = ef


class UpdateBase(
    roles.DMLRole,
    HasCTE,
    HasCompileState,
    DialectKWArgs,
    HasPrefixes,
    Generative,
    ExecutableReturnsRows,
    ClauseElement,
):
    """Form the base for ``INSERT``, ``UPDATE``, and ``DELETE`` statements."""

    __visit_name__ = "update_base"

    _hints: util.immutabledict[
        Tuple[_DMLTableElement, str], str
    ] = util.EMPTY_DICT
    named_with_column = False

    _label_style: SelectLabelStyle = (
        SelectLabelStyle.LABEL_STYLE_DISAMBIGUATE_ONLY
    )
    table: _DMLTableElement

    _return_defaults = False
    _return_defaults_columns: Optional[
        Tuple[_ColumnsClauseElement, ...]
    ] = None
    _supplemental_returning: Optional[Tuple[_ColumnsClauseElement, ...]] = None
    _returning: Tuple[_ColumnsClauseElement, ...] = ()

    is_dml = True

    def _generate_fromclause_column_proxies(
        self, fromclause: FromClause
    ) -> None:
        fromclause._columns._populate_separate_keys(
            col._make_proxy(fromclause)
            for col in self._all_selected_columns
            if is_column_element(col)
        )

    def params(self, *arg: Any, **kw: Any) -> NoReturn:
        """Set the parameters for the statement.

        This method raises ``NotImplementedError`` on the base class,
        and is overridden by :class:`.ValuesBase` to provide the
        SET/VALUES clause of UPDATE and INSERT.

        """
        raise NotImplementedError(
            "params() is not supported for INSERT/UPDATE/DELETE statements."
            " To set the values for an INSERT or UPDATE statement, use"
            " stmt.values(**parameters)."
        )

    @_generative
    def with_dialect_options(self, **opt: Any) -> Self:
        """Add dialect options to this INSERT/UPDATE/DELETE object.

        e.g.::

            upd = table.update().dialect_options(mysql_limit=10)

        .. versionadded: 1.4 - this method supersedes the dialect options
           associated with the constructor.


        """
        self._validate_dialect_kwargs(opt)
        return self

    @_generative
    def return_defaults(
        self,
        *cols: _DMLColumnArgument,
        supplemental_cols: Optional[Iterable[_DMLColumnArgument]] = None,
        sort_by_parameter_order: bool = False,
    ) -> Self:
        """Make use of a :term:`RETURNING` clause for the purpose
        of fetching server-side expressions and defaults, for supporting
        backends only.

        .. deepalchemy::

            The :meth:`.UpdateBase.return_defaults` method is used by the ORM
            for its internal work in fetching newly generated primary key
            and server default values, in particular to provide the underyling
            implementation of the :paramref:`_orm.Mapper.eager_defaults`
            ORM feature as well as to allow RETURNING support with bulk
            ORM inserts.  Its behavior is fairly idiosyncratic
            and is not really intended for general use.  End users should
            stick with using :meth:`.UpdateBase.returning` in order to
            add RETURNING clauses to their INSERT, UPDATE and DELETE
            statements.

        Normally, a single row INSERT statement will automatically populate the
        :attr:`.CursorResult.inserted_primary_key` attribute when executed,
        which stores the primary key of the row that was just inserted in the
        form of a :class:`.Row` object with column names as named tuple keys
        (and the :attr:`.Row._mapping` view fully populated as well). The
        dialect in use chooses the strategy to use in order to populate this
        data; if it was generated using server-side defaults and / or SQL
        expressions, dialect-specific approaches such as ``cursor.lastrowid``
        or ``RETURNING`` are typically used to acquire the new primary key
        value.

        However, when the statement is modified by calling
        :meth:`.UpdateBase.return_defaults` before executing the statement,
        additional behaviors take place **only** for backends that support
        RETURNING and for :class:`.Table` objects that maintain the
        :paramref:`.Table.implicit_returning` parameter at its default value of
        ``True``. In these cases, when the :class:`.CursorResult` is returned
        from the statement's execution, not only will
        :attr:`.CursorResult.inserted_primary_key` be populated as always, the
        :attr:`.CursorResult.returned_defaults` attribute will also be
        populated with a :class:`.Row` named-tuple representing the full range
        of server generated
        values from that single row, including values for any columns that
        specify :paramref:`_schema.Column.server_default` or which make use of
        :paramref:`_schema.Column.default` using a SQL expression.

        When invoking INSERT statements with multiple rows using
        :ref:`insertmanyvalues <engine_insertmanyvalues>`, the
        :meth:`.UpdateBase.return_defaults` modifier will have the effect of
        the :attr:`_engine.CursorResult.inserted_primary_key_rows` and
        :attr:`_engine.CursorResult.returned_defaults_rows` attributes being
        fully populated with lists of :class:`.Row` objects representing newly
        inserted primary key values as well as newly inserted server generated
        values for each row inserted. The
        :attr:`.CursorResult.inserted_primary_key` and
        :attr:`.CursorResult.returned_defaults` attributes will also continue
        to be populated with the first row of these two collections.

        If the backend does not support RETURNING or the :class:`.Table` in use
        has disabled :paramref:`.Table.implicit_returning`, then no RETURNING
        clause is added and no additional data is fetched, however the
        INSERT, UPDATE or DELETE statement proceeds normally.

        E.g.::

            stmt = table.insert().values(data='newdata').return_defaults()

            result = connection.execute(stmt)

            server_created_at = result.returned_defaults['created_at']

        When used against an UPDATE statement
        :meth:`.UpdateBase.return_defaults` instead looks for columns that
        include :paramref:`_schema.Column.onupdate` or
        :paramref:`_schema.Column.server_onupdate` parameters assigned, when
        constructing the columns that will be included in the RETURNING clause
        by default if explicit columns were not specified. When used against a
        DELETE statement, no columns are included in RETURNING by default, they
        instead must be specified explicitly as there are no columns that
        normally change values when a DELETE statement proceeds.

        .. versionadded:: 2.0  :meth:`.UpdateBase.return_defaults` is supported
           for DELETE statements also and has been moved from
           :class:`.ValuesBase` to :class:`.UpdateBase`.

        The :meth:`.UpdateBase.return_defaults` method is mutually exclusive
        against the :meth:`.UpdateBase.returning` method and errors will be
        raised during the SQL compilation process if both are used at the same
        time on one statement. The RETURNING clause of the INSERT, UPDATE or
        DELETE statement is therefore controlled by only one of these methods
        at a time.

        The :meth:`.UpdateBase.return_defaults` method differs from
        :meth:`.UpdateBase.returning` in these ways:

        1. :meth:`.UpdateBase.return_defaults` method causes the
           :attr:`.CursorResult.returned_defaults` collection to be populated
           with the first row from the RETURNING result. This attribute is not
           populated when using :meth:`.UpdateBase.returning`.

        2. :meth:`.UpdateBase.return_defaults` is compatible with existing
           logic used to fetch auto-generated primary key values that are then
           populated into the :attr:`.CursorResult.inserted_primary_key`
           attribute. By contrast, using :meth:`.UpdateBase.returning` will
           have the effect of the :attr:`.CursorResult.inserted_primary_key`
           attribute being left unpopulated.

        3. :meth:`.UpdateBase.return_defaults` can be called against any
           backend. Backends that don't support RETURNING will skip the usage
           of the feature, rather than raising an exception, *unless*
           ``supplemental_cols`` is passed. The return value
           of :attr:`_engine.CursorResult.returned_defaults` will be ``None``
           for backends that don't support RETURNING or for which the target
           :class:`.Table` sets :paramref:`.Table.implicit_returning` to
           ``False``.

        4. An INSERT statement invoked with executemany() is supported if the
           backend database driver supports the
           :ref:`insertmanyvalues <engine_insertmanyvalues>`
           feature which is now supported by most SQLAlchemy-included backends.
           When executemany is used, the
           :attr:`_engine.CursorResult.returned_defaults_rows` and
           :attr:`_engine.CursorResult.inserted_primary_key_rows` accessors
           will return the inserted defaults and primary keys.

           .. versionadded:: 1.4 Added
              :attr:`_engine.CursorResult.returned_defaults_rows` and
              :attr:`_engine.CursorResult.inserted_primary_key_rows` accessors.
              In version 2.0, the underlying implementation which fetches and
              populates the data for these attributes was generalized to be
              supported by most backends, whereas in 1.4 they were only
              supported by the ``psycopg2`` driver.


        :param cols: optional list of column key names or
         :class:`_schema.Column` that acts as a filter for those columns that
         will be fetched.
        :param supplemental_cols: optional list of RETURNING expressions,
          in the same form as one would pass to the
          :meth:`.UpdateBase.returning` method. When present, the additional
          columns will be included in the RETURNING clause, and the
          :class:`.CursorResult` object will be "rewound" when returned, so
          that methods like :meth:`.CursorResult.all` will return new rows
          mostly as though the statement used :meth:`.UpdateBase.returning`
          directly. However, unlike when using :meth:`.UpdateBase.returning`
          directly, the **order of the columns is undefined**, so can only be
          targeted using names or :attr:`.Row._mapping` keys; they cannot
          reliably be targeted positionally.

          .. versionadded:: 2.0

        :param sort_by_parameter_order: for a batch INSERT that is being
         executed against multiple parameter sets, organize the results of
         RETURNING so that the returned rows correspond to the order of
         parameter sets passed in.  This applies only to an :term:`executemany`
         execution for supporting dialects and typically makes use of the
         :term:`insertmanyvalues` feature.

         .. versionadded:: 2.0.10

         .. seealso::

            :ref:`engine_insertmanyvalues_returning_order` - background on
            sorting of RETURNING rows for bulk INSERT

        .. seealso::

            :meth:`.UpdateBase.returning`

            :attr:`_engine.CursorResult.returned_defaults`

            :attr:`_engine.CursorResult.returned_defaults_rows`

            :attr:`_engine.CursorResult.inserted_primary_key`

            :attr:`_engine.CursorResult.inserted_primary_key_rows`

        """

        if self._return_defaults:
            # note _return_defaults_columns = () means return all columns,
            # so if we have been here before, only update collection if there
            # are columns in the collection
            if self._return_defaults_columns and cols:
                self._return_defaults_columns = tuple(
                    util.OrderedSet(self._return_defaults_columns).union(
                        coercions.expect(roles.ColumnsClauseRole, c)
                        for c in cols
                    )
                )
            else:
                # set for all columns
                self._return_defaults_columns = ()
        else:
            self._return_defaults_columns = tuple(
                coercions.expect(roles.ColumnsClauseRole, c) for c in cols
            )
        self._return_defaults = True
        if sort_by_parameter_order:
            if not self.is_insert:
                raise exc.ArgumentError(
                    "The 'sort_by_parameter_order' argument to "
                    "return_defaults() only applies to INSERT statements"
                )
            self._sort_by_parameter_order = True
        if supplemental_cols:
            # uniquifying while also maintaining order (the maintain of order
            # is for test suites but also for vertical splicing
            supplemental_col_tup = (
                coercions.expect(roles.ColumnsClauseRole, c)
                for c in supplemental_cols
            )

            if self._supplemental_returning is None:
                self._supplemental_returning = tuple(
                    util.unique_list(supplemental_col_tup)
                )
            else:
                self._supplemental_returning = tuple(
                    util.unique_list(
                        self._supplemental_returning
                        + tuple(supplemental_col_tup)
                    )
                )

        return self

    @_generative
    def returning(
        self,
        *cols: _ColumnsClauseArgument[Any],
        sort_by_parameter_order: bool = False,
        **__kw: Any,
    ) -> UpdateBase:
        r"""Add a :term:`RETURNING` or equivalent clause to this statement.

        e.g.:

        .. sourcecode:: pycon+sql

            >>> stmt = (
            ...     table.update()
            ...     .where(table.c.data == "value")
            ...     .values(status="X")
            ...     .returning(table.c.server_flag, table.c.updated_timestamp)
            ... )
            >>> print(stmt)
            {printsql}UPDATE some_table SET status=:status
            WHERE some_table.data = :data_1
            RETURNING some_table.server_flag, some_table.updated_timestamp

        The method may be invoked multiple times to add new entries to the
        list of expressions to be returned.

        .. versionadded:: 1.4.0b2 The method may be invoked multiple times to
         add new entries to the list of expressions to be returned.

        The given collection of column expressions should be derived from the
        table that is the target of the INSERT, UPDATE, or DELETE.  While
        :class:`_schema.Column` objects are typical, the elements can also be
        expressions:

        .. sourcecode:: pycon+sql

            >>> stmt = table.insert().returning(
            ...     (table.c.first_name + " " + table.c.last_name).label("fullname")
            ... )
            >>> print(stmt)
            {printsql}INSERT INTO some_table (first_name, last_name)
            VALUES (:first_name, :last_name)
            RETURNING some_table.first_name || :first_name_1 || some_table.last_name AS fullname

        Upon compilation, a RETURNING clause, or database equivalent,
        will be rendered within the statement.   For INSERT and UPDATE,
        the values are the newly inserted/updated values.  For DELETE,
        the values are those of the rows which were deleted.

        Upon execution, the values of the columns to be returned are made
        available via the result set and can be iterated using
        :meth:`_engine.CursorResult.fetchone` and similar.
        For DBAPIs which do not
        natively support returning values (i.e. cx_oracle), SQLAlchemy will
        approximate this behavior at the result level so that a reasonable
        amount of behavioral neutrality is provided.

        Note that not all databases/DBAPIs
        support RETURNING.   For those backends with no support,
        an exception is raised upon compilation and/or execution.
        For those who do support it, the functionality across backends
        varies greatly, including restrictions on executemany()
        and other statements which return multiple rows. Please
        read the documentation notes for the database in use in
        order to determine the availability of RETURNING.

        :param \*cols: series of columns, SQL expressions, or whole tables
         entities to be returned.
        :param sort_by_parameter_order: for a batch INSERT that is being
         executed against multiple parameter sets, organize the results of
         RETURNING so that the returned rows correspond to the order of
         parameter sets passed in.  This applies only to an :term:`executemany`
         execution for supporting dialects and typically makes use of the
         :term:`insertmanyvalues` feature.

         .. versionadded:: 2.0.10

         .. seealso::

            :ref:`engine_insertmanyvalues_returning_order` - background on
            sorting of RETURNING rows for bulk INSERT (Core level discussion)

            :ref:`orm_queryguide_bulk_insert_returning_ordered` - example of
            use with :ref:`orm_queryguide_bulk_insert` (ORM level discussion)

        .. seealso::

          :meth:`.UpdateBase.return_defaults` - an alternative method tailored
          towards efficient fetching of server-side defaults and triggers
          for single-row INSERTs or UPDATEs.

          :ref:`tutorial_insert_returning` - in the :ref:`unified_tutorial`

        """  # noqa: E501
        if __kw:
            raise _unexpected_kw("UpdateBase.returning()", __kw)
        if self._return_defaults:
            raise exc.InvalidRequestError(
                "return_defaults() is already configured on this statement"
            )
        self._returning += tuple(
            coercions.expect(roles.ColumnsClauseRole, c) for c in cols
        )
        if sort_by_parameter_order:
            if not self.is_insert:
                raise exc.ArgumentError(
                    "The 'sort_by_parameter_order' argument to returning() "
                    "only applies to INSERT statements"
                )
            self._sort_by_parameter_order = True
        return self

    def corresponding_column(
        self, column: KeyedColumnElement[Any], require_embedded: bool = False
    ) -> Optional[ColumnElement[Any]]:
        return self.exported_columns.corresponding_column(
            column, require_embedded=require_embedded
        )

    @util.ro_memoized_property
    def _all_selected_columns(self) -> _SelectIterable:
        return [c for c in _select_iterables(self._returning)]

    @util.ro_memoized_property
    def exported_columns(
        self,
    ) -> ReadOnlyColumnCollection[Optional[str], ColumnElement[Any]]:
        """Return the RETURNING columns as a column collection for this
        statement.

        .. versionadded:: 1.4

        """
        return ColumnCollection(
            (c.key, c)
            for c in self._all_selected_columns
            if is_column_element(c)
        ).as_readonly()

    @_generative
    def with_hint(
        self,
        text: str,
        selectable: Optional[_DMLTableArgument] = None,
        dialect_name: str = "*",
    ) -> Self:
        """Add a table hint for a single table to this
        INSERT/UPDATE/DELETE statement.

        .. note::

         :meth:`.UpdateBase.with_hint` currently applies only to
         Microsoft SQL Server.  For MySQL INSERT/UPDATE/DELETE hints, use
         :meth:`.UpdateBase.prefix_with`.

        The text of the hint is rendered in the appropriate
        location for the database backend in use, relative
        to the :class:`_schema.Table` that is the subject of this
        statement, or optionally to that of the given
        :class:`_schema.Table` passed as the ``selectable`` argument.

        The ``dialect_name`` option will limit the rendering of a particular
        hint to a particular backend. Such as, to add a hint
        that only takes effect for SQL Server::

            mytable.insert().with_hint("WITH (PAGLOCK)", dialect_name="mssql")

        :param text: Text of the hint.
        :param selectable: optional :class:`_schema.Table` that specifies
         an element of the FROM clause within an UPDATE or DELETE
         to be the subject of the hint - applies only to certain backends.
        :param dialect_name: defaults to ``*``, if specified as the name
         of a particular dialect, will apply these hints only when
         that dialect is in use.
        """
        if selectable is None:
            selectable = self.table
        else:
            selectable = coercions.expect(roles.DMLTableRole, selectable)
        self._hints = self._hints.union({(selectable, dialect_name): text})
        return self

    @property
    def entity_description(self) -> Dict[str, Any]:
        """Return a :term:`plugin-enabled` description of the table and/or
        entity which this DML construct is operating against.

        This attribute is generally useful when using the ORM, as an
        extended structure which includes information about mapped
        entities is returned.  The section :ref:`queryguide_inspection`
        contains more background.

        For a Core statement, the structure returned by this accessor
        is derived from the :attr:`.UpdateBase.table` attribute, and
        refers to the :class:`.Table` being inserted, updated, or deleted::

            >>> stmt = insert(user_table)
            >>> stmt.entity_description
            {
                "name": "user_table",
                "table": Table("user_table", ...)
            }

        .. versionadded:: 1.4.33

        .. seealso::

            :attr:`.UpdateBase.returning_column_descriptions`

            :attr:`.Select.column_descriptions` - entity information for
            a :func:`.select` construct

            :ref:`queryguide_inspection` - ORM background

        """
        meth = DMLState.get_plugin_class(self).get_entity_description
        return meth(self)

    @property
    def returning_column_descriptions(self) -> List[Dict[str, Any]]:
        """Return a :term:`plugin-enabled` description of the columns
        which this DML construct is RETURNING against, in other words
        the expressions established as part of :meth:`.UpdateBase.returning`.

        This attribute is generally useful when using the ORM, as an
        extended structure which includes information about mapped
        entities is returned.  The section :ref:`queryguide_inspection`
        contains more background.

        For a Core statement, the structure returned by this accessor is
        derived from the same objects that are returned by the
        :attr:`.UpdateBase.exported_columns` accessor::

            >>> stmt = insert(user_table).returning(user_table.c.id, user_table.c.name)
            >>> stmt.entity_description
            [
                {
                    "name": "id",
                    "type": Integer,
                    "expr": Column("id", Integer(), table=<user>, ...)
                },
                {
                    "name": "name",
                    "type": String(),
                    "expr": Column("name", String(), table=<user>, ...)
                },
            ]

        .. versionadded:: 1.4.33

        .. seealso::

            :attr:`.UpdateBase.entity_description`

            :attr:`.Select.column_descriptions` - entity information for
            a :func:`.select` construct

            :ref:`queryguide_inspection` - ORM background

        """  # noqa: E501
        meth = DMLState.get_plugin_class(
            self
        ).get_returning_column_descriptions
        return meth(self)


class ValuesBase(UpdateBase):
    """Supplies support for :meth:`.ValuesBase.values` to
    INSERT and UPDATE constructs."""

    __visit_name__ = "values_base"

    _supports_multi_parameters = False

    select: Optional[Select[Any]] = None
    """SELECT statement for INSERT .. FROM SELECT"""

    _post_values_clause: Optional[ClauseElement] = None
    """used by extensions to Insert etc. to add additional syntacitcal
    constructs, e.g. ON CONFLICT etc."""

    _values: Optional[util.immutabledict[_DMLColumnElement, Any]] = None
    _multi_values: Tuple[
        Union[
            Sequence[Dict[_DMLColumnElement, Any]],
            Sequence[Sequence[Any]],
        ],
        ...,
    ] = ()

    _ordered_values: Optional[List[Tuple[_DMLColumnElement, Any]]] = None

    _select_names: Optional[List[str]] = None
    _inline: bool = False

    def __init__(self, table: _DMLTableArgument):
        self.table = coercions.expect(
            roles.DMLTableRole, table, apply_propagate_attrs=self
        )

    @_generative
    @_exclusive_against(
        "_select_names",
        "_ordered_values",
        msgs={
            "_select_names": "This construct already inserts from a SELECT",
            "_ordered_values": "This statement already has ordered "
            "values present",
        },
    )
    def values(
        self,
        *args: Union[
            _DMLColumnKeyMapping[Any],
            Sequence[Any],
        ],
        **kwargs: Any,
    ) -> Self:
        r"""Specify a fixed VALUES clause for an INSERT statement, or the SET
        clause for an UPDATE.

        Note that the :class:`_expression.Insert` and
        :class:`_expression.Update`
        constructs support
        per-execution time formatting of the VALUES and/or SET clauses,
        based on the arguments passed to :meth:`_engine.Connection.execute`.
        However, the :meth:`.ValuesBase.values` method can be used to "fix" a
        particular set of parameters into the statement.

        Multiple calls to :meth:`.ValuesBase.values` will produce a new
        construct, each one with the parameter list modified to include
        the new parameters sent.  In the typical case of a single
        dictionary of parameters, the newly passed keys will replace
        the same keys in the previous construct.  In the case of a list-based
        "multiple values" construct, each new list of values is extended
        onto the existing list of values.

        :param \**kwargs: key value pairs representing the string key
          of a :class:`_schema.Column`
          mapped to the value to be rendered into the
          VALUES or SET clause::

                users.insert().values(name="some name")

                users.update().where(users.c.id==5).values(name="some name")

        :param \*args: As an alternative to passing key/value parameters,
         a dictionary, tuple, or list of dictionaries or tuples can be passed
         as a single positional argument in order to form the VALUES or
         SET clause of the statement.  The forms that are accepted vary
         based on whether this is an :class:`_expression.Insert` or an
         :class:`_expression.Update` construct.

         For either an :class:`_expression.Insert` or
         :class:`_expression.Update`
         construct, a single dictionary can be passed, which works the same as
         that of the kwargs form::

            users.insert().values({"name": "some name"})

            users.update().values({"name": "some new name"})

         Also for either form but more typically for the
         :class:`_expression.Insert` construct, a tuple that contains an
         entry for every column in the table is also accepted::

            users.insert().values((5, "some name"))

         The :class:`_expression.Insert` construct also supports being
         passed a list of dictionaries or full-table-tuples, which on the
         server will render the less common SQL syntax of "multiple values" -
         this syntax is supported on backends such as SQLite, PostgreSQL,
         MySQL, but not necessarily others::

            users.insert().values([
                                {"name": "some name"},
                                {"name": "some other name"},
                                {"name": "yet another name"},
                            ])

         The above form would render a multiple VALUES statement similar to::

                INSERT INTO users (name) VALUES
                                (:name_1),
                                (:name_2),
                                (:name_3)

         It is essential to note that **passing multiple values is
         NOT the same as using traditional executemany() form**.  The above
         syntax is a **special** syntax not typically used.  To emit an
         INSERT statement against multiple rows, the normal method is
         to pass a multiple values list to the
         :meth:`_engine.Connection.execute`
         method, which is supported by all database backends and is generally
         more efficient for a very large number of parameters.

           .. seealso::

               :ref:`tutorial_multiple_parameters` - an introduction to
               the traditional Core method of multiple parameter set
               invocation for INSERTs and other statements.

          The UPDATE construct also supports rendering the SET parameters
          in a specific order.  For this feature refer to the
          :meth:`_expression.Update.ordered_values` method.

           .. seealso::

              :meth:`_expression.Update.ordered_values`


        """
        if args:
            # positional case.  this is currently expensive.   we don't
            # yet have positional-only args so we have to check the length.
            # then we need to check multiparams vs. single dictionary.
            # since the parameter format is needed in order to determine
            # a cache key, we need to determine this up front.
            arg = args[0]

            if kwargs:
                raise exc.ArgumentError(
                    "Can't pass positional and kwargs to values() "
                    "simultaneously"
                )
            elif len(args) > 1:
                raise exc.ArgumentError(
                    "Only a single dictionary/tuple or list of "
                    "dictionaries/tuples is accepted positionally."
                )

            elif isinstance(arg, collections_abc.Sequence):
                if arg and isinstance(arg[0], dict):
                    multi_kv_generator = DMLState.get_plugin_class(
                        self
                    )._get_multi_crud_kv_pairs
                    self._multi_values += (multi_kv_generator(self, arg),)
                    return self

                if arg and isinstance(arg[0], (list, tuple)):
                    self._multi_values += (arg,)
                    return self

                if TYPE_CHECKING:
                    # crud.py raises during compilation if this is not the
                    # case
                    assert isinstance(self, Insert)

                # tuple values
                arg = {c.key: value for c, value in zip(self.table.c, arg)}

        else:
            # kwarg path.  this is the most common path for non-multi-params
            # so this is fairly quick.
            arg = cast("Dict[_DMLColumnArgument, Any]", kwargs)
            if args:
                raise exc.ArgumentError(
                    "Only a single dictionary/tuple or list of "
                    "dictionaries/tuples is accepted positionally."
                )

        # for top level values(), convert literals to anonymous bound
        # parameters at statement construction time, so that these values can
        # participate in the cache key process like any other ClauseElement.
        # crud.py now intercepts bound parameters with unique=True from here
        # and ensures they get the "crud"-style name when rendered.

        kv_generator = DMLState.get_plugin_class(self)._get_crud_kv_pairs
        coerced_arg = dict(kv_generator(self, arg.items(), True))
        if self._values:
            self._values = self._values.union(coerced_arg)
        else:
            self._values = util.immutabledict(coerced_arg)
        return self


class Insert(ValuesBase):
    """Represent an INSERT construct.

    The :class:`_expression.Insert` object is created using the
    :func:`_expression.insert()` function.

    """

    __visit_name__ = "insert"

    _supports_multi_parameters = True

    select = None
    include_insert_from_select_defaults = False

    _sort_by_parameter_order: bool = False

    is_insert = True

    table: TableClause

    _traverse_internals = (
        [
            ("table", InternalTraversal.dp_clauseelement),
            ("_inline", InternalTraversal.dp_boolean),
            ("_select_names", InternalTraversal.dp_string_list),
            ("_values", InternalTraversal.dp_dml_values),
            ("_multi_values", InternalTraversal.dp_dml_multi_values),
            ("select", InternalTraversal.dp_clauseelement),
            ("_post_values_clause", InternalTraversal.dp_clauseelement),
            ("_returning", InternalTraversal.dp_clauseelement_tuple),
            ("_hints", InternalTraversal.dp_table_hint_list),
            ("_return_defaults", InternalTraversal.dp_boolean),
            (
                "_return_defaults_columns",
                InternalTraversal.dp_clauseelement_tuple,
            ),
            ("_sort_by_parameter_order", InternalTraversal.dp_boolean),
        ]
        + HasPrefixes._has_prefixes_traverse_internals
        + DialectKWArgs._dialect_kwargs_traverse_internals
        + Executable._executable_traverse_internals
        + HasCTE._has_ctes_traverse_internals
    )

    def __init__(self, table: _DMLTableArgument):
        super().__init__(table)

    @_generative
    def inline(self) -> Self:
        """Make this :class:`_expression.Insert` construct "inline" .

        When set, no attempt will be made to retrieve the
        SQL-generated default values to be provided within the statement;
        in particular,
        this allows SQL expressions to be rendered 'inline' within the
        statement without the need to pre-execute them beforehand; for
        backends that support "returning", this turns off the "implicit
        returning" feature for the statement.


        .. versionchanged:: 1.4 the :paramref:`_expression.Insert.inline`
           parameter
           is now superseded by the :meth:`_expression.Insert.inline` method.

        """
        self._inline = True
        return self

    @_generative
    def from_select(
        self,
        names: Sequence[_DMLColumnArgument],
        select: Selectable,
        include_defaults: bool = True,
    ) -> Self:
        """Return a new :class:`_expression.Insert` construct which represents
        an ``INSERT...FROM SELECT`` statement.

        e.g.::

            sel = select(table1.c.a, table1.c.b).where(table1.c.c > 5)
            ins = table2.insert().from_select(['a', 'b'], sel)

        :param names: a sequence of string column names or
         :class:`_schema.Column`
         objects representing the target columns.
        :param select: a :func:`_expression.select` construct,
         :class:`_expression.FromClause`
         or other construct which resolves into a
         :class:`_expression.FromClause`,
         such as an ORM :class:`_query.Query` object, etc.  The order of
         columns returned from this FROM clause should correspond to the
         order of columns sent as the ``names`` parameter;  while this
         is not checked before passing along to the database, the database
         would normally raise an exception if these column lists don't
         correspond.
        :param include_defaults: if True, non-server default values and
         SQL expressions as specified on :class:`_schema.Column` objects
         (as documented in :ref:`metadata_defaults_toplevel`) not
         otherwise specified in the list of names will be rendered
         into the INSERT and SELECT statements, so that these values are also
         included in the data to be inserted.

         .. note:: A Python-side default that uses a Python callable function
            will only be invoked **once** for the whole statement, and **not
            per row**.

        """

        if self._values:
            raise exc.InvalidRequestError(
                "This construct already inserts value expressions"
            )

        self._select_names = [
            coercions.expect(roles.DMLColumnRole, name, as_key=True)
            for name in names
        ]
        self._inline = True
        self.include_insert_from_select_defaults = include_defaults
        self.select = coercions.expect(roles.DMLSelectRole, select)
        return self

    if TYPE_CHECKING:
        # START OVERLOADED FUNCTIONS self.returning ReturningInsert 1-8 ", *, sort_by_parameter_order: bool = False"  # noqa: E501

        # code within this block is **programmatically,
        # statically generated** by tools/generate_tuple_map_overloads.py

        @overload
        def returning(
            self, __ent0: _TCCA[_T0], *, sort_by_parameter_order: bool = False
        ) -> ReturningInsert[Tuple[_T0]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            *,
            sort_by_parameter_order: bool = False,
        ) -> ReturningInsert[Tuple[_T0, _T1]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            __ent2: _TCCA[_T2],
            *,
            sort_by_parameter_order: bool = False,
        ) -> ReturningInsert[Tuple[_T0, _T1, _T2]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            __ent2: _TCCA[_T2],
            __ent3: _TCCA[_T3],
            *,
            sort_by_parameter_order: bool = False,
        ) -> ReturningInsert[Tuple[_T0, _T1, _T2, _T3]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            __ent2: _TCCA[_T2],
            __ent3: _TCCA[_T3],
            __ent4: _TCCA[_T4],
            *,
            sort_by_parameter_order: bool = False,
        ) -> ReturningInsert[Tuple[_T0, _T1, _T2, _T3, _T4]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            __ent2: _TCCA[_T2],
            __ent3: _TCCA[_T3],
            __ent4: _TCCA[_T4],
            __ent5: _TCCA[_T5],
            *,
            sort_by_parameter_order: bool = False,
        ) -> ReturningInsert[Tuple[_T0, _T1, _T2, _T3, _T4, _T5]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            __ent2: _TCCA[_T2],
            __ent3: _TCCA[_T3],
            __ent4: _TCCA[_T4],
            __ent5: _TCCA[_T5],
            __ent6: _TCCA[_T6],
            *,
            sort_by_parameter_order: bool = False,
        ) -> ReturningInsert[Tuple[_T0, _T1, _T2, _T3, _T4, _T5, _T6]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            __ent2: _TCCA[_T2],
            __ent3: _TCCA[_T3],
            __ent4: _TCCA[_T4],
            __ent5: _TCCA[_T5],
            __ent6: _TCCA[_T6],
            __ent7: _TCCA[_T7],
            *,
            sort_by_parameter_order: bool = False,
        ) -> ReturningInsert[Tuple[_T0, _T1, _T2, _T3, _T4, _T5, _T6, _T7]]:
            ...

        # END OVERLOADED FUNCTIONS self.returning

        @overload
        def returning(
            self,
            *cols: _ColumnsClauseArgument[Any],
            sort_by_parameter_order: bool = False,
            **__kw: Any,
        ) -> ReturningInsert[Any]:
            ...

        def returning(
            self,
            *cols: _ColumnsClauseArgument[Any],
            sort_by_parameter_order: bool = False,
            **__kw: Any,
        ) -> ReturningInsert[Any]:
            ...


class ReturningInsert(Insert, TypedReturnsRows[_TP]):
    """Typing-only class that establishes a generic type form of
    :class:`.Insert` which tracks returned column types.

    This datatype is delivered when calling the
    :meth:`.Insert.returning` method.

    .. versionadded:: 2.0

    """


class DMLWhereBase:
    table: _DMLTableElement
    _where_criteria: Tuple[ColumnElement[Any], ...] = ()

    @_generative
    def where(self, *whereclause: _ColumnExpressionArgument[bool]) -> Self:
        """Return a new construct with the given expression(s) added to
        its WHERE clause, joined to the existing clause via AND, if any.

        Both :meth:`_dml.Update.where` and :meth:`_dml.Delete.where`
        support multiple-table forms, including database-specific
        ``UPDATE...FROM`` as well as ``DELETE..USING``.  For backends that
        don't have multiple-table support, a backend agnostic approach
        to using multiple tables is to make use of correlated subqueries.
        See the linked tutorial sections below for examples.

        .. seealso::

            :ref:`tutorial_correlated_updates`

            :ref:`tutorial_update_from`

            :ref:`tutorial_multi_table_deletes`

        """

        for criterion in whereclause:
            where_criteria: ColumnElement[Any] = coercions.expect(
                roles.WhereHavingRole, criterion, apply_propagate_attrs=self
            )
            self._where_criteria += (where_criteria,)
        return self

    def filter(self, *criteria: roles.ExpressionElementRole[Any]) -> Self:
        """A synonym for the :meth:`_dml.DMLWhereBase.where` method.

        .. versionadded:: 1.4

        """

        return self.where(*criteria)

    def _filter_by_zero(self) -> _DMLTableElement:
        return self.table

    def filter_by(self, **kwargs: Any) -> Self:
        r"""apply the given filtering criterion as a WHERE clause
        to this select.

        """
        from_entity = self._filter_by_zero()

        clauses = [
            _entity_namespace_key(from_entity, key) == value
            for key, value in kwargs.items()
        ]
        return self.filter(*clauses)

    @property
    def whereclause(self) -> Optional[ColumnElement[Any]]:
        """Return the completed WHERE clause for this :class:`.DMLWhereBase`
        statement.

        This assembles the current collection of WHERE criteria
        into a single :class:`_expression.BooleanClauseList` construct.


        .. versionadded:: 1.4

        """

        return BooleanClauseList._construct_for_whereclause(
            self._where_criteria
        )


class Update(DMLWhereBase, ValuesBase):
    """Represent an Update construct.

    The :class:`_expression.Update` object is created using the
    :func:`_expression.update()` function.

    """

    __visit_name__ = "update"

    is_update = True

    _traverse_internals = (
        [
            ("table", InternalTraversal.dp_clauseelement),
            ("_where_criteria", InternalTraversal.dp_clauseelement_tuple),
            ("_inline", InternalTraversal.dp_boolean),
            ("_ordered_values", InternalTraversal.dp_dml_ordered_values),
            ("_values", InternalTraversal.dp_dml_values),
            ("_returning", InternalTraversal.dp_clauseelement_tuple),
            ("_hints", InternalTraversal.dp_table_hint_list),
            ("_return_defaults", InternalTraversal.dp_boolean),
            (
                "_return_defaults_columns",
                InternalTraversal.dp_clauseelement_tuple,
            ),
        ]
        + HasPrefixes._has_prefixes_traverse_internals
        + DialectKWArgs._dialect_kwargs_traverse_internals
        + Executable._executable_traverse_internals
        + HasCTE._has_ctes_traverse_internals
    )

    def __init__(self, table: _DMLTableArgument):
        super().__init__(table)

    @_generative
    def ordered_values(self, *args: Tuple[_DMLColumnArgument, Any]) -> Self:
        """Specify the VALUES clause of this UPDATE statement with an explicit
        parameter ordering that will be maintained in the SET clause of the
        resulting UPDATE statement.

        E.g.::

            stmt = table.update().ordered_values(
                ("name", "ed"), ("ident": "foo")
            )

        .. seealso::

           :ref:`tutorial_parameter_ordered_updates` - full example of the
           :meth:`_expression.Update.ordered_values` method.

        .. versionchanged:: 1.4 The :meth:`_expression.Update.ordered_values`
           method
           supersedes the
           :paramref:`_expression.update.preserve_parameter_order`
           parameter, which will be removed in SQLAlchemy 2.0.

        """
        if self._values:
            raise exc.ArgumentError(
                "This statement already has values present"
            )
        elif self._ordered_values:
            raise exc.ArgumentError(
                "This statement already has ordered values present"
            )

        kv_generator = DMLState.get_plugin_class(self)._get_crud_kv_pairs
        self._ordered_values = kv_generator(self, args, True)
        return self

    @_generative
    def inline(self) -> Self:
        """Make this :class:`_expression.Update` construct "inline" .

        When set, SQL defaults present on :class:`_schema.Column`
        objects via the
        ``default`` keyword will be compiled 'inline' into the statement and
        not pre-executed.  This means that their values will not be available
        in the dictionary returned from
        :meth:`_engine.CursorResult.last_updated_params`.

        .. versionchanged:: 1.4 the :paramref:`_expression.update.inline`
           parameter
           is now superseded by the :meth:`_expression.Update.inline` method.

        """
        self._inline = True
        return self

    if TYPE_CHECKING:
        # START OVERLOADED FUNCTIONS self.returning ReturningUpdate 1-8

        # code within this block is **programmatically,
        # statically generated** by tools/generate_tuple_map_overloads.py

        @overload
        def returning(self, __ent0: _TCCA[_T0]) -> ReturningUpdate[Tuple[_T0]]:
            ...

        @overload
        def returning(
            self, __ent0: _TCCA[_T0], __ent1: _TCCA[_T1]
        ) -> ReturningUpdate[Tuple[_T0, _T1]]:
            ...

        @overload
        def returning(
            self, __ent0: _TCCA[_T0], __ent1: _TCCA[_T1], __ent2: _TCCA[_T2]
        ) -> ReturningUpdate[Tuple[_T0, _T1, _T2]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            __ent2: _TCCA[_T2],
            __ent3: _TCCA[_T3],
        ) -> ReturningUpdate[Tuple[_T0, _T1, _T2, _T3]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            __ent2: _TCCA[_T2],
            __ent3: _TCCA[_T3],
            __ent4: _TCCA[_T4],
        ) -> ReturningUpdate[Tuple[_T0, _T1, _T2, _T3, _T4]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            __ent2: _TCCA[_T2],
            __ent3: _TCCA[_T3],
            __ent4: _TCCA[_T4],
            __ent5: _TCCA[_T5],
        ) -> ReturningUpdate[Tuple[_T0, _T1, _T2, _T3, _T4, _T5]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            __ent2: _TCCA[_T2],
            __ent3: _TCCA[_T3],
            __ent4: _TCCA[_T4],
            __ent5: _TCCA[_T5],
            __ent6: _TCCA[_T6],
        ) -> ReturningUpdate[Tuple[_T0, _T1, _T2, _T3, _T4, _T5, _T6]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            __ent2: _TCCA[_T2],
            __ent3: _TCCA[_T3],
            __ent4: _TCCA[_T4],
            __ent5: _TCCA[_T5],
            __ent6: _TCCA[_T6],
            __ent7: _TCCA[_T7],
        ) -> ReturningUpdate[Tuple[_T0, _T1, _T2, _T3, _T4, _T5, _T6, _T7]]:
            ...

        # END OVERLOADED FUNCTIONS self.returning

        @overload
        def returning(
            self, *cols: _ColumnsClauseArgument[Any], **__kw: Any
        ) -> ReturningUpdate[Any]:
            ...

        def returning(
            self, *cols: _ColumnsClauseArgument[Any], **__kw: Any
        ) -> ReturningUpdate[Any]:
            ...


class ReturningUpdate(Update, TypedReturnsRows[_TP]):
    """Typing-only class that establishes a generic type form of
    :class:`.Update` which tracks returned column types.

    This datatype is delivered when calling the
    :meth:`.Update.returning` method.

    .. versionadded:: 2.0

    """


class Delete(DMLWhereBase, UpdateBase):
    """Represent a DELETE construct.

    The :class:`_expression.Delete` object is created using the
    :func:`_expression.delete()` function.

    """

    __visit_name__ = "delete"

    is_delete = True

    _traverse_internals = (
        [
            ("table", InternalTraversal.dp_clauseelement),
            ("_where_criteria", InternalTraversal.dp_clauseelement_tuple),
            ("_returning", InternalTraversal.dp_clauseelement_tuple),
            ("_hints", InternalTraversal.dp_table_hint_list),
        ]
        + HasPrefixes._has_prefixes_traverse_internals
        + DialectKWArgs._dialect_kwargs_traverse_internals
        + Executable._executable_traverse_internals
        + HasCTE._has_ctes_traverse_internals
    )

    def __init__(self, table: _DMLTableArgument):
        self.table = coercions.expect(
            roles.DMLTableRole, table, apply_propagate_attrs=self
        )

    if TYPE_CHECKING:
        # START OVERLOADED FUNCTIONS self.returning ReturningDelete 1-8

        # code within this block is **programmatically,
        # statically generated** by tools/generate_tuple_map_overloads.py

        @overload
        def returning(self, __ent0: _TCCA[_T0]) -> ReturningDelete[Tuple[_T0]]:
            ...

        @overload
        def returning(
            self, __ent0: _TCCA[_T0], __ent1: _TCCA[_T1]
        ) -> ReturningDelete[Tuple[_T0, _T1]]:
            ...

        @overload
        def returning(
            self, __ent0: _TCCA[_T0], __ent1: _TCCA[_T1], __ent2: _TCCA[_T2]
        ) -> ReturningDelete[Tuple[_T0, _T1, _T2]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            __ent2: _TCCA[_T2],
            __ent3: _TCCA[_T3],
        ) -> ReturningDelete[Tuple[_T0, _T1, _T2, _T3]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            __ent2: _TCCA[_T2],
            __ent3: _TCCA[_T3],
            __ent4: _TCCA[_T4],
        ) -> ReturningDelete[Tuple[_T0, _T1, _T2, _T3, _T4]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            __ent2: _TCCA[_T2],
            __ent3: _TCCA[_T3],
            __ent4: _TCCA[_T4],
            __ent5: _TCCA[_T5],
        ) -> ReturningDelete[Tuple[_T0, _T1, _T2, _T3, _T4, _T5]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            __ent2: _TCCA[_T2],
            __ent3: _TCCA[_T3],
            __ent4: _TCCA[_T4],
            __ent5: _TCCA[_T5],
            __ent6: _TCCA[_T6],
        ) -> ReturningDelete[Tuple[_T0, _T1, _T2, _T3, _T4, _T5, _T6]]:
            ...

        @overload
        def returning(
            self,
            __ent0: _TCCA[_T0],
            __ent1: _TCCA[_T1],
            __ent2: _TCCA[_T2],
            __ent3: _TCCA[_T3],
            __ent4: _TCCA[_T4],
            __ent5: _TCCA[_T5],
            __ent6: _TCCA[_T6],
            __ent7: _TCCA[_T7],
        ) -> ReturningDelete[Tuple[_T0, _T1, _T2, _T3, _T4, _T5, _T6, _T7]]:
            ...

        # END OVERLOADED FUNCTIONS self.returning

        @overload
        def returning(
            self, *cols: _ColumnsClauseArgument[Any], **__kw: Any
        ) -> ReturningDelete[Any]:
            ...

        def returning(
            self, *cols: _ColumnsClauseArgument[Any], **__kw: Any
        ) -> ReturningDelete[Any]:
            ...


class ReturningDelete(Update, TypedReturnsRows[_TP]):
    """Typing-only class that establishes a generic type form of
    :class:`.Delete` which tracks returned column types.

    This datatype is delivered when calling the
    :meth:`.Delete.returning` method.

    .. versionadded:: 2.0

    """
