# mypy: allow-untyped-calls

from __future__ import annotations

from contextlib import contextmanager
import re
import textwrap
from typing import Any
from typing import Awaitable
from typing import Callable
from typing import Dict
from typing import Iterator
from typing import List  # noqa
from typing import Mapping
from typing import NoReturn
from typing import Optional
from typing import overload
from typing import Sequence  # noqa
from typing import Tuple
from typing import Type  # noqa
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from sqlalchemy.sql.elements import conv

from . import batch
from . import schemaobj
from .. import util
from ..util import sqla_compat
from ..util.compat import formatannotation_fwdref
from ..util.compat import inspect_formatargspec
from ..util.compat import inspect_getfullargspec
from ..util.sqla_compat import _literal_bindparam


if TYPE_CHECKING:
    from typing import Literal

    from sqlalchemy import Table
    from sqlalchemy.engine import Connection
    from sqlalchemy.sql import Executable
    from sqlalchemy.sql.expression import ColumnElement
    from sqlalchemy.sql.expression import TableClause
    from sqlalchemy.sql.expression import TextClause
    from sqlalchemy.sql.functions import Function
    from sqlalchemy.sql.schema import Column
    from sqlalchemy.sql.schema import Computed
    from sqlalchemy.sql.schema import Identity
    from sqlalchemy.sql.schema import SchemaItem
    from sqlalchemy.types import TypeEngine

    from .batch import BatchOperationsImpl
    from .ops import AddColumnOp
    from .ops import AddConstraintOp
    from .ops import AlterColumnOp
    from .ops import AlterTableOp
    from .ops import BulkInsertOp
    from .ops import CreateIndexOp
    from .ops import CreateTableCommentOp
    from .ops import CreateTableOp
    from .ops import DropColumnOp
    from .ops import DropConstraintOp
    from .ops import DropIndexOp
    from .ops import DropTableCommentOp
    from .ops import DropTableOp
    from .ops import ExecuteSQLOp
    from .ops import MigrateOperation
    from ..ddl import DefaultImpl
    from ..runtime.migration import MigrationContext
__all__ = ("Operations", "BatchOperations")
_T = TypeVar("_T")

_C = TypeVar("_C", bound=Callable[..., Any])


class AbstractOperations(util.ModuleClsProxy):
    """Base class for Operations and BatchOperations.

    .. versionadded:: 1.11.0

    """

    impl: Union[DefaultImpl, BatchOperationsImpl]
    _to_impl = util.Dispatcher()

    def __init__(
        self,
        migration_context: MigrationContext,
        impl: Optional[BatchOperationsImpl] = None,
    ) -> None:
        """Construct a new :class:`.Operations`

        :param migration_context: a :class:`.MigrationContext`
         instance.

        """
        self.migration_context = migration_context
        if impl is None:
            self.impl = migration_context.impl
        else:
            self.impl = impl

        self.schema_obj = schemaobj.SchemaObjects(migration_context)

    @classmethod
    def register_operation(
        cls, name: str, sourcename: Optional[str] = None
    ) -> Callable[[Type[_T]], Type[_T]]:
        """Register a new operation for this class.

        This method is normally used to add new operations
        to the :class:`.Operations` class, and possibly the
        :class:`.BatchOperations` class as well.   All Alembic migration
        operations are implemented via this system, however the system
        is also available as a public API to facilitate adding custom
        operations.

        .. seealso::

            :ref:`operation_plugins`


        """

        def register(op_cls: Type[_T]) -> Type[_T]:
            if sourcename is None:
                fn = getattr(op_cls, name)
                source_name = fn.__name__
            else:
                fn = getattr(op_cls, sourcename)
                source_name = fn.__name__

            spec = inspect_getfullargspec(fn)

            name_args = spec[0]
            assert name_args[0:2] == ["cls", "operations"]

            name_args[0:2] = ["self"]

            args = inspect_formatargspec(
                *spec, formatannotation=formatannotation_fwdref
            )
            num_defaults = len(spec[3]) if spec[3] else 0

            defaulted_vals: Tuple[Any, ...]

            if num_defaults:
                defaulted_vals = tuple(name_args[0 - num_defaults :])
            else:
                defaulted_vals = ()

            defaulted_vals += tuple(spec[4])
            # here, we are using formatargspec in a different way in order
            # to get a string that will re-apply incoming arguments to a new
            # function call

            apply_kw = inspect_formatargspec(
                name_args + spec[4],
                spec[1],
                spec[2],
                defaulted_vals,
                formatvalue=lambda x: "=" + x,
                formatannotation=formatannotation_fwdref,
            )

            args = re.sub(
                r'[_]?ForwardRef\(([\'"].+?[\'"])\)',
                lambda m: m.group(1),
                args,
            )

            func_text = textwrap.dedent(
                """\
            def %(name)s%(args)s:
                %(doc)r
                return op_cls.%(source_name)s%(apply_kw)s
            """
                % {
                    "name": name,
                    "source_name": source_name,
                    "args": args,
                    "apply_kw": apply_kw,
                    "doc": fn.__doc__,
                }
            )

            globals_ = dict(globals())
            globals_.update({"op_cls": op_cls})
            lcl: Dict[str, Any] = {}

            exec(func_text, globals_, lcl)
            setattr(cls, name, lcl[name])
            fn.__func__.__doc__ = (
                "This method is proxied on "
                "the :class:`.%s` class, via the :meth:`.%s.%s` method."
                % (cls.__name__, cls.__name__, name)
            )
            if hasattr(fn, "_legacy_translations"):
                lcl[name]._legacy_translations = fn._legacy_translations
            return op_cls

        return register

    @classmethod
    def implementation_for(cls, op_cls: Any) -> Callable[[_C], _C]:
        """Register an implementation for a given :class:`.MigrateOperation`.

        This is part of the operation extensibility API.

        .. seealso::

            :ref:`operation_plugins` - example of use

        """

        def decorate(fn: _C) -> _C:
            cls._to_impl.dispatch_for(op_cls)(fn)
            return fn

        return decorate

    @classmethod
    @contextmanager
    def context(
        cls, migration_context: MigrationContext
    ) -> Iterator[Operations]:
        op = Operations(migration_context)
        op._install_proxy()
        yield op
        op._remove_proxy()

    @contextmanager
    def batch_alter_table(
        self,
        table_name: str,
        schema: Optional[str] = None,
        recreate: Literal["auto", "always", "never"] = "auto",
        partial_reordering: Optional[Tuple[Any, ...]] = None,
        copy_from: Optional[Table] = None,
        table_args: Tuple[Any, ...] = (),
        table_kwargs: Mapping[str, Any] = util.immutabledict(),
        reflect_args: Tuple[Any, ...] = (),
        reflect_kwargs: Mapping[str, Any] = util.immutabledict(),
        naming_convention: Optional[Dict[str, str]] = None,
    ) -> Iterator[BatchOperations]:
        """Invoke a series of per-table migrations in batch.

        Batch mode allows a series of operations specific to a table
        to be syntactically grouped together, and allows for alternate
        modes of table migration, in particular the "recreate" style of
        migration required by SQLite.

        "recreate" style is as follows:

        1. A new table is created with the new specification, based on the
           migration directives within the batch, using a temporary name.

        2. the data copied from the existing table to the new table.

        3. the existing table is dropped.

        4. the new table is renamed to the existing table name.

        The directive by default will only use "recreate" style on the
        SQLite backend, and only if directives are present which require
        this form, e.g. anything other than ``add_column()``.   The batch
        operation on other backends will proceed using standard ALTER TABLE
        operations.

        The method is used as a context manager, which returns an instance
        of :class:`.BatchOperations`; this object is the same as
        :class:`.Operations` except that table names and schema names
        are omitted.  E.g.::

            with op.batch_alter_table("some_table") as batch_op:
                batch_op.add_column(Column("foo", Integer))
                batch_op.drop_column("bar")

        The operations within the context manager are invoked at once
        when the context is ended.   When run against SQLite, if the
        migrations include operations not supported by SQLite's ALTER TABLE,
        the entire table will be copied to a new one with the new
        specification, moving all data across as well.

        The copy operation by default uses reflection to retrieve the current
        structure of the table, and therefore :meth:`.batch_alter_table`
        in this mode requires that the migration is run in "online" mode.
        The ``copy_from`` parameter may be passed which refers to an existing
        :class:`.Table` object, which will bypass this reflection step.

        .. note::  The table copy operation will currently not copy
           CHECK constraints, and may not copy UNIQUE constraints that are
           unnamed, as is possible on SQLite.   See the section
           :ref:`sqlite_batch_constraints` for workarounds.

        :param table_name: name of table
        :param schema: optional schema name.
        :param recreate: under what circumstances the table should be
         recreated. At its default of ``"auto"``, the SQLite dialect will
         recreate the table if any operations other than ``add_column()``,
         ``create_index()``, or ``drop_index()`` are
         present. Other options include ``"always"`` and ``"never"``.
        :param copy_from: optional :class:`~sqlalchemy.schema.Table` object
         that will act as the structure of the table being copied.  If omitted,
         table reflection is used to retrieve the structure of the table.

         .. seealso::

            :ref:`batch_offline_mode`

            :paramref:`~.Operations.batch_alter_table.reflect_args`

            :paramref:`~.Operations.batch_alter_table.reflect_kwargs`

        :param reflect_args: a sequence of additional positional arguments that
         will be applied to the table structure being reflected / copied;
         this may be used to pass column and constraint overrides to the
         table that will be reflected, in lieu of passing the whole
         :class:`~sqlalchemy.schema.Table` using
         :paramref:`~.Operations.batch_alter_table.copy_from`.
        :param reflect_kwargs: a dictionary of additional keyword arguments
         that will be applied to the table structure being copied; this may be
         used to pass additional table and reflection options to the table that
         will be reflected, in lieu of passing the whole
         :class:`~sqlalchemy.schema.Table` using
         :paramref:`~.Operations.batch_alter_table.copy_from`.
        :param table_args: a sequence of additional positional arguments that
         will be applied to the new :class:`~sqlalchemy.schema.Table` when
         created, in addition to those copied from the source table.
         This may be used to provide additional constraints such as CHECK
         constraints that may not be reflected.
        :param table_kwargs: a dictionary of additional keyword arguments
         that will be applied to the new :class:`~sqlalchemy.schema.Table`
         when created, in addition to those copied from the source table.
         This may be used to provide for additional table options that may
         not be reflected.
        :param naming_convention: a naming convention dictionary of the form
         described at :ref:`autogen_naming_conventions` which will be applied
         to the :class:`~sqlalchemy.schema.MetaData` during the reflection
         process.  This is typically required if one wants to drop SQLite
         constraints, as these constraints will not have names when
         reflected on this backend.  Requires SQLAlchemy **0.9.4** or greater.

         .. seealso::

            :ref:`dropping_sqlite_foreign_keys`

        :param partial_reordering: a list of tuples, each suggesting a desired
         ordering of two or more columns in the newly created table.  Requires
         that :paramref:`.batch_alter_table.recreate` is set to ``"always"``.
         Examples, given a table with columns "a", "b", "c", and "d":

         Specify the order of all columns::

            with op.batch_alter_table(
                "some_table",
                recreate="always",
                partial_reordering=[("c", "d", "a", "b")],
            ) as batch_op:
                pass

         Ensure "d" appears before "c", and "b", appears before "a"::

            with op.batch_alter_table(
                "some_table",
                recreate="always",
                partial_reordering=[("d", "c"), ("b", "a")],
            ) as batch_op:
                pass

         The ordering of columns not included in the partial_reordering
         set is undefined.   Therefore it is best to specify the complete
         ordering of all columns for best results.

        .. note:: batch mode requires SQLAlchemy 0.8 or above.

        .. seealso::

            :ref:`batch_migrations`

        """
        impl = batch.BatchOperationsImpl(
            self,
            table_name,
            schema,
            recreate,
            copy_from,
            table_args,
            table_kwargs,
            reflect_args,
            reflect_kwargs,
            naming_convention,
            partial_reordering,
        )
        batch_op = BatchOperations(self.migration_context, impl=impl)
        yield batch_op
        impl.flush()

    def get_context(self) -> MigrationContext:
        """Return the :class:`.MigrationContext` object that's
        currently in use.

        """

        return self.migration_context

    @overload
    def invoke(self, operation: CreateTableOp) -> Table:
        ...

    @overload
    def invoke(
        self,
        operation: Union[
            AddConstraintOp,
            DropConstraintOp,
            CreateIndexOp,
            DropIndexOp,
            AddColumnOp,
            AlterColumnOp,
            AlterTableOp,
            CreateTableCommentOp,
            DropTableCommentOp,
            DropColumnOp,
            BulkInsertOp,
            DropTableOp,
            ExecuteSQLOp,
        ],
    ) -> None:
        ...

    @overload
    def invoke(self, operation: MigrateOperation) -> Any:
        ...

    def invoke(self, operation: MigrateOperation) -> Any:
        """Given a :class:`.MigrateOperation`, invoke it in terms of
        this :class:`.Operations` instance.

        """
        fn = self._to_impl.dispatch(
            operation, self.migration_context.impl.__dialect__
        )
        return fn(self, operation)

    def f(self, name: str) -> conv:
        """Indicate a string name that has already had a naming convention
        applied to it.

        This feature combines with the SQLAlchemy ``naming_convention`` feature
        to disambiguate constraint names that have already had naming
        conventions applied to them, versus those that have not.  This is
        necessary in the case that the ``"%(constraint_name)s"`` token
        is used within a naming convention, so that it can be identified
        that this particular name should remain fixed.

        If the :meth:`.Operations.f` is used on a constraint, the naming
        convention will not take effect::

            op.add_column("t", "x", Boolean(name=op.f("ck_bool_t_x")))

        Above, the CHECK constraint generated will have the name
        ``ck_bool_t_x`` regardless of whether or not a naming convention is
        in use.

        Alternatively, if a naming convention is in use, and 'f' is not used,
        names will be converted along conventions.  If the ``target_metadata``
        contains the naming convention
        ``{"ck": "ck_bool_%(table_name)s_%(constraint_name)s"}``, then the
        output of the following:

            op.add_column("t", "x", Boolean(name="x"))

        will be::

            CONSTRAINT ck_bool_t_x CHECK (x in (1, 0)))

        The function is rendered in the output of autogenerate when
        a particular constraint name is already converted.

        """
        return conv(name)

    def inline_literal(
        self, value: Union[str, int], type_: Optional[TypeEngine[Any]] = None
    ) -> _literal_bindparam:
        r"""Produce an 'inline literal' expression, suitable for
        using in an INSERT, UPDATE, or DELETE statement.

        When using Alembic in "offline" mode, CRUD operations
        aren't compatible with SQLAlchemy's default behavior surrounding
        literal values,
        which is that they are converted into bound values and passed
        separately into the ``execute()`` method of the DBAPI cursor.
        An offline SQL
        script needs to have these rendered inline.  While it should
        always be noted that inline literal values are an **enormous**
        security hole in an application that handles untrusted input,
        a schema migration is not run in this context, so
        literals are safe to render inline, with the caveat that
        advanced types like dates may not be supported directly
        by SQLAlchemy.

        See :meth:`.Operations.execute` for an example usage of
        :meth:`.Operations.inline_literal`.

        The environment can also be configured to attempt to render
        "literal" values inline automatically, for those simple types
        that are supported by the dialect; see
        :paramref:`.EnvironmentContext.configure.literal_binds` for this
        more recently added feature.

        :param value: The value to render.  Strings, integers, and simple
         numerics should be supported.   Other types like boolean,
         dates, etc. may or may not be supported yet by various
         backends.
        :param type\_: optional - a :class:`sqlalchemy.types.TypeEngine`
         subclass stating the type of this value.  In SQLAlchemy
         expressions, this is usually derived automatically
         from the Python type of the value itself, as well as
         based on the context in which the value is used.

        .. seealso::

            :paramref:`.EnvironmentContext.configure.literal_binds`

        """
        return sqla_compat._literal_bindparam(None, value, type_=type_)

    def get_bind(self) -> Connection:
        """Return the current 'bind'.

        Under normal circumstances, this is the
        :class:`~sqlalchemy.engine.Connection` currently being used
        to emit SQL to the database.

        In a SQL script context, this value is ``None``. [TODO: verify this]

        """
        return self.migration_context.impl.bind  # type: ignore[return-value]

    def run_async(
        self,
        async_function: Callable[..., Awaitable[_T]],
        *args: Any,
        **kw_args: Any,
    ) -> _T:
        """Invoke the given asynchronous callable, passing an asynchronous
        :class:`~sqlalchemy.ext.asyncio.AsyncConnection` as the first
        argument.

        This method allows calling async functions from within the
        synchronous ``upgrade()`` or ``downgrade()`` alembic migration
        method.

        The async connection passed to the callable shares the same
        transaction as the connection running in the migration context.

        Any additional arg or kw_arg passed to this function are passed
        to the provided async function.

        .. versionadded: 1.11

        .. note::

            This method can be called only when alembic is called using
            an async dialect.
        """
        if not sqla_compat.sqla_14_18:
            raise NotImplementedError("SQLAlchemy 1.4.18+ required")
        sync_conn = self.get_bind()
        if sync_conn is None:
            raise NotImplementedError("Cannot call run_async in SQL mode")
        if not sync_conn.dialect.is_async:
            raise ValueError("Cannot call run_async with a sync engine")
        from sqlalchemy.ext.asyncio import AsyncConnection
        from sqlalchemy.util import await_only

        async_conn = AsyncConnection._retrieve_proxy_for_target(sync_conn)
        return await_only(async_function(async_conn, *args, **kw_args))


class Operations(AbstractOperations):
    """Define high level migration operations.

    Each operation corresponds to some schema migration operation,
    executed against a particular :class:`.MigrationContext`
    which in turn represents connectivity to a database,
    or a file output stream.

    While :class:`.Operations` is normally configured as
    part of the :meth:`.EnvironmentContext.run_migrations`
    method called from an ``env.py`` script, a standalone
    :class:`.Operations` instance can be
    made for use cases external to regular Alembic
    migrations by passing in a :class:`.MigrationContext`::

        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        conn = myengine.connect()
        ctx = MigrationContext.configure(conn)
        op = Operations(ctx)

        op.alter_column("t", "c", nullable=True)

    Note that as of 0.8, most of the methods on this class are produced
    dynamically using the :meth:`.Operations.register_operation`
    method.

    """

    if TYPE_CHECKING:
        # START STUB FUNCTIONS: op_cls
        # ### the following stubs are generated by tools/write_pyi.py ###
        # ### do not edit ###

        def add_column(
            self,
            table_name: str,
            column: Column[Any],
            *,
            schema: Optional[str] = None,
        ) -> None:
            """Issue an "add column" instruction using the current
            migration context.

            e.g.::

                from alembic import op
                from sqlalchemy import Column, String

                op.add_column("organization", Column("name", String()))

            The :meth:`.Operations.add_column` method typically corresponds
            to the SQL command "ALTER TABLE... ADD COLUMN".    Within the scope
            of this command, the column's name, datatype, nullability,
            and optional server-generated defaults may be indicated.

            .. note::

                With the exception of NOT NULL constraints or single-column FOREIGN
                KEY constraints, other kinds of constraints such as PRIMARY KEY,
                UNIQUE or CHECK constraints **cannot** be generated using this
                method; for these constraints, refer to operations such as
                :meth:`.Operations.create_primary_key` and
                :meth:`.Operations.create_check_constraint`. In particular, the
                following :class:`~sqlalchemy.schema.Column` parameters are
                **ignored**:

                * :paramref:`~sqlalchemy.schema.Column.primary_key` - SQL databases
                  typically do not support an ALTER operation that can add
                  individual columns one at a time to an existing primary key
                  constraint, therefore it's less ambiguous to use the
                  :meth:`.Operations.create_primary_key` method, which assumes no
                  existing primary key constraint is present.
                * :paramref:`~sqlalchemy.schema.Column.unique` - use the
                  :meth:`.Operations.create_unique_constraint` method
                * :paramref:`~sqlalchemy.schema.Column.index` - use the
                  :meth:`.Operations.create_index` method


            The provided :class:`~sqlalchemy.schema.Column` object may include a
            :class:`~sqlalchemy.schema.ForeignKey` constraint directive,
            referencing a remote table name. For this specific type of constraint,
            Alembic will automatically emit a second ALTER statement in order to
            add the single-column FOREIGN KEY constraint separately::

                from alembic import op
                from sqlalchemy import Column, INTEGER, ForeignKey

                op.add_column(
                    "organization",
                    Column("account_id", INTEGER, ForeignKey("accounts.id")),
                )

            The column argument passed to :meth:`.Operations.add_column` is a
            :class:`~sqlalchemy.schema.Column` construct, used in the same way it's
            used in SQLAlchemy. In particular, values or functions to be indicated
            as producing the column's default value on the database side are
            specified using the ``server_default`` parameter, and not ``default``
            which only specifies Python-side defaults::

                from alembic import op
                from sqlalchemy import Column, TIMESTAMP, func

                # specify "DEFAULT NOW" along with the column add
                op.add_column(
                    "account",
                    Column("timestamp", TIMESTAMP, server_default=func.now()),
                )

            :param table_name: String name of the parent table.
            :param column: a :class:`sqlalchemy.schema.Column` object
             representing the new column.
            :param schema: Optional schema name to operate within.  To control
             quoting of the schema outside of the default behavior, use
             the SQLAlchemy construct
             :class:`~sqlalchemy.sql.elements.quoted_name`.

            """  # noqa: E501
            ...

        def alter_column(
            self,
            table_name: str,
            column_name: str,
            *,
            nullable: Optional[bool] = None,
            comment: Union[str, Literal[False], None] = False,
            server_default: Any = False,
            new_column_name: Optional[str] = None,
            type_: Union[TypeEngine[Any], Type[TypeEngine[Any]], None] = None,
            existing_type: Union[
                TypeEngine[Any], Type[TypeEngine[Any]], None
            ] = None,
            existing_server_default: Union[
                str, bool, Identity, Computed, None
            ] = False,
            existing_nullable: Optional[bool] = None,
            existing_comment: Optional[str] = None,
            schema: Optional[str] = None,
            **kw: Any,
        ) -> None:
            r"""Issue an "alter column" instruction using the
            current migration context.

            Generally, only that aspect of the column which
            is being changed, i.e. name, type, nullability,
            default, needs to be specified.  Multiple changes
            can also be specified at once and the backend should
            "do the right thing", emitting each change either
            separately or together as the backend allows.

            MySQL has special requirements here, since MySQL
            cannot ALTER a column without a full specification.
            When producing MySQL-compatible migration files,
            it is recommended that the ``existing_type``,
            ``existing_server_default``, and ``existing_nullable``
            parameters be present, if not being altered.

            Type changes which are against the SQLAlchemy
            "schema" types :class:`~sqlalchemy.types.Boolean`
            and  :class:`~sqlalchemy.types.Enum` may also
            add or drop constraints which accompany those
            types on backends that don't support them natively.
            The ``existing_type`` argument is
            used in this case to identify and remove a previous
            constraint that was bound to the type object.

            :param table_name: string name of the target table.
            :param column_name: string name of the target column,
             as it exists before the operation begins.
            :param nullable: Optional; specify ``True`` or ``False``
             to alter the column's nullability.
            :param server_default: Optional; specify a string
             SQL expression, :func:`~sqlalchemy.sql.expression.text`,
             or :class:`~sqlalchemy.schema.DefaultClause` to indicate
             an alteration to the column's default value.
             Set to ``None`` to have the default removed.
            :param comment: optional string text of a new comment to add to the
             column.
            :param new_column_name: Optional; specify a string name here to
             indicate the new name within a column rename operation.
            :param type\_: Optional; a :class:`~sqlalchemy.types.TypeEngine`
             type object to specify a change to the column's type.
             For SQLAlchemy types that also indicate a constraint (i.e.
             :class:`~sqlalchemy.types.Boolean`, :class:`~sqlalchemy.types.Enum`),
             the constraint is also generated.
            :param autoincrement: set the ``AUTO_INCREMENT`` flag of the column;
             currently understood by the MySQL dialect.
            :param existing_type: Optional; a
             :class:`~sqlalchemy.types.TypeEngine`
             type object to specify the previous type.   This
             is required for all MySQL column alter operations that
             don't otherwise specify a new type, as well as for
             when nullability is being changed on a SQL Server
             column.  It is also used if the type is a so-called
             SQLAlchemy "schema" type which may define a constraint (i.e.
             :class:`~sqlalchemy.types.Boolean`,
             :class:`~sqlalchemy.types.Enum`),
             so that the constraint can be dropped.
            :param existing_server_default: Optional; The existing
             default value of the column.   Required on MySQL if
             an existing default is not being changed; else MySQL
             removes the default.
            :param existing_nullable: Optional; the existing nullability
             of the column.  Required on MySQL if the existing nullability
             is not being changed; else MySQL sets this to NULL.
            :param existing_autoincrement: Optional; the existing autoincrement
             of the column.  Used for MySQL's system of altering a column
             that specifies ``AUTO_INCREMENT``.
            :param existing_comment: string text of the existing comment on the
             column to be maintained.  Required on MySQL if the existing comment
             on the column is not being changed.
            :param schema: Optional schema name to operate within.  To control
             quoting of the schema outside of the default behavior, use
             the SQLAlchemy construct
             :class:`~sqlalchemy.sql.elements.quoted_name`.
            :param postgresql_using: String argument which will indicate a
             SQL expression to render within the Postgresql-specific USING clause
             within ALTER COLUMN.    This string is taken directly as raw SQL which
             must explicitly include any necessary quoting or escaping of tokens
             within the expression.

            """  # noqa: E501
            ...

        def bulk_insert(
            self,
            table: Union[Table, TableClause],
            rows: List[Dict[str, Any]],
            *,
            multiinsert: bool = True,
        ) -> None:
            """Issue a "bulk insert" operation using the current
            migration context.

            This provides a means of representing an INSERT of multiple rows
            which works equally well in the context of executing on a live
            connection as well as that of generating a SQL script.   In the
            case of a SQL script, the values are rendered inline into the
            statement.

            e.g.::

                from alembic import op
                from datetime import date
                from sqlalchemy.sql import table, column
                from sqlalchemy import String, Integer, Date

                # Create an ad-hoc table to use for the insert statement.
                accounts_table = table(
                    "account",
                    column("id", Integer),
                    column("name", String),
                    column("create_date", Date),
                )

                op.bulk_insert(
                    accounts_table,
                    [
                        {
                            "id": 1,
                            "name": "John Smith",
                            "create_date": date(2010, 10, 5),
                        },
                        {
                            "id": 2,
                            "name": "Ed Williams",
                            "create_date": date(2007, 5, 27),
                        },
                        {
                            "id": 3,
                            "name": "Wendy Jones",
                            "create_date": date(2008, 8, 15),
                        },
                    ],
                )

            When using --sql mode, some datatypes may not render inline
            automatically, such as dates and other special types.   When this
            issue is present, :meth:`.Operations.inline_literal` may be used::

                op.bulk_insert(
                    accounts_table,
                    [
                        {
                            "id": 1,
                            "name": "John Smith",
                            "create_date": op.inline_literal("2010-10-05"),
                        },
                        {
                            "id": 2,
                            "name": "Ed Williams",
                            "create_date": op.inline_literal("2007-05-27"),
                        },
                        {
                            "id": 3,
                            "name": "Wendy Jones",
                            "create_date": op.inline_literal("2008-08-15"),
                        },
                    ],
                    multiinsert=False,
                )

            When using :meth:`.Operations.inline_literal` in conjunction with
            :meth:`.Operations.bulk_insert`, in order for the statement to work
            in "online" (e.g. non --sql) mode, the
            :paramref:`~.Operations.bulk_insert.multiinsert`
            flag should be set to ``False``, which will have the effect of
            individual INSERT statements being emitted to the database, each
            with a distinct VALUES clause, so that the "inline" values can
            still be rendered, rather than attempting to pass the values
            as bound parameters.

            :param table: a table object which represents the target of the INSERT.

            :param rows: a list of dictionaries indicating rows.

            :param multiinsert: when at its default of True and --sql mode is not
               enabled, the INSERT statement will be executed using
               "executemany()" style, where all elements in the list of
               dictionaries are passed as bound parameters in a single
               list.   Setting this to False results in individual INSERT
               statements being emitted per parameter set, and is needed
               in those cases where non-literal values are present in the
               parameter sets.

            """  # noqa: E501
            ...

        def create_check_constraint(
            self,
            constraint_name: Optional[str],
            table_name: str,
            condition: Union[str, ColumnElement[bool], TextClause],
            *,
            schema: Optional[str] = None,
            **kw: Any,
        ) -> None:
            """Issue a "create check constraint" instruction using the
            current migration context.

            e.g.::

                from alembic import op
                from sqlalchemy.sql import column, func

                op.create_check_constraint(
                    "ck_user_name_len",
                    "user",
                    func.len(column("name")) > 5,
                )

            CHECK constraints are usually against a SQL expression, so ad-hoc
            table metadata is usually needed.   The function will convert the given
            arguments into a :class:`sqlalchemy.schema.CheckConstraint` bound
            to an anonymous table in order to emit the CREATE statement.

            :param name: Name of the check constraint.  The name is necessary
             so that an ALTER statement can be emitted.  For setups that
             use an automated naming scheme such as that described at
             :ref:`sqla:constraint_naming_conventions`,
             ``name`` here can be ``None``, as the event listener will
             apply the name to the constraint object when it is associated
             with the table.
            :param table_name: String name of the source table.
            :param condition: SQL expression that's the condition of the
             constraint. Can be a string or SQLAlchemy expression language
             structure.
            :param deferrable: optional bool. If set, emit DEFERRABLE or
             NOT DEFERRABLE when issuing DDL for this constraint.
            :param initially: optional string. If set, emit INITIALLY <value>
             when issuing DDL for this constraint.
            :param schema: Optional schema name to operate within.  To control
             quoting of the schema outside of the default behavior, use
             the SQLAlchemy construct
             :class:`~sqlalchemy.sql.elements.quoted_name`.

            """  # noqa: E501
            ...

        def create_exclude_constraint(
            self,
            constraint_name: str,
            table_name: str,
            *elements: Any,
            **kw: Any,
        ) -> Optional[Table]:
            """Issue an alter to create an EXCLUDE constraint using the
            current migration context.

            .. note::  This method is Postgresql specific, and additionally
               requires at least SQLAlchemy 1.0.

            e.g.::

                from alembic import op

                op.create_exclude_constraint(
                    "user_excl",
                    "user",
                    ("period", "&&"),
                    ("group", "="),
                    where=("group != 'some group'"),
                )

            Note that the expressions work the same way as that of
            the ``ExcludeConstraint`` object itself; if plain strings are
            passed, quoting rules must be applied manually.

            :param name: Name of the constraint.
            :param table_name: String name of the source table.
            :param elements: exclude conditions.
            :param where: SQL expression or SQL string with optional WHERE
             clause.
            :param deferrable: optional bool. If set, emit DEFERRABLE or
             NOT DEFERRABLE when issuing DDL for this constraint.
            :param initially: optional string. If set, emit INITIALLY <value>
             when issuing DDL for this constraint.
            :param schema: Optional schema name to operate within.

            """  # noqa: E501
            ...

        def create_foreign_key(
            self,
            constraint_name: Optional[str],
            source_table: str,
            referent_table: str,
            local_cols: List[str],
            remote_cols: List[str],
            *,
            onupdate: Optional[str] = None,
            ondelete: Optional[str] = None,
            deferrable: Optional[bool] = None,
            initially: Optional[str] = None,
            match: Optional[str] = None,
            source_schema: Optional[str] = None,
            referent_schema: Optional[str] = None,
            **dialect_kw: Any,
        ) -> None:
            """Issue a "create foreign key" instruction using the
            current migration context.

            e.g.::

                from alembic import op

                op.create_foreign_key(
                    "fk_user_address",
                    "address",
                    "user",
                    ["user_id"],
                    ["id"],
                )

            This internally generates a :class:`~sqlalchemy.schema.Table` object
            containing the necessary columns, then generates a new
            :class:`~sqlalchemy.schema.ForeignKeyConstraint`
            object which it then associates with the
            :class:`~sqlalchemy.schema.Table`.
            Any event listeners associated with this action will be fired
            off normally.   The :class:`~sqlalchemy.schema.AddConstraint`
            construct is ultimately used to generate the ALTER statement.

            :param constraint_name: Name of the foreign key constraint.  The name
             is necessary so that an ALTER statement can be emitted.  For setups
             that use an automated naming scheme such as that described at
             :ref:`sqla:constraint_naming_conventions`,
             ``name`` here can be ``None``, as the event listener will
             apply the name to the constraint object when it is associated
             with the table.
            :param source_table: String name of the source table.
            :param referent_table: String name of the destination table.
            :param local_cols: a list of string column names in the
             source table.
            :param remote_cols: a list of string column names in the
             remote table.
            :param onupdate: Optional string. If set, emit ON UPDATE <value> when
             issuing DDL for this constraint. Typical values include CASCADE,
             DELETE and RESTRICT.
            :param ondelete: Optional string. If set, emit ON DELETE <value> when
             issuing DDL for this constraint. Typical values include CASCADE,
             DELETE and RESTRICT.
            :param deferrable: optional bool. If set, emit DEFERRABLE or NOT
             DEFERRABLE when issuing DDL for this constraint.
            :param source_schema: Optional schema name of the source table.
            :param referent_schema: Optional schema name of the destination table.

            """  # noqa: E501
            ...

        def create_index(
            self,
            index_name: Optional[str],
            table_name: str,
            columns: Sequence[Union[str, TextClause, Function[Any]]],
            *,
            schema: Optional[str] = None,
            unique: bool = False,
            if_not_exists: Optional[bool] = None,
            **kw: Any,
        ) -> None:
            r"""Issue a "create index" instruction using the current
            migration context.

            e.g.::

                from alembic import op

                op.create_index("ik_test", "t1", ["foo", "bar"])

            Functional indexes can be produced by using the
            :func:`sqlalchemy.sql.expression.text` construct::

                from alembic import op
                from sqlalchemy import text

                op.create_index("ik_test", "t1", [text("lower(foo)")])

            :param index_name: name of the index.
            :param table_name: name of the owning table.
            :param columns: a list consisting of string column names and/or
             :func:`~sqlalchemy.sql.expression.text` constructs.
            :param schema: Optional schema name to operate within.  To control
             quoting of the schema outside of the default behavior, use
             the SQLAlchemy construct
             :class:`~sqlalchemy.sql.elements.quoted_name`.
            :param unique: If True, create a unique index.

            :param quote: Force quoting of this column's name on or off,
             corresponding to ``True`` or ``False``. When left at its default
             of ``None``, the column identifier will be quoted according to
             whether the name is case sensitive (identifiers with at least one
             upper case character are treated as case sensitive), or if it's a
             reserved word. This flag is only needed to force quoting of a
             reserved word which is not known by the SQLAlchemy dialect.

            :param if_not_exists: If True, adds IF NOT EXISTS operator when
             creating the new index.

             .. versionadded:: 1.12.0

            :param \**kw: Additional keyword arguments not mentioned above are
             dialect specific, and passed in the form
             ``<dialectname>_<argname>``.
             See the documentation regarding an individual dialect at
             :ref:`dialect_toplevel` for detail on documented arguments.

            """  # noqa: E501
            ...

        def create_primary_key(
            self,
            constraint_name: Optional[str],
            table_name: str,
            columns: List[str],
            *,
            schema: Optional[str] = None,
        ) -> None:
            """Issue a "create primary key" instruction using the current
            migration context.

            e.g.::

                from alembic import op

                op.create_primary_key("pk_my_table", "my_table", ["id", "version"])

            This internally generates a :class:`~sqlalchemy.schema.Table` object
            containing the necessary columns, then generates a new
            :class:`~sqlalchemy.schema.PrimaryKeyConstraint`
            object which it then associates with the
            :class:`~sqlalchemy.schema.Table`.
            Any event listeners associated with this action will be fired
            off normally.   The :class:`~sqlalchemy.schema.AddConstraint`
            construct is ultimately used to generate the ALTER statement.

            :param constraint_name: Name of the primary key constraint.  The name
             is necessary so that an ALTER statement can be emitted.  For setups
             that use an automated naming scheme such as that described at
             :ref:`sqla:constraint_naming_conventions`
             ``name`` here can be ``None``, as the event listener will
             apply the name to the constraint object when it is associated
             with the table.
            :param table_name: String name of the target table.
            :param columns: a list of string column names to be applied to the
             primary key constraint.
            :param schema: Optional schema name to operate within.  To control
             quoting of the schema outside of the default behavior, use
             the SQLAlchemy construct
             :class:`~sqlalchemy.sql.elements.quoted_name`.

            """  # noqa: E501
            ...

        def create_table(
            self, table_name: str, *columns: SchemaItem, **kw: Any
        ) -> Table:
            r"""Issue a "create table" instruction using the current migration
            context.

            This directive receives an argument list similar to that of the
            traditional :class:`sqlalchemy.schema.Table` construct, but without the
            metadata::

                from sqlalchemy import INTEGER, VARCHAR, NVARCHAR, Column
                from alembic import op

                op.create_table(
                    "account",
                    Column("id", INTEGER, primary_key=True),
                    Column("name", VARCHAR(50), nullable=False),
                    Column("description", NVARCHAR(200)),
                    Column("timestamp", TIMESTAMP, server_default=func.now()),
                )

            Note that :meth:`.create_table` accepts
            :class:`~sqlalchemy.schema.Column`
            constructs directly from the SQLAlchemy library.  In particular,
            default values to be created on the database side are
            specified using the ``server_default`` parameter, and not
            ``default`` which only specifies Python-side defaults::

                from alembic import op
                from sqlalchemy import Column, TIMESTAMP, func

                # specify "DEFAULT NOW" along with the "timestamp" column
                op.create_table(
                    "account",
                    Column("id", INTEGER, primary_key=True),
                    Column("timestamp", TIMESTAMP, server_default=func.now()),
                )

            The function also returns a newly created
            :class:`~sqlalchemy.schema.Table` object, corresponding to the table
            specification given, which is suitable for
            immediate SQL operations, in particular
            :meth:`.Operations.bulk_insert`::

                from sqlalchemy import INTEGER, VARCHAR, NVARCHAR, Column
                from alembic import op

                account_table = op.create_table(
                    "account",
                    Column("id", INTEGER, primary_key=True),
                    Column("name", VARCHAR(50), nullable=False),
                    Column("description", NVARCHAR(200)),
                    Column("timestamp", TIMESTAMP, server_default=func.now()),
                )

                op.bulk_insert(
                    account_table,
                    [
                        {"name": "A1", "description": "account 1"},
                        {"name": "A2", "description": "account 2"},
                    ],
                )

            :param table_name: Name of the table
            :param \*columns: collection of :class:`~sqlalchemy.schema.Column`
             objects within
             the table, as well as optional :class:`~sqlalchemy.schema.Constraint`
             objects
             and :class:`~.sqlalchemy.schema.Index` objects.
            :param schema: Optional schema name to operate within.  To control
             quoting of the schema outside of the default behavior, use
             the SQLAlchemy construct
             :class:`~sqlalchemy.sql.elements.quoted_name`.
            :param \**kw: Other keyword arguments are passed to the underlying
             :class:`sqlalchemy.schema.Table` object created for the command.

            :return: the :class:`~sqlalchemy.schema.Table` object corresponding
             to the parameters given.

            """  # noqa: E501
            ...

        def create_table_comment(
            self,
            table_name: str,
            comment: Optional[str],
            *,
            existing_comment: Optional[str] = None,
            schema: Optional[str] = None,
        ) -> None:
            """Emit a COMMENT ON operation to set the comment for a table.

            :param table_name: string name of the target table.
            :param comment: string value of the comment being registered against
             the specified table.
            :param existing_comment: String value of a comment
             already registered on the specified table, used within autogenerate
             so that the operation is reversible, but not required for direct
             use.

            .. seealso::

                :meth:`.Operations.drop_table_comment`

                :paramref:`.Operations.alter_column.comment`

            """  # noqa: E501
            ...

        def create_unique_constraint(
            self,
            constraint_name: Optional[str],
            table_name: str,
            columns: Sequence[str],
            *,
            schema: Optional[str] = None,
            **kw: Any,
        ) -> Any:
            """Issue a "create unique constraint" instruction using the
            current migration context.

            e.g.::

                from alembic import op
                op.create_unique_constraint("uq_user_name", "user", ["name"])

            This internally generates a :class:`~sqlalchemy.schema.Table` object
            containing the necessary columns, then generates a new
            :class:`~sqlalchemy.schema.UniqueConstraint`
            object which it then associates with the
            :class:`~sqlalchemy.schema.Table`.
            Any event listeners associated with this action will be fired
            off normally.   The :class:`~sqlalchemy.schema.AddConstraint`
            construct is ultimately used to generate the ALTER statement.

            :param name: Name of the unique constraint.  The name is necessary
             so that an ALTER statement can be emitted.  For setups that
             use an automated naming scheme such as that described at
             :ref:`sqla:constraint_naming_conventions`,
             ``name`` here can be ``None``, as the event listener will
             apply the name to the constraint object when it is associated
             with the table.
            :param table_name: String name of the source table.
            :param columns: a list of string column names in the
             source table.
            :param deferrable: optional bool. If set, emit DEFERRABLE or
             NOT DEFERRABLE when issuing DDL for this constraint.
            :param initially: optional string. If set, emit INITIALLY <value>
             when issuing DDL for this constraint.
            :param schema: Optional schema name to operate within.  To control
             quoting of the schema outside of the default behavior, use
             the SQLAlchemy construct
             :class:`~sqlalchemy.sql.elements.quoted_name`.

            """  # noqa: E501
            ...

        def drop_column(
            self,
            table_name: str,
            column_name: str,
            *,
            schema: Optional[str] = None,
            **kw: Any,
        ) -> None:
            """Issue a "drop column" instruction using the current
            migration context.

            e.g.::

                drop_column("organization", "account_id")

            :param table_name: name of table
            :param column_name: name of column
            :param schema: Optional schema name to operate within.  To control
             quoting of the schema outside of the default behavior, use
             the SQLAlchemy construct
             :class:`~sqlalchemy.sql.elements.quoted_name`.
            :param mssql_drop_check: Optional boolean.  When ``True``, on
             Microsoft SQL Server only, first
             drop the CHECK constraint on the column using a
             SQL-script-compatible
             block that selects into a @variable from sys.check_constraints,
             then exec's a separate DROP CONSTRAINT for that constraint.
            :param mssql_drop_default: Optional boolean.  When ``True``, on
             Microsoft SQL Server only, first
             drop the DEFAULT constraint on the column using a
             SQL-script-compatible
             block that selects into a @variable from sys.default_constraints,
             then exec's a separate DROP CONSTRAINT for that default.
            :param mssql_drop_foreign_key: Optional boolean.  When ``True``, on
             Microsoft SQL Server only, first
             drop a single FOREIGN KEY constraint on the column using a
             SQL-script-compatible
             block that selects into a @variable from
             sys.foreign_keys/sys.foreign_key_columns,
             then exec's a separate DROP CONSTRAINT for that default.  Only
             works if the column has exactly one FK constraint which refers to
             it, at the moment.

            """  # noqa: E501
            ...

        def drop_constraint(
            self,
            constraint_name: str,
            table_name: str,
            type_: Optional[str] = None,
            *,
            schema: Optional[str] = None,
        ) -> None:
            r"""Drop a constraint of the given name, typically via DROP CONSTRAINT.

            :param constraint_name: name of the constraint.
            :param table_name: table name.
            :param type\_: optional, required on MySQL.  can be
             'foreignkey', 'primary', 'unique', or 'check'.
            :param schema: Optional schema name to operate within.  To control
             quoting of the schema outside of the default behavior, use
             the SQLAlchemy construct
             :class:`~sqlalchemy.sql.elements.quoted_name`.

            """  # noqa: E501
            ...

        def drop_index(
            self,
            index_name: str,
            table_name: Optional[str] = None,
            *,
            schema: Optional[str] = None,
            if_exists: Optional[bool] = None,
            **kw: Any,
        ) -> None:
            r"""Issue a "drop index" instruction using the current
            migration context.

            e.g.::

                drop_index("accounts")

            :param index_name: name of the index.
            :param table_name: name of the owning table.  Some
             backends such as Microsoft SQL Server require this.
            :param schema: Optional schema name to operate within.  To control
             quoting of the schema outside of the default behavior, use
             the SQLAlchemy construct
             :class:`~sqlalchemy.sql.elements.quoted_name`.

            :param if_exists: If True, adds IF EXISTS operator when
             dropping the index.

             .. versionadded:: 1.12.0

            :param \**kw: Additional keyword arguments not mentioned above are
             dialect specific, and passed in the form
             ``<dialectname>_<argname>``.
             See the documentation regarding an individual dialect at
             :ref:`dialect_toplevel` for detail on documented arguments.

            """  # noqa: E501
            ...

        def drop_table(
            self, table_name: str, *, schema: Optional[str] = None, **kw: Any
        ) -> None:
            r"""Issue a "drop table" instruction using the current
            migration context.


            e.g.::

                drop_table("accounts")

            :param table_name: Name of the table
            :param schema: Optional schema name to operate within.  To control
             quoting of the schema outside of the default behavior, use
             the SQLAlchemy construct
             :class:`~sqlalchemy.sql.elements.quoted_name`.
            :param \**kw: Other keyword arguments are passed to the underlying
             :class:`sqlalchemy.schema.Table` object created for the command.

            """  # noqa: E501
            ...

        def drop_table_comment(
            self,
            table_name: str,
            *,
            existing_comment: Optional[str] = None,
            schema: Optional[str] = None,
        ) -> None:
            """Issue a "drop table comment" operation to
            remove an existing comment set on a table.

            :param table_name: string name of the target table.
            :param existing_comment: An optional string value of a comment already
             registered on the specified table.

            .. seealso::

                :meth:`.Operations.create_table_comment`

                :paramref:`.Operations.alter_column.comment`

            """  # noqa: E501
            ...

        def execute(
            self,
            sqltext: Union[Executable, str],
            *,
            execution_options: Optional[dict[str, Any]] = None,
        ) -> None:
            r"""Execute the given SQL using the current migration context.

            The given SQL can be a plain string, e.g.::

                op.execute("INSERT INTO table (foo) VALUES ('some value')")

            Or it can be any kind of Core SQL Expression construct, such as
            below where we use an update construct::

                from sqlalchemy.sql import table, column
                from sqlalchemy import String
                from alembic import op

                account = table("account", column("name", String))
                op.execute(
                    account.update()
                    .where(account.c.name == op.inline_literal("account 1"))
                    .values({"name": op.inline_literal("account 2")})
                )

            Above, we made use of the SQLAlchemy
            :func:`sqlalchemy.sql.expression.table` and
            :func:`sqlalchemy.sql.expression.column` constructs to make a brief,
            ad-hoc table construct just for our UPDATE statement.  A full
            :class:`~sqlalchemy.schema.Table` construct of course works perfectly
            fine as well, though note it's a recommended practice to at least
            ensure the definition of a table is self-contained within the migration
            script, rather than imported from a module that may break compatibility
            with older migrations.

            In a SQL script context, the statement is emitted directly to the
            output stream.   There is *no* return result, however, as this
            function is oriented towards generating a change script
            that can run in "offline" mode.     Additionally, parameterized
            statements are discouraged here, as they *will not work* in offline
            mode.  Above, we use :meth:`.inline_literal` where parameters are
            to be used.

            For full interaction with a connected database where parameters can
            also be used normally, use the "bind" available from the context::

                from alembic import op

                connection = op.get_bind()

                connection.execute(
                    account.update()
                    .where(account.c.name == "account 1")
                    .values({"name": "account 2"})
                )

            Additionally, when passing the statement as a plain string, it is first
            coerced into a :func:`sqlalchemy.sql.expression.text` construct
            before being passed along.  In the less likely case that the
            literal SQL string contains a colon, it must be escaped with a
            backslash, as::

               op.execute(r"INSERT INTO table (foo) VALUES ('\:colon_value')")


            :param sqltext: Any legal SQLAlchemy expression, including:

            * a string
            * a :func:`sqlalchemy.sql.expression.text` construct.
            * a :func:`sqlalchemy.sql.expression.insert` construct.
            * a :func:`sqlalchemy.sql.expression.update` construct.
            * a :func:`sqlalchemy.sql.expression.delete` construct.
            * Any "executable" described in SQLAlchemy Core documentation,
              noting that no result set is returned.

            .. note::  when passing a plain string, the statement is coerced into
               a :func:`sqlalchemy.sql.expression.text` construct. This construct
               considers symbols with colons, e.g. ``:foo`` to be bound parameters.
               To avoid this, ensure that colon symbols are escaped, e.g.
               ``\:foo``.

            :param execution_options: Optional dictionary of
             execution options, will be passed to
             :meth:`sqlalchemy.engine.Connection.execution_options`.
            """  # noqa: E501
            ...

        def rename_table(
            self,
            old_table_name: str,
            new_table_name: str,
            *,
            schema: Optional[str] = None,
        ) -> None:
            """Emit an ALTER TABLE to rename a table.

            :param old_table_name: old name.
            :param new_table_name: new name.
            :param schema: Optional schema name to operate within.  To control
             quoting of the schema outside of the default behavior, use
             the SQLAlchemy construct
             :class:`~sqlalchemy.sql.elements.quoted_name`.

            """  # noqa: E501
            ...

        # END STUB FUNCTIONS: op_cls


class BatchOperations(AbstractOperations):
    """Modifies the interface :class:`.Operations` for batch mode.

    This basically omits the ``table_name`` and ``schema`` parameters
    from associated methods, as these are a given when running under batch
    mode.

    .. seealso::

        :meth:`.Operations.batch_alter_table`

    Note that as of 0.8, most of the methods on this class are produced
    dynamically using the :meth:`.Operations.register_operation`
    method.

    """

    impl: BatchOperationsImpl

    def _noop(self, operation: Any) -> NoReturn:
        raise NotImplementedError(
            "The %s method does not apply to a batch table alter operation."
            % operation
        )

    if TYPE_CHECKING:
        # START STUB FUNCTIONS: batch_op
        # ### the following stubs are generated by tools/write_pyi.py ###
        # ### do not edit ###

        def add_column(
            self,
            column: Column[Any],
            *,
            insert_before: Optional[str] = None,
            insert_after: Optional[str] = None,
        ) -> None:
            """Issue an "add column" instruction using the current
            batch migration context.

            .. seealso::

                :meth:`.Operations.add_column`

            """  # noqa: E501
            ...

        def alter_column(
            self,
            column_name: str,
            *,
            nullable: Optional[bool] = None,
            comment: Union[str, Literal[False], None] = False,
            server_default: Any = False,
            new_column_name: Optional[str] = None,
            type_: Union[TypeEngine[Any], Type[TypeEngine[Any]], None] = None,
            existing_type: Union[
                TypeEngine[Any], Type[TypeEngine[Any]], None
            ] = None,
            existing_server_default: Union[
                str, bool, Identity, Computed, None
            ] = False,
            existing_nullable: Optional[bool] = None,
            existing_comment: Optional[str] = None,
            insert_before: Optional[str] = None,
            insert_after: Optional[str] = None,
            **kw: Any,
        ) -> None:
            """Issue an "alter column" instruction using the current
            batch migration context.

            Parameters are the same as that of :meth:`.Operations.alter_column`,
            as well as the following option(s):

            :param insert_before: String name of an existing column which this
             column should be placed before, when creating the new table.

            :param insert_after: String name of an existing column which this
             column should be placed after, when creating the new table.  If
             both :paramref:`.BatchOperations.alter_column.insert_before`
             and :paramref:`.BatchOperations.alter_column.insert_after` are
             omitted, the column is inserted after the last existing column
             in the table.

            .. seealso::

                :meth:`.Operations.alter_column`


            """  # noqa: E501
            ...

        def create_check_constraint(
            self,
            constraint_name: str,
            condition: Union[str, ColumnElement[bool], TextClause],
            **kw: Any,
        ) -> None:
            """Issue a "create check constraint" instruction using the
            current batch migration context.

            The batch form of this call omits the ``source`` and ``schema``
            arguments from the call.

            .. seealso::

                :meth:`.Operations.create_check_constraint`

            """  # noqa: E501
            ...

        def create_exclude_constraint(
            self, constraint_name: str, *elements: Any, **kw: Any
        ) -> Optional[Table]:
            """Issue a "create exclude constraint" instruction using the
            current batch migration context.

            .. note::  This method is Postgresql specific, and additionally
               requires at least SQLAlchemy 1.0.

            .. seealso::

                :meth:`.Operations.create_exclude_constraint`

            """  # noqa: E501
            ...

        def create_foreign_key(
            self,
            constraint_name: str,
            referent_table: str,
            local_cols: List[str],
            remote_cols: List[str],
            *,
            referent_schema: Optional[str] = None,
            onupdate: Optional[str] = None,
            ondelete: Optional[str] = None,
            deferrable: Optional[bool] = None,
            initially: Optional[str] = None,
            match: Optional[str] = None,
            **dialect_kw: Any,
        ) -> None:
            """Issue a "create foreign key" instruction using the
            current batch migration context.

            The batch form of this call omits the ``source`` and ``source_schema``
            arguments from the call.

            e.g.::

                with batch_alter_table("address") as batch_op:
                    batch_op.create_foreign_key(
                        "fk_user_address",
                        "user",
                        ["user_id"],
                        ["id"],
                    )

            .. seealso::

                :meth:`.Operations.create_foreign_key`

            """  # noqa: E501
            ...

        def create_index(
            self, index_name: str, columns: List[str], **kw: Any
        ) -> None:
            """Issue a "create index" instruction using the
            current batch migration context.

            .. seealso::

                :meth:`.Operations.create_index`

            """  # noqa: E501
            ...

        def create_primary_key(
            self, constraint_name: str, columns: List[str]
        ) -> None:
            """Issue a "create primary key" instruction using the
            current batch migration context.

            The batch form of this call omits the ``table_name`` and ``schema``
            arguments from the call.

            .. seealso::

                :meth:`.Operations.create_primary_key`

            """  # noqa: E501
            ...

        def create_table_comment(
            self,
            comment: Optional[str],
            *,
            existing_comment: Optional[str] = None,
        ) -> None:
            """Emit a COMMENT ON operation to set the comment for a table
            using the current batch migration context.

            :param comment: string value of the comment being registered against
             the specified table.
            :param existing_comment: String value of a comment
             already registered on the specified table, used within autogenerate
             so that the operation is reversible, but not required for direct
             use.

            """  # noqa: E501
            ...

        def create_unique_constraint(
            self, constraint_name: str, columns: Sequence[str], **kw: Any
        ) -> Any:
            """Issue a "create unique constraint" instruction using the
            current batch migration context.

            The batch form of this call omits the ``source`` and ``schema``
            arguments from the call.

            .. seealso::

                :meth:`.Operations.create_unique_constraint`

            """  # noqa: E501
            ...

        def drop_column(self, column_name: str, **kw: Any) -> None:
            """Issue a "drop column" instruction using the current
            batch migration context.

            .. seealso::

                :meth:`.Operations.drop_column`

            """  # noqa: E501
            ...

        def drop_constraint(
            self, constraint_name: str, type_: Optional[str] = None
        ) -> None:
            """Issue a "drop constraint" instruction using the
            current batch migration context.

            The batch form of this call omits the ``table_name`` and ``schema``
            arguments from the call.

            .. seealso::

                :meth:`.Operations.drop_constraint`

            """  # noqa: E501
            ...

        def drop_index(self, index_name: str, **kw: Any) -> None:
            """Issue a "drop index" instruction using the
            current batch migration context.

            .. seealso::

                :meth:`.Operations.drop_index`

            """  # noqa: E501
            ...

        def drop_table_comment(
            self, *, existing_comment: Optional[str] = None
        ) -> None:
            """Issue a "drop table comment" operation to
            remove an existing comment set on a table using the current
            batch operations context.

            :param existing_comment: An optional string value of a comment already
             registered on the specified table.

            """  # noqa: E501
            ...

        def execute(
            self,
            sqltext: Union[Executable, str],
            *,
            execution_options: Optional[dict[str, Any]] = None,
        ) -> None:
            """Execute the given SQL using the current migration context.

            .. seealso::

                :meth:`.Operations.execute`

            """  # noqa: E501
            ...

        # END STUB FUNCTIONS: batch_op
