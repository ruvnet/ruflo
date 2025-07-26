# dialects/postgresql/named_types.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors
from __future__ import annotations

from typing import Any
from typing import Optional
from typing import Type
from typing import TYPE_CHECKING
from typing import Union

from ... import schema
from ... import util
from ...sql import coercions
from ...sql import elements
from ...sql import roles
from ...sql import sqltypes
from ...sql import type_api
from ...sql.base import _NoArg
from ...sql.ddl import InvokeCreateDDLBase
from ...sql.ddl import InvokeDropDDLBase

if TYPE_CHECKING:
    from ...sql._typing import _TypeEngineArgument


class NamedType(sqltypes.TypeEngine):
    """Base for named types."""

    __abstract__ = True
    DDLGenerator: Type[NamedTypeGenerator]
    DDLDropper: Type[NamedTypeDropper]
    create_type: bool

    def create(self, bind, checkfirst=True, **kw):
        """Emit ``CREATE`` DDL for this type.

        :param bind: a connectable :class:`_engine.Engine`,
         :class:`_engine.Connection`, or similar object to emit
         SQL.
        :param checkfirst: if ``True``, a query against
         the PG catalog will be first performed to see
         if the type does not exist already before
         creating.

        """
        bind._run_ddl_visitor(self.DDLGenerator, self, checkfirst=checkfirst)

    def drop(self, bind, checkfirst=True, **kw):
        """Emit ``DROP`` DDL for this type.

        :param bind: a connectable :class:`_engine.Engine`,
         :class:`_engine.Connection`, or similar object to emit
         SQL.
        :param checkfirst: if ``True``, a query against
         the PG catalog will be first performed to see
         if the type actually exists before dropping.

        """
        bind._run_ddl_visitor(self.DDLDropper, self, checkfirst=checkfirst)

    def _check_for_name_in_memos(self, checkfirst, kw):
        """Look in the 'ddl runner' for 'memos', then
        note our name in that collection.

        This to ensure a particular named type is operated
        upon only once within any kind of create/drop
        sequence without relying upon "checkfirst".

        """
        if not self.create_type:
            return True
        if "_ddl_runner" in kw:
            ddl_runner = kw["_ddl_runner"]
            type_name = f"pg_{self.__visit_name__}"
            if type_name in ddl_runner.memo:
                existing = ddl_runner.memo[type_name]
            else:
                existing = ddl_runner.memo[type_name] = set()
            present = (self.schema, self.name) in existing
            existing.add((self.schema, self.name))
            return present
        else:
            return False

    def _on_table_create(self, target, bind, checkfirst=False, **kw):
        if (
            checkfirst
            or (
                not self.metadata
                and not kw.get("_is_metadata_operation", False)
            )
        ) and not self._check_for_name_in_memos(checkfirst, kw):
            self.create(bind=bind, checkfirst=checkfirst)

    def _on_table_drop(self, target, bind, checkfirst=False, **kw):
        if (
            not self.metadata
            and not kw.get("_is_metadata_operation", False)
            and not self._check_for_name_in_memos(checkfirst, kw)
        ):
            self.drop(bind=bind, checkfirst=checkfirst)

    def _on_metadata_create(self, target, bind, checkfirst=False, **kw):
        if not self._check_for_name_in_memos(checkfirst, kw):
            self.create(bind=bind, checkfirst=checkfirst)

    def _on_metadata_drop(self, target, bind, checkfirst=False, **kw):
        if not self._check_for_name_in_memos(checkfirst, kw):
            self.drop(bind=bind, checkfirst=checkfirst)


class NamedTypeGenerator(InvokeCreateDDLBase):
    def __init__(self, dialect, connection, checkfirst=False, **kwargs):
        super().__init__(connection, **kwargs)
        self.checkfirst = checkfirst

    def _can_create_type(self, type_):
        if not self.checkfirst:
            return True

        effective_schema = self.connection.schema_for_object(type_)
        return not self.connection.dialect.has_type(
            self.connection, type_.name, schema=effective_schema
        )


class NamedTypeDropper(InvokeDropDDLBase):
    def __init__(self, dialect, connection, checkfirst=False, **kwargs):
        super().__init__(connection, **kwargs)
        self.checkfirst = checkfirst

    def _can_drop_type(self, type_):
        if not self.checkfirst:
            return True

        effective_schema = self.connection.schema_for_object(type_)
        return self.connection.dialect.has_type(
            self.connection, type_.name, schema=effective_schema
        )


class EnumGenerator(NamedTypeGenerator):
    def visit_enum(self, enum):
        if not self._can_create_type(enum):
            return

        with self.with_ddl_events(enum):
            self.connection.execute(CreateEnumType(enum))


class EnumDropper(NamedTypeDropper):
    def visit_enum(self, enum):
        if not self._can_drop_type(enum):
            return

        with self.with_ddl_events(enum):
            self.connection.execute(DropEnumType(enum))


class ENUM(NamedType, type_api.NativeForEmulated, sqltypes.Enum):

    """PostgreSQL ENUM type.

    This is a subclass of :class:`_types.Enum` which includes
    support for PG's ``CREATE TYPE`` and ``DROP TYPE``.

    When the builtin type :class:`_types.Enum` is used and the
    :paramref:`.Enum.native_enum` flag is left at its default of
    True, the PostgreSQL backend will use a :class:`_postgresql.ENUM`
    type as the implementation, so the special create/drop rules
    will be used.

    The create/drop behavior of ENUM is necessarily intricate, due to the
    awkward relationship the ENUM type has in relationship to the
    parent table, in that it may be "owned" by just a single table, or
    may be shared among many tables.

    When using :class:`_types.Enum` or :class:`_postgresql.ENUM`
    in an "inline" fashion, the ``CREATE TYPE`` and ``DROP TYPE`` is emitted
    corresponding to when the :meth:`_schema.Table.create` and
    :meth:`_schema.Table.drop`
    methods are called::

        table = Table('sometable', metadata,
            Column('some_enum', ENUM('a', 'b', 'c', name='myenum'))
        )

        table.create(engine)  # will emit CREATE ENUM and CREATE TABLE
        table.drop(engine)  # will emit DROP TABLE and DROP ENUM

    To use a common enumerated type between multiple tables, the best
    practice is to declare the :class:`_types.Enum` or
    :class:`_postgresql.ENUM` independently, and associate it with the
    :class:`_schema.MetaData` object itself::

        my_enum = ENUM('a', 'b', 'c', name='myenum', metadata=metadata)

        t1 = Table('sometable_one', metadata,
            Column('some_enum', myenum)
        )

        t2 = Table('sometable_two', metadata,
            Column('some_enum', myenum)
        )

    When this pattern is used, care must still be taken at the level
    of individual table creates.  Emitting CREATE TABLE without also
    specifying ``checkfirst=True`` will still cause issues::

        t1.create(engine) # will fail: no such type 'myenum'

    If we specify ``checkfirst=True``, the individual table-level create
    operation will check for the ``ENUM`` and create if not exists::

        # will check if enum exists, and emit CREATE TYPE if not
        t1.create(engine, checkfirst=True)

    When using a metadata-level ENUM type, the type will always be created
    and dropped if either the metadata-wide create/drop is called::

        metadata.create_all(engine)  # will emit CREATE TYPE
        metadata.drop_all(engine)  # will emit DROP TYPE

    The type can also be created and dropped directly::

        my_enum.create(engine)
        my_enum.drop(engine)

    """

    native_enum = True
    DDLGenerator = EnumGenerator
    DDLDropper = EnumDropper

    def __init__(
        self,
        *enums,
        name: Union[str, _NoArg, None] = _NoArg.NO_ARG,
        create_type: bool = True,
        **kw,
    ):
        """Construct an :class:`_postgresql.ENUM`.

        Arguments are the same as that of
        :class:`_types.Enum`, but also including
        the following parameters.

        :param create_type: Defaults to True.
         Indicates that ``CREATE TYPE`` should be
         emitted, after optionally checking for the
         presence of the type, when the parent
         table is being created; and additionally
         that ``DROP TYPE`` is called when the table
         is dropped.    When ``False``, no check
         will be performed and no ``CREATE TYPE``
         or ``DROP TYPE`` is emitted, unless
         :meth:`~.postgresql.ENUM.create`
         or :meth:`~.postgresql.ENUM.drop`
         are called directly.
         Setting to ``False`` is helpful
         when invoking a creation scheme to a SQL file
         without access to the actual database -
         the :meth:`~.postgresql.ENUM.create` and
         :meth:`~.postgresql.ENUM.drop` methods can
         be used to emit SQL to a target bind.

        """
        native_enum = kw.pop("native_enum", None)
        if native_enum is False:
            util.warn(
                "the native_enum flag does not apply to the "
                "sqlalchemy.dialects.postgresql.ENUM datatype; this type "
                "always refers to ENUM.   Use sqlalchemy.types.Enum for "
                "non-native enum."
            )
        self.create_type = create_type
        if name is not _NoArg.NO_ARG:
            kw["name"] = name
        super().__init__(*enums, **kw)

    def coerce_compared_value(self, op, value):
        super_coerced_type = super().coerce_compared_value(op, value)
        if (
            super_coerced_type._type_affinity
            is type_api.STRINGTYPE._type_affinity
        ):
            return self
        else:
            return super_coerced_type

    @classmethod
    def __test_init__(cls):
        return cls(name="name")

    @classmethod
    def adapt_emulated_to_native(cls, impl, **kw):
        """Produce a PostgreSQL native :class:`_postgresql.ENUM` from plain
        :class:`.Enum`.

        """
        kw.setdefault("validate_strings", impl.validate_strings)
        kw.setdefault("name", impl.name)
        kw.setdefault("schema", impl.schema)
        kw.setdefault("inherit_schema", impl.inherit_schema)
        kw.setdefault("metadata", impl.metadata)
        kw.setdefault("_create_events", False)
        kw.setdefault("values_callable", impl.values_callable)
        kw.setdefault("omit_aliases", impl._omit_aliases)
        kw.setdefault("_adapted_from", impl)
        if type_api._is_native_for_emulated(impl.__class__):
            kw.setdefault("create_type", impl.create_type)

        return cls(**kw)

    def create(self, bind=None, checkfirst=True):
        """Emit ``CREATE TYPE`` for this
        :class:`_postgresql.ENUM`.

        If the underlying dialect does not support
        PostgreSQL CREATE TYPE, no action is taken.

        :param bind: a connectable :class:`_engine.Engine`,
         :class:`_engine.Connection`, or similar object to emit
         SQL.
        :param checkfirst: if ``True``, a query against
         the PG catalog will be first performed to see
         if the type does not exist already before
         creating.

        """
        if not bind.dialect.supports_native_enum:
            return

        super().create(bind, checkfirst=checkfirst)

    def drop(self, bind=None, checkfirst=True):
        """Emit ``DROP TYPE`` for this
        :class:`_postgresql.ENUM`.

        If the underlying dialect does not support
        PostgreSQL DROP TYPE, no action is taken.

        :param bind: a connectable :class:`_engine.Engine`,
         :class:`_engine.Connection`, or similar object to emit
         SQL.
        :param checkfirst: if ``True``, a query against
         the PG catalog will be first performed to see
         if the type actually exists before dropping.

        """
        if not bind.dialect.supports_native_enum:
            return

        super().drop(bind, checkfirst=checkfirst)

    def get_dbapi_type(self, dbapi):
        """dont return dbapi.STRING for ENUM in PostgreSQL, since that's
        a different type"""

        return None


class DomainGenerator(NamedTypeGenerator):
    def visit_DOMAIN(self, domain):
        if not self._can_create_type(domain):
            return
        with self.with_ddl_events(domain):
            self.connection.execute(CreateDomainType(domain))


class DomainDropper(NamedTypeDropper):
    def visit_DOMAIN(self, domain):
        if not self._can_drop_type(domain):
            return

        with self.with_ddl_events(domain):
            self.connection.execute(DropDomainType(domain))


class DOMAIN(NamedType, sqltypes.SchemaType):
    r"""Represent the DOMAIN PostgreSQL type.

    A domain is essentially a data type with optional constraints
    that restrict the allowed set of values. E.g.::

        PositiveInt = DOMAIN(
            "pos_int", Integer, check="VALUE > 0", not_null=True
        )

        UsPostalCode = DOMAIN(
            "us_postal_code",
            Text,
            check="VALUE ~ '^\d{5}$' OR VALUE ~ '^\d{5}-\d{4}$'"
        )

    See the `PostgreSQL documentation`__ for additional details

    __ https://www.postgresql.org/docs/current/sql-createdomain.html

    .. versionadded:: 2.0

    """

    DDLGenerator = DomainGenerator
    DDLDropper = DomainDropper

    __visit_name__ = "DOMAIN"

    def __init__(
        self,
        name: str,
        data_type: _TypeEngineArgument[Any],
        *,
        collation: Optional[str] = None,
        default: Optional[Union[str, elements.TextClause]] = None,
        constraint_name: Optional[str] = None,
        not_null: Optional[bool] = None,
        check: Optional[str] = None,
        create_type: bool = True,
        **kw: Any,
    ):
        """
        Construct a DOMAIN.

        :param name: the name of the domain
        :param data_type: The underlying data type of the domain.
          This can include array specifiers.
        :param collation: An optional collation for the domain.
          If no collation is specified, the underlying data type's default
          collation is used. The underlying type must be collatable if
          ``collation`` is specified.
        :param default: The DEFAULT clause specifies a default value for
          columns of the domain data type. The default should be a string
          or a :func:`_expression.text` value.
          If no default value is specified, then the default value is
          the null value.
        :param constraint_name: An optional name for a constraint.
          If not specified, the backend generates a name.
        :param not_null: Values of this domain are prevented from being null.
          By default domain are allowed to be null. If not specified
          no nullability clause will be emitted.
        :param check: CHECK clause specify integrity constraint or test
          which values of the domain must satisfy. A constraint must be
          an expression producing a Boolean result that can use the key
          word VALUE to refer to the value being tested.
          Differently from PostgreSQL, only a single check clause is
          currently allowed in SQLAlchemy.
        :param schema: optional schema name
        :param metadata: optional :class:`_schema.MetaData` object which
         this :class:`_postgresql.DOMAIN` will be directly associated
        :param create_type: Defaults to True.
         Indicates that ``CREATE TYPE`` should be emitted, after optionally
         checking for the presence of the type, when the parent table is
         being created; and additionally that ``DROP TYPE`` is called
         when the table is dropped.

        """
        self.data_type = type_api.to_instance(data_type)
        self.default = default
        self.collation = collation
        self.constraint_name = constraint_name
        self.not_null = not_null
        if check is not None:
            check = coercions.expect(roles.DDLExpressionRole, check)
        self.check = check
        self.create_type = create_type
        super().__init__(name=name, **kw)

    @classmethod
    def __test_init__(cls):
        return cls("name", sqltypes.Integer)


class CreateEnumType(schema._CreateDropBase):
    __visit_name__ = "create_enum_type"


class DropEnumType(schema._CreateDropBase):
    __visit_name__ = "drop_enum_type"


class CreateDomainType(schema._CreateDropBase):
    """Represent a CREATE DOMAIN statement."""

    __visit_name__ = "create_domain_type"


class DropDomainType(schema._CreateDropBase):
    """Represent a DROP DOMAIN statement."""

    __visit_name__ = "drop_domain_type"
