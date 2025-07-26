# sql/schema.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""The schema module provides the building blocks for database metadata.

Each element within this module describes a database entity which can be
created and dropped, or is otherwise part of such an entity.  Examples include
tables, columns, sequences, and indexes.

All entities are subclasses of :class:`~sqlalchemy.schema.SchemaItem`, and as
defined in this module they are intended to be agnostic of any vendor-specific
constructs.

A collection of entities are grouped into a unit called
:class:`~sqlalchemy.schema.MetaData`. MetaData serves as a logical grouping of
schema elements, and can also be associated with an actual database connection
such that operations involving the contained elements can contact the database
as needed.

Two of the elements here also build upon their "syntactic" counterparts, which
are defined in :class:`~sqlalchemy.sql.expression.`, specifically
:class:`~sqlalchemy.schema.Table` and :class:`~sqlalchemy.schema.Column`.
Since these objects are part of the SQL expression language, they are usable
as components in SQL expressions.

"""
from __future__ import annotations

from abc import ABC
import collections
from enum import Enum
import operator
import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import Collection
from typing import Dict
from typing import Iterable
from typing import Iterator
from typing import List
from typing import Mapping
from typing import NoReturn
from typing import Optional
from typing import overload
from typing import Sequence as _typing_Sequence
from typing import Set
from typing import Tuple
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import coercions
from . import ddl
from . import roles
from . import type_api
from . import visitors
from .base import _DefaultDescriptionTuple
from .base import _NoneName
from .base import _SentinelColumnCharacterization
from .base import _SentinelDefaultCharacterization
from .base import DedupeColumnCollection
from .base import DialectKWArgs
from .base import Executable
from .base import SchemaEventTarget as SchemaEventTarget
from .coercions import _document_text_coercion
from .elements import ClauseElement
from .elements import ColumnClause
from .elements import ColumnElement
from .elements import quoted_name
from .elements import TextClause
from .selectable import TableClause
from .type_api import to_instance
from .visitors import ExternallyTraversible
from .visitors import InternalTraversal
from .. import event
from .. import exc
from .. import inspection
from .. import util
from ..util import HasMemoized
from ..util.typing import Final
from ..util.typing import Literal
from ..util.typing import Protocol
from ..util.typing import Self
from ..util.typing import TypedDict
from ..util.typing import TypeGuard

if typing.TYPE_CHECKING:
    from ._typing import _AutoIncrementType
    from ._typing import _DDLColumnArgument
    from ._typing import _InfoType
    from ._typing import _TextCoercedExpressionArgument
    from ._typing import _TypeEngineArgument
    from .base import ReadOnlyColumnCollection
    from .compiler import DDLCompiler
    from .elements import BindParameter
    from .functions import Function
    from .type_api import TypeEngine
    from .visitors import _TraverseInternalsType
    from .visitors import anon_map
    from ..engine import Connection
    from ..engine import Engine
    from ..engine.interfaces import _CoreMultiExecuteParams
    from ..engine.interfaces import CoreExecuteOptionsParameter
    from ..engine.interfaces import ExecutionContext
    from ..engine.mock import MockConnection
    from ..engine.reflection import _ReflectionInfo
    from ..sql.selectable import FromClause

_T = TypeVar("_T", bound="Any")
_SI = TypeVar("_SI", bound="SchemaItem")
_TAB = TypeVar("_TAB", bound="Table")


_CreateDropBind = Union["Engine", "Connection", "MockConnection"]

_ConstraintNameArgument = Optional[Union[str, _NoneName]]

_ServerDefaultArgument = Union[
    "FetchedValue", str, TextClause, ColumnElement[Any]
]


class SchemaConst(Enum):
    RETAIN_SCHEMA = 1
    """Symbol indicating that a :class:`_schema.Table`, :class:`.Sequence`
    or in some cases a :class:`_schema.ForeignKey` object, in situations
    where the object is being copied for a :meth:`.Table.to_metadata`
    operation, should retain the schema name that it already has.

    """

    BLANK_SCHEMA = 2
    """Symbol indicating that a :class:`_schema.Table` or :class:`.Sequence`
    should have 'None' for its schema, even if the parent
    :class:`_schema.MetaData` has specified a schema.

    .. seealso::

        :paramref:`_schema.MetaData.schema`

        :paramref:`_schema.Table.schema`

        :paramref:`.Sequence.schema`

    """

    NULL_UNSPECIFIED = 3
    """Symbol indicating the "nullable" keyword was not passed to a Column.

    This is used to distinguish between the use case of passing
    ``nullable=None`` to a :class:`.Column`, which has special meaning
    on some backends such as SQL Server.

    """


RETAIN_SCHEMA: Final[
    Literal[SchemaConst.RETAIN_SCHEMA]
] = SchemaConst.RETAIN_SCHEMA
BLANK_SCHEMA: Final[
    Literal[SchemaConst.BLANK_SCHEMA]
] = SchemaConst.BLANK_SCHEMA
NULL_UNSPECIFIED: Final[
    Literal[SchemaConst.NULL_UNSPECIFIED]
] = SchemaConst.NULL_UNSPECIFIED


def _get_table_key(name: str, schema: Optional[str]) -> str:
    if schema is None:
        return name
    else:
        return schema + "." + name


# this should really be in sql/util.py but we'd have to
# break an import cycle
def _copy_expression(
    expression: ColumnElement[Any],
    source_table: Optional[Table],
    target_table: Optional[Table],
) -> ColumnElement[Any]:
    if source_table is None or target_table is None:
        return expression

    fixed_source_table = source_table
    fixed_target_table = target_table

    def replace(
        element: ExternallyTraversible, **kw: Any
    ) -> Optional[ExternallyTraversible]:
        if (
            isinstance(element, Column)
            and element.table is fixed_source_table
            and element.key in fixed_source_table.c
        ):
            return fixed_target_table.c[element.key]
        else:
            return None

    return cast(
        ColumnElement[Any],
        visitors.replacement_traverse(expression, {}, replace),
    )


@inspection._self_inspects
class SchemaItem(SchemaEventTarget, visitors.Visitable):
    """Base class for items that define a database schema."""

    __visit_name__ = "schema_item"

    create_drop_stringify_dialect = "default"

    def _init_items(self, *args: SchemaItem, **kw: Any) -> None:
        """Initialize the list of child items for this SchemaItem."""
        for item in args:
            if item is not None:
                try:
                    spwd = item._set_parent_with_dispatch
                except AttributeError as err:
                    raise exc.ArgumentError(
                        "'SchemaItem' object, such as a 'Column' or a "
                        f"'Constraint' expected, got {item!r}"
                    ) from err
                else:
                    spwd(self, **kw)

    def __repr__(self) -> str:
        return util.generic_repr(self, omit_kwarg=["info"])

    @util.memoized_property
    def info(self) -> _InfoType:
        """Info dictionary associated with the object, allowing user-defined
        data to be associated with this :class:`.SchemaItem`.

        The dictionary is automatically generated when first accessed.
        It can also be specified in the constructor of some objects,
        such as :class:`_schema.Table` and :class:`_schema.Column`.

        """
        return {}

    def _schema_item_copy(self, schema_item: _SI) -> _SI:
        if "info" in self.__dict__:
            schema_item.info = self.info.copy()
        schema_item.dispatch._update(self.dispatch)
        return schema_item

    _use_schema_map = True


class HasConditionalDDL:
    """define a class that includes the :meth:`.HasConditionalDDL.ddl_if`
    method, allowing for conditional rendering of DDL.

    Currently applies to constraints and indexes.

    .. versionadded:: 2.0


    """

    _ddl_if: Optional[ddl.DDLIf] = None

    def ddl_if(
        self,
        dialect: Optional[str] = None,
        callable_: Optional[ddl.DDLIfCallable] = None,
        state: Optional[Any] = None,
    ) -> Self:
        r"""apply a conditional DDL rule to this schema item.

        These rules work in a similar manner to the
        :meth:`.ExecutableDDLElement.execute_if` callable, with the added
        feature that the criteria may be checked within the DDL compilation
        phase for a construct such as :class:`.CreateTable`.
        :meth:`.HasConditionalDDL.ddl_if` currently applies towards the
        :class:`.Index` construct as well as all :class:`.Constraint`
        constructs.

        :param dialect: string name of a dialect, or a tuple of string names
         to indicate multiple dialect types.

        :param callable\_: a callable that is constructed using the same form
         as that described in
         :paramref:`.ExecutableDDLElement.execute_if.callable_`.

        :param state: any arbitrary object that will be passed to the
         callable, if present.

        .. versionadded:: 2.0

        .. seealso::

            :ref:`schema_ddl_ddl_if` - background and usage examples


        """
        self._ddl_if = ddl.DDLIf(dialect, callable_, state)
        return self


class HasSchemaAttr(SchemaItem):
    """schema item that includes a top-level schema name"""

    schema: Optional[str]


class Table(
    DialectKWArgs, HasSchemaAttr, TableClause, inspection.Inspectable["Table"]
):
    r"""Represent a table in a database.

    e.g.::

        mytable = Table(
            "mytable", metadata,
            Column('mytable_id', Integer, primary_key=True),
            Column('value', String(50))
        )

    The :class:`_schema.Table`
    object constructs a unique instance of itself based
    on its name and optional schema name within the given
    :class:`_schema.MetaData` object. Calling the :class:`_schema.Table`
    constructor with the same name and same :class:`_schema.MetaData` argument
    a second time will return the *same* :class:`_schema.Table`
    object - in this way
    the :class:`_schema.Table` constructor acts as a registry function.

    .. seealso::

        :ref:`metadata_describing` - Introduction to database metadata

    """

    __visit_name__ = "table"

    if TYPE_CHECKING:

        @util.ro_non_memoized_property
        def primary_key(self) -> PrimaryKeyConstraint:
            ...

        @util.ro_non_memoized_property
        def foreign_keys(self) -> Set[ForeignKey]:
            ...

    _columns: DedupeColumnCollection[Column[Any]]

    _sentinel_column: Optional[Column[Any]]

    constraints: Set[Constraint]
    """A collection of all :class:`_schema.Constraint` objects associated with
      this :class:`_schema.Table`.

      Includes :class:`_schema.PrimaryKeyConstraint`,
      :class:`_schema.ForeignKeyConstraint`, :class:`_schema.UniqueConstraint`,
      :class:`_schema.CheckConstraint`.  A separate collection
      :attr:`_schema.Table.foreign_key_constraints` refers to the collection
      of all :class:`_schema.ForeignKeyConstraint` objects, and the
      :attr:`_schema.Table.primary_key` attribute refers to the single
      :class:`_schema.PrimaryKeyConstraint` associated with the
      :class:`_schema.Table`.

      .. seealso::

            :attr:`_schema.Table.constraints`

            :attr:`_schema.Table.primary_key`

            :attr:`_schema.Table.foreign_key_constraints`

            :attr:`_schema.Table.indexes`

            :class:`_reflection.Inspector`


    """

    indexes: Set[Index]
    """A collection of all :class:`_schema.Index` objects associated with this
      :class:`_schema.Table`.

      .. seealso::

            :meth:`_reflection.Inspector.get_indexes`

    """

    _traverse_internals: _TraverseInternalsType = (
        TableClause._traverse_internals
        + [("schema", InternalTraversal.dp_string)]
    )

    if TYPE_CHECKING:

        @util.ro_non_memoized_property
        def columns(self) -> ReadOnlyColumnCollection[str, Column[Any]]:
            ...

        @util.ro_non_memoized_property
        def exported_columns(
            self,
        ) -> ReadOnlyColumnCollection[str, Column[Any]]:
            ...

        @util.ro_non_memoized_property
        def c(self) -> ReadOnlyColumnCollection[str, Column[Any]]:
            ...

    def _gen_cache_key(
        self, anon_map: anon_map, bindparams: List[BindParameter[Any]]
    ) -> Tuple[Any, ...]:
        if self._annotations:
            return (self,) + self._annotations_cache_key
        else:
            return (self,)

    if not typing.TYPE_CHECKING:
        # typing tools seem to be inconsistent in how they handle
        # __new__, so suggest this pattern for classes that use
        # __new__.  apply typing to the __init__ method normally
        @util.deprecated_params(
            mustexist=(
                "1.4",
                "Deprecated alias of :paramref:`_schema.Table.must_exist`",
            ),
        )
        def __new__(cls, *args: Any, **kw: Any) -> Any:
            return cls._new(*args, **kw)

    @classmethod
    def _new(cls, *args: Any, **kw: Any) -> Any:
        if not args and not kw:
            # python3k pickle seems to call this
            return object.__new__(cls)

        try:
            name, metadata, args = args[0], args[1], args[2:]
        except IndexError:
            raise TypeError(
                "Table() takes at least two positional-only "
                "arguments 'name' and 'metadata'"
            )

        schema = kw.get("schema", None)
        if schema is None:
            schema = metadata.schema
        elif schema is BLANK_SCHEMA:
            schema = None
        keep_existing = kw.get("keep_existing", False)
        extend_existing = kw.get("extend_existing", False)

        if keep_existing and extend_existing:
            msg = "keep_existing and extend_existing are mutually exclusive."
            raise exc.ArgumentError(msg)

        must_exist = kw.pop("must_exist", kw.pop("mustexist", False))
        key = _get_table_key(name, schema)
        if key in metadata.tables:
            if not keep_existing and not extend_existing and bool(args):
                raise exc.InvalidRequestError(
                    f"Table '{key}' is already defined for this MetaData "
                    "instance.  Specify 'extend_existing=True' "
                    "to redefine "
                    "options and columns on an "
                    "existing Table object."
                )
            table = metadata.tables[key]
            if extend_existing:
                table._init_existing(*args, **kw)
            return table
        else:
            if must_exist:
                raise exc.InvalidRequestError(f"Table '{key}' not defined")
            table = object.__new__(cls)
            table.dispatch.before_parent_attach(table, metadata)
            metadata._add_table(name, schema, table)
            try:
                table.__init__(name, metadata, *args, _no_init=False, **kw)
                table.dispatch.after_parent_attach(table, metadata)
                return table
            except Exception:
                with util.safe_reraise():
                    metadata._remove_table(name, schema)

    def __init__(
        self,
        name: str,
        metadata: MetaData,
        *args: SchemaItem,
        schema: Optional[Union[str, Literal[SchemaConst.BLANK_SCHEMA]]] = None,
        quote: Optional[bool] = None,
        quote_schema: Optional[bool] = None,
        autoload_with: Optional[Union[Engine, Connection]] = None,
        autoload_replace: bool = True,
        keep_existing: bool = False,
        extend_existing: bool = False,
        resolve_fks: bool = True,
        include_columns: Optional[Collection[str]] = None,
        implicit_returning: bool = True,
        comment: Optional[str] = None,
        info: Optional[Dict[Any, Any]] = None,
        listeners: Optional[
            _typing_Sequence[Tuple[str, Callable[..., Any]]]
        ] = None,
        prefixes: Optional[_typing_Sequence[str]] = None,
        # used internally in the metadata.reflect() process
        _extend_on: Optional[Set[Table]] = None,
        # used by __new__ to bypass __init__
        _no_init: bool = True,
        # dialect-specific keyword args
        **kw: Any,
    ) -> None:
        r"""Constructor for :class:`_schema.Table`.


        :param name: The name of this table as represented in the database.

            The table name, along with the value of the ``schema`` parameter,
            forms a key which uniquely identifies this :class:`_schema.Table`
            within
            the owning :class:`_schema.MetaData` collection.
            Additional calls to :class:`_schema.Table` with the same name,
            metadata,
            and schema name will return the same :class:`_schema.Table` object.

            Names which contain no upper case characters
            will be treated as case insensitive names, and will not be quoted
            unless they are a reserved word or contain special characters.
            A name with any number of upper case characters is considered
            to be case sensitive, and will be sent as quoted.

            To enable unconditional quoting for the table name, specify the flag
            ``quote=True`` to the constructor, or use the :class:`.quoted_name`
            construct to specify the name.

        :param metadata: a :class:`_schema.MetaData`
            object which will contain this
            table.  The metadata is used as a point of association of this table
            with other tables which are referenced via foreign key.  It also
            may be used to associate this table with a particular
            :class:`.Connection` or :class:`.Engine`.

        :param \*args: Additional positional arguments are used primarily
            to add the list of :class:`_schema.Column`
            objects contained within this
            table. Similar to the style of a CREATE TABLE statement, other
            :class:`.SchemaItem` constructs may be added here, including
            :class:`.PrimaryKeyConstraint`, and
            :class:`_schema.ForeignKeyConstraint`.

        :param autoload_replace: Defaults to ``True``; when using
            :paramref:`_schema.Table.autoload_with`
            in conjunction with :paramref:`_schema.Table.extend_existing`,
            indicates
            that :class:`_schema.Column` objects present in the already-existing
            :class:`_schema.Table`
            object should be replaced with columns of the same
            name retrieved from the autoload process.   When ``False``, columns
            already present under existing names will be omitted from the
            reflection process.

            Note that this setting does not impact :class:`_schema.Column` objects
            specified programmatically within the call to :class:`_schema.Table`
            that
            also is autoloading; those :class:`_schema.Column` objects will always
            replace existing columns of the same name when
            :paramref:`_schema.Table.extend_existing` is ``True``.

            .. seealso::

                :paramref:`_schema.Table.autoload_with`

                :paramref:`_schema.Table.extend_existing`

        :param autoload_with: An :class:`_engine.Engine` or
            :class:`_engine.Connection` object,
            or a :class:`_reflection.Inspector` object as returned by
            :func:`_sa.inspect`
            against one, with which this :class:`_schema.Table`
            object will be reflected.
            When set to a non-None value, the autoload process will take place
            for this table against the given engine or connection.

            .. seealso::

                :ref:`metadata_reflection_toplevel`

                :meth:`_events.DDLEvents.column_reflect`

                :ref:`metadata_reflection_dbagnostic_types`

        :param extend_existing: When ``True``, indicates that if this
            :class:`_schema.Table` is already present in the given
            :class:`_schema.MetaData`,
            apply further arguments within the constructor to the existing
            :class:`_schema.Table`.

            If :paramref:`_schema.Table.extend_existing` or
            :paramref:`_schema.Table.keep_existing` are not set,
            and the given name
            of the new :class:`_schema.Table` refers to a :class:`_schema.Table`
            that is
            already present in the target :class:`_schema.MetaData` collection,
            and
            this :class:`_schema.Table`
            specifies additional columns or other constructs
            or flags that modify the table's state, an
            error is raised.  The purpose of these two mutually-exclusive flags
            is to specify what action should be taken when a
            :class:`_schema.Table`
            is specified that matches an existing :class:`_schema.Table`,
            yet specifies
            additional constructs.

            :paramref:`_schema.Table.extend_existing`
            will also work in conjunction
            with :paramref:`_schema.Table.autoload_with` to run a new reflection
            operation against the database, even if a :class:`_schema.Table`
            of the same name is already present in the target
            :class:`_schema.MetaData`; newly reflected :class:`_schema.Column`
            objects
            and other options will be added into the state of the
            :class:`_schema.Table`, potentially overwriting existing columns
            and options of the same name.

            As is always the case with :paramref:`_schema.Table.autoload_with`,
            :class:`_schema.Column` objects can be specified in the same
            :class:`_schema.Table`
            constructor, which will take precedence.  Below, the existing
            table ``mytable`` will be augmented with :class:`_schema.Column`
            objects
            both reflected from the database, as well as the given
            :class:`_schema.Column`
            named "y"::

                Table("mytable", metadata,
                            Column('y', Integer),
                            extend_existing=True,
                            autoload_with=engine
                        )

            .. seealso::

                :paramref:`_schema.Table.autoload_with`

                :paramref:`_schema.Table.autoload_replace`

                :paramref:`_schema.Table.keep_existing`


        :param implicit_returning: True by default - indicates that
            RETURNING can be used, typically by the ORM, in order to fetch
            server-generated values such as primary key values and
            server side defaults, on those backends which support RETURNING.

            In modern SQLAlchemy there is generally no reason to alter this
            setting, except for some backend specific cases
            (see :ref:`mssql_triggers` in the SQL Server dialect documentation
            for one such example).

        :param include_columns: A list of strings indicating a subset of
            columns to be loaded via the ``autoload`` operation; table columns who
            aren't present in this list will not be represented on the resulting
            ``Table`` object. Defaults to ``None`` which indicates all columns
            should be reflected.

        :param resolve_fks: Whether or not to reflect :class:`_schema.Table`
            objects
            related to this one via :class:`_schema.ForeignKey` objects, when
            :paramref:`_schema.Table.autoload_with` is
            specified.   Defaults to True.  Set to False to disable reflection of
            related tables as :class:`_schema.ForeignKey`
            objects are encountered; may be
            used either to save on SQL calls or to avoid issues with related tables
            that can't be accessed. Note that if a related table is already present
            in the :class:`_schema.MetaData` collection, or becomes present later,
            a
            :class:`_schema.ForeignKey` object associated with this
            :class:`_schema.Table` will
            resolve to that table normally.

            .. versionadded:: 1.3

            .. seealso::

                :paramref:`.MetaData.reflect.resolve_fks`


        :param info: Optional data dictionary which will be populated into the
            :attr:`.SchemaItem.info` attribute of this object.

        :param keep_existing: When ``True``, indicates that if this Table
            is already present in the given :class:`_schema.MetaData`, ignore
            further arguments within the constructor to the existing
            :class:`_schema.Table`, and return the :class:`_schema.Table`
            object as
            originally created. This is to allow a function that wishes
            to define a new :class:`_schema.Table` on first call, but on
            subsequent calls will return the same :class:`_schema.Table`,
            without any of the declarations (particularly constraints)
            being applied a second time.

            If :paramref:`_schema.Table.extend_existing` or
            :paramref:`_schema.Table.keep_existing` are not set,
            and the given name
            of the new :class:`_schema.Table` refers to a :class:`_schema.Table`
            that is
            already present in the target :class:`_schema.MetaData` collection,
            and
            this :class:`_schema.Table`
            specifies additional columns or other constructs
            or flags that modify the table's state, an
            error is raised.  The purpose of these two mutually-exclusive flags
            is to specify what action should be taken when a
            :class:`_schema.Table`
            is specified that matches an existing :class:`_schema.Table`,
            yet specifies
            additional constructs.

            .. seealso::

                :paramref:`_schema.Table.extend_existing`

        :param listeners: A list of tuples of the form ``(<eventname>, <fn>)``
            which will be passed to :func:`.event.listen` upon construction.
            This alternate hook to :func:`.event.listen` allows the establishment
            of a listener function specific to this :class:`_schema.Table` before
            the "autoload" process begins.  Historically this has been intended
            for use with the :meth:`.DDLEvents.column_reflect` event, however
            note that this event hook may now be associated with the
            :class:`_schema.MetaData` object directly::

                def listen_for_reflect(table, column_info):
                    "handle the column reflection event"
                    # ...

                t = Table(
                    'sometable',
                    autoload_with=engine,
                    listeners=[
                        ('column_reflect', listen_for_reflect)
                    ])

            .. seealso::

                :meth:`_events.DDLEvents.column_reflect`

        :param must_exist: When ``True``, indicates that this Table must already
            be present in the given :class:`_schema.MetaData` collection, else
            an exception is raised.

        :param prefixes:
            A list of strings to insert after CREATE in the CREATE TABLE
            statement.  They will be separated by spaces.

        :param quote: Force quoting of this table's name on or off, corresponding
            to ``True`` or ``False``.  When left at its default of ``None``,
            the column identifier will be quoted according to whether the name is
            case sensitive (identifiers with at least one upper case character are
            treated as case sensitive), or if it's a reserved word.  This flag
            is only needed to force quoting of a reserved word which is not known
            by the SQLAlchemy dialect.

            .. note:: setting this flag to ``False`` will not provide
              case-insensitive behavior for table reflection; table reflection
              will always search for a mixed-case name in a case sensitive
              fashion.  Case insensitive names are specified in SQLAlchemy only
              by stating the name with all lower case characters.

        :param quote_schema: same as 'quote' but applies to the schema identifier.

        :param schema: The schema name for this table, which is required if
            the table resides in a schema other than the default selected schema
            for the engine's database connection.  Defaults to ``None``.

            If the owning :class:`_schema.MetaData` of this :class:`_schema.Table`
            specifies its
            own :paramref:`_schema.MetaData.schema` parameter,
            then that schema name will
            be applied to this :class:`_schema.Table`
            if the schema parameter here is set
            to ``None``.  To set a blank schema name on a :class:`_schema.Table`
            that
            would otherwise use the schema set on the owning
            :class:`_schema.MetaData`,
            specify the special symbol :attr:`.BLANK_SCHEMA`.

            The quoting rules for the schema name are the same as those for the
            ``name`` parameter, in that quoting is applied for reserved words or
            case-sensitive names; to enable unconditional quoting for the schema
            name, specify the flag ``quote_schema=True`` to the constructor, or use
            the :class:`.quoted_name` construct to specify the name.

        :param comment: Optional string that will render an SQL comment on table
            creation.

            .. versionadded:: 1.2 Added the :paramref:`_schema.Table.comment`
                parameter
                to :class:`_schema.Table`.

        :param \**kw: Additional keyword arguments not mentioned above are
            dialect specific, and passed in the form ``<dialectname>_<argname>``.
            See the documentation regarding an individual dialect at
            :ref:`dialect_toplevel` for detail on documented arguments.

        """  # noqa: E501
        if _no_init:
            # don't run __init__ from __new__ by default;
            # __new__ has a specific place that __init__ is called
            return

        super().__init__(quoted_name(name, quote))
        self.metadata = metadata

        if schema is None:
            self.schema = metadata.schema
        elif schema is BLANK_SCHEMA:
            self.schema = None
        else:
            quote_schema = quote_schema
            assert isinstance(schema, str)
            self.schema = quoted_name(schema, quote_schema)

        self._sentinel_column = None

        self.indexes = set()
        self.constraints = set()
        PrimaryKeyConstraint(
            _implicit_generated=True
        )._set_parent_with_dispatch(self)
        self.foreign_keys = set()  # type: ignore
        self._extra_dependencies: Set[Table] = set()
        if self.schema is not None:
            self.fullname = "%s.%s" % (self.schema, self.name)
        else:
            self.fullname = self.name

        self.implicit_returning = implicit_returning
        _reflect_info = kw.pop("_reflect_info", None)

        self.comment = comment

        if info is not None:
            self.info = info

        if listeners is not None:
            for evt, fn in listeners:
                event.listen(self, evt, fn)

        self._prefixes = prefixes if prefixes else []

        self._extra_kwargs(**kw)

        # load column definitions from the database if 'autoload' is defined
        # we do it after the table is in the singleton dictionary to support
        # circular foreign keys
        if autoload_with is not None:
            self._autoload(
                metadata,
                autoload_with,
                include_columns,
                _extend_on=_extend_on,
                _reflect_info=_reflect_info,
                resolve_fks=resolve_fks,
            )

        # initialize all the column, etc. objects.  done after reflection to
        # allow user-overrides

        self._init_items(
            *args,
            allow_replacements=extend_existing
            or keep_existing
            or autoload_with,
            all_names={},
        )

    def _autoload(
        self,
        metadata: MetaData,
        autoload_with: Union[Engine, Connection],
        include_columns: Optional[Collection[str]],
        exclude_columns: Collection[str] = (),
        resolve_fks: bool = True,
        _extend_on: Optional[Set[Table]] = None,
        _reflect_info: _ReflectionInfo | None = None,
    ) -> None:
        insp = inspection.inspect(autoload_with)
        with insp._inspection_context() as conn_insp:
            conn_insp.reflect_table(
                self,
                include_columns,
                exclude_columns,
                resolve_fks,
                _extend_on=_extend_on,
                _reflect_info=_reflect_info,
            )

    @property
    def _sorted_constraints(self) -> List[Constraint]:
        """Return the set of constraints as a list, sorted by creation
        order.

        """

        return sorted(self.constraints, key=lambda c: c._creation_order)

    @property
    def foreign_key_constraints(self) -> Set[ForeignKeyConstraint]:
        """:class:`_schema.ForeignKeyConstraint` objects referred to by this
        :class:`_schema.Table`.

        This list is produced from the collection of
        :class:`_schema.ForeignKey`
        objects currently associated.


        .. seealso::

            :attr:`_schema.Table.constraints`

            :attr:`_schema.Table.foreign_keys`

            :attr:`_schema.Table.indexes`

        """
        return {
            fkc.constraint
            for fkc in self.foreign_keys
            if fkc.constraint is not None
        }

    def _init_existing(self, *args: Any, **kwargs: Any) -> None:
        autoload_with = kwargs.pop("autoload_with", None)
        autoload = kwargs.pop("autoload", autoload_with is not None)
        autoload_replace = kwargs.pop("autoload_replace", True)
        schema = kwargs.pop("schema", None)
        _extend_on = kwargs.pop("_extend_on", None)
        _reflect_info = kwargs.pop("_reflect_info", None)

        # these arguments are only used with _init()
        extend_existing = kwargs.pop("extend_existing", False)
        keep_existing = kwargs.pop("keep_existing", False)

        assert extend_existing
        assert not keep_existing

        if schema and schema != self.schema:
            raise exc.ArgumentError(
                f"Can't change schema of existing table "
                f"from '{self.schema}' to '{schema}'",
            )

        include_columns = kwargs.pop("include_columns", None)
        if include_columns is not None:
            for c in self.c:
                if c.name not in include_columns:
                    self._columns.remove(c)

        resolve_fks = kwargs.pop("resolve_fks", True)

        for key in ("quote", "quote_schema"):
            if key in kwargs:
                raise exc.ArgumentError(
                    "Can't redefine 'quote' or 'quote_schema' arguments"
                )

        # update `self` with these kwargs, if provided
        self.comment = kwargs.pop("comment", self.comment)
        self.implicit_returning = kwargs.pop(
            "implicit_returning", self.implicit_returning
        )
        self.info = kwargs.pop("info", self.info)

        exclude_columns: _typing_Sequence[str]

        if autoload:
            if not autoload_replace:
                # don't replace columns already present.
                # we'd like to do this for constraints also however we don't
                # have simple de-duping for unnamed constraints.
                exclude_columns = [c.name for c in self.c]
            else:
                exclude_columns = ()
            self._autoload(
                self.metadata,
                autoload_with,
                include_columns,
                exclude_columns,
                resolve_fks,
                _extend_on=_extend_on,
                _reflect_info=_reflect_info,
            )

        all_names = {c.name: c for c in self.c}
        self._extra_kwargs(**kwargs)
        self._init_items(*args, allow_replacements=True, all_names=all_names)

    def _extra_kwargs(self, **kwargs: Any) -> None:
        self._validate_dialect_kwargs(kwargs)

    def _init_collections(self) -> None:
        pass

    def _reset_exported(self) -> None:
        pass

    @util.ro_non_memoized_property
    def _autoincrement_column(self) -> Optional[Column[int]]:
        return self.primary_key._autoincrement_column

    @util.ro_memoized_property
    def _sentinel_column_characteristics(
        self,
    ) -> _SentinelColumnCharacterization:
        """determine a candidate column (or columns, in case of a client
        generated composite primary key) which can be used as an
        "insert sentinel" for an INSERT statement.

        The returned structure, :class:`_SentinelColumnCharacterization`,
        includes all the details needed by :class:`.Dialect` and
        :class:`.SQLCompiler` to determine if these column(s) can be used
        as an INSERT..RETURNING sentinel for a particular database
        dialect.

        .. versionadded:: 2.0.10

        """

        sentinel_is_explicit = False
        sentinel_is_autoinc = False
        the_sentinel: Optional[_typing_Sequence[Column[Any]]] = None

        # see if a column was explicitly marked "insert_sentinel=True".
        explicit_sentinel_col = self._sentinel_column

        if explicit_sentinel_col is not None:
            the_sentinel = (explicit_sentinel_col,)
            sentinel_is_explicit = True

        autoinc_col = self._autoincrement_column
        if sentinel_is_explicit and explicit_sentinel_col is autoinc_col:
            assert autoinc_col is not None
            sentinel_is_autoinc = True
        elif explicit_sentinel_col is None and autoinc_col is not None:
            the_sentinel = (autoinc_col,)
            sentinel_is_autoinc = True

        default_characterization = _SentinelDefaultCharacterization.UNKNOWN

        if the_sentinel:
            the_sentinel_zero = the_sentinel[0]
            if the_sentinel_zero.identity:
                if the_sentinel_zero.identity._increment_is_negative:
                    if sentinel_is_explicit:
                        raise exc.InvalidRequestError(
                            "Can't use IDENTITY default with negative "
                            "increment as an explicit sentinel column"
                        )
                    else:
                        if sentinel_is_autoinc:
                            autoinc_col = None
                            sentinel_is_autoinc = False
                        the_sentinel = None
                else:
                    default_characterization = (
                        _SentinelDefaultCharacterization.IDENTITY
                    )
            elif (
                the_sentinel_zero.default is None
                and the_sentinel_zero.server_default is None
            ):
                if the_sentinel_zero.nullable:
                    raise exc.InvalidRequestError(
                        f"Column {the_sentinel_zero} has been marked as a "
                        "sentinel "
                        "column with no default generation function; it "
                        "at least needs to be marked nullable=False assuming "
                        "user-populated sentinel values will be used."
                    )
                default_characterization = (
                    _SentinelDefaultCharacterization.NONE
                )
            elif the_sentinel_zero.default is not None:
                if the_sentinel_zero.default.is_sentinel:
                    default_characterization = (
                        _SentinelDefaultCharacterization.SENTINEL_DEFAULT
                    )
                elif default_is_sequence(the_sentinel_zero.default):
                    if the_sentinel_zero.default._increment_is_negative:
                        if sentinel_is_explicit:
                            raise exc.InvalidRequestError(
                                "Can't use SEQUENCE default with negative "
                                "increment as an explicit sentinel column"
                            )
                        else:
                            if sentinel_is_autoinc:
                                autoinc_col = None
                                sentinel_is_autoinc = False
                            the_sentinel = None

                    default_characterization = (
                        _SentinelDefaultCharacterization.SEQUENCE
                    )
                elif the_sentinel_zero.default.is_callable:
                    default_characterization = (
                        _SentinelDefaultCharacterization.CLIENTSIDE
                    )
            elif the_sentinel_zero.server_default is not None:
                if sentinel_is_explicit:
                    raise exc.InvalidRequestError(
                        f"Column {the_sentinel[0]} can't be a sentinel column "
                        "because it uses an explicit server side default "
                        "that's not the Identity() default."
                    )

                default_characterization = (
                    _SentinelDefaultCharacterization.SERVERSIDE
                )

        if the_sentinel is None and self.primary_key:
            assert autoinc_col is None

            # determine for non-autoincrement pk if all elements are
            # client side
            for _pkc in self.primary_key:
                if _pkc.server_default is not None or (
                    _pkc.default and not _pkc.default.is_callable
                ):
                    break
            else:
                the_sentinel = tuple(self.primary_key)
                default_characterization = (
                    _SentinelDefaultCharacterization.CLIENTSIDE
                )

        return _SentinelColumnCharacterization(
            the_sentinel,
            sentinel_is_explicit,
            sentinel_is_autoinc,
            default_characterization,
        )

    @property
    def autoincrement_column(self) -> Optional[Column[int]]:
        """Returns the :class:`.Column` object which currently represents
        the "auto increment" column, if any, else returns None.

        This is based on the rules for :class:`.Column` as defined by the
        :paramref:`.Column.autoincrement` parameter, which generally means the
        column within a single integer column primary key constraint that is
        not constrained by a foreign key.   If the table does not have such
        a primary key constraint, then there's no "autoincrement" column.
        A :class:`.Table` may have only one column defined as the
        "autoincrement" column.

        .. versionadded:: 2.0.4

        .. seealso::

            :paramref:`.Column.autoincrement`

        """
        return self._autoincrement_column

    @property
    def key(self) -> str:
        """Return the 'key' for this :class:`_schema.Table`.

        This value is used as the dictionary key within the
        :attr:`_schema.MetaData.tables` collection.   It is typically the same
        as that of :attr:`_schema.Table.name` for a table with no
        :attr:`_schema.Table.schema`
        set; otherwise it is typically of the form
        ``schemaname.tablename``.

        """
        return _get_table_key(self.name, self.schema)

    def __repr__(self) -> str:
        return "Table(%s)" % ", ".join(
            [repr(self.name)]
            + [repr(self.metadata)]
            + [repr(x) for x in self.columns]
            + ["%s=%s" % (k, repr(getattr(self, k))) for k in ["schema"]]
        )

    def __str__(self) -> str:
        return _get_table_key(self.description, self.schema)

    def add_is_dependent_on(self, table: Table) -> None:
        """Add a 'dependency' for this Table.

        This is another Table object which must be created
        first before this one can, or dropped after this one.

        Usually, dependencies between tables are determined via
        ForeignKey objects.   However, for other situations that
        create dependencies outside of foreign keys (rules, inheriting),
        this method can manually establish such a link.

        """
        self._extra_dependencies.add(table)

    def append_column(
        self, column: ColumnClause[Any], replace_existing: bool = False
    ) -> None:
        """Append a :class:`_schema.Column` to this :class:`_schema.Table`.

        The "key" of the newly added :class:`_schema.Column`, i.e. the
        value of its ``.key`` attribute, will then be available
        in the ``.c`` collection of this :class:`_schema.Table`, and the
        column definition will be included in any CREATE TABLE, SELECT,
        UPDATE, etc. statements generated from this :class:`_schema.Table`
        construct.

        Note that this does **not** change the definition of the table
        as it exists within any underlying database, assuming that
        table has already been created in the database.   Relational
        databases support the addition of columns to existing tables
        using the SQL ALTER command, which would need to be
        emitted for an already-existing table that doesn't contain
        the newly added column.

        :param replace_existing: When ``True``, allows replacing existing
            columns. When ``False``, the default, an warning will be raised
            if a column with the same ``.key`` already exists. A future
            version of sqlalchemy will instead rise a warning.

            .. versionadded:: 1.4.0
        """

        try:
            column._set_parent_with_dispatch(
                self,
                allow_replacements=replace_existing,
                all_names={c.name: c for c in self.c},
            )
        except exc.DuplicateColumnError as de:
            raise exc.DuplicateColumnError(
                f"{de.args[0]} Specify replace_existing=True to "
                "Table.append_column() to replace an "
                "existing column."
            ) from de

    def append_constraint(self, constraint: Union[Index, Constraint]) -> None:
        """Append a :class:`_schema.Constraint` to this
        :class:`_schema.Table`.

        This has the effect of the constraint being included in any
        future CREATE TABLE statement, assuming specific DDL creation
        events have not been associated with the given
        :class:`_schema.Constraint` object.

        Note that this does **not** produce the constraint within the
        relational database automatically, for a table that already exists
        in the database.   To add a constraint to an
        existing relational database table, the SQL ALTER command must
        be used.  SQLAlchemy also provides the
        :class:`.AddConstraint` construct which can produce this SQL when
        invoked as an executable clause.

        """

        constraint._set_parent_with_dispatch(self)

    def _set_parent(self, parent: SchemaEventTarget, **kw: Any) -> None:
        metadata = parent
        assert isinstance(metadata, MetaData)
        metadata._add_table(self.name, self.schema, self)
        self.metadata = metadata

    def create(self, bind: _CreateDropBind, checkfirst: bool = False) -> None:
        """Issue a ``CREATE`` statement for this
        :class:`_schema.Table`, using the given
        :class:`.Connection` or :class:`.Engine`
        for connectivity.

        .. seealso::

            :meth:`_schema.MetaData.create_all`.

        """

        bind._run_ddl_visitor(ddl.SchemaGenerator, self, checkfirst=checkfirst)

    def drop(self, bind: _CreateDropBind, checkfirst: bool = False) -> None:
        """Issue a ``DROP`` statement for this
        :class:`_schema.Table`, using the given
        :class:`.Connection` or :class:`.Engine` for connectivity.

        .. seealso::

            :meth:`_schema.MetaData.drop_all`.

        """
        bind._run_ddl_visitor(ddl.SchemaDropper, self, checkfirst=checkfirst)

    @util.deprecated(
        "1.4",
        ":meth:`_schema.Table.tometadata` is renamed to "
        ":meth:`_schema.Table.to_metadata`",
    )
    def tometadata(
        self,
        metadata: MetaData,
        schema: Union[str, Literal[SchemaConst.RETAIN_SCHEMA]] = RETAIN_SCHEMA,
        referred_schema_fn: Optional[
            Callable[
                [Table, Optional[str], ForeignKeyConstraint, Optional[str]],
                Optional[str],
            ]
        ] = None,
        name: Optional[str] = None,
    ) -> Table:
        """Return a copy of this :class:`_schema.Table`
        associated with a different
        :class:`_schema.MetaData`.

        See :meth:`_schema.Table.to_metadata` for a full description.

        """
        return self.to_metadata(
            metadata,
            schema=schema,
            referred_schema_fn=referred_schema_fn,
            name=name,
        )

    def to_metadata(
        self,
        metadata: MetaData,
        schema: Union[str, Literal[SchemaConst.RETAIN_SCHEMA]] = RETAIN_SCHEMA,
        referred_schema_fn: Optional[
            Callable[
                [Table, Optional[str], ForeignKeyConstraint, Optional[str]],
                Optional[str],
            ]
        ] = None,
        name: Optional[str] = None,
    ) -> Table:
        """Return a copy of this :class:`_schema.Table` associated with a
        different :class:`_schema.MetaData`.

        E.g.::

            m1 = MetaData()

            user = Table('user', m1, Column('id', Integer, primary_key=True))

            m2 = MetaData()
            user_copy = user.to_metadata(m2)

        .. versionchanged:: 1.4  The :meth:`_schema.Table.to_metadata` function
           was renamed from :meth:`_schema.Table.tometadata`.


        :param metadata: Target :class:`_schema.MetaData` object,
         into which the
         new :class:`_schema.Table` object will be created.

        :param schema: optional string name indicating the target schema.
         Defaults to the special symbol :attr:`.RETAIN_SCHEMA` which indicates
         that no change to the schema name should be made in the new
         :class:`_schema.Table`.  If set to a string name, the new
         :class:`_schema.Table`
         will have this new name as the ``.schema``.  If set to ``None``, the
         schema will be set to that of the schema set on the target
         :class:`_schema.MetaData`, which is typically ``None`` as well,
         unless
         set explicitly::

            m2 = MetaData(schema='newschema')

            # user_copy_one will have "newschema" as the schema name
            user_copy_one = user.to_metadata(m2, schema=None)

            m3 = MetaData()  # schema defaults to None

            # user_copy_two will have None as the schema name
            user_copy_two = user.to_metadata(m3, schema=None)

        :param referred_schema_fn: optional callable which can be supplied
         in order to provide for the schema name that should be assigned
         to the referenced table of a :class:`_schema.ForeignKeyConstraint`.
         The callable accepts this parent :class:`_schema.Table`, the
         target schema that we are changing to, the
         :class:`_schema.ForeignKeyConstraint` object, and the existing
         "target schema" of that constraint.  The function should return the
         string schema name that should be applied.    To reset the schema
         to "none", return the symbol :data:`.BLANK_SCHEMA`.  To effect no
         change, return ``None`` or :data:`.RETAIN_SCHEMA`.

         .. versionchanged:: 1.4.33  The ``referred_schema_fn`` function
            may return the :data:`.BLANK_SCHEMA` or :data:`.RETAIN_SCHEMA`
            symbols.

         E.g.::

                def referred_schema_fn(table, to_schema,
                                                constraint, referred_schema):
                    if referred_schema == 'base_tables':
                        return referred_schema
                    else:
                        return to_schema

                new_table = table.to_metadata(m2, schema="alt_schema",
                                        referred_schema_fn=referred_schema_fn)

        :param name: optional string name indicating the target table name.
         If not specified or None, the table name is retained.  This allows
         a :class:`_schema.Table` to be copied to the same
         :class:`_schema.MetaData` target
         with a new name.

        """
        if name is None:
            name = self.name

        actual_schema: Optional[str]

        if schema is RETAIN_SCHEMA:
            actual_schema = self.schema
        elif schema is None:
            actual_schema = metadata.schema
        else:
            actual_schema = schema
        key = _get_table_key(name, actual_schema)
        if key in metadata.tables:
            util.warn(
                f"Table '{self.description}' already exists within the given "
                "MetaData - not copying."
            )
            return metadata.tables[key]

        args = []
        for col in self.columns:
            args.append(col._copy(schema=actual_schema))
        table = Table(
            name,
            metadata,
            schema=actual_schema,
            comment=self.comment,
            *args,
            **self.kwargs,
        )
        for const in self.constraints:
            if isinstance(const, ForeignKeyConstraint):
                referred_schema = const._referred_schema
                if referred_schema_fn:
                    fk_constraint_schema = referred_schema_fn(
                        self, actual_schema, const, referred_schema
                    )
                else:
                    fk_constraint_schema = (
                        actual_schema
                        if referred_schema == self.schema
                        else None
                    )
                table.append_constraint(
                    const._copy(
                        schema=fk_constraint_schema, target_table=table
                    )
                )
            elif not const._type_bound:
                # skip unique constraints that would be generated
                # by the 'unique' flag on Column
                if const._column_flag:
                    continue

                table.append_constraint(
                    const._copy(schema=actual_schema, target_table=table)
                )
        for index in self.indexes:
            # skip indexes that would be generated
            # by the 'index' flag on Column
            if index._column_flag:
                continue
            Index(
                index.name,
                unique=index.unique,
                *[
                    _copy_expression(expr, self, table)
                    for expr in index._table_bound_expressions
                ],
                _table=table,
                **index.kwargs,
            )
        return self._schema_item_copy(table)


class Column(DialectKWArgs, SchemaItem, ColumnClause[_T]):
    """Represents a column in a database table."""

    __visit_name__ = "column"

    inherit_cache = True
    key: str

    server_default: Optional[FetchedValue]

    def __init__(
        self,
        __name_pos: Optional[
            Union[str, _TypeEngineArgument[_T], SchemaEventTarget]
        ] = None,
        __type_pos: Optional[
            Union[_TypeEngineArgument[_T], SchemaEventTarget]
        ] = None,
        *args: SchemaEventTarget,
        name: Optional[str] = None,
        type_: Optional[_TypeEngineArgument[_T]] = None,
        autoincrement: _AutoIncrementType = "auto",
        default: Optional[Any] = None,
        doc: Optional[str] = None,
        key: Optional[str] = None,
        index: Optional[bool] = None,
        unique: Optional[bool] = None,
        info: Optional[_InfoType] = None,
        nullable: Optional[
            Union[bool, Literal[SchemaConst.NULL_UNSPECIFIED]]
        ] = SchemaConst.NULL_UNSPECIFIED,
        onupdate: Optional[Any] = None,
        primary_key: bool = False,
        server_default: Optional[_ServerDefaultArgument] = None,
        server_onupdate: Optional[FetchedValue] = None,
        quote: Optional[bool] = None,
        system: bool = False,
        comment: Optional[str] = None,
        insert_sentinel: bool = False,
        _omit_from_statements: bool = False,
        _proxies: Optional[Any] = None,
        **dialect_kwargs: Any,
    ):
        r"""
        Construct a new ``Column`` object.

        :param name: The name of this column as represented in the database.
          This argument may be the first positional argument, or specified
          via keyword.

          Names which contain no upper case characters
          will be treated as case insensitive names, and will not be quoted
          unless they are a reserved word.  Names with any number of upper
          case characters will be quoted and sent exactly.  Note that this
          behavior applies even for databases which standardize upper
          case names as case insensitive such as Oracle.

          The name field may be omitted at construction time and applied
          later, at any time before the Column is associated with a
          :class:`_schema.Table`.  This is to support convenient
          usage within the :mod:`~sqlalchemy.ext.declarative` extension.

        :param type\_: The column's type, indicated using an instance which
          subclasses :class:`~sqlalchemy.types.TypeEngine`.  If no arguments
          are required for the type, the class of the type can be sent
          as well, e.g.::

            # use a type with arguments
            Column('data', String(50))

            # use no arguments
            Column('level', Integer)

          The ``type`` argument may be the second positional argument
          or specified by keyword.

          If the ``type`` is ``None`` or is omitted, it will first default to
          the special type :class:`.NullType`.  If and when this
          :class:`_schema.Column` is made to refer to another column using
          :class:`_schema.ForeignKey` and/or
          :class:`_schema.ForeignKeyConstraint`, the type
          of the remote-referenced column will be copied to this column as
          well, at the moment that the foreign key is resolved against that
          remote :class:`_schema.Column` object.

        :param \*args: Additional positional arguments include various
          :class:`.SchemaItem` derived constructs which will be applied
          as options to the column.  These include instances of
          :class:`.Constraint`, :class:`_schema.ForeignKey`,
          :class:`.ColumnDefault`, :class:`.Sequence`, :class:`.Computed`
          :class:`.Identity`.  In some cases an
          equivalent keyword argument is available such as ``server_default``,
          ``default`` and ``unique``.

        :param autoincrement: Set up "auto increment" semantics for an
          **integer primary key column with no foreign key dependencies**
          (see later in this docstring for a more specific definition).
          This may influence the :term:`DDL` that will be emitted for
          this column during a table create, as well as how the column
          will be considered when INSERT statements are compiled and
          executed.

          The default value is the string ``"auto"``,
          which indicates that a single-column (i.e. non-composite) primary key
          that is of an INTEGER type with no other client-side or server-side
          default constructs indicated should receive auto increment semantics
          automatically. Other values include ``True`` (force this column to
          have auto-increment semantics for a :term:`composite primary key` as
          well), ``False`` (this column should never have auto-increment
          semantics), and the string ``"ignore_fk"`` (special-case for foreign
          key columns, see below).

          The term "auto increment semantics" refers both to the kind of DDL
          that will be emitted for the column within a CREATE TABLE statement,
          when methods such as :meth:`.MetaData.create_all` and
          :meth:`.Table.create` are invoked, as well as how the column will be
          considered when an INSERT statement is compiled and emitted to the
          database:

          * **DDL rendering** (i.e. :meth:`.MetaData.create_all`,
            :meth:`.Table.create`): When used on a :class:`.Column` that has
            no other
            default-generating construct associated with it (such as a
            :class:`.Sequence` or :class:`.Identity` construct), the parameter
            will imply that database-specific keywords such as PostgreSQL
            ``SERIAL``, MySQL ``AUTO_INCREMENT``, or ``IDENTITY`` on SQL Server
            should also be rendered.  Not every database backend has an
            "implied" default generator available; for example the Oracle
            backend always needs an explicit construct such as
            :class:`.Identity` to be included with a :class:`.Column` in order
            for the DDL rendered to include auto-generating constructs to also
            be produced in the database.

          * **INSERT semantics** (i.e. when a :func:`_sql.insert` construct is
            compiled into a SQL string and is then executed on a database using
            :meth:`_engine.Connection.execute` or equivalent): A single-row
            INSERT statement will be known to produce a new integer primary key
            value automatically for this column, which will be accessible
            after the statement is invoked via the
            :attr:`.CursorResult.inserted_primary_key` attribute upon the
            :class:`_result.Result` object.   This also applies towards use of the
            ORM when ORM-mapped objects are persisted to the database,
            indicating that a new integer primary key will be available to
            become part of the :term:`identity key` for that object.  This
            behavior takes place regardless of what DDL constructs are
            associated with the :class:`_schema.Column` and is independent
            of the "DDL Rendering" behavior discussed in the previous note
            above.

          The parameter may be set to ``True`` to indicate that a column which
          is part of a composite (i.e. multi-column) primary key should
          have autoincrement semantics, though note that only one column
          within a primary key may have this setting.    It can also
          be set to ``True`` to indicate autoincrement semantics on a
          column that has a client-side or server-side default configured,
          however note that not all dialects can accommodate all styles
          of default as an "autoincrement".  It can also be
          set to ``False`` on a single-column primary key that has a
          datatype of INTEGER in order to disable auto increment semantics
          for that column.

          The setting *only* has an effect for columns which are:

          * Integer derived (i.e. INT, SMALLINT, BIGINT).

          * Part of the primary key

          * Not referring to another column via :class:`_schema.ForeignKey`,
            unless
            the value is specified as ``'ignore_fk'``::

                # turn on autoincrement for this column despite
                # the ForeignKey()
                Column('id', ForeignKey('other.id'),
                            primary_key=True, autoincrement='ignore_fk')

          It is typically not desirable to have "autoincrement" enabled on a
          column that refers to another via foreign key, as such a column is
          required to refer to a value that originates from elsewhere.

          The setting has these effects on columns that meet the
          above criteria:

          * DDL issued for the column, if the column does not already include
            a default generating construct supported by the backend such as
            :class:`.Identity`, will include database-specific
            keywords intended to signify this column as an
            "autoincrement" column for specific backends.   Behavior for
            primary SQLAlchemy dialects includes:

            * AUTO INCREMENT on MySQL and MariaDB
            * SERIAL on PostgreSQL
            * IDENTITY on MS-SQL - this occurs even without the
              :class:`.Identity` construct as the
              :paramref:`.Column.autoincrement` parameter pre-dates this
              construct.
            * SQLite - SQLite integer primary key columns are implicitly
              "auto incrementing" and no additional keywords are rendered;
              to render the special SQLite keyword ``AUTOINCREMENT``
              is not included as this is unnecessary and not recommended
              by the database vendor.  See the section
              :ref:`sqlite_autoincrement` for more background.
            * Oracle - The Oracle dialect has no default "autoincrement"
              feature available at this time, instead the :class:`.Identity`
              construct is recommended to achieve this (the :class:`.Sequence`
              construct may also be used).
            * Third-party dialects - consult those dialects' documentation
              for details on their specific behaviors.

          * When a single-row :func:`_sql.insert` construct is compiled and
            executed, which does not set the :meth:`_sql.Insert.inline`
            modifier, newly generated primary key values for this column
            will be automatically retrieved upon statement execution
            using a method specific to the database driver in use:

            * MySQL, SQLite - calling upon ``cursor.lastrowid()``
              (see
              `https://www.python.org/dev/peps/pep-0249/#lastrowid
              <https://www.python.org/dev/peps/pep-0249/#lastrowid>`_)
            * PostgreSQL, SQL Server, Oracle - use RETURNING or an equivalent
              construct when rendering an INSERT statement, and then retrieving
              the newly generated primary key values after execution
            * PostgreSQL, Oracle for :class:`_schema.Table` objects that
              set :paramref:`_schema.Table.implicit_returning` to False -
              for a :class:`.Sequence` only, the :class:`.Sequence` is invoked
              explicitly before the INSERT statement takes place so that the
              newly generated primary key value is available to the client
            * SQL Server for :class:`_schema.Table` objects that
              set :paramref:`_schema.Table.implicit_returning` to False -
              the ``SELECT scope_identity()`` construct is used after the
              INSERT statement is invoked to retrieve the newly generated
              primary key value.
            * Third-party dialects - consult those dialects' documentation
              for details on their specific behaviors.

          * For multiple-row :func:`_sql.insert` constructs invoked with
            a list of parameters (i.e. "executemany" semantics), primary-key
            retrieving behaviors are generally disabled, however there may
            be special APIs that may be used to retrieve lists of new
            primary key values for an "executemany", such as the psycopg2
            "fast insertmany" feature.  Such features are very new and
            may not yet be well covered in documentation.

        :param default: A scalar, Python callable, or
            :class:`_expression.ColumnElement` expression representing the
            *default value* for this column, which will be invoked upon insert
            if this column is otherwise not specified in the VALUES clause of
            the insert. This is a shortcut to using :class:`.ColumnDefault` as
            a positional argument; see that class for full detail on the
            structure of the argument.

            Contrast this argument to
            :paramref:`_schema.Column.server_default`
            which creates a default generator on the database side.

            .. seealso::

                :ref:`metadata_defaults_toplevel`

        :param doc: optional String that can be used by the ORM or similar
            to document attributes on the Python side.   This attribute does
            **not** render SQL comments; use the
            :paramref:`_schema.Column.comment`
            parameter for this purpose.

        :param key: An optional string identifier which will identify this
            ``Column`` object on the :class:`_schema.Table`.
            When a key is provided,
            this is the only identifier referencing the ``Column`` within the
            application, including ORM attribute mapping; the ``name`` field
            is used only when rendering SQL.

        :param index: When ``True``, indicates that a :class:`_schema.Index`
            construct will be automatically generated for this
            :class:`_schema.Column`, which will result in a "CREATE INDEX"
            statement being emitted for the :class:`_schema.Table` when the DDL
            create operation is invoked.

            Using this flag is equivalent to making use of the
            :class:`_schema.Index` construct explicitly at the level of the
            :class:`_schema.Table` construct itself::

                Table(
                    "some_table",
                    metadata,
                    Column("x", Integer),
                    Index("ix_some_table_x", "x")
                )

            To add the :paramref:`_schema.Index.unique` flag to the
            :class:`_schema.Index`, set both the
            :paramref:`_schema.Column.unique` and
            :paramref:`_schema.Column.index` flags to True simultaneously,
            which will have the effect of rendering the "CREATE UNIQUE INDEX"
            DDL instruction instead of "CREATE INDEX".

            The name of the index is generated using the
            :ref:`default naming convention <constraint_default_naming_convention>`
            which for the :class:`_schema.Index` construct is of the form
            ``ix_<tablename>_<columnname>``.

            As this flag is intended only as a convenience for the common case
            of adding a single-column, default configured index to a table
            definition, explicit use of the :class:`_schema.Index` construct
            should be preferred for most use cases, including composite indexes
            that encompass more than one column, indexes with SQL expressions
            or ordering, backend-specific index configuration options, and
            indexes that use a specific name.

            .. note:: the :attr:`_schema.Column.index` attribute on
               :class:`_schema.Column`
               **does not indicate** if this column is indexed or not, only
               if this flag was explicitly set here.  To view indexes on
               a column, view the :attr:`_schema.Table.indexes` collection
               or use :meth:`_reflection.Inspector.get_indexes`.

            .. seealso::

                :ref:`schema_indexes`

                :ref:`constraint_naming_conventions`

                :paramref:`_schema.Column.unique`

        :param info: Optional data dictionary which will be populated into the
            :attr:`.SchemaItem.info` attribute of this object.

        :param nullable: When set to ``False``, will cause the "NOT NULL"
            phrase to be added when generating DDL for the column.   When
            ``True``, will normally generate nothing (in SQL this defaults to
            "NULL"), except in some very specific backend-specific edge cases
            where "NULL" may render explicitly.
            Defaults to ``True`` unless :paramref:`_schema.Column.primary_key`
            is also ``True`` or the column specifies a :class:`_sql.Identity`,
            in which case it defaults to ``False``.
            This parameter is only used when issuing CREATE TABLE statements.

            .. note::

                When the column specifies a :class:`_sql.Identity` this
                parameter is in general ignored by the DDL compiler. The
                PostgreSQL database allows nullable identity column by
                setting this parameter to ``True`` explicitly.

        :param onupdate: A scalar, Python callable, or
            :class:`~sqlalchemy.sql.expression.ClauseElement` representing a
            default value to be applied to the column within UPDATE
            statements, which will be invoked upon update if this column is not
            present in the SET clause of the update. This is a shortcut to
            using :class:`.ColumnDefault` as a positional argument with
            ``for_update=True``.

            .. seealso::

                :ref:`metadata_defaults` - complete discussion of onupdate

        :param primary_key: If ``True``, marks this column as a primary key
            column. Multiple columns can have this flag set to specify
            composite primary keys. As an alternative, the primary key of a
            :class:`_schema.Table` can be specified via an explicit
            :class:`.PrimaryKeyConstraint` object.

        :param server_default: A :class:`.FetchedValue` instance, str, Unicode
            or :func:`~sqlalchemy.sql.expression.text` construct representing
            the DDL DEFAULT value for the column.

            String types will be emitted as-is, surrounded by single quotes::

                Column('x', Text, server_default="val")

                x TEXT DEFAULT 'val'

            A :func:`~sqlalchemy.sql.expression.text` expression will be
            rendered as-is, without quotes::

                Column('y', DateTime, server_default=text('NOW()'))

                y DATETIME DEFAULT NOW()

            Strings and text() will be converted into a
            :class:`.DefaultClause` object upon initialization.

            This parameter can also accept complex combinations of contextually
            valid SQLAlchemy expressions or constructs::

                from sqlalchemy import create_engine
                from sqlalchemy import Table, Column, MetaData, ARRAY, Text
                from sqlalchemy.dialects.postgresql import array

                engine = create_engine(
                    'postgresql+psycopg2://scott:tiger@localhost/mydatabase'
                )
                metadata_obj = MetaData()
                tbl = Table(
                        "foo",
                        metadata_obj,
                        Column("bar",
                               ARRAY(Text),
                               server_default=array(["biz", "bang", "bash"])
                               )
                )
                metadata_obj.create_all(engine)

            The above results in a table created with the following SQL::

                CREATE TABLE foo (
                    bar TEXT[] DEFAULT ARRAY['biz', 'bang', 'bash']
                )

            Use :class:`.FetchedValue` to indicate that an already-existing
            column will generate a default value on the database side which
            will be available to SQLAlchemy for post-fetch after inserts. This
            construct does not specify any DDL and the implementation is left
            to the database, such as via a trigger.

            .. seealso::

                :ref:`server_defaults` - complete discussion of server side
                defaults

        :param server_onupdate: A :class:`.FetchedValue` instance
            representing a database-side default generation function,
            such as a trigger. This
            indicates to SQLAlchemy that a newly generated value will be
            available after updates. This construct does not actually
            implement any kind of generation function within the database,
            which instead must be specified separately.


            .. warning:: This directive **does not** currently produce MySQL's
               "ON UPDATE CURRENT_TIMESTAMP()" clause.  See
               :ref:`mysql_timestamp_onupdate` for background on how to
               produce this clause.

            .. seealso::

                :ref:`triggered_columns`

        :param quote: Force quoting of this column's name on or off,
             corresponding to ``True`` or ``False``. When left at its default
             of ``None``, the column identifier will be quoted according to
             whether the name is case sensitive (identifiers with at least one
             upper case character are treated as case sensitive), or if it's a
             reserved word. This flag is only needed to force quoting of a
             reserved word which is not known by the SQLAlchemy dialect.

        :param unique: When ``True``, and the :paramref:`_schema.Column.index`
            parameter is left at its default value of ``False``,
            indicates that a :class:`_schema.UniqueConstraint`
            construct will be automatically generated for this
            :class:`_schema.Column`,
            which will result in a "UNIQUE CONSTRAINT" clause referring
            to this column being included
            in the ``CREATE TABLE`` statement emitted, when the DDL create
            operation for the :class:`_schema.Table` object is invoked.

            When this flag is ``True`` while the
            :paramref:`_schema.Column.index` parameter is simultaneously
            set to ``True``, the effect instead is that a
            :class:`_schema.Index` construct which includes the
            :paramref:`_schema.Index.unique` parameter set to ``True``
            is generated.  See the documentation for
            :paramref:`_schema.Column.index` for additional detail.

            Using this flag is equivalent to making use of the
            :class:`_schema.UniqueConstraint` construct explicitly at the
            level of the :class:`_schema.Table` construct itself::

                Table(
                    "some_table",
                    metadata,
                    Column("x", Integer),
                    UniqueConstraint("x")
                )

            The :paramref:`_schema.UniqueConstraint.name` parameter
            of the unique constraint object is left at its default value
            of ``None``; in the absence of a :ref:`naming convention <constraint_naming_conventions>`
            for the enclosing :class:`_schema.MetaData`, the UNIQUE CONSTRAINT
            construct will be emitted as unnamed, which typically invokes
            a database-specific naming convention to take place.

            As this flag is intended only as a convenience for the common case
            of adding a single-column, default configured unique constraint to a table
            definition, explicit use of the :class:`_schema.UniqueConstraint` construct
            should be preferred for most use cases, including composite constraints
            that encompass more than one column, backend-specific index configuration options, and
            constraints that use a specific name.

            .. note:: the :attr:`_schema.Column.unique` attribute on
                :class:`_schema.Column`
                **does not indicate** if this column has a unique constraint or
                not, only if this flag was explicitly set here.  To view
                indexes and unique constraints that may involve this column,
                view the
                :attr:`_schema.Table.indexes` and/or
                :attr:`_schema.Table.constraints` collections or use
                :meth:`_reflection.Inspector.get_indexes` and/or
                :meth:`_reflection.Inspector.get_unique_constraints`

            .. seealso::

                :ref:`schema_unique_constraint`

                :ref:`constraint_naming_conventions`

                :paramref:`_schema.Column.index`

        :param system: When ``True``, indicates this is a "system" column,
             that is a column which is automatically made available by the
             database, and should not be included in the columns list for a
             ``CREATE TABLE`` statement.

             For more elaborate scenarios where columns should be
             conditionally rendered differently on different backends,
             consider custom compilation rules for :class:`.CreateColumn`.

        :param comment: Optional string that will render an SQL comment on
             table creation.

             .. versionadded:: 1.2 Added the
                :paramref:`_schema.Column.comment`
                parameter to :class:`_schema.Column`.

        :param insert_sentinel: Marks this :class:`_schema.Column` as an
         :term:`insert sentinel` used for optimizing the performance of the
         :term:`insertmanyvalues` feature for tables that don't
         otherwise have qualifying primary key configurations.

         .. versionadded:: 2.0.10

         .. seealso::

            :func:`_schema.insert_sentinel` - all in one helper for declaring
            sentinel columns

            :ref:`engine_insertmanyvalues`

            :ref:`engine_insertmanyvalues_sentinel_columns`


        """  # noqa: E501, RST201, RST202

        l_args = [__name_pos, __type_pos] + list(args)
        del args

        if l_args:
            if isinstance(l_args[0], str):
                if name is not None:
                    raise exc.ArgumentError(
                        "May not pass name positionally and as a keyword."
                    )
                name = l_args.pop(0)  # type: ignore
            elif l_args[0] is None:
                l_args.pop(0)
        if l_args:
            coltype = l_args[0]

            if hasattr(coltype, "_sqla_type"):
                if type_ is not None:
                    raise exc.ArgumentError(
                        "May not pass type_ positionally and as a keyword."
                    )
                type_ = l_args.pop(0)  # type: ignore
            elif l_args[0] is None:
                l_args.pop(0)

        if name is not None:
            name = quoted_name(name, quote)
        elif quote is not None:
            raise exc.ArgumentError(
                "Explicit 'name' is required when " "sending 'quote' argument"
            )

        # name = None is expected to be an interim state
        # note this use case is legacy now that ORM declarative has a
        # dedicated "column" construct local to the ORM
        super().__init__(name, type_)  # type: ignore

        self.key = key if key is not None else name  # type: ignore
        self.primary_key = primary_key
        self._insert_sentinel = insert_sentinel
        self._omit_from_statements = _omit_from_statements
        self._user_defined_nullable = udn = nullable
        if udn is not NULL_UNSPECIFIED:
            self.nullable = udn
        else:
            self.nullable = not primary_key

        # these default to None because .index and .unique is *not*
        # an informational flag about Column - there can still be an
        # Index or UniqueConstraint referring to this Column.
        self.index = index
        self.unique = unique

        self.system = system
        self.doc = doc
        self.autoincrement: _AutoIncrementType = autoincrement
        self.constraints = set()
        self.foreign_keys = set()
        self.comment = comment
        self.computed = None
        self.identity = None

        # check if this Column is proxying another column

        if _proxies is not None:
            self._proxies = _proxies
        else:
            # otherwise, add DDL-related events
            self._set_type(self.type)

        if default is not None:
            if not isinstance(default, (ColumnDefault, Sequence)):
                default = ColumnDefault(default)

            self.default = default
            l_args.append(default)
        else:
            self.default = None

        if onupdate is not None:
            if not isinstance(onupdate, (ColumnDefault, Sequence)):
                onupdate = ColumnDefault(onupdate, for_update=True)

            self.onupdate = onupdate
            l_args.append(onupdate)
        else:
            self.onupdate = None

        if server_default is not None:
            if isinstance(server_default, FetchedValue):
                server_default = server_default._as_for_update(False)
                l_args.append(server_default)
            else:
                server_default = DefaultClause(server_default)
                l_args.append(server_default)
        self.server_default = server_default

        if server_onupdate is not None:
            if isinstance(server_onupdate, FetchedValue):
                server_onupdate = server_onupdate._as_for_update(True)
                l_args.append(server_onupdate)
            else:
                server_onupdate = DefaultClause(
                    server_onupdate, for_update=True
                )
                l_args.append(server_onupdate)
        self.server_onupdate = server_onupdate

        self._init_items(*cast(_typing_Sequence[SchemaItem], l_args))

        util.set_creation_order(self)

        if info is not None:
            self.info = info

        self._extra_kwargs(**dialect_kwargs)

    table: Table

    constraints: Set[Constraint]

    foreign_keys: Set[ForeignKey]
    """A collection of all :class:`_schema.ForeignKey` marker objects
       associated with this :class:`_schema.Column`.

       Each object is a member of a :class:`_schema.Table`-wide
       :class:`_schema.ForeignKeyConstraint`.

       .. seealso::

           :attr:`_schema.Table.foreign_keys`

    """

    index: Optional[bool]
    """The value of the :paramref:`_schema.Column.index` parameter.

       Does not indicate if this :class:`_schema.Column` is actually indexed
       or not; use :attr:`_schema.Table.indexes`.

       .. seealso::

           :attr:`_schema.Table.indexes`
    """

    unique: Optional[bool]
    """The value of the :paramref:`_schema.Column.unique` parameter.

       Does not indicate if this :class:`_schema.Column` is actually subject to
       a unique constraint or not; use :attr:`_schema.Table.indexes` and
       :attr:`_schema.Table.constraints`.

       .. seealso::

           :attr:`_schema.Table.indexes`

           :attr:`_schema.Table.constraints`.

    """

    computed: Optional[Computed]

    identity: Optional[Identity]

    def _set_type(self, type_: TypeEngine[Any]) -> None:
        assert self.type._isnull or type_ is self.type

        self.type = type_
        if isinstance(self.type, SchemaEventTarget):
            self.type._set_parent_with_dispatch(self)
        for impl in self.type._variant_mapping.values():
            if isinstance(impl, SchemaEventTarget):
                impl._set_parent_with_dispatch(self)

    @HasMemoized.memoized_attribute
    def _default_description_tuple(self) -> _DefaultDescriptionTuple:
        """used by default.py -> _process_execute_defaults()"""

        return _DefaultDescriptionTuple._from_column_default(self.default)

    @HasMemoized.memoized_attribute
    def _onupdate_description_tuple(self) -> _DefaultDescriptionTuple:
        """used by default.py -> _process_execute_defaults()"""
        return _DefaultDescriptionTuple._from_column_default(self.onupdate)

    @util.memoized_property
    def _gen_static_annotations_cache_key(self) -> bool:  # type: ignore
        """special attribute used by cache key gen, if true, we will
        use a static cache key for the annotations dictionary, else we
        will generate a new cache key for annotations each time.

        Added for #8790

        """
        return self.table is not None and self.table._is_table

    def _extra_kwargs(self, **kwargs: Any) -> None:
        self._validate_dialect_kwargs(kwargs)

    def __str__(self) -> str:
        if self.name is None:
            return "(no name)"
        elif self.table is not None:
            if self.table.named_with_column:
                return self.table.description + "." + self.description
            else:
                return self.description
        else:
            return self.description

    def references(self, column: Column[Any]) -> bool:
        """Return True if this Column references the given column via foreign
        key."""

        for fk in self.foreign_keys:
            if fk.column.proxy_set.intersection(column.proxy_set):
                return True
        else:
            return False

    def append_foreign_key(self, fk: ForeignKey) -> None:
        fk._set_parent_with_dispatch(self)

    def __repr__(self) -> str:
        kwarg = []
        if self.key != self.name:
            kwarg.append("key")
        if self.primary_key:
            kwarg.append("primary_key")
        if not self.nullable:
            kwarg.append("nullable")
        if self.onupdate:
            kwarg.append("onupdate")
        if self.default:
            kwarg.append("default")
        if self.server_default:
            kwarg.append("server_default")
        if self.comment:
            kwarg.append("comment")
        return "Column(%s)" % ", ".join(
            [repr(self.name)]
            + [repr(self.type)]
            + [repr(x) for x in self.foreign_keys if x is not None]
            + [repr(x) for x in self.constraints]
            + [
                (
                    self.table is not None
                    and "table=<%s>" % self.table.description
                    or "table=None"
                )
            ]
            + ["%s=%s" % (k, repr(getattr(self, k))) for k in kwarg]
        )

    def _set_parent(  # type: ignore[override]
        self,
        parent: SchemaEventTarget,
        *,
        all_names: Dict[str, Column[Any]],
        allow_replacements: bool,
        **kw: Any,
    ) -> None:
        table = parent
        assert isinstance(table, Table)
        if not self.name:
            raise exc.ArgumentError(
                "Column must be constructed with a non-blank name or "
                "assign a non-blank .name before adding to a Table."
            )

        self._reset_memoizations()

        if self.key is None:
            self.key = self.name

        existing = getattr(self, "table", None)
        if existing is not None and existing is not table:
            raise exc.ArgumentError(
                f"Column object '{self.key}' already "
                f"assigned to Table '{existing.description}'"
            )

        extra_remove = None
        existing_col = None
        conflicts_on = ""

        if self.key in table._columns:
            existing_col = table._columns[self.key]
            if self.key == self.name:
                conflicts_on = "name"
            else:
                conflicts_on = "key"
        elif self.name in all_names:
            existing_col = all_names[self.name]
            extra_remove = {existing_col}
            conflicts_on = "name"

        if existing_col is not None:
            if existing_col is not self:
                if not allow_replacements:
                    raise exc.DuplicateColumnError(
                        f"A column with {conflicts_on} "
                        f"""'{
                            self.key if conflicts_on == 'key' else self.name
                        }' """
                        f"is already present in table '{table.name}'."
                    )
                for fk in existing_col.foreign_keys:
                    table.foreign_keys.remove(fk)
                    if fk.constraint in table.constraints:
                        # this might have been removed
                        # already, if it's a composite constraint
                        # and more than one col being replaced
                        table.constraints.remove(fk.constraint)

        if extra_remove and existing_col is not None and self.key == self.name:
            util.warn(
                f'Column with user-specified key "{existing_col.key}" is '
                "being replaced with "
                f'plain named column "{self.name}", '
                f'key "{existing_col.key}" is being removed.  If this is a '
                "reflection operation, specify autoload_replace=False to "
                "prevent this replacement."
            )
        table._columns.replace(self, extra_remove=extra_remove)
        all_names[self.name] = self
        self.table = table

        if self._insert_sentinel:
            if self.table._sentinel_column is not None:
                raise exc.ArgumentError(
                    "a Table may have only one explicit sentinel column"
                )
            self.table._sentinel_column = self

        if self.primary_key:
            table.primary_key._replace(self)
        elif self.key in table.primary_key:
            raise exc.ArgumentError(
                f"Trying to redefine primary-key column '{self.key}' as a "
                f"non-primary-key column on table '{table.fullname}'"
            )

        if self.index:
            if isinstance(self.index, str):
                raise exc.ArgumentError(
                    "The 'index' keyword argument on Column is boolean only. "
                    "To create indexes with a specific name, create an "
                    "explicit Index object external to the Table."
                )
            table.append_constraint(
                Index(
                    None, self.key, unique=bool(self.unique), _column_flag=True
                )
            )

        elif self.unique:
            if isinstance(self.unique, str):
                raise exc.ArgumentError(
                    "The 'unique' keyword argument on Column is boolean "
                    "only. To create unique constraints or indexes with a "
                    "specific name, append an explicit UniqueConstraint to "
                    "the Table's list of elements, or create an explicit "
                    "Index object external to the Table."
                )
            table.append_constraint(
                UniqueConstraint(self.key, _column_flag=True)
            )

        self._setup_on_memoized_fks(lambda fk: fk._set_remote_table(table))

        if self.identity and (
            isinstance(self.default, Sequence)
            or isinstance(self.onupdate, Sequence)
        ):
            raise exc.ArgumentError(
                "An column cannot specify both Identity and Sequence."
            )

    def _setup_on_memoized_fks(self, fn: Callable[..., Any]) -> None:
        fk_keys = [
            ((self.table.key, self.key), False),
            ((self.table.key, self.name), True),
        ]
        for fk_key, link_to_name in fk_keys:
            if fk_key in self.table.metadata._fk_memos:
                for fk in self.table.metadata._fk_memos[fk_key]:
                    if fk.link_to_name is link_to_name:
                        fn(fk)

    def _on_table_attach(self, fn: Callable[..., Any]) -> None:
        if self.table is not None:
            fn(self, self.table)
        else:
            event.listen(self, "after_parent_attach", fn)

    @util.deprecated(
        "1.4",
        "The :meth:`_schema.Column.copy` method is deprecated "
        "and will be removed in a future release.",
    )
    def copy(self, **kw: Any) -> Column[Any]:
        return self._copy(**kw)

    def _copy(self, **kw: Any) -> Column[Any]:
        """Create a copy of this ``Column``, uninitialized.

        This is used in :meth:`_schema.Table.to_metadata` and by the ORM.

        """

        # Constraint objects plus non-constraint-bound ForeignKey objects
        args: List[SchemaItem] = [
            c._copy(**kw) for c in self.constraints if not c._type_bound
        ] + [c._copy(**kw) for c in self.foreign_keys if not c.constraint]

        # ticket #5276
        column_kwargs = {}
        for dialect_name in self.dialect_options:
            dialect_options = self.dialect_options[dialect_name]._non_defaults
            for (
                dialect_option_key,
                dialect_option_value,
            ) in dialect_options.items():
                column_kwargs[
                    dialect_name + "_" + dialect_option_key
                ] = dialect_option_value

        server_default = self.server_default
        server_onupdate = self.server_onupdate
        if isinstance(server_default, (Computed, Identity)):
            # TODO: likely should be copied in all cases
            args.append(server_default._copy(**kw))
            server_default = server_onupdate = None

        type_ = self.type
        if isinstance(type_, SchemaEventTarget):
            type_ = type_.copy(**kw)

        # TODO: DefaultGenerator is not copied here!  it's just used again
        # with _set_parent() pointing to the old column.  see the new
        # use of _copy() in the new _merge() method

        c = self._constructor(
            name=self.name,
            type_=type_,
            key=self.key,
            primary_key=self.primary_key,
            unique=self.unique,
            system=self.system,
            # quote=self.quote,  # disabled 2013-08-27 (commit 031ef080)
            index=self.index,
            autoincrement=self.autoincrement,
            default=self.default,
            server_default=server_default,
            onupdate=self.onupdate,
            server_onupdate=server_onupdate,
            doc=self.doc,
            comment=self.comment,
            _omit_from_statements=self._omit_from_statements,
            insert_sentinel=self._insert_sentinel,
            *args,
            **column_kwargs,
        )

        # copy the state of "nullable" exactly, to accommodate for
        # ORM flipping the .nullable flag directly
        c.nullable = self.nullable
        c._user_defined_nullable = self._user_defined_nullable

        return self._schema_item_copy(c)

    def _merge(self, other: Column[Any]) -> None:
        """merge the elements of another column into this one.

        this is used by ORM pep-593 merge and will likely need a lot
        of fixes.


        """

        if self.primary_key:
            other.primary_key = True

        if self.autoincrement != "auto" and other.autoincrement == "auto":
            other.autoincrement = self.autoincrement

        if self.system:
            other.system = self.system

        if self.info:
            other.info.update(self.info)

        type_ = self.type
        if not type_._isnull and other.type._isnull:
            if isinstance(type_, SchemaEventTarget):
                type_ = type_.copy()

            other.type = type_

            if isinstance(type_, SchemaEventTarget):
                type_._set_parent_with_dispatch(other)

            for impl in type_._variant_mapping.values():
                if isinstance(impl, SchemaEventTarget):
                    impl._set_parent_with_dispatch(other)

        if (
            self._user_defined_nullable is not NULL_UNSPECIFIED
            and other._user_defined_nullable is NULL_UNSPECIFIED
        ):
            other.nullable = self.nullable
            other._user_defined_nullable = self._user_defined_nullable

        if self.default is not None and other.default is None:
            new_default = self.default._copy()
            new_default._set_parent(other)

        if self.server_default and other.server_default is None:
            new_server_default = self.server_default
            if isinstance(new_server_default, FetchedValue):
                new_server_default = new_server_default._copy()
                new_server_default._set_parent(other)
            else:
                other.server_default = new_server_default

        if self.server_onupdate and other.server_onupdate is None:
            new_server_onupdate = self.server_onupdate
            new_server_onupdate = new_server_onupdate._copy()
            new_server_onupdate._set_parent(other)

        if self.onupdate and other.onupdate is None:
            new_onupdate = self.onupdate._copy()
            new_onupdate._set_parent(other)

        if self.index and not other.index:
            other.index = True

        if self.doc and other.doc is None:
            other.doc = self.doc

        if self.comment and other.comment is None:
            other.comment = self.comment

        if self.unique and not other.unique:
            other.unique = True

        for const in self.constraints:
            if not const._type_bound:
                new_const = const._copy()
                new_const._set_parent(other)

        for fk in self.foreign_keys:
            if not fk.constraint:
                new_fk = fk._copy()
                new_fk._set_parent(other)

    def _make_proxy(
        self,
        selectable: FromClause,
        name: Optional[str] = None,
        key: Optional[str] = None,
        name_is_truncatable: bool = False,
        compound_select_cols: Optional[
            _typing_Sequence[ColumnElement[Any]]
        ] = None,
        **kw: Any,
    ) -> Tuple[str, ColumnClause[_T]]:
        """Create a *proxy* for this column.

        This is a copy of this ``Column`` referenced by a different parent
        (such as an alias or select statement).  The column should
        be used only in select scenarios, as its full DDL/default
        information is not transferred.

        """

        fk = [
            ForeignKey(
                col if col is not None else f._colspec,
                _unresolvable=col is None,
                _constraint=f.constraint,
            )
            for f, col in [
                (fk, fk._resolve_column(raiseerr=False))
                for fk in self.foreign_keys
            ]
        ]

        if name is None and self.name is None:
            raise exc.InvalidRequestError(
                "Cannot initialize a sub-selectable"
                " with this Column object until its 'name' has "
                "been assigned."
            )
        try:
            c = self._constructor(
                coercions.expect(
                    roles.TruncatedLabelRole, name if name else self.name
                )
                if name_is_truncatable
                else (name or self.name),
                self.type,
                # this may actually be ._proxy_key when the key is incoming
                key=key if key else name if name else self.key,
                primary_key=self.primary_key,
                nullable=self.nullable,
                _proxies=list(compound_select_cols)
                if compound_select_cols
                else [self],
                *fk,
            )
        except TypeError as err:
            raise TypeError(
                "Could not create a copy of this %r object.  "
                "Ensure the class includes a _constructor() "
                "attribute or method which accepts the "
                "standard Column constructor arguments, or "
                "references the Column class itself." % self.__class__
            ) from err

        c.table = selectable
        c._propagate_attrs = selectable._propagate_attrs
        if selectable._is_clone_of is not None:
            c._is_clone_of = selectable._is_clone_of.columns.get(c.key)
        if self.primary_key:
            selectable.primary_key.add(c)  # type: ignore
        if fk:
            selectable.foreign_keys.update(fk)  # type: ignore
        return c.key, c


def insert_sentinel(
    name: Optional[str] = None,
    type_: Optional[_TypeEngineArgument[_T]] = None,
    *,
    default: Optional[Any] = None,
    omit_from_statements: bool = True,
) -> Column[Any]:
    """Provides a surrogate :class:`_schema.Column` that will act as a
    dedicated insert :term:`sentinel` column, allowing efficient bulk
    inserts with deterministic RETURNING sorting for tables that
    don't otherwise have qualifying primary key configurations.

    Adding this column to a :class:`.Table` object requires that a
    corresponding database table actually has this column present, so if adding
    it to an existing model, existing database tables would need to be migrated
    (e.g. using ALTER TABLE or similar) to include this column.

    For background on how this object is used, see the section
    :ref:`engine_insertmanyvalues_sentinel_columns` as part of the
    section :ref:`engine_insertmanyvalues`.

    The :class:`_schema.Column` returned will be a nullable integer column by
    default and make use of a sentinel-specific default generator used only in
    "insertmanyvalues" operations.

    .. seealso::

        :func:`_orm.orm_insert_sentinel`

        :paramref:`_schema.Column.insert_sentinel`

        :ref:`engine_insertmanyvalues`

        :ref:`engine_insertmanyvalues_sentinel_columns`


    .. versionadded:: 2.0.10

    """
    return Column(
        name=name,
        type_=type_api.INTEGERTYPE if type_ is None else type_,
        default=default
        if default is not None
        else _InsertSentinelColumnDefault(),
        _omit_from_statements=omit_from_statements,
        insert_sentinel=True,
    )


class ForeignKey(DialectKWArgs, SchemaItem):
    """Defines a dependency between two columns.

    ``ForeignKey`` is specified as an argument to a :class:`_schema.Column`
    object,
    e.g.::

        t = Table("remote_table", metadata,
            Column("remote_id", ForeignKey("main_table.id"))
        )

    Note that ``ForeignKey`` is only a marker object that defines
    a dependency between two columns.   The actual constraint
    is in all cases represented by the :class:`_schema.ForeignKeyConstraint`
    object.   This object will be generated automatically when
    a ``ForeignKey`` is associated with a :class:`_schema.Column` which
    in turn is associated with a :class:`_schema.Table`.   Conversely,
    when :class:`_schema.ForeignKeyConstraint` is applied to a
    :class:`_schema.Table`,
    ``ForeignKey`` markers are automatically generated to be
    present on each associated :class:`_schema.Column`, which are also
    associated with the constraint object.

    Note that you cannot define a "composite" foreign key constraint,
    that is a constraint between a grouping of multiple parent/child
    columns, using ``ForeignKey`` objects.   To define this grouping,
    the :class:`_schema.ForeignKeyConstraint` object must be used, and applied
    to the :class:`_schema.Table`.   The associated ``ForeignKey`` objects
    are created automatically.

    The ``ForeignKey`` objects associated with an individual
    :class:`_schema.Column`
    object are available in the `foreign_keys` collection
    of that column.

    Further examples of foreign key configuration are in
    :ref:`metadata_foreignkeys`.

    """

    __visit_name__ = "foreign_key"

    parent: Column[Any]

    _table_column: Optional[Column[Any]]

    def __init__(
        self,
        column: _DDLColumnArgument,
        _constraint: Optional[ForeignKeyConstraint] = None,
        use_alter: bool = False,
        name: _ConstraintNameArgument = None,
        onupdate: Optional[str] = None,
        ondelete: Optional[str] = None,
        deferrable: Optional[bool] = None,
        initially: Optional[str] = None,
        link_to_name: bool = False,
        match: Optional[str] = None,
        info: Optional[_InfoType] = None,
        comment: Optional[str] = None,
        _unresolvable: bool = False,
        **dialect_kw: Any,
    ):
        r"""
        Construct a column-level FOREIGN KEY.

        The :class:`_schema.ForeignKey` object when constructed generates a
        :class:`_schema.ForeignKeyConstraint`
        which is associated with the parent
        :class:`_schema.Table` object's collection of constraints.

        :param column: A single target column for the key relationship. A
            :class:`_schema.Column` object or a column name as a string:
            ``tablename.columnkey`` or ``schema.tablename.columnkey``.
            ``columnkey`` is the ``key`` which has been assigned to the column
            (defaults to the column name itself), unless ``link_to_name`` is
            ``True`` in which case the rendered name of the column is used.

        :param name: Optional string. An in-database name for the key if
            `constraint` is not provided.

        :param onupdate: Optional string. If set, emit ON UPDATE <value> when
            issuing DDL for this constraint. Typical values include CASCADE,
            DELETE and RESTRICT.

        :param ondelete: Optional string. If set, emit ON DELETE <value> when
            issuing DDL for this constraint. Typical values include CASCADE,
            DELETE and RESTRICT.

        :param deferrable: Optional bool. If set, emit DEFERRABLE or NOT
            DEFERRABLE when issuing DDL for this constraint.

        :param initially: Optional string. If set, emit INITIALLY <value> when
            issuing DDL for this constraint.

        :param link_to_name: if True, the string name given in ``column`` is
            the rendered name of the referenced column, not its locally
            assigned ``key``.

        :param use_alter: passed to the underlying
            :class:`_schema.ForeignKeyConstraint`
            to indicate the constraint should
            be generated/dropped externally from the CREATE TABLE/ DROP TABLE
            statement.  See :paramref:`_schema.ForeignKeyConstraint.use_alter`
            for further description.

            .. seealso::

                :paramref:`_schema.ForeignKeyConstraint.use_alter`

                :ref:`use_alter`

        :param match: Optional string. If set, emit MATCH <value> when issuing
            DDL for this constraint. Typical values include SIMPLE, PARTIAL
            and FULL.

        :param info: Optional data dictionary which will be populated into the
            :attr:`.SchemaItem.info` attribute of this object.

        :param comment: Optional string that will render an SQL comment on
          foreign key constraint creation.

            .. versionadded:: 2.0

        :param \**dialect_kw:  Additional keyword arguments are dialect
            specific, and passed in the form ``<dialectname>_<argname>``.  The
            arguments are ultimately handled by a corresponding
            :class:`_schema.ForeignKeyConstraint`.
            See the documentation regarding
            an individual dialect at :ref:`dialect_toplevel` for detail on
            documented arguments.

        """

        self._colspec = coercions.expect(roles.DDLReferredColumnRole, column)
        self._unresolvable = _unresolvable

        if isinstance(self._colspec, str):
            self._table_column = None
        else:
            self._table_column = self._colspec

            if not isinstance(
                self._table_column.table, (type(None), TableClause)
            ):
                raise exc.ArgumentError(
                    "ForeignKey received Column not bound "
                    "to a Table, got: %r" % self._table_column.table
                )

        # the linked ForeignKeyConstraint.
        # ForeignKey will create this when parent Column
        # is attached to a Table, *or* ForeignKeyConstraint
        # object passes itself in when creating ForeignKey
        # markers.
        self.constraint = _constraint

        # .parent is not Optional under normal use
        self.parent = None  # type: ignore

        self.use_alter = use_alter
        self.name = name
        self.onupdate = onupdate
        self.ondelete = ondelete
        self.deferrable = deferrable
        self.initially = initially
        self.link_to_name = link_to_name
        self.match = match
        self.comment = comment
        if info:
            self.info = info
        self._unvalidated_dialect_kw = dialect_kw

    def __repr__(self) -> str:
        return "ForeignKey(%r)" % self._get_colspec()

    @util.deprecated(
        "1.4",
        "The :meth:`_schema.ForeignKey.copy` method is deprecated "
        "and will be removed in a future release.",
    )
    def copy(self, *, schema: Optional[str] = None, **kw: Any) -> ForeignKey:
        return self._copy(schema=schema, **kw)

    def _copy(self, *, schema: Optional[str] = None, **kw: Any) -> ForeignKey:
        """Produce a copy of this :class:`_schema.ForeignKey` object.

        The new :class:`_schema.ForeignKey` will not be bound
        to any :class:`_schema.Column`.

        This method is usually used by the internal
        copy procedures of :class:`_schema.Column`, :class:`_schema.Table`,
        and :class:`_schema.MetaData`.

        :param schema: The returned :class:`_schema.ForeignKey` will
          reference the original table and column name, qualified
          by the given string schema name.

        """
        fk = ForeignKey(
            self._get_colspec(schema=schema),
            use_alter=self.use_alter,
            name=self.name,
            onupdate=self.onupdate,
            ondelete=self.ondelete,
            deferrable=self.deferrable,
            initially=self.initially,
            link_to_name=self.link_to_name,
            match=self.match,
            comment=self.comment,
            **self._unvalidated_dialect_kw,
        )
        return self._schema_item_copy(fk)

    def _get_colspec(
        self,
        schema: Optional[
            Union[
                str,
                Literal[SchemaConst.RETAIN_SCHEMA, SchemaConst.BLANK_SCHEMA],
            ]
        ] = None,
        table_name: Optional[str] = None,
        _is_copy: bool = False,
    ) -> str:
        """Return a string based 'column specification' for this
        :class:`_schema.ForeignKey`.

        This is usually the equivalent of the string-based "tablename.colname"
        argument first passed to the object's constructor.

        """
        if schema not in (None, RETAIN_SCHEMA):
            _schema, tname, colname = self._column_tokens
            if table_name is not None:
                tname = table_name
            if schema is BLANK_SCHEMA:
                return "%s.%s" % (tname, colname)
            else:
                return "%s.%s.%s" % (schema, tname, colname)
        elif table_name:
            schema, tname, colname = self._column_tokens
            if schema:
                return "%s.%s.%s" % (schema, table_name, colname)
            else:
                return "%s.%s" % (table_name, colname)
        elif self._table_column is not None:
            if self._table_column.table is None:
                if _is_copy:
                    raise exc.InvalidRequestError(
                        f"Can't copy ForeignKey object which refers to "
                        f"non-table bound Column {self._table_column!r}"
                    )
                else:
                    return self._table_column.key
            return "%s.%s" % (
                self._table_column.table.fullname,
                self._table_column.key,
            )
        else:
            assert isinstance(self._colspec, str)
            return self._colspec

    @property
    def _referred_schema(self) -> Optional[str]:
        return self._column_tokens[0]

    def _table_key(self) -> Any:
        if self._table_column is not None:
            if self._table_column.table is None:
                return None
            else:
                return self._table_column.table.key
        else:
            schema, tname, colname = self._column_tokens
            return _get_table_key(tname, schema)

    target_fullname = property(_get_colspec)

    def references(self, table: Table) -> bool:
        """Return True if the given :class:`_schema.Table`
        is referenced by this
        :class:`_schema.ForeignKey`."""

        return table.corresponding_column(self.column) is not None

    def get_referent(self, table: FromClause) -> Optional[Column[Any]]:
        """Return the :class:`_schema.Column` in the given
        :class:`_schema.Table` (or any :class:`.FromClause`)
        referenced by this :class:`_schema.ForeignKey`.

        Returns None if this :class:`_schema.ForeignKey`
        does not reference the given
        :class:`_schema.Table`.

        """
        # our column is a Column, and any subquery etc. proxying us
        # would be doing so via another Column, so that's what would
        # be returned here
        return table.columns.corresponding_column(self.column)  # type: ignore

    @util.memoized_property
    def _column_tokens(self) -> Tuple[Optional[str], str, Optional[str]]:
        """parse a string-based _colspec into its component parts."""

        m = self._get_colspec().split(".")
        if m is None:
            raise exc.ArgumentError(
                f"Invalid foreign key column specification: {self._colspec}"
            )
        if len(m) == 1:
            tname = m.pop()
            colname = None
        else:
            colname = m.pop()
            tname = m.pop()

        # A FK between column 'bar' and table 'foo' can be
        # specified as 'foo', 'foo.bar', 'dbo.foo.bar',
        # 'otherdb.dbo.foo.bar'. Once we have the column name and
        # the table name, treat everything else as the schema
        # name. Some databases (e.g. Sybase) support
        # inter-database foreign keys. See tickets#1341 and --
        # indirectly related -- Ticket #594. This assumes that '.'
        # will never appear *within* any component of the FK.

        if len(m) > 0:
            schema = ".".join(m)
        else:
            schema = None
        return schema, tname, colname

    def _resolve_col_tokens(self) -> Tuple[Table, str, Optional[str]]:
        if self.parent is None:
            raise exc.InvalidRequestError(
                "this ForeignKey object does not yet have a "
                "parent Column associated with it."
            )

        elif self.parent.table is None:
            raise exc.InvalidRequestError(
                "this ForeignKey's parent column is not yet associated "
                "with a Table."
            )

        parenttable = self.parent.table

        if self._unresolvable:
            schema, tname, colname = self._column_tokens
            tablekey = _get_table_key(tname, schema)
            return parenttable, tablekey, colname

        # assertion
        # basically Column._make_proxy() sends the actual
        # target Column to the ForeignKey object, so the
        # string resolution here is never called.
        for c in self.parent.base_columns:
            if isinstance(c, Column):
                assert c.table is parenttable
                break
        else:
            assert False
        ######################

        schema, tname, colname = self._column_tokens

        if schema is None and parenttable.metadata.schema is not None:
            schema = parenttable.metadata.schema

        tablekey = _get_table_key(tname, schema)
        return parenttable, tablekey, colname

    def _link_to_col_by_colstring(
        self, parenttable: Table, table: Table, colname: Optional[str]
    ) -> Column[Any]:
        _column = None
        if colname is None:
            # colname is None in the case that ForeignKey argument
            # was specified as table name only, in which case we
            # match the column name to the same column on the
            # parent.
            # this use case wasn't working in later 1.x series
            # as it had no test coverage; fixed in 2.0
            parent = self.parent
            assert parent is not None
            key = parent.key
            _column = table.c.get(key, None)
        elif self.link_to_name:
            key = colname
            for c in table.c:
                if c.name == colname:
                    _column = c
        else:
            key = colname
            _column = table.c.get(colname, None)

        if _column is None:
            raise exc.NoReferencedColumnError(
                "Could not initialize target column "
                f"for ForeignKey '{self._colspec}' "
                f"on table '{parenttable.name}': "
                f"table '{table.name}' has no column named '{key}'",
                table.name,
                key,
            )

        return _column

    def _set_target_column(self, column: Column[Any]) -> None:
        assert self.parent is not None

        # propagate TypeEngine to parent if it didn't have one
        if self.parent.type._isnull:
            self.parent.type = column.type

        # super-edgy case, if other FKs point to our column,
        # they'd get the type propagated out also.

        def set_type(fk: ForeignKey) -> None:
            if fk.parent.type._isnull:
                fk.parent.type = column.type

        self.parent._setup_on_memoized_fks(set_type)

        self.column = column  # type: ignore

    @util.ro_memoized_property
    def column(self) -> Column[Any]:
        """Return the target :class:`_schema.Column` referenced by this
        :class:`_schema.ForeignKey`.

        If no target column has been established, an exception
        is raised.

        """

        return self._resolve_column()

    @overload
    def _resolve_column(self, *, raiseerr: Literal[True] = ...) -> Column[Any]:
        ...

    @overload
    def _resolve_column(
        self, *, raiseerr: bool = ...
    ) -> Optional[Column[Any]]:
        ...

    def _resolve_column(
        self, *, raiseerr: bool = True
    ) -> Optional[Column[Any]]:
        _column: Column[Any]

        if isinstance(self._colspec, str):
            parenttable, tablekey, colname = self._resolve_col_tokens()

            if self._unresolvable or tablekey not in parenttable.metadata:
                if not raiseerr:
                    return None
                raise exc.NoReferencedTableError(
                    f"Foreign key associated with column "
                    f"'{self.parent}' could not find "
                    f"table '{tablekey}' with which to generate a "
                    f"foreign key to target column '{colname}'",
                    tablekey,
                )
            elif parenttable.key not in parenttable.metadata:
                if not raiseerr:
                    return None
                raise exc.InvalidRequestError(
                    f"Table {parenttable} is no longer associated with its "
                    "parent MetaData"
                )
            else:
                table = parenttable.metadata.tables[tablekey]
                return self._link_to_col_by_colstring(
                    parenttable, table, colname
                )

        elif hasattr(self._colspec, "__clause_element__"):
            _column = self._colspec.__clause_element__()
            return _column
        else:
            _column = self._colspec
            return _column

    def _set_parent(self, parent: SchemaEventTarget, **kw: Any) -> None:
        assert isinstance(parent, Column)

        if self.parent is not None and self.parent is not parent:
            raise exc.InvalidRequestError(
                "This ForeignKey already has a parent !"
            )
        self.parent = parent
        self.parent.foreign_keys.add(self)
        self.parent._on_table_attach(self._set_table)

    def _set_remote_table(self, table: Table) -> None:
        parenttable, _, colname = self._resolve_col_tokens()
        _column = self._link_to_col_by_colstring(parenttable, table, colname)
        self._set_target_column(_column)
        assert self.constraint is not None
        self.constraint._validate_dest_table(table)

    def _remove_from_metadata(self, metadata: MetaData) -> None:
        parenttable, table_key, colname = self._resolve_col_tokens()
        fk_key = (table_key, colname)

        if self in metadata._fk_memos[fk_key]:
            # TODO: no test coverage for self not in memos
            metadata._fk_memos[fk_key].remove(self)

    def _set_table(self, column: Column[Any], table: Table) -> None:
        # standalone ForeignKey - create ForeignKeyConstraint
        # on the hosting Table when attached to the Table.
        assert isinstance(table, Table)
        if self.constraint is None:
            self.constraint = ForeignKeyConstraint(
                [],
                [],
                use_alter=self.use_alter,
                name=self.name,
                onupdate=self.onupdate,
                ondelete=self.ondelete,
                deferrable=self.deferrable,
                initially=self.initially,
                match=self.match,
                comment=self.comment,
                **self._unvalidated_dialect_kw,
            )
            self.constraint._append_element(column, self)
            self.constraint._set_parent_with_dispatch(table)
        table.foreign_keys.add(self)
        # set up remote ".column" attribute, or a note to pick it
        # up when the other Table/Column shows up
        if isinstance(self._colspec, str):
            parenttable, table_key, colname = self._resolve_col_tokens()
            fk_key = (table_key, colname)
            if table_key in parenttable.metadata.tables:
                table = parenttable.metadata.tables[table_key]
                try:
                    _column = self._link_to_col_by_colstring(
                        parenttable, table, colname
                    )
                except exc.NoReferencedColumnError:
                    # this is OK, we'll try later
                    pass
                else:
                    self._set_target_column(_column)

            parenttable.metadata._fk_memos[fk_key].append(self)
        elif hasattr(self._colspec, "__clause_element__"):
            _column = self._colspec.__clause_element__()
            self._set_target_column(_column)
        else:
            _column = self._colspec
            self._set_target_column(_column)


if TYPE_CHECKING:

    def default_is_sequence(
        obj: Optional[DefaultGenerator],
    ) -> TypeGuard[Sequence]:
        ...

    def default_is_clause_element(
        obj: Optional[DefaultGenerator],
    ) -> TypeGuard[ColumnElementColumnDefault]:
        ...

    def default_is_scalar(
        obj: Optional[DefaultGenerator],
    ) -> TypeGuard[ScalarElementColumnDefault]:
        ...

else:
    default_is_sequence = operator.attrgetter("is_sequence")

    default_is_clause_element = operator.attrgetter("is_clause_element")

    default_is_scalar = operator.attrgetter("is_scalar")


class DefaultGenerator(Executable, SchemaItem):
    """Base class for column *default* values.

    This object is only present on column.default or column.onupdate.
    It's not valid as a server default.

    """

    __visit_name__ = "default_generator"

    _is_default_generator = True
    is_sequence = False
    is_identity = False
    is_server_default = False
    is_clause_element = False
    is_callable = False
    is_scalar = False
    has_arg = False
    is_sentinel = False
    column: Optional[Column[Any]]

    def __init__(self, for_update: bool = False) -> None:
        self.for_update = for_update

    def _set_parent(self, parent: SchemaEventTarget, **kw: Any) -> None:
        if TYPE_CHECKING:
            assert isinstance(parent, Column)
        self.column = parent
        if self.for_update:
            self.column.onupdate = self
        else:
            self.column.default = self

    def _copy(self) -> DefaultGenerator:
        raise NotImplementedError()

    def _execute_on_connection(
        self,
        connection: Connection,
        distilled_params: _CoreMultiExecuteParams,
        execution_options: CoreExecuteOptionsParameter,
    ) -> Any:
        util.warn_deprecated(
            "Using the .execute() method to invoke a "
            "DefaultGenerator object is deprecated; please use "
            "the .scalar() method.",
            "2.0",
        )
        return self._execute_on_scalar(
            connection, distilled_params, execution_options
        )

    def _execute_on_scalar(
        self,
        connection: Connection,
        distilled_params: _CoreMultiExecuteParams,
        execution_options: CoreExecuteOptionsParameter,
    ) -> Any:
        return connection._execute_default(
            self, distilled_params, execution_options
        )


class ColumnDefault(DefaultGenerator, ABC):
    """A plain default value on a column.

    This could correspond to a constant, a callable function,
    or a SQL clause.

    :class:`.ColumnDefault` is generated automatically
    whenever the ``default``, ``onupdate`` arguments of
    :class:`_schema.Column` are used.  A :class:`.ColumnDefault`
    can be passed positionally as well.

    For example, the following::

        Column('foo', Integer, default=50)

    Is equivalent to::

        Column('foo', Integer, ColumnDefault(50))


    """

    arg: Any

    @overload
    def __new__(
        cls, arg: Callable[..., Any], for_update: bool = ...
    ) -> CallableColumnDefault:
        ...

    @overload
    def __new__(
        cls, arg: ColumnElement[Any], for_update: bool = ...
    ) -> ColumnElementColumnDefault:
        ...

    # if I return ScalarElementColumnDefault here, which is what's actually
    # returned, mypy complains that
    # overloads overlap w/ incompatible return types.
    @overload
    def __new__(cls, arg: object, for_update: bool = ...) -> ColumnDefault:
        ...

    def __new__(
        cls, arg: Any = None, for_update: bool = False
    ) -> ColumnDefault:
        """Construct a new :class:`.ColumnDefault`.


        :param arg: argument representing the default value.
         May be one of the following:

         * a plain non-callable Python value, such as a
           string, integer, boolean, or other simple type.
           The default value will be used as is each time.
         * a SQL expression, that is one which derives from
           :class:`_expression.ColumnElement`.  The SQL expression will
           be rendered into the INSERT or UPDATE statement,
           or in the case of a primary key column when
           RETURNING is not used may be
           pre-executed before an INSERT within a SELECT.
         * A Python callable.  The function will be invoked for each
           new row subject to an INSERT or UPDATE.
           The callable must accept exactly
           zero or one positional arguments.  The one-argument form
           will receive an instance of the :class:`.ExecutionContext`,
           which provides contextual information as to the current
           :class:`_engine.Connection` in use as well as the current
           statement and parameters.

        """

        if isinstance(arg, FetchedValue):
            raise exc.ArgumentError(
                "ColumnDefault may not be a server-side default type."
            )
        elif callable(arg):
            cls = CallableColumnDefault
        elif isinstance(arg, ClauseElement):
            cls = ColumnElementColumnDefault
        elif arg is not None:
            cls = ScalarElementColumnDefault

        return object.__new__(cls)

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}({self.arg!r})"


class ScalarElementColumnDefault(ColumnDefault):
    """default generator for a fixed scalar Python value

    .. versionadded: 2.0

    """

    is_scalar = True
    has_arg = True

    def __init__(self, arg: Any, for_update: bool = False) -> None:
        self.for_update = for_update
        self.arg = arg

    def _copy(self) -> ScalarElementColumnDefault:
        return ScalarElementColumnDefault(
            arg=self.arg, for_update=self.for_update
        )


class _InsertSentinelColumnDefault(ColumnDefault):
    """Default generator that's specific to the use of a "sentinel" column
    when using the insertmanyvalues feature.

    This default is used as part of the :func:`_schema.insert_sentinel`
    construct.

    """

    is_sentinel = True
    for_update = False
    arg = None

    def __new__(cls) -> _InsertSentinelColumnDefault:
        return object.__new__(cls)

    def __init__(self) -> None:
        pass

    def _set_parent(self, parent: SchemaEventTarget, **kw: Any) -> None:
        col = cast("Column[Any]", parent)
        if not col._insert_sentinel:
            raise exc.ArgumentError(
                "The _InsertSentinelColumnDefault may only be applied to a "
                "Column marked as insert_sentinel=True"
            )
        elif not col.nullable:
            raise exc.ArgumentError(
                "The _InsertSentinelColumnDefault may only be applied to a "
                "Column that is nullable"
            )

        super()._set_parent(parent, **kw)

    def _copy(self) -> _InsertSentinelColumnDefault:
        return _InsertSentinelColumnDefault()


_SQLExprDefault = Union["ColumnElement[Any]", "TextClause"]


class ColumnElementColumnDefault(ColumnDefault):
    """default generator for a SQL expression

    .. versionadded:: 2.0

    """

    is_clause_element = True
    has_arg = True
    arg: _SQLExprDefault

    def __init__(
        self,
        arg: _SQLExprDefault,
        for_update: bool = False,
    ) -> None:
        self.for_update = for_update
        self.arg = arg

    def _copy(self) -> ColumnElementColumnDefault:
        return ColumnElementColumnDefault(
            arg=self.arg, for_update=self.for_update
        )

    @util.memoized_property
    @util.preload_module("sqlalchemy.sql.sqltypes")
    def _arg_is_typed(self) -> bool:
        sqltypes = util.preloaded.sql_sqltypes

        return not isinstance(self.arg.type, sqltypes.NullType)


class _CallableColumnDefaultProtocol(Protocol):
    def __call__(self, context: ExecutionContext) -> Any:
        ...


class CallableColumnDefault(ColumnDefault):
    """default generator for a callable Python function

    .. versionadded:: 2.0

    """

    is_callable = True
    arg: _CallableColumnDefaultProtocol
    has_arg = True

    def __init__(
        self,
        arg: Union[_CallableColumnDefaultProtocol, Callable[[], Any]],
        for_update: bool = False,
    ) -> None:
        self.for_update = for_update
        self.arg = self._maybe_wrap_callable(arg)

    def _copy(self) -> CallableColumnDefault:
        return CallableColumnDefault(arg=self.arg, for_update=self.for_update)

    def _maybe_wrap_callable(
        self, fn: Union[_CallableColumnDefaultProtocol, Callable[[], Any]]
    ) -> _CallableColumnDefaultProtocol:
        """Wrap callables that don't accept a context.

        This is to allow easy compatibility with default callables
        that aren't specific to accepting of a context.

        """

        try:
            argspec = util.get_callable_argspec(fn, no_self=True)
        except TypeError:
            return util.wrap_callable(lambda ctx: fn(), fn)  # type: ignore

        defaulted = argspec[3] is not None and len(argspec[3]) or 0
        positionals = len(argspec[0]) - defaulted

        if positionals == 0:
            return util.wrap_callable(lambda ctx: fn(), fn)  # type: ignore

        elif positionals == 1:
            return fn  # type: ignore
        else:
            raise exc.ArgumentError(
                "ColumnDefault Python function takes zero or one "
                "positional arguments"
            )


class IdentityOptions:
    """Defines options for a named database sequence or an identity column.

    .. versionadded:: 1.3.18

    .. seealso::

        :class:`.Sequence`

    """

    def __init__(
        self,
        start: Optional[int] = None,
        increment: Optional[int] = None,
        minvalue: Optional[int] = None,
        maxvalue: Optional[int] = None,
        nominvalue: Optional[bool] = None,
        nomaxvalue: Optional[bool] = None,
        cycle: Optional[bool] = None,
        cache: Optional[int] = None,
        order: Optional[bool] = None,
    ) -> None:
        """Construct a :class:`.IdentityOptions` object.

        See the :class:`.Sequence` documentation for a complete description
        of the parameters.

        :param start: the starting index of the sequence.
        :param increment: the increment value of the sequence.
        :param minvalue: the minimum value of the sequence.
        :param maxvalue: the maximum value of the sequence.
        :param nominvalue: no minimum value of the sequence.
        :param nomaxvalue: no maximum value of the sequence.
        :param cycle: allows the sequence to wrap around when the maxvalue
         or minvalue has been reached.
        :param cache: optional integer value; number of future values in the
         sequence which are calculated in advance.
        :param order: optional boolean value; if ``True``, renders the
         ORDER keyword.

        """
        self.start = start
        self.increment = increment
        self.minvalue = minvalue
        self.maxvalue = maxvalue
        self.nominvalue = nominvalue
        self.nomaxvalue = nomaxvalue
        self.cycle = cycle
        self.cache = cache
        self.order = order

    @property
    def _increment_is_negative(self) -> bool:
        return self.increment is not None and self.increment < 0


class Sequence(HasSchemaAttr, IdentityOptions, DefaultGenerator):
    """Represents a named database sequence.

    The :class:`.Sequence` object represents the name and configurational
    parameters of a database sequence.   It also represents
    a construct that can be "executed" by a SQLAlchemy :class:`_engine.Engine`
    or :class:`_engine.Connection`,
    rendering the appropriate "next value" function
    for the target database and returning a result.

    The :class:`.Sequence` is typically associated with a primary key column::

        some_table = Table(
            'some_table', metadata,
            Column('id', Integer, Sequence('some_table_seq', start=1),
            primary_key=True)
        )

    When CREATE TABLE is emitted for the above :class:`_schema.Table`, if the
    target platform supports sequences, a CREATE SEQUENCE statement will
    be emitted as well.   For platforms that don't support sequences,
    the :class:`.Sequence` construct is ignored.

    .. seealso::

        :ref:`defaults_sequences`

        :class:`.CreateSequence`

        :class:`.DropSequence`

    """

    __visit_name__ = "sequence"

    is_sequence = True

    column: Optional[Column[Any]]
    data_type: Optional[TypeEngine[int]]

    def __init__(
        self,
        name: str,
        start: Optional[int] = None,
        increment: Optional[int] = None,
        minvalue: Optional[int] = None,
        maxvalue: Optional[int] = None,
        nominvalue: Optional[bool] = None,
        nomaxvalue: Optional[bool] = None,
        cycle: Optional[bool] = None,
        schema: Optional[Union[str, Literal[SchemaConst.BLANK_SCHEMA]]] = None,
        cache: Optional[int] = None,
        order: Optional[bool] = None,
        data_type: Optional[_TypeEngineArgument[int]] = None,
        optional: bool = False,
        quote: Optional[bool] = None,
        metadata: Optional[MetaData] = None,
        quote_schema: Optional[bool] = None,
        for_update: bool = False,
    ) -> None:
        """Construct a :class:`.Sequence` object.

        :param name: the name of the sequence.

        :param start: the starting index of the sequence.  This value is
         used when the CREATE SEQUENCE command is emitted to the database
         as the value of the "START WITH" clause. If ``None``, the
         clause is omitted, which on most platforms indicates a starting
         value of 1.

         .. versionchanged:: 2.0 The :paramref:`.Sequence.start` parameter
            is required in order to have DDL emit "START WITH".  This is a
            reversal of a change made in version 1.4 which would implicitly
            render "START WITH 1" if the :paramref:`.Sequence.start` were
            not included.  See :ref:`change_7211` for more detail.

        :param increment: the increment value of the sequence.  This
         value is used when the CREATE SEQUENCE command is emitted to
         the database as the value of the "INCREMENT BY" clause.  If ``None``,
         the clause is omitted, which on most platforms indicates an
         increment of 1.
        :param minvalue: the minimum value of the sequence.  This
         value is used when the CREATE SEQUENCE command is emitted to
         the database as the value of the "MINVALUE" clause.  If ``None``,
         the clause is omitted, which on most platforms indicates a
         minvalue of 1 and -2^63-1 for ascending and descending sequences,
         respectively.

        :param maxvalue: the maximum value of the sequence.  This
         value is used when the CREATE SEQUENCE command is emitted to
         the database as the value of the "MAXVALUE" clause.  If ``None``,
         the clause is omitted, which on most platforms indicates a
         maxvalue of 2^63-1 and -1 for ascending and descending sequences,
         respectively.

        :param nominvalue: no minimum value of the sequence.  This
         value is used when the CREATE SEQUENCE command is emitted to
         the database as the value of the "NO MINVALUE" clause.  If ``None``,
         the clause is omitted, which on most platforms indicates a
         minvalue of 1 and -2^63-1 for ascending and descending sequences,
         respectively.

        :param nomaxvalue: no maximum value of the sequence.  This
         value is used when the CREATE SEQUENCE command is emitted to
         the database as the value of the "NO MAXVALUE" clause.  If ``None``,
         the clause is omitted, which on most platforms indicates a
         maxvalue of 2^63-1 and -1 for ascending and descending sequences,
         respectively.

        :param cycle: allows the sequence to wrap around when the maxvalue
         or minvalue has been reached by an ascending or descending sequence
         respectively.  This value is used when the CREATE SEQUENCE command
         is emitted to the database as the "CYCLE" clause.  If the limit is
         reached, the next number generated will be the minvalue or maxvalue,
         respectively.  If cycle=False (the default) any calls to nextval
         after the sequence has reached its maximum value will return an
         error.

        :param schema: optional schema name for the sequence, if located
         in a schema other than the default.  The rules for selecting the
         schema name when a :class:`_schema.MetaData`
         is also present are the same
         as that of :paramref:`_schema.Table.schema`.

        :param cache: optional integer value; number of future values in the
         sequence which are calculated in advance.  Renders the CACHE keyword
         understood by Oracle and PostgreSQL.

        :param order: optional boolean value; if ``True``, renders the
         ORDER keyword, understood by Oracle, indicating the sequence is
         definitively ordered.   May be necessary to provide deterministic
         ordering using Oracle RAC.

        :param data_type: The type to be returned by the sequence, for
         dialects that allow us to choose between INTEGER, BIGINT, etc.
         (e.g., mssql).

         .. versionadded:: 1.4.0

        :param optional: boolean value, when ``True``, indicates that this
         :class:`.Sequence` object only needs to be explicitly generated
         on backends that don't provide another way to generate primary
         key identifiers.  Currently, it essentially means, "don't create
         this sequence on the PostgreSQL backend, where the SERIAL keyword
         creates a sequence for us automatically".
        :param quote: boolean value, when ``True`` or ``False``, explicitly
         forces quoting of the :paramref:`_schema.Sequence.name` on or off.
         When left at its default of ``None``, normal quoting rules based
         on casing and reserved words take place.
        :param quote_schema: Set the quoting preferences for the ``schema``
         name.

        :param metadata: optional :class:`_schema.MetaData` object which this
         :class:`.Sequence` will be associated with.  A :class:`.Sequence`
         that is associated with a :class:`_schema.MetaData`
         gains the following
         capabilities:

         * The :class:`.Sequence` will inherit the
           :paramref:`_schema.MetaData.schema`
           parameter specified to the target :class:`_schema.MetaData`, which
           affects the production of CREATE / DROP DDL, if any.

         * The :meth:`.Sequence.create` and :meth:`.Sequence.drop` methods
           automatically use the engine bound to the :class:`_schema.MetaData`
           object, if any.

         * The :meth:`_schema.MetaData.create_all` and
           :meth:`_schema.MetaData.drop_all`
           methods will emit CREATE / DROP for this :class:`.Sequence`,
           even if the :class:`.Sequence` is not associated with any
           :class:`_schema.Table` / :class:`_schema.Column`
           that's a member of this
           :class:`_schema.MetaData`.

         The above behaviors can only occur if the :class:`.Sequence` is
         explicitly associated with the :class:`_schema.MetaData`
         via this parameter.

         .. seealso::

            :ref:`sequence_metadata` - full discussion of the
            :paramref:`.Sequence.metadata` parameter.

        :param for_update: Indicates this :class:`.Sequence`, when associated
         with a :class:`_schema.Column`,
         should be invoked for UPDATE statements
         on that column's table, rather than for INSERT statements, when
         no value is otherwise present for that column in the statement.

        """
        DefaultGenerator.__init__(self, for_update=for_update)
        IdentityOptions.__init__(
            self,
            start=start,
            increment=increment,
            minvalue=minvalue,
            maxvalue=maxvalue,
            nominvalue=nominvalue,
            nomaxvalue=nomaxvalue,
            cycle=cycle,
            cache=cache,
            order=order,
        )
        self.column = None
        self.name = quoted_name(name, quote)
        self.optional = optional
        if schema is BLANK_SCHEMA:
            self.schema = schema = None
        elif metadata is not None and schema is None and metadata.schema:
            self.schema = schema = metadata.schema
        else:
            self.schema = quoted_name.construct(schema, quote_schema)
        self.metadata = metadata
        self._key = _get_table_key(name, schema)
        if metadata:
            self._set_metadata(metadata)
        if data_type is not None:
            self.data_type = to_instance(data_type)
        else:
            self.data_type = None

    @util.preload_module("sqlalchemy.sql.functions")
    def next_value(self) -> Function[int]:
        """Return a :class:`.next_value` function element
        which will render the appropriate increment function
        for this :class:`.Sequence` within any SQL expression.

        """
        return util.preloaded.sql_functions.func.next_value(self)

    def _set_parent(self, parent: SchemaEventTarget, **kw: Any) -> None:
        column = parent
        assert isinstance(column, Column)
        super()._set_parent(column)
        column._on_table_attach(self._set_table)

    def _copy(self) -> Sequence:
        return Sequence(
            name=self.name,
            start=self.start,
            increment=self.increment,
            minvalue=self.minvalue,
            maxvalue=self.maxvalue,
            nominvalue=self.nominvalue,
            nomaxvalue=self.nomaxvalue,
            cycle=self.cycle,
            schema=self.schema,
            cache=self.cache,
            order=self.order,
            data_type=self.data_type,
            optional=self.optional,
            metadata=self.metadata,
            for_update=self.for_update,
        )

    def _set_table(self, column: Column[Any], table: Table) -> None:
        self._set_metadata(table.metadata)

    def _set_metadata(self, metadata: MetaData) -> None:
        self.metadata = metadata
        self.metadata._sequences[self._key] = self

    def create(self, bind: _CreateDropBind, checkfirst: bool = True) -> None:
        """Creates this sequence in the database."""

        bind._run_ddl_visitor(ddl.SchemaGenerator, self, checkfirst=checkfirst)

    def drop(self, bind: _CreateDropBind, checkfirst: bool = True) -> None:
        """Drops this sequence from the database."""

        bind._run_ddl_visitor(ddl.SchemaDropper, self, checkfirst=checkfirst)

    def _not_a_column_expr(self) -> NoReturn:
        raise exc.InvalidRequestError(
            f"This {self.__class__.__name__} cannot be used directly "
            "as a column expression.  Use func.next_value(sequence) "
            "to produce a 'next value' function that's usable "
            "as a column element."
        )


@inspection._self_inspects
class FetchedValue(SchemaEventTarget):
    """A marker for a transparent database-side default.

    Use :class:`.FetchedValue` when the database is configured
    to provide some automatic default for a column.

    E.g.::

        Column('foo', Integer, FetchedValue())

    Would indicate that some trigger or default generator
    will create a new value for the ``foo`` column during an
    INSERT.

    .. seealso::

        :ref:`triggered_columns`

    """

    is_server_default = True
    reflected = False
    has_argument = False
    is_clause_element = False
    is_identity = False

    column: Optional[Column[Any]]

    def __init__(self, for_update: bool = False) -> None:
        self.for_update = for_update

    def _as_for_update(self, for_update: bool) -> FetchedValue:
        if for_update == self.for_update:
            return self
        else:
            return self._clone(for_update)

    def _copy(self) -> FetchedValue:
        return FetchedValue(self.for_update)

    def _clone(self, for_update: bool) -> Self:
        n = self.__class__.__new__(self.__class__)
        n.__dict__.update(self.__dict__)
        n.__dict__.pop("column", None)
        n.for_update = for_update
        return n

    def _set_parent(self, parent: SchemaEventTarget, **kw: Any) -> None:
        column = parent
        assert isinstance(column, Column)
        self.column = column
        if self.for_update:
            self.column.server_onupdate = self
        else:
            self.column.server_default = self

    def __repr__(self) -> str:
        return util.generic_repr(self)


class DefaultClause(FetchedValue):
    """A DDL-specified DEFAULT column value.

    :class:`.DefaultClause` is a :class:`.FetchedValue`
    that also generates a "DEFAULT" clause when
    "CREATE TABLE" is emitted.

    :class:`.DefaultClause` is generated automatically
    whenever the ``server_default``, ``server_onupdate`` arguments of
    :class:`_schema.Column` are used.  A :class:`.DefaultClause`
    can be passed positionally as well.

    For example, the following::

        Column('foo', Integer, server_default="50")

    Is equivalent to::

        Column('foo', Integer, DefaultClause("50"))

    """

    has_argument = True

    def __init__(
        self,
        arg: Union[str, ClauseElement, TextClause],
        for_update: bool = False,
        _reflected: bool = False,
    ) -> None:
        util.assert_arg_type(arg, (str, ClauseElement, TextClause), "arg")
        super().__init__(for_update)
        self.arg = arg
        self.reflected = _reflected

    def _copy(self) -> DefaultClause:
        return DefaultClause(
            arg=self.arg, for_update=self.for_update, _reflected=self.reflected
        )

    def __repr__(self) -> str:
        return "DefaultClause(%r, for_update=%r)" % (self.arg, self.for_update)


class Constraint(DialectKWArgs, HasConditionalDDL, SchemaItem):
    """A table-level SQL constraint.

    :class:`_schema.Constraint` serves as the base class for the series of
    constraint objects that can be associated with :class:`_schema.Table`
    objects, including :class:`_schema.PrimaryKeyConstraint`,
    :class:`_schema.ForeignKeyConstraint`
    :class:`_schema.UniqueConstraint`, and
    :class:`_schema.CheckConstraint`.

    """

    __visit_name__ = "constraint"

    _creation_order: int
    _column_flag: bool

    def __init__(
        self,
        name: _ConstraintNameArgument = None,
        deferrable: Optional[bool] = None,
        initially: Optional[str] = None,
        info: Optional[_InfoType] = None,
        comment: Optional[str] = None,
        _create_rule: Optional[Any] = None,
        _type_bound: bool = False,
        **dialect_kw: Any,
    ) -> None:
        r"""Create a SQL constraint.

        :param name:
          Optional, the in-database name of this ``Constraint``.

        :param deferrable:
          Optional bool.  If set, emit DEFERRABLE or NOT DEFERRABLE when
          issuing DDL for this constraint.

        :param initially:
          Optional string.  If set, emit INITIALLY <value> when issuing DDL
          for this constraint.

        :param info: Optional data dictionary which will be populated into the
            :attr:`.SchemaItem.info` attribute of this object.

        :param comment: Optional string that will render an SQL comment on
          foreign key constraint creation.

            .. versionadded:: 2.0

        :param \**dialect_kw:  Additional keyword arguments are dialect
            specific, and passed in the form ``<dialectname>_<argname>``.  See
            the documentation regarding an individual dialect at
            :ref:`dialect_toplevel` for detail on documented arguments.

        :param _create_rule:
          used internally by some datatypes that also create constraints.

        :param _type_bound:
          used internally to indicate that this constraint is associated with
          a specific datatype.

        """

        self.name = name
        self.deferrable = deferrable
        self.initially = initially
        if info:
            self.info = info
        self._create_rule = _create_rule
        self._type_bound = _type_bound
        util.set_creation_order(self)
        self._validate_dialect_kwargs(dialect_kw)
        self.comment = comment

    def _should_create_for_compiler(
        self, compiler: DDLCompiler, **kw: Any
    ) -> bool:
        if self._create_rule is not None and not self._create_rule(compiler):
            return False
        elif self._ddl_if is not None:
            return self._ddl_if._should_execute(
                ddl.CreateConstraint(self), self, None, compiler=compiler, **kw
            )
        else:
            return True

    @property
    def table(self) -> Table:
        try:
            if isinstance(self.parent, Table):
                return self.parent
        except AttributeError:
            pass
        raise exc.InvalidRequestError(
            "This constraint is not bound to a table.  Did you "
            "mean to call table.append_constraint(constraint) ?"
        )

    def _set_parent(self, parent: SchemaEventTarget, **kw: Any) -> None:
        assert isinstance(parent, (Table, Column))
        self.parent = parent
        parent.constraints.add(self)

    @util.deprecated(
        "1.4",
        "The :meth:`_schema.Constraint.copy` method is deprecated "
        "and will be removed in a future release.",
    )
    def copy(self, **kw: Any) -> Self:
        return self._copy(**kw)

    def _copy(self, **kw: Any) -> Self:
        raise NotImplementedError()


class ColumnCollectionMixin:
    """A :class:`_expression.ColumnCollection` of :class:`_schema.Column`
    objects.

    This collection represents the columns which are referred to by
    this object.

    """

    _columns: DedupeColumnCollection[Column[Any]]

    _allow_multiple_tables = False

    _pending_colargs: List[Optional[Union[str, Column[Any]]]]

    if TYPE_CHECKING:

        def _set_parent_with_dispatch(
            self, parent: SchemaEventTarget, **kw: Any
        ) -> None:
            ...

    def __init__(
        self,
        *columns: _DDLColumnArgument,
        _autoattach: bool = True,
        _column_flag: bool = False,
        _gather_expressions: Optional[
            List[Union[str, ColumnElement[Any]]]
        ] = None,
    ) -> None:
        self._column_flag = _column_flag
        self._columns = DedupeColumnCollection()

        processed_expressions: Optional[
            List[Union[ColumnElement[Any], str]]
        ] = _gather_expressions

        if processed_expressions is not None:
            self._pending_colargs = []
            for (
                expr,
                _,
                _,
                add_element,
            ) in coercions.expect_col_expression_collection(
                roles.DDLConstraintColumnRole, columns
            ):
                self._pending_colargs.append(add_element)
                processed_expressions.append(expr)
        else:
            self._pending_colargs = [
                coercions.expect(roles.DDLConstraintColumnRole, column)
                for column in columns
            ]

        if _autoattach and self._pending_colargs:
            self._check_attach()

    def _check_attach(self, evt: bool = False) -> None:
        col_objs = [c for c in self._pending_colargs if isinstance(c, Column)]

        cols_w_table = [c for c in col_objs if isinstance(c.table, Table)]

        cols_wo_table = set(col_objs).difference(cols_w_table)
        if cols_wo_table:
            # feature #3341 - place event listeners for Column objects
            # such that when all those cols are attached, we autoattach.
            assert not evt, "Should not reach here on event call"

            # issue #3411 - don't do the per-column auto-attach if some of the
            # columns are specified as strings.
            has_string_cols = {
                c for c in self._pending_colargs if c is not None
            }.difference(col_objs)
            if not has_string_cols:

                def _col_attached(column: Column[Any], table: Table) -> None:
                    # this isinstance() corresponds with the
                    # isinstance() above; only want to count Table-bound
                    # columns
                    if isinstance(table, Table):
                        cols_wo_table.discard(column)
                        if not cols_wo_table:
                            self._check_attach(evt=True)

                self._cols_wo_table = cols_wo_table
                for col in cols_wo_table:
                    col._on_table_attach(_col_attached)
                return

        columns = cols_w_table

        tables = {c.table for c in columns}
        if len(tables) == 1:
            self._set_parent_with_dispatch(tables.pop())
        elif len(tables) > 1 and not self._allow_multiple_tables:
            table = columns[0].table
            others = [c for c in columns[1:] if c.table is not table]
            if others:
                # black could not format this inline
                other_str = ", ".join("'%s'" % c for c in others)
                raise exc.ArgumentError(
                    f"Column(s) {other_str} "
                    f"are not part of table '{table.description}'."
                )

    @util.ro_memoized_property
    def columns(self) -> ReadOnlyColumnCollection[str, Column[Any]]:
        return self._columns.as_readonly()

    @util.ro_memoized_property
    def c(self) -> ReadOnlyColumnCollection[str, Column[Any]]:
        return self._columns.as_readonly()

    def _col_expressions(
        self, parent: Union[Table, Column[Any]]
    ) -> List[Optional[Column[Any]]]:
        if isinstance(parent, Column):
            result: List[Optional[Column[Any]]] = [
                c for c in self._pending_colargs if isinstance(c, Column)
            ]
            assert len(result) == len(self._pending_colargs)
            return result
        else:
            try:
                return [
                    parent.c[col] if isinstance(col, str) else col
                    for col in self._pending_colargs
                ]
            except KeyError as ke:
                raise exc.ConstraintColumnNotFoundError(
                    f"Can't create {self.__class__.__name__} "
                    f"on table '{parent.description}': no column "
                    f"named '{ke.args[0]}' is present."
                ) from ke

    def _set_parent(self, parent: SchemaEventTarget, **kw: Any) -> None:
        assert isinstance(parent, (Table, Column))

        for col in self._col_expressions(parent):
            if col is not None:
                self._columns.add(col)


class ColumnCollectionConstraint(ColumnCollectionMixin, Constraint):
    """A constraint that proxies a ColumnCollection."""

    def __init__(
        self,
        *columns: _DDLColumnArgument,
        name: _ConstraintNameArgument = None,
        deferrable: Optional[bool] = None,
        initially: Optional[str] = None,
        info: Optional[_InfoType] = None,
        _autoattach: bool = True,
        _column_flag: bool = False,
        _gather_expressions: Optional[List[_DDLColumnArgument]] = None,
        **dialect_kw: Any,
    ) -> None:
        r"""
        :param \*columns:
          A sequence of column names or Column objects.

        :param name:
          Optional, the in-database name of this constraint.

        :param deferrable:
          Optional bool.  If set, emit DEFERRABLE or NOT DEFERRABLE when
          issuing DDL for this constraint.

        :param initially:
          Optional string.  If set, emit INITIALLY <value> when issuing DDL
          for this constraint.

        :param \**dialect_kw: other keyword arguments including
          dialect-specific arguments are propagated to the :class:`.Constraint`
          superclass.

        """
        Constraint.__init__(
            self,
            name=name,
            deferrable=deferrable,
            initially=initially,
            info=info,
            **dialect_kw,
        )
        ColumnCollectionMixin.__init__(
            self, *columns, _autoattach=_autoattach, _column_flag=_column_flag
        )

    columns: ReadOnlyColumnCollection[str, Column[Any]]
    """A :class:`_expression.ColumnCollection` representing the set of columns
    for this constraint.

    """

    def _set_parent(self, parent: SchemaEventTarget, **kw: Any) -> None:
        assert isinstance(parent, (Column, Table))
        Constraint._set_parent(self, parent)
        ColumnCollectionMixin._set_parent(self, parent)

    def __contains__(self, x: Any) -> bool:
        return x in self._columns

    @util.deprecated(
        "1.4",
        "The :meth:`_schema.ColumnCollectionConstraint.copy` method "
        "is deprecated and will be removed in a future release.",
    )
    def copy(
        self,
        *,
        target_table: Optional[Table] = None,
        **kw: Any,
    ) -> ColumnCollectionConstraint:
        return self._copy(target_table=target_table, **kw)

    def _copy(
        self,
        *,
        target_table: Optional[Table] = None,
        **kw: Any,
    ) -> ColumnCollectionConstraint:
        # ticket #5276
        constraint_kwargs = {}
        for dialect_name in self.dialect_options:
            dialect_options = self.dialect_options[dialect_name]._non_defaults
            for (
                dialect_option_key,
                dialect_option_value,
            ) in dialect_options.items():
                constraint_kwargs[
                    dialect_name + "_" + dialect_option_key
                ] = dialect_option_value

        assert isinstance(self.parent, Table)
        c = self.__class__(
            name=self.name,
            deferrable=self.deferrable,
            initially=self.initially,
            *[
                _copy_expression(expr, self.parent, target_table)
                for expr in self._columns
            ],
            comment=self.comment,
            **constraint_kwargs,
        )
        return self._schema_item_copy(c)

    def contains_column(self, col: Column[Any]) -> bool:
        """Return True if this constraint contains the given column.

        Note that this object also contains an attribute ``.columns``
        which is a :class:`_expression.ColumnCollection` of
        :class:`_schema.Column` objects.

        """

        return self._columns.contains_column(col)

    def __iter__(self) -> Iterator[Column[Any]]:
        return iter(self._columns)

    def __len__(self) -> int:
        return len(self._columns)


class CheckConstraint(ColumnCollectionConstraint):
    """A table- or column-level CHECK constraint.

    Can be included in the definition of a Table or Column.
    """

    _allow_multiple_tables = True

    __visit_name__ = "table_or_column_check_constraint"

    @_document_text_coercion(
        "sqltext",
        ":class:`.CheckConstraint`",
        ":paramref:`.CheckConstraint.sqltext`",
    )
    def __init__(
        self,
        sqltext: _TextCoercedExpressionArgument[Any],
        name: _ConstraintNameArgument = None,
        deferrable: Optional[bool] = None,
        initially: Optional[str] = None,
        table: Optional[Table] = None,
        info: Optional[_InfoType] = None,
        _create_rule: Optional[Any] = None,
        _autoattach: bool = True,
        _type_bound: bool = False,
        **dialect_kw: Any,
    ) -> None:
        r"""Construct a CHECK constraint.

        :param sqltext:
         A string containing the constraint definition, which will be used
         verbatim, or a SQL expression construct.   If given as a string,
         the object is converted to a :func:`_expression.text` object.
         If the textual
         string includes a colon character, escape this using a backslash::

           CheckConstraint(r"foo ~ E'a(?\:b|c)d")

        :param name:
          Optional, the in-database name of the constraint.

        :param deferrable:
          Optional bool.  If set, emit DEFERRABLE or NOT DEFERRABLE when
          issuing DDL for this constraint.

        :param initially:
          Optional string.  If set, emit INITIALLY <value> when issuing DDL
          for this constraint.

        :param info: Optional data dictionary which will be populated into the
            :attr:`.SchemaItem.info` attribute of this object.

        """

        self.sqltext = coercions.expect(roles.DDLExpressionRole, sqltext)
        columns: List[Column[Any]] = []
        visitors.traverse(self.sqltext, {}, {"column": columns.append})

        super().__init__(
            name=name,
            deferrable=deferrable,
            initially=initially,
            _create_rule=_create_rule,
            info=info,
            _type_bound=_type_bound,
            _autoattach=_autoattach,
            *columns,
            **dialect_kw,
        )
        if table is not None:
            self._set_parent_with_dispatch(table)

    @property
    def is_column_level(self) -> bool:
        return not isinstance(self.parent, Table)

    @util.deprecated(
        "1.4",
        "The :meth:`_schema.CheckConstraint.copy` method is deprecated "
        "and will be removed in a future release.",
    )
    def copy(
        self, *, target_table: Optional[Table] = None, **kw: Any
    ) -> CheckConstraint:
        return self._copy(target_table=target_table, **kw)

    def _copy(
        self, *, target_table: Optional[Table] = None, **kw: Any
    ) -> CheckConstraint:
        if target_table is not None:
            # note that target_table is None for the copy process of
            # a column-bound CheckConstraint, so this path is not reached
            # in that case.
            sqltext = _copy_expression(self.sqltext, self.table, target_table)
        else:
            sqltext = self.sqltext
        c = CheckConstraint(
            sqltext,
            name=self.name,
            initially=self.initially,
            deferrable=self.deferrable,
            _create_rule=self._create_rule,
            table=target_table,
            comment=self.comment,
            _autoattach=False,
            _type_bound=self._type_bound,
        )
        return self._schema_item_copy(c)


class ForeignKeyConstraint(ColumnCollectionConstraint):
    """A table-level FOREIGN KEY constraint.

    Defines a single column or composite FOREIGN KEY ... REFERENCES
    constraint. For a no-frills, single column foreign key, adding a
    :class:`_schema.ForeignKey` to the definition of a :class:`_schema.Column`
    is a
    shorthand equivalent for an unnamed, single column
    :class:`_schema.ForeignKeyConstraint`.

    Examples of foreign key configuration are in :ref:`metadata_foreignkeys`.

    """

    __visit_name__ = "foreign_key_constraint"

    def __init__(
        self,
        columns: _typing_Sequence[_DDLColumnArgument],
        refcolumns: _typing_Sequence[_DDLColumnArgument],
        name: _ConstraintNameArgument = None,
        onupdate: Optional[str] = None,
        ondelete: Optional[str] = None,
        deferrable: Optional[bool] = None,
        initially: Optional[str] = None,
        use_alter: bool = False,
        link_to_name: bool = False,
        match: Optional[str] = None,
        table: Optional[Table] = None,
        info: Optional[_InfoType] = None,
        comment: Optional[str] = None,
        **dialect_kw: Any,
    ) -> None:
        r"""Construct a composite-capable FOREIGN KEY.

        :param columns: A sequence of local column names. The named columns
          must be defined and present in the parent Table. The names should
          match the ``key`` given to each column (defaults to the name) unless
          ``link_to_name`` is True.

        :param refcolumns: A sequence of foreign column names or Column
          objects. The columns must all be located within the same Table.

        :param name: Optional, the in-database name of the key.

        :param onupdate: Optional string. If set, emit ON UPDATE <value> when
          issuing DDL for this constraint. Typical values include CASCADE,
          DELETE and RESTRICT.

        :param ondelete: Optional string. If set, emit ON DELETE <value> when
          issuing DDL for this constraint. Typical values include CASCADE,
          DELETE and RESTRICT.

        :param deferrable: Optional bool. If set, emit DEFERRABLE or NOT
          DEFERRABLE when issuing DDL for this constraint.

        :param initially: Optional string. If set, emit INITIALLY <value> when
          issuing DDL for this constraint.

        :param link_to_name: if True, the string name given in ``column`` is
          the rendered name of the referenced column, not its locally assigned
          ``key``.

        :param use_alter: If True, do not emit the DDL for this constraint as
          part of the CREATE TABLE definition. Instead, generate it via an
          ALTER TABLE statement issued after the full collection of tables
          have been created, and drop it via an ALTER TABLE statement before
          the full collection of tables are dropped.

          The use of :paramref:`_schema.ForeignKeyConstraint.use_alter` is
          particularly geared towards the case where two or more tables
          are established within a mutually-dependent foreign key constraint
          relationship; however, the :meth:`_schema.MetaData.create_all` and
          :meth:`_schema.MetaData.drop_all`
          methods will perform this resolution
          automatically, so the flag is normally not needed.

          .. seealso::

                :ref:`use_alter`

        :param match: Optional string. If set, emit MATCH <value> when issuing
          DDL for this constraint. Typical values include SIMPLE, PARTIAL
          and FULL.

        :param info: Optional data dictionary which will be populated into the
            :attr:`.SchemaItem.info` attribute of this object.

        :param comment: Optional string that will render an SQL comment on
          foreign key constraint creation.

            .. versionadded:: 2.0

        :param \**dialect_kw:  Additional keyword arguments are dialect
          specific, and passed in the form ``<dialectname>_<argname>``.  See
          the documentation regarding an individual dialect at
          :ref:`dialect_toplevel` for detail on documented arguments.

        """

        Constraint.__init__(
            self,
            name=name,
            deferrable=deferrable,
            initially=initially,
            info=info,
            comment=comment,
            **dialect_kw,
        )
        self.onupdate = onupdate
        self.ondelete = ondelete
        self.link_to_name = link_to_name
        self.use_alter = use_alter
        self.match = match

        if len(set(columns)) != len(refcolumns):
            if len(set(columns)) != len(columns):
                # e.g. FOREIGN KEY (a, a) REFERENCES r (b, c)
                raise exc.ArgumentError(
                    "ForeignKeyConstraint with duplicate source column "
                    "references are not supported."
                )
            else:
                # e.g. FOREIGN KEY (a) REFERENCES r (b, c)
                # paraphrasing
                # https://www.postgresql.org/docs/current/static/ddl-constraints.html
                raise exc.ArgumentError(
                    "ForeignKeyConstraint number "
                    "of constrained columns must match the number of "
                    "referenced columns."
                )

        # standalone ForeignKeyConstraint - create
        # associated ForeignKey objects which will be applied to hosted
        # Column objects (in col.foreign_keys), either now or when attached
        # to the Table for string-specified names
        self.elements = [
            ForeignKey(
                refcol,
                _constraint=self,
                name=self.name,
                onupdate=self.onupdate,
                ondelete=self.ondelete,
                use_alter=self.use_alter,
                link_to_name=self.link_to_name,
                match=self.match,
                deferrable=self.deferrable,
                initially=self.initially,
                **self.dialect_kwargs,
            )
            for refcol in refcolumns
        ]

        ColumnCollectionMixin.__init__(self, *columns)
        if table is not None:
            if hasattr(self, "parent"):
                assert table is self.parent
            self._set_parent_with_dispatch(table)

    def _append_element(self, column: Column[Any], fk: ForeignKey) -> None:
        self._columns.add(column)
        self.elements.append(fk)

    columns: ReadOnlyColumnCollection[str, Column[Any]]
    """A :class:`_expression.ColumnCollection` representing the set of columns
    for this constraint.

    """

    elements: List[ForeignKey]
    """A sequence of :class:`_schema.ForeignKey` objects.

    Each :class:`_schema.ForeignKey`
    represents a single referring column/referred
    column pair.

    This collection is intended to be read-only.

    """

    @property
    def _elements(self) -> util.OrderedDict[str, ForeignKey]:
        # legacy - provide a dictionary view of (column_key, fk)
        return util.OrderedDict(zip(self.column_keys, self.elements))

    @property
    def _referred_schema(self) -> Optional[str]:
        for elem in self.elements:
            return elem._referred_schema
        else:
            return None

    @property
    def referred_table(self) -> Table:
        """The :class:`_schema.Table` object to which this
        :class:`_schema.ForeignKeyConstraint` references.

        This is a dynamically calculated attribute which may not be available
        if the constraint and/or parent table is not yet associated with
        a metadata collection that contains the referred table.

        """
        return self.elements[0].column.table

    def _validate_dest_table(self, table: Table) -> None:
        table_keys = {elem._table_key() for elem in self.elements}
        if None not in table_keys and len(table_keys) > 1:
            elem0, elem1 = sorted(table_keys)[0:2]
            raise exc.ArgumentError(
                f"ForeignKeyConstraint on "
                f"{table.fullname}({self._col_description}) refers to "
                f"multiple remote tables: {elem0} and {elem1}"
            )

    @property
    def column_keys(self) -> _typing_Sequence[str]:
        """Return a list of string keys representing the local
        columns in this :class:`_schema.ForeignKeyConstraint`.

        This list is either the original string arguments sent
        to the constructor of the :class:`_schema.ForeignKeyConstraint`,
        or if the constraint has been initialized with :class:`_schema.Column`
        objects, is the string ``.key`` of each element.

        """
        if hasattr(self, "parent"):
            return self._columns.keys()
        else:
            return [
                col.key if isinstance(col, ColumnElement) else str(col)
                for col in self._pending_colargs
            ]

    @property
    def _col_description(self) -> str:
        return ", ".join(self.column_keys)

    def _set_parent(self, parent: SchemaEventTarget, **kw: Any) -> None:
        table = parent
        assert isinstance(table, Table)
        Constraint._set_parent(self, table)

        ColumnCollectionConstraint._set_parent(self, table)

        for col, fk in zip(self._columns, self.elements):
            if not hasattr(fk, "parent") or fk.parent is not col:
                fk._set_parent_with_dispatch(col)

        self._validate_dest_table(table)

    @util.deprecated(
        "1.4",
        "The :meth:`_schema.ForeignKeyConstraint.copy` method is deprecated "
        "and will be removed in a future release.",
    )
    def copy(
        self,
        *,
        schema: Optional[str] = None,
        target_table: Optional[Table] = None,
        **kw: Any,
    ) -> ForeignKeyConstraint:
        return self._copy(schema=schema, target_table=target_table, **kw)

    def _copy(
        self,
        *,
        schema: Optional[str] = None,
        target_table: Optional[Table] = None,
        **kw: Any,
    ) -> ForeignKeyConstraint:
        fkc = ForeignKeyConstraint(
            [x.parent.key for x in self.elements],
            [
                x._get_colspec(
                    schema=schema,
                    table_name=target_table.name
                    if target_table is not None
                    and x._table_key() == x.parent.table.key
                    else None,
                    _is_copy=True,
                )
                for x in self.elements
            ],
            name=self.name,
            onupdate=self.onupdate,
            ondelete=self.ondelete,
            use_alter=self.use_alter,
            deferrable=self.deferrable,
            initially=self.initially,
            link_to_name=self.link_to_name,
            match=self.match,
            comment=self.comment,
        )
        for self_fk, other_fk in zip(self.elements, fkc.elements):
            self_fk._schema_item_copy(other_fk)
        return self._schema_item_copy(fkc)


class PrimaryKeyConstraint(ColumnCollectionConstraint):
    """A table-level PRIMARY KEY constraint.

    The :class:`.PrimaryKeyConstraint` object is present automatically
    on any :class:`_schema.Table` object; it is assigned a set of
    :class:`_schema.Column` objects corresponding to those marked with
    the :paramref:`_schema.Column.primary_key` flag::

        >>> my_table = Table('mytable', metadata,
        ...                 Column('id', Integer, primary_key=True),
        ...                 Column('version_id', Integer, primary_key=True),
        ...                 Column('data', String(50))
        ...     )
        >>> my_table.primary_key
        PrimaryKeyConstraint(
            Column('id', Integer(), table=<mytable>,
                   primary_key=True, nullable=False),
            Column('version_id', Integer(), table=<mytable>,
                   primary_key=True, nullable=False)
        )

    The primary key of a :class:`_schema.Table` can also be specified by using
    a :class:`.PrimaryKeyConstraint` object explicitly; in this mode of usage,
    the "name" of the constraint can also be specified, as well as other
    options which may be recognized by dialects::

        my_table = Table('mytable', metadata,
                    Column('id', Integer),
                    Column('version_id', Integer),
                    Column('data', String(50)),
                    PrimaryKeyConstraint('id', 'version_id',
                                         name='mytable_pk')
                )

    The two styles of column-specification should generally not be mixed.
    An warning is emitted if the columns present in the
    :class:`.PrimaryKeyConstraint`
    don't match the columns that were marked as ``primary_key=True``, if both
    are present; in this case, the columns are taken strictly from the
    :class:`.PrimaryKeyConstraint` declaration, and those columns otherwise
    marked as ``primary_key=True`` are ignored.  This behavior is intended to
    be backwards compatible with previous behavior.

    For the use case where specific options are to be specified on the
    :class:`.PrimaryKeyConstraint`, but the usual style of using
    ``primary_key=True`` flags is still desirable, an empty
    :class:`.PrimaryKeyConstraint` may be specified, which will take on the
    primary key column collection from the :class:`_schema.Table` based on the
    flags::

        my_table = Table('mytable', metadata,
                    Column('id', Integer, primary_key=True),
                    Column('version_id', Integer, primary_key=True),
                    Column('data', String(50)),
                    PrimaryKeyConstraint(name='mytable_pk',
                                         mssql_clustered=True)
                )

    """

    __visit_name__ = "primary_key_constraint"

    def __init__(
        self,
        *columns: _DDLColumnArgument,
        name: Optional[str] = None,
        deferrable: Optional[bool] = None,
        initially: Optional[str] = None,
        info: Optional[_InfoType] = None,
        _implicit_generated: bool = False,
        **dialect_kw: Any,
    ) -> None:
        self._implicit_generated = _implicit_generated
        super().__init__(
            *columns,
            name=name,
            deferrable=deferrable,
            initially=initially,
            info=info,
            **dialect_kw,
        )

    def _set_parent(self, parent: SchemaEventTarget, **kw: Any) -> None:
        table = parent
        assert isinstance(table, Table)
        super()._set_parent(table)

        if table.primary_key is not self:
            table.constraints.discard(table.primary_key)
            table.primary_key = self  # type: ignore
            table.constraints.add(self)

        table_pks = [c for c in table.c if c.primary_key]
        if (
            self._columns
            and table_pks
            and set(table_pks) != set(self._columns)
        ):
            # black could not format these inline
            table_pk_str = ", ".join("'%s'" % c.name for c in table_pks)
            col_str = ", ".join("'%s'" % c.name for c in self._columns)

            util.warn(
                f"Table '{table.name}' specifies columns "
                f"{table_pk_str} as "
                f"primary_key=True, "
                f"not matching locally specified columns {col_str}; "
                f"setting the "
                f"current primary key columns to "
                f"{col_str}. "
                f"This warning "
                f"may become an exception in a future release"
            )
            table_pks[:] = []

        for c in self._columns:
            c.primary_key = True
            if c._user_defined_nullable is NULL_UNSPECIFIED:
                c.nullable = False
        if table_pks:
            self._columns.extend(table_pks)

    def _reload(self, columns: Iterable[Column[Any]]) -> None:
        """repopulate this :class:`.PrimaryKeyConstraint` given
        a set of columns.

        Existing columns in the table that are marked as primary_key=True
        are maintained.

        Also fires a new event.

        This is basically like putting a whole new
        :class:`.PrimaryKeyConstraint` object on the parent
        :class:`_schema.Table` object without actually replacing the object.

        The ordering of the given list of columns is also maintained; these
        columns will be appended to the list of columns after any which
        are already present.

        """
        # set the primary key flag on new columns.
        # note any existing PK cols on the table also have their
        # flag still set.
        for col in columns:
            col.primary_key = True

        self._columns.extend(columns)

        PrimaryKeyConstraint._autoincrement_column._reset(self)  # type: ignore
        self._set_parent_with_dispatch(self.table)

    def _replace(self, col: Column[Any]) -> None:
        PrimaryKeyConstraint._autoincrement_column._reset(self)  # type: ignore
        self._columns.replace(col)

        self.dispatch._sa_event_column_added_to_pk_constraint(self, col)

    @property
    def columns_autoinc_first(self) -> List[Column[Any]]:
        autoinc = self._autoincrement_column

        if autoinc is not None:
            return [autoinc] + [c for c in self._columns if c is not autoinc]
        else:
            return list(self._columns)

    @util.ro_memoized_property
    def _autoincrement_column(self) -> Optional[Column[int]]:
        def _validate_autoinc(col: Column[Any], autoinc_true: bool) -> bool:
            if col.type._type_affinity is None or not issubclass(
                col.type._type_affinity,
                (
                    type_api.INTEGERTYPE._type_affinity,
                    type_api.NUMERICTYPE._type_affinity,
                ),
            ):
                if autoinc_true:
                    raise exc.ArgumentError(
                        f"Column type {col.type} on column '{col}' is not "
                        f"compatible with autoincrement=True"
                    )
                else:
                    return False
            elif (
                not isinstance(col.default, (type(None), Sequence))
                and not autoinc_true
            ):
                return False
            elif (
                col.server_default is not None
                and not isinstance(col.server_default, Identity)
                and not autoinc_true
            ):
                return False
            elif col.foreign_keys and col.autoincrement not in (
                True,
                "ignore_fk",
            ):
                return False
            return True

        if len(self._columns) == 1:
            col = list(self._columns)[0]

            if col.autoincrement is True:
                _validate_autoinc(col, True)
                return col
            elif col.autoincrement in (
                "auto",
                "ignore_fk",
            ) and _validate_autoinc(col, False):
                return col
            else:
                return None

        else:
            autoinc = None
            for col in self._columns:
                if col.autoincrement is True:
                    _validate_autoinc(col, True)
                    if autoinc is not None:
                        raise exc.ArgumentError(
                            f"Only one Column may be marked "
                            f"autoincrement=True, found both "
                            f"{col.name} and {autoinc.name}."
                        )
                    else:
                        autoinc = col

            return autoinc


class UniqueConstraint(ColumnCollectionConstraint):
    """A table-level UNIQUE constraint.

    Defines a single column or composite UNIQUE constraint. For a no-frills,
    single column constraint, adding ``unique=True`` to the ``Column``
    definition is a shorthand equivalent for an unnamed, single column
    UniqueConstraint.
    """

    __visit_name__ = "unique_constraint"


class Index(
    DialectKWArgs, ColumnCollectionMixin, HasConditionalDDL, SchemaItem
):
    """A table-level INDEX.

    Defines a composite (one or more column) INDEX.

    E.g.::

        sometable = Table("sometable", metadata,
                        Column("name", String(50)),
                        Column("address", String(100))
                    )

        Index("some_index", sometable.c.name)

    For a no-frills, single column index, adding
    :class:`_schema.Column` also supports ``index=True``::

        sometable = Table("sometable", metadata,
                        Column("name", String(50), index=True)
                    )

    For a composite index, multiple columns can be specified::

        Index("some_index", sometable.c.name, sometable.c.address)

    Functional indexes are supported as well, typically by using the
    :data:`.func` construct in conjunction with table-bound
    :class:`_schema.Column` objects::

        Index("some_index", func.lower(sometable.c.name))

    An :class:`.Index` can also be manually associated with a
    :class:`_schema.Table`,
    either through inline declaration or using
    :meth:`_schema.Table.append_constraint`.  When this approach is used,
    the names
    of the indexed columns can be specified as strings::

        Table("sometable", metadata,
                        Column("name", String(50)),
                        Column("address", String(100)),
                        Index("some_index", "name", "address")
                )

    To support functional or expression-based indexes in this form, the
    :func:`_expression.text` construct may be used::

        from sqlalchemy import text

        Table("sometable", metadata,
                        Column("name", String(50)),
                        Column("address", String(100)),
                        Index("some_index", text("lower(name)"))
                )

    .. seealso::

        :ref:`schema_indexes` - General information on :class:`.Index`.

        :ref:`postgresql_indexes` - PostgreSQL-specific options available for
        the :class:`.Index` construct.

        :ref:`mysql_indexes` - MySQL-specific options available for the
        :class:`.Index` construct.

        :ref:`mssql_indexes` - MSSQL-specific options available for the
        :class:`.Index` construct.

    """

    __visit_name__ = "index"

    table: Optional[Table]
    expressions: _typing_Sequence[Union[str, ColumnElement[Any]]]
    _table_bound_expressions: _typing_Sequence[ColumnElement[Any]]

    def __init__(
        self,
        name: Optional[str],
        *expressions: _DDLColumnArgument,
        unique: bool = False,
        quote: Optional[bool] = None,
        info: Optional[_InfoType] = None,
        _table: Optional[Table] = None,
        _column_flag: bool = False,
        **dialect_kw: Any,
    ) -> None:
        r"""Construct an index object.

        :param name:
          The name of the index

        :param \*expressions:
          Column expressions to include in the index.   The expressions
          are normally instances of :class:`_schema.Column`, but may also
          be arbitrary SQL expressions which ultimately refer to a
          :class:`_schema.Column`.

        :param unique=False:
            Keyword only argument; if True, create a unique index.

        :param quote=None:
            Keyword only argument; whether to apply quoting to the name of
            the index.  Works in the same manner as that of
            :paramref:`_schema.Column.quote`.

        :param info=None: Optional data dictionary which will be populated
            into the :attr:`.SchemaItem.info` attribute of this object.

        :param \**dialect_kw: Additional keyword arguments not mentioned above
            are dialect specific, and passed in the form
            ``<dialectname>_<argname>``. See the documentation regarding an
            individual dialect at :ref:`dialect_toplevel` for detail on
            documented arguments.

        """
        self.table = table = None

        self.name = quoted_name.construct(name, quote)
        self.unique = unique
        if info is not None:
            self.info = info

        # TODO: consider "table" argument being public, but for
        # the purpose of the fix here, it starts as private.
        if _table is not None:
            table = _table

        self._validate_dialect_kwargs(dialect_kw)

        self.expressions = []
        # will call _set_parent() if table-bound column
        # objects are present
        ColumnCollectionMixin.__init__(
            self,
            *expressions,
            _column_flag=_column_flag,
            _gather_expressions=self.expressions,
        )
        if table is not None:
            self._set_parent(table)

    def _set_parent(self, parent: SchemaEventTarget, **kw: Any) -> None:
        table = parent
        assert isinstance(table, Table)
        ColumnCollectionMixin._set_parent(self, table)

        if self.table is not None and table is not self.table:
            raise exc.ArgumentError(
                f"Index '{self.name}' is against table "
                f"'{self.table.description}', and "
                f"cannot be associated with table '{table.description}'."
            )
        self.table = table
        table.indexes.add(self)

        expressions = self.expressions
        col_expressions = self._col_expressions(table)
        assert len(expressions) == len(col_expressions)

        exprs = []
        for expr, colexpr in zip(expressions, col_expressions):
            if isinstance(expr, ClauseElement):
                exprs.append(expr)
            elif colexpr is not None:
                exprs.append(colexpr)
            else:
                assert False
        self.expressions = self._table_bound_expressions = exprs

    def create(self, bind: _CreateDropBind, checkfirst: bool = False) -> None:
        """Issue a ``CREATE`` statement for this
        :class:`.Index`, using the given
        :class:`.Connection` or :class:`.Engine`` for connectivity.

        .. seealso::

            :meth:`_schema.MetaData.create_all`.

        """
        bind._run_ddl_visitor(ddl.SchemaGenerator, self, checkfirst=checkfirst)

    def drop(self, bind: _CreateDropBind, checkfirst: bool = False) -> None:
        """Issue a ``DROP`` statement for this
        :class:`.Index`, using the given
        :class:`.Connection` or :class:`.Engine` for connectivity.

        .. seealso::

            :meth:`_schema.MetaData.drop_all`.

        """
        bind._run_ddl_visitor(ddl.SchemaDropper, self, checkfirst=checkfirst)

    def __repr__(self) -> str:
        exprs: _typing_Sequence[Any]  # noqa: F842

        return "Index(%s)" % (
            ", ".join(
                [repr(self.name)]
                + [repr(e) for e in self.expressions]
                + (self.unique and ["unique=True"] or [])
            )
        )


_NamingSchemaCallable = Callable[[Constraint, Table], str]
_NamingSchemaDirective = Union[str, _NamingSchemaCallable]


class _NamingSchemaTD(TypedDict, total=False):
    fk: _NamingSchemaDirective
    pk: _NamingSchemaDirective
    ix: _NamingSchemaDirective
    ck: _NamingSchemaDirective
    uq: _NamingSchemaDirective


_NamingSchemaParameter = Union[
    # it seems like the TypedDict here is useful for pylance typeahead,
    # and not much else
    _NamingSchemaTD,
    # there is no form that allows Union[Type[Any], str] to work in all
    # cases, including breaking out Mapping[] entries for each combination
    # even, therefore keys must be `Any` (see #10264)
    Mapping[Any, _NamingSchemaDirective],
]


DEFAULT_NAMING_CONVENTION: _NamingSchemaParameter = util.immutabledict(
    {"ix": "ix_%(column_0_label)s"}
)


class MetaData(HasSchemaAttr):
    """A collection of :class:`_schema.Table`
    objects and their associated schema
    constructs.

    Holds a collection of :class:`_schema.Table` objects as well as
    an optional binding to an :class:`_engine.Engine` or
    :class:`_engine.Connection`.  If bound, the :class:`_schema.Table` objects
    in the collection and their columns may participate in implicit SQL
    execution.

    The :class:`_schema.Table` objects themselves are stored in the
    :attr:`_schema.MetaData.tables` dictionary.

    :class:`_schema.MetaData` is a thread-safe object for read operations.
    Construction of new tables within a single :class:`_schema.MetaData`
    object,
    either explicitly or via reflection, may not be completely thread-safe.

    .. seealso::

        :ref:`metadata_describing` - Introduction to database metadata

    """

    __visit_name__ = "metadata"

    def __init__(
        self,
        schema: Optional[str] = None,
        quote_schema: Optional[bool] = None,
        naming_convention: Optional[_NamingSchemaParameter] = None,
        info: Optional[_InfoType] = None,
    ) -> None:
        """Create a new MetaData object.

        :param schema:
           The default schema to use for the :class:`_schema.Table`,
           :class:`.Sequence`, and potentially other objects associated with
           this :class:`_schema.MetaData`. Defaults to ``None``.

           .. seealso::

                :ref:`schema_metadata_schema_name` - details on how the
                :paramref:`_schema.MetaData.schema` parameter is used.

                :paramref:`_schema.Table.schema`

                :paramref:`.Sequence.schema`

        :param quote_schema:
            Sets the ``quote_schema`` flag for those :class:`_schema.Table`,
            :class:`.Sequence`, and other objects which make usage of the
            local ``schema`` name.

        :param info: Optional data dictionary which will be populated into the
            :attr:`.SchemaItem.info` attribute of this object.

        :param naming_convention: a dictionary referring to values which
          will establish default naming conventions for :class:`.Constraint`
          and :class:`.Index` objects, for those objects which are not given
          a name explicitly.

          The keys of this dictionary may be:

          * a constraint or Index class, e.g. the :class:`.UniqueConstraint`,
            :class:`_schema.ForeignKeyConstraint` class, the :class:`.Index`
            class

          * a string mnemonic for one of the known constraint classes;
            ``"fk"``, ``"pk"``, ``"ix"``, ``"ck"``, ``"uq"`` for foreign key,
            primary key, index, check, and unique constraint, respectively.

          * the string name of a user-defined "token" that can be used
            to define new naming tokens.

          The values associated with each "constraint class" or "constraint
          mnemonic" key are string naming templates, such as
          ``"uq_%(table_name)s_%(column_0_name)s"``,
          which describe how the name should be composed.  The values
          associated with user-defined "token" keys should be callables of the
          form ``fn(constraint, table)``, which accepts the constraint/index
          object and :class:`_schema.Table` as arguments, returning a string
          result.

          The built-in names are as follows, some of which may only be
          available for certain types of constraint:

            * ``%(table_name)s`` - the name of the :class:`_schema.Table`
              object
              associated with the constraint.

            * ``%(referred_table_name)s`` - the name of the
              :class:`_schema.Table`
              object associated with the referencing target of a
              :class:`_schema.ForeignKeyConstraint`.

            * ``%(column_0_name)s`` - the name of the :class:`_schema.Column`
              at
              index position "0" within the constraint.

            * ``%(column_0N_name)s`` - the name of all :class:`_schema.Column`
              objects in order within the constraint, joined without a
              separator.

            * ``%(column_0_N_name)s`` - the name of all
              :class:`_schema.Column`
              objects in order within the constraint, joined with an
              underscore as a separator.

            * ``%(column_0_label)s``, ``%(column_0N_label)s``,
              ``%(column_0_N_label)s`` - the label of either the zeroth
              :class:`_schema.Column` or all :class:`.Columns`, separated with
              or without an underscore

            * ``%(column_0_key)s``, ``%(column_0N_key)s``,
              ``%(column_0_N_key)s`` - the key of either the zeroth
              :class:`_schema.Column` or all :class:`.Columns`, separated with
              or without an underscore

            * ``%(referred_column_0_name)s``, ``%(referred_column_0N_name)s``
              ``%(referred_column_0_N_name)s``,  ``%(referred_column_0_key)s``,
              ``%(referred_column_0N_key)s``, ...  column tokens which
              render the names/keys/labels of columns that are referenced
              by a  :class:`_schema.ForeignKeyConstraint`.

            * ``%(constraint_name)s`` - a special key that refers to the
              existing name given to the constraint.  When this key is
              present, the :class:`.Constraint` object's existing name will be
              replaced with one that is composed from template string that
              uses this token. When this token is present, it is required that
              the :class:`.Constraint` is given an explicit name ahead of time.

            * user-defined: any additional token may be implemented by passing
              it along with a ``fn(constraint, table)`` callable to the
              naming_convention dictionary.

          .. versionadded:: 1.3.0 - added new ``%(column_0N_name)s``,
             ``%(column_0_N_name)s``, and related tokens that produce
             concatenations of names, keys, or labels for all columns referred
             to by a given constraint.

          .. seealso::

                :ref:`constraint_naming_conventions` - for detailed usage
                examples.

        """
        if schema is not None and not isinstance(schema, str):
            raise exc.ArgumentError(
                "expected schema argument to be a string, "
                f"got {type(schema)}."
            )
        self.tables = util.FacadeDict()
        self.schema = quoted_name.construct(schema, quote_schema)
        self.naming_convention = (
            naming_convention
            if naming_convention
            else DEFAULT_NAMING_CONVENTION
        )
        if info:
            self.info = info
        self._schemas: Set[str] = set()
        self._sequences: Dict[str, Sequence] = {}
        self._fk_memos: Dict[
            Tuple[str, Optional[str]], List[ForeignKey]
        ] = collections.defaultdict(list)

    tables: util.FacadeDict[str, Table]
    """A dictionary of :class:`_schema.Table`
    objects keyed to their name or "table key".

    The exact key is that determined by the :attr:`_schema.Table.key`
    attribute;
    for a table with no :attr:`_schema.Table.schema` attribute,
    this is the same
    as :attr:`_schema.Table.name`.  For a table with a schema,
    it is typically of the
    form ``schemaname.tablename``.

    .. seealso::

        :attr:`_schema.MetaData.sorted_tables`

    """

    def __repr__(self) -> str:
        return "MetaData()"

    def __contains__(self, table_or_key: Union[str, Table]) -> bool:
        if not isinstance(table_or_key, str):
            table_or_key = table_or_key.key
        return table_or_key in self.tables

    def _add_table(
        self, name: str, schema: Optional[str], table: Table
    ) -> None:
        key = _get_table_key(name, schema)
        self.tables._insert_item(key, table)
        if schema:
            self._schemas.add(schema)

    def _remove_table(self, name: str, schema: Optional[str]) -> None:
        key = _get_table_key(name, schema)
        removed = dict.pop(self.tables, key, None)
        if removed is not None:
            for fk in removed.foreign_keys:
                fk._remove_from_metadata(self)
        if self._schemas:
            self._schemas = {
                t.schema for t in self.tables.values() if t.schema is not None
            }

    def __getstate__(self) -> Dict[str, Any]:
        return {
            "tables": self.tables,
            "schema": self.schema,
            "schemas": self._schemas,
            "sequences": self._sequences,
            "fk_memos": self._fk_memos,
            "naming_convention": self.naming_convention,
        }

    def __setstate__(self, state: Dict[str, Any]) -> None:
        self.tables = state["tables"]
        self.schema = state["schema"]
        self.naming_convention = state["naming_convention"]
        self._sequences = state["sequences"]
        self._schemas = state["schemas"]
        self._fk_memos = state["fk_memos"]

    def clear(self) -> None:
        """Clear all Table objects from this MetaData."""

        dict.clear(self.tables)  # type: ignore
        self._schemas.clear()
        self._fk_memos.clear()

    def remove(self, table: Table) -> None:
        """Remove the given Table object from this MetaData."""

        self._remove_table(table.name, table.schema)

    @property
    def sorted_tables(self) -> List[Table]:
        """Returns a list of :class:`_schema.Table` objects sorted in order of
        foreign key dependency.

        The sorting will place :class:`_schema.Table`
        objects that have dependencies
        first, before the dependencies themselves, representing the
        order in which they can be created.   To get the order in which
        the tables would be dropped, use the ``reversed()`` Python built-in.

        .. warning::

            The :attr:`.MetaData.sorted_tables` attribute cannot by itself
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
               :attr:`.MetaData.sorted_tables` cannot perform a proper sort
               due to cyclical dependencies.  This will be an exception in a
               future release.  Additionally, the sort will continue to return
               other tables not involved in the cycle in dependency order which
               was not the case previously.

        .. seealso::

            :func:`_schema.sort_tables`

            :func:`_schema.sort_tables_and_constraints`

            :attr:`_schema.MetaData.tables`

            :meth:`_reflection.Inspector.get_table_names`

            :meth:`_reflection.Inspector.get_sorted_table_and_fkc_names`


        """
        return ddl.sort_tables(
            sorted(self.tables.values(), key=lambda t: t.key)  # type: ignore
        )

    @util.preload_module("sqlalchemy.engine.reflection")
    def reflect(
        self,
        bind: Union[Engine, Connection],
        schema: Optional[str] = None,
        views: bool = False,
        only: Union[
            _typing_Sequence[str], Callable[[str, MetaData], bool], None
        ] = None,
        extend_existing: bool = False,
        autoload_replace: bool = True,
        resolve_fks: bool = True,
        **dialect_kwargs: Any,
    ) -> None:
        r"""Load all available table definitions from the database.

        Automatically creates ``Table`` entries in this ``MetaData`` for any
        table available in the database but not yet present in the
        ``MetaData``.  May be called multiple times to pick up tables recently
        added to the database, however no special action is taken if a table
        in this ``MetaData`` no longer exists in the database.

        :param bind:
          A :class:`.Connection` or :class:`.Engine` used to access the
          database.

        :param schema:
          Optional, query and reflect tables from an alternate schema.
          If None, the schema associated with this :class:`_schema.MetaData`
          is used, if any.

        :param views:
          If True, also reflect views (materialized and plain).

        :param only:
          Optional.  Load only a sub-set of available named tables.  May be
          specified as a sequence of names or a callable.

          If a sequence of names is provided, only those tables will be
          reflected.  An error is raised if a table is requested but not
          available.  Named tables already present in this ``MetaData`` are
          ignored.

          If a callable is provided, it will be used as a boolean predicate to
          filter the list of potential table names.  The callable is called
          with a table name and this ``MetaData`` instance as positional
          arguments and should return a true value for any table to reflect.

        :param extend_existing: Passed along to each :class:`_schema.Table` as
          :paramref:`_schema.Table.extend_existing`.

        :param autoload_replace: Passed along to each :class:`_schema.Table`
          as
          :paramref:`_schema.Table.autoload_replace`.

        :param resolve_fks: if True, reflect :class:`_schema.Table`
         objects linked
         to :class:`_schema.ForeignKey` objects located in each
         :class:`_schema.Table`.
         For :meth:`_schema.MetaData.reflect`,
         this has the effect of reflecting
         related tables that might otherwise not be in the list of tables
         being reflected, for example if the referenced table is in a
         different schema or is omitted via the
         :paramref:`.MetaData.reflect.only` parameter.  When False,
         :class:`_schema.ForeignKey` objects are not followed to the
         :class:`_schema.Table`
         in which they link, however if the related table is also part of the
         list of tables that would be reflected in any case, the
         :class:`_schema.ForeignKey` object will still resolve to its related
         :class:`_schema.Table` after the :meth:`_schema.MetaData.reflect`
         operation is
         complete.   Defaults to True.

         .. versionadded:: 1.3.0

         .. seealso::

            :paramref:`_schema.Table.resolve_fks`

        :param \**dialect_kwargs: Additional keyword arguments not mentioned
         above are dialect specific, and passed in the form
         ``<dialectname>_<argname>``.  See the documentation regarding an
         individual dialect at :ref:`dialect_toplevel` for detail on
         documented arguments.

        .. seealso::

            :ref:`metadata_reflection_toplevel`

            :meth:`_events.DDLEvents.column_reflect` - Event used to customize
            the reflected columns. Usually used to generalize the types using
            :meth:`_types.TypeEngine.as_generic`

            :ref:`metadata_reflection_dbagnostic_types` - describes how to
            reflect tables using general types.

        """

        with inspection.inspect(bind)._inspection_context() as insp:
            reflect_opts: Any = {
                "autoload_with": insp,
                "extend_existing": extend_existing,
                "autoload_replace": autoload_replace,
                "resolve_fks": resolve_fks,
                "_extend_on": set(),
            }

            reflect_opts.update(dialect_kwargs)

            if schema is None:
                schema = self.schema

            if schema is not None:
                reflect_opts["schema"] = schema

            kind = util.preloaded.engine_reflection.ObjectKind.TABLE
            available: util.OrderedSet[str] = util.OrderedSet(
                insp.get_table_names(schema)
            )
            if views:
                kind = util.preloaded.engine_reflection.ObjectKind.ANY
                available.update(insp.get_view_names(schema))
                try:
                    available.update(insp.get_materialized_view_names(schema))
                except NotImplementedError:
                    pass

            if schema is not None:
                available_w_schema: util.OrderedSet[str] = util.OrderedSet(
                    [f"{schema}.{name}" for name in available]
                )
            else:
                available_w_schema = available

            current = set(self.tables)

            if only is None:
                load = [
                    name
                    for name, schname in zip(available, available_w_schema)
                    if extend_existing or schname not in current
                ]
            elif callable(only):
                load = [
                    name
                    for name, schname in zip(available, available_w_schema)
                    if (extend_existing or schname not in current)
                    and only(name, self)
                ]
            else:
                missing = [name for name in only if name not in available]
                if missing:
                    s = schema and (" schema '%s'" % schema) or ""
                    missing_str = ", ".join(missing)
                    raise exc.InvalidRequestError(
                        f"Could not reflect: requested table(s) not available "
                        f"in {bind.engine!r}{s}: ({missing_str})"
                    )
                load = [
                    name
                    for name in only
                    if extend_existing or name not in current
                ]
            # pass the available tables so the inspector can
            # choose to ignore the filter_names
            _reflect_info = insp._get_reflection_info(
                schema=schema,
                filter_names=load,
                available=available,
                kind=kind,
                scope=util.preloaded.engine_reflection.ObjectScope.ANY,
                **dialect_kwargs,
            )
            reflect_opts["_reflect_info"] = _reflect_info

            for name in load:
                try:
                    Table(name, self, **reflect_opts)
                except exc.UnreflectableTableError as uerr:
                    util.warn(f"Skipping table {name}: {uerr}")

    def create_all(
        self,
        bind: _CreateDropBind,
        tables: Optional[_typing_Sequence[Table]] = None,
        checkfirst: bool = True,
    ) -> None:
        """Create all tables stored in this metadata.

        Conditional by default, will not attempt to recreate tables already
        present in the target database.

        :param bind:
          A :class:`.Connection` or :class:`.Engine` used to access the
          database.

        :param tables:
          Optional list of ``Table`` objects, which is a subset of the total
          tables in the ``MetaData`` (others are ignored).

        :param checkfirst:
          Defaults to True, don't issue CREATEs for tables already present
          in the target database.

        """
        bind._run_ddl_visitor(
            ddl.SchemaGenerator, self, checkfirst=checkfirst, tables=tables
        )

    def drop_all(
        self,
        bind: _CreateDropBind,
        tables: Optional[_typing_Sequence[Table]] = None,
        checkfirst: bool = True,
    ) -> None:
        """Drop all tables stored in this metadata.

        Conditional by default, will not attempt to drop tables not present in
        the target database.

        :param bind:
          A :class:`.Connection` or :class:`.Engine` used to access the
          database.

        :param tables:
          Optional list of ``Table`` objects, which is a subset of the
          total tables in the ``MetaData`` (others are ignored).

        :param checkfirst:
          Defaults to True, only issue DROPs for tables confirmed to be
          present in the target database.

        """
        bind._run_ddl_visitor(
            ddl.SchemaDropper, self, checkfirst=checkfirst, tables=tables
        )


class Computed(FetchedValue, SchemaItem):
    """Defines a generated column, i.e. "GENERATED ALWAYS AS" syntax.

    The :class:`.Computed` construct is an inline construct added to the
    argument list of a :class:`_schema.Column` object::

        from sqlalchemy import Computed

        Table('square', metadata_obj,
            Column('side', Float, nullable=False),
            Column('area', Float, Computed('side * side'))
        )

    See the linked documentation below for complete details.

    .. versionadded:: 1.3.11

    .. seealso::

        :ref:`computed_ddl`

    """

    __visit_name__ = "computed_column"

    column: Optional[Column[Any]]

    @_document_text_coercion(
        "sqltext", ":class:`.Computed`", ":paramref:`.Computed.sqltext`"
    )
    def __init__(
        self, sqltext: _DDLColumnArgument, persisted: Optional[bool] = None
    ) -> None:
        """Construct a GENERATED ALWAYS AS DDL construct to accompany a
        :class:`_schema.Column`.

        :param sqltext:
          A string containing the column generation expression, which will be
          used verbatim, or a SQL expression construct, such as a
          :func:`_expression.text`
          object.   If given as a string, the object is converted to a
          :func:`_expression.text` object.

        :param persisted:
          Optional, controls how this column should be persisted by the
          database.   Possible values are:

          * ``None``, the default, it will use the default persistence
            defined by the database.
          * ``True``, will render ``GENERATED ALWAYS AS ... STORED``, or the
            equivalent for the target database if supported.
          * ``False``, will render ``GENERATED ALWAYS AS ... VIRTUAL``, or
            the equivalent for the target database if supported.

          Specifying ``True`` or ``False`` may raise an error when the DDL
          is emitted to the target database if the database does not support
          that persistence option.   Leaving this parameter at its default
          of ``None`` is guaranteed to succeed for all databases that support
          ``GENERATED ALWAYS AS``.

        """
        self.sqltext = coercions.expect(roles.DDLExpressionRole, sqltext)
        self.persisted = persisted
        self.column = None

    def _set_parent(self, parent: SchemaEventTarget, **kw: Any) -> None:
        assert isinstance(parent, Column)

        if not isinstance(
            parent.server_default, (type(None), Computed)
        ) or not isinstance(parent.server_onupdate, (type(None), Computed)):
            raise exc.ArgumentError(
                "A generated column cannot specify a server_default or a "
                "server_onupdate argument"
            )
        self.column = parent
        parent.computed = self
        self.column.server_onupdate = self
        self.column.server_default = self

    def _as_for_update(self, for_update: bool) -> FetchedValue:
        return self

    @util.deprecated(
        "1.4",
        "The :meth:`_schema.Computed.copy` method is deprecated "
        "and will be removed in a future release.",
    )
    def copy(
        self, *, target_table: Optional[Table] = None, **kw: Any
    ) -> Computed:
        return self._copy(target_table=target_table, **kw)

    def _copy(
        self, *, target_table: Optional[Table] = None, **kw: Any
    ) -> Computed:
        sqltext = _copy_expression(
            self.sqltext,
            self.column.table if self.column is not None else None,
            target_table,
        )
        g = Computed(sqltext, persisted=self.persisted)

        return self._schema_item_copy(g)


class Identity(IdentityOptions, FetchedValue, SchemaItem):
    """Defines an identity column, i.e. "GENERATED { ALWAYS | BY DEFAULT }
    AS IDENTITY" syntax.

    The :class:`.Identity` construct is an inline construct added to the
    argument list of a :class:`_schema.Column` object::

        from sqlalchemy import Identity

        Table('foo', metadata_obj,
            Column('id', Integer, Identity())
            Column('description', Text),
        )

    See the linked documentation below for complete details.

    .. versionadded:: 1.4

    .. seealso::

        :ref:`identity_ddl`

    """

    __visit_name__ = "identity_column"

    is_identity = True

    def __init__(
        self,
        always: bool = False,
        on_null: Optional[bool] = None,
        start: Optional[int] = None,
        increment: Optional[int] = None,
        minvalue: Optional[int] = None,
        maxvalue: Optional[int] = None,
        nominvalue: Optional[bool] = None,
        nomaxvalue: Optional[bool] = None,
        cycle: Optional[bool] = None,
        cache: Optional[int] = None,
        order: Optional[bool] = None,
    ) -> None:
        """Construct a GENERATED { ALWAYS | BY DEFAULT } AS IDENTITY DDL
        construct to accompany a :class:`_schema.Column`.

        See the :class:`.Sequence` documentation for a complete description
        of most parameters.

        .. note::
            MSSQL supports this construct as the preferred alternative to
            generate an IDENTITY on a column, but it uses non standard
            syntax that only support :paramref:`_schema.Identity.start`
            and :paramref:`_schema.Identity.increment`.
            All other parameters are ignored.

        :param always:
          A boolean, that indicates the type of identity column.
          If ``False`` is specified, the default, then the user-specified
          value takes precedence.
          If ``True`` is specified, a user-specified value is not accepted (
          on some backends, like PostgreSQL, OVERRIDING SYSTEM VALUE, or
          similar, may be specified in an INSERT to override the sequence
          value).
          Some backends also have a default value for this parameter,
          ``None`` can be used to omit rendering this part in the DDL. It
          will be treated as ``False`` if a backend does not have a default
          value.

        :param on_null:
          Set to ``True`` to specify ON NULL in conjunction with a
          ``always=False`` identity column. This option is only supported on
          some backends, like Oracle.

        :param start: the starting index of the sequence.
        :param increment: the increment value of the sequence.
        :param minvalue: the minimum value of the sequence.
        :param maxvalue: the maximum value of the sequence.
        :param nominvalue: no minimum value of the sequence.
        :param nomaxvalue: no maximum value of the sequence.
        :param cycle: allows the sequence to wrap around when the maxvalue
         or minvalue has been reached.
        :param cache: optional integer value; number of future values in the
         sequence which are calculated in advance.
        :param order: optional boolean value; if true, renders the
         ORDER keyword.

        """
        IdentityOptions.__init__(
            self,
            start=start,
            increment=increment,
            minvalue=minvalue,
            maxvalue=maxvalue,
            nominvalue=nominvalue,
            nomaxvalue=nomaxvalue,
            cycle=cycle,
            cache=cache,
            order=order,
        )
        self.always = always
        self.on_null = on_null
        self.column = None

    def _set_parent(self, parent: SchemaEventTarget, **kw: Any) -> None:
        assert isinstance(parent, Column)
        if not isinstance(
            parent.server_default, (type(None), Identity)
        ) or not isinstance(parent.server_onupdate, type(None)):
            raise exc.ArgumentError(
                "A column with an Identity object cannot specify a "
                "server_default or a server_onupdate argument"
            )
        if parent.autoincrement is False:
            raise exc.ArgumentError(
                "A column with an Identity object cannot specify "
                "autoincrement=False"
            )
        self.column = parent

        parent.identity = self
        if parent._user_defined_nullable is NULL_UNSPECIFIED:
            parent.nullable = False

        parent.server_default = self

    def _as_for_update(self, for_update: bool) -> FetchedValue:
        return self

    @util.deprecated(
        "1.4",
        "The :meth:`_schema.Identity.copy` method is deprecated "
        "and will be removed in a future release.",
    )
    def copy(self, **kw: Any) -> Identity:
        return self._copy(**kw)

    def _copy(self, **kw: Any) -> Identity:
        i = Identity(
            always=self.always,
            on_null=self.on_null,
            start=self.start,
            increment=self.increment,
            minvalue=self.minvalue,
            maxvalue=self.maxvalue,
            nominvalue=self.nominvalue,
            nomaxvalue=self.nomaxvalue,
            cycle=self.cycle,
            cache=self.cache,
            order=self.order,
        )

        return self._schema_item_copy(i)
