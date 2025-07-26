# sql/ddl.py
# Copyright (C) 2009-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

"""
Provides the hierarchy of DDL-defining schema items as well as routines
to invoke them for a create/drop call.

"""
from __future__ import annotations

import contextlib
import typing
from typing import Any
from typing import Callable
from typing import Iterable
from typing import List
from typing import Optional
from typing import Sequence as typing_Sequence
from typing import Tuple

from . import roles
from .base import _generative
from .base import Executable
from .base import SchemaVisitor
from .elements import ClauseElement
from .. import exc
from .. import util
from ..util import topological
from ..util.typing import Protocol
from ..util.typing import Self

if typing.TYPE_CHECKING:
    from .compiler import Compiled
    from .compiler import DDLCompiler
    from .elements import BindParameter
    from .schema import Constraint
    from .schema import ForeignKeyConstraint
    from .schema import SchemaItem
    from .schema import Sequence
    from .schema import Table
    from .selectable import TableClause
    from ..engine.base import Connection
    from ..engine.interfaces import CacheStats
    from ..engine.interfaces import CompiledCacheType
    from ..engine.interfaces import Dialect
    from ..engine.interfaces import SchemaTranslateMapType


class BaseDDLElement(ClauseElement):
    """The root of DDL constructs, including those that are sub-elements
    within the "create table" and other processes.

    .. versionadded:: 2.0

    """

    _hierarchy_supports_caching = False
    """disable cache warnings for all _DDLCompiles subclasses. """

    def _compiler(self, dialect, **kw):
        """Return a compiler appropriate for this ClauseElement, given a
        Dialect."""

        return dialect.ddl_compiler(dialect, self, **kw)

    def _compile_w_cache(
        self,
        dialect: Dialect,
        *,
        compiled_cache: Optional[CompiledCacheType],
        column_keys: List[str],
        for_executemany: bool = False,
        schema_translate_map: Optional[SchemaTranslateMapType] = None,
        **kw: Any,
    ) -> Tuple[
        Compiled, Optional[typing_Sequence[BindParameter[Any]]], CacheStats
    ]:
        raise NotImplementedError()


class DDLIfCallable(Protocol):
    def __call__(
        self,
        ddl: BaseDDLElement,
        target: SchemaItem,
        bind: Optional[Connection],
        tables: Optional[List[Table]] = None,
        state: Optional[Any] = None,
        *,
        dialect: Dialect,
        compiler: Optional[DDLCompiler] = ...,
        checkfirst: bool,
    ) -> bool:
        ...


class DDLIf(typing.NamedTuple):
    dialect: Optional[str]
    callable_: Optional[DDLIfCallable]
    state: Optional[Any]

    def _should_execute(
        self,
        ddl: BaseDDLElement,
        target: SchemaItem,
        bind: Optional[Connection],
        compiler: Optional[DDLCompiler] = None,
        **kw: Any,
    ) -> bool:
        if bind is not None:
            dialect = bind.dialect
        elif compiler is not None:
            dialect = compiler.dialect
        else:
            assert False, "compiler or dialect is required"

        if isinstance(self.dialect, str):
            if self.dialect != dialect.name:
                return False
        elif isinstance(self.dialect, (tuple, list, set)):
            if dialect.name not in self.dialect:
                return False
        if self.callable_ is not None and not self.callable_(
            ddl,
            target,
            bind,
            state=self.state,
            dialect=dialect,
            compiler=compiler,
            **kw,
        ):
            return False

        return True


class ExecutableDDLElement(roles.DDLRole, Executable, BaseDDLElement):
    """Base class for standalone executable DDL expression constructs.

    This class is the base for the general purpose :class:`.DDL` class,
    as well as the various create/drop clause constructs such as
    :class:`.CreateTable`, :class:`.DropTable`, :class:`.AddConstraint`,
    etc.

    .. versionchanged:: 2.0  :class:`.ExecutableDDLElement` is renamed from
       :class:`.DDLElement`, which still exists for backwards compatibility.

    :class:`.ExecutableDDLElement` integrates closely with SQLAlchemy events,
    introduced in :ref:`event_toplevel`.  An instance of one is
    itself an event receiving callable::

        event.listen(
            users,
            'after_create',
            AddConstraint(constraint).execute_if(dialect='postgresql')
        )

    .. seealso::

        :class:`.DDL`

        :class:`.DDLEvents`

        :ref:`event_toplevel`

        :ref:`schema_ddl_sequences`

    """

    _ddl_if: Optional[DDLIf] = None
    target: Optional[SchemaItem] = None

    def _execute_on_connection(
        self, connection, distilled_params, execution_options
    ):
        return connection._execute_ddl(
            self, distilled_params, execution_options
        )

    @_generative
    def against(self, target: SchemaItem) -> Self:
        """Return a copy of this :class:`_schema.ExecutableDDLElement` which
        will include the given target.

        This essentially applies the given item to the ``.target`` attribute of
        the returned :class:`_schema.ExecutableDDLElement` object. This target
        is then usable by event handlers and compilation routines in order to
        provide services such as tokenization of a DDL string in terms of a
        particular :class:`_schema.Table`.

        When a :class:`_schema.ExecutableDDLElement` object is established as
        an event handler for the :meth:`_events.DDLEvents.before_create` or
        :meth:`_events.DDLEvents.after_create` events, and the event then
        occurs for a given target such as a :class:`_schema.Constraint` or
        :class:`_schema.Table`, that target is established with a copy of the
        :class:`_schema.ExecutableDDLElement` object using this method, which
        then proceeds to the :meth:`_schema.ExecutableDDLElement.execute`
        method in order to invoke the actual DDL instruction.

        :param target: a :class:`_schema.SchemaItem` that will be the subject
         of a DDL operation.

        :return: a copy of this :class:`_schema.ExecutableDDLElement` with the
         ``.target`` attribute assigned to the given
         :class:`_schema.SchemaItem`.

        .. seealso::

            :class:`_schema.DDL` - uses tokenization against the "target" when
            processing the DDL string.

        """
        self.target = target
        return self

    @_generative
    def execute_if(
        self,
        dialect: Optional[str] = None,
        callable_: Optional[DDLIfCallable] = None,
        state: Optional[Any] = None,
    ) -> Self:
        r"""Return a callable that will execute this
        :class:`_ddl.ExecutableDDLElement` conditionally within an event
        handler.

        Used to provide a wrapper for event listening::

            event.listen(
                        metadata,
                        'before_create',
                        DDL("my_ddl").execute_if(dialect='postgresql')
                    )

        :param dialect: May be a string or tuple of strings.
          If a string, it will be compared to the name of the
          executing database dialect::

            DDL('something').execute_if(dialect='postgresql')

          If a tuple, specifies multiple dialect names::

            DDL('something').execute_if(dialect=('postgresql', 'mysql'))

        :param callable\_: A callable, which will be invoked with
          three positional arguments as well as optional keyword
          arguments:

            :ddl:
              This DDL element.

            :target:
              The :class:`_schema.Table` or :class:`_schema.MetaData`
              object which is the
              target of this event. May be None if the DDL is executed
              explicitly.

            :bind:
              The :class:`_engine.Connection` being used for DDL execution.
              May be None if this construct is being created inline within
              a table, in which case ``compiler`` will be present.

            :tables:
              Optional keyword argument - a list of Table objects which are to
              be created/ dropped within a MetaData.create_all() or drop_all()
              method call.

            :dialect: keyword argument, but always present - the
              :class:`.Dialect` involved in the operation.

            :compiler: keyword argument.  Will be ``None`` for an engine
              level DDL invocation, but will refer to a :class:`.DDLCompiler`
              if this DDL element is being created inline within a table.

            :state:
              Optional keyword argument - will be the ``state`` argument
              passed to this function.

            :checkfirst:
             Keyword argument, will be True if the 'checkfirst' flag was
             set during the call to ``create()``, ``create_all()``,
             ``drop()``, ``drop_all()``.

          If the callable returns a True value, the DDL statement will be
          executed.

        :param state: any value which will be passed to the callable\_
          as the ``state`` keyword argument.

        .. seealso::

            :meth:`.SchemaItem.ddl_if`

            :class:`.DDLEvents`

            :ref:`event_toplevel`

        """
        self._ddl_if = DDLIf(dialect, callable_, state)
        return self

    def _should_execute(self, target, bind, **kw):
        if self._ddl_if is None:
            return True
        else:
            return self._ddl_if._should_execute(self, target, bind, **kw)

    def _invoke_with(self, bind):
        if self._should_execute(self.target, bind):
            return bind.execute(self)

    def __call__(self, target, bind, **kw):
        """Execute the DDL as a ddl_listener."""

        self.against(target)._invoke_with(bind)

    def _generate(self):
        s = self.__class__.__new__(self.__class__)
        s.__dict__ = self.__dict__.copy()
        return s


DDLElement = ExecutableDDLElement
""":class:`.DDLElement` is renamed to :class:`.ExecutableDDLElement`."""


class DDL(ExecutableDDLElement):
    """A literal DDL statement.

    Specifies literal SQL DDL to be executed by the database.  DDL objects
    function as DDL event listeners, and can be subscribed to those events
    listed in :class:`.DDLEvents`, using either :class:`_schema.Table` or
    :class:`_schema.MetaData` objects as targets.
    Basic templating support allows
    a single DDL instance to handle repetitive tasks for multiple tables.

    Examples::

      from sqlalchemy import event, DDL

      tbl = Table('users', metadata, Column('uid', Integer))
      event.listen(tbl, 'before_create', DDL('DROP TRIGGER users_trigger'))

      spow = DDL('ALTER TABLE %(table)s SET secretpowers TRUE')
      event.listen(tbl, 'after_create', spow.execute_if(dialect='somedb'))

      drop_spow = DDL('ALTER TABLE users SET secretpowers FALSE')
      connection.execute(drop_spow)

    When operating on Table events, the following ``statement``
    string substitutions are available::

      %(table)s  - the Table name, with any required quoting applied
      %(schema)s - the schema name, with any required quoting applied
      %(fullname)s - the Table name including schema, quoted if needed

    The DDL's "context", if any, will be combined with the standard
    substitutions noted above.  Keys present in the context will override
    the standard substitutions.

    """

    __visit_name__ = "ddl"

    def __init__(self, statement, context=None):
        """Create a DDL statement.

        :param statement:
          A string or unicode string to be executed.  Statements will be
          processed with Python's string formatting operator using
          a fixed set of string substitutions, as well as additional
          substitutions provided by the optional :paramref:`.DDL.context`
          parameter.

          A literal '%' in a statement must be escaped as '%%'.

          SQL bind parameters are not available in DDL statements.

        :param context:
          Optional dictionary, defaults to None.  These values will be
          available for use in string substitutions on the DDL statement.

        .. seealso::

            :class:`.DDLEvents`

            :ref:`event_toplevel`

        """

        if not isinstance(statement, str):
            raise exc.ArgumentError(
                "Expected a string or unicode SQL statement, got '%r'"
                % statement
            )

        self.statement = statement
        self.context = context or {}

    def __repr__(self):
        parts = [repr(self.statement)]
        if self.context:
            parts.append(f"context={self.context}")

        return "<%s@%s; %s>" % (
            type(self).__name__,
            id(self),
            ", ".join(parts),
        )


class _CreateDropBase(ExecutableDDLElement):
    """Base class for DDL constructs that represent CREATE and DROP or
    equivalents.

    The common theme of _CreateDropBase is a single
    ``element`` attribute which refers to the element
    to be created or dropped.

    """

    def __init__(
        self,
        element,
    ):
        self.element = self.target = element
        self._ddl_if = getattr(element, "_ddl_if", None)

    @property
    def stringify_dialect(self):
        return self.element.create_drop_stringify_dialect

    def _create_rule_disable(self, compiler):
        """Allow disable of _create_rule using a callable.

        Pass to _create_rule using
        util.portable_instancemethod(self._create_rule_disable)
        to retain serializability.

        """
        return False


class _CreateBase(_CreateDropBase):
    def __init__(self, element, if_not_exists=False):
        super().__init__(element)
        self.if_not_exists = if_not_exists


class _DropBase(_CreateDropBase):
    def __init__(self, element, if_exists=False):
        super().__init__(element)
        self.if_exists = if_exists


class CreateSchema(_CreateBase):
    """Represent a CREATE SCHEMA statement.

    The argument here is the string name of the schema.

    """

    __visit_name__ = "create_schema"

    stringify_dialect = "default"

    def __init__(
        self,
        name,
        if_not_exists=False,
    ):
        """Create a new :class:`.CreateSchema` construct."""

        super().__init__(element=name, if_not_exists=if_not_exists)


class DropSchema(_DropBase):
    """Represent a DROP SCHEMA statement.

    The argument here is the string name of the schema.

    """

    __visit_name__ = "drop_schema"

    stringify_dialect = "default"

    def __init__(
        self,
        name,
        cascade=False,
        if_exists=False,
    ):
        """Create a new :class:`.DropSchema` construct."""

        super().__init__(element=name, if_exists=if_exists)
        self.cascade = cascade


class CreateTable(_CreateBase):
    """Represent a CREATE TABLE statement."""

    __visit_name__ = "create_table"

    def __init__(
        self,
        element: Table,
        include_foreign_key_constraints: Optional[
            typing_Sequence[ForeignKeyConstraint]
        ] = None,
        if_not_exists: bool = False,
    ):
        """Create a :class:`.CreateTable` construct.

        :param element: a :class:`_schema.Table` that's the subject
         of the CREATE
        :param on: See the description for 'on' in :class:`.DDL`.
        :param include_foreign_key_constraints: optional sequence of
         :class:`_schema.ForeignKeyConstraint` objects that will be included
         inline within the CREATE construct; if omitted, all foreign key
         constraints that do not specify use_alter=True are included.

        :param if_not_exists: if True, an IF NOT EXISTS operator will be
         applied to the construct.

         .. versionadded:: 1.4.0b2

        """
        super().__init__(element, if_not_exists=if_not_exists)
        self.columns = [CreateColumn(column) for column in element.columns]
        self.include_foreign_key_constraints = include_foreign_key_constraints


class _DropView(_DropBase):
    """Semi-public 'DROP VIEW' construct.

    Used by the test suite for dialect-agnostic drops of views.
    This object will eventually be part of a public "view" API.

    """

    __visit_name__ = "drop_view"


class CreateConstraint(BaseDDLElement):
    def __init__(self, element: Constraint):
        self.element = element


class CreateColumn(BaseDDLElement):
    """Represent a :class:`_schema.Column`
    as rendered in a CREATE TABLE statement,
    via the :class:`.CreateTable` construct.

    This is provided to support custom column DDL within the generation
    of CREATE TABLE statements, by using the
    compiler extension documented in :ref:`sqlalchemy.ext.compiler_toplevel`
    to extend :class:`.CreateColumn`.

    Typical integration is to examine the incoming :class:`_schema.Column`
    object, and to redirect compilation if a particular flag or condition
    is found::

        from sqlalchemy import schema
        from sqlalchemy.ext.compiler import compiles

        @compiles(schema.CreateColumn)
        def compile(element, compiler, **kw):
            column = element.element

            if "special" not in column.info:
                return compiler.visit_create_column(element, **kw)

            text = "%s SPECIAL DIRECTIVE %s" % (
                    column.name,
                    compiler.type_compiler.process(column.type)
                )
            default = compiler.get_column_default_string(column)
            if default is not None:
                text += " DEFAULT " + default

            if not column.nullable:
                text += " NOT NULL"

            if column.constraints:
                text += " ".join(
                            compiler.process(const)
                            for const in column.constraints)
            return text

    The above construct can be applied to a :class:`_schema.Table`
    as follows::

        from sqlalchemy import Table, Metadata, Column, Integer, String
        from sqlalchemy import schema

        metadata = MetaData()

        table = Table('mytable', MetaData(),
                Column('x', Integer, info={"special":True}, primary_key=True),
                Column('y', String(50)),
                Column('z', String(20), info={"special":True})
            )

        metadata.create_all(conn)

    Above, the directives we've added to the :attr:`_schema.Column.info`
    collection
    will be detected by our custom compilation scheme::

        CREATE TABLE mytable (
                x SPECIAL DIRECTIVE INTEGER NOT NULL,
                y VARCHAR(50),
                z SPECIAL DIRECTIVE VARCHAR(20),
            PRIMARY KEY (x)
        )

    The :class:`.CreateColumn` construct can also be used to skip certain
    columns when producing a ``CREATE TABLE``.  This is accomplished by
    creating a compilation rule that conditionally returns ``None``.
    This is essentially how to produce the same effect as using the
    ``system=True`` argument on :class:`_schema.Column`, which marks a column
    as an implicitly-present "system" column.

    For example, suppose we wish to produce a :class:`_schema.Table`
    which skips
    rendering of the PostgreSQL ``xmin`` column against the PostgreSQL
    backend, but on other backends does render it, in anticipation of a
    triggered rule.  A conditional compilation rule could skip this name only
    on PostgreSQL::

        from sqlalchemy.schema import CreateColumn

        @compiles(CreateColumn, "postgresql")
        def skip_xmin(element, compiler, **kw):
            if element.element.name == 'xmin':
                return None
            else:
                return compiler.visit_create_column(element, **kw)


        my_table = Table('mytable', metadata,
                    Column('id', Integer, primary_key=True),
                    Column('xmin', Integer)
                )

    Above, a :class:`.CreateTable` construct will generate a ``CREATE TABLE``
    which only includes the ``id`` column in the string; the ``xmin`` column
    will be omitted, but only against the PostgreSQL backend.

    """

    __visit_name__ = "create_column"

    def __init__(self, element):
        self.element = element


class DropTable(_DropBase):
    """Represent a DROP TABLE statement."""

    __visit_name__ = "drop_table"

    def __init__(self, element: Table, if_exists: bool = False):
        """Create a :class:`.DropTable` construct.

        :param element: a :class:`_schema.Table` that's the subject
         of the DROP.
        :param on: See the description for 'on' in :class:`.DDL`.
        :param if_exists: if True, an IF EXISTS operator will be applied to the
         construct.

         .. versionadded:: 1.4.0b2

        """
        super().__init__(element, if_exists=if_exists)


class CreateSequence(_CreateBase):
    """Represent a CREATE SEQUENCE statement."""

    __visit_name__ = "create_sequence"

    def __init__(self, element: Sequence, if_not_exists: bool = False):
        super().__init__(element, if_not_exists=if_not_exists)


class DropSequence(_DropBase):
    """Represent a DROP SEQUENCE statement."""

    __visit_name__ = "drop_sequence"

    def __init__(self, element: Sequence, if_exists: bool = False):
        super().__init__(element, if_exists=if_exists)


class CreateIndex(_CreateBase):
    """Represent a CREATE INDEX statement."""

    __visit_name__ = "create_index"

    def __init__(self, element, if_not_exists=False):
        """Create a :class:`.Createindex` construct.

        :param element: a :class:`_schema.Index` that's the subject
         of the CREATE.
        :param if_not_exists: if True, an IF NOT EXISTS operator will be
         applied to the construct.

         .. versionadded:: 1.4.0b2

        """
        super().__init__(element, if_not_exists=if_not_exists)


class DropIndex(_DropBase):
    """Represent a DROP INDEX statement."""

    __visit_name__ = "drop_index"

    def __init__(self, element, if_exists=False):
        """Create a :class:`.DropIndex` construct.

        :param element: a :class:`_schema.Index` that's the subject
         of the DROP.
        :param if_exists: if True, an IF EXISTS operator will be applied to the
         construct.

         .. versionadded:: 1.4.0b2

        """
        super().__init__(element, if_exists=if_exists)


class AddConstraint(_CreateBase):
    """Represent an ALTER TABLE ADD CONSTRAINT statement."""

    __visit_name__ = "add_constraint"

    def __init__(self, element):
        super().__init__(element)
        element._create_rule = util.portable_instancemethod(
            self._create_rule_disable
        )


class DropConstraint(_DropBase):
    """Represent an ALTER TABLE DROP CONSTRAINT statement."""

    __visit_name__ = "drop_constraint"

    def __init__(self, element, cascade=False, if_exists=False, **kw):
        self.cascade = cascade
        super().__init__(element, if_exists=if_exists, **kw)
        element._create_rule = util.portable_instancemethod(
            self._create_rule_disable
        )


class SetTableComment(_CreateDropBase):
    """Represent a COMMENT ON TABLE IS statement."""

    __visit_name__ = "set_table_comment"


class DropTableComment(_CreateDropBase):
    """Represent a COMMENT ON TABLE '' statement.

    Note this varies a lot across database backends.

    """

    __visit_name__ = "drop_table_comment"


class SetColumnComment(_CreateDropBase):
    """Represent a COMMENT ON COLUMN IS statement."""

    __visit_name__ = "set_column_comment"


class DropColumnComment(_CreateDropBase):
    """Represent a COMMENT ON COLUMN IS NULL statement."""

    __visit_name__ = "drop_column_comment"


class SetConstraintComment(_CreateDropBase):
    """Represent a COMMENT ON CONSTRAINT IS statement."""

    __visit_name__ = "set_constraint_comment"


class DropConstraintComment(_CreateDropBase):
    """Represent a COMMENT ON CONSTRAINT IS NULL statement."""

    __visit_name__ = "drop_constraint_comment"


class InvokeDDLBase(SchemaVisitor):
    def __init__(self, connection):
        self.connection = connection

    @contextlib.contextmanager
    def with_ddl_events(self, target, **kw):
        """helper context manager that will apply appropriate DDL events
        to a CREATE or DROP operation."""

        raise NotImplementedError()


class InvokeCreateDDLBase(InvokeDDLBase):
    @contextlib.contextmanager
    def with_ddl_events(self, target, **kw):
        """helper context manager that will apply appropriate DDL events
        to a CREATE or DROP operation."""

        target.dispatch.before_create(
            target, self.connection, _ddl_runner=self, **kw
        )
        yield
        target.dispatch.after_create(
            target, self.connection, _ddl_runner=self, **kw
        )


class InvokeDropDDLBase(InvokeDDLBase):
    @contextlib.contextmanager
    def with_ddl_events(self, target, **kw):
        """helper context manager that will apply appropriate DDL events
        to a CREATE or DROP operation."""

        target.dispatch.before_drop(
            target, self.connection, _ddl_runner=self, **kw
        )
        yield
        target.dispatch.after_drop(
            target, self.connection, _ddl_runner=self, **kw
        )


class SchemaGenerator(InvokeCreateDDLBase):
    def __init__(
        self, dialect, connection, checkfirst=False, tables=None, **kwargs
    ):
        super().__init__(connection, **kwargs)
        self.checkfirst = checkfirst
        self.tables = tables
        self.preparer = dialect.identifier_preparer
        self.dialect = dialect
        self.memo = {}

    def _can_create_table(self, table):
        self.dialect.validate_identifier(table.name)
        effective_schema = self.connection.schema_for_object(table)
        if effective_schema:
            self.dialect.validate_identifier(effective_schema)
        return not self.checkfirst or not self.dialect.has_table(
            self.connection, table.name, schema=effective_schema
        )

    def _can_create_index(self, index):
        effective_schema = self.connection.schema_for_object(index.table)
        if effective_schema:
            self.dialect.validate_identifier(effective_schema)
        return not self.checkfirst or not self.dialect.has_index(
            self.connection,
            index.table.name,
            index.name,
            schema=effective_schema,
        )

    def _can_create_sequence(self, sequence):
        effective_schema = self.connection.schema_for_object(sequence)

        return self.dialect.supports_sequences and (
            (not self.dialect.sequences_optional or not sequence.optional)
            and (
                not self.checkfirst
                or not self.dialect.has_sequence(
                    self.connection, sequence.name, schema=effective_schema
                )
            )
        )

    def visit_metadata(self, metadata):
        if self.tables is not None:
            tables = self.tables
        else:
            tables = list(metadata.tables.values())

        collection = sort_tables_and_constraints(
            [t for t in tables if self._can_create_table(t)]
        )

        seq_coll = [
            s
            for s in metadata._sequences.values()
            if s.column is None and self._can_create_sequence(s)
        ]

        event_collection = [t for (t, fks) in collection if t is not None]

        with self.with_ddl_events(
            metadata,
            tables=event_collection,
            checkfirst=self.checkfirst,
        ):
            for seq in seq_coll:
                self.traverse_single(seq, create_ok=True)

            for table, fkcs in collection:
                if table is not None:
                    self.traverse_single(
                        table,
                        create_ok=True,
                        include_foreign_key_constraints=fkcs,
                        _is_metadata_operation=True,
                    )
                else:
                    for fkc in fkcs:
                        self.traverse_single(fkc)

    def visit_table(
        self,
        table,
        create_ok=False,
        include_foreign_key_constraints=None,
        _is_metadata_operation=False,
    ):
        if not create_ok and not self._can_create_table(table):
            return

        with self.with_ddl_events(
            table,
            checkfirst=self.checkfirst,
            _is_metadata_operation=_is_metadata_operation,
        ):
            for column in table.columns:
                if column.default is not None:
                    self.traverse_single(column.default)

            if not self.dialect.supports_alter:
                # e.g., don't omit any foreign key constraints
                include_foreign_key_constraints = None

            CreateTable(
                table,
                include_foreign_key_constraints=(
                    include_foreign_key_constraints
                ),
            )._invoke_with(self.connection)

            if hasattr(table, "indexes"):
                for index in table.indexes:
                    self.traverse_single(index, create_ok=True)

            if (
                self.dialect.supports_comments
                and not self.dialect.inline_comments
            ):
                if table.comment is not None:
                    SetTableComment(table)._invoke_with(self.connection)

                for column in table.columns:
                    if column.comment is not None:
                        SetColumnComment(column)._invoke_with(self.connection)

                if self.dialect.supports_constraint_comments:
                    for constraint in table.constraints:
                        if constraint.comment is not None:
                            self.connection.execute(
                                SetConstraintComment(constraint)
                            )

    def visit_foreign_key_constraint(self, constraint):
        if not self.dialect.supports_alter:
            return

        with self.with_ddl_events(constraint):
            AddConstraint(constraint)._invoke_with(self.connection)

    def visit_sequence(self, sequence, create_ok=False):
        if not create_ok and not self._can_create_sequence(sequence):
            return
        with self.with_ddl_events(sequence):
            CreateSequence(sequence)._invoke_with(self.connection)

    def visit_index(self, index, create_ok=False):
        if not create_ok and not self._can_create_index(index):
            return
        with self.with_ddl_events(index):
            CreateIndex(index)._invoke_with(self.connection)


class SchemaDropper(InvokeDropDDLBase):
    def __init__(
        self, dialect, connection, checkfirst=False, tables=None, **kwargs
    ):
        super().__init__(connection, **kwargs)
        self.checkfirst = checkfirst
        self.tables = tables
        self.preparer = dialect.identifier_preparer
        self.dialect = dialect
        self.memo = {}

    def visit_metadata(self, metadata):
        if self.tables is not None:
            tables = self.tables
        else:
            tables = list(metadata.tables.values())

        try:
            unsorted_tables = [t for t in tables if self._can_drop_table(t)]
            collection = list(
                reversed(
                    sort_tables_and_constraints(
                        unsorted_tables,
                        filter_fn=lambda constraint: False
                        if not self.dialect.supports_alter
                        or constraint.name is None
                        else None,
                    )
                )
            )
        except exc.CircularDependencyError as err2:
            if not self.dialect.supports_alter:
                util.warn(
                    "Can't sort tables for DROP; an "
                    "unresolvable foreign key "
                    "dependency exists between tables: %s; and backend does "
                    "not support ALTER.  To restore at least a partial sort, "
                    "apply use_alter=True to ForeignKey and "
                    "ForeignKeyConstraint "
                    "objects involved in the cycle to mark these as known "
                    "cycles that will be ignored."
                    % (", ".join(sorted([t.fullname for t in err2.cycles])))
                )
                collection = [(t, ()) for t in unsorted_tables]
            else:
                raise exc.CircularDependencyError(
                    err2.args[0],
                    err2.cycles,
                    err2.edges,
                    msg="Can't sort tables for DROP; an "
                    "unresolvable foreign key "
                    "dependency exists between tables: %s.  Please ensure "
                    "that the ForeignKey and ForeignKeyConstraint objects "
                    "involved in the cycle have "
                    "names so that they can be dropped using "
                    "DROP CONSTRAINT."
                    % (", ".join(sorted([t.fullname for t in err2.cycles]))),
                ) from err2

        seq_coll = [
            s
            for s in metadata._sequences.values()
            if self._can_drop_sequence(s)
        ]

        event_collection = [t for (t, fks) in collection if t is not None]

        with self.with_ddl_events(
            metadata,
            tables=event_collection,
            checkfirst=self.checkfirst,
        ):
            for table, fkcs in collection:
                if table is not None:
                    self.traverse_single(
                        table,
                        drop_ok=True,
                        _is_metadata_operation=True,
                        _ignore_sequences=seq_coll,
                    )
                else:
                    for fkc in fkcs:
                        self.traverse_single(fkc)

            for seq in seq_coll:
                self.traverse_single(seq, drop_ok=seq.column is None)

    def _can_drop_table(self, table):
        self.dialect.validate_identifier(table.name)
        effective_schema = self.connection.schema_for_object(table)
        if effective_schema:
            self.dialect.validate_identifier(effective_schema)
        return not self.checkfirst or self.dialect.has_table(
            self.connection, table.name, schema=effective_schema
        )

    def _can_drop_index(self, index):
        effective_schema = self.connection.schema_for_object(index.table)
        if effective_schema:
            self.dialect.validate_identifier(effective_schema)
        return not self.checkfirst or self.dialect.has_index(
            self.connection,
            index.table.name,
            index.name,
            schema=effective_schema,
        )

    def _can_drop_sequence(self, sequence):
        effective_schema = self.connection.schema_for_object(sequence)
        return self.dialect.supports_sequences and (
            (not self.dialect.sequences_optional or not sequence.optional)
            and (
                not self.checkfirst
                or self.dialect.has_sequence(
                    self.connection, sequence.name, schema=effective_schema
                )
            )
        )

    def visit_index(self, index, drop_ok=False):
        if not drop_ok and not self._can_drop_index(index):
            return

        with self.with_ddl_events(index):
            DropIndex(index)(index, self.connection)

    def visit_table(
        self,
        table,
        drop_ok=False,
        _is_metadata_operation=False,
        _ignore_sequences=(),
    ):
        if not drop_ok and not self._can_drop_table(table):
            return

        with self.with_ddl_events(
            table,
            checkfirst=self.checkfirst,
            _is_metadata_operation=_is_metadata_operation,
        ):
            DropTable(table)._invoke_with(self.connection)

            # traverse client side defaults which may refer to server-side
            # sequences. noting that some of these client side defaults may
            # also be set up as server side defaults
            # (see https://docs.sqlalchemy.org/en/
            # latest/core/defaults.html
            # #associating-a-sequence-as-the-server-side-
            # default), so have to be dropped after the table is dropped.
            for column in table.columns:
                if (
                    column.default is not None
                    and column.default not in _ignore_sequences
                ):
                    self.traverse_single(column.default)

    def visit_foreign_key_constraint(self, constraint):
        if not self.dialect.supports_alter:
            return
        with self.with_ddl_events(constraint):
            DropConstraint(constraint)._invoke_with(self.connection)

    def visit_sequence(self, sequence, drop_ok=False):
        if not drop_ok and not self._can_drop_sequence(sequence):
            return
        with self.with_ddl_events(sequence):
            DropSequence(sequence)._invoke_with(self.connection)


def sort_tables(
    tables: Iterable[TableClause],
    skip_fn: Optional[Callable[[ForeignKeyConstraint], bool]] = None,
    extra_dependencies: Optional[
        typing_Sequence[Tuple[TableClause, TableClause]]
    ] = None,
) -> List[Table]:
    """Sort a collection of :class:`_schema.Table` objects based on
    dependency.

    This is a dependency-ordered sort which will emit :class:`_schema.Table`
    objects such that they will follow their dependent :class:`_schema.Table`
    objects.
    Tables are dependent on another based on the presence of
    :class:`_schema.ForeignKeyConstraint`
    objects as well as explicit dependencies
    added by :meth:`_schema.Table.add_is_dependent_on`.

    .. warning::

        The :func:`._schema.sort_tables` function cannot by itself
        accommodate automatic resolution of dependency cycles between
        tables, which are usually caused by mutually dependent foreign key
        constraints. When these cycles are detected, the foreign keys
        of these tables are omitted from consideration in the sort.
        A warning is emitted when this condition occurs, which will be an
        exception raise in a future release.   Tables which are not part
        of the cycle will still be returned in dependency order.

        To resolve these cycles, the
        :paramref:`_schema.ForeignKeyConstraint.use_alter` parameter may be
        applied to those constraints which create a cycle.  Alternatively,
        the :func:`_schema.sort_tables_and_constraints` function will
        automatically return foreign key constraints in a separate
        collection when cycles are detected so that they may be applied
        to a schema separately.

        .. versionchanged:: 1.3.17 - a warning is emitted when
           :func:`_schema.sort_tables` cannot perform a proper sort due to
           cyclical dependencies.  This will be an exception in a future
           release.  Additionally, the sort will continue to return
           other tables not involved in the cycle in dependency order
           which was not the case previously.

    :param tables: a sequence of :class:`_schema.Table` objects.

    :param skip_fn: optional callable which will be passed a
     :class:`_schema.ForeignKeyConstraint` object; if it returns True, this
     constraint will not be considered as a dependency.  Note this is
     **different** from the same parameter in
     :func:`.sort_tables_and_constraints`, which is
     instead passed the owning :class:`_schema.ForeignKeyConstraint` object.

    :param extra_dependencies: a sequence of 2-tuples of tables which will
     also be considered as dependent on each other.

    .. seealso::

        :func:`.sort_tables_and_constraints`

        :attr:`_schema.MetaData.sorted_tables` - uses this function to sort


    """

    if skip_fn is not None:
        fixed_skip_fn = skip_fn

        def _skip_fn(fkc):
            for fk in fkc.elements:
                if fixed_skip_fn(fk):
                    return True
            else:
                return None

    else:
        _skip_fn = None  # type: ignore

    return [
        t
        for (t, fkcs) in sort_tables_and_constraints(
            tables,
            filter_fn=_skip_fn,
            extra_dependencies=extra_dependencies,
            _warn_for_cycles=True,
        )
        if t is not None
    ]


def sort_tables_and_constraints(
    tables, filter_fn=None, extra_dependencies=None, _warn_for_cycles=False
):
    """Sort a collection of :class:`_schema.Table`  /
    :class:`_schema.ForeignKeyConstraint`
    objects.

    This is a dependency-ordered sort which will emit tuples of
    ``(Table, [ForeignKeyConstraint, ...])`` such that each
    :class:`_schema.Table` follows its dependent :class:`_schema.Table`
    objects.
    Remaining :class:`_schema.ForeignKeyConstraint`
    objects that are separate due to
    dependency rules not satisfied by the sort are emitted afterwards
    as ``(None, [ForeignKeyConstraint ...])``.

    Tables are dependent on another based on the presence of
    :class:`_schema.ForeignKeyConstraint` objects, explicit dependencies
    added by :meth:`_schema.Table.add_is_dependent_on`,
    as well as dependencies
    stated here using the :paramref:`~.sort_tables_and_constraints.skip_fn`
    and/or :paramref:`~.sort_tables_and_constraints.extra_dependencies`
    parameters.

    :param tables: a sequence of :class:`_schema.Table` objects.

    :param filter_fn: optional callable which will be passed a
     :class:`_schema.ForeignKeyConstraint` object,
     and returns a value based on
     whether this constraint should definitely be included or excluded as
     an inline constraint, or neither.   If it returns False, the constraint
     will definitely be included as a dependency that cannot be subject
     to ALTER; if True, it will **only** be included as an ALTER result at
     the end.   Returning None means the constraint is included in the
     table-based result unless it is detected as part of a dependency cycle.

    :param extra_dependencies: a sequence of 2-tuples of tables which will
     also be considered as dependent on each other.

    .. seealso::

        :func:`.sort_tables`


    """

    fixed_dependencies = set()
    mutable_dependencies = set()

    if extra_dependencies is not None:
        fixed_dependencies.update(extra_dependencies)

    remaining_fkcs = set()
    for table in tables:
        for fkc in table.foreign_key_constraints:
            if fkc.use_alter is True:
                remaining_fkcs.add(fkc)
                continue

            if filter_fn:
                filtered = filter_fn(fkc)

                if filtered is True:
                    remaining_fkcs.add(fkc)
                    continue

            dependent_on = fkc.referred_table
            if dependent_on is not table:
                mutable_dependencies.add((dependent_on, table))

        fixed_dependencies.update(
            (parent, table) for parent in table._extra_dependencies
        )

    try:
        candidate_sort = list(
            topological.sort(
                fixed_dependencies.union(mutable_dependencies),
                tables,
            )
        )
    except exc.CircularDependencyError as err:
        if _warn_for_cycles:
            util.warn(
                "Cannot correctly sort tables; there are unresolvable cycles "
                'between tables "%s", which is usually caused by mutually '
                "dependent foreign key constraints.  Foreign key constraints "
                "involving these tables will not be considered; this warning "
                "may raise an error in a future release."
                % (", ".join(sorted(t.fullname for t in err.cycles)),)
            )
        for edge in err.edges:
            if edge in mutable_dependencies:
                table = edge[1]
                if table not in err.cycles:
                    continue
                can_remove = [
                    fkc
                    for fkc in table.foreign_key_constraints
                    if filter_fn is None or filter_fn(fkc) is not False
                ]
                remaining_fkcs.update(can_remove)
                for fkc in can_remove:
                    dependent_on = fkc.referred_table
                    if dependent_on is not table:
                        mutable_dependencies.discard((dependent_on, table))
        candidate_sort = list(
            topological.sort(
                fixed_dependencies.union(mutable_dependencies),
                tables,
            )
        )

    return [
        (table, table.foreign_key_constraints.difference(remaining_fkcs))
        for table in candidate_sort
    ] + [(None, list(remaining_fkcs))]
