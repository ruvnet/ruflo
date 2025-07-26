# mypy: allow-untyped-defs, allow-incomplete-defs, allow-untyped-calls
# mypy: no-warn-return-any, allow-any-generics

from __future__ import annotations

import functools
from typing import Optional
from typing import TYPE_CHECKING
from typing import Union

from sqlalchemy import exc
from sqlalchemy import Integer
from sqlalchemy import types as sqltypes
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.schema import Column
from sqlalchemy.schema import DDLElement
from sqlalchemy.sql.elements import quoted_name

from ..util.sqla_compat import _columns_for_constraint  # noqa
from ..util.sqla_compat import _find_columns  # noqa
from ..util.sqla_compat import _fk_spec  # noqa
from ..util.sqla_compat import _is_type_bound  # noqa
from ..util.sqla_compat import _table_for_constraint  # noqa

if TYPE_CHECKING:
    from typing import Any

    from sqlalchemy.sql.compiler import Compiled
    from sqlalchemy.sql.compiler import DDLCompiler
    from sqlalchemy.sql.elements import TextClause
    from sqlalchemy.sql.functions import Function
    from sqlalchemy.sql.schema import FetchedValue
    from sqlalchemy.sql.type_api import TypeEngine

    from .impl import DefaultImpl
    from ..util.sqla_compat import Computed
    from ..util.sqla_compat import Identity

_ServerDefault = Union["TextClause", "FetchedValue", "Function[Any]", str]


class AlterTable(DDLElement):

    """Represent an ALTER TABLE statement.

    Only the string name and optional schema name of the table
    is required, not a full Table object.

    """

    def __init__(
        self,
        table_name: str,
        schema: Optional[Union[quoted_name, str]] = None,
    ) -> None:
        self.table_name = table_name
        self.schema = schema


class RenameTable(AlterTable):
    def __init__(
        self,
        old_table_name: str,
        new_table_name: Union[quoted_name, str],
        schema: Optional[Union[quoted_name, str]] = None,
    ) -> None:
        super().__init__(old_table_name, schema=schema)
        self.new_table_name = new_table_name


class AlterColumn(AlterTable):
    def __init__(
        self,
        name: str,
        column_name: str,
        schema: Optional[str] = None,
        existing_type: Optional[TypeEngine] = None,
        existing_nullable: Optional[bool] = None,
        existing_server_default: Optional[_ServerDefault] = None,
        existing_comment: Optional[str] = None,
    ) -> None:
        super().__init__(name, schema=schema)
        self.column_name = column_name
        self.existing_type = (
            sqltypes.to_instance(existing_type)
            if existing_type is not None
            else None
        )
        self.existing_nullable = existing_nullable
        self.existing_server_default = existing_server_default
        self.existing_comment = existing_comment


class ColumnNullable(AlterColumn):
    def __init__(
        self, name: str, column_name: str, nullable: bool, **kw
    ) -> None:
        super().__init__(name, column_name, **kw)
        self.nullable = nullable


class ColumnType(AlterColumn):
    def __init__(
        self, name: str, column_name: str, type_: TypeEngine, **kw
    ) -> None:
        super().__init__(name, column_name, **kw)
        self.type_ = sqltypes.to_instance(type_)


class ColumnName(AlterColumn):
    def __init__(
        self, name: str, column_name: str, newname: str, **kw
    ) -> None:
        super().__init__(name, column_name, **kw)
        self.newname = newname


class ColumnDefault(AlterColumn):
    def __init__(
        self,
        name: str,
        column_name: str,
        default: Optional[_ServerDefault],
        **kw,
    ) -> None:
        super().__init__(name, column_name, **kw)
        self.default = default


class ComputedColumnDefault(AlterColumn):
    def __init__(
        self, name: str, column_name: str, default: Optional[Computed], **kw
    ) -> None:
        super().__init__(name, column_name, **kw)
        self.default = default


class IdentityColumnDefault(AlterColumn):
    def __init__(
        self,
        name: str,
        column_name: str,
        default: Optional[Identity],
        impl: DefaultImpl,
        **kw,
    ) -> None:
        super().__init__(name, column_name, **kw)
        self.default = default
        self.impl = impl


class AddColumn(AlterTable):
    def __init__(
        self,
        name: str,
        column: Column[Any],
        schema: Optional[Union[quoted_name, str]] = None,
    ) -> None:
        super().__init__(name, schema=schema)
        self.column = column


class DropColumn(AlterTable):
    def __init__(
        self, name: str, column: Column[Any], schema: Optional[str] = None
    ) -> None:
        super().__init__(name, schema=schema)
        self.column = column


class ColumnComment(AlterColumn):
    def __init__(
        self, name: str, column_name: str, comment: Optional[str], **kw
    ) -> None:
        super().__init__(name, column_name, **kw)
        self.comment = comment


@compiles(RenameTable)  # type: ignore[misc]
def visit_rename_table(
    element: RenameTable, compiler: DDLCompiler, **kw
) -> str:
    return "%s RENAME TO %s" % (
        alter_table(compiler, element.table_name, element.schema),
        format_table_name(compiler, element.new_table_name, element.schema),
    )


@compiles(AddColumn)  # type: ignore[misc]
def visit_add_column(element: AddColumn, compiler: DDLCompiler, **kw) -> str:
    return "%s %s" % (
        alter_table(compiler, element.table_name, element.schema),
        add_column(compiler, element.column, **kw),
    )


@compiles(DropColumn)  # type: ignore[misc]
def visit_drop_column(element: DropColumn, compiler: DDLCompiler, **kw) -> str:
    return "%s %s" % (
        alter_table(compiler, element.table_name, element.schema),
        drop_column(compiler, element.column.name, **kw),
    )


@compiles(ColumnNullable)  # type: ignore[misc]
def visit_column_nullable(
    element: ColumnNullable, compiler: DDLCompiler, **kw
) -> str:
    return "%s %s %s" % (
        alter_table(compiler, element.table_name, element.schema),
        alter_column(compiler, element.column_name),
        "DROP NOT NULL" if element.nullable else "SET NOT NULL",
    )


@compiles(ColumnType)  # type: ignore[misc]
def visit_column_type(element: ColumnType, compiler: DDLCompiler, **kw) -> str:
    return "%s %s %s" % (
        alter_table(compiler, element.table_name, element.schema),
        alter_column(compiler, element.column_name),
        "TYPE %s" % format_type(compiler, element.type_),
    )


@compiles(ColumnName)  # type: ignore[misc]
def visit_column_name(element: ColumnName, compiler: DDLCompiler, **kw) -> str:
    return "%s RENAME %s TO %s" % (
        alter_table(compiler, element.table_name, element.schema),
        format_column_name(compiler, element.column_name),
        format_column_name(compiler, element.newname),
    )


@compiles(ColumnDefault)  # type: ignore[misc]
def visit_column_default(
    element: ColumnDefault, compiler: DDLCompiler, **kw
) -> str:
    return "%s %s %s" % (
        alter_table(compiler, element.table_name, element.schema),
        alter_column(compiler, element.column_name),
        "SET DEFAULT %s" % format_server_default(compiler, element.default)
        if element.default is not None
        else "DROP DEFAULT",
    )


@compiles(ComputedColumnDefault)  # type: ignore[misc]
def visit_computed_column(
    element: ComputedColumnDefault, compiler: DDLCompiler, **kw
):
    raise exc.CompileError(
        'Adding or removing a "computed" construct, e.g. GENERATED '
        "ALWAYS AS, to or from an existing column is not supported."
    )


@compiles(IdentityColumnDefault)  # type: ignore[misc]
def visit_identity_column(
    element: IdentityColumnDefault, compiler: DDLCompiler, **kw
):
    raise exc.CompileError(
        'Adding, removing or modifying an "identity" construct, '
        "e.g. GENERATED AS IDENTITY, to or from an existing "
        "column is not supported in this dialect."
    )


def quote_dotted(
    name: Union[quoted_name, str], quote: functools.partial
) -> Union[quoted_name, str]:
    """quote the elements of a dotted name"""

    if isinstance(name, quoted_name):
        return quote(name)
    result = ".".join([quote(x) for x in name.split(".")])
    return result


def format_table_name(
    compiler: Compiled,
    name: Union[quoted_name, str],
    schema: Optional[Union[quoted_name, str]],
) -> Union[quoted_name, str]:
    quote = functools.partial(compiler.preparer.quote)
    if schema:
        return quote_dotted(schema, quote) + "." + quote(name)
    else:
        return quote(name)


def format_column_name(
    compiler: DDLCompiler, name: Optional[Union[quoted_name, str]]
) -> Union[quoted_name, str]:
    return compiler.preparer.quote(name)  # type: ignore[arg-type]


def format_server_default(
    compiler: DDLCompiler,
    default: Optional[_ServerDefault],
) -> str:
    return compiler.get_column_default_string(
        Column("x", Integer, server_default=default)
    )


def format_type(compiler: DDLCompiler, type_: TypeEngine) -> str:
    return compiler.dialect.type_compiler.process(type_)


def alter_table(
    compiler: DDLCompiler,
    name: str,
    schema: Optional[str],
) -> str:
    return "ALTER TABLE %s" % format_table_name(compiler, name, schema)


def drop_column(compiler: DDLCompiler, name: str, **kw) -> str:
    return "DROP COLUMN %s" % format_column_name(compiler, name)


def alter_column(compiler: DDLCompiler, name: str) -> str:
    return "ALTER COLUMN %s" % format_column_name(compiler, name)


def add_column(compiler: DDLCompiler, column: Column[Any], **kw) -> str:
    text = "ADD COLUMN %s" % compiler.get_column_specification(column, **kw)

    const = " ".join(
        compiler.process(constraint) for constraint in column.constraints
    )
    if const:
        text += " " + const

    return text
