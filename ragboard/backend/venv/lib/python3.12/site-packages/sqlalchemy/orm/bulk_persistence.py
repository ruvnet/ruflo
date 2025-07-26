# orm/bulk_persistence.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors


"""additional ORM persistence classes related to "bulk" operations,
specifically outside of the flush() process.

"""

from __future__ import annotations

from typing import Any
from typing import cast
from typing import Dict
from typing import Iterable
from typing import Optional
from typing import overload
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import attributes
from . import context
from . import evaluator
from . import exc as orm_exc
from . import loading
from . import persistence
from .base import NO_VALUE
from .context import AbstractORMCompileState
from .context import FromStatement
from .context import ORMFromStatementCompileState
from .context import QueryContext
from .. import exc as sa_exc
from .. import util
from ..engine import Dialect
from ..engine import result as _result
from ..sql import coercions
from ..sql import dml
from ..sql import expression
from ..sql import roles
from ..sql import select
from ..sql import sqltypes
from ..sql.base import _entity_namespace_key
from ..sql.base import CompileState
from ..sql.base import Options
from ..sql.dml import DeleteDMLState
from ..sql.dml import InsertDMLState
from ..sql.dml import UpdateDMLState
from ..util import EMPTY_DICT
from ..util.typing import Literal

if TYPE_CHECKING:
    from ._typing import DMLStrategyArgument
    from ._typing import OrmExecuteOptionsParameter
    from ._typing import SynchronizeSessionArgument
    from .mapper import Mapper
    from .session import _BindArguments
    from .session import ORMExecuteState
    from .session import Session
    from .session import SessionTransaction
    from .state import InstanceState
    from ..engine import Connection
    from ..engine import cursor
    from ..engine.interfaces import _CoreAnyExecuteParams

_O = TypeVar("_O", bound=object)


@overload
def _bulk_insert(
    mapper: Mapper[_O],
    mappings: Union[Iterable[InstanceState[_O]], Iterable[Dict[str, Any]]],
    session_transaction: SessionTransaction,
    isstates: bool,
    return_defaults: bool,
    render_nulls: bool,
    use_orm_insert_stmt: Literal[None] = ...,
    execution_options: Optional[OrmExecuteOptionsParameter] = ...,
) -> None:
    ...


@overload
def _bulk_insert(
    mapper: Mapper[_O],
    mappings: Union[Iterable[InstanceState[_O]], Iterable[Dict[str, Any]]],
    session_transaction: SessionTransaction,
    isstates: bool,
    return_defaults: bool,
    render_nulls: bool,
    use_orm_insert_stmt: Optional[dml.Insert] = ...,
    execution_options: Optional[OrmExecuteOptionsParameter] = ...,
) -> cursor.CursorResult[Any]:
    ...


def _bulk_insert(
    mapper: Mapper[_O],
    mappings: Union[Iterable[InstanceState[_O]], Iterable[Dict[str, Any]]],
    session_transaction: SessionTransaction,
    isstates: bool,
    return_defaults: bool,
    render_nulls: bool,
    use_orm_insert_stmt: Optional[dml.Insert] = None,
    execution_options: Optional[OrmExecuteOptionsParameter] = None,
) -> Optional[cursor.CursorResult[Any]]:
    base_mapper = mapper.base_mapper

    if session_transaction.session.connection_callable:
        raise NotImplementedError(
            "connection_callable / per-instance sharding "
            "not supported in bulk_insert()"
        )

    if isstates:
        if return_defaults:
            states = [(state, state.dict) for state in mappings]
            mappings = [dict_ for (state, dict_) in states]
        else:
            mappings = [state.dict for state in mappings]
    else:
        mappings = [dict(m) for m in mappings]
        _expand_composites(mapper, mappings)

    connection = session_transaction.connection(base_mapper)

    return_result: Optional[cursor.CursorResult[Any]] = None

    mappers_to_run = [
        (table, mp)
        for table, mp in base_mapper._sorted_tables.items()
        if table in mapper._pks_by_table
    ]

    if return_defaults:
        # not used by new-style bulk inserts, only used for legacy
        bookkeeping = True
    elif len(mappers_to_run) > 1:
        # if we have more than one table, mapper to run where we will be
        # either horizontally splicing, or copying values between tables,
        # we need the "bookkeeping" / deterministic returning order
        bookkeeping = True
    else:
        bookkeeping = False

    for table, super_mapper in mappers_to_run:
        # find bindparams in the statement. For bulk, we don't really know if
        # a key in the params applies to a different table since we are
        # potentially inserting for multiple tables here; looking at the
        # bindparam() is a lot more direct.   in most cases this will
        # use _generate_cache_key() which is memoized, although in practice
        # the ultimate statement that's executed is probably not the same
        # object so that memoization might not matter much.
        extra_bp_names = (
            [
                b.key
                for b in use_orm_insert_stmt._get_embedded_bindparams()
                if b.key in mappings[0]
            ]
            if use_orm_insert_stmt is not None
            else ()
        )

        records = (
            (
                None,
                state_dict,
                params,
                mapper,
                connection,
                value_params,
                has_all_pks,
                has_all_defaults,
            )
            for (
                state,
                state_dict,
                params,
                mp,
                conn,
                value_params,
                has_all_pks,
                has_all_defaults,
            ) in persistence._collect_insert_commands(
                table,
                ((None, mapping, mapper, connection) for mapping in mappings),
                bulk=True,
                return_defaults=bookkeeping,
                render_nulls=render_nulls,
                include_bulk_keys=extra_bp_names,
            )
        )

        result = persistence._emit_insert_statements(
            base_mapper,
            None,
            super_mapper,
            table,
            records,
            bookkeeping=bookkeeping,
            use_orm_insert_stmt=use_orm_insert_stmt,
            execution_options=execution_options,
        )
        if use_orm_insert_stmt is not None:
            if not use_orm_insert_stmt._returning or return_result is None:
                return_result = result
            elif result.returns_rows:
                assert bookkeeping
                return_result = return_result.splice_horizontally(result)

    if return_defaults and isstates:
        identity_cls = mapper._identity_class
        identity_props = [p.key for p in mapper._identity_key_props]
        for state, dict_ in states:
            state.key = (
                identity_cls,
                tuple([dict_[key] for key in identity_props]),
            )

    if use_orm_insert_stmt is not None:
        assert return_result is not None
        return return_result


@overload
def _bulk_update(
    mapper: Mapper[Any],
    mappings: Union[Iterable[InstanceState[_O]], Iterable[Dict[str, Any]]],
    session_transaction: SessionTransaction,
    isstates: bool,
    update_changed_only: bool,
    use_orm_update_stmt: Literal[None] = ...,
    enable_check_rowcount: bool = True,
) -> None:
    ...


@overload
def _bulk_update(
    mapper: Mapper[Any],
    mappings: Union[Iterable[InstanceState[_O]], Iterable[Dict[str, Any]]],
    session_transaction: SessionTransaction,
    isstates: bool,
    update_changed_only: bool,
    use_orm_update_stmt: Optional[dml.Update] = ...,
    enable_check_rowcount: bool = True,
) -> _result.Result[Any]:
    ...


def _bulk_update(
    mapper: Mapper[Any],
    mappings: Union[Iterable[InstanceState[_O]], Iterable[Dict[str, Any]]],
    session_transaction: SessionTransaction,
    isstates: bool,
    update_changed_only: bool,
    use_orm_update_stmt: Optional[dml.Update] = None,
    enable_check_rowcount: bool = True,
) -> Optional[_result.Result[Any]]:
    base_mapper = mapper.base_mapper

    search_keys = mapper._primary_key_propkeys
    if mapper._version_id_prop:
        search_keys = {mapper._version_id_prop.key}.union(search_keys)

    def _changed_dict(mapper, state):
        return {
            k: v
            for k, v in state.dict.items()
            if k in state.committed_state or k in search_keys
        }

    if isstates:
        if update_changed_only:
            mappings = [_changed_dict(mapper, state) for state in mappings]
        else:
            mappings = [state.dict for state in mappings]
    else:
        mappings = [dict(m) for m in mappings]
        _expand_composites(mapper, mappings)

    if session_transaction.session.connection_callable:
        raise NotImplementedError(
            "connection_callable / per-instance sharding "
            "not supported in bulk_update()"
        )

    connection = session_transaction.connection(base_mapper)

    # find bindparams in the statement. see _bulk_insert for similar
    # notes for the insert case
    extra_bp_names = (
        [
            b.key
            for b in use_orm_update_stmt._get_embedded_bindparams()
            if b.key in mappings[0]
        ]
        if use_orm_update_stmt is not None
        else ()
    )

    for table, super_mapper in base_mapper._sorted_tables.items():
        if not mapper.isa(super_mapper) or table not in mapper._pks_by_table:
            continue

        records = persistence._collect_update_commands(
            None,
            table,
            (
                (
                    None,
                    mapping,
                    mapper,
                    connection,
                    (
                        mapping[mapper._version_id_prop.key]
                        if mapper._version_id_prop
                        else None
                    ),
                )
                for mapping in mappings
            ),
            bulk=True,
            use_orm_update_stmt=use_orm_update_stmt,
            include_bulk_keys=extra_bp_names,
        )
        persistence._emit_update_statements(
            base_mapper,
            None,
            super_mapper,
            table,
            records,
            bookkeeping=False,
            use_orm_update_stmt=use_orm_update_stmt,
            enable_check_rowcount=enable_check_rowcount,
        )

    if use_orm_update_stmt is not None:
        return _result.null_result()


def _expand_composites(mapper, mappings):
    composite_attrs = mapper.composites
    if not composite_attrs:
        return

    composite_keys = set(composite_attrs.keys())
    populators = {
        key: composite_attrs[key]._populate_composite_bulk_save_mappings_fn()
        for key in composite_keys
    }
    for mapping in mappings:
        for key in composite_keys.intersection(mapping):
            populators[key](mapping)


class ORMDMLState(AbstractORMCompileState):
    is_dml_returning = True
    from_statement_ctx: Optional[ORMFromStatementCompileState] = None

    @classmethod
    def _get_orm_crud_kv_pairs(
        cls, mapper, statement, kv_iterator, needs_to_be_cacheable
    ):
        core_get_crud_kv_pairs = UpdateDMLState._get_crud_kv_pairs

        for k, v in kv_iterator:
            k = coercions.expect(roles.DMLColumnRole, k)

            if isinstance(k, str):
                desc = _entity_namespace_key(mapper, k, default=NO_VALUE)
                if desc is NO_VALUE:
                    yield (
                        coercions.expect(roles.DMLColumnRole, k),
                        coercions.expect(
                            roles.ExpressionElementRole,
                            v,
                            type_=sqltypes.NullType(),
                            is_crud=True,
                        )
                        if needs_to_be_cacheable
                        else v,
                    )
                else:
                    yield from core_get_crud_kv_pairs(
                        statement,
                        desc._bulk_update_tuples(v),
                        needs_to_be_cacheable,
                    )
            elif "entity_namespace" in k._annotations:
                k_anno = k._annotations
                attr = _entity_namespace_key(
                    k_anno["entity_namespace"], k_anno["proxy_key"]
                )
                yield from core_get_crud_kv_pairs(
                    statement,
                    attr._bulk_update_tuples(v),
                    needs_to_be_cacheable,
                )
            else:
                yield (
                    k,
                    v
                    if not needs_to_be_cacheable
                    else coercions.expect(
                        roles.ExpressionElementRole,
                        v,
                        type_=sqltypes.NullType(),
                        is_crud=True,
                    ),
                )

    @classmethod
    def _get_multi_crud_kv_pairs(cls, statement, kv_iterator):
        plugin_subject = statement._propagate_attrs["plugin_subject"]

        if not plugin_subject or not plugin_subject.mapper:
            return UpdateDMLState._get_multi_crud_kv_pairs(
                statement, kv_iterator
            )

        return [
            dict(
                cls._get_orm_crud_kv_pairs(
                    plugin_subject.mapper, statement, value_dict.items(), False
                )
            )
            for value_dict in kv_iterator
        ]

    @classmethod
    def _get_crud_kv_pairs(cls, statement, kv_iterator, needs_to_be_cacheable):
        assert (
            needs_to_be_cacheable
        ), "no test coverage for needs_to_be_cacheable=False"

        plugin_subject = statement._propagate_attrs["plugin_subject"]

        if not plugin_subject or not plugin_subject.mapper:
            return UpdateDMLState._get_crud_kv_pairs(
                statement, kv_iterator, needs_to_be_cacheable
            )

        return list(
            cls._get_orm_crud_kv_pairs(
                plugin_subject.mapper,
                statement,
                kv_iterator,
                needs_to_be_cacheable,
            )
        )

    @classmethod
    def get_entity_description(cls, statement):
        ext_info = statement.table._annotations["parententity"]
        mapper = ext_info.mapper
        if ext_info.is_aliased_class:
            _label_name = ext_info.name
        else:
            _label_name = mapper.class_.__name__

        return {
            "name": _label_name,
            "type": mapper.class_,
            "expr": ext_info.entity,
            "entity": ext_info.entity,
            "table": mapper.local_table,
        }

    @classmethod
    def get_returning_column_descriptions(cls, statement):
        def _ent_for_col(c):
            return c._annotations.get("parententity", None)

        def _attr_for_col(c, ent):
            if ent is None:
                return c
            proxy_key = c._annotations.get("proxy_key", None)
            if not proxy_key:
                return c
            else:
                return getattr(ent.entity, proxy_key, c)

        return [
            {
                "name": c.key,
                "type": c.type,
                "expr": _attr_for_col(c, ent),
                "aliased": ent.is_aliased_class,
                "entity": ent.entity,
            }
            for c, ent in [
                (c, _ent_for_col(c)) for c in statement._all_selected_columns
            ]
        ]

    def _setup_orm_returning(
        self,
        compiler,
        orm_level_statement,
        dml_level_statement,
        dml_mapper,
        *,
        use_supplemental_cols=True,
    ):
        """establish ORM column handlers for an INSERT, UPDATE, or DELETE
        which uses explicit returning().

        called within compilation level create_for_statement.

        The _return_orm_returning() method then receives the Result
        after the statement was executed, and applies ORM loading to the
        state that we first established here.

        """

        if orm_level_statement._returning:
            fs = FromStatement(
                orm_level_statement._returning,
                dml_level_statement,
                _adapt_on_names=False,
            )
            fs = fs.execution_options(**orm_level_statement._execution_options)
            fs = fs.options(*orm_level_statement._with_options)
            self.select_statement = fs
            self.from_statement_ctx = (
                fsc
            ) = ORMFromStatementCompileState.create_for_statement(fs, compiler)
            fsc.setup_dml_returning_compile_state(dml_mapper)

            dml_level_statement = dml_level_statement._generate()
            dml_level_statement._returning = ()

            cols_to_return = [c for c in fsc.primary_columns if c is not None]

            # since we are splicing result sets together, make sure there
            # are columns of some kind returned in each result set
            if not cols_to_return:
                cols_to_return.extend(dml_mapper.primary_key)

            if use_supplemental_cols:
                dml_level_statement = dml_level_statement.return_defaults(
                    # this is a little weird looking, but by passing
                    # primary key as the main list of cols, this tells
                    # return_defaults to omit server-default cols (and
                    # actually all cols, due to some weird thing we should
                    # clean up in crud.py).
                    # Since we have cols_to_return, just return what we asked
                    # for (plus primary key, which ORM persistence needs since
                    # we likely set bookkeeping=True here, which is another
                    # whole thing...).   We dont want to clutter the
                    # statement up with lots of other cols the user didn't
                    # ask for.  see #9685
                    *dml_mapper.primary_key,
                    supplemental_cols=cols_to_return,
                )
            else:
                dml_level_statement = dml_level_statement.returning(
                    *cols_to_return
                )

        return dml_level_statement

    @classmethod
    def _return_orm_returning(
        cls,
        session,
        statement,
        params,
        execution_options,
        bind_arguments,
        result,
    ):
        execution_context = result.context
        compile_state = execution_context.compiled.compile_state

        if (
            compile_state.from_statement_ctx
            and not compile_state.from_statement_ctx.compile_options._is_star
        ):
            load_options = execution_options.get(
                "_sa_orm_load_options", QueryContext.default_load_options
            )

            querycontext = QueryContext(
                compile_state.from_statement_ctx,
                compile_state.select_statement,
                params,
                session,
                load_options,
                execution_options,
                bind_arguments,
            )
            return loading.instances(result, querycontext)
        else:
            return result


class BulkUDCompileState(ORMDMLState):
    class default_update_options(Options):
        _dml_strategy: DMLStrategyArgument = "auto"
        _synchronize_session: SynchronizeSessionArgument = "auto"
        _can_use_returning: bool = False
        _is_delete_using: bool = False
        _is_update_from: bool = False
        _autoflush: bool = True
        _subject_mapper: Optional[Mapper[Any]] = None
        _resolved_values = EMPTY_DICT
        _eval_condition = None
        _matched_rows = None
        _identity_token = None

    @classmethod
    def can_use_returning(
        cls,
        dialect: Dialect,
        mapper: Mapper[Any],
        *,
        is_multitable: bool = False,
        is_update_from: bool = False,
        is_delete_using: bool = False,
        is_executemany: bool = False,
    ) -> bool:
        raise NotImplementedError()

    @classmethod
    def orm_pre_session_exec(
        cls,
        session,
        statement,
        params,
        execution_options,
        bind_arguments,
        is_pre_event,
    ):
        (
            update_options,
            execution_options,
        ) = BulkUDCompileState.default_update_options.from_execution_options(
            "_sa_orm_update_options",
            {
                "synchronize_session",
                "autoflush",
                "identity_token",
                "is_delete_using",
                "is_update_from",
                "dml_strategy",
            },
            execution_options,
            statement._execution_options,
        )
        bind_arguments["clause"] = statement
        try:
            plugin_subject = statement._propagate_attrs["plugin_subject"]
        except KeyError:
            assert False, "statement had 'orm' plugin but no plugin_subject"
        else:
            if plugin_subject:
                bind_arguments["mapper"] = plugin_subject.mapper
                update_options += {"_subject_mapper": plugin_subject.mapper}

        if "parententity" not in statement.table._annotations:
            update_options += {"_dml_strategy": "core_only"}
        elif not isinstance(params, list):
            if update_options._dml_strategy == "auto":
                update_options += {"_dml_strategy": "orm"}
            elif update_options._dml_strategy == "bulk":
                raise sa_exc.InvalidRequestError(
                    'Can\'t use "bulk" ORM insert strategy without '
                    "passing separate parameters"
                )
        else:
            if update_options._dml_strategy == "auto":
                update_options += {"_dml_strategy": "bulk"}

        sync = update_options._synchronize_session
        if sync is not None:
            if sync not in ("auto", "evaluate", "fetch", False):
                raise sa_exc.ArgumentError(
                    "Valid strategies for session synchronization "
                    "are 'auto', 'evaluate', 'fetch', False"
                )
            if update_options._dml_strategy == "bulk" and sync == "fetch":
                raise sa_exc.InvalidRequestError(
                    "The 'fetch' synchronization strategy is not available "
                    "for 'bulk' ORM updates (i.e. multiple parameter sets)"
                )

        if not is_pre_event:
            if update_options._autoflush:
                session._autoflush()

            if update_options._dml_strategy == "orm":
                if update_options._synchronize_session == "auto":
                    update_options = cls._do_pre_synchronize_auto(
                        session,
                        statement,
                        params,
                        execution_options,
                        bind_arguments,
                        update_options,
                    )
                elif update_options._synchronize_session == "evaluate":
                    update_options = cls._do_pre_synchronize_evaluate(
                        session,
                        statement,
                        params,
                        execution_options,
                        bind_arguments,
                        update_options,
                    )
                elif update_options._synchronize_session == "fetch":
                    update_options = cls._do_pre_synchronize_fetch(
                        session,
                        statement,
                        params,
                        execution_options,
                        bind_arguments,
                        update_options,
                    )
            elif update_options._dml_strategy == "bulk":
                if update_options._synchronize_session == "auto":
                    update_options += {"_synchronize_session": "evaluate"}

            # indicators from the "pre exec" step that are then
            # added to the DML statement, which will also be part of the cache
            # key.  The compile level create_for_statement() method will then
            # consume these at compiler time.
            statement = statement._annotate(
                {
                    "synchronize_session": update_options._synchronize_session,
                    "is_delete_using": update_options._is_delete_using,
                    "is_update_from": update_options._is_update_from,
                    "dml_strategy": update_options._dml_strategy,
                    "can_use_returning": update_options._can_use_returning,
                }
            )

        return (
            statement,
            util.immutabledict(execution_options).union(
                {"_sa_orm_update_options": update_options}
            ),
        )

    @classmethod
    def orm_setup_cursor_result(
        cls,
        session,
        statement,
        params,
        execution_options,
        bind_arguments,
        result,
    ):
        # this stage of the execution is called after the
        # do_orm_execute event hook.  meaning for an extension like
        # horizontal sharding, this step happens *within* the horizontal
        # sharding event handler which calls session.execute() re-entrantly
        # and will occur for each backend individually.
        # the sharding extension then returns its own merged result from the
        # individual ones we return here.

        update_options = execution_options["_sa_orm_update_options"]
        if update_options._dml_strategy == "orm":
            if update_options._synchronize_session == "evaluate":
                cls._do_post_synchronize_evaluate(
                    session, statement, result, update_options
                )
            elif update_options._synchronize_session == "fetch":
                cls._do_post_synchronize_fetch(
                    session, statement, result, update_options
                )
        elif update_options._dml_strategy == "bulk":
            if update_options._synchronize_session == "evaluate":
                cls._do_post_synchronize_bulk_evaluate(
                    session, params, result, update_options
                )
            return result

        return cls._return_orm_returning(
            session,
            statement,
            params,
            execution_options,
            bind_arguments,
            result,
        )

    @classmethod
    def _adjust_for_extra_criteria(cls, global_attributes, ext_info):
        """Apply extra criteria filtering.

        For all distinct single-table-inheritance mappers represented in the
        table being updated or deleted, produce additional WHERE criteria such
        that only the appropriate subtypes are selected from the total results.

        Additionally, add WHERE criteria originating from LoaderCriteriaOptions
        collected from the statement.

        """

        return_crit = ()

        adapter = ext_info._adapter if ext_info.is_aliased_class else None

        if (
            "additional_entity_criteria",
            ext_info.mapper,
        ) in global_attributes:
            return_crit += tuple(
                ae._resolve_where_criteria(ext_info)
                for ae in global_attributes[
                    ("additional_entity_criteria", ext_info.mapper)
                ]
                if ae.include_aliases or ae.entity is ext_info
            )

        if ext_info.mapper._single_table_criterion is not None:
            return_crit += (ext_info.mapper._single_table_criterion,)

        if adapter:
            return_crit = tuple(adapter.traverse(crit) for crit in return_crit)

        return return_crit

    @classmethod
    def _interpret_returning_rows(cls, mapper, rows):
        """translate from local inherited table columns to base mapper
        primary key columns.

        Joined inheritance mappers always establish the primary key in terms of
        the base table.   When we UPDATE a sub-table, we can only get
        RETURNING for the sub-table's columns.

        Here, we create a lookup from the local sub table's primary key
        columns to the base table PK columns so that we can get identity
        key values from RETURNING that's against the joined inheritance
        sub-table.

        the complexity here is to support more than one level deep of
        inheritance, where we have to link columns to each other across
        the inheritance hierarchy.

        """

        if mapper.local_table is not mapper.base_mapper.local_table:
            return rows

        # this starts as a mapping of
        # local_pk_col: local_pk_col.
        # we will then iteratively rewrite the "value" of the dict with
        # each successive superclass column
        local_pk_to_base_pk = {pk: pk for pk in mapper.local_table.primary_key}

        for mp in mapper.iterate_to_root():
            if mp.inherits is None:
                break
            elif mp.local_table is mp.inherits.local_table:
                continue

            t_to_e = dict(mp._table_to_equated[mp.inherits.local_table])
            col_to_col = {sub_pk: super_pk for super_pk, sub_pk in t_to_e[mp]}
            for pk, super_ in local_pk_to_base_pk.items():
                local_pk_to_base_pk[pk] = col_to_col[super_]

        lookup = {
            local_pk_to_base_pk[lpk]: idx
            for idx, lpk in enumerate(mapper.local_table.primary_key)
        }
        primary_key_convert = [
            lookup[bpk] for bpk in mapper.base_mapper.primary_key
        ]
        return [tuple(row[idx] for idx in primary_key_convert) for row in rows]

    @classmethod
    def _get_matched_objects_on_criteria(cls, update_options, states):
        mapper = update_options._subject_mapper
        eval_condition = update_options._eval_condition

        raw_data = [
            (state.obj(), state, state.dict)
            for state in states
            if state.mapper.isa(mapper) and not state.expired
        ]

        identity_token = update_options._identity_token
        if identity_token is not None:
            raw_data = [
                (obj, state, dict_)
                for obj, state, dict_ in raw_data
                if state.identity_token == identity_token
            ]

        result = []
        for obj, state, dict_ in raw_data:
            evaled_condition = eval_condition(obj)

            # caution: don't use "in ()" or == here, _EXPIRE_OBJECT
            # evaluates as True for all comparisons
            if (
                evaled_condition is True
                or evaled_condition is evaluator._EXPIRED_OBJECT
            ):
                result.append(
                    (
                        obj,
                        state,
                        dict_,
                        evaled_condition is evaluator._EXPIRED_OBJECT,
                    )
                )
        return result

    @classmethod
    def _eval_condition_from_statement(cls, update_options, statement):
        mapper = update_options._subject_mapper
        target_cls = mapper.class_

        evaluator_compiler = evaluator._EvaluatorCompiler(target_cls)
        crit = ()
        if statement._where_criteria:
            crit += statement._where_criteria

        global_attributes = {}
        for opt in statement._with_options:
            if opt._is_criteria_option:
                opt.get_global_criteria(global_attributes)

        if global_attributes:
            crit += cls._adjust_for_extra_criteria(global_attributes, mapper)

        if crit:
            eval_condition = evaluator_compiler.process(*crit)
        else:
            # workaround for mypy https://github.com/python/mypy/issues/14027
            def _eval_condition(obj):
                return True

            eval_condition = _eval_condition

        return eval_condition

    @classmethod
    def _do_pre_synchronize_auto(
        cls,
        session,
        statement,
        params,
        execution_options,
        bind_arguments,
        update_options,
    ):
        """setup auto sync strategy


        "auto" checks if we can use "evaluate" first, then falls back
        to "fetch"

        evaluate is vastly more efficient for the common case
        where session is empty, only has a few objects, and the UPDATE
        statement can potentially match thousands/millions of rows.

        OTOH more complex criteria that fails to work with "evaluate"
        we would hope usually correlates with fewer net rows.

        """

        try:
            eval_condition = cls._eval_condition_from_statement(
                update_options, statement
            )

        except evaluator.UnevaluatableError:
            pass
        else:
            return update_options + {
                "_eval_condition": eval_condition,
                "_synchronize_session": "evaluate",
            }

        update_options += {"_synchronize_session": "fetch"}
        return cls._do_pre_synchronize_fetch(
            session,
            statement,
            params,
            execution_options,
            bind_arguments,
            update_options,
        )

    @classmethod
    def _do_pre_synchronize_evaluate(
        cls,
        session,
        statement,
        params,
        execution_options,
        bind_arguments,
        update_options,
    ):
        try:
            eval_condition = cls._eval_condition_from_statement(
                update_options, statement
            )

        except evaluator.UnevaluatableError as err:
            raise sa_exc.InvalidRequestError(
                'Could not evaluate current criteria in Python: "%s". '
                "Specify 'fetch' or False for the "
                "synchronize_session execution option." % err
            ) from err

        return update_options + {
            "_eval_condition": eval_condition,
        }

    @classmethod
    def _get_resolved_values(cls, mapper, statement):
        if statement._multi_values:
            return []
        elif statement._ordered_values:
            return list(statement._ordered_values)
        elif statement._values:
            return list(statement._values.items())
        else:
            return []

    @classmethod
    def _resolved_keys_as_propnames(cls, mapper, resolved_values):
        values = []
        for k, v in resolved_values:
            if mapper and isinstance(k, expression.ColumnElement):
                try:
                    attr = mapper._columntoproperty[k]
                except orm_exc.UnmappedColumnError:
                    pass
                else:
                    values.append((attr.key, v))
            else:
                raise sa_exc.InvalidRequestError(
                    "Attribute name not found, can't be "
                    "synchronized back to objects: %r" % k
                )
        return values

    @classmethod
    def _do_pre_synchronize_fetch(
        cls,
        session,
        statement,
        params,
        execution_options,
        bind_arguments,
        update_options,
    ):
        mapper = update_options._subject_mapper

        select_stmt = (
            select(*(mapper.primary_key + (mapper.select_identity_token,)))
            .select_from(mapper)
            .options(*statement._with_options)
        )
        select_stmt._where_criteria = statement._where_criteria

        # conditionally run the SELECT statement for pre-fetch, testing the
        # "bind" for if we can use RETURNING or not using the do_orm_execute
        # event.  If RETURNING is available, the do_orm_execute event
        # will cancel the SELECT from being actually run.
        #
        # The way this is organized seems strange, why don't we just
        # call can_use_returning() before invoking the statement and get
        # answer?, why does this go through the whole execute phase using an
        # event?  Answer: because we are integrating with extensions such
        # as the horizontal sharding extention that "multiplexes" an individual
        # statement run through multiple engines, and it uses
        # do_orm_execute() to do that.

        can_use_returning = None

        def skip_for_returning(orm_context: ORMExecuteState) -> Any:
            bind = orm_context.session.get_bind(**orm_context.bind_arguments)
            nonlocal can_use_returning

            per_bind_result = cls.can_use_returning(
                bind.dialect,
                mapper,
                is_update_from=update_options._is_update_from,
                is_delete_using=update_options._is_delete_using,
                is_executemany=orm_context.is_executemany,
            )

            if can_use_returning is not None:
                if can_use_returning != per_bind_result:
                    raise sa_exc.InvalidRequestError(
                        "For synchronize_session='fetch', can't mix multiple "
                        "backends where some support RETURNING and others "
                        "don't"
                    )
            elif orm_context.is_executemany and not per_bind_result:
                raise sa_exc.InvalidRequestError(
                    "For synchronize_session='fetch', can't use multiple "
                    "parameter sets in ORM mode, which this backend does not "
                    "support with RETURNING"
                )
            else:
                can_use_returning = per_bind_result

            if per_bind_result:
                return _result.null_result()
            else:
                return None

        result = session.execute(
            select_stmt,
            params,
            execution_options=execution_options,
            bind_arguments=bind_arguments,
            _add_event=skip_for_returning,
        )
        matched_rows = result.fetchall()

        return update_options + {
            "_matched_rows": matched_rows,
            "_can_use_returning": can_use_returning,
        }


@CompileState.plugin_for("orm", "insert")
class BulkORMInsert(ORMDMLState, InsertDMLState):
    class default_insert_options(Options):
        _dml_strategy: DMLStrategyArgument = "auto"
        _render_nulls: bool = False
        _return_defaults: bool = False
        _subject_mapper: Optional[Mapper[Any]] = None
        _autoflush: bool = True
        _populate_existing: bool = False

    select_statement: Optional[FromStatement] = None

    @classmethod
    def orm_pre_session_exec(
        cls,
        session,
        statement,
        params,
        execution_options,
        bind_arguments,
        is_pre_event,
    ):
        (
            insert_options,
            execution_options,
        ) = BulkORMInsert.default_insert_options.from_execution_options(
            "_sa_orm_insert_options",
            {"dml_strategy", "autoflush", "populate_existing", "render_nulls"},
            execution_options,
            statement._execution_options,
        )
        bind_arguments["clause"] = statement
        try:
            plugin_subject = statement._propagate_attrs["plugin_subject"]
        except KeyError:
            assert False, "statement had 'orm' plugin but no plugin_subject"
        else:
            if plugin_subject:
                bind_arguments["mapper"] = plugin_subject.mapper
                insert_options += {"_subject_mapper": plugin_subject.mapper}

        if not params:
            if insert_options._dml_strategy == "auto":
                insert_options += {"_dml_strategy": "orm"}
            elif insert_options._dml_strategy == "bulk":
                raise sa_exc.InvalidRequestError(
                    'Can\'t use "bulk" ORM insert strategy without '
                    "passing separate parameters"
                )
        else:
            if insert_options._dml_strategy == "auto":
                insert_options += {"_dml_strategy": "bulk"}

        if insert_options._dml_strategy != "raw":
            # for ORM object loading, like ORMContext, we have to disable
            # result set adapt_to_context, because we will be generating a
            # new statement with specific columns that's cached inside of
            # an ORMFromStatementCompileState, which we will re-use for
            # each result.
            if not execution_options:
                execution_options = context._orm_load_exec_options
            else:
                execution_options = execution_options.union(
                    context._orm_load_exec_options
                )

        if not is_pre_event and insert_options._autoflush:
            session._autoflush()

        statement = statement._annotate(
            {"dml_strategy": insert_options._dml_strategy}
        )

        return (
            statement,
            util.immutabledict(execution_options).union(
                {"_sa_orm_insert_options": insert_options}
            ),
        )

    @classmethod
    def orm_execute_statement(
        cls,
        session: Session,
        statement: dml.Insert,
        params: _CoreAnyExecuteParams,
        execution_options: OrmExecuteOptionsParameter,
        bind_arguments: _BindArguments,
        conn: Connection,
    ) -> _result.Result:
        insert_options = execution_options.get(
            "_sa_orm_insert_options", cls.default_insert_options
        )

        if insert_options._dml_strategy not in (
            "raw",
            "bulk",
            "orm",
            "auto",
        ):
            raise sa_exc.ArgumentError(
                "Valid strategies for ORM insert strategy "
                "are 'raw', 'orm', 'bulk', 'auto"
            )

        result: _result.Result[Any]

        if insert_options._dml_strategy == "raw":
            result = conn.execute(
                statement, params or {}, execution_options=execution_options
            )
            return result

        if insert_options._dml_strategy == "bulk":
            mapper = insert_options._subject_mapper

            if (
                statement._post_values_clause is not None
                and mapper._multiple_persistence_tables
            ):
                raise sa_exc.InvalidRequestError(
                    "bulk INSERT with a 'post values' clause "
                    "(typically upsert) not supported for multi-table "
                    f"mapper {mapper}"
                )

            assert mapper is not None
            assert session._transaction is not None
            result = _bulk_insert(
                mapper,
                cast(
                    "Iterable[Dict[str, Any]]",
                    [params] if isinstance(params, dict) else params,
                ),
                session._transaction,
                isstates=False,
                return_defaults=insert_options._return_defaults,
                render_nulls=insert_options._render_nulls,
                use_orm_insert_stmt=statement,
                execution_options=execution_options,
            )
        elif insert_options._dml_strategy == "orm":
            result = conn.execute(
                statement, params or {}, execution_options=execution_options
            )
        else:
            raise AssertionError()

        if not bool(statement._returning):
            return result

        if insert_options._populate_existing:
            load_options = execution_options.get(
                "_sa_orm_load_options", QueryContext.default_load_options
            )
            load_options += {"_populate_existing": True}
            execution_options = execution_options.union(
                {"_sa_orm_load_options": load_options}
            )

        return cls._return_orm_returning(
            session,
            statement,
            params,
            execution_options,
            bind_arguments,
            result,
        )

    @classmethod
    def create_for_statement(cls, statement, compiler, **kw) -> BulkORMInsert:
        self = cast(
            BulkORMInsert,
            super().create_for_statement(statement, compiler, **kw),
        )

        if compiler is not None:
            toplevel = not compiler.stack
        else:
            toplevel = True
        if not toplevel:
            return self

        mapper = statement._propagate_attrs["plugin_subject"]
        dml_strategy = statement._annotations.get("dml_strategy", "raw")
        if dml_strategy == "bulk":
            self._setup_for_bulk_insert(compiler)
        elif dml_strategy == "orm":
            self._setup_for_orm_insert(compiler, mapper)

        return self

    @classmethod
    def _resolved_keys_as_col_keys(cls, mapper, resolved_value_dict):
        return {
            col.key if col is not None else k: v
            for col, k, v in (
                (mapper.c.get(k), k, v) for k, v in resolved_value_dict.items()
            )
        }

    def _setup_for_orm_insert(self, compiler, mapper):
        statement = orm_level_statement = cast(dml.Insert, self.statement)

        statement = self._setup_orm_returning(
            compiler,
            orm_level_statement,
            statement,
            dml_mapper=mapper,
            use_supplemental_cols=False,
        )
        self.statement = statement

    def _setup_for_bulk_insert(self, compiler):
        """establish an INSERT statement within the context of
        bulk insert.

        This method will be within the "conn.execute()" call that is invoked
        by persistence._emit_insert_statement().

        """
        statement = orm_level_statement = cast(dml.Insert, self.statement)
        an = statement._annotations

        emit_insert_table, emit_insert_mapper = (
            an["_emit_insert_table"],
            an["_emit_insert_mapper"],
        )

        statement = statement._clone()

        statement.table = emit_insert_table
        if self._dict_parameters:
            self._dict_parameters = {
                col: val
                for col, val in self._dict_parameters.items()
                if col.table is emit_insert_table
            }

        statement = self._setup_orm_returning(
            compiler,
            orm_level_statement,
            statement,
            dml_mapper=emit_insert_mapper,
            use_supplemental_cols=True,
        )

        if (
            self.from_statement_ctx is not None
            and self.from_statement_ctx.compile_options._is_star
        ):
            raise sa_exc.CompileError(
                "Can't use RETURNING * with bulk ORM INSERT.  "
                "Please use a different INSERT form, such as INSERT..VALUES "
                "or INSERT with a Core Connection"
            )

        self.statement = statement


@CompileState.plugin_for("orm", "update")
class BulkORMUpdate(BulkUDCompileState, UpdateDMLState):
    @classmethod
    def create_for_statement(cls, statement, compiler, **kw):
        self = cls.__new__(cls)

        dml_strategy = statement._annotations.get(
            "dml_strategy", "unspecified"
        )

        toplevel = not compiler.stack

        if toplevel and dml_strategy == "bulk":
            self._setup_for_bulk_update(statement, compiler)
        elif (
            dml_strategy == "core_only"
            or dml_strategy == "unspecified"
            and "parententity" not in statement.table._annotations
        ):
            UpdateDMLState.__init__(self, statement, compiler, **kw)
        elif not toplevel or dml_strategy in ("orm", "unspecified"):
            self._setup_for_orm_update(statement, compiler)

        return self

    def _setup_for_orm_update(self, statement, compiler, **kw):
        orm_level_statement = statement

        toplevel = not compiler.stack

        ext_info = statement.table._annotations["parententity"]

        self.mapper = mapper = ext_info.mapper

        self._resolved_values = self._get_resolved_values(mapper, statement)

        self._init_global_attributes(
            statement,
            compiler,
            toplevel=toplevel,
            process_criteria_for_toplevel=toplevel,
        )

        if statement._values:
            self._resolved_values = dict(self._resolved_values)

        new_stmt = statement._clone()

        # note if the statement has _multi_values, these
        # are passed through to the new statement, which will then raise
        # InvalidRequestError because UPDATE doesn't support multi_values
        # right now.
        if statement._ordered_values:
            new_stmt._ordered_values = self._resolved_values
        elif statement._values:
            new_stmt._values = self._resolved_values

        new_crit = self._adjust_for_extra_criteria(
            self.global_attributes, mapper
        )
        if new_crit:
            new_stmt = new_stmt.where(*new_crit)

        # if we are against a lambda statement we might not be the
        # topmost object that received per-execute annotations

        # do this first as we need to determine if there is
        # UPDATE..FROM

        UpdateDMLState.__init__(self, new_stmt, compiler, **kw)

        use_supplemental_cols = False

        if not toplevel:
            synchronize_session = None
        else:
            synchronize_session = compiler._annotations.get(
                "synchronize_session", None
            )
        can_use_returning = compiler._annotations.get(
            "can_use_returning", None
        )
        if can_use_returning is not False:
            # even though pre_exec has determined basic
            # can_use_returning for the dialect, if we are to use
            # RETURNING we need to run can_use_returning() at this level
            # unconditionally because is_delete_using was not known
            # at the pre_exec level
            can_use_returning = (
                synchronize_session == "fetch"
                and self.can_use_returning(
                    compiler.dialect, mapper, is_multitable=self.is_multitable
                )
            )

        if synchronize_session == "fetch" and can_use_returning:
            use_supplemental_cols = True

            # NOTE: we might want to RETURNING the actual columns to be
            # synchronized also.  however this is complicated and difficult
            # to align against the behavior of "evaluate".  Additionally,
            # in a large number (if not the majority) of cases, we have the
            # "evaluate" answer, usually a fixed value, in memory already and
            # there's no need to re-fetch the same value
            # over and over again.   so perhaps if it could be RETURNING just
            # the elements that were based on a SQL expression and not
            # a constant.   For now it doesn't quite seem worth it
            new_stmt = new_stmt.return_defaults(*new_stmt.table.primary_key)

        if toplevel:
            new_stmt = self._setup_orm_returning(
                compiler,
                orm_level_statement,
                new_stmt,
                dml_mapper=mapper,
                use_supplemental_cols=use_supplemental_cols,
            )

        self.statement = new_stmt

    def _setup_for_bulk_update(self, statement, compiler, **kw):
        """establish an UPDATE statement within the context of
        bulk insert.

        This method will be within the "conn.execute()" call that is invoked
        by persistence._emit_update_statement().

        """
        statement = cast(dml.Update, statement)
        an = statement._annotations

        emit_update_table, _ = (
            an["_emit_update_table"],
            an["_emit_update_mapper"],
        )

        statement = statement._clone()
        statement.table = emit_update_table

        UpdateDMLState.__init__(self, statement, compiler, **kw)

        if self._ordered_values:
            raise sa_exc.InvalidRequestError(
                "bulk ORM UPDATE does not support ordered_values() for "
                "custom UPDATE statements with bulk parameter sets.  Use a "
                "non-bulk UPDATE statement or use values()."
            )

        if self._dict_parameters:
            self._dict_parameters = {
                col: val
                for col, val in self._dict_parameters.items()
                if col.table is emit_update_table
            }
        self.statement = statement

    @classmethod
    def orm_execute_statement(
        cls,
        session: Session,
        statement: dml.Update,
        params: _CoreAnyExecuteParams,
        execution_options: OrmExecuteOptionsParameter,
        bind_arguments: _BindArguments,
        conn: Connection,
    ) -> _result.Result:
        update_options = execution_options.get(
            "_sa_orm_update_options", cls.default_update_options
        )

        if update_options._dml_strategy not in (
            "orm",
            "auto",
            "bulk",
            "core_only",
        ):
            raise sa_exc.ArgumentError(
                "Valid strategies for ORM UPDATE strategy "
                "are 'orm', 'auto', 'bulk', 'core_only'"
            )

        result: _result.Result[Any]

        if update_options._dml_strategy == "bulk":
            enable_check_rowcount = not statement._where_criteria

            assert update_options._synchronize_session != "fetch"

            if (
                statement._where_criteria
                and update_options._synchronize_session == "evaluate"
            ):
                raise sa_exc.InvalidRequestError(
                    "bulk synchronize of persistent objects not supported "
                    "when using bulk update with additional WHERE "
                    "criteria right now.  add synchronize_session=None "
                    "execution option to bypass synchronize of persistent "
                    "objects."
                )
            mapper = update_options._subject_mapper
            assert mapper is not None
            assert session._transaction is not None
            result = _bulk_update(
                mapper,
                cast(
                    "Iterable[Dict[str, Any]]",
                    [params] if isinstance(params, dict) else params,
                ),
                session._transaction,
                isstates=False,
                update_changed_only=False,
                use_orm_update_stmt=statement,
                enable_check_rowcount=enable_check_rowcount,
            )
            return cls.orm_setup_cursor_result(
                session,
                statement,
                params,
                execution_options,
                bind_arguments,
                result,
            )
        else:
            return super().orm_execute_statement(
                session,
                statement,
                params,
                execution_options,
                bind_arguments,
                conn,
            )

    @classmethod
    def can_use_returning(
        cls,
        dialect: Dialect,
        mapper: Mapper[Any],
        *,
        is_multitable: bool = False,
        is_update_from: bool = False,
        is_delete_using: bool = False,
        is_executemany: bool = False,
    ) -> bool:
        # normal answer for "should we use RETURNING" at all.
        normal_answer = (
            dialect.update_returning and mapper.local_table.implicit_returning
        )
        if not normal_answer:
            return False

        if is_executemany:
            return dialect.update_executemany_returning

        # these workarounds are currently hypothetical for UPDATE,
        # unlike DELETE where they impact MariaDB
        if is_update_from:
            return dialect.update_returning_multifrom

        elif is_multitable and not dialect.update_returning_multifrom:
            raise sa_exc.CompileError(
                f'Dialect "{dialect.name}" does not support RETURNING '
                "with UPDATE..FROM; for synchronize_session='fetch', "
                "please add the additional execution option "
                "'is_update_from=True' to the statement to indicate that "
                "a separate SELECT should be used for this backend."
            )

        return True

    @classmethod
    def _do_post_synchronize_bulk_evaluate(
        cls, session, params, result, update_options
    ):
        if not params:
            return

        mapper = update_options._subject_mapper
        pk_keys = [prop.key for prop in mapper._identity_key_props]

        identity_map = session.identity_map

        for param in params:
            identity_key = mapper.identity_key_from_primary_key(
                (param[key] for key in pk_keys),
                update_options._identity_token,
            )
            state = identity_map.fast_get_state(identity_key)
            if not state:
                continue

            evaluated_keys = set(param).difference(pk_keys)

            dict_ = state.dict
            # only evaluate unmodified attributes
            to_evaluate = state.unmodified.intersection(evaluated_keys)
            for key in to_evaluate:
                if key in dict_:
                    dict_[key] = param[key]

            state.manager.dispatch.refresh(state, None, to_evaluate)

            state._commit(dict_, list(to_evaluate))

            # attributes that were formerly modified instead get expired.
            # this only gets hit if the session had pending changes
            # and autoflush were set to False.
            to_expire = evaluated_keys.intersection(dict_).difference(
                to_evaluate
            )
            if to_expire:
                state._expire_attributes(dict_, to_expire)

    @classmethod
    def _do_post_synchronize_evaluate(
        cls, session, statement, result, update_options
    ):
        matched_objects = cls._get_matched_objects_on_criteria(
            update_options,
            session.identity_map.all_states(),
        )

        cls._apply_update_set_values_to_objects(
            session,
            update_options,
            statement,
            [(obj, state, dict_) for obj, state, dict_, _ in matched_objects],
        )

    @classmethod
    def _do_post_synchronize_fetch(
        cls, session, statement, result, update_options
    ):
        target_mapper = update_options._subject_mapper

        returned_defaults_rows = result.returned_defaults_rows
        if returned_defaults_rows:
            pk_rows = cls._interpret_returning_rows(
                target_mapper, returned_defaults_rows
            )

            matched_rows = [
                tuple(row) + (update_options._identity_token,)
                for row in pk_rows
            ]
        else:
            matched_rows = update_options._matched_rows

        objs = [
            session.identity_map[identity_key]
            for identity_key in [
                target_mapper.identity_key_from_primary_key(
                    list(primary_key),
                    identity_token=identity_token,
                )
                for primary_key, identity_token in [
                    (row[0:-1], row[-1]) for row in matched_rows
                ]
                if update_options._identity_token is None
                or identity_token == update_options._identity_token
            ]
            if identity_key in session.identity_map
        ]

        if not objs:
            return

        cls._apply_update_set_values_to_objects(
            session,
            update_options,
            statement,
            [
                (
                    obj,
                    attributes.instance_state(obj),
                    attributes.instance_dict(obj),
                )
                for obj in objs
            ],
        )

    @classmethod
    def _apply_update_set_values_to_objects(
        cls, session, update_options, statement, matched_objects
    ):
        """apply values to objects derived from an update statement, e.g.
        UPDATE..SET <values>

        """
        mapper = update_options._subject_mapper
        target_cls = mapper.class_
        evaluator_compiler = evaluator._EvaluatorCompiler(target_cls)
        resolved_values = cls._get_resolved_values(mapper, statement)
        resolved_keys_as_propnames = cls._resolved_keys_as_propnames(
            mapper, resolved_values
        )
        value_evaluators = {}
        for key, value in resolved_keys_as_propnames:
            try:
                _evaluator = evaluator_compiler.process(
                    coercions.expect(roles.ExpressionElementRole, value)
                )
            except evaluator.UnevaluatableError:
                pass
            else:
                value_evaluators[key] = _evaluator

        evaluated_keys = list(value_evaluators.keys())
        attrib = {k for k, v in resolved_keys_as_propnames}

        states = set()
        for obj, state, dict_ in matched_objects:
            to_evaluate = state.unmodified.intersection(evaluated_keys)

            for key in to_evaluate:
                if key in dict_:
                    # only run eval for attributes that are present.
                    dict_[key] = value_evaluators[key](obj)

            state.manager.dispatch.refresh(state, None, to_evaluate)

            state._commit(dict_, list(to_evaluate))

            # attributes that were formerly modified instead get expired.
            # this only gets hit if the session had pending changes
            # and autoflush were set to False.
            to_expire = attrib.intersection(dict_).difference(to_evaluate)
            if to_expire:
                state._expire_attributes(dict_, to_expire)

            states.add(state)
        session._register_altered(states)


@CompileState.plugin_for("orm", "delete")
class BulkORMDelete(BulkUDCompileState, DeleteDMLState):
    @classmethod
    def create_for_statement(cls, statement, compiler, **kw):
        self = cls.__new__(cls)

        dml_strategy = statement._annotations.get(
            "dml_strategy", "unspecified"
        )

        if (
            dml_strategy == "core_only"
            or dml_strategy == "unspecified"
            and "parententity" not in statement.table._annotations
        ):
            DeleteDMLState.__init__(self, statement, compiler, **kw)
            return self

        toplevel = not compiler.stack

        orm_level_statement = statement

        ext_info = statement.table._annotations["parententity"]
        self.mapper = mapper = ext_info.mapper

        self._init_global_attributes(
            statement,
            compiler,
            toplevel=toplevel,
            process_criteria_for_toplevel=toplevel,
        )

        new_stmt = statement._clone()

        new_crit = cls._adjust_for_extra_criteria(
            self.global_attributes, mapper
        )
        if new_crit:
            new_stmt = new_stmt.where(*new_crit)

        # do this first as we need to determine if there is
        # DELETE..FROM
        DeleteDMLState.__init__(self, new_stmt, compiler, **kw)

        use_supplemental_cols = False

        if not toplevel:
            synchronize_session = None
        else:
            synchronize_session = compiler._annotations.get(
                "synchronize_session", None
            )
        can_use_returning = compiler._annotations.get(
            "can_use_returning", None
        )
        if can_use_returning is not False:
            # even though pre_exec has determined basic
            # can_use_returning for the dialect, if we are to use
            # RETURNING we need to run can_use_returning() at this level
            # unconditionally because is_delete_using was not known
            # at the pre_exec level
            can_use_returning = (
                synchronize_session == "fetch"
                and self.can_use_returning(
                    compiler.dialect,
                    mapper,
                    is_multitable=self.is_multitable,
                    is_delete_using=compiler._annotations.get(
                        "is_delete_using", False
                    ),
                )
            )

        if can_use_returning:
            use_supplemental_cols = True

            new_stmt = new_stmt.return_defaults(*new_stmt.table.primary_key)

        if toplevel:
            new_stmt = self._setup_orm_returning(
                compiler,
                orm_level_statement,
                new_stmt,
                dml_mapper=mapper,
                use_supplemental_cols=use_supplemental_cols,
            )

        self.statement = new_stmt

        return self

    @classmethod
    def orm_execute_statement(
        cls,
        session: Session,
        statement: dml.Delete,
        params: _CoreAnyExecuteParams,
        execution_options: OrmExecuteOptionsParameter,
        bind_arguments: _BindArguments,
        conn: Connection,
    ) -> _result.Result:
        update_options = execution_options.get(
            "_sa_orm_update_options", cls.default_update_options
        )

        if update_options._dml_strategy == "bulk":
            raise sa_exc.InvalidRequestError(
                "Bulk ORM DELETE not supported right now. "
                "Statement may be invoked at the "
                "Core level using "
                "session.connection().execute(stmt, parameters)"
            )

        if update_options._dml_strategy not in ("orm", "auto", "core_only"):
            raise sa_exc.ArgumentError(
                "Valid strategies for ORM DELETE strategy are 'orm', 'auto', "
                "'core_only'"
            )

        return super().orm_execute_statement(
            session, statement, params, execution_options, bind_arguments, conn
        )

    @classmethod
    def can_use_returning(
        cls,
        dialect: Dialect,
        mapper: Mapper[Any],
        *,
        is_multitable: bool = False,
        is_update_from: bool = False,
        is_delete_using: bool = False,
        is_executemany: bool = False,
    ) -> bool:
        # normal answer for "should we use RETURNING" at all.
        normal_answer = (
            dialect.delete_returning and mapper.local_table.implicit_returning
        )
        if not normal_answer:
            return False

        # now get into special workarounds because MariaDB supports
        # DELETE...RETURNING but not DELETE...USING...RETURNING.
        if is_delete_using:
            # is_delete_using hint was passed.   use
            # additional dialect feature (True for PG, False for MariaDB)
            return dialect.delete_returning_multifrom

        elif is_multitable and not dialect.delete_returning_multifrom:
            # is_delete_using hint was not passed, but we determined
            # at compile time that this is in fact a DELETE..USING.
            # it's too late to continue since we did not pre-SELECT.
            # raise that we need that hint up front.

            raise sa_exc.CompileError(
                f'Dialect "{dialect.name}" does not support RETURNING '
                "with DELETE..USING; for synchronize_session='fetch', "
                "please add the additional execution option "
                "'is_delete_using=True' to the statement to indicate that "
                "a separate SELECT should be used for this backend."
            )

        return True

    @classmethod
    def _do_post_synchronize_evaluate(
        cls, session, statement, result, update_options
    ):
        matched_objects = cls._get_matched_objects_on_criteria(
            update_options,
            session.identity_map.all_states(),
        )

        to_delete = []

        for _, state, dict_, is_partially_expired in matched_objects:
            if is_partially_expired:
                state._expire(dict_, session.identity_map._modified)
            else:
                to_delete.append(state)

        if to_delete:
            session._remove_newly_deleted(to_delete)

    @classmethod
    def _do_post_synchronize_fetch(
        cls, session, statement, result, update_options
    ):
        target_mapper = update_options._subject_mapper

        returned_defaults_rows = result.returned_defaults_rows

        if returned_defaults_rows:
            pk_rows = cls._interpret_returning_rows(
                target_mapper, returned_defaults_rows
            )

            matched_rows = [
                tuple(row) + (update_options._identity_token,)
                for row in pk_rows
            ]
        else:
            matched_rows = update_options._matched_rows

        for row in matched_rows:
            primary_key = row[0:-1]
            identity_token = row[-1]

            # TODO: inline this and call remove_newly_deleted
            # once
            identity_key = target_mapper.identity_key_from_primary_key(
                list(primary_key),
                identity_token=identity_token,
            )
            if identity_key in session.identity_map:
                session._remove_newly_deleted(
                    [
                        attributes.instance_state(
                            session.identity_map[identity_key]
                        )
                    ]
                )
