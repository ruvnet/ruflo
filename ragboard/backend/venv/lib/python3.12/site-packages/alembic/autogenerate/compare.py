# mypy: allow-untyped-defs, allow-incomplete-defs, allow-untyped-calls
# mypy: no-warn-return-any, allow-any-generics

from __future__ import annotations

import contextlib
import logging
import re
from typing import Any
from typing import cast
from typing import Dict
from typing import Iterator
from typing import Mapping
from typing import Optional
from typing import Set
from typing import Tuple
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from sqlalchemy import event
from sqlalchemy import inspect
from sqlalchemy import schema as sa_schema
from sqlalchemy import text
from sqlalchemy import types as sqltypes
from sqlalchemy.sql import expression
from sqlalchemy.sql.schema import ForeignKeyConstraint
from sqlalchemy.sql.schema import Index
from sqlalchemy.sql.schema import UniqueConstraint
from sqlalchemy.util import OrderedSet

from .. import util
from ..ddl._autogen import is_index_sig
from ..ddl._autogen import is_uq_sig
from ..operations import ops
from ..util import sqla_compat

if TYPE_CHECKING:
    from typing import Literal

    from sqlalchemy.engine.reflection import Inspector
    from sqlalchemy.sql.elements import quoted_name
    from sqlalchemy.sql.elements import TextClause
    from sqlalchemy.sql.schema import Column
    from sqlalchemy.sql.schema import Table

    from alembic.autogenerate.api import AutogenContext
    from alembic.ddl.impl import DefaultImpl
    from alembic.operations.ops import AlterColumnOp
    from alembic.operations.ops import MigrationScript
    from alembic.operations.ops import ModifyTableOps
    from alembic.operations.ops import UpgradeOps
    from ..ddl._autogen import _constraint_sig


log = logging.getLogger(__name__)


def _populate_migration_script(
    autogen_context: AutogenContext, migration_script: MigrationScript
) -> None:
    upgrade_ops = migration_script.upgrade_ops_list[-1]
    downgrade_ops = migration_script.downgrade_ops_list[-1]

    _produce_net_changes(autogen_context, upgrade_ops)
    upgrade_ops.reverse_into(downgrade_ops)


comparators = util.Dispatcher(uselist=True)


def _produce_net_changes(
    autogen_context: AutogenContext, upgrade_ops: UpgradeOps
) -> None:
    connection = autogen_context.connection
    assert connection is not None
    include_schemas = autogen_context.opts.get("include_schemas", False)

    inspector: Inspector = inspect(connection)

    default_schema = connection.dialect.default_schema_name
    schemas: Set[Optional[str]]
    if include_schemas:
        schemas = set(inspector.get_schema_names())
        # replace default schema name with None
        schemas.discard("information_schema")
        # replace the "default" schema with None
        schemas.discard(default_schema)
        schemas.add(None)
    else:
        schemas = {None}

    schemas = {
        s for s in schemas if autogen_context.run_name_filters(s, "schema", {})
    }

    assert autogen_context.dialect is not None
    comparators.dispatch("schema", autogen_context.dialect.name)(
        autogen_context, upgrade_ops, schemas
    )


@comparators.dispatch_for("schema")
def _autogen_for_tables(
    autogen_context: AutogenContext,
    upgrade_ops: UpgradeOps,
    schemas: Union[Set[None], Set[Optional[str]]],
) -> None:
    inspector = autogen_context.inspector

    conn_table_names: Set[Tuple[Optional[str], str]] = set()

    version_table_schema = (
        autogen_context.migration_context.version_table_schema
    )
    version_table = autogen_context.migration_context.version_table

    for schema_name in schemas:
        tables = set(inspector.get_table_names(schema=schema_name))
        if schema_name == version_table_schema:
            tables = tables.difference(
                [autogen_context.migration_context.version_table]
            )

        conn_table_names.update(
            (schema_name, tname)
            for tname in tables
            if autogen_context.run_name_filters(
                tname, "table", {"schema_name": schema_name}
            )
        )

    metadata_table_names = OrderedSet(
        [(table.schema, table.name) for table in autogen_context.sorted_tables]
    ).difference([(version_table_schema, version_table)])

    _compare_tables(
        conn_table_names,
        metadata_table_names,
        inspector,
        upgrade_ops,
        autogen_context,
    )


def _compare_tables(
    conn_table_names: set,
    metadata_table_names: set,
    inspector: Inspector,
    upgrade_ops: UpgradeOps,
    autogen_context: AutogenContext,
) -> None:
    default_schema = inspector.bind.dialect.default_schema_name

    # tables coming from the connection will not have "schema"
    # set if it matches default_schema_name; so we need a list
    # of table names from local metadata that also have "None" if schema
    # == default_schema_name.  Most setups will be like this anyway but
    # some are not (see #170)
    metadata_table_names_no_dflt_schema = OrderedSet(
        [
            (schema if schema != default_schema else None, tname)
            for schema, tname in metadata_table_names
        ]
    )

    # to adjust for the MetaData collection storing the tables either
    # as "schemaname.tablename" or just "tablename", create a new lookup
    # which will match the "non-default-schema" keys to the Table object.
    tname_to_table = {
        no_dflt_schema: autogen_context.table_key_to_table[
            sa_schema._get_table_key(tname, schema)
        ]
        for no_dflt_schema, (schema, tname) in zip(
            metadata_table_names_no_dflt_schema, metadata_table_names
        )
    }
    metadata_table_names = metadata_table_names_no_dflt_schema

    for s, tname in metadata_table_names.difference(conn_table_names):
        name = "%s.%s" % (s, tname) if s else tname
        metadata_table = tname_to_table[(s, tname)]
        if autogen_context.run_object_filters(
            metadata_table, tname, "table", False, None
        ):
            upgrade_ops.ops.append(
                ops.CreateTableOp.from_table(metadata_table)
            )
            log.info("Detected added table %r", name)
            modify_table_ops = ops.ModifyTableOps(tname, [], schema=s)

            comparators.dispatch("table")(
                autogen_context,
                modify_table_ops,
                s,
                tname,
                None,
                metadata_table,
            )
            if not modify_table_ops.is_empty():
                upgrade_ops.ops.append(modify_table_ops)

    removal_metadata = sa_schema.MetaData()
    for s, tname in conn_table_names.difference(metadata_table_names):
        name = sa_schema._get_table_key(tname, s)
        exists = name in removal_metadata.tables
        t = sa_schema.Table(tname, removal_metadata, schema=s)

        if not exists:
            event.listen(
                t,
                "column_reflect",
                # fmt: off
                autogen_context.migration_context.impl.
                _compat_autogen_column_reflect
                (inspector),
                # fmt: on
            )
            sqla_compat._reflect_table(inspector, t)
        if autogen_context.run_object_filters(t, tname, "table", True, None):
            modify_table_ops = ops.ModifyTableOps(tname, [], schema=s)

            comparators.dispatch("table")(
                autogen_context, modify_table_ops, s, tname, t, None
            )
            if not modify_table_ops.is_empty():
                upgrade_ops.ops.append(modify_table_ops)

            upgrade_ops.ops.append(ops.DropTableOp.from_table(t))
            log.info("Detected removed table %r", name)

    existing_tables = conn_table_names.intersection(metadata_table_names)

    existing_metadata = sa_schema.MetaData()
    conn_column_info = {}
    for s, tname in existing_tables:
        name = sa_schema._get_table_key(tname, s)
        exists = name in existing_metadata.tables
        t = sa_schema.Table(tname, existing_metadata, schema=s)
        if not exists:
            event.listen(
                t,
                "column_reflect",
                # fmt: off
                autogen_context.migration_context.impl.
                _compat_autogen_column_reflect(inspector),
                # fmt: on
            )
            sqla_compat._reflect_table(inspector, t)
        conn_column_info[(s, tname)] = t

    for s, tname in sorted(existing_tables, key=lambda x: (x[0] or "", x[1])):
        s = s or None
        name = "%s.%s" % (s, tname) if s else tname
        metadata_table = tname_to_table[(s, tname)]
        conn_table = existing_metadata.tables[name]

        if autogen_context.run_object_filters(
            metadata_table, tname, "table", False, conn_table
        ):
            modify_table_ops = ops.ModifyTableOps(tname, [], schema=s)
            with _compare_columns(
                s,
                tname,
                conn_table,
                metadata_table,
                modify_table_ops,
                autogen_context,
                inspector,
            ):
                comparators.dispatch("table")(
                    autogen_context,
                    modify_table_ops,
                    s,
                    tname,
                    conn_table,
                    metadata_table,
                )

            if not modify_table_ops.is_empty():
                upgrade_ops.ops.append(modify_table_ops)


_IndexColumnSortingOps: Mapping[str, Any] = util.immutabledict(
    {
        "asc": expression.asc,
        "desc": expression.desc,
        "nulls_first": expression.nullsfirst,
        "nulls_last": expression.nullslast,
        "nullsfirst": expression.nullsfirst,  # 1_3 name
        "nullslast": expression.nullslast,  # 1_3 name
    }
)


def _make_index(
    impl: DefaultImpl, params: Dict[str, Any], conn_table: Table
) -> Optional[Index]:
    exprs: list[Union[Column[Any], TextClause]] = []
    sorting = params.get("column_sorting")

    for num, col_name in enumerate(params["column_names"]):
        item: Union[Column[Any], TextClause]
        if col_name is None:
            assert "expressions" in params
            name = params["expressions"][num]
            item = text(name)
        else:
            name = col_name
            item = conn_table.c[col_name]
        if sorting and name in sorting:
            for operator in sorting[name]:
                if operator in _IndexColumnSortingOps:
                    item = _IndexColumnSortingOps[operator](item)
        exprs.append(item)
    ix = sa_schema.Index(
        params["name"],
        *exprs,
        unique=params["unique"],
        _table=conn_table,
        **impl.adjust_reflected_dialect_options(params, "index"),
    )
    if "duplicates_constraint" in params:
        ix.info["duplicates_constraint"] = params["duplicates_constraint"]
    return ix


def _make_unique_constraint(
    impl: DefaultImpl, params: Dict[str, Any], conn_table: Table
) -> UniqueConstraint:
    uq = sa_schema.UniqueConstraint(
        *[conn_table.c[cname] for cname in params["column_names"]],
        name=params["name"],
        **impl.adjust_reflected_dialect_options(params, "unique_constraint"),
    )
    if "duplicates_index" in params:
        uq.info["duplicates_index"] = params["duplicates_index"]

    return uq


def _make_foreign_key(
    params: Dict[str, Any], conn_table: Table
) -> ForeignKeyConstraint:
    tname = params["referred_table"]
    if params["referred_schema"]:
        tname = "%s.%s" % (params["referred_schema"], tname)

    options = params.get("options", {})

    const = sa_schema.ForeignKeyConstraint(
        [conn_table.c[cname] for cname in params["constrained_columns"]],
        ["%s.%s" % (tname, n) for n in params["referred_columns"]],
        onupdate=options.get("onupdate"),
        ondelete=options.get("ondelete"),
        deferrable=options.get("deferrable"),
        initially=options.get("initially"),
        name=params["name"],
    )
    # needed by 0.7
    conn_table.append_constraint(const)
    return const


@contextlib.contextmanager
def _compare_columns(
    schema: Optional[str],
    tname: Union[quoted_name, str],
    conn_table: Table,
    metadata_table: Table,
    modify_table_ops: ModifyTableOps,
    autogen_context: AutogenContext,
    inspector: Inspector,
) -> Iterator[None]:
    name = "%s.%s" % (schema, tname) if schema else tname
    metadata_col_names = OrderedSet(
        c.name for c in metadata_table.c if not c.system
    )
    metadata_cols_by_name = {
        c.name: c for c in metadata_table.c if not c.system
    }

    conn_col_names = {
        c.name: c
        for c in conn_table.c
        if autogen_context.run_name_filters(
            c.name, "column", {"table_name": tname, "schema_name": schema}
        )
    }

    for cname in metadata_col_names.difference(conn_col_names):
        if autogen_context.run_object_filters(
            metadata_cols_by_name[cname], cname, "column", False, None
        ):
            modify_table_ops.ops.append(
                ops.AddColumnOp.from_column_and_tablename(
                    schema, tname, metadata_cols_by_name[cname]
                )
            )
            log.info("Detected added column '%s.%s'", name, cname)

    for colname in metadata_col_names.intersection(conn_col_names):
        metadata_col = metadata_cols_by_name[colname]
        conn_col = conn_table.c[colname]
        if not autogen_context.run_object_filters(
            metadata_col, colname, "column", False, conn_col
        ):
            continue
        alter_column_op = ops.AlterColumnOp(tname, colname, schema=schema)

        comparators.dispatch("column")(
            autogen_context,
            alter_column_op,
            schema,
            tname,
            colname,
            conn_col,
            metadata_col,
        )

        if alter_column_op.has_changes():
            modify_table_ops.ops.append(alter_column_op)

    yield

    for cname in set(conn_col_names).difference(metadata_col_names):
        if autogen_context.run_object_filters(
            conn_table.c[cname], cname, "column", True, None
        ):
            modify_table_ops.ops.append(
                ops.DropColumnOp.from_column_and_tablename(
                    schema, tname, conn_table.c[cname]
                )
            )
            log.info("Detected removed column '%s.%s'", name, cname)


_C = TypeVar("_C", bound=Union[UniqueConstraint, ForeignKeyConstraint, Index])


@comparators.dispatch_for("table")
def _compare_indexes_and_uniques(
    autogen_context: AutogenContext,
    modify_ops: ModifyTableOps,
    schema: Optional[str],
    tname: Union[quoted_name, str],
    conn_table: Optional[Table],
    metadata_table: Optional[Table],
) -> None:
    inspector = autogen_context.inspector
    is_create_table = conn_table is None
    is_drop_table = metadata_table is None
    impl = autogen_context.migration_context.impl

    # 1a. get raw indexes and unique constraints from metadata ...
    if metadata_table is not None:
        metadata_unique_constraints = {
            uq
            for uq in metadata_table.constraints
            if isinstance(uq, sa_schema.UniqueConstraint)
        }
        metadata_indexes = set(metadata_table.indexes)
    else:
        metadata_unique_constraints = set()
        metadata_indexes = set()

    conn_uniques = conn_indexes = frozenset()  # type:ignore[var-annotated]

    supports_unique_constraints = False

    unique_constraints_duplicate_unique_indexes = False

    if conn_table is not None:
        # 1b. ... and from connection, if the table exists
        try:
            conn_uniques = inspector.get_unique_constraints(  # type:ignore[assignment] # noqa
                tname, schema=schema
            )
            supports_unique_constraints = True
        except NotImplementedError:
            pass
        except TypeError:
            # number of arguments is off for the base
            # method in SQLAlchemy due to the cache decorator
            # not being present
            pass
        else:
            conn_uniques = [  # type:ignore[assignment]
                uq
                for uq in conn_uniques
                if autogen_context.run_name_filters(
                    uq["name"],
                    "unique_constraint",
                    {"table_name": tname, "schema_name": schema},
                )
            ]
            for uq in conn_uniques:
                if uq.get("duplicates_index"):
                    unique_constraints_duplicate_unique_indexes = True
        try:
            conn_indexes = inspector.get_indexes(  # type:ignore[assignment]
                tname, schema=schema
            )
        except NotImplementedError:
            pass
        else:
            conn_indexes = [  # type:ignore[assignment]
                ix
                for ix in conn_indexes
                if autogen_context.run_name_filters(
                    ix["name"],
                    "index",
                    {"table_name": tname, "schema_name": schema},
                )
            ]

        # 2. convert conn-level objects from raw inspector records
        # into schema objects
        if is_drop_table:
            # for DROP TABLE uniques are inline, don't need them
            conn_uniques = set()  # type:ignore[assignment]
        else:
            conn_uniques = {  # type:ignore[assignment]
                _make_unique_constraint(impl, uq_def, conn_table)
                for uq_def in conn_uniques
            }

        conn_indexes = {  # type:ignore[assignment]
            index
            for index in (
                _make_index(impl, ix, conn_table) for ix in conn_indexes
            )
            if index is not None
        }

    # 2a. if the dialect dupes unique indexes as unique constraints
    # (mysql and oracle), correct for that

    if unique_constraints_duplicate_unique_indexes:
        _correct_for_uq_duplicates_uix(
            conn_uniques,
            conn_indexes,
            metadata_unique_constraints,
            metadata_indexes,
            autogen_context.dialect,
            impl,
        )

    # 3. give the dialect a chance to omit indexes and constraints that
    # we know are either added implicitly by the DB or that the DB
    # can't accurately report on
    impl.correct_for_autogen_constraints(
        conn_uniques,  # type: ignore[arg-type]
        conn_indexes,  # type: ignore[arg-type]
        metadata_unique_constraints,
        metadata_indexes,
    )

    # 4. organize the constraints into "signature" collections, the
    # _constraint_sig() objects provide a consistent facade over both
    # Index and UniqueConstraint so we can easily work with them
    # interchangeably
    metadata_unique_constraints_sig = {
        impl._create_metadata_constraint_sig(uq)
        for uq in metadata_unique_constraints
    }

    metadata_indexes_sig = {
        impl._create_metadata_constraint_sig(ix) for ix in metadata_indexes
    }

    conn_unique_constraints = {
        impl._create_reflected_constraint_sig(uq) for uq in conn_uniques
    }

    conn_indexes_sig = {
        impl._create_reflected_constraint_sig(ix) for ix in conn_indexes
    }

    # 5. index things by name, for those objects that have names
    metadata_names = {
        cast(str, c.md_name_to_sql_name(autogen_context)): c
        for c in metadata_unique_constraints_sig.union(metadata_indexes_sig)
        if c.is_named
    }

    conn_uniques_by_name: Dict[sqla_compat._ConstraintName, _constraint_sig]
    conn_indexes_by_name: Dict[sqla_compat._ConstraintName, _constraint_sig]

    conn_uniques_by_name = {c.name: c for c in conn_unique_constraints}
    conn_indexes_by_name = {c.name: c for c in conn_indexes_sig}
    conn_names = {
        c.name: c
        for c in conn_unique_constraints.union(conn_indexes_sig)
        if sqla_compat.constraint_name_string(c.name)
    }

    doubled_constraints = {
        name: (conn_uniques_by_name[name], conn_indexes_by_name[name])
        for name in set(conn_uniques_by_name).intersection(
            conn_indexes_by_name
        )
    }

    # 6. index things by "column signature", to help with unnamed unique
    # constraints.
    conn_uniques_by_sig = {uq.unnamed: uq for uq in conn_unique_constraints}
    metadata_uniques_by_sig = {
        uq.unnamed: uq for uq in metadata_unique_constraints_sig
    }
    unnamed_metadata_uniques = {
        uq.unnamed: uq
        for uq in metadata_unique_constraints_sig
        if not sqla_compat._constraint_is_named(
            uq.const, autogen_context.dialect
        )
    }

    # assumptions:
    # 1. a unique constraint or an index from the connection *always*
    #    has a name.
    # 2. an index on the metadata side *always* has a name.
    # 3. a unique constraint on the metadata side *might* have a name.
    # 4. The backend may double up indexes as unique constraints and
    #    vice versa (e.g. MySQL, Postgresql)

    def obj_added(obj: _constraint_sig):
        if is_index_sig(obj):
            if autogen_context.run_object_filters(
                obj.const, obj.name, "index", False, None
            ):
                modify_ops.ops.append(ops.CreateIndexOp.from_index(obj.const))
                log.info(
                    "Detected added index '%r' on '%s'",
                    obj.name,
                    obj.column_names,
                )
        elif is_uq_sig(obj):
            if not supports_unique_constraints:
                # can't report unique indexes as added if we don't
                # detect them
                return
            if is_create_table or is_drop_table:
                # unique constraints are created inline with table defs
                return
            if autogen_context.run_object_filters(
                obj.const, obj.name, "unique_constraint", False, None
            ):
                modify_ops.ops.append(
                    ops.AddConstraintOp.from_constraint(obj.const)
                )
                log.info(
                    "Detected added unique constraint %r on '%s'",
                    obj.name,
                    obj.column_names,
                )
        else:
            assert False

    def obj_removed(obj: _constraint_sig):
        if is_index_sig(obj):
            if obj.is_unique and not supports_unique_constraints:
                # many databases double up unique constraints
                # as unique indexes.  without that list we can't
                # be sure what we're doing here
                return

            if autogen_context.run_object_filters(
                obj.const, obj.name, "index", True, None
            ):
                modify_ops.ops.append(ops.DropIndexOp.from_index(obj.const))
                log.info("Detected removed index %r on %r", obj.name, tname)
        elif is_uq_sig(obj):
            if is_create_table or is_drop_table:
                # if the whole table is being dropped, we don't need to
                # consider unique constraint separately
                return
            if autogen_context.run_object_filters(
                obj.const, obj.name, "unique_constraint", True, None
            ):
                modify_ops.ops.append(
                    ops.DropConstraintOp.from_constraint(obj.const)
                )
                log.info(
                    "Detected removed unique constraint %r on %r",
                    obj.name,
                    tname,
                )
        else:
            assert False

    def obj_changed(
        old: _constraint_sig,
        new: _constraint_sig,
        msg: str,
    ):
        if is_index_sig(old):
            assert is_index_sig(new)

            if autogen_context.run_object_filters(
                new.const, new.name, "index", False, old.const
            ):
                log.info(
                    "Detected changed index %r on %r: %s", old.name, tname, msg
                )
                modify_ops.ops.append(ops.DropIndexOp.from_index(old.const))
                modify_ops.ops.append(ops.CreateIndexOp.from_index(new.const))
        elif is_uq_sig(old):
            assert is_uq_sig(new)

            if autogen_context.run_object_filters(
                new.const, new.name, "unique_constraint", False, old.const
            ):
                log.info(
                    "Detected changed unique constraint %r on %r: %s",
                    old.name,
                    tname,
                    msg,
                )
                modify_ops.ops.append(
                    ops.DropConstraintOp.from_constraint(old.const)
                )
                modify_ops.ops.append(
                    ops.AddConstraintOp.from_constraint(new.const)
                )
        else:
            assert False

    for removed_name in sorted(set(conn_names).difference(metadata_names)):
        conn_obj = conn_names[removed_name]
        if (
            is_uq_sig(conn_obj)
            and conn_obj.unnamed in unnamed_metadata_uniques
        ):
            continue
        elif removed_name in doubled_constraints:
            conn_uq, conn_idx = doubled_constraints[removed_name]
            if (
                all(
                    conn_idx.unnamed != meta_idx.unnamed
                    for meta_idx in metadata_indexes_sig
                )
                and conn_uq.unnamed not in metadata_uniques_by_sig
            ):
                obj_removed(conn_uq)
                obj_removed(conn_idx)
        else:
            obj_removed(conn_obj)

    for existing_name in sorted(set(metadata_names).intersection(conn_names)):
        metadata_obj = metadata_names[existing_name]

        if existing_name in doubled_constraints:
            conn_uq, conn_idx = doubled_constraints[existing_name]
            if is_index_sig(metadata_obj):
                conn_obj = conn_idx
            else:
                conn_obj = conn_uq
        else:
            conn_obj = conn_names[existing_name]

        if type(conn_obj) != type(metadata_obj):
            obj_removed(conn_obj)
            obj_added(metadata_obj)
        else:
            comparison = metadata_obj.compare_to_reflected(conn_obj)

            if comparison.is_different:
                # constraint are different
                obj_changed(conn_obj, metadata_obj, comparison.message)
            elif comparison.is_skip:
                # constraint cannot be compared, skip them
                thing = (
                    "index" if is_index_sig(conn_obj) else "unique constraint"
                )
                log.info(
                    "Cannot compare %s %r, assuming equal and skipping. %s",
                    thing,
                    conn_obj.name,
                    comparison.message,
                )
            else:
                # constraint are equal
                assert comparison.is_equal

    for added_name in sorted(set(metadata_names).difference(conn_names)):
        obj = metadata_names[added_name]
        obj_added(obj)

    for uq_sig in unnamed_metadata_uniques:
        if uq_sig not in conn_uniques_by_sig:
            obj_added(unnamed_metadata_uniques[uq_sig])


def _correct_for_uq_duplicates_uix(
    conn_unique_constraints,
    conn_indexes,
    metadata_unique_constraints,
    metadata_indexes,
    dialect,
    impl,
):
    # dedupe unique indexes vs. constraints, since MySQL / Oracle
    # doesn't really have unique constraints as a separate construct.
    # but look in the metadata and try to maintain constructs
    # that already seem to be defined one way or the other
    # on that side.  This logic was formerly local to MySQL dialect,
    # generalized to Oracle and others. See #276

    # resolve final rendered name for unique constraints defined in the
    # metadata.   this includes truncation of long names.  naming convention
    # names currently should already be set as cons.name, however leave this
    # to the sqla_compat to decide.
    metadata_cons_names = [
        (sqla_compat._get_constraint_final_name(cons, dialect), cons)
        for cons in metadata_unique_constraints
    ]

    metadata_uq_names = {
        name for name, cons in metadata_cons_names if name is not None
    }

    unnamed_metadata_uqs = {
        impl._create_metadata_constraint_sig(cons).unnamed
        for name, cons in metadata_cons_names
        if name is None
    }

    metadata_ix_names = {
        sqla_compat._get_constraint_final_name(cons, dialect)
        for cons in metadata_indexes
        if cons.unique
    }

    # for reflection side, names are in their final database form
    # already since they're from the database
    conn_ix_names = {cons.name: cons for cons in conn_indexes if cons.unique}

    uqs_dupe_indexes = {
        cons.name: cons
        for cons in conn_unique_constraints
        if cons.info["duplicates_index"]
    }

    for overlap in uqs_dupe_indexes:
        if overlap not in metadata_uq_names:
            if (
                impl._create_reflected_constraint_sig(
                    uqs_dupe_indexes[overlap]
                ).unnamed
                not in unnamed_metadata_uqs
            ):
                conn_unique_constraints.discard(uqs_dupe_indexes[overlap])
        elif overlap not in metadata_ix_names:
            conn_indexes.discard(conn_ix_names[overlap])


@comparators.dispatch_for("column")
def _compare_nullable(
    autogen_context: AutogenContext,
    alter_column_op: AlterColumnOp,
    schema: Optional[str],
    tname: Union[quoted_name, str],
    cname: Union[quoted_name, str],
    conn_col: Column[Any],
    metadata_col: Column[Any],
) -> None:
    metadata_col_nullable = metadata_col.nullable
    conn_col_nullable = conn_col.nullable
    alter_column_op.existing_nullable = conn_col_nullable

    if conn_col_nullable is not metadata_col_nullable:
        if (
            sqla_compat._server_default_is_computed(
                metadata_col.server_default, conn_col.server_default
            )
            and sqla_compat._nullability_might_be_unset(metadata_col)
            or (
                sqla_compat._server_default_is_identity(
                    metadata_col.server_default, conn_col.server_default
                )
            )
        ):
            log.info(
                "Ignoring nullable change on identity column '%s.%s'",
                tname,
                cname,
            )
        else:
            alter_column_op.modify_nullable = metadata_col_nullable
            log.info(
                "Detected %s on column '%s.%s'",
                "NULL" if metadata_col_nullable else "NOT NULL",
                tname,
                cname,
            )


@comparators.dispatch_for("column")
def _setup_autoincrement(
    autogen_context: AutogenContext,
    alter_column_op: AlterColumnOp,
    schema: Optional[str],
    tname: Union[quoted_name, str],
    cname: quoted_name,
    conn_col: Column[Any],
    metadata_col: Column[Any],
) -> None:
    if metadata_col.table._autoincrement_column is metadata_col:
        alter_column_op.kw["autoincrement"] = True
    elif metadata_col.autoincrement is True:
        alter_column_op.kw["autoincrement"] = True
    elif metadata_col.autoincrement is False:
        alter_column_op.kw["autoincrement"] = False


@comparators.dispatch_for("column")
def _compare_type(
    autogen_context: AutogenContext,
    alter_column_op: AlterColumnOp,
    schema: Optional[str],
    tname: Union[quoted_name, str],
    cname: Union[quoted_name, str],
    conn_col: Column[Any],
    metadata_col: Column[Any],
) -> None:
    conn_type = conn_col.type
    alter_column_op.existing_type = conn_type
    metadata_type = metadata_col.type
    if conn_type._type_affinity is sqltypes.NullType:
        log.info(
            "Couldn't determine database type " "for column '%s.%s'",
            tname,
            cname,
        )
        return
    if metadata_type._type_affinity is sqltypes.NullType:
        log.info(
            "Column '%s.%s' has no type within " "the model; can't compare",
            tname,
            cname,
        )
        return

    isdiff = autogen_context.migration_context._compare_type(
        conn_col, metadata_col
    )

    if isdiff:
        alter_column_op.modify_type = metadata_type
        log.info(
            "Detected type change from %r to %r on '%s.%s'",
            conn_type,
            metadata_type,
            tname,
            cname,
        )


def _render_server_default_for_compare(
    metadata_default: Optional[Any], autogen_context: AutogenContext
) -> Optional[str]:
    if isinstance(metadata_default, sa_schema.DefaultClause):
        if isinstance(metadata_default.arg, str):
            metadata_default = metadata_default.arg
        else:
            metadata_default = str(
                metadata_default.arg.compile(
                    dialect=autogen_context.dialect,
                    compile_kwargs={"literal_binds": True},
                )
            )
    if isinstance(metadata_default, str):
        return metadata_default
    else:
        return None


def _normalize_computed_default(sqltext: str) -> str:
    """we want to warn if a computed sql expression has changed.  however
    we don't want false positives and the warning is not that critical.
    so filter out most forms of variability from the SQL text.

    """

    return re.sub(r"[ \(\)'\"`\[\]]", "", sqltext).lower()


def _compare_computed_default(
    autogen_context: AutogenContext,
    alter_column_op: AlterColumnOp,
    schema: Optional[str],
    tname: str,
    cname: str,
    conn_col: Column[Any],
    metadata_col: Column[Any],
) -> None:
    rendered_metadata_default = str(
        cast(sa_schema.Computed, metadata_col.server_default).sqltext.compile(
            dialect=autogen_context.dialect,
            compile_kwargs={"literal_binds": True},
        )
    )

    # since we cannot change computed columns, we do only a crude comparison
    # here where we try to eliminate syntactical differences in order to
    # get a minimal comparison just to emit a warning.

    rendered_metadata_default = _normalize_computed_default(
        rendered_metadata_default
    )

    if isinstance(conn_col.server_default, sa_schema.Computed):
        rendered_conn_default = str(
            conn_col.server_default.sqltext.compile(
                dialect=autogen_context.dialect,
                compile_kwargs={"literal_binds": True},
            )
        )
        if rendered_conn_default is None:
            rendered_conn_default = ""
        else:
            rendered_conn_default = _normalize_computed_default(
                rendered_conn_default
            )
    else:
        rendered_conn_default = ""

    if rendered_metadata_default != rendered_conn_default:
        _warn_computed_not_supported(tname, cname)


def _warn_computed_not_supported(tname: str, cname: str) -> None:
    util.warn("Computed default on %s.%s cannot be modified" % (tname, cname))


def _compare_identity_default(
    autogen_context,
    alter_column_op,
    schema,
    tname,
    cname,
    conn_col,
    metadata_col,
):
    impl = autogen_context.migration_context.impl
    diff, ignored_attr, is_alter = impl._compare_identity_default(
        metadata_col.server_default, conn_col.server_default
    )

    return diff, is_alter


@comparators.dispatch_for("column")
def _compare_server_default(
    autogen_context: AutogenContext,
    alter_column_op: AlterColumnOp,
    schema: Optional[str],
    tname: Union[quoted_name, str],
    cname: Union[quoted_name, str],
    conn_col: Column[Any],
    metadata_col: Column[Any],
) -> Optional[bool]:
    metadata_default = metadata_col.server_default
    conn_col_default = conn_col.server_default
    if conn_col_default is None and metadata_default is None:
        return False

    if sqla_compat._server_default_is_computed(metadata_default):
        # return False in case of a computed column as the server
        # default. Note that DDL for adding or removing "GENERATED AS" from
        # an existing column is not currently known for any backend.
        # Once SQLAlchemy can reflect "GENERATED" as the "computed" element,
        # we would also want to ignore and/or warn for changes vs. the
        # metadata (or support backend specific DDL if applicable).
        if not sqla_compat.has_computed_reflection:
            return False

        else:
            return (
                _compare_computed_default(  # type:ignore[func-returns-value]
                    autogen_context,
                    alter_column_op,
                    schema,
                    tname,
                    cname,
                    conn_col,
                    metadata_col,
                )
            )
    if sqla_compat._server_default_is_computed(conn_col_default):
        _warn_computed_not_supported(tname, cname)
        return False

    if sqla_compat._server_default_is_identity(
        metadata_default, conn_col_default
    ):
        alter_column_op.existing_server_default = conn_col_default
        diff, is_alter = _compare_identity_default(
            autogen_context,
            alter_column_op,
            schema,
            tname,
            cname,
            conn_col,
            metadata_col,
        )
        if is_alter:
            alter_column_op.modify_server_default = metadata_default
            if diff:
                log.info(
                    "Detected server default on column '%s.%s': "
                    "identity options attributes %s",
                    tname,
                    cname,
                    sorted(diff),
                )
    else:
        rendered_metadata_default = _render_server_default_for_compare(
            metadata_default, autogen_context
        )

        rendered_conn_default = (
            cast(Any, conn_col_default).arg.text if conn_col_default else None
        )

        alter_column_op.existing_server_default = conn_col_default

        is_diff = autogen_context.migration_context._compare_server_default(
            conn_col,
            metadata_col,
            rendered_metadata_default,
            rendered_conn_default,
        )
        if is_diff:
            alter_column_op.modify_server_default = metadata_default
            log.info("Detected server default on column '%s.%s'", tname, cname)

    return None


@comparators.dispatch_for("column")
def _compare_column_comment(
    autogen_context: AutogenContext,
    alter_column_op: AlterColumnOp,
    schema: Optional[str],
    tname: Union[quoted_name, str],
    cname: quoted_name,
    conn_col: Column[Any],
    metadata_col: Column[Any],
) -> Optional[Literal[False]]:
    assert autogen_context.dialect is not None
    if not autogen_context.dialect.supports_comments:
        return None

    metadata_comment = metadata_col.comment
    conn_col_comment = conn_col.comment
    if conn_col_comment is None and metadata_comment is None:
        return False

    alter_column_op.existing_comment = conn_col_comment

    if conn_col_comment != metadata_comment:
        alter_column_op.modify_comment = metadata_comment
        log.info("Detected column comment '%s.%s'", tname, cname)

    return None


@comparators.dispatch_for("table")
def _compare_foreign_keys(
    autogen_context: AutogenContext,
    modify_table_ops: ModifyTableOps,
    schema: Optional[str],
    tname: Union[quoted_name, str],
    conn_table: Table,
    metadata_table: Table,
) -> None:
    # if we're doing CREATE TABLE, all FKs are created
    # inline within the table def
    if conn_table is None or metadata_table is None:
        return

    inspector = autogen_context.inspector
    metadata_fks = {
        fk
        for fk in metadata_table.constraints
        if isinstance(fk, sa_schema.ForeignKeyConstraint)
    }

    conn_fks_list = [
        fk
        for fk in inspector.get_foreign_keys(tname, schema=schema)
        if autogen_context.run_name_filters(
            fk["name"],
            "foreign_key_constraint",
            {"table_name": tname, "schema_name": schema},
        )
    ]

    conn_fks = {
        _make_foreign_key(const, conn_table)  # type: ignore[arg-type]
        for const in conn_fks_list
    }

    impl = autogen_context.migration_context.impl

    # give the dialect a chance to correct the FKs to match more
    # closely
    autogen_context.migration_context.impl.correct_for_autogen_foreignkeys(
        conn_fks, metadata_fks
    )

    metadata_fks_sig = {
        impl._create_metadata_constraint_sig(fk) for fk in metadata_fks
    }

    conn_fks_sig = {
        impl._create_reflected_constraint_sig(fk) for fk in conn_fks
    }

    # check if reflected FKs include options, indicating the backend
    # can reflect FK options
    if conn_fks_list and "options" in conn_fks_list[0]:
        conn_fks_by_sig = {c.unnamed: c for c in conn_fks_sig}
        metadata_fks_by_sig = {c.unnamed: c for c in metadata_fks_sig}
    else:
        # otherwise compare by sig without options added
        conn_fks_by_sig = {c.unnamed_no_options: c for c in conn_fks_sig}
        metadata_fks_by_sig = {
            c.unnamed_no_options: c for c in metadata_fks_sig
        }

    metadata_fks_by_name = {
        c.name: c for c in metadata_fks_sig if c.name is not None
    }
    conn_fks_by_name = {c.name: c for c in conn_fks_sig if c.name is not None}

    def _add_fk(obj, compare_to):
        if autogen_context.run_object_filters(
            obj.const, obj.name, "foreign_key_constraint", False, compare_to
        ):
            modify_table_ops.ops.append(
                ops.CreateForeignKeyOp.from_constraint(const.const)  # type: ignore[has-type]  # noqa: E501
            )

            log.info(
                "Detected added foreign key (%s)(%s) on table %s%s",
                ", ".join(obj.source_columns),
                ", ".join(obj.target_columns),
                "%s." % obj.source_schema if obj.source_schema else "",
                obj.source_table,
            )

    def _remove_fk(obj, compare_to):
        if autogen_context.run_object_filters(
            obj.const, obj.name, "foreign_key_constraint", True, compare_to
        ):
            modify_table_ops.ops.append(
                ops.DropConstraintOp.from_constraint(obj.const)
            )
            log.info(
                "Detected removed foreign key (%s)(%s) on table %s%s",
                ", ".join(obj.source_columns),
                ", ".join(obj.target_columns),
                "%s." % obj.source_schema if obj.source_schema else "",
                obj.source_table,
            )

    # so far it appears we don't need to do this by name at all.
    # SQLite doesn't preserve constraint names anyway

    for removed_sig in set(conn_fks_by_sig).difference(metadata_fks_by_sig):
        const = conn_fks_by_sig[removed_sig]
        if removed_sig not in metadata_fks_by_sig:
            compare_to = (
                metadata_fks_by_name[const.name].const
                if const.name in metadata_fks_by_name
                else None
            )
            _remove_fk(const, compare_to)

    for added_sig in set(metadata_fks_by_sig).difference(conn_fks_by_sig):
        const = metadata_fks_by_sig[added_sig]
        if added_sig not in conn_fks_by_sig:
            compare_to = (
                conn_fks_by_name[const.name].const
                if const.name in conn_fks_by_name
                else None
            )
            _add_fk(const, compare_to)


@comparators.dispatch_for("table")
def _compare_table_comment(
    autogen_context: AutogenContext,
    modify_table_ops: ModifyTableOps,
    schema: Optional[str],
    tname: Union[quoted_name, str],
    conn_table: Optional[Table],
    metadata_table: Optional[Table],
) -> None:
    assert autogen_context.dialect is not None
    if not autogen_context.dialect.supports_comments:
        return

    # if we're doing CREATE TABLE, comments will be created inline
    # with the create_table op.
    if conn_table is None or metadata_table is None:
        return

    if conn_table.comment is None and metadata_table.comment is None:
        return

    if metadata_table.comment is None and conn_table.comment is not None:
        modify_table_ops.ops.append(
            ops.DropTableCommentOp(
                tname, existing_comment=conn_table.comment, schema=schema
            )
        )
    elif metadata_table.comment != conn_table.comment:
        modify_table_ops.ops.append(
            ops.CreateTableCommentOp(
                tname,
                metadata_table.comment,
                existing_comment=conn_table.comment,
                schema=schema,
            )
        )
