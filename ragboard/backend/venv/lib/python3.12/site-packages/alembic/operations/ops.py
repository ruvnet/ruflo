from __future__ import annotations

from abc import abstractmethod
import re
from typing import Any
from typing import Callable
from typing import cast
from typing import Dict
from typing import FrozenSet
from typing import Iterator
from typing import List
from typing import MutableMapping
from typing import Optional
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from sqlalchemy.types import NULLTYPE

from . import schemaobj
from .base import BatchOperations
from .base import Operations
from .. import util
from ..util import sqla_compat

if TYPE_CHECKING:
    from typing import Literal

    from sqlalchemy.sql import Executable
    from sqlalchemy.sql.elements import ColumnElement
    from sqlalchemy.sql.elements import conv
    from sqlalchemy.sql.elements import quoted_name
    from sqlalchemy.sql.elements import TextClause
    from sqlalchemy.sql.functions import Function
    from sqlalchemy.sql.schema import CheckConstraint
    from sqlalchemy.sql.schema import Column
    from sqlalchemy.sql.schema import Computed
    from sqlalchemy.sql.schema import Constraint
    from sqlalchemy.sql.schema import ForeignKeyConstraint
    from sqlalchemy.sql.schema import Identity
    from sqlalchemy.sql.schema import Index
    from sqlalchemy.sql.schema import MetaData
    from sqlalchemy.sql.schema import PrimaryKeyConstraint
    from sqlalchemy.sql.schema import SchemaItem
    from sqlalchemy.sql.schema import Table
    from sqlalchemy.sql.schema import UniqueConstraint
    from sqlalchemy.sql.selectable import TableClause
    from sqlalchemy.sql.type_api import TypeEngine

    from ..autogenerate.rewriter import Rewriter
    from ..runtime.migration import MigrationContext
    from ..script.revision import _RevIdType

_T = TypeVar("_T", bound=Any)
_AC = TypeVar("_AC", bound="AddConstraintOp")


class MigrateOperation:
    """base class for migration command and organization objects.

    This system is part of the operation extensibility API.

    .. seealso::

        :ref:`operation_objects`

        :ref:`operation_plugins`

        :ref:`customizing_revision`

    """

    @util.memoized_property
    def info(self) -> Dict[Any, Any]:
        """A dictionary that may be used to store arbitrary information
        along with this :class:`.MigrateOperation` object.

        """
        return {}

    _mutations: FrozenSet[Rewriter] = frozenset()

    def reverse(self) -> MigrateOperation:
        raise NotImplementedError

    def to_diff_tuple(self) -> Tuple[Any, ...]:
        raise NotImplementedError


class AddConstraintOp(MigrateOperation):
    """Represent an add constraint operation."""

    add_constraint_ops = util.Dispatcher()

    @property
    def constraint_type(self) -> str:
        raise NotImplementedError()

    @classmethod
    def register_add_constraint(
        cls, type_: str
    ) -> Callable[[Type[_AC]], Type[_AC]]:
        def go(klass: Type[_AC]) -> Type[_AC]:
            cls.add_constraint_ops.dispatch_for(type_)(klass.from_constraint)
            return klass

        return go

    @classmethod
    def from_constraint(cls, constraint: Constraint) -> AddConstraintOp:
        return cls.add_constraint_ops.dispatch(constraint.__visit_name__)(  # type: ignore[no-any-return]  # noqa: E501
            constraint
        )

    @abstractmethod
    def to_constraint(
        self, migration_context: Optional[MigrationContext] = None
    ) -> Constraint:
        pass

    def reverse(self) -> DropConstraintOp:
        return DropConstraintOp.from_constraint(self.to_constraint())

    def to_diff_tuple(self) -> Tuple[str, Constraint]:
        return ("add_constraint", self.to_constraint())


@Operations.register_operation("drop_constraint")
@BatchOperations.register_operation("drop_constraint", "batch_drop_constraint")
class DropConstraintOp(MigrateOperation):
    """Represent a drop constraint operation."""

    def __init__(
        self,
        constraint_name: Optional[sqla_compat._ConstraintNameDefined],
        table_name: str,
        type_: Optional[str] = None,
        *,
        schema: Optional[str] = None,
        _reverse: Optional[AddConstraintOp] = None,
    ) -> None:
        self.constraint_name = constraint_name
        self.table_name = table_name
        self.constraint_type = type_
        self.schema = schema
        self._reverse = _reverse

    def reverse(self) -> AddConstraintOp:
        return AddConstraintOp.from_constraint(self.to_constraint())

    def to_diff_tuple(
        self,
    ) -> Tuple[str, SchemaItem]:
        if self.constraint_type == "foreignkey":
            return ("remove_fk", self.to_constraint())
        else:
            return ("remove_constraint", self.to_constraint())

    @classmethod
    def from_constraint(cls, constraint: Constraint) -> DropConstraintOp:
        types = {
            "unique_constraint": "unique",
            "foreign_key_constraint": "foreignkey",
            "primary_key_constraint": "primary",
            "check_constraint": "check",
            "column_check_constraint": "check",
            "table_or_column_check_constraint": "check",
        }

        constraint_table = sqla_compat._table_for_constraint(constraint)
        return cls(
            sqla_compat.constraint_name_or_none(constraint.name),
            constraint_table.name,
            schema=constraint_table.schema,
            type_=types.get(constraint.__visit_name__),
            _reverse=AddConstraintOp.from_constraint(constraint),
        )

    def to_constraint(self) -> Constraint:
        if self._reverse is not None:
            constraint = self._reverse.to_constraint()
            constraint.name = self.constraint_name
            constraint_table = sqla_compat._table_for_constraint(constraint)
            constraint_table.name = self.table_name
            constraint_table.schema = self.schema

            return constraint
        else:
            raise ValueError(
                "constraint cannot be produced; "
                "original constraint is not present"
            )

    @classmethod
    def drop_constraint(
        cls,
        operations: Operations,
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

        """

        op = cls(constraint_name, table_name, type_=type_, schema=schema)
        return operations.invoke(op)

    @classmethod
    def batch_drop_constraint(
        cls,
        operations: BatchOperations,
        constraint_name: str,
        type_: Optional[str] = None,
    ) -> None:
        """Issue a "drop constraint" instruction using the
        current batch migration context.

        The batch form of this call omits the ``table_name`` and ``schema``
        arguments from the call.

        .. seealso::

            :meth:`.Operations.drop_constraint`

        """
        op = cls(
            constraint_name,
            operations.impl.table_name,
            type_=type_,
            schema=operations.impl.schema,
        )
        return operations.invoke(op)


@Operations.register_operation("create_primary_key")
@BatchOperations.register_operation(
    "create_primary_key", "batch_create_primary_key"
)
@AddConstraintOp.register_add_constraint("primary_key_constraint")
class CreatePrimaryKeyOp(AddConstraintOp):
    """Represent a create primary key operation."""

    constraint_type = "primarykey"

    def __init__(
        self,
        constraint_name: Optional[sqla_compat._ConstraintNameDefined],
        table_name: str,
        columns: Sequence[str],
        *,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> None:
        self.constraint_name = constraint_name
        self.table_name = table_name
        self.columns = columns
        self.schema = schema
        self.kw = kw

    @classmethod
    def from_constraint(cls, constraint: Constraint) -> CreatePrimaryKeyOp:
        constraint_table = sqla_compat._table_for_constraint(constraint)
        pk_constraint = cast("PrimaryKeyConstraint", constraint)
        return cls(
            sqla_compat.constraint_name_or_none(pk_constraint.name),
            constraint_table.name,
            pk_constraint.columns.keys(),
            schema=constraint_table.schema,
            **pk_constraint.dialect_kwargs,
        )

    def to_constraint(
        self, migration_context: Optional[MigrationContext] = None
    ) -> PrimaryKeyConstraint:
        schema_obj = schemaobj.SchemaObjects(migration_context)

        return schema_obj.primary_key_constraint(
            self.constraint_name,
            self.table_name,
            self.columns,
            schema=self.schema,
            **self.kw,
        )

    @classmethod
    def create_primary_key(
        cls,
        operations: Operations,
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

        """
        op = cls(constraint_name, table_name, columns, schema=schema)
        return operations.invoke(op)

    @classmethod
    def batch_create_primary_key(
        cls,
        operations: BatchOperations,
        constraint_name: str,
        columns: List[str],
    ) -> None:
        """Issue a "create primary key" instruction using the
        current batch migration context.

        The batch form of this call omits the ``table_name`` and ``schema``
        arguments from the call.

        .. seealso::

            :meth:`.Operations.create_primary_key`

        """
        op = cls(
            constraint_name,
            operations.impl.table_name,
            columns,
            schema=operations.impl.schema,
        )
        return operations.invoke(op)


@Operations.register_operation("create_unique_constraint")
@BatchOperations.register_operation(
    "create_unique_constraint", "batch_create_unique_constraint"
)
@AddConstraintOp.register_add_constraint("unique_constraint")
class CreateUniqueConstraintOp(AddConstraintOp):
    """Represent a create unique constraint operation."""

    constraint_type = "unique"

    def __init__(
        self,
        constraint_name: Optional[sqla_compat._ConstraintNameDefined],
        table_name: str,
        columns: Sequence[str],
        *,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> None:
        self.constraint_name = constraint_name
        self.table_name = table_name
        self.columns = columns
        self.schema = schema
        self.kw = kw

    @classmethod
    def from_constraint(
        cls, constraint: Constraint
    ) -> CreateUniqueConstraintOp:
        constraint_table = sqla_compat._table_for_constraint(constraint)

        uq_constraint = cast("UniqueConstraint", constraint)

        kw: Dict[str, Any] = {}
        if uq_constraint.deferrable:
            kw["deferrable"] = uq_constraint.deferrable
        if uq_constraint.initially:
            kw["initially"] = uq_constraint.initially
        kw.update(uq_constraint.dialect_kwargs)
        return cls(
            sqla_compat.constraint_name_or_none(uq_constraint.name),
            constraint_table.name,
            [c.name for c in uq_constraint.columns],
            schema=constraint_table.schema,
            **kw,
        )

    def to_constraint(
        self, migration_context: Optional[MigrationContext] = None
    ) -> UniqueConstraint:
        schema_obj = schemaobj.SchemaObjects(migration_context)
        return schema_obj.unique_constraint(
            self.constraint_name,
            self.table_name,
            self.columns,
            schema=self.schema,
            **self.kw,
        )

    @classmethod
    def create_unique_constraint(
        cls,
        operations: Operations,
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

        """

        op = cls(constraint_name, table_name, columns, schema=schema, **kw)
        return operations.invoke(op)

    @classmethod
    def batch_create_unique_constraint(
        cls,
        operations: BatchOperations,
        constraint_name: str,
        columns: Sequence[str],
        **kw: Any,
    ) -> Any:
        """Issue a "create unique constraint" instruction using the
        current batch migration context.

        The batch form of this call omits the ``source`` and ``schema``
        arguments from the call.

        .. seealso::

            :meth:`.Operations.create_unique_constraint`

        """
        kw["schema"] = operations.impl.schema
        op = cls(constraint_name, operations.impl.table_name, columns, **kw)
        return operations.invoke(op)


@Operations.register_operation("create_foreign_key")
@BatchOperations.register_operation(
    "create_foreign_key", "batch_create_foreign_key"
)
@AddConstraintOp.register_add_constraint("foreign_key_constraint")
class CreateForeignKeyOp(AddConstraintOp):
    """Represent a create foreign key constraint operation."""

    constraint_type = "foreignkey"

    def __init__(
        self,
        constraint_name: Optional[sqla_compat._ConstraintNameDefined],
        source_table: str,
        referent_table: str,
        local_cols: List[str],
        remote_cols: List[str],
        **kw: Any,
    ) -> None:
        self.constraint_name = constraint_name
        self.source_table = source_table
        self.referent_table = referent_table
        self.local_cols = local_cols
        self.remote_cols = remote_cols
        self.kw = kw

    def to_diff_tuple(self) -> Tuple[str, ForeignKeyConstraint]:
        return ("add_fk", self.to_constraint())

    @classmethod
    def from_constraint(cls, constraint: Constraint) -> CreateForeignKeyOp:
        fk_constraint = cast("ForeignKeyConstraint", constraint)
        kw: Dict[str, Any] = {}
        if fk_constraint.onupdate:
            kw["onupdate"] = fk_constraint.onupdate
        if fk_constraint.ondelete:
            kw["ondelete"] = fk_constraint.ondelete
        if fk_constraint.initially:
            kw["initially"] = fk_constraint.initially
        if fk_constraint.deferrable:
            kw["deferrable"] = fk_constraint.deferrable
        if fk_constraint.use_alter:
            kw["use_alter"] = fk_constraint.use_alter
        if fk_constraint.match:
            kw["match"] = fk_constraint.match

        (
            source_schema,
            source_table,
            source_columns,
            target_schema,
            target_table,
            target_columns,
            onupdate,
            ondelete,
            deferrable,
            initially,
        ) = sqla_compat._fk_spec(fk_constraint)

        kw["source_schema"] = source_schema
        kw["referent_schema"] = target_schema
        kw.update(fk_constraint.dialect_kwargs)
        return cls(
            sqla_compat.constraint_name_or_none(fk_constraint.name),
            source_table,
            target_table,
            source_columns,
            target_columns,
            **kw,
        )

    def to_constraint(
        self, migration_context: Optional[MigrationContext] = None
    ) -> ForeignKeyConstraint:
        schema_obj = schemaobj.SchemaObjects(migration_context)
        return schema_obj.foreign_key_constraint(
            self.constraint_name,
            self.source_table,
            self.referent_table,
            self.local_cols,
            self.remote_cols,
            **self.kw,
        )

    @classmethod
    def create_foreign_key(
        cls,
        operations: Operations,
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

        """

        op = cls(
            constraint_name,
            source_table,
            referent_table,
            local_cols,
            remote_cols,
            onupdate=onupdate,
            ondelete=ondelete,
            deferrable=deferrable,
            source_schema=source_schema,
            referent_schema=referent_schema,
            initially=initially,
            match=match,
            **dialect_kw,
        )
        return operations.invoke(op)

    @classmethod
    def batch_create_foreign_key(
        cls,
        operations: BatchOperations,
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

        """
        op = cls(
            constraint_name,
            operations.impl.table_name,
            referent_table,
            local_cols,
            remote_cols,
            onupdate=onupdate,
            ondelete=ondelete,
            deferrable=deferrable,
            source_schema=operations.impl.schema,
            referent_schema=referent_schema,
            initially=initially,
            match=match,
            **dialect_kw,
        )
        return operations.invoke(op)


@Operations.register_operation("create_check_constraint")
@BatchOperations.register_operation(
    "create_check_constraint", "batch_create_check_constraint"
)
@AddConstraintOp.register_add_constraint("check_constraint")
@AddConstraintOp.register_add_constraint("table_or_column_check_constraint")
@AddConstraintOp.register_add_constraint("column_check_constraint")
class CreateCheckConstraintOp(AddConstraintOp):
    """Represent a create check constraint operation."""

    constraint_type = "check"

    def __init__(
        self,
        constraint_name: Optional[sqla_compat._ConstraintNameDefined],
        table_name: str,
        condition: Union[str, TextClause, ColumnElement[Any]],
        *,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> None:
        self.constraint_name = constraint_name
        self.table_name = table_name
        self.condition = condition
        self.schema = schema
        self.kw = kw

    @classmethod
    def from_constraint(
        cls, constraint: Constraint
    ) -> CreateCheckConstraintOp:
        constraint_table = sqla_compat._table_for_constraint(constraint)

        ck_constraint = cast("CheckConstraint", constraint)
        return cls(
            sqla_compat.constraint_name_or_none(ck_constraint.name),
            constraint_table.name,
            cast("ColumnElement[Any]", ck_constraint.sqltext),
            schema=constraint_table.schema,
            **ck_constraint.dialect_kwargs,
        )

    def to_constraint(
        self, migration_context: Optional[MigrationContext] = None
    ) -> CheckConstraint:
        schema_obj = schemaobj.SchemaObjects(migration_context)
        return schema_obj.check_constraint(
            self.constraint_name,
            self.table_name,
            self.condition,
            schema=self.schema,
            **self.kw,
        )

    @classmethod
    def create_check_constraint(
        cls,
        operations: Operations,
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

        """
        op = cls(constraint_name, table_name, condition, schema=schema, **kw)
        return operations.invoke(op)

    @classmethod
    def batch_create_check_constraint(
        cls,
        operations: BatchOperations,
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

        """
        op = cls(
            constraint_name,
            operations.impl.table_name,
            condition,
            schema=operations.impl.schema,
            **kw,
        )
        return operations.invoke(op)


@Operations.register_operation("create_index")
@BatchOperations.register_operation("create_index", "batch_create_index")
class CreateIndexOp(MigrateOperation):
    """Represent a create index operation."""

    def __init__(
        self,
        index_name: Optional[str],
        table_name: str,
        columns: Sequence[Union[str, TextClause, ColumnElement[Any]]],
        *,
        schema: Optional[str] = None,
        unique: bool = False,
        if_not_exists: Optional[bool] = None,
        **kw: Any,
    ) -> None:
        self.index_name = index_name
        self.table_name = table_name
        self.columns = columns
        self.schema = schema
        self.unique = unique
        self.if_not_exists = if_not_exists
        self.kw = kw

    def reverse(self) -> DropIndexOp:
        return DropIndexOp.from_index(self.to_index())

    def to_diff_tuple(self) -> Tuple[str, Index]:
        return ("add_index", self.to_index())

    @classmethod
    def from_index(cls, index: Index) -> CreateIndexOp:
        assert index.table is not None
        return cls(
            index.name,
            index.table.name,
            index.expressions,
            schema=index.table.schema,
            unique=index.unique,
            **index.kwargs,
        )

    def to_index(
        self, migration_context: Optional[MigrationContext] = None
    ) -> Index:
        schema_obj = schemaobj.SchemaObjects(migration_context)

        idx = schema_obj.index(
            self.index_name,
            self.table_name,
            self.columns,
            schema=self.schema,
            unique=self.unique,
            **self.kw,
        )
        return idx

    @classmethod
    def create_index(
        cls,
        operations: Operations,
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

        """
        op = cls(
            index_name,
            table_name,
            columns,
            schema=schema,
            unique=unique,
            if_not_exists=if_not_exists,
            **kw,
        )
        return operations.invoke(op)

    @classmethod
    def batch_create_index(
        cls,
        operations: BatchOperations,
        index_name: str,
        columns: List[str],
        **kw: Any,
    ) -> None:
        """Issue a "create index" instruction using the
        current batch migration context.

        .. seealso::

            :meth:`.Operations.create_index`

        """

        op = cls(
            index_name,
            operations.impl.table_name,
            columns,
            schema=operations.impl.schema,
            **kw,
        )
        return operations.invoke(op)


@Operations.register_operation("drop_index")
@BatchOperations.register_operation("drop_index", "batch_drop_index")
class DropIndexOp(MigrateOperation):
    """Represent a drop index operation."""

    def __init__(
        self,
        index_name: Union[quoted_name, str, conv],
        table_name: Optional[str] = None,
        *,
        schema: Optional[str] = None,
        if_exists: Optional[bool] = None,
        _reverse: Optional[CreateIndexOp] = None,
        **kw: Any,
    ) -> None:
        self.index_name = index_name
        self.table_name = table_name
        self.schema = schema
        self.if_exists = if_exists
        self._reverse = _reverse
        self.kw = kw

    def to_diff_tuple(self) -> Tuple[str, Index]:
        return ("remove_index", self.to_index())

    def reverse(self) -> CreateIndexOp:
        return CreateIndexOp.from_index(self.to_index())

    @classmethod
    def from_index(cls, index: Index) -> DropIndexOp:
        assert index.table is not None
        return cls(
            index.name,  # type: ignore[arg-type]
            table_name=index.table.name,
            schema=index.table.schema,
            _reverse=CreateIndexOp.from_index(index),
            unique=index.unique,
            **index.kwargs,
        )

    def to_index(
        self, migration_context: Optional[MigrationContext] = None
    ) -> Index:
        schema_obj = schemaobj.SchemaObjects(migration_context)

        # need a dummy column name here since SQLAlchemy
        # 0.7.6 and further raises on Index with no columns
        return schema_obj.index(
            self.index_name,
            self.table_name,
            self._reverse.columns if self._reverse else ["x"],
            schema=self.schema,
            **self.kw,
        )

    @classmethod
    def drop_index(
        cls,
        operations: Operations,
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

        """
        op = cls(
            index_name,
            table_name=table_name,
            schema=schema,
            if_exists=if_exists,
            **kw,
        )
        return operations.invoke(op)

    @classmethod
    def batch_drop_index(
        cls, operations: BatchOperations, index_name: str, **kw: Any
    ) -> None:
        """Issue a "drop index" instruction using the
        current batch migration context.

        .. seealso::

            :meth:`.Operations.drop_index`

        """

        op = cls(
            index_name,
            table_name=operations.impl.table_name,
            schema=operations.impl.schema,
            **kw,
        )
        return operations.invoke(op)


@Operations.register_operation("create_table")
class CreateTableOp(MigrateOperation):
    """Represent a create table operation."""

    def __init__(
        self,
        table_name: str,
        columns: Sequence[SchemaItem],
        *,
        schema: Optional[str] = None,
        _namespace_metadata: Optional[MetaData] = None,
        _constraints_included: bool = False,
        **kw: Any,
    ) -> None:
        self.table_name = table_name
        self.columns = columns
        self.schema = schema
        self.info = kw.pop("info", {})
        self.comment = kw.pop("comment", None)
        self.prefixes = kw.pop("prefixes", None)
        self.kw = kw
        self._namespace_metadata = _namespace_metadata
        self._constraints_included = _constraints_included

    def reverse(self) -> DropTableOp:
        return DropTableOp.from_table(
            self.to_table(), _namespace_metadata=self._namespace_metadata
        )

    def to_diff_tuple(self) -> Tuple[str, Table]:
        return ("add_table", self.to_table())

    @classmethod
    def from_table(
        cls, table: Table, *, _namespace_metadata: Optional[MetaData] = None
    ) -> CreateTableOp:
        if _namespace_metadata is None:
            _namespace_metadata = table.metadata

        return cls(
            table.name,
            list(table.c) + list(table.constraints),
            schema=table.schema,
            _namespace_metadata=_namespace_metadata,
            # given a Table() object, this Table will contain full Index()
            # and UniqueConstraint objects already constructed in response to
            # each unique=True / index=True flag on a Column.  Carry this
            # state along so that when we re-convert back into a Table, we
            # skip unique=True/index=True so that these constraints are
            # not doubled up. see #844 #848
            _constraints_included=True,
            comment=table.comment,
            info=dict(table.info),
            prefixes=list(table._prefixes),
            **table.kwargs,
        )

    def to_table(
        self, migration_context: Optional[MigrationContext] = None
    ) -> Table:
        schema_obj = schemaobj.SchemaObjects(migration_context)

        return schema_obj.table(
            self.table_name,
            *self.columns,
            schema=self.schema,
            prefixes=list(self.prefixes) if self.prefixes else [],
            comment=self.comment,
            info=self.info.copy() if self.info else {},
            _constraints_included=self._constraints_included,
            **self.kw,
        )

    @classmethod
    def create_table(
        cls,
        operations: Operations,
        table_name: str,
        *columns: SchemaItem,
        **kw: Any,
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

        """
        op = cls(table_name, columns, **kw)
        return operations.invoke(op)


@Operations.register_operation("drop_table")
class DropTableOp(MigrateOperation):
    """Represent a drop table operation."""

    def __init__(
        self,
        table_name: str,
        *,
        schema: Optional[str] = None,
        table_kw: Optional[MutableMapping[Any, Any]] = None,
        _reverse: Optional[CreateTableOp] = None,
    ) -> None:
        self.table_name = table_name
        self.schema = schema
        self.table_kw = table_kw or {}
        self.comment = self.table_kw.pop("comment", None)
        self.info = self.table_kw.pop("info", None)
        self.prefixes = self.table_kw.pop("prefixes", None)
        self._reverse = _reverse

    def to_diff_tuple(self) -> Tuple[str, Table]:
        return ("remove_table", self.to_table())

    def reverse(self) -> CreateTableOp:
        return CreateTableOp.from_table(self.to_table())

    @classmethod
    def from_table(
        cls, table: Table, *, _namespace_metadata: Optional[MetaData] = None
    ) -> DropTableOp:
        return cls(
            table.name,
            schema=table.schema,
            table_kw={
                "comment": table.comment,
                "info": dict(table.info),
                "prefixes": list(table._prefixes),
                **table.kwargs,
            },
            _reverse=CreateTableOp.from_table(
                table, _namespace_metadata=_namespace_metadata
            ),
        )

    def to_table(
        self, migration_context: Optional[MigrationContext] = None
    ) -> Table:
        if self._reverse:
            cols_and_constraints = self._reverse.columns
        else:
            cols_and_constraints = []

        schema_obj = schemaobj.SchemaObjects(migration_context)
        t = schema_obj.table(
            self.table_name,
            *cols_and_constraints,
            comment=self.comment,
            info=self.info.copy() if self.info else {},
            prefixes=list(self.prefixes) if self.prefixes else [],
            schema=self.schema,
            _constraints_included=self._reverse._constraints_included
            if self._reverse
            else False,
            **self.table_kw,
        )
        return t

    @classmethod
    def drop_table(
        cls,
        operations: Operations,
        table_name: str,
        *,
        schema: Optional[str] = None,
        **kw: Any,
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

        """
        op = cls(table_name, schema=schema, table_kw=kw)
        operations.invoke(op)


class AlterTableOp(MigrateOperation):
    """Represent an alter table operation."""

    def __init__(
        self,
        table_name: str,
        *,
        schema: Optional[str] = None,
    ) -> None:
        self.table_name = table_name
        self.schema = schema


@Operations.register_operation("rename_table")
class RenameTableOp(AlterTableOp):
    """Represent a rename table operation."""

    def __init__(
        self,
        old_table_name: str,
        new_table_name: str,
        *,
        schema: Optional[str] = None,
    ) -> None:
        super().__init__(old_table_name, schema=schema)
        self.new_table_name = new_table_name

    @classmethod
    def rename_table(
        cls,
        operations: Operations,
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

        """
        op = cls(old_table_name, new_table_name, schema=schema)
        return operations.invoke(op)


@Operations.register_operation("create_table_comment")
@BatchOperations.register_operation(
    "create_table_comment", "batch_create_table_comment"
)
class CreateTableCommentOp(AlterTableOp):
    """Represent a COMMENT ON `table` operation."""

    def __init__(
        self,
        table_name: str,
        comment: Optional[str],
        *,
        schema: Optional[str] = None,
        existing_comment: Optional[str] = None,
    ) -> None:
        self.table_name = table_name
        self.comment = comment
        self.existing_comment = existing_comment
        self.schema = schema

    @classmethod
    def create_table_comment(
        cls,
        operations: Operations,
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

        """

        op = cls(
            table_name,
            comment,
            existing_comment=existing_comment,
            schema=schema,
        )
        return operations.invoke(op)

    @classmethod
    def batch_create_table_comment(
        cls,
        operations: BatchOperations,
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

        """

        op = cls(
            operations.impl.table_name,
            comment,
            existing_comment=existing_comment,
            schema=operations.impl.schema,
        )
        return operations.invoke(op)

    def reverse(self) -> Union[CreateTableCommentOp, DropTableCommentOp]:
        """Reverses the COMMENT ON operation against a table."""
        if self.existing_comment is None:
            return DropTableCommentOp(
                self.table_name,
                existing_comment=self.comment,
                schema=self.schema,
            )
        else:
            return CreateTableCommentOp(
                self.table_name,
                self.existing_comment,
                existing_comment=self.comment,
                schema=self.schema,
            )

    def to_table(
        self, migration_context: Optional[MigrationContext] = None
    ) -> Table:
        schema_obj = schemaobj.SchemaObjects(migration_context)

        return schema_obj.table(
            self.table_name, schema=self.schema, comment=self.comment
        )

    def to_diff_tuple(self) -> Tuple[Any, ...]:
        return ("add_table_comment", self.to_table(), self.existing_comment)


@Operations.register_operation("drop_table_comment")
@BatchOperations.register_operation(
    "drop_table_comment", "batch_drop_table_comment"
)
class DropTableCommentOp(AlterTableOp):
    """Represent an operation to remove the comment from a table."""

    def __init__(
        self,
        table_name: str,
        *,
        schema: Optional[str] = None,
        existing_comment: Optional[str] = None,
    ) -> None:
        self.table_name = table_name
        self.existing_comment = existing_comment
        self.schema = schema

    @classmethod
    def drop_table_comment(
        cls,
        operations: Operations,
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

        """

        op = cls(table_name, existing_comment=existing_comment, schema=schema)
        return operations.invoke(op)

    @classmethod
    def batch_drop_table_comment(
        cls,
        operations: BatchOperations,
        *,
        existing_comment: Optional[str] = None,
    ) -> None:
        """Issue a "drop table comment" operation to
        remove an existing comment set on a table using the current
        batch operations context.

        :param existing_comment: An optional string value of a comment already
         registered on the specified table.

        """

        op = cls(
            operations.impl.table_name,
            existing_comment=existing_comment,
            schema=operations.impl.schema,
        )
        return operations.invoke(op)

    def reverse(self) -> CreateTableCommentOp:
        """Reverses the COMMENT ON operation against a table."""
        return CreateTableCommentOp(
            self.table_name, self.existing_comment, schema=self.schema
        )

    def to_table(
        self, migration_context: Optional[MigrationContext] = None
    ) -> Table:
        schema_obj = schemaobj.SchemaObjects(migration_context)

        return schema_obj.table(self.table_name, schema=self.schema)

    def to_diff_tuple(self) -> Tuple[Any, ...]:
        return ("remove_table_comment", self.to_table())


@Operations.register_operation("alter_column")
@BatchOperations.register_operation("alter_column", "batch_alter_column")
class AlterColumnOp(AlterTableOp):
    """Represent an alter column operation."""

    def __init__(
        self,
        table_name: str,
        column_name: str,
        *,
        schema: Optional[str] = None,
        existing_type: Optional[Any] = None,
        existing_server_default: Any = False,
        existing_nullable: Optional[bool] = None,
        existing_comment: Optional[str] = None,
        modify_nullable: Optional[bool] = None,
        modify_comment: Optional[Union[str, Literal[False]]] = False,
        modify_server_default: Any = False,
        modify_name: Optional[str] = None,
        modify_type: Optional[Any] = None,
        **kw: Any,
    ) -> None:
        super().__init__(table_name, schema=schema)
        self.column_name = column_name
        self.existing_type = existing_type
        self.existing_server_default = existing_server_default
        self.existing_nullable = existing_nullable
        self.existing_comment = existing_comment
        self.modify_nullable = modify_nullable
        self.modify_comment = modify_comment
        self.modify_server_default = modify_server_default
        self.modify_name = modify_name
        self.modify_type = modify_type
        self.kw = kw

    def to_diff_tuple(self) -> Any:
        col_diff = []
        schema, tname, cname = self.schema, self.table_name, self.column_name

        if self.modify_type is not None:
            col_diff.append(
                (
                    "modify_type",
                    schema,
                    tname,
                    cname,
                    {
                        "existing_nullable": self.existing_nullable,
                        "existing_server_default": (
                            self.existing_server_default
                        ),
                        "existing_comment": self.existing_comment,
                    },
                    self.existing_type,
                    self.modify_type,
                )
            )

        if self.modify_nullable is not None:
            col_diff.append(
                (
                    "modify_nullable",
                    schema,
                    tname,
                    cname,
                    {
                        "existing_type": self.existing_type,
                        "existing_server_default": (
                            self.existing_server_default
                        ),
                        "existing_comment": self.existing_comment,
                    },
                    self.existing_nullable,
                    self.modify_nullable,
                )
            )

        if self.modify_server_default is not False:
            col_diff.append(
                (
                    "modify_default",
                    schema,
                    tname,
                    cname,
                    {
                        "existing_nullable": self.existing_nullable,
                        "existing_type": self.existing_type,
                        "existing_comment": self.existing_comment,
                    },
                    self.existing_server_default,
                    self.modify_server_default,
                )
            )

        if self.modify_comment is not False:
            col_diff.append(
                (
                    "modify_comment",
                    schema,
                    tname,
                    cname,
                    {
                        "existing_nullable": self.existing_nullable,
                        "existing_type": self.existing_type,
                        "existing_server_default": (
                            self.existing_server_default
                        ),
                    },
                    self.existing_comment,
                    self.modify_comment,
                )
            )

        return col_diff

    def has_changes(self) -> bool:
        hc1 = (
            self.modify_nullable is not None
            or self.modify_server_default is not False
            or self.modify_type is not None
            or self.modify_comment is not False
        )
        if hc1:
            return True
        for kw in self.kw:
            if kw.startswith("modify_"):
                return True
        else:
            return False

    def reverse(self) -> AlterColumnOp:
        kw = self.kw.copy()
        kw["existing_type"] = self.existing_type
        kw["existing_nullable"] = self.existing_nullable
        kw["existing_server_default"] = self.existing_server_default
        kw["existing_comment"] = self.existing_comment
        if self.modify_type is not None:
            kw["modify_type"] = self.modify_type
        if self.modify_nullable is not None:
            kw["modify_nullable"] = self.modify_nullable
        if self.modify_server_default is not False:
            kw["modify_server_default"] = self.modify_server_default
        if self.modify_comment is not False:
            kw["modify_comment"] = self.modify_comment

        # TODO: make this a little simpler
        all_keys = {
            m.group(1)
            for m in [re.match(r"^(?:existing_|modify_)(.+)$", k) for k in kw]
            if m
        }

        for k in all_keys:
            if "modify_%s" % k in kw:
                swap = kw["existing_%s" % k]
                kw["existing_%s" % k] = kw["modify_%s" % k]
                kw["modify_%s" % k] = swap

        return self.__class__(
            self.table_name, self.column_name, schema=self.schema, **kw
        )

    @classmethod
    def alter_column(
        cls,
        operations: Operations,
        table_name: str,
        column_name: str,
        *,
        nullable: Optional[bool] = None,
        comment: Optional[Union[str, Literal[False]]] = False,
        server_default: Any = False,
        new_column_name: Optional[str] = None,
        type_: Optional[Union[TypeEngine[Any], Type[TypeEngine[Any]]]] = None,
        existing_type: Optional[
            Union[TypeEngine[Any], Type[TypeEngine[Any]]]
        ] = None,
        existing_server_default: Optional[
            Union[str, bool, Identity, Computed]
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

        """

        alt = cls(
            table_name,
            column_name,
            schema=schema,
            existing_type=existing_type,
            existing_server_default=existing_server_default,
            existing_nullable=existing_nullable,
            existing_comment=existing_comment,
            modify_name=new_column_name,
            modify_type=type_,
            modify_server_default=server_default,
            modify_nullable=nullable,
            modify_comment=comment,
            **kw,
        )

        return operations.invoke(alt)

    @classmethod
    def batch_alter_column(
        cls,
        operations: BatchOperations,
        column_name: str,
        *,
        nullable: Optional[bool] = None,
        comment: Optional[Union[str, Literal[False]]] = False,
        server_default: Any = False,
        new_column_name: Optional[str] = None,
        type_: Optional[Union[TypeEngine[Any], Type[TypeEngine[Any]]]] = None,
        existing_type: Optional[
            Union[TypeEngine[Any], Type[TypeEngine[Any]]]
        ] = None,
        existing_server_default: Optional[
            Union[str, bool, Identity, Computed]
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


        """
        alt = cls(
            operations.impl.table_name,
            column_name,
            schema=operations.impl.schema,
            existing_type=existing_type,
            existing_server_default=existing_server_default,
            existing_nullable=existing_nullable,
            existing_comment=existing_comment,
            modify_name=new_column_name,
            modify_type=type_,
            modify_server_default=server_default,
            modify_nullable=nullable,
            modify_comment=comment,
            insert_before=insert_before,
            insert_after=insert_after,
            **kw,
        )

        return operations.invoke(alt)


@Operations.register_operation("add_column")
@BatchOperations.register_operation("add_column", "batch_add_column")
class AddColumnOp(AlterTableOp):
    """Represent an add column operation."""

    def __init__(
        self,
        table_name: str,
        column: Column[Any],
        *,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> None:
        super().__init__(table_name, schema=schema)
        self.column = column
        self.kw = kw

    def reverse(self) -> DropColumnOp:
        return DropColumnOp.from_column_and_tablename(
            self.schema, self.table_name, self.column
        )

    def to_diff_tuple(
        self,
    ) -> Tuple[str, Optional[str], str, Column[Any]]:
        return ("add_column", self.schema, self.table_name, self.column)

    def to_column(self) -> Column[Any]:
        return self.column

    @classmethod
    def from_column(cls, col: Column[Any]) -> AddColumnOp:
        return cls(col.table.name, col, schema=col.table.schema)

    @classmethod
    def from_column_and_tablename(
        cls,
        schema: Optional[str],
        tname: str,
        col: Column[Any],
    ) -> AddColumnOp:
        return cls(tname, col, schema=schema)

    @classmethod
    def add_column(
        cls,
        operations: Operations,
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

        """

        op = cls(table_name, column, schema=schema)
        return operations.invoke(op)

    @classmethod
    def batch_add_column(
        cls,
        operations: BatchOperations,
        column: Column[Any],
        *,
        insert_before: Optional[str] = None,
        insert_after: Optional[str] = None,
    ) -> None:
        """Issue an "add column" instruction using the current
        batch migration context.

        .. seealso::

            :meth:`.Operations.add_column`

        """

        kw = {}
        if insert_before:
            kw["insert_before"] = insert_before
        if insert_after:
            kw["insert_after"] = insert_after

        op = cls(
            operations.impl.table_name,
            column,
            schema=operations.impl.schema,
            **kw,
        )
        return operations.invoke(op)


@Operations.register_operation("drop_column")
@BatchOperations.register_operation("drop_column", "batch_drop_column")
class DropColumnOp(AlterTableOp):
    """Represent a drop column operation."""

    def __init__(
        self,
        table_name: str,
        column_name: str,
        *,
        schema: Optional[str] = None,
        _reverse: Optional[AddColumnOp] = None,
        **kw: Any,
    ) -> None:
        super().__init__(table_name, schema=schema)
        self.column_name = column_name
        self.kw = kw
        self._reverse = _reverse

    def to_diff_tuple(
        self,
    ) -> Tuple[str, Optional[str], str, Column[Any]]:
        return (
            "remove_column",
            self.schema,
            self.table_name,
            self.to_column(),
        )

    def reverse(self) -> AddColumnOp:
        if self._reverse is None:
            raise ValueError(
                "operation is not reversible; "
                "original column is not present"
            )

        return AddColumnOp.from_column_and_tablename(
            self.schema, self.table_name, self._reverse.column
        )

    @classmethod
    def from_column_and_tablename(
        cls,
        schema: Optional[str],
        tname: str,
        col: Column[Any],
    ) -> DropColumnOp:
        return cls(
            tname,
            col.name,
            schema=schema,
            _reverse=AddColumnOp.from_column_and_tablename(schema, tname, col),
        )

    def to_column(
        self, migration_context: Optional[MigrationContext] = None
    ) -> Column[Any]:
        if self._reverse is not None:
            return self._reverse.column
        schema_obj = schemaobj.SchemaObjects(migration_context)
        return schema_obj.column(self.column_name, NULLTYPE)

    @classmethod
    def drop_column(
        cls,
        operations: Operations,
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

        """

        op = cls(table_name, column_name, schema=schema, **kw)
        return operations.invoke(op)

    @classmethod
    def batch_drop_column(
        cls, operations: BatchOperations, column_name: str, **kw: Any
    ) -> None:
        """Issue a "drop column" instruction using the current
        batch migration context.

        .. seealso::

            :meth:`.Operations.drop_column`

        """
        op = cls(
            operations.impl.table_name,
            column_name,
            schema=operations.impl.schema,
            **kw,
        )
        return operations.invoke(op)


@Operations.register_operation("bulk_insert")
class BulkInsertOp(MigrateOperation):
    """Represent a bulk insert operation."""

    def __init__(
        self,
        table: Union[Table, TableClause],
        rows: List[Dict[str, Any]],
        *,
        multiinsert: bool = True,
    ) -> None:
        self.table = table
        self.rows = rows
        self.multiinsert = multiinsert

    @classmethod
    def bulk_insert(
        cls,
        operations: Operations,
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

        """

        op = cls(table, rows, multiinsert=multiinsert)
        operations.invoke(op)


@Operations.register_operation("execute")
@BatchOperations.register_operation("execute", "batch_execute")
class ExecuteSQLOp(MigrateOperation):
    """Represent an execute SQL operation."""

    def __init__(
        self,
        sqltext: Union[Executable, str],
        *,
        execution_options: Optional[dict[str, Any]] = None,
    ) -> None:
        self.sqltext = sqltext
        self.execution_options = execution_options

    @classmethod
    def execute(
        cls,
        operations: Operations,
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
        """
        op = cls(sqltext, execution_options=execution_options)
        return operations.invoke(op)

    @classmethod
    def batch_execute(
        cls,
        operations: Operations,
        sqltext: Union[Executable, str],
        *,
        execution_options: Optional[dict[str, Any]] = None,
    ) -> None:
        """Execute the given SQL using the current migration context.

        .. seealso::

            :meth:`.Operations.execute`

        """
        return cls.execute(
            operations, sqltext, execution_options=execution_options
        )

    def to_diff_tuple(self) -> Tuple[str, Union[Executable, str]]:
        return ("execute", self.sqltext)


class OpContainer(MigrateOperation):
    """Represent a sequence of operations operation."""

    def __init__(self, ops: Sequence[MigrateOperation] = ()) -> None:
        self.ops = list(ops)

    def is_empty(self) -> bool:
        return not self.ops

    def as_diffs(self) -> Any:
        return list(OpContainer._ops_as_diffs(self))

    @classmethod
    def _ops_as_diffs(
        cls, migrations: OpContainer
    ) -> Iterator[Tuple[Any, ...]]:
        for op in migrations.ops:
            if hasattr(op, "ops"):
                yield from cls._ops_as_diffs(cast("OpContainer", op))
            else:
                yield op.to_diff_tuple()


class ModifyTableOps(OpContainer):
    """Contains a sequence of operations that all apply to a single Table."""

    def __init__(
        self,
        table_name: str,
        ops: Sequence[MigrateOperation],
        *,
        schema: Optional[str] = None,
    ) -> None:
        super().__init__(ops)
        self.table_name = table_name
        self.schema = schema

    def reverse(self) -> ModifyTableOps:
        return ModifyTableOps(
            self.table_name,
            ops=list(reversed([op.reverse() for op in self.ops])),
            schema=self.schema,
        )


class UpgradeOps(OpContainer):
    """contains a sequence of operations that would apply to the
    'upgrade' stream of a script.

    .. seealso::

        :ref:`customizing_revision`

    """

    def __init__(
        self,
        ops: Sequence[MigrateOperation] = (),
        upgrade_token: str = "upgrades",
    ) -> None:
        super().__init__(ops=ops)
        self.upgrade_token = upgrade_token

    def reverse_into(self, downgrade_ops: DowngradeOps) -> DowngradeOps:
        downgrade_ops.ops[:] = list(
            reversed([op.reverse() for op in self.ops])
        )
        return downgrade_ops

    def reverse(self) -> DowngradeOps:
        return self.reverse_into(DowngradeOps(ops=[]))


class DowngradeOps(OpContainer):
    """contains a sequence of operations that would apply to the
    'downgrade' stream of a script.

    .. seealso::

        :ref:`customizing_revision`

    """

    def __init__(
        self,
        ops: Sequence[MigrateOperation] = (),
        downgrade_token: str = "downgrades",
    ) -> None:
        super().__init__(ops=ops)
        self.downgrade_token = downgrade_token

    def reverse(self) -> UpgradeOps:
        return UpgradeOps(
            ops=list(reversed([op.reverse() for op in self.ops]))
        )


class MigrationScript(MigrateOperation):
    """represents a migration script.

    E.g. when autogenerate encounters this object, this corresponds to the
    production of an actual script file.

    A normal :class:`.MigrationScript` object would contain a single
    :class:`.UpgradeOps` and a single :class:`.DowngradeOps` directive.
    These are accessible via the ``.upgrade_ops`` and ``.downgrade_ops``
    attributes.

    In the case of an autogenerate operation that runs multiple times,
    such as the multiple database example in the "multidb" template,
    the ``.upgrade_ops`` and ``.downgrade_ops`` attributes are disabled,
    and instead these objects should be accessed via the ``.upgrade_ops_list``
    and ``.downgrade_ops_list`` list-based attributes.  These latter
    attributes are always available at the very least as single-element lists.

    .. seealso::

        :ref:`customizing_revision`

    """

    _needs_render: Optional[bool]
    _upgrade_ops: List[UpgradeOps]
    _downgrade_ops: List[DowngradeOps]

    def __init__(
        self,
        rev_id: Optional[str],
        upgrade_ops: UpgradeOps,
        downgrade_ops: DowngradeOps,
        *,
        message: Optional[str] = None,
        imports: Set[str] = set(),
        head: Optional[str] = None,
        splice: Optional[bool] = None,
        branch_label: Optional[_RevIdType] = None,
        version_path: Optional[str] = None,
        depends_on: Optional[_RevIdType] = None,
    ) -> None:
        self.rev_id = rev_id
        self.message = message
        self.imports = imports
        self.head = head
        self.splice = splice
        self.branch_label = branch_label
        self.version_path = version_path
        self.depends_on = depends_on
        self.upgrade_ops = upgrade_ops
        self.downgrade_ops = downgrade_ops

    @property
    def upgrade_ops(self) -> Optional[UpgradeOps]:
        """An instance of :class:`.UpgradeOps`.

        .. seealso::

            :attr:`.MigrationScript.upgrade_ops_list`
        """
        if len(self._upgrade_ops) > 1:
            raise ValueError(
                "This MigrationScript instance has a multiple-entry "
                "list for UpgradeOps; please use the "
                "upgrade_ops_list attribute."
            )
        elif not self._upgrade_ops:
            return None
        else:
            return self._upgrade_ops[0]

    @upgrade_ops.setter
    def upgrade_ops(
        self, upgrade_ops: Union[UpgradeOps, List[UpgradeOps]]
    ) -> None:
        self._upgrade_ops = util.to_list(upgrade_ops)
        for elem in self._upgrade_ops:
            assert isinstance(elem, UpgradeOps)

    @property
    def downgrade_ops(self) -> Optional[DowngradeOps]:
        """An instance of :class:`.DowngradeOps`.

        .. seealso::

            :attr:`.MigrationScript.downgrade_ops_list`
        """
        if len(self._downgrade_ops) > 1:
            raise ValueError(
                "This MigrationScript instance has a multiple-entry "
                "list for DowngradeOps; please use the "
                "downgrade_ops_list attribute."
            )
        elif not self._downgrade_ops:
            return None
        else:
            return self._downgrade_ops[0]

    @downgrade_ops.setter
    def downgrade_ops(
        self, downgrade_ops: Union[DowngradeOps, List[DowngradeOps]]
    ) -> None:
        self._downgrade_ops = util.to_list(downgrade_ops)
        for elem in self._downgrade_ops:
            assert isinstance(elem, DowngradeOps)

    @property
    def upgrade_ops_list(self) -> List[UpgradeOps]:
        """A list of :class:`.UpgradeOps` instances.

        This is used in place of the :attr:`.MigrationScript.upgrade_ops`
        attribute when dealing with a revision operation that does
        multiple autogenerate passes.

        """
        return self._upgrade_ops

    @property
    def downgrade_ops_list(self) -> List[DowngradeOps]:
        """A list of :class:`.DowngradeOps` instances.

        This is used in place of the :attr:`.MigrationScript.downgrade_ops`
        attribute when dealing with a revision operation that does
        multiple autogenerate passes.

        """
        return self._downgrade_ops
