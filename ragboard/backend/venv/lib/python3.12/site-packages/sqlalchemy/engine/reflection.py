# engine/reflection.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Provides an abstraction for obtaining database schema information.

Usage Notes:

Here are some general conventions when accessing the low level inspector
methods such as get_table_names, get_columns, etc.

1. Inspector methods return lists of dicts in most cases for the following
   reasons:

   * They're both standard types that can be serialized.
   * Using a dict instead of a tuple allows easy expansion of attributes.
   * Using a list for the outer structure maintains order and is easy to work
     with (e.g. list comprehension [d['name'] for d in cols]).

2. Records that contain a name, such as the column name in a column record
   use the key 'name'. So for most return values, each record will have a
   'name' attribute..
"""
from __future__ import annotations

import contextlib
from dataclasses import dataclass
from enum import auto
from enum import Flag
from enum import unique
from typing import Any
from typing import Callable
from typing import Collection
from typing import Dict
from typing import Generator
from typing import Iterable
from typing import List
from typing import Optional
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from .base import Connection
from .base import Engine
from .. import exc
from .. import inspection
from .. import sql
from .. import util
from ..sql import operators
from ..sql import schema as sa_schema
from ..sql.cache_key import _ad_hoc_cache_key_from_args
from ..sql.elements import TextClause
from ..sql.type_api import TypeEngine
from ..sql.visitors import InternalTraversal
from ..util import topological
from ..util.typing import final

if TYPE_CHECKING:
    from .interfaces import Dialect
    from .interfaces import ReflectedCheckConstraint
    from .interfaces import ReflectedColumn
    from .interfaces import ReflectedForeignKeyConstraint
    from .interfaces import ReflectedIndex
    from .interfaces import ReflectedPrimaryKeyConstraint
    from .interfaces import ReflectedTableComment
    from .interfaces import ReflectedUniqueConstraint
    from .interfaces import TableKey

_R = TypeVar("_R")


@util.decorator
def cache(
    fn: Callable[..., _R],
    self: Dialect,
    con: Connection,
    *args: Any,
    **kw: Any,
) -> _R:
    info_cache = kw.get("info_cache", None)
    if info_cache is None:
        return fn(self, con, *args, **kw)
    exclude = {"info_cache", "unreflectable"}
    key = (
        fn.__name__,
        tuple(a for a in args if isinstance(a, str)),
        tuple((k, v) for k, v in kw.items() if k not in exclude),
    )
    ret: _R = info_cache.get(key)
    if ret is None:
        ret = fn(self, con, *args, **kw)
        info_cache[key] = ret
    return ret


def flexi_cache(
    *traverse_args: Tuple[str, InternalTraversal]
) -> Callable[[Callable[..., _R]], Callable[..., _R]]:
    @util.decorator
    def go(
        fn: Callable[..., _R],
        self: Dialect,
        con: Connection,
        *args: Any,
        **kw: Any,
    ) -> _R:
        info_cache = kw.get("info_cache", None)
        if info_cache is None:
            return fn(self, con, *args, **kw)
        key = _ad_hoc_cache_key_from_args((fn.__name__,), traverse_args, args)
        ret: _R = info_cache.get(key)
        if ret is None:
            ret = fn(self, con, *args, **kw)
            info_cache[key] = ret
        return ret

    return go


@unique
class ObjectKind(Flag):
    """Enumerator that indicates which kind of object to return when calling
    the ``get_multi`` methods.

    This is a Flag enum, so custom combinations can be passed. For example,
    to reflect tables and plain views ``ObjectKind.TABLE | ObjectKind.VIEW``
    may be used.

    .. note::
      Not all dialect may support all kind of object. If a dialect does
      not support a particular object an empty dict is returned.
      In case a dialect supports an object, but the requested method
      is not applicable for the specified kind the default value
      will be returned for each reflected object. For example reflecting
      check constraints of view return a dict with all the views with
      empty lists as values.
    """

    TABLE = auto()
    "Reflect table objects"
    VIEW = auto()
    "Reflect plain view objects"
    MATERIALIZED_VIEW = auto()
    "Reflect materialized view object"

    ANY_VIEW = VIEW | MATERIALIZED_VIEW
    "Reflect any kind of view objects"
    ANY = TABLE | VIEW | MATERIALIZED_VIEW
    "Reflect all type of objects"


@unique
class ObjectScope(Flag):
    """Enumerator that indicates which scope to use when calling
    the ``get_multi`` methods.
    """

    DEFAULT = auto()
    "Include default scope"
    TEMPORARY = auto()
    "Include only temp scope"
    ANY = DEFAULT | TEMPORARY
    "Include both default and temp scope"


@inspection._self_inspects
class Inspector(inspection.Inspectable["Inspector"]):
    """Performs database schema inspection.

    The Inspector acts as a proxy to the reflection methods of the
    :class:`~sqlalchemy.engine.interfaces.Dialect`, providing a
    consistent interface as well as caching support for previously
    fetched metadata.

    A :class:`_reflection.Inspector` object is usually created via the
    :func:`_sa.inspect` function, which may be passed an
    :class:`_engine.Engine`
    or a :class:`_engine.Connection`::

        from sqlalchemy import inspect, create_engine
        engine = create_engine('...')
        insp = inspect(engine)

    Where above, the :class:`~sqlalchemy.engine.interfaces.Dialect` associated
    with the engine may opt to return an :class:`_reflection.Inspector`
    subclass that
    provides additional methods specific to the dialect's target database.

    """

    bind: Union[Engine, Connection]
    engine: Engine
    _op_context_requires_connect: bool
    dialect: Dialect
    info_cache: Dict[Any, Any]

    @util.deprecated(
        "1.4",
        "The __init__() method on :class:`_reflection.Inspector` "
        "is deprecated and "
        "will be removed in a future release.  Please use the "
        ":func:`.sqlalchemy.inspect` "
        "function on an :class:`_engine.Engine` or "
        ":class:`_engine.Connection` "
        "in order to "
        "acquire an :class:`_reflection.Inspector`.",
    )
    def __init__(self, bind: Union[Engine, Connection]):
        """Initialize a new :class:`_reflection.Inspector`.

        :param bind: a :class:`~sqlalchemy.engine.Connection`,
          which is typically an instance of
          :class:`~sqlalchemy.engine.Engine` or
          :class:`~sqlalchemy.engine.Connection`.

        For a dialect-specific instance of :class:`_reflection.Inspector`, see
        :meth:`_reflection.Inspector.from_engine`

        """
        self._init_legacy(bind)

    @classmethod
    def _construct(
        cls, init: Callable[..., Any], bind: Union[Engine, Connection]
    ) -> Inspector:
        if hasattr(bind.dialect, "inspector"):
            cls = bind.dialect.inspector

        self = cls.__new__(cls)
        init(self, bind)
        return self

    def _init_legacy(self, bind: Union[Engine, Connection]) -> None:
        if hasattr(bind, "exec_driver_sql"):
            self._init_connection(bind)  # type: ignore[arg-type]
        else:
            self._init_engine(bind)

    def _init_engine(self, engine: Engine) -> None:
        self.bind = self.engine = engine
        engine.connect().close()
        self._op_context_requires_connect = True
        self.dialect = self.engine.dialect
        self.info_cache = {}

    def _init_connection(self, connection: Connection) -> None:
        self.bind = connection
        self.engine = connection.engine
        self._op_context_requires_connect = False
        self.dialect = self.engine.dialect
        self.info_cache = {}

    def clear_cache(self) -> None:
        """reset the cache for this :class:`.Inspector`.

        Inspection methods that have data cached will emit SQL queries
        when next called to get new data.

        .. versionadded:: 2.0

        """
        self.info_cache.clear()

    @classmethod
    @util.deprecated(
        "1.4",
        "The from_engine() method on :class:`_reflection.Inspector` "
        "is deprecated and "
        "will be removed in a future release.  Please use the "
        ":func:`.sqlalchemy.inspect` "
        "function on an :class:`_engine.Engine` or "
        ":class:`_engine.Connection` "
        "in order to "
        "acquire an :class:`_reflection.Inspector`.",
    )
    def from_engine(cls, bind: Engine) -> Inspector:
        """Construct a new dialect-specific Inspector object from the given
        engine or connection.

        :param bind: a :class:`~sqlalchemy.engine.Connection`
         or :class:`~sqlalchemy.engine.Engine`.

        This method differs from direct a direct constructor call of
        :class:`_reflection.Inspector` in that the
        :class:`~sqlalchemy.engine.interfaces.Dialect` is given a chance to
        provide a dialect-specific :class:`_reflection.Inspector` instance,
        which may
        provide additional methods.

        See the example at :class:`_reflection.Inspector`.

        """
        return cls._construct(cls._init_legacy, bind)

    @inspection._inspects(Engine)
    def _engine_insp(bind: Engine) -> Inspector:  # type: ignore[misc]
        return Inspector._construct(Inspector._init_engine, bind)

    @inspection._inspects(Connection)
    def _connection_insp(bind: Connection) -> Inspector:  # type: ignore[misc]
        return Inspector._construct(Inspector._init_connection, bind)

    @contextlib.contextmanager
    def _operation_context(self) -> Generator[Connection, None, None]:
        """Return a context that optimizes for multiple operations on a single
        transaction.

        This essentially allows connect()/close() to be called if we detected
        that we're against an :class:`_engine.Engine` and not a
        :class:`_engine.Connection`.

        """
        conn: Connection
        if self._op_context_requires_connect:
            conn = self.bind.connect()  # type: ignore[union-attr]
        else:
            conn = self.bind  # type: ignore[assignment]
        try:
            yield conn
        finally:
            if self._op_context_requires_connect:
                conn.close()

    @contextlib.contextmanager
    def _inspection_context(self) -> Generator[Inspector, None, None]:
        """Return an :class:`_reflection.Inspector`
        from this one that will run all
        operations on a single connection.

        """

        with self._operation_context() as conn:
            sub_insp = self._construct(self.__class__._init_connection, conn)
            sub_insp.info_cache = self.info_cache
            yield sub_insp

    @property
    def default_schema_name(self) -> Optional[str]:
        """Return the default schema name presented by the dialect
        for the current engine's database user.

        E.g. this is typically ``public`` for PostgreSQL and ``dbo``
        for SQL Server.

        """
        return self.dialect.default_schema_name

    def get_schema_names(self, **kw: Any) -> List[str]:
        r"""Return all schema names.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.
        """

        with self._operation_context() as conn:
            return self.dialect.get_schema_names(
                conn, info_cache=self.info_cache, **kw
            )

    def get_table_names(
        self, schema: Optional[str] = None, **kw: Any
    ) -> List[str]:
        r"""Return all table names within a particular schema.

        The names are expected to be real tables only, not views.
        Views are instead returned using the
        :meth:`_reflection.Inspector.get_view_names` and/or
        :meth:`_reflection.Inspector.get_materialized_view_names`
        methods.

        :param schema: Schema name. If ``schema`` is left at ``None``, the
         database's default schema is
         used, else the named schema is searched.  If the database does not
         support named schemas, behavior is undefined if ``schema`` is not
         passed as ``None``.  For special quoting, use :class:`.quoted_name`.
        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        .. seealso::

            :meth:`_reflection.Inspector.get_sorted_table_and_fkc_names`

            :attr:`_schema.MetaData.sorted_tables`

        """

        with self._operation_context() as conn:
            return self.dialect.get_table_names(
                conn, schema, info_cache=self.info_cache, **kw
            )

    def has_table(
        self, table_name: str, schema: Optional[str] = None, **kw: Any
    ) -> bool:
        r"""Return True if the backend has a table, view, or temporary
        table of the given name.

        :param table_name: name of the table to check
        :param schema: schema name to query, if not the default schema.
        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        .. versionadded:: 1.4 - the :meth:`.Inspector.has_table` method
           replaces the :meth:`_engine.Engine.has_table` method.

        .. versionchanged:: 2.0:: :meth:`.Inspector.has_table` now formally
           supports checking for additional table-like objects:

           * any type of views (plain or materialized)
           * temporary tables of any kind

           Previously, these two checks were not formally specified and
           different dialects would vary in their behavior.   The dialect
           testing suite now includes tests for all of these object types
           and should be supported by all SQLAlchemy-included dialects.
           Support among third party dialects may be lagging, however.

        """
        with self._operation_context() as conn:
            return self.dialect.has_table(
                conn, table_name, schema, info_cache=self.info_cache, **kw
            )

    def has_sequence(
        self, sequence_name: str, schema: Optional[str] = None, **kw: Any
    ) -> bool:
        r"""Return True if the backend has a sequence with the given name.

        :param sequence_name: name of the sequence to check
        :param schema: schema name to query, if not the default schema.
        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        .. versionadded:: 1.4

        """
        with self._operation_context() as conn:
            return self.dialect.has_sequence(
                conn, sequence_name, schema, info_cache=self.info_cache, **kw
            )

    def has_index(
        self,
        table_name: str,
        index_name: str,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> bool:
        r"""Check the existence of a particular index name in the database.

        :param table_name: the name of the table the index belongs to
        :param index_name: the name of the index to check
        :param schema: schema name to query, if not the default schema.
        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        .. versionadded:: 2.0

        """
        with self._operation_context() as conn:
            return self.dialect.has_index(
                conn,
                table_name,
                index_name,
                schema,
                info_cache=self.info_cache,
                **kw,
            )

    def has_schema(self, schema_name: str, **kw: Any) -> bool:
        r"""Return True if the backend has a schema with the given name.

        :param schema_name: name of the schema to check
        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        .. versionadded:: 2.0

        """
        with self._operation_context() as conn:
            return self.dialect.has_schema(
                conn, schema_name, info_cache=self.info_cache, **kw
            )

    def get_sorted_table_and_fkc_names(
        self,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> List[Tuple[Optional[str], List[Tuple[str, Optional[str]]]]]:
        r"""Return dependency-sorted table and foreign key constraint names in
        referred to within a particular schema.

        This will yield 2-tuples of
        ``(tablename, [(tname, fkname), (tname, fkname), ...])``
        consisting of table names in CREATE order grouped with the foreign key
        constraint names that are not detected as belonging to a cycle.
        The final element
        will be ``(None, [(tname, fkname), (tname, fkname), ..])``
        which will consist of remaining
        foreign key constraint names that would require a separate CREATE
        step after-the-fact, based on dependencies between tables.

        :param schema: schema name to query, if not the default schema.
        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        .. seealso::

            :meth:`_reflection.Inspector.get_table_names`

            :func:`.sort_tables_and_constraints` - similar method which works
            with an already-given :class:`_schema.MetaData`.

        """

        return [
            (
                table_key[1] if table_key else None,
                [(tname, fks) for (_, tname), fks in fk_collection],
            )
            for (
                table_key,
                fk_collection,
            ) in self.sort_tables_on_foreign_key_dependency(
                consider_schemas=(schema,)
            )
        ]

    def sort_tables_on_foreign_key_dependency(
        self,
        consider_schemas: Collection[Optional[str]] = (None,),
        **kw: Any,
    ) -> List[
        Tuple[
            Optional[Tuple[Optional[str], str]],
            List[Tuple[Tuple[Optional[str], str], Optional[str]]],
        ]
    ]:
        r"""Return dependency-sorted table and foreign key constraint names
        referred to within multiple schemas.

        This method may be compared to
        :meth:`.Inspector.get_sorted_table_and_fkc_names`, which
        works on one schema at a time; here, the method is a generalization
        that will consider multiple schemas at once including that it will
        resolve for cross-schema foreign keys.

        .. versionadded:: 2.0

        """
        SchemaTab = Tuple[Optional[str], str]

        tuples: Set[Tuple[SchemaTab, SchemaTab]] = set()
        remaining_fkcs: Set[Tuple[SchemaTab, Optional[str]]] = set()
        fknames_for_table: Dict[SchemaTab, Set[Optional[str]]] = {}
        tnames: List[SchemaTab] = []

        for schname in consider_schemas:
            schema_fkeys = self.get_multi_foreign_keys(schname, **kw)
            tnames.extend(schema_fkeys)
            for (_, tname), fkeys in schema_fkeys.items():
                fknames_for_table[(schname, tname)] = {
                    fk["name"] for fk in fkeys
                }
                for fkey in fkeys:
                    if (
                        tname != fkey["referred_table"]
                        or schname != fkey["referred_schema"]
                    ):
                        tuples.add(
                            (
                                (
                                    fkey["referred_schema"],
                                    fkey["referred_table"],
                                ),
                                (schname, tname),
                            )
                        )
        try:
            candidate_sort = list(topological.sort(tuples, tnames))
        except exc.CircularDependencyError as err:
            edge: Tuple[SchemaTab, SchemaTab]
            for edge in err.edges:
                tuples.remove(edge)
                remaining_fkcs.update(
                    (edge[1], fkc) for fkc in fknames_for_table[edge[1]]
                )

            candidate_sort = list(topological.sort(tuples, tnames))
        ret: List[
            Tuple[Optional[SchemaTab], List[Tuple[SchemaTab, Optional[str]]]]
        ]
        ret = [
            (
                (schname, tname),
                [
                    ((schname, tname), fk)
                    for fk in fknames_for_table[(schname, tname)].difference(
                        name for _, name in remaining_fkcs
                    )
                ],
            )
            for (schname, tname) in candidate_sort
        ]
        return ret + [(None, list(remaining_fkcs))]

    def get_temp_table_names(self, **kw: Any) -> List[str]:
        r"""Return a list of temporary table names for the current bind.

        This method is unsupported by most dialects; currently
        only Oracle, PostgreSQL and SQLite implements it.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        """

        with self._operation_context() as conn:
            return self.dialect.get_temp_table_names(
                conn, info_cache=self.info_cache, **kw
            )

    def get_temp_view_names(self, **kw: Any) -> List[str]:
        r"""Return a list of temporary view names for the current bind.

        This method is unsupported by most dialects; currently
        only PostgreSQL and SQLite implements it.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        """
        with self._operation_context() as conn:
            return self.dialect.get_temp_view_names(
                conn, info_cache=self.info_cache, **kw
            )

    def get_table_options(
        self, table_name: str, schema: Optional[str] = None, **kw: Any
    ) -> Dict[str, Any]:
        r"""Return a dictionary of options specified when the table of the
        given name was created.

        This currently includes some options that apply to MySQL and Oracle
        tables.

        :param table_name: string name of the table.  For special quoting,
         use :class:`.quoted_name`.

        :param schema: string schema name; if omitted, uses the default schema
         of the database connection.  For special quoting,
         use :class:`.quoted_name`.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        :return: a dict with the table options. The returned keys depend on the
         dialect in use. Each one is prefixed with the dialect name.

        .. seealso:: :meth:`Inspector.get_multi_table_options`

        """
        with self._operation_context() as conn:
            return self.dialect.get_table_options(
                conn, table_name, schema, info_cache=self.info_cache, **kw
            )

    def get_multi_table_options(
        self,
        schema: Optional[str] = None,
        filter_names: Optional[Sequence[str]] = None,
        kind: ObjectKind = ObjectKind.TABLE,
        scope: ObjectScope = ObjectScope.DEFAULT,
        **kw: Any,
    ) -> Dict[TableKey, Dict[str, Any]]:
        r"""Return a dictionary of options specified when the tables in the
        given schema were created.

        The tables can be filtered by passing the names to use to
        ``filter_names``.

        This currently includes some options that apply to MySQL and Oracle
        tables.

        :param schema: string schema name; if omitted, uses the default schema
         of the database connection.  For special quoting,
         use :class:`.quoted_name`.

        :param filter_names: optionally return information only for the
         objects listed here.

        :param kind: a :class:`.ObjectKind` that specifies the type of objects
         to reflect. Defaults to ``ObjectKind.TABLE``.

        :param scope: a :class:`.ObjectScope` that specifies if options of
         default, temporary or any tables should be reflected.
         Defaults to ``ObjectScope.DEFAULT``.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        :return: a dictionary where the keys are two-tuple schema,table-name
         and the values are dictionaries with the table options.
         The returned keys in each dict depend on the
         dialect in use. Each one is prefixed with the dialect name.
         The schema is ``None`` if no schema is provided.

        .. versionadded:: 2.0

        .. seealso:: :meth:`Inspector.get_table_options`
        """
        with self._operation_context() as conn:
            res = self.dialect.get_multi_table_options(
                conn,
                schema=schema,
                filter_names=filter_names,
                kind=kind,
                scope=scope,
                info_cache=self.info_cache,
                **kw,
            )
            return dict(res)

    def get_view_names(
        self, schema: Optional[str] = None, **kw: Any
    ) -> List[str]:
        r"""Return all non-materialized view names in `schema`.

        :param schema: Optional, retrieve names from a non-default schema.
         For special quoting, use :class:`.quoted_name`.
        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.


        .. versionchanged:: 2.0  For those dialects that previously included
           the names of materialized views in this list (currently PostgreSQL),
           this method no longer returns the names of materialized views.
           the :meth:`.Inspector.get_materialized_view_names` method should
           be used instead.

        .. seealso::

            :meth:`.Inspector.get_materialized_view_names`

        """

        with self._operation_context() as conn:
            return self.dialect.get_view_names(
                conn, schema, info_cache=self.info_cache, **kw
            )

    def get_materialized_view_names(
        self, schema: Optional[str] = None, **kw: Any
    ) -> List[str]:
        r"""Return all materialized view names in `schema`.

        :param schema: Optional, retrieve names from a non-default schema.
         For special quoting, use :class:`.quoted_name`.
        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        .. versionadded:: 2.0

        .. seealso::

            :meth:`.Inspector.get_view_names`

        """

        with self._operation_context() as conn:
            return self.dialect.get_materialized_view_names(
                conn, schema, info_cache=self.info_cache, **kw
            )

    def get_sequence_names(
        self, schema: Optional[str] = None, **kw: Any
    ) -> List[str]:
        r"""Return all sequence names in `schema`.

        :param schema: Optional, retrieve names from a non-default schema.
         For special quoting, use :class:`.quoted_name`.
        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        """

        with self._operation_context() as conn:
            return self.dialect.get_sequence_names(
                conn, schema, info_cache=self.info_cache, **kw
            )

    def get_view_definition(
        self, view_name: str, schema: Optional[str] = None, **kw: Any
    ) -> str:
        r"""Return definition for the plain or materialized view called
        ``view_name``.

        :param view_name: Name of the view.
        :param schema: Optional, retrieve names from a non-default schema.
         For special quoting, use :class:`.quoted_name`.
        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        """

        with self._operation_context() as conn:
            return self.dialect.get_view_definition(
                conn, view_name, schema, info_cache=self.info_cache, **kw
            )

    def get_columns(
        self, table_name: str, schema: Optional[str] = None, **kw: Any
    ) -> List[ReflectedColumn]:
        r"""Return information about columns in ``table_name``.

        Given a string ``table_name`` and an optional string ``schema``,
        return column information as a list of :class:`.ReflectedColumn`.

        :param table_name: string name of the table.  For special quoting,
         use :class:`.quoted_name`.

        :param schema: string schema name; if omitted, uses the default schema
         of the database connection.  For special quoting,
         use :class:`.quoted_name`.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        :return: list of dictionaries, each representing the definition of
         a database column.

        .. seealso:: :meth:`Inspector.get_multi_columns`.

        """

        with self._operation_context() as conn:
            col_defs = self.dialect.get_columns(
                conn, table_name, schema, info_cache=self.info_cache, **kw
            )
        if col_defs:
            self._instantiate_types([col_defs])
        return col_defs

    def _instantiate_types(
        self, data: Iterable[List[ReflectedColumn]]
    ) -> None:
        # make this easy and only return instances for coltype
        for col_defs in data:
            for col_def in col_defs:
                coltype = col_def["type"]
                if not isinstance(coltype, TypeEngine):
                    col_def["type"] = coltype()

    def get_multi_columns(
        self,
        schema: Optional[str] = None,
        filter_names: Optional[Sequence[str]] = None,
        kind: ObjectKind = ObjectKind.TABLE,
        scope: ObjectScope = ObjectScope.DEFAULT,
        **kw: Any,
    ) -> Dict[TableKey, List[ReflectedColumn]]:
        r"""Return information about columns in all objects in the given
        schema.

        The objects can be filtered by passing the names to use to
        ``filter_names``.

        For each table the value is a list of :class:`.ReflectedColumn`.

        :param schema: string schema name; if omitted, uses the default schema
         of the database connection.  For special quoting,
         use :class:`.quoted_name`.

        :param filter_names: optionally return information only for the
         objects listed here.

        :param kind: a :class:`.ObjectKind` that specifies the type of objects
         to reflect. Defaults to ``ObjectKind.TABLE``.

        :param scope: a :class:`.ObjectScope` that specifies if columns of
         default, temporary or any tables should be reflected.
         Defaults to ``ObjectScope.DEFAULT``.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        :return: a dictionary where the keys are two-tuple schema,table-name
         and the values are list of dictionaries, each representing the
         definition of a database column.
         The schema is ``None`` if no schema is provided.

        .. versionadded:: 2.0

        .. seealso:: :meth:`Inspector.get_columns`
        """

        with self._operation_context() as conn:
            table_col_defs = dict(
                self.dialect.get_multi_columns(
                    conn,
                    schema=schema,
                    filter_names=filter_names,
                    kind=kind,
                    scope=scope,
                    info_cache=self.info_cache,
                    **kw,
                )
            )
        self._instantiate_types(table_col_defs.values())
        return table_col_defs

    def get_pk_constraint(
        self, table_name: str, schema: Optional[str] = None, **kw: Any
    ) -> ReflectedPrimaryKeyConstraint:
        r"""Return information about primary key constraint in ``table_name``.

        Given a string ``table_name``, and an optional string `schema`, return
        primary key information as a :class:`.ReflectedPrimaryKeyConstraint`.

        :param table_name: string name of the table.  For special quoting,
         use :class:`.quoted_name`.

        :param schema: string schema name; if omitted, uses the default schema
         of the database connection.  For special quoting,
         use :class:`.quoted_name`.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        :return: a dictionary representing the definition of
         a primary key constraint.

        .. seealso:: :meth:`Inspector.get_multi_pk_constraint`
        """
        with self._operation_context() as conn:
            return self.dialect.get_pk_constraint(
                conn, table_name, schema, info_cache=self.info_cache, **kw
            )

    def get_multi_pk_constraint(
        self,
        schema: Optional[str] = None,
        filter_names: Optional[Sequence[str]] = None,
        kind: ObjectKind = ObjectKind.TABLE,
        scope: ObjectScope = ObjectScope.DEFAULT,
        **kw: Any,
    ) -> Dict[TableKey, ReflectedPrimaryKeyConstraint]:
        r"""Return information about primary key constraints in
        all tables in the given schema.

        The tables can be filtered by passing the names to use to
        ``filter_names``.

        For each table the value is a :class:`.ReflectedPrimaryKeyConstraint`.

        :param schema: string schema name; if omitted, uses the default schema
         of the database connection.  For special quoting,
         use :class:`.quoted_name`.

        :param filter_names: optionally return information only for the
         objects listed here.

        :param kind: a :class:`.ObjectKind` that specifies the type of objects
         to reflect. Defaults to ``ObjectKind.TABLE``.

        :param scope: a :class:`.ObjectScope` that specifies if primary keys of
         default, temporary or any tables should be reflected.
         Defaults to ``ObjectScope.DEFAULT``.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        :return: a dictionary where the keys are two-tuple schema,table-name
         and the values are dictionaries, each representing the
         definition of a primary key constraint.
         The schema is ``None`` if no schema is provided.

        .. versionadded:: 2.0

        .. seealso:: :meth:`Inspector.get_pk_constraint`
        """
        with self._operation_context() as conn:
            return dict(
                self.dialect.get_multi_pk_constraint(
                    conn,
                    schema=schema,
                    filter_names=filter_names,
                    kind=kind,
                    scope=scope,
                    info_cache=self.info_cache,
                    **kw,
                )
            )

    def get_foreign_keys(
        self, table_name: str, schema: Optional[str] = None, **kw: Any
    ) -> List[ReflectedForeignKeyConstraint]:
        r"""Return information about foreign_keys in ``table_name``.

        Given a string ``table_name``, and an optional string `schema`, return
        foreign key information as a list of
        :class:`.ReflectedForeignKeyConstraint`.

        :param table_name: string name of the table.  For special quoting,
         use :class:`.quoted_name`.

        :param schema: string schema name; if omitted, uses the default schema
         of the database connection.  For special quoting,
         use :class:`.quoted_name`.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        :return: a list of dictionaries, each representing the
         a foreign key definition.

        .. seealso:: :meth:`Inspector.get_multi_foreign_keys`
        """

        with self._operation_context() as conn:
            return self.dialect.get_foreign_keys(
                conn, table_name, schema, info_cache=self.info_cache, **kw
            )

    def get_multi_foreign_keys(
        self,
        schema: Optional[str] = None,
        filter_names: Optional[Sequence[str]] = None,
        kind: ObjectKind = ObjectKind.TABLE,
        scope: ObjectScope = ObjectScope.DEFAULT,
        **kw: Any,
    ) -> Dict[TableKey, List[ReflectedForeignKeyConstraint]]:
        r"""Return information about foreign_keys in all tables
        in the given schema.

        The tables can be filtered by passing the names to use to
        ``filter_names``.

        For each table the value is a list of
        :class:`.ReflectedForeignKeyConstraint`.

        :param schema: string schema name; if omitted, uses the default schema
         of the database connection.  For special quoting,
         use :class:`.quoted_name`.

        :param filter_names: optionally return information only for the
         objects listed here.

        :param kind: a :class:`.ObjectKind` that specifies the type of objects
         to reflect. Defaults to ``ObjectKind.TABLE``.

        :param scope: a :class:`.ObjectScope` that specifies if foreign keys of
         default, temporary or any tables should be reflected.
         Defaults to ``ObjectScope.DEFAULT``.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        :return: a dictionary where the keys are two-tuple schema,table-name
         and the values are list of dictionaries, each representing
         a foreign key definition.
         The schema is ``None`` if no schema is provided.

        .. versionadded:: 2.0

        .. seealso:: :meth:`Inspector.get_foreign_keys`
        """

        with self._operation_context() as conn:
            return dict(
                self.dialect.get_multi_foreign_keys(
                    conn,
                    schema=schema,
                    filter_names=filter_names,
                    kind=kind,
                    scope=scope,
                    info_cache=self.info_cache,
                    **kw,
                )
            )

    def get_indexes(
        self, table_name: str, schema: Optional[str] = None, **kw: Any
    ) -> List[ReflectedIndex]:
        r"""Return information about indexes in ``table_name``.

        Given a string ``table_name`` and an optional string `schema`, return
        index information as a list of :class:`.ReflectedIndex`.

        :param table_name: string name of the table.  For special quoting,
         use :class:`.quoted_name`.

        :param schema: string schema name; if omitted, uses the default schema
         of the database connection.  For special quoting,
         use :class:`.quoted_name`.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        :return: a list of dictionaries, each representing the
         definition of an index.

        .. seealso:: :meth:`Inspector.get_multi_indexes`
        """

        with self._operation_context() as conn:
            return self.dialect.get_indexes(
                conn, table_name, schema, info_cache=self.info_cache, **kw
            )

    def get_multi_indexes(
        self,
        schema: Optional[str] = None,
        filter_names: Optional[Sequence[str]] = None,
        kind: ObjectKind = ObjectKind.TABLE,
        scope: ObjectScope = ObjectScope.DEFAULT,
        **kw: Any,
    ) -> Dict[TableKey, List[ReflectedIndex]]:
        r"""Return information about indexes in in all objects
        in the given schema.

        The objects can be filtered by passing the names to use to
        ``filter_names``.

        For each table the value is a list of :class:`.ReflectedIndex`.

        :param schema: string schema name; if omitted, uses the default schema
         of the database connection.  For special quoting,
         use :class:`.quoted_name`.

        :param filter_names: optionally return information only for the
         objects listed here.

        :param kind: a :class:`.ObjectKind` that specifies the type of objects
         to reflect. Defaults to ``ObjectKind.TABLE``.

        :param scope: a :class:`.ObjectScope` that specifies if indexes of
         default, temporary or any tables should be reflected.
         Defaults to ``ObjectScope.DEFAULT``.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        :return: a dictionary where the keys are two-tuple schema,table-name
         and the values are list of dictionaries, each representing the
         definition of an index.
         The schema is ``None`` if no schema is provided.

        .. versionadded:: 2.0

        .. seealso:: :meth:`Inspector.get_indexes`
        """

        with self._operation_context() as conn:
            return dict(
                self.dialect.get_multi_indexes(
                    conn,
                    schema=schema,
                    filter_names=filter_names,
                    kind=kind,
                    scope=scope,
                    info_cache=self.info_cache,
                    **kw,
                )
            )

    def get_unique_constraints(
        self, table_name: str, schema: Optional[str] = None, **kw: Any
    ) -> List[ReflectedUniqueConstraint]:
        r"""Return information about unique constraints in ``table_name``.

        Given a string ``table_name`` and an optional string `schema`, return
        unique constraint information as a list of
        :class:`.ReflectedUniqueConstraint`.

        :param table_name: string name of the table.  For special quoting,
         use :class:`.quoted_name`.

        :param schema: string schema name; if omitted, uses the default schema
         of the database connection.  For special quoting,
         use :class:`.quoted_name`.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        :return: a list of dictionaries, each representing the
         definition of an unique constraint.

        .. seealso:: :meth:`Inspector.get_multi_unique_constraints`
        """

        with self._operation_context() as conn:
            return self.dialect.get_unique_constraints(
                conn, table_name, schema, info_cache=self.info_cache, **kw
            )

    def get_multi_unique_constraints(
        self,
        schema: Optional[str] = None,
        filter_names: Optional[Sequence[str]] = None,
        kind: ObjectKind = ObjectKind.TABLE,
        scope: ObjectScope = ObjectScope.DEFAULT,
        **kw: Any,
    ) -> Dict[TableKey, List[ReflectedUniqueConstraint]]:
        r"""Return information about unique constraints in all tables
        in the given schema.

        The tables can be filtered by passing the names to use to
        ``filter_names``.

        For each table the value is a list of
        :class:`.ReflectedUniqueConstraint`.

        :param schema: string schema name; if omitted, uses the default schema
         of the database connection.  For special quoting,
         use :class:`.quoted_name`.

        :param filter_names: optionally return information only for the
         objects listed here.

        :param kind: a :class:`.ObjectKind` that specifies the type of objects
         to reflect. Defaults to ``ObjectKind.TABLE``.

        :param scope: a :class:`.ObjectScope` that specifies if constraints of
         default, temporary or any tables should be reflected.
         Defaults to ``ObjectScope.DEFAULT``.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        :return: a dictionary where the keys are two-tuple schema,table-name
         and the values are list of dictionaries, each representing the
         definition of an unique constraint.
         The schema is ``None`` if no schema is provided.

        .. versionadded:: 2.0

        .. seealso:: :meth:`Inspector.get_unique_constraints`
        """

        with self._operation_context() as conn:
            return dict(
                self.dialect.get_multi_unique_constraints(
                    conn,
                    schema=schema,
                    filter_names=filter_names,
                    kind=kind,
                    scope=scope,
                    info_cache=self.info_cache,
                    **kw,
                )
            )

    def get_table_comment(
        self, table_name: str, schema: Optional[str] = None, **kw: Any
    ) -> ReflectedTableComment:
        r"""Return information about the table comment for ``table_name``.

        Given a string ``table_name`` and an optional string ``schema``,
        return table comment information as a :class:`.ReflectedTableComment`.

        Raises ``NotImplementedError`` for a dialect that does not support
        comments.

        :param table_name: string name of the table.  For special quoting,
         use :class:`.quoted_name`.

        :param schema: string schema name; if omitted, uses the default schema
         of the database connection.  For special quoting,
         use :class:`.quoted_name`.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        :return: a dictionary, with the table comment.

        .. versionadded:: 1.2

        .. seealso:: :meth:`Inspector.get_multi_table_comment`
        """

        with self._operation_context() as conn:
            return self.dialect.get_table_comment(
                conn, table_name, schema, info_cache=self.info_cache, **kw
            )

    def get_multi_table_comment(
        self,
        schema: Optional[str] = None,
        filter_names: Optional[Sequence[str]] = None,
        kind: ObjectKind = ObjectKind.TABLE,
        scope: ObjectScope = ObjectScope.DEFAULT,
        **kw: Any,
    ) -> Dict[TableKey, ReflectedTableComment]:
        r"""Return information about the table comment in all objects
        in the given schema.

        The objects can be filtered by passing the names to use to
        ``filter_names``.

        For each table the value is a :class:`.ReflectedTableComment`.

        Raises ``NotImplementedError`` for a dialect that does not support
        comments.

        :param schema: string schema name; if omitted, uses the default schema
         of the database connection.  For special quoting,
         use :class:`.quoted_name`.

        :param filter_names: optionally return information only for the
         objects listed here.

        :param kind: a :class:`.ObjectKind` that specifies the type of objects
         to reflect. Defaults to ``ObjectKind.TABLE``.

        :param scope: a :class:`.ObjectScope` that specifies if comments of
         default, temporary or any tables should be reflected.
         Defaults to ``ObjectScope.DEFAULT``.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        :return: a dictionary where the keys are two-tuple schema,table-name
         and the values are dictionaries, representing the
         table comments.
         The schema is ``None`` if no schema is provided.

        .. versionadded:: 2.0

        .. seealso:: :meth:`Inspector.get_table_comment`
        """

        with self._operation_context() as conn:
            return dict(
                self.dialect.get_multi_table_comment(
                    conn,
                    schema=schema,
                    filter_names=filter_names,
                    kind=kind,
                    scope=scope,
                    info_cache=self.info_cache,
                    **kw,
                )
            )

    def get_check_constraints(
        self, table_name: str, schema: Optional[str] = None, **kw: Any
    ) -> List[ReflectedCheckConstraint]:
        r"""Return information about check constraints in ``table_name``.

        Given a string ``table_name`` and an optional string `schema`, return
        check constraint information as a list of
        :class:`.ReflectedCheckConstraint`.

        :param table_name: string name of the table.  For special quoting,
         use :class:`.quoted_name`.

        :param schema: string schema name; if omitted, uses the default schema
         of the database connection.  For special quoting,
         use :class:`.quoted_name`.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        :return: a list of dictionaries, each representing the
         definition of a check constraints.

        .. seealso:: :meth:`Inspector.get_multi_check_constraints`
        """

        with self._operation_context() as conn:
            return self.dialect.get_check_constraints(
                conn, table_name, schema, info_cache=self.info_cache, **kw
            )

    def get_multi_check_constraints(
        self,
        schema: Optional[str] = None,
        filter_names: Optional[Sequence[str]] = None,
        kind: ObjectKind = ObjectKind.TABLE,
        scope: ObjectScope = ObjectScope.DEFAULT,
        **kw: Any,
    ) -> Dict[TableKey, List[ReflectedCheckConstraint]]:
        r"""Return information about check constraints in all tables
        in the given schema.

        The tables can be filtered by passing the names to use to
        ``filter_names``.

        For each table the value is a list of
        :class:`.ReflectedCheckConstraint`.

        :param schema: string schema name; if omitted, uses the default schema
         of the database connection.  For special quoting,
         use :class:`.quoted_name`.

        :param filter_names: optionally return information only for the
         objects listed here.

        :param kind: a :class:`.ObjectKind` that specifies the type of objects
         to reflect. Defaults to ``ObjectKind.TABLE``.

        :param scope: a :class:`.ObjectScope` that specifies if constraints of
         default, temporary or any tables should be reflected.
         Defaults to ``ObjectScope.DEFAULT``.

        :param \**kw: Additional keyword argument to pass to the dialect
         specific implementation. See the documentation of the dialect
         in use for more information.

        :return: a dictionary where the keys are two-tuple schema,table-name
         and the values are list of dictionaries, each representing the
         definition of a check constraints.
         The schema is ``None`` if no schema is provided.

        .. versionadded:: 2.0

        .. seealso:: :meth:`Inspector.get_check_constraints`
        """

        with self._operation_context() as conn:
            return dict(
                self.dialect.get_multi_check_constraints(
                    conn,
                    schema=schema,
                    filter_names=filter_names,
                    kind=kind,
                    scope=scope,
                    info_cache=self.info_cache,
                    **kw,
                )
            )

    def reflect_table(
        self,
        table: sa_schema.Table,
        include_columns: Optional[Collection[str]],
        exclude_columns: Collection[str] = (),
        resolve_fks: bool = True,
        _extend_on: Optional[Set[sa_schema.Table]] = None,
        _reflect_info: Optional[_ReflectionInfo] = None,
    ) -> None:
        """Given a :class:`_schema.Table` object, load its internal
        constructs based on introspection.

        This is the underlying method used by most dialects to produce
        table reflection.  Direct usage is like::

            from sqlalchemy import create_engine, MetaData, Table
            from sqlalchemy import inspect

            engine = create_engine('...')
            meta = MetaData()
            user_table = Table('user', meta)
            insp = inspect(engine)
            insp.reflect_table(user_table, None)

        .. versionchanged:: 1.4 Renamed from ``reflecttable`` to
           ``reflect_table``

        :param table: a :class:`~sqlalchemy.schema.Table` instance.
        :param include_columns: a list of string column names to include
          in the reflection process.  If ``None``, all columns are reflected.

        """

        if _extend_on is not None:
            if table in _extend_on:
                return
            else:
                _extend_on.add(table)

        dialect = self.bind.dialect

        with self._operation_context() as conn:
            schema = conn.schema_for_object(table)

        table_name = table.name

        # get table-level arguments that are specifically
        # intended for reflection, e.g. oracle_resolve_synonyms.
        # these are unconditionally passed to related Table
        # objects
        reflection_options = {
            k: table.dialect_kwargs.get(k)
            for k in dialect.reflection_options
            if k in table.dialect_kwargs
        }

        table_key = (schema, table_name)
        if _reflect_info is None or table_key not in _reflect_info.columns:
            _reflect_info = self._get_reflection_info(
                schema,
                filter_names=[table_name],
                kind=ObjectKind.ANY,
                scope=ObjectScope.ANY,
                _reflect_info=_reflect_info,
                **table.dialect_kwargs,
            )
        if table_key in _reflect_info.unreflectable:
            raise _reflect_info.unreflectable[table_key]

        if table_key not in _reflect_info.columns:
            raise exc.NoSuchTableError(table_name)

        # reflect table options, like mysql_engine
        if _reflect_info.table_options:
            tbl_opts = _reflect_info.table_options.get(table_key)
            if tbl_opts:
                # add additional kwargs to the Table if the dialect
                # returned them
                table._validate_dialect_kwargs(tbl_opts)

        found_table = False
        cols_by_orig_name: Dict[str, sa_schema.Column[Any]] = {}

        for col_d in _reflect_info.columns[table_key]:
            found_table = True

            self._reflect_column(
                table,
                col_d,
                include_columns,
                exclude_columns,
                cols_by_orig_name,
            )

        # NOTE: support tables/views with no columns
        if not found_table and not self.has_table(table_name, schema):
            raise exc.NoSuchTableError(table_name)

        self._reflect_pk(
            _reflect_info, table_key, table, cols_by_orig_name, exclude_columns
        )

        self._reflect_fk(
            _reflect_info,
            table_key,
            table,
            cols_by_orig_name,
            include_columns,
            exclude_columns,
            resolve_fks,
            _extend_on,
            reflection_options,
        )

        self._reflect_indexes(
            _reflect_info,
            table_key,
            table,
            cols_by_orig_name,
            include_columns,
            exclude_columns,
            reflection_options,
        )

        self._reflect_unique_constraints(
            _reflect_info,
            table_key,
            table,
            cols_by_orig_name,
            include_columns,
            exclude_columns,
            reflection_options,
        )

        self._reflect_check_constraints(
            _reflect_info,
            table_key,
            table,
            cols_by_orig_name,
            include_columns,
            exclude_columns,
            reflection_options,
        )

        self._reflect_table_comment(
            _reflect_info,
            table_key,
            table,
            reflection_options,
        )

    def _reflect_column(
        self,
        table: sa_schema.Table,
        col_d: ReflectedColumn,
        include_columns: Optional[Collection[str]],
        exclude_columns: Collection[str],
        cols_by_orig_name: Dict[str, sa_schema.Column[Any]],
    ) -> None:
        orig_name = col_d["name"]

        table.metadata.dispatch.column_reflect(self, table, col_d)
        table.dispatch.column_reflect(self, table, col_d)

        # fetch name again as column_reflect is allowed to
        # change it
        name = col_d["name"]
        if (include_columns and name not in include_columns) or (
            exclude_columns and name in exclude_columns
        ):
            return

        coltype = col_d["type"]

        col_kw = {
            k: col_d[k]  # type: ignore[literal-required]
            for k in [
                "nullable",
                "autoincrement",
                "quote",
                "info",
                "key",
                "comment",
            ]
            if k in col_d
        }

        if "dialect_options" in col_d:
            col_kw.update(col_d["dialect_options"])

        colargs = []
        default: Any
        if col_d.get("default") is not None:
            default_text = col_d["default"]
            assert default_text is not None
            if isinstance(default_text, TextClause):
                default = sa_schema.DefaultClause(
                    default_text, _reflected=True
                )
            elif not isinstance(default_text, sa_schema.FetchedValue):
                default = sa_schema.DefaultClause(
                    sql.text(default_text), _reflected=True
                )
            else:
                default = default_text
            colargs.append(default)

        if "computed" in col_d:
            computed = sa_schema.Computed(**col_d["computed"])
            colargs.append(computed)

        if "identity" in col_d:
            identity = sa_schema.Identity(**col_d["identity"])
            colargs.append(identity)

        cols_by_orig_name[orig_name] = col = sa_schema.Column(
            name, coltype, *colargs, **col_kw
        )

        if col.key in table.primary_key:
            col.primary_key = True
        table.append_column(col, replace_existing=True)

    def _reflect_pk(
        self,
        _reflect_info: _ReflectionInfo,
        table_key: TableKey,
        table: sa_schema.Table,
        cols_by_orig_name: Dict[str, sa_schema.Column[Any]],
        exclude_columns: Collection[str],
    ) -> None:
        pk_cons = _reflect_info.pk_constraint.get(table_key)
        if pk_cons:
            pk_cols = [
                cols_by_orig_name[pk]
                for pk in pk_cons["constrained_columns"]
                if pk in cols_by_orig_name and pk not in exclude_columns
            ]

            # update pk constraint name and comment
            table.primary_key.name = pk_cons.get("name")
            table.primary_key.comment = pk_cons.get("comment", None)

            # tell the PKConstraint to re-initialize
            # its column collection
            table.primary_key._reload(pk_cols)

    def _reflect_fk(
        self,
        _reflect_info: _ReflectionInfo,
        table_key: TableKey,
        table: sa_schema.Table,
        cols_by_orig_name: Dict[str, sa_schema.Column[Any]],
        include_columns: Optional[Collection[str]],
        exclude_columns: Collection[str],
        resolve_fks: bool,
        _extend_on: Optional[Set[sa_schema.Table]],
        reflection_options: Dict[str, Any],
    ) -> None:
        fkeys = _reflect_info.foreign_keys.get(table_key, [])
        for fkey_d in fkeys:
            conname = fkey_d["name"]
            # look for columns by orig name in cols_by_orig_name,
            # but support columns that are in-Python only as fallback
            constrained_columns = [
                cols_by_orig_name[c].key if c in cols_by_orig_name else c
                for c in fkey_d["constrained_columns"]
            ]

            if (
                exclude_columns
                and set(constrained_columns).intersection(exclude_columns)
                or (
                    include_columns
                    and set(constrained_columns).difference(include_columns)
                )
            ):
                continue

            referred_schema = fkey_d["referred_schema"]
            referred_table = fkey_d["referred_table"]
            referred_columns = fkey_d["referred_columns"]
            refspec = []
            if referred_schema is not None:
                if resolve_fks:
                    sa_schema.Table(
                        referred_table,
                        table.metadata,
                        schema=referred_schema,
                        autoload_with=self.bind,
                        _extend_on=_extend_on,
                        _reflect_info=_reflect_info,
                        **reflection_options,
                    )
                for column in referred_columns:
                    refspec.append(
                        ".".join([referred_schema, referred_table, column])
                    )
            else:
                if resolve_fks:
                    sa_schema.Table(
                        referred_table,
                        table.metadata,
                        autoload_with=self.bind,
                        schema=sa_schema.BLANK_SCHEMA,
                        _extend_on=_extend_on,
                        _reflect_info=_reflect_info,
                        **reflection_options,
                    )
                for column in referred_columns:
                    refspec.append(".".join([referred_table, column]))
            if "options" in fkey_d:
                options = fkey_d["options"]
            else:
                options = {}

            try:
                table.append_constraint(
                    sa_schema.ForeignKeyConstraint(
                        constrained_columns,
                        refspec,
                        conname,
                        link_to_name=True,
                        comment=fkey_d.get("comment"),
                        **options,
                    )
                )
            except exc.ConstraintColumnNotFoundError:
                util.warn(
                    f"On reflected table {table.name}, skipping reflection of "
                    "foreign key constraint "
                    f"{conname}; one or more subject columns within "
                    f"name(s) {', '.join(constrained_columns)} are not "
                    "present in the table"
                )

    _index_sort_exprs = {
        "asc": operators.asc_op,
        "desc": operators.desc_op,
        "nulls_first": operators.nulls_first_op,
        "nulls_last": operators.nulls_last_op,
    }

    def _reflect_indexes(
        self,
        _reflect_info: _ReflectionInfo,
        table_key: TableKey,
        table: sa_schema.Table,
        cols_by_orig_name: Dict[str, sa_schema.Column[Any]],
        include_columns: Optional[Collection[str]],
        exclude_columns: Collection[str],
        reflection_options: Dict[str, Any],
    ) -> None:
        # Indexes
        indexes = _reflect_info.indexes.get(table_key, [])
        for index_d in indexes:
            name = index_d["name"]
            columns = index_d["column_names"]
            expressions = index_d.get("expressions")
            column_sorting = index_d.get("column_sorting", {})
            unique = index_d["unique"]
            flavor = index_d.get("type", "index")
            dialect_options = index_d.get("dialect_options", {})

            duplicates = index_d.get("duplicates_constraint")
            if include_columns and not set(columns).issubset(include_columns):
                continue
            if duplicates:
                continue
            # look for columns by orig name in cols_by_orig_name,
            # but support columns that are in-Python only as fallback
            idx_element: Any
            idx_elements = []
            for index, c in enumerate(columns):
                if c is None:
                    if not expressions:
                        util.warn(
                            f"Skipping {flavor} {name!r} because key "
                            f"{index + 1} reflected as None but no "
                            "'expressions' were returned"
                        )
                        break
                    idx_element = sql.text(expressions[index])
                else:
                    try:
                        if c in cols_by_orig_name:
                            idx_element = cols_by_orig_name[c]
                        else:
                            idx_element = table.c[c]
                    except KeyError:
                        util.warn(
                            f"{flavor} key {c!r} was not located in "
                            f"columns for table {table.name!r}"
                        )
                        continue
                    for option in column_sorting.get(c, ()):
                        if option in self._index_sort_exprs:
                            op = self._index_sort_exprs[option]
                            idx_element = op(idx_element)
                idx_elements.append(idx_element)
            else:
                sa_schema.Index(
                    name,
                    *idx_elements,
                    _table=table,
                    unique=unique,
                    **dialect_options,
                )

    def _reflect_unique_constraints(
        self,
        _reflect_info: _ReflectionInfo,
        table_key: TableKey,
        table: sa_schema.Table,
        cols_by_orig_name: Dict[str, sa_schema.Column[Any]],
        include_columns: Optional[Collection[str]],
        exclude_columns: Collection[str],
        reflection_options: Dict[str, Any],
    ) -> None:
        constraints = _reflect_info.unique_constraints.get(table_key, [])
        # Unique Constraints
        for const_d in constraints:
            conname = const_d["name"]
            columns = const_d["column_names"]
            comment = const_d.get("comment")
            duplicates = const_d.get("duplicates_index")
            dialect_options = const_d.get("dialect_options", {})
            if include_columns and not set(columns).issubset(include_columns):
                continue
            if duplicates:
                continue
            # look for columns by orig name in cols_by_orig_name,
            # but support columns that are in-Python only as fallback
            constrained_cols = []
            for c in columns:
                try:
                    constrained_col = (
                        cols_by_orig_name[c]
                        if c in cols_by_orig_name
                        else table.c[c]
                    )
                except KeyError:
                    util.warn(
                        "unique constraint key '%s' was not located in "
                        "columns for table '%s'" % (c, table.name)
                    )
                else:
                    constrained_cols.append(constrained_col)
            table.append_constraint(
                sa_schema.UniqueConstraint(
                    *constrained_cols,
                    name=conname,
                    comment=comment,
                    **dialect_options,
                )
            )

    def _reflect_check_constraints(
        self,
        _reflect_info: _ReflectionInfo,
        table_key: TableKey,
        table: sa_schema.Table,
        cols_by_orig_name: Dict[str, sa_schema.Column[Any]],
        include_columns: Optional[Collection[str]],
        exclude_columns: Collection[str],
        reflection_options: Dict[str, Any],
    ) -> None:
        constraints = _reflect_info.check_constraints.get(table_key, [])
        for const_d in constraints:
            table.append_constraint(sa_schema.CheckConstraint(**const_d))

    def _reflect_table_comment(
        self,
        _reflect_info: _ReflectionInfo,
        table_key: TableKey,
        table: sa_schema.Table,
        reflection_options: Dict[str, Any],
    ) -> None:
        comment_dict = _reflect_info.table_comment.get(table_key)
        if comment_dict:
            table.comment = comment_dict["text"]

    def _get_reflection_info(
        self,
        schema: Optional[str] = None,
        filter_names: Optional[Collection[str]] = None,
        available: Optional[Collection[str]] = None,
        _reflect_info: Optional[_ReflectionInfo] = None,
        **kw: Any,
    ) -> _ReflectionInfo:
        kw["schema"] = schema

        if filter_names and available and len(filter_names) > 100:
            fraction = len(filter_names) / len(available)
        else:
            fraction = None

        unreflectable: Dict[TableKey, exc.UnreflectableTableError]
        kw["unreflectable"] = unreflectable = {}

        has_result: bool = True

        def run(
            meth: Any,
            *,
            optional: bool = False,
            check_filter_names_from_meth: bool = False,
        ) -> Any:
            nonlocal has_result
            # simple heuristic to improve reflection performance if a
            # dialect implements multi_reflection:
            # if more than 50% of the tables in the db are in filter_names
            # load all the tables, since it's most likely faster to avoid
            # a filter on that many tables.
            if (
                fraction is None
                or fraction <= 0.5
                or not self.dialect._overrides_default(meth.__name__)
            ):
                _fn = filter_names
            else:
                _fn = None
            try:
                if has_result:
                    res = meth(filter_names=_fn, **kw)
                    if check_filter_names_from_meth and not res:
                        # method returned no result data.
                        # skip any future call methods
                        has_result = False
                else:
                    res = {}
            except NotImplementedError:
                if not optional:
                    raise
                res = {}
            return res

        info = _ReflectionInfo(
            columns=run(
                self.get_multi_columns, check_filter_names_from_meth=True
            ),
            pk_constraint=run(self.get_multi_pk_constraint),
            foreign_keys=run(self.get_multi_foreign_keys),
            indexes=run(self.get_multi_indexes),
            unique_constraints=run(
                self.get_multi_unique_constraints, optional=True
            ),
            table_comment=run(self.get_multi_table_comment, optional=True),
            check_constraints=run(
                self.get_multi_check_constraints, optional=True
            ),
            table_options=run(self.get_multi_table_options, optional=True),
            unreflectable=unreflectable,
        )
        if _reflect_info:
            _reflect_info.update(info)
            return _reflect_info
        else:
            return info


@final
class ReflectionDefaults:
    """provides blank default values for reflection methods."""

    @classmethod
    def columns(cls) -> List[ReflectedColumn]:
        return []

    @classmethod
    def pk_constraint(cls) -> ReflectedPrimaryKeyConstraint:
        return {
            "name": None,
            "constrained_columns": [],
        }

    @classmethod
    def foreign_keys(cls) -> List[ReflectedForeignKeyConstraint]:
        return []

    @classmethod
    def indexes(cls) -> List[ReflectedIndex]:
        return []

    @classmethod
    def unique_constraints(cls) -> List[ReflectedUniqueConstraint]:
        return []

    @classmethod
    def check_constraints(cls) -> List[ReflectedCheckConstraint]:
        return []

    @classmethod
    def table_options(cls) -> Dict[str, Any]:
        return {}

    @classmethod
    def table_comment(cls) -> ReflectedTableComment:
        return {"text": None}


@dataclass
class _ReflectionInfo:
    columns: Dict[TableKey, List[ReflectedColumn]]
    pk_constraint: Dict[TableKey, Optional[ReflectedPrimaryKeyConstraint]]
    foreign_keys: Dict[TableKey, List[ReflectedForeignKeyConstraint]]
    indexes: Dict[TableKey, List[ReflectedIndex]]
    # optionals
    unique_constraints: Dict[TableKey, List[ReflectedUniqueConstraint]]
    table_comment: Dict[TableKey, Optional[ReflectedTableComment]]
    check_constraints: Dict[TableKey, List[ReflectedCheckConstraint]]
    table_options: Dict[TableKey, Dict[str, Any]]
    unreflectable: Dict[TableKey, exc.UnreflectableTableError]

    def update(self, other: _ReflectionInfo) -> None:
        for k, v in self.__dict__.items():
            ov = getattr(other, k)
            if ov is not None:
                if v is None:
                    setattr(self, k, ov)
                else:
                    v.update(ov)
