# mypy: allow-untyped-defs, allow-incomplete-defs, allow-untyped-calls
# mypy: no-warn-return-any, allow-any-generics

from __future__ import annotations

import re
from typing import Any
from typing import Dict
from typing import Optional
from typing import TYPE_CHECKING
from typing import Union

from sqlalchemy import cast
from sqlalchemy import JSON
from sqlalchemy import schema
from sqlalchemy import sql

from .base import alter_table
from .base import format_table_name
from .base import RenameTable
from .impl import DefaultImpl
from .. import util
from ..util.sqla_compat import compiles

if TYPE_CHECKING:
    from sqlalchemy.engine.reflection import Inspector
    from sqlalchemy.sql.compiler import DDLCompiler
    from sqlalchemy.sql.elements import Cast
    from sqlalchemy.sql.elements import ClauseElement
    from sqlalchemy.sql.schema import Column
    from sqlalchemy.sql.schema import Constraint
    from sqlalchemy.sql.schema import Table
    from sqlalchemy.sql.type_api import TypeEngine

    from ..operations.batch import BatchOperationsImpl


class SQLiteImpl(DefaultImpl):
    __dialect__ = "sqlite"

    transactional_ddl = False
    """SQLite supports transactional DDL, but pysqlite does not:
    see: http://bugs.python.org/issue10740
    """

    def requires_recreate_in_batch(
        self, batch_op: BatchOperationsImpl
    ) -> bool:
        """Return True if the given :class:`.BatchOperationsImpl`
        would need the table to be recreated and copied in order to
        proceed.

        Normally, only returns True on SQLite when operations other
        than add_column are present.

        """
        for op in batch_op.batch:
            if op[0] == "add_column":
                col = op[1][1]
                if isinstance(
                    col.server_default, schema.DefaultClause
                ) and isinstance(col.server_default.arg, sql.ClauseElement):
                    return True
                elif (
                    isinstance(col.server_default, util.sqla_compat.Computed)
                    and col.server_default.persisted
                ):
                    return True
            elif op[0] not in ("create_index", "drop_index"):
                return True
        else:
            return False

    def add_constraint(self, const: Constraint):
        # attempt to distinguish between an
        # auto-gen constraint and an explicit one
        if const._create_rule is None:
            raise NotImplementedError(
                "No support for ALTER of constraints in SQLite dialect. "
                "Please refer to the batch mode feature which allows for "
                "SQLite migrations using a copy-and-move strategy."
            )
        elif const._create_rule(self):
            util.warn(
                "Skipping unsupported ALTER for "
                "creation of implicit constraint. "
                "Please refer to the batch mode feature which allows for "
                "SQLite migrations using a copy-and-move strategy."
            )

    def drop_constraint(self, const: Constraint):
        if const._create_rule is None:
            raise NotImplementedError(
                "No support for ALTER of constraints in SQLite dialect. "
                "Please refer to the batch mode feature which allows for "
                "SQLite migrations using a copy-and-move strategy."
            )

    def compare_server_default(
        self,
        inspector_column: Column[Any],
        metadata_column: Column[Any],
        rendered_metadata_default: Optional[str],
        rendered_inspector_default: Optional[str],
    ) -> bool:
        if rendered_metadata_default is not None:
            rendered_metadata_default = re.sub(
                r"^\((.+)\)$", r"\1", rendered_metadata_default
            )

            rendered_metadata_default = re.sub(
                r"^\"?'(.+)'\"?$", r"\1", rendered_metadata_default
            )

        if rendered_inspector_default is not None:
            rendered_inspector_default = re.sub(
                r"^\((.+)\)$", r"\1", rendered_inspector_default
            )

            rendered_inspector_default = re.sub(
                r"^\"?'(.+)'\"?$", r"\1", rendered_inspector_default
            )

        return rendered_inspector_default != rendered_metadata_default

    def _guess_if_default_is_unparenthesized_sql_expr(
        self, expr: Optional[str]
    ) -> bool:
        """Determine if a server default is a SQL expression or a constant.

        There are too many assertions that expect server defaults to round-trip
        identically without parenthesis added so we will add parens only in
        very specific cases.

        """
        if not expr:
            return False
        elif re.match(r"^[0-9\.]$", expr):
            return False
        elif re.match(r"^'.+'$", expr):
            return False
        elif re.match(r"^\(.+\)$", expr):
            return False
        else:
            return True

    def autogen_column_reflect(
        self,
        inspector: Inspector,
        table: Table,
        column_info: Dict[str, Any],
    ) -> None:
        # SQLite expression defaults require parenthesis when sent
        # as DDL
        if self._guess_if_default_is_unparenthesized_sql_expr(
            column_info.get("default", None)
        ):
            column_info["default"] = "(%s)" % (column_info["default"],)

    def render_ddl_sql_expr(
        self, expr: ClauseElement, is_server_default: bool = False, **kw
    ) -> str:
        # SQLite expression defaults require parenthesis when sent
        # as DDL
        str_expr = super().render_ddl_sql_expr(
            expr, is_server_default=is_server_default, **kw
        )

        if (
            is_server_default
            and self._guess_if_default_is_unparenthesized_sql_expr(str_expr)
        ):
            str_expr = "(%s)" % (str_expr,)
        return str_expr

    def cast_for_batch_migrate(
        self,
        existing: Column[Any],
        existing_transfer: Dict[str, Union[TypeEngine, Cast]],
        new_type: TypeEngine,
    ) -> None:
        if (
            existing.type._type_affinity is not new_type._type_affinity
            and not isinstance(new_type, JSON)
        ):
            existing_transfer["expr"] = cast(
                existing_transfer["expr"], new_type
            )

    def correct_for_autogen_constraints(
        self,
        conn_unique_constraints,
        conn_indexes,
        metadata_unique_constraints,
        metadata_indexes,
    ):
        self._skip_functional_indexes(metadata_indexes, conn_indexes)


@compiles(RenameTable, "sqlite")
def visit_rename_table(
    element: RenameTable, compiler: DDLCompiler, **kw
) -> str:
    return "%s RENAME TO %s" % (
        alter_table(compiler, element.table_name, element.schema),
        format_table_name(compiler, element.new_table_name, None),
    )


# @compiles(AddColumn, 'sqlite')
# def visit_add_column(element, compiler, **kw):
#    return "%s %s" % (
#        alter_table(compiler, element.table_name, element.schema),
#        add_column(compiler, element.column, **kw)
#    )


# def add_column(compiler, column, **kw):
#    text = "ADD COLUMN %s" % compiler.get_column_specification(column, **kw)
# need to modify SQLAlchemy so that the CHECK associated with a Boolean
# or Enum gets placed as part of the column constraints, not the Table
# see ticket 98
#    for const in column.constraints:
#        text += compiler.process(AddConstraint(const))
#    return text
