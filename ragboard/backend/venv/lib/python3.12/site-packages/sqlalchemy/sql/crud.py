# sql/crud.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

"""Functions used by compiler.py to determine the parameters rendered
within INSERT and UPDATE statements.

"""
from __future__ import annotations

import functools
import operator
from typing import Any
from typing import Callable
from typing import cast
from typing import Dict
from typing import Iterable
from typing import List
from typing import MutableMapping
from typing import NamedTuple
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import TYPE_CHECKING
from typing import Union

from . import coercions
from . import dml
from . import elements
from . import roles
from .base import _DefaultDescriptionTuple
from .dml import isinsert as _compile_state_isinsert
from .elements import ColumnClause
from .schema import default_is_clause_element
from .schema import default_is_sequence
from .selectable import Select
from .selectable import TableClause
from .. import exc
from .. import util
from ..util.typing import Literal

if TYPE_CHECKING:
    from .compiler import _BindNameForColProtocol
    from .compiler import SQLCompiler
    from .dml import _DMLColumnElement
    from .dml import DMLState
    from .dml import ValuesBase
    from .elements import ColumnElement
    from .elements import KeyedColumnElement
    from .schema import _SQLExprDefault
    from .schema import Column

REQUIRED = util.symbol(
    "REQUIRED",
    """
Placeholder for the value within a :class:`.BindParameter`
which is required to be present when the statement is passed
to :meth:`_engine.Connection.execute`.

This symbol is typically used when a :func:`_expression.insert`
or :func:`_expression.update` statement is compiled without parameter
values present.

""",
)


def _as_dml_column(c: ColumnElement[Any]) -> ColumnClause[Any]:
    if not isinstance(c, ColumnClause):
        raise exc.CompileError(
            f"Can't create DML statement against column expression {c!r}"
        )
    return c


_CrudParamElement = Tuple[
    "ColumnElement[Any]",
    str,  # column name
    Optional[
        Union[str, "_SQLExprDefault"]
    ],  # bound parameter string or SQL expression to apply
    Iterable[str],
]
_CrudParamElementStr = Tuple[
    "KeyedColumnElement[Any]",
    str,  # column name
    str,  # bound parameter string
    Iterable[str],
]
_CrudParamElementSQLExpr = Tuple[
    "ColumnClause[Any]",
    str,
    "_SQLExprDefault",  # SQL expression to apply
    Iterable[str],
]

_CrudParamSequence = List[_CrudParamElement]


class _CrudParams(NamedTuple):
    single_params: _CrudParamSequence
    all_multi_params: List[Sequence[_CrudParamElementStr]]
    is_default_metavalue_only: bool = False
    use_insertmanyvalues: bool = False
    use_sentinel_columns: Optional[Sequence[Column[Any]]] = None


def _get_crud_params(
    compiler: SQLCompiler,
    stmt: ValuesBase,
    compile_state: DMLState,
    toplevel: bool,
    **kw: Any,
) -> _CrudParams:
    """create a set of tuples representing column/string pairs for use
    in an INSERT or UPDATE statement.

    Also generates the Compiled object's postfetch, prefetch, and
    returning column collections, used for default handling and ultimately
    populating the CursorResult's prefetch_cols() and postfetch_cols()
    collections.

    """

    # note: the _get_crud_params() system was written with the notion in mind
    # that INSERT, UPDATE, DELETE are always the top level statement and
    # that there is only one of them.  With the addition of CTEs that can
    # make use of DML, this assumption is no longer accurate; the DML
    # statement is not necessarily the top-level "row returning" thing
    # and it is also theoretically possible (fortunately nobody has asked yet)
    # to have a single statement with multiple DMLs inside of it via CTEs.

    # the current _get_crud_params() design doesn't accommodate these cases
    # right now.  It "just works" for a CTE that has a single DML inside of
    # it, and for a CTE with multiple DML, it's not clear what would happen.

    # overall, the "compiler.XYZ" collections here would need to be in a
    # per-DML structure of some kind, and DefaultDialect would need to
    # navigate these collections on a per-statement basis, with additional
    # emphasis on the "toplevel returning data" statement.  However we
    # still need to run through _get_crud_params() for all DML as we have
    # Python / SQL generated column defaults that need to be rendered.

    # if there is user need for this kind of thing, it's likely a post 2.0
    # kind of change as it would require deep changes to DefaultDialect
    # as well as here.

    compiler.postfetch = []
    compiler.insert_prefetch = []
    compiler.update_prefetch = []
    compiler.implicit_returning = []

    visiting_cte = kw.get("visiting_cte", None)
    if visiting_cte is not None:
        # for insert -> CTE -> insert, don't populate an incoming
        # _crud_accumulate_bind_names collection; the INSERT we process here
        # will not be inline within the VALUES of the enclosing INSERT as the
        # CTE is placed on the outside.  See issue #9173
        kw.pop("accumulate_bind_names", None)
    assert (
        "accumulate_bind_names" not in kw
    ), "Don't know how to handle insert within insert without a CTE"

    # getters - these are normally just column.key,
    # but in the case of mysql multi-table update, the rules for
    # .key must conditionally take tablename into account
    (
        _column_as_key,
        _getattr_col_key,
        _col_bind_name,
    ) = _key_getters_for_crud_column(compiler, stmt, compile_state)

    compiler._get_bind_name_for_col = _col_bind_name

    if stmt._returning and stmt._return_defaults:
        raise exc.CompileError(
            "Can't compile statement that includes returning() and "
            "return_defaults() simultaneously"
        )

    if compile_state.isdelete:
        _setup_delete_return_defaults(
            compiler,
            stmt,
            compile_state,
            (),
            _getattr_col_key,
            _column_as_key,
            _col_bind_name,
            (),
            (),
            toplevel,
            kw,
        )
        return _CrudParams([], [])

    # no parameters in the statement, no parameters in the
    # compiled params - return binds for all columns
    if compiler.column_keys is None and compile_state._no_parameters:
        return _CrudParams(
            [
                (
                    c,
                    compiler.preparer.format_column(c),
                    _create_bind_param(compiler, c, None, required=True),
                    (c.key,),
                )
                for c in stmt.table.columns
                if not c._omit_from_statements
            ],
            [],
        )

    stmt_parameter_tuples: Optional[
        List[Tuple[Union[str, ColumnClause[Any]], Any]]
    ]
    spd: Optional[MutableMapping[_DMLColumnElement, Any]]

    if (
        _compile_state_isinsert(compile_state)
        and compile_state._has_multi_parameters
    ):
        mp = compile_state._multi_parameters
        assert mp is not None
        spd = mp[0]
        stmt_parameter_tuples = list(spd.items())
        spd_str_key = {_column_as_key(key) for key in spd}
    elif compile_state._ordered_values:
        spd = compile_state._dict_parameters
        stmt_parameter_tuples = compile_state._ordered_values
        assert spd is not None
        spd_str_key = {_column_as_key(key) for key in spd}
    elif compile_state._dict_parameters:
        spd = compile_state._dict_parameters
        stmt_parameter_tuples = list(spd.items())
        spd_str_key = {_column_as_key(key) for key in spd}
    else:
        stmt_parameter_tuples = spd = spd_str_key = None

    # if we have statement parameters - set defaults in the
    # compiled params
    if compiler.column_keys is None:
        parameters = {}
    elif stmt_parameter_tuples:
        assert spd_str_key is not None
        parameters = {
            _column_as_key(key): REQUIRED
            for key in compiler.column_keys
            if key not in spd_str_key
        }
    else:
        parameters = {
            _column_as_key(key): REQUIRED for key in compiler.column_keys
        }

    # create a list of column assignment clauses as tuples
    values: List[_CrudParamElement] = []

    if stmt_parameter_tuples is not None:
        _get_stmt_parameter_tuples_params(
            compiler,
            compile_state,
            parameters,
            stmt_parameter_tuples,
            _column_as_key,
            values,
            kw,
        )

    check_columns: Dict[str, ColumnClause[Any]] = {}

    # special logic that only occurs for multi-table UPDATE
    # statements
    if dml.isupdate(compile_state) and compile_state.is_multitable:
        _get_update_multitable_params(
            compiler,
            stmt,
            compile_state,
            stmt_parameter_tuples,
            check_columns,
            _col_bind_name,
            _getattr_col_key,
            values,
            kw,
        )

    if _compile_state_isinsert(compile_state) and stmt._select_names:
        # is an insert from select, is not a multiparams

        assert not compile_state._has_multi_parameters

        _scan_insert_from_select_cols(
            compiler,
            stmt,
            compile_state,
            parameters,
            _getattr_col_key,
            _column_as_key,
            _col_bind_name,
            check_columns,
            values,
            toplevel,
            kw,
        )
        use_insertmanyvalues = False
        use_sentinel_columns = None
    else:
        use_insertmanyvalues, use_sentinel_columns = _scan_cols(
            compiler,
            stmt,
            compile_state,
            parameters,
            _getattr_col_key,
            _column_as_key,
            _col_bind_name,
            check_columns,
            values,
            toplevel,
            kw,
        )

    if parameters and stmt_parameter_tuples:
        check = (
            set(parameters)
            .intersection(_column_as_key(k) for k, v in stmt_parameter_tuples)
            .difference(check_columns)
        )
        if check:
            raise exc.CompileError(
                "Unconsumed column names: %s"
                % (", ".join("%s" % (c,) for c in check))
            )

    is_default_metavalue_only = False

    if (
        _compile_state_isinsert(compile_state)
        and compile_state._has_multi_parameters
    ):
        # is a multiparams, is not an insert from a select
        assert not stmt._select_names
        multi_extended_values = _extend_values_for_multiparams(
            compiler,
            stmt,
            compile_state,
            cast(
                "Sequence[_CrudParamElementStr]",
                values,
            ),
            cast("Callable[..., str]", _column_as_key),
            kw,
        )
        return _CrudParams(values, multi_extended_values)
    elif (
        not values
        and compiler.for_executemany
        and compiler.dialect.supports_default_metavalue
    ):
        # convert an "INSERT DEFAULT VALUES"
        # into INSERT (firstcol) VALUES (DEFAULT) which can be turned
        # into an in-place multi values.  This supports
        # insert_executemany_returning mode :)
        values = [
            (
                _as_dml_column(stmt.table.columns[0]),
                compiler.preparer.format_column(stmt.table.columns[0]),
                compiler.dialect.default_metavalue_token,
                (),
            )
        ]
        is_default_metavalue_only = True

    return _CrudParams(
        values,
        [],
        is_default_metavalue_only=is_default_metavalue_only,
        use_insertmanyvalues=use_insertmanyvalues,
        use_sentinel_columns=use_sentinel_columns,
    )


@overload
def _create_bind_param(
    compiler: SQLCompiler,
    col: ColumnElement[Any],
    value: Any,
    process: Literal[True] = ...,
    required: bool = False,
    name: Optional[str] = None,
    **kw: Any,
) -> str:
    ...


@overload
def _create_bind_param(
    compiler: SQLCompiler,
    col: ColumnElement[Any],
    value: Any,
    **kw: Any,
) -> str:
    ...


def _create_bind_param(
    compiler: SQLCompiler,
    col: ColumnElement[Any],
    value: Any,
    process: bool = True,
    required: bool = False,
    name: Optional[str] = None,
    **kw: Any,
) -> Union[str, elements.BindParameter[Any]]:
    if name is None:
        name = col.key
    bindparam = elements.BindParameter(
        name, value, type_=col.type, required=required
    )
    bindparam._is_crud = True
    if process:
        return bindparam._compiler_dispatch(compiler, **kw)
    else:
        return bindparam


def _handle_values_anonymous_param(compiler, col, value, name, **kw):
    # the insert() and update() constructs as of 1.4 will now produce anonymous
    # bindparam() objects in the values() collections up front when given plain
    # literal values.  This is so that cache key behaviors, which need to
    # produce bound parameters in deterministic order without invoking any
    # compilation here, can be applied to these constructs when they include
    # values() (but not yet multi-values, which are not included in caching
    # right now).
    #
    # in order to produce the desired "crud" style name for these parameters,
    # which will also be targetable in engine/default.py through the usual
    # conventions, apply our desired name to these unique parameters by
    # populating the compiler truncated names cache with the desired name,
    # rather than having
    # compiler.visit_bindparam()->compiler._truncated_identifier make up a
    # name.  Saves on call counts also.

    # for INSERT/UPDATE that's a CTE, we don't need names to match to
    # external parameters and these would also conflict in the case where
    # multiple insert/update are combined together using CTEs
    is_cte = "visiting_cte" in kw

    if (
        not is_cte
        and value.unique
        and isinstance(value.key, elements._truncated_label)
    ):
        compiler.truncated_names[("bindparam", value.key)] = name

    if value.type._isnull:
        # either unique parameter, or other bound parameters that were
        # passed in directly
        # set type to that of the column unconditionally
        value = value._with_binary_element_type(col.type)

    return value._compiler_dispatch(compiler, **kw)


def _key_getters_for_crud_column(
    compiler: SQLCompiler, stmt: ValuesBase, compile_state: DMLState
) -> Tuple[
    Callable[[Union[str, ColumnClause[Any]]], Union[str, Tuple[str, str]]],
    Callable[[ColumnClause[Any]], Union[str, Tuple[str, str]]],
    _BindNameForColProtocol,
]:
    if dml.isupdate(compile_state) and compile_state._extra_froms:
        # when extra tables are present, refer to the columns
        # in those extra tables as table-qualified, including in
        # dictionaries and when rendering bind param names.
        # the "main" table of the statement remains unqualified,
        # allowing the most compatibility with a non-multi-table
        # statement.
        _et = set(compile_state._extra_froms)

        c_key_role = functools.partial(
            coercions.expect_as_key, roles.DMLColumnRole
        )

        def _column_as_key(
            key: Union[ColumnClause[Any], str]
        ) -> Union[str, Tuple[str, str]]:
            str_key = c_key_role(key)
            if hasattr(key, "table") and key.table in _et:
                return (key.table.name, str_key)  # type: ignore
            else:
                return str_key

        def _getattr_col_key(
            col: ColumnClause[Any],
        ) -> Union[str, Tuple[str, str]]:
            if col.table in _et:
                return (col.table.name, col.key)  # type: ignore
            else:
                return col.key

        def _col_bind_name(col: ColumnClause[Any]) -> str:
            if col.table in _et:
                if TYPE_CHECKING:
                    assert isinstance(col.table, TableClause)
                return "%s_%s" % (col.table.name, col.key)
            else:
                return col.key

    else:
        _column_as_key = functools.partial(
            coercions.expect_as_key, roles.DMLColumnRole
        )
        _getattr_col_key = _col_bind_name = operator.attrgetter("key")  # type: ignore  # noqa: E501

    return _column_as_key, _getattr_col_key, _col_bind_name


def _scan_insert_from_select_cols(
    compiler,
    stmt,
    compile_state,
    parameters,
    _getattr_col_key,
    _column_as_key,
    _col_bind_name,
    check_columns,
    values,
    toplevel,
    kw,
):
    cols = [stmt.table.c[_column_as_key(name)] for name in stmt._select_names]

    assert compiler.stack[-1]["selectable"] is stmt

    compiler.stack[-1]["insert_from_select"] = stmt.select

    add_select_cols: List[_CrudParamElementSQLExpr] = []
    if stmt.include_insert_from_select_defaults:
        col_set = set(cols)
        for col in stmt.table.columns:
            # omit columns that were not in the SELECT statement.
            # this will omit columns marked as omit_from_statements naturally,
            # as long as that col was not explicit in the SELECT.
            # if an omit_from_statements col has a "default" on it, then
            # we need to include it, as these defaults should still fire off.
            # but, if it has that default and it's the "sentinel" default,
            # we don't do sentinel default operations for insert_from_select
            # here so we again omit it.
            if (
                col not in col_set
                and col.default
                and not col.default.is_sentinel
            ):
                cols.append(col)

    for c in cols:
        col_key = _getattr_col_key(c)
        if col_key in parameters and col_key not in check_columns:
            parameters.pop(col_key)
            values.append((c, compiler.preparer.format_column(c), None, ()))
        else:
            _append_param_insert_select_hasdefault(
                compiler, stmt, c, add_select_cols, kw
            )

    if add_select_cols:
        values.extend(add_select_cols)
        ins_from_select = compiler.stack[-1]["insert_from_select"]
        if not isinstance(ins_from_select, Select):
            raise exc.CompileError(
                f"Can't extend statement for INSERT..FROM SELECT to include "
                f"additional default-holding column(s) "
                f"""{
                    ', '.join(repr(key) for _, key, _, _ in add_select_cols)
                }.  Convert the selectable to a subquery() first, or pass """
                "include_defaults=False to Insert.from_select() to skip these "
                "columns."
            )
        ins_from_select = ins_from_select._generate()
        # copy raw_columns
        ins_from_select._raw_columns = list(ins_from_select._raw_columns) + [
            expr for _, _, expr, _ in add_select_cols
        ]
        compiler.stack[-1]["insert_from_select"] = ins_from_select


def _scan_cols(
    compiler,
    stmt,
    compile_state,
    parameters,
    _getattr_col_key,
    _column_as_key,
    _col_bind_name,
    check_columns,
    values,
    toplevel,
    kw,
):
    (
        need_pks,
        implicit_returning,
        implicit_return_defaults,
        postfetch_lastrowid,
        use_insertmanyvalues,
        use_sentinel_columns,
    ) = _get_returning_modifiers(compiler, stmt, compile_state, toplevel)

    assert compile_state.isupdate or compile_state.isinsert

    if compile_state._parameter_ordering:
        parameter_ordering = [
            _column_as_key(key) for key in compile_state._parameter_ordering
        ]
        ordered_keys = set(parameter_ordering)
        cols = [
            stmt.table.c[key]
            for key in parameter_ordering
            if isinstance(key, str) and key in stmt.table.c
        ] + [c for c in stmt.table.c if c.key not in ordered_keys]

    else:
        cols = stmt.table.columns

    isinsert = _compile_state_isinsert(compile_state)
    if isinsert and not compile_state._has_multi_parameters:
        # new rules for #7998.  fetch lastrowid or implicit returning
        # for autoincrement column even if parameter is NULL, for DBs that
        # override NULL param for primary key (sqlite, mysql/mariadb)
        autoincrement_col = stmt.table._autoincrement_column
        insert_null_pk_still_autoincrements = (
            compiler.dialect.insert_null_pk_still_autoincrements
        )
    else:
        autoincrement_col = insert_null_pk_still_autoincrements = None

    if stmt._supplemental_returning:
        supplemental_returning = set(stmt._supplemental_returning)
    else:
        supplemental_returning = set()

    compiler_implicit_returning = compiler.implicit_returning

    # TODO - see TODO(return_defaults_columns) below
    # cols_in_params = set()

    for c in cols:
        # scan through every column in the target table

        col_key = _getattr_col_key(c)

        if col_key in parameters and col_key not in check_columns:
            # parameter is present for the column.  use that.

            _append_param_parameter(
                compiler,
                stmt,
                compile_state,
                c,
                col_key,
                parameters,
                _col_bind_name,
                implicit_returning,
                implicit_return_defaults,
                postfetch_lastrowid,
                values,
                autoincrement_col,
                insert_null_pk_still_autoincrements,
                kw,
            )

            # TODO - see TODO(return_defaults_columns) below
            # cols_in_params.add(c)

        elif isinsert:
            # no parameter is present and it's an insert.

            if c.primary_key and need_pks:
                # it's a primary key column, it will need to be generated by a
                # default generator of some kind, and the statement expects
                # inserted_primary_key to be available.

                if implicit_returning:
                    # we can use RETURNING, find out how to invoke this
                    # column and get the value where RETURNING is an option.
                    # we can inline server-side functions in this case.

                    _append_param_insert_pk_returning(
                        compiler, stmt, c, values, kw
                    )
                else:
                    # otherwise, find out how to invoke this column
                    # and get its value where RETURNING is not an option.
                    # if we have to invoke a server-side function, we need
                    # to pre-execute it.   or if this is a straight
                    # autoincrement column and the dialect supports it
                    # we can use cursor.lastrowid.

                    _append_param_insert_pk_no_returning(
                        compiler, stmt, c, values, kw
                    )

            elif c.default is not None:
                # column has a default, but it's not a pk column, or it is but
                # we don't need to get the pk back.
                if not c.default.is_sentinel or (
                    use_sentinel_columns is not None
                ):
                    _append_param_insert_hasdefault(
                        compiler, stmt, c, implicit_return_defaults, values, kw
                    )

            elif c.server_default is not None:
                # column has a DDL-level default, and is either not a pk
                # column or we don't need the pk.
                if implicit_return_defaults and c in implicit_return_defaults:
                    compiler_implicit_returning.append(c)
                elif not c.primary_key:
                    compiler.postfetch.append(c)

            elif implicit_return_defaults and c in implicit_return_defaults:
                compiler_implicit_returning.append(c)

            elif (
                c.primary_key
                and c is not stmt.table._autoincrement_column
                and not c.nullable
            ):
                _warn_pk_with_no_anticipated_value(c)

        elif compile_state.isupdate:
            # no parameter is present and it's an insert.

            _append_param_update(
                compiler,
                compile_state,
                stmt,
                c,
                implicit_return_defaults,
                values,
                kw,
            )

        # adding supplemental cols to implicit_returning in table
        # order so that order is maintained between multiple INSERT
        # statements which may have different parameters included, but all
        # have the same RETURNING clause
        if (
            c in supplemental_returning
            and c not in compiler_implicit_returning
        ):
            compiler_implicit_returning.append(c)

    if supplemental_returning:
        # we should have gotten every col into implicit_returning,
        # however supplemental returning can also have SQL functions etc.
        # in it
        remaining_supplemental = supplemental_returning.difference(
            compiler_implicit_returning
        )
        compiler_implicit_returning.extend(
            c
            for c in stmt._supplemental_returning
            if c in remaining_supplemental
        )

    # TODO(return_defaults_columns): there can still be more columns in
    # _return_defaults_columns in the case that they are from something like an
    # aliased of the table. we can add them here, however this breaks other ORM
    # things. so this is for another day. see
    # test/orm/dml/test_update_delete_where.py -> test_update_from_alias

    # if stmt._return_defaults_columns:
    #     compiler_implicit_returning.extend(
    #         set(stmt._return_defaults_columns)
    #         .difference(compiler_implicit_returning)
    #         .difference(cols_in_params)
    #     )

    return (use_insertmanyvalues, use_sentinel_columns)


def _setup_delete_return_defaults(
    compiler,
    stmt,
    compile_state,
    parameters,
    _getattr_col_key,
    _column_as_key,
    _col_bind_name,
    check_columns,
    values,
    toplevel,
    kw,
):
    (_, _, implicit_return_defaults, *_) = _get_returning_modifiers(
        compiler, stmt, compile_state, toplevel
    )

    if not implicit_return_defaults:
        return

    if stmt._return_defaults_columns:
        compiler.implicit_returning.extend(implicit_return_defaults)

    if stmt._supplemental_returning:
        ir_set = set(compiler.implicit_returning)
        compiler.implicit_returning.extend(
            c for c in stmt._supplemental_returning if c not in ir_set
        )


def _append_param_parameter(
    compiler,
    stmt,
    compile_state,
    c,
    col_key,
    parameters,
    _col_bind_name,
    implicit_returning,
    implicit_return_defaults,
    postfetch_lastrowid,
    values,
    autoincrement_col,
    insert_null_pk_still_autoincrements,
    kw,
):
    value = parameters.pop(col_key)

    col_value = compiler.preparer.format_column(
        c, use_table=compile_state.include_table_with_column_exprs
    )

    accumulated_bind_names: Set[str] = set()

    if coercions._is_literal(value):
        if (
            insert_null_pk_still_autoincrements
            and c.primary_key
            and c is autoincrement_col
        ):
            # support use case for #7998, fetch autoincrement cols
            # even if value was given.

            if postfetch_lastrowid:
                compiler.postfetch_lastrowid = True
            elif implicit_returning:
                compiler.implicit_returning.append(c)

        value = _create_bind_param(
            compiler,
            c,
            value,
            required=value is REQUIRED,
            name=_col_bind_name(c)
            if not _compile_state_isinsert(compile_state)
            or not compile_state._has_multi_parameters
            else "%s_m0" % _col_bind_name(c),
            accumulate_bind_names=accumulated_bind_names,
            **kw,
        )
    elif value._is_bind_parameter:
        if (
            insert_null_pk_still_autoincrements
            and value.value is None
            and c.primary_key
            and c is autoincrement_col
        ):
            # support use case for #7998, fetch autoincrement cols
            # even if value was given
            if implicit_returning:
                compiler.implicit_returning.append(c)
            elif compiler.dialect.postfetch_lastrowid:
                compiler.postfetch_lastrowid = True

        value = _handle_values_anonymous_param(
            compiler,
            c,
            value,
            name=_col_bind_name(c)
            if not _compile_state_isinsert(compile_state)
            or not compile_state._has_multi_parameters
            else "%s_m0" % _col_bind_name(c),
            accumulate_bind_names=accumulated_bind_names,
            **kw,
        )
    else:
        # value is a SQL expression
        value = compiler.process(
            value.self_group(),
            accumulate_bind_names=accumulated_bind_names,
            **kw,
        )

        if compile_state.isupdate:
            if implicit_return_defaults and c in implicit_return_defaults:
                compiler.implicit_returning.append(c)

            else:
                compiler.postfetch.append(c)
        else:
            if c.primary_key:
                if implicit_returning:
                    compiler.implicit_returning.append(c)
                elif compiler.dialect.postfetch_lastrowid:
                    compiler.postfetch_lastrowid = True

            elif implicit_return_defaults and (c in implicit_return_defaults):
                compiler.implicit_returning.append(c)

            else:
                # postfetch specifically means, "we can SELECT the row we just
                # inserted by primary key to get back the server generated
                # defaults". so by definition this can't be used to get the
                # primary key value back, because we need to have it ahead of
                # time.

                compiler.postfetch.append(c)

    values.append((c, col_value, value, accumulated_bind_names))


def _append_param_insert_pk_returning(compiler, stmt, c, values, kw):
    """Create a primary key expression in the INSERT statement where
    we want to populate result.inserted_primary_key and RETURNING
    is available.

    """
    if c.default is not None:
        if c.default.is_sequence:
            if compiler.dialect.supports_sequences and (
                not c.default.optional
                or not compiler.dialect.sequences_optional
            ):
                accumulated_bind_names: Set[str] = set()
                values.append(
                    (
                        c,
                        compiler.preparer.format_column(c),
                        compiler.process(
                            c.default,
                            accumulate_bind_names=accumulated_bind_names,
                            **kw,
                        ),
                        accumulated_bind_names,
                    )
                )
            compiler.implicit_returning.append(c)
        elif c.default.is_clause_element:
            accumulated_bind_names = set()
            values.append(
                (
                    c,
                    compiler.preparer.format_column(c),
                    compiler.process(
                        c.default.arg.self_group(),
                        accumulate_bind_names=accumulated_bind_names,
                        **kw,
                    ),
                    accumulated_bind_names,
                )
            )
            compiler.implicit_returning.append(c)
        else:
            # client side default.  OK we can't use RETURNING, need to
            # do a "prefetch", which in fact fetches the default value
            # on the Python side
            values.append(
                (
                    c,
                    compiler.preparer.format_column(c),
                    _create_insert_prefetch_bind_param(compiler, c, **kw),
                    (c.key,),
                )
            )
    elif c is stmt.table._autoincrement_column or c.server_default is not None:
        compiler.implicit_returning.append(c)
    elif not c.nullable:
        # no .default, no .server_default, not autoincrement, we have
        # no indication this primary key column will have any value
        _warn_pk_with_no_anticipated_value(c)


def _append_param_insert_pk_no_returning(compiler, stmt, c, values, kw):
    """Create a primary key expression in the INSERT statement where
    we want to populate result.inserted_primary_key and we cannot use
    RETURNING.

    Depending on the kind of default here we may create a bound parameter
    in the INSERT statement and pre-execute a default generation function,
    or we may use cursor.lastrowid if supported by the dialect.


    """

    if (
        # column has a Python-side default
        c.default is not None
        and (
            # and it either is not a sequence, or it is and we support
            # sequences and want to invoke it
            not c.default.is_sequence
            or (
                compiler.dialect.supports_sequences
                and (
                    not c.default.optional
                    or not compiler.dialect.sequences_optional
                )
            )
        )
    ) or (
        # column is the "autoincrement column"
        c is stmt.table._autoincrement_column
        and (
            # dialect can't use cursor.lastrowid
            not compiler.dialect.postfetch_lastrowid
            and (
                # column has a Sequence and we support those
                (
                    c.default is not None
                    and c.default.is_sequence
                    and compiler.dialect.supports_sequences
                )
                or
                # column has no default on it, but dialect can run the
                # "autoincrement" mechanism explicitly, e.g. PostgreSQL
                # SERIAL we know the sequence name
                (
                    c.default is None
                    and compiler.dialect.preexecute_autoincrement_sequences
                )
            )
        )
    ):
        # do a pre-execute of the default
        values.append(
            (
                c,
                compiler.preparer.format_column(c),
                _create_insert_prefetch_bind_param(compiler, c, **kw),
                (c.key,),
            )
        )
    elif (
        c.default is None
        and c.server_default is None
        and not c.nullable
        and c is not stmt.table._autoincrement_column
    ):
        # no .default, no .server_default, not autoincrement, we have
        # no indication this primary key column will have any value
        _warn_pk_with_no_anticipated_value(c)
    elif compiler.dialect.postfetch_lastrowid:
        # finally, where it seems like there will be a generated primary key
        # value and we haven't set up any other way to fetch it, and the
        # dialect supports cursor.lastrowid, switch on the lastrowid flag so
        # that the DefaultExecutionContext calls upon cursor.lastrowid
        compiler.postfetch_lastrowid = True


def _append_param_insert_hasdefault(
    compiler, stmt, c, implicit_return_defaults, values, kw
):
    if c.default.is_sequence:
        if compiler.dialect.supports_sequences and (
            not c.default.optional or not compiler.dialect.sequences_optional
        ):
            accumulated_bind_names: Set[str] = set()
            values.append(
                (
                    c,
                    compiler.preparer.format_column(c),
                    compiler.process(
                        c.default,
                        accumulate_bind_names=accumulated_bind_names,
                        **kw,
                    ),
                    accumulated_bind_names,
                )
            )
            if implicit_return_defaults and c in implicit_return_defaults:
                compiler.implicit_returning.append(c)
            elif not c.primary_key:
                compiler.postfetch.append(c)
    elif c.default.is_clause_element:
        accumulated_bind_names = set()
        values.append(
            (
                c,
                compiler.preparer.format_column(c),
                compiler.process(
                    c.default.arg.self_group(),
                    accumulate_bind_names=accumulated_bind_names,
                    **kw,
                ),
                accumulated_bind_names,
            )
        )

        if implicit_return_defaults and c in implicit_return_defaults:
            compiler.implicit_returning.append(c)
        elif not c.primary_key:
            # don't add primary key column to postfetch
            compiler.postfetch.append(c)
    else:
        values.append(
            (
                c,
                compiler.preparer.format_column(c),
                _create_insert_prefetch_bind_param(compiler, c, **kw),
                (c.key,),
            )
        )


def _append_param_insert_select_hasdefault(
    compiler: SQLCompiler,
    stmt: ValuesBase,
    c: ColumnClause[Any],
    values: List[_CrudParamElementSQLExpr],
    kw: Dict[str, Any],
) -> None:
    if default_is_sequence(c.default):
        if compiler.dialect.supports_sequences and (
            not c.default.optional or not compiler.dialect.sequences_optional
        ):
            values.append(
                (
                    c,
                    compiler.preparer.format_column(c),
                    c.default.next_value(),
                    (),
                )
            )
    elif default_is_clause_element(c.default):
        values.append(
            (
                c,
                compiler.preparer.format_column(c),
                c.default.arg.self_group(),
                (),
            )
        )
    else:
        values.append(
            (
                c,
                compiler.preparer.format_column(c),
                _create_insert_prefetch_bind_param(
                    compiler, c, process=False, **kw
                ),
                (c.key,),
            )
        )


def _append_param_update(
    compiler, compile_state, stmt, c, implicit_return_defaults, values, kw
):
    include_table = compile_state.include_table_with_column_exprs
    if c.onupdate is not None and not c.onupdate.is_sequence:
        if c.onupdate.is_clause_element:
            values.append(
                (
                    c,
                    compiler.preparer.format_column(
                        c,
                        use_table=include_table,
                    ),
                    compiler.process(c.onupdate.arg.self_group(), **kw),
                    (),
                )
            )
            if implicit_return_defaults and c in implicit_return_defaults:
                compiler.implicit_returning.append(c)
            else:
                compiler.postfetch.append(c)
        else:
            values.append(
                (
                    c,
                    compiler.preparer.format_column(
                        c,
                        use_table=include_table,
                    ),
                    _create_update_prefetch_bind_param(compiler, c, **kw),
                    (c.key,),
                )
            )
    elif c.server_onupdate is not None:
        if implicit_return_defaults and c in implicit_return_defaults:
            compiler.implicit_returning.append(c)
        else:
            compiler.postfetch.append(c)
    elif (
        implicit_return_defaults
        and (stmt._return_defaults_columns or not stmt._return_defaults)
        and c in implicit_return_defaults
    ):
        compiler.implicit_returning.append(c)


@overload
def _create_insert_prefetch_bind_param(
    compiler: SQLCompiler,
    c: ColumnElement[Any],
    process: Literal[True] = ...,
    **kw: Any,
) -> str:
    ...


@overload
def _create_insert_prefetch_bind_param(
    compiler: SQLCompiler,
    c: ColumnElement[Any],
    process: Literal[False],
    **kw: Any,
) -> elements.BindParameter[Any]:
    ...


def _create_insert_prefetch_bind_param(
    compiler: SQLCompiler,
    c: ColumnElement[Any],
    process: bool = True,
    name: Optional[str] = None,
    **kw: Any,
) -> Union[elements.BindParameter[Any], str]:
    param = _create_bind_param(
        compiler, c, None, process=process, name=name, **kw
    )
    compiler.insert_prefetch.append(c)  # type: ignore
    return param


@overload
def _create_update_prefetch_bind_param(
    compiler: SQLCompiler,
    c: ColumnElement[Any],
    process: Literal[True] = ...,
    **kw: Any,
) -> str:
    ...


@overload
def _create_update_prefetch_bind_param(
    compiler: SQLCompiler,
    c: ColumnElement[Any],
    process: Literal[False],
    **kw: Any,
) -> elements.BindParameter[Any]:
    ...


def _create_update_prefetch_bind_param(
    compiler: SQLCompiler,
    c: ColumnElement[Any],
    process: bool = True,
    name: Optional[str] = None,
    **kw: Any,
) -> Union[elements.BindParameter[Any], str]:
    param = _create_bind_param(
        compiler, c, None, process=process, name=name, **kw
    )
    compiler.update_prefetch.append(c)  # type: ignore
    return param


class _multiparam_column(elements.ColumnElement[Any]):
    _is_multiparam_column = True

    def __init__(self, original, index):
        self.index = index
        self.key = "%s_m%d" % (original.key, index + 1)
        self.original = original
        self.default = original.default
        self.type = original.type

    def compare(self, other, **kw):
        raise NotImplementedError()

    def _copy_internals(self, other, **kw):
        raise NotImplementedError()

    def __eq__(self, other):
        return (
            isinstance(other, _multiparam_column)
            and other.key == self.key
            and other.original == self.original
        )

    @util.memoized_property
    def _default_description_tuple(self) -> _DefaultDescriptionTuple:
        """used by default.py -> _process_execute_defaults()"""

        return _DefaultDescriptionTuple._from_column_default(self.default)

    @util.memoized_property
    def _onupdate_description_tuple(self) -> _DefaultDescriptionTuple:
        """used by default.py -> _process_execute_defaults()"""

        return _DefaultDescriptionTuple._from_column_default(self.onupdate)


def _process_multiparam_default_bind(
    compiler: SQLCompiler,
    stmt: ValuesBase,
    c: KeyedColumnElement[Any],
    index: int,
    kw: Dict[str, Any],
) -> str:
    if not c.default:
        raise exc.CompileError(
            "INSERT value for column %s is explicitly rendered as a bound"
            "parameter in the VALUES clause; "
            "a Python-side value or SQL expression is required" % c
        )
    elif default_is_clause_element(c.default):
        return compiler.process(c.default.arg.self_group(), **kw)
    elif c.default.is_sequence:
        # these conditions would have been established
        # by append_param_insert_(?:hasdefault|pk_returning|pk_no_returning)
        # in order for us to be here, so these don't need to be
        # checked
        # assert compiler.dialect.supports_sequences and (
        #    not c.default.optional
        #    or not compiler.dialect.sequences_optional
        # )
        return compiler.process(c.default, **kw)
    else:
        col = _multiparam_column(c, index)
        assert isinstance(stmt, dml.Insert)
        return _create_insert_prefetch_bind_param(
            compiler, col, process=True, **kw
        )


def _get_update_multitable_params(
    compiler,
    stmt,
    compile_state,
    stmt_parameter_tuples,
    check_columns,
    _col_bind_name,
    _getattr_col_key,
    values,
    kw,
):
    normalized_params = {
        coercions.expect(roles.DMLColumnRole, c): param
        for c, param in stmt_parameter_tuples or ()
    }

    include_table = compile_state.include_table_with_column_exprs

    affected_tables = set()
    for t in compile_state._extra_froms:
        for c in t.c:
            if c in normalized_params:
                affected_tables.add(t)
                check_columns[_getattr_col_key(c)] = c
                value = normalized_params[c]

                col_value = compiler.process(c, include_table=include_table)
                if coercions._is_literal(value):
                    value = _create_bind_param(
                        compiler,
                        c,
                        value,
                        required=value is REQUIRED,
                        name=_col_bind_name(c),
                        **kw,  # TODO: no test coverage for literal binds here
                    )
                    accumulated_bind_names: Iterable[str] = (c.key,)
                elif value._is_bind_parameter:
                    cbn = _col_bind_name(c)
                    value = _handle_values_anonymous_param(
                        compiler, c, value, name=cbn, **kw
                    )
                    accumulated_bind_names = (cbn,)
                else:
                    compiler.postfetch.append(c)
                    value = compiler.process(value.self_group(), **kw)
                    accumulated_bind_names = ()
                values.append((c, col_value, value, accumulated_bind_names))
    # determine tables which are actually to be updated - process onupdate
    # and server_onupdate for these
    for t in affected_tables:
        for c in t.c:
            if c in normalized_params:
                continue
            elif c.onupdate is not None and not c.onupdate.is_sequence:
                if c.onupdate.is_clause_element:
                    values.append(
                        (
                            c,
                            compiler.process(c, include_table=include_table),
                            compiler.process(
                                c.onupdate.arg.self_group(), **kw
                            ),
                            (),
                        )
                    )
                    compiler.postfetch.append(c)
                else:
                    values.append(
                        (
                            c,
                            compiler.process(c, include_table=include_table),
                            _create_update_prefetch_bind_param(
                                compiler, c, name=_col_bind_name(c), **kw
                            ),
                            (c.key,),
                        )
                    )
            elif c.server_onupdate is not None:
                compiler.postfetch.append(c)


def _extend_values_for_multiparams(
    compiler: SQLCompiler,
    stmt: ValuesBase,
    compile_state: DMLState,
    initial_values: Sequence[_CrudParamElementStr],
    _column_as_key: Callable[..., str],
    kw: Dict[str, Any],
) -> List[Sequence[_CrudParamElementStr]]:
    values_0 = initial_values
    values = [initial_values]

    mp = compile_state._multi_parameters
    assert mp is not None
    for i, row in enumerate(mp[1:]):
        extension: List[_CrudParamElementStr] = []

        row = {_column_as_key(key): v for key, v in row.items()}

        for col, col_expr, param, accumulated_names in values_0:
            if col.key in row:
                key = col.key

                if coercions._is_literal(row[key]):
                    new_param = _create_bind_param(
                        compiler,
                        col,
                        row[key],
                        name="%s_m%d" % (col.key, i + 1),
                        **kw,
                    )
                else:
                    new_param = compiler.process(row[key].self_group(), **kw)
            else:
                new_param = _process_multiparam_default_bind(
                    compiler, stmt, col, i, kw
                )

            extension.append((col, col_expr, new_param, accumulated_names))

        values.append(extension)

    return values


def _get_stmt_parameter_tuples_params(
    compiler,
    compile_state,
    parameters,
    stmt_parameter_tuples,
    _column_as_key,
    values,
    kw,
):
    for k, v in stmt_parameter_tuples:
        colkey = _column_as_key(k)
        if colkey is not None:
            parameters.setdefault(colkey, v)
        else:
            # a non-Column expression on the left side;
            # add it to values() in an "as-is" state,
            # coercing right side to bound param

            # note one of the main use cases for this is array slice
            # updates on PostgreSQL, as the left side is also an expression.

            col_expr = compiler.process(
                k, include_table=compile_state.include_table_with_column_exprs
            )

            if coercions._is_literal(v):
                v = compiler.process(
                    elements.BindParameter(None, v, type_=k.type), **kw
                )
            else:
                if v._is_bind_parameter and v.type._isnull:
                    # either unique parameter, or other bound parameters that
                    # were passed in directly
                    # set type to that of the column unconditionally
                    v = v._with_binary_element_type(k.type)

                v = compiler.process(v.self_group(), **kw)

            # TODO: not sure if accumulated_bind_names applies here
            values.append((k, col_expr, v, ()))


def _get_returning_modifiers(compiler, stmt, compile_state, toplevel):
    """determines RETURNING strategy, if any, for the statement.

    This is where it's determined what we need to fetch from the
    INSERT or UPDATE statement after it's invoked.

    """

    dialect = compiler.dialect

    need_pks = (
        toplevel
        and _compile_state_isinsert(compile_state)
        and not stmt._inline
        and (
            not compiler.for_executemany
            or (dialect.insert_executemany_returning and stmt._return_defaults)
        )
        and not stmt._returning
        # and (not stmt._returning or stmt._return_defaults)
        and not compile_state._has_multi_parameters
    )

    # check if we have access to simple cursor.lastrowid.  we can use that
    # after the INSERT if that's all we need.
    postfetch_lastrowid = (
        need_pks
        and dialect.postfetch_lastrowid
        and stmt.table._autoincrement_column is not None
    )

    # see if we want to add RETURNING to an INSERT in order to get
    # primary key columns back.  This would be instead of postfetch_lastrowid
    # if that's set.
    implicit_returning = (
        # statement itself can veto it
        need_pks
        # the dialect can veto it if it just doesnt support RETURNING
        # with INSERT
        and dialect.insert_returning
        # user-defined implicit_returning on Table can veto it
        and compile_state._primary_table.implicit_returning
        # the compile_state can veto it (SQlite uses this to disable
        # RETURNING for an ON CONFLICT insert, as SQLite does not return
        # for rows that were updated, which is wrong)
        and compile_state._supports_implicit_returning
        and (
            # since we support MariaDB and SQLite which also support lastrowid,
            # decide if we should use lastrowid or RETURNING.  for insert
            # that didnt call return_defaults() and has just one set of
            # parameters, we can use lastrowid.   this is more "traditional"
            # and a lot of weird use cases are supported by it.
            # SQLite lastrowid times 3x faster than returning,
            # Mariadb lastrowid 2x faster than returning
            (not postfetch_lastrowid or dialect.favor_returning_over_lastrowid)
            or compile_state._has_multi_parameters
            or stmt._return_defaults
        )
    )
    if implicit_returning:
        postfetch_lastrowid = False

    if _compile_state_isinsert(compile_state):
        should_implicit_return_defaults = (
            implicit_returning and stmt._return_defaults
        )
        explicit_returning = (
            should_implicit_return_defaults
            or stmt._returning
            or stmt._supplemental_returning
        )
        use_insertmanyvalues = (
            toplevel
            and compiler.for_executemany
            and dialect.use_insertmanyvalues
            and (
                explicit_returning or dialect.use_insertmanyvalues_wo_returning
            )
        )

        use_sentinel_columns = None
        if (
            use_insertmanyvalues
            and explicit_returning
            and stmt._sort_by_parameter_order
        ):
            use_sentinel_columns = compiler._get_sentinel_column_for_table(
                stmt.table
            )

    elif compile_state.isupdate:
        should_implicit_return_defaults = (
            stmt._return_defaults
            and compile_state._primary_table.implicit_returning
            and compile_state._supports_implicit_returning
            and dialect.update_returning
        )
        use_insertmanyvalues = False
        use_sentinel_columns = None
    elif compile_state.isdelete:
        should_implicit_return_defaults = (
            stmt._return_defaults
            and compile_state._primary_table.implicit_returning
            and compile_state._supports_implicit_returning
            and dialect.delete_returning
        )
        use_insertmanyvalues = False
        use_sentinel_columns = None
    else:
        should_implicit_return_defaults = False  # pragma: no cover
        use_insertmanyvalues = False
        use_sentinel_columns = None

    if should_implicit_return_defaults:
        if not stmt._return_defaults_columns:
            # TODO: this is weird.  See #9685 where we have to
            # take an extra step to prevent this from happening.  why
            # would this ever be *all* columns?  but if we set to blank, then
            # that seems to break things also in the ORM.  So we should
            # try to clean this up and figure out what return_defaults
            # needs to do w/ the ORM etc. here
            implicit_return_defaults = set(stmt.table.c)
        else:
            implicit_return_defaults = set(stmt._return_defaults_columns)
    else:
        implicit_return_defaults = None

    return (
        need_pks,
        implicit_returning or should_implicit_return_defaults,
        implicit_return_defaults,
        postfetch_lastrowid,
        use_insertmanyvalues,
        use_sentinel_columns,
    )


def _warn_pk_with_no_anticipated_value(c):
    msg = (
        "Column '%s.%s' is marked as a member of the "
        "primary key for table '%s', "
        "but has no Python-side or server-side default generator indicated, "
        "nor does it indicate 'autoincrement=True' or 'nullable=True', "
        "and no explicit value is passed.  "
        "Primary key columns typically may not store NULL."
        % (c.table.fullname, c.name, c.table.fullname)
    )
    if len(c.table.primary_key) > 1:
        msg += (
            " Note that as of SQLAlchemy 1.1, 'autoincrement=True' must be "
            "indicated explicitly for composite (e.g. multicolumn) primary "
            "keys if AUTO_INCREMENT/SERIAL/IDENTITY "
            "behavior is expected for one of the columns in the primary key. "
            "CREATE TABLE statements are impacted by this change as well on "
            "most backends."
        )
    util.warn(msg)
