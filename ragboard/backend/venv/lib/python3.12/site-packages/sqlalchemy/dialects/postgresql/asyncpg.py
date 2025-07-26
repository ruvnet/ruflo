# dialects/postgresql/asyncpg.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors <see AUTHORS
# file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

r"""
.. dialect:: postgresql+asyncpg
    :name: asyncpg
    :dbapi: asyncpg
    :connectstring: postgresql+asyncpg://user:password@host:port/dbname[?key=value&key=value...]
    :url: https://magicstack.github.io/asyncpg/

The asyncpg dialect is SQLAlchemy's first Python asyncio dialect.

Using a special asyncio mediation layer, the asyncpg dialect is usable
as the backend for the :ref:`SQLAlchemy asyncio <asyncio_toplevel>`
extension package.

This dialect should normally be used only with the
:func:`_asyncio.create_async_engine` engine creation function::

    from sqlalchemy.ext.asyncio import create_async_engine
    engine = create_async_engine("postgresql+asyncpg://user:pass@hostname/dbname")

.. versionadded:: 1.4

.. note::

    By default asyncpg does not decode the ``json`` and ``jsonb`` types and
    returns them as strings. SQLAlchemy sets default type decoder for ``json``
    and ``jsonb`` types using the python builtin ``json.loads`` function.
    The json implementation used can be changed by setting the attribute
    ``json_deserializer`` when creating the engine with
    :func:`create_engine` or :func:`create_async_engine`.

.. _asyncpg_multihost:

Multihost Connections
--------------------------

The asyncpg dialect features support for multiple fallback hosts in the
same way as that of the psycopg2 and psycopg dialects.  The
syntax is the same,
using ``host=<host>:<port>`` combinations as additional query string arguments;
however, there is no default port, so all hosts must have a complete port number
present, otherwise an exception is raised::

    engine = create_async_engine(
        "postgresql+asyncpg://user:password@/dbname?host=HostA:5432&host=HostB:5432&host=HostC:5432"
    )

For complete background on this syntax, see :ref:`psycopg2_multi_host`.

.. versionadded:: 2.0.18

.. seealso::

    :ref:`psycopg2_multi_host`

.. _asyncpg_prepared_statement_cache:

Prepared Statement Cache
--------------------------

The asyncpg SQLAlchemy dialect makes use of ``asyncpg.connection.prepare()``
for all statements.   The prepared statement objects are cached after
construction which appears to grant a 10% or more performance improvement for
statement invocation.   The cache is on a per-DBAPI connection basis, which
means that the primary storage for prepared statements is within DBAPI
connections pooled within the connection pool.   The size of this cache
defaults to 100 statements per DBAPI connection and may be adjusted using the
``prepared_statement_cache_size`` DBAPI argument (note that while this argument
is implemented by SQLAlchemy, it is part of the DBAPI emulation portion of the
asyncpg dialect, therefore is handled as a DBAPI argument, not a dialect
argument)::


    engine = create_async_engine("postgresql+asyncpg://user:pass@hostname/dbname?prepared_statement_cache_size=500")

To disable the prepared statement cache, use a value of zero::

    engine = create_async_engine("postgresql+asyncpg://user:pass@hostname/dbname?prepared_statement_cache_size=0")

.. versionadded:: 1.4.0b2 Added ``prepared_statement_cache_size`` for asyncpg.


.. warning::  The ``asyncpg`` database driver necessarily uses caches for
   PostgreSQL type OIDs, which become stale when custom PostgreSQL datatypes
   such as ``ENUM`` objects are changed via DDL operations.   Additionally,
   prepared statements themselves which are optionally cached by SQLAlchemy's
   driver as described above may also become "stale" when DDL has been emitted
   to the PostgreSQL database which modifies the tables or other objects
   involved in a particular prepared statement.

   The SQLAlchemy asyncpg dialect will invalidate these caches within its local
   process when statements that represent DDL are emitted on a local
   connection, but this is only controllable within a single Python process /
   database engine.     If DDL changes are made from other database engines
   and/or processes, a running application may encounter asyncpg exceptions
   ``InvalidCachedStatementError`` and/or ``InternalServerError("cache lookup
   failed for type <oid>")`` if it refers to pooled database connections which
   operated upon the previous structures. The SQLAlchemy asyncpg dialect will
   recover from these error cases when the driver raises these exceptions by
   clearing its internal caches as well as those of the asyncpg driver in
   response to them, but cannot prevent them from being raised in the first
   place if the cached prepared statement or asyncpg type caches have gone
   stale, nor can it retry the statement as the PostgreSQL transaction is
   invalidated when these errors occur.

.. _asyncpg_prepared_statement_name:

Prepared Statement Name
-----------------------

By default, asyncpg enumerates prepared statements in numeric order, which
can lead to errors if a name has already been taken for another prepared
statement. This issue can arise if your application uses database proxies
such as PgBouncer to handle connections. One possible workaround is to
use dynamic prepared statement names, which asyncpg now supports through
an optional ``name`` value for the statement name. This allows you to
generate your own unique names that won't conflict with existing ones.
To achieve this, you can provide a function that will be called every time
a prepared statement is prepared::

    from uuid import uuid4

    engine = create_async_engine(
        "postgresql+asyncpg://user:pass@hostname/dbname",
        poolclass=NullPool,
        connect_args={
            'prepared_statement_name_func': lambda:  f'__asyncpg_{uuid4()}__',
        },
    )

.. seealso::

   https://github.com/MagicStack/asyncpg/issues/837

   https://github.com/sqlalchemy/sqlalchemy/issues/6467

.. warning:: To prevent a buildup of useless prepared statements in
   your application, it's important to use the :class:`.NullPool` pool
   class, and to configure PgBouncer to use `DISCARD <https://www.postgresql.org/docs/current/sql-discard.html>`_
   when returning connections.  The DISCARD command is used to release resources held by the db connection,
   including prepared statements. Without proper setup, prepared statements can
   accumulate quickly and cause performance issues.

Disabling the PostgreSQL JIT to improve ENUM datatype handling
---------------------------------------------------------------

Asyncpg has an `issue <https://github.com/MagicStack/asyncpg/issues/727>`_ when
using PostgreSQL ENUM datatypes, where upon the creation of new database
connections, an expensive query may be emitted in order to retrieve metadata
regarding custom types which has been shown to negatively affect performance.
To mitigate this issue, the PostgreSQL "jit" setting may be disabled from the
client using this setting passed to :func:`_asyncio.create_async_engine`::

    engine = create_async_engine(
        "postgresql+asyncpg://user:password@localhost/tmp",
        connect_args={"server_settings": {"jit": "off"}},
    )

.. seealso::

    https://github.com/MagicStack/asyncpg/issues/727

"""  # noqa

from __future__ import annotations

import collections
import decimal
import json as _py_json
import re
import time
from typing import cast
from typing import TYPE_CHECKING

from . import json
from . import ranges
from .array import ARRAY as PGARRAY
from .base import _DECIMAL_TYPES
from .base import _FLOAT_TYPES
from .base import _INT_TYPES
from .base import ENUM
from .base import INTERVAL
from .base import OID
from .base import PGCompiler
from .base import PGDialect
from .base import PGExecutionContext
from .base import PGIdentifierPreparer
from .base import REGCLASS
from .base import REGCONFIG
from .types import BIT
from .types import BYTEA
from .types import CITEXT
from ... import exc
from ... import pool
from ... import util
from ...engine import AdaptedConnection
from ...engine import processors
from ...sql import sqltypes
from ...util.concurrency import asyncio
from ...util.concurrency import await_fallback
from ...util.concurrency import await_only

if TYPE_CHECKING:
    from typing import Iterable


class AsyncpgARRAY(PGARRAY):
    render_bind_cast = True


class AsyncpgString(sqltypes.String):
    render_bind_cast = True


class AsyncpgREGCONFIG(REGCONFIG):
    render_bind_cast = True


class AsyncpgTime(sqltypes.Time):
    render_bind_cast = True


class AsyncpgBit(BIT):
    render_bind_cast = True


class AsyncpgByteA(BYTEA):
    render_bind_cast = True


class AsyncpgDate(sqltypes.Date):
    render_bind_cast = True


class AsyncpgDateTime(sqltypes.DateTime):
    render_bind_cast = True


class AsyncpgBoolean(sqltypes.Boolean):
    render_bind_cast = True


class AsyncPgInterval(INTERVAL):
    render_bind_cast = True

    @classmethod
    def adapt_emulated_to_native(cls, interval, **kw):
        return AsyncPgInterval(precision=interval.second_precision)


class AsyncPgEnum(ENUM):
    render_bind_cast = True


class AsyncpgInteger(sqltypes.Integer):
    render_bind_cast = True


class AsyncpgBigInteger(sqltypes.BigInteger):
    render_bind_cast = True


class AsyncpgJSON(json.JSON):
    render_bind_cast = True

    def result_processor(self, dialect, coltype):
        return None


class AsyncpgJSONB(json.JSONB):
    render_bind_cast = True

    def result_processor(self, dialect, coltype):
        return None


class AsyncpgJSONIndexType(sqltypes.JSON.JSONIndexType):
    pass


class AsyncpgJSONIntIndexType(sqltypes.JSON.JSONIntIndexType):
    __visit_name__ = "json_int_index"

    render_bind_cast = True


class AsyncpgJSONStrIndexType(sqltypes.JSON.JSONStrIndexType):
    __visit_name__ = "json_str_index"

    render_bind_cast = True


class AsyncpgJSONPathType(json.JSONPathType):
    def bind_processor(self, dialect):
        def process(value):
            if isinstance(value, str):
                # If it's already a string assume that it's in json path
                # format. This allows using cast with json paths literals
                return value
            elif value:
                tokens = [str(elem) for elem in value]
                return tokens
            else:
                return []

        return process


class AsyncpgNumeric(sqltypes.Numeric):
    render_bind_cast = True

    def bind_processor(self, dialect):
        return None

    def result_processor(self, dialect, coltype):
        if self.asdecimal:
            if coltype in _FLOAT_TYPES:
                return processors.to_decimal_processor_factory(
                    decimal.Decimal, self._effective_decimal_return_scale
                )
            elif coltype in _DECIMAL_TYPES or coltype in _INT_TYPES:
                # pg8000 returns Decimal natively for 1700
                return None
            else:
                raise exc.InvalidRequestError(
                    "Unknown PG numeric type: %d" % coltype
                )
        else:
            if coltype in _FLOAT_TYPES:
                # pg8000 returns float natively for 701
                return None
            elif coltype in _DECIMAL_TYPES or coltype in _INT_TYPES:
                return processors.to_float
            else:
                raise exc.InvalidRequestError(
                    "Unknown PG numeric type: %d" % coltype
                )


class AsyncpgFloat(AsyncpgNumeric, sqltypes.Float):
    __visit_name__ = "float"
    render_bind_cast = True


class AsyncpgREGCLASS(REGCLASS):
    render_bind_cast = True


class AsyncpgOID(OID):
    render_bind_cast = True


class AsyncpgCHAR(sqltypes.CHAR):
    render_bind_cast = True


class _AsyncpgRange(ranges.AbstractRangeImpl):
    def bind_processor(self, dialect):
        asyncpg_Range = dialect.dbapi.asyncpg.Range

        def to_range(value):
            if isinstance(value, ranges.Range):
                value = asyncpg_Range(
                    value.lower,
                    value.upper,
                    lower_inc=value.bounds[0] == "[",
                    upper_inc=value.bounds[1] == "]",
                    empty=value.empty,
                )
            return value

        return to_range

    def result_processor(self, dialect, coltype):
        def to_range(value):
            if value is not None:
                empty = value.isempty
                value = ranges.Range(
                    value.lower,
                    value.upper,
                    bounds=f"{'[' if empty or value.lower_inc else '('}"  # type: ignore  # noqa: E501
                    f"{']' if not empty and value.upper_inc else ')'}",
                    empty=empty,
                )
            return value

        return to_range


class _AsyncpgMultiRange(ranges.AbstractMultiRangeImpl):
    def bind_processor(self, dialect):
        asyncpg_Range = dialect.dbapi.asyncpg.Range

        NoneType = type(None)

        def to_range(value):
            if isinstance(value, (str, NoneType)):
                return value

            def to_range(value):
                if isinstance(value, ranges.Range):
                    value = asyncpg_Range(
                        value.lower,
                        value.upper,
                        lower_inc=value.bounds[0] == "[",
                        upper_inc=value.bounds[1] == "]",
                        empty=value.empty,
                    )
                return value

            return [
                to_range(element)
                for element in cast("Iterable[ranges.Range]", value)
            ]

        return to_range

    def result_processor(self, dialect, coltype):
        def to_range_array(value):
            def to_range(rvalue):
                if rvalue is not None:
                    empty = rvalue.isempty
                    rvalue = ranges.Range(
                        rvalue.lower,
                        rvalue.upper,
                        bounds=f"{'[' if empty or rvalue.lower_inc else '('}"  # type: ignore  # noqa: E501
                        f"{']' if not empty and rvalue.upper_inc else ')'}",
                        empty=empty,
                    )
                return rvalue

            if value is not None:
                value = [to_range(elem) for elem in value]

            return value

        return to_range_array


class PGExecutionContext_asyncpg(PGExecutionContext):
    def handle_dbapi_exception(self, e):
        if isinstance(
            e,
            (
                self.dialect.dbapi.InvalidCachedStatementError,
                self.dialect.dbapi.InternalServerError,
            ),
        ):
            self.dialect._invalidate_schema_cache()

    def pre_exec(self):
        if self.isddl:
            self.dialect._invalidate_schema_cache()

        self.cursor._invalidate_schema_cache_asof = (
            self.dialect._invalidate_schema_cache_asof
        )

        if not self.compiled:
            return

    def create_server_side_cursor(self):
        return self._dbapi_connection.cursor(server_side=True)


class PGCompiler_asyncpg(PGCompiler):
    pass


class PGIdentifierPreparer_asyncpg(PGIdentifierPreparer):
    pass


class AsyncAdapt_asyncpg_cursor:
    __slots__ = (
        "_adapt_connection",
        "_connection",
        "_rows",
        "description",
        "arraysize",
        "rowcount",
        "_cursor",
        "_invalidate_schema_cache_asof",
    )

    server_side = False

    def __init__(self, adapt_connection):
        self._adapt_connection = adapt_connection
        self._connection = adapt_connection._connection
        self._rows = []
        self._cursor = None
        self.description = None
        self.arraysize = 1
        self.rowcount = -1
        self._invalidate_schema_cache_asof = 0

    def close(self):
        self._rows[:] = []

    def _handle_exception(self, error):
        self._adapt_connection._handle_exception(error)

    async def _prepare_and_execute(self, operation, parameters):
        adapt_connection = self._adapt_connection

        async with adapt_connection._execute_mutex:
            if not adapt_connection._started:
                await adapt_connection._start_transaction()

            if parameters is None:
                parameters = ()

            try:
                prepared_stmt, attributes = await adapt_connection._prepare(
                    operation, self._invalidate_schema_cache_asof
                )

                if attributes:
                    self.description = [
                        (
                            attr.name,
                            attr.type.oid,
                            None,
                            None,
                            None,
                            None,
                            None,
                        )
                        for attr in attributes
                    ]
                else:
                    self.description = None

                if self.server_side:
                    self._cursor = await prepared_stmt.cursor(*parameters)
                    self.rowcount = -1
                else:
                    self._rows = await prepared_stmt.fetch(*parameters)
                    status = prepared_stmt.get_statusmsg()

                    reg = re.match(
                        r"(?:SELECT|UPDATE|DELETE|INSERT \d+) (\d+)", status
                    )
                    if reg:
                        self.rowcount = int(reg.group(1))
                    else:
                        self.rowcount = -1

            except Exception as error:
                self._handle_exception(error)

    async def _executemany(self, operation, seq_of_parameters):
        adapt_connection = self._adapt_connection

        self.description = None
        async with adapt_connection._execute_mutex:
            await adapt_connection._check_type_cache_invalidation(
                self._invalidate_schema_cache_asof
            )

            if not adapt_connection._started:
                await adapt_connection._start_transaction()

            try:
                return await self._connection.executemany(
                    operation, seq_of_parameters
                )
            except Exception as error:
                self._handle_exception(error)

    def execute(self, operation, parameters=None):
        self._adapt_connection.await_(
            self._prepare_and_execute(operation, parameters)
        )

    def executemany(self, operation, seq_of_parameters):
        return self._adapt_connection.await_(
            self._executemany(operation, seq_of_parameters)
        )

    def setinputsizes(self, *inputsizes):
        raise NotImplementedError()

    def __iter__(self):
        while self._rows:
            yield self._rows.pop(0)

    def fetchone(self):
        if self._rows:
            return self._rows.pop(0)
        else:
            return None

    def fetchmany(self, size=None):
        if size is None:
            size = self.arraysize

        retval = self._rows[0:size]
        self._rows[:] = self._rows[size:]
        return retval

    def fetchall(self):
        retval = self._rows[:]
        self._rows[:] = []
        return retval


class AsyncAdapt_asyncpg_ss_cursor(AsyncAdapt_asyncpg_cursor):
    server_side = True
    __slots__ = ("_rowbuffer",)

    def __init__(self, adapt_connection):
        super().__init__(adapt_connection)
        self._rowbuffer = None

    def close(self):
        self._cursor = None
        self._rowbuffer = None

    def _buffer_rows(self):
        new_rows = self._adapt_connection.await_(self._cursor.fetch(50))
        self._rowbuffer = collections.deque(new_rows)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._rowbuffer:
            self._buffer_rows()

        while True:
            while self._rowbuffer:
                yield self._rowbuffer.popleft()

            self._buffer_rows()
            if not self._rowbuffer:
                break

    def fetchone(self):
        if not self._rowbuffer:
            self._buffer_rows()
            if not self._rowbuffer:
                return None
        return self._rowbuffer.popleft()

    def fetchmany(self, size=None):
        if size is None:
            return self.fetchall()

        if not self._rowbuffer:
            self._buffer_rows()

        buf = list(self._rowbuffer)
        lb = len(buf)
        if size > lb:
            buf.extend(
                self._adapt_connection.await_(self._cursor.fetch(size - lb))
            )

        result = buf[0:size]
        self._rowbuffer = collections.deque(buf[size:])
        return result

    def fetchall(self):
        ret = list(self._rowbuffer) + list(
            self._adapt_connection.await_(self._all())
        )
        self._rowbuffer.clear()
        return ret

    async def _all(self):
        rows = []

        # TODO: looks like we have to hand-roll some kind of batching here.
        # hardcoding for the moment but this should be improved.
        while True:
            batch = await self._cursor.fetch(1000)
            if batch:
                rows.extend(batch)
                continue
            else:
                break
        return rows

    def executemany(self, operation, seq_of_parameters):
        raise NotImplementedError(
            "server side cursor doesn't support executemany yet"
        )


class AsyncAdapt_asyncpg_connection(AdaptedConnection):
    __slots__ = (
        "dbapi",
        "isolation_level",
        "_isolation_setting",
        "readonly",
        "deferrable",
        "_transaction",
        "_started",
        "_prepared_statement_cache",
        "_prepared_statement_name_func",
        "_invalidate_schema_cache_asof",
        "_execute_mutex",
    )

    await_ = staticmethod(await_only)

    def __init__(
        self,
        dbapi,
        connection,
        prepared_statement_cache_size=100,
        prepared_statement_name_func=None,
    ):
        self.dbapi = dbapi
        self._connection = connection
        self.isolation_level = self._isolation_setting = "read_committed"
        self.readonly = False
        self.deferrable = False
        self._transaction = None
        self._started = False
        self._invalidate_schema_cache_asof = time.time()
        self._execute_mutex = asyncio.Lock()

        if prepared_statement_cache_size:
            self._prepared_statement_cache = util.LRUCache(
                prepared_statement_cache_size
            )
        else:
            self._prepared_statement_cache = None

        if prepared_statement_name_func:
            self._prepared_statement_name_func = prepared_statement_name_func
        else:
            self._prepared_statement_name_func = self._default_name_func

    async def _check_type_cache_invalidation(self, invalidate_timestamp):
        if invalidate_timestamp > self._invalidate_schema_cache_asof:
            await self._connection.reload_schema_state()
            self._invalidate_schema_cache_asof = invalidate_timestamp

    async def _prepare(self, operation, invalidate_timestamp):
        await self._check_type_cache_invalidation(invalidate_timestamp)

        cache = self._prepared_statement_cache
        if cache is None:
            prepared_stmt = await self._connection.prepare(
                operation, name=self._prepared_statement_name_func()
            )
            attributes = prepared_stmt.get_attributes()
            return prepared_stmt, attributes

        # asyncpg uses a type cache for the "attributes" which seems to go
        # stale independently of the PreparedStatement itself, so place that
        # collection in the cache as well.
        if operation in cache:
            prepared_stmt, attributes, cached_timestamp = cache[operation]

            # preparedstatements themselves also go stale for certain DDL
            # changes such as size of a VARCHAR changing, so there is also
            # a cross-connection invalidation timestamp
            if cached_timestamp > invalidate_timestamp:
                return prepared_stmt, attributes

        prepared_stmt = await self._connection.prepare(
            operation, name=self._prepared_statement_name_func()
        )
        attributes = prepared_stmt.get_attributes()
        cache[operation] = (prepared_stmt, attributes, time.time())

        return prepared_stmt, attributes

    def _handle_exception(self, error):
        if self._connection.is_closed():
            self._transaction = None
            self._started = False

        if not isinstance(error, AsyncAdapt_asyncpg_dbapi.Error):
            exception_mapping = self.dbapi._asyncpg_error_translate

            for super_ in type(error).__mro__:
                if super_ in exception_mapping:
                    translated_error = exception_mapping[super_](
                        "%s: %s" % (type(error), error)
                    )
                    translated_error.pgcode = (
                        translated_error.sqlstate
                    ) = getattr(error, "sqlstate", None)
                    raise translated_error from error
            else:
                raise error
        else:
            raise error

    @property
    def autocommit(self):
        return self.isolation_level == "autocommit"

    @autocommit.setter
    def autocommit(self, value):
        if value:
            self.isolation_level = "autocommit"
        else:
            self.isolation_level = self._isolation_setting

    def ping(self):
        try:
            _ = self.await_(self._async_ping())
        except Exception as error:
            self._handle_exception(error)

    async def _async_ping(self):
        if self._transaction is None and self.isolation_level != "autocommit":
            # create a tranasction explicitly to support pgbouncer
            # transaction mode.   See #10226
            tr = self._connection.transaction()
            await tr.start()
            try:
                await self._connection.fetchrow(";")
            finally:
                await tr.rollback()
        else:
            await self._connection.fetchrow(";")

    def set_isolation_level(self, level):
        if self._started:
            self.rollback()
        self.isolation_level = self._isolation_setting = level

    async def _start_transaction(self):
        if self.isolation_level == "autocommit":
            return

        try:
            self._transaction = self._connection.transaction(
                isolation=self.isolation_level,
                readonly=self.readonly,
                deferrable=self.deferrable,
            )
            await self._transaction.start()
        except Exception as error:
            self._handle_exception(error)
        else:
            self._started = True

    def cursor(self, server_side=False):
        if server_side:
            return AsyncAdapt_asyncpg_ss_cursor(self)
        else:
            return AsyncAdapt_asyncpg_cursor(self)

    def rollback(self):
        if self._started:
            try:
                self.await_(self._transaction.rollback())
            except Exception as error:
                self._handle_exception(error)
            finally:
                self._transaction = None
                self._started = False

    def commit(self):
        if self._started:
            try:
                self.await_(self._transaction.commit())
            except Exception as error:
                self._handle_exception(error)
            finally:
                self._transaction = None
                self._started = False

    def close(self):
        self.rollback()

        self.await_(self._connection.close())

    def terminate(self):
        if util.concurrency.in_greenlet():
            # in a greenlet; this is the connection was invalidated
            # case.
            try:
                # try to gracefully close; see #10717
                # timeout added in asyncpg 0.14.0 December 2017
                self.await_(self._connection.close(timeout=2))
            except asyncio.TimeoutError:
                # in the case where we are recycling an old connection
                # that may have already been disconnected, close() will
                # fail with the above timeout.  in this case, terminate
                # the connection without any further waiting.
                # see issue #8419
                self._connection.terminate()
        else:
            # not in a greenlet; this is the gc cleanup case
            self._connection.terminate()
        self._started = False

    @staticmethod
    def _default_name_func():
        return None


class AsyncAdaptFallback_asyncpg_connection(AsyncAdapt_asyncpg_connection):
    __slots__ = ()

    await_ = staticmethod(await_fallback)


class AsyncAdapt_asyncpg_dbapi:
    def __init__(self, asyncpg):
        self.asyncpg = asyncpg
        self.paramstyle = "numeric_dollar"

    def connect(self, *arg, **kw):
        async_fallback = kw.pop("async_fallback", False)
        creator_fn = kw.pop("async_creator_fn", self.asyncpg.connect)
        prepared_statement_cache_size = kw.pop(
            "prepared_statement_cache_size", 100
        )
        prepared_statement_name_func = kw.pop(
            "prepared_statement_name_func", None
        )

        if util.asbool(async_fallback):
            return AsyncAdaptFallback_asyncpg_connection(
                self,
                await_fallback(creator_fn(*arg, **kw)),
                prepared_statement_cache_size=prepared_statement_cache_size,
                prepared_statement_name_func=prepared_statement_name_func,
            )
        else:
            return AsyncAdapt_asyncpg_connection(
                self,
                await_only(creator_fn(*arg, **kw)),
                prepared_statement_cache_size=prepared_statement_cache_size,
                prepared_statement_name_func=prepared_statement_name_func,
            )

    class Error(Exception):
        pass

    class Warning(Exception):  # noqa
        pass

    class InterfaceError(Error):
        pass

    class DatabaseError(Error):
        pass

    class InternalError(DatabaseError):
        pass

    class OperationalError(DatabaseError):
        pass

    class ProgrammingError(DatabaseError):
        pass

    class IntegrityError(DatabaseError):
        pass

    class DataError(DatabaseError):
        pass

    class NotSupportedError(DatabaseError):
        pass

    class InternalServerError(InternalError):
        pass

    class InvalidCachedStatementError(NotSupportedError):
        def __init__(self, message):
            super().__init__(
                message + " (SQLAlchemy asyncpg dialect will now invalidate "
                "all prepared caches in response to this exception)",
            )

    # pep-249 datatype placeholders.  As of SQLAlchemy 2.0 these aren't
    # used, however the test suite looks for these in a few cases.
    STRING = util.symbol("STRING")
    NUMBER = util.symbol("NUMBER")
    DATETIME = util.symbol("DATETIME")

    @util.memoized_property
    def _asyncpg_error_translate(self):
        import asyncpg

        return {
            asyncpg.exceptions.IntegrityConstraintViolationError: self.IntegrityError,  # noqa: E501
            asyncpg.exceptions.PostgresError: self.Error,
            asyncpg.exceptions.SyntaxOrAccessError: self.ProgrammingError,
            asyncpg.exceptions.InterfaceError: self.InterfaceError,
            asyncpg.exceptions.InvalidCachedStatementError: self.InvalidCachedStatementError,  # noqa: E501
            asyncpg.exceptions.InternalServerError: self.InternalServerError,
        }

    def Binary(self, value):
        return value


class PGDialect_asyncpg(PGDialect):
    driver = "asyncpg"
    supports_statement_cache = True

    supports_server_side_cursors = True

    render_bind_cast = True
    has_terminate = True

    default_paramstyle = "numeric_dollar"
    supports_sane_multi_rowcount = False
    execution_ctx_cls = PGExecutionContext_asyncpg
    statement_compiler = PGCompiler_asyncpg
    preparer = PGIdentifierPreparer_asyncpg

    colspecs = util.update_copy(
        PGDialect.colspecs,
        {
            sqltypes.String: AsyncpgString,
            sqltypes.ARRAY: AsyncpgARRAY,
            BIT: AsyncpgBit,
            CITEXT: CITEXT,
            REGCONFIG: AsyncpgREGCONFIG,
            sqltypes.Time: AsyncpgTime,
            sqltypes.Date: AsyncpgDate,
            sqltypes.DateTime: AsyncpgDateTime,
            sqltypes.Interval: AsyncPgInterval,
            INTERVAL: AsyncPgInterval,
            sqltypes.Boolean: AsyncpgBoolean,
            sqltypes.Integer: AsyncpgInteger,
            sqltypes.BigInteger: AsyncpgBigInteger,
            sqltypes.Numeric: AsyncpgNumeric,
            sqltypes.Float: AsyncpgFloat,
            sqltypes.JSON: AsyncpgJSON,
            sqltypes.LargeBinary: AsyncpgByteA,
            json.JSONB: AsyncpgJSONB,
            sqltypes.JSON.JSONPathType: AsyncpgJSONPathType,
            sqltypes.JSON.JSONIndexType: AsyncpgJSONIndexType,
            sqltypes.JSON.JSONIntIndexType: AsyncpgJSONIntIndexType,
            sqltypes.JSON.JSONStrIndexType: AsyncpgJSONStrIndexType,
            sqltypes.Enum: AsyncPgEnum,
            OID: AsyncpgOID,
            REGCLASS: AsyncpgREGCLASS,
            sqltypes.CHAR: AsyncpgCHAR,
            ranges.AbstractRange: _AsyncpgRange,
            ranges.AbstractMultiRange: _AsyncpgMultiRange,
        },
    )
    is_async = True
    _invalidate_schema_cache_asof = 0

    def _invalidate_schema_cache(self):
        self._invalidate_schema_cache_asof = time.time()

    @util.memoized_property
    def _dbapi_version(self):
        if self.dbapi and hasattr(self.dbapi, "__version__"):
            return tuple(
                [
                    int(x)
                    for x in re.findall(
                        r"(\d+)(?:[-\.]?|$)", self.dbapi.__version__
                    )
                ]
            )
        else:
            return (99, 99, 99)

    @classmethod
    def import_dbapi(cls):
        return AsyncAdapt_asyncpg_dbapi(__import__("asyncpg"))

    @util.memoized_property
    def _isolation_lookup(self):
        return {
            "AUTOCOMMIT": "autocommit",
            "READ COMMITTED": "read_committed",
            "REPEATABLE READ": "repeatable_read",
            "SERIALIZABLE": "serializable",
        }

    def get_isolation_level_values(self, dbapi_connection):
        return list(self._isolation_lookup)

    def set_isolation_level(self, dbapi_connection, level):
        dbapi_connection.set_isolation_level(self._isolation_lookup[level])

    def set_readonly(self, connection, value):
        connection.readonly = value

    def get_readonly(self, connection):
        return connection.readonly

    def set_deferrable(self, connection, value):
        connection.deferrable = value

    def get_deferrable(self, connection):
        return connection.deferrable

    def do_terminate(self, dbapi_connection) -> None:
        dbapi_connection.terminate()

    def create_connect_args(self, url):
        opts = url.translate_connect_args(username="user")
        multihosts, multiports = self._split_multihost_from_url(url)

        opts.update(url.query)

        if multihosts:
            assert multiports
            if len(multihosts) == 1:
                opts["host"] = multihosts[0]
                if multiports[0] is not None:
                    opts["port"] = multiports[0]
            elif not all(multihosts):
                raise exc.ArgumentError(
                    "All hosts are required to be present"
                    " for asyncpg multiple host URL"
                )
            elif not all(multiports):
                raise exc.ArgumentError(
                    "All ports are required to be present"
                    " for asyncpg multiple host URL"
                )
            else:
                opts["host"] = list(multihosts)
                opts["port"] = list(multiports)
        else:
            util.coerce_kw_type(opts, "port", int)
        util.coerce_kw_type(opts, "prepared_statement_cache_size", int)
        return ([], opts)

    def do_ping(self, dbapi_connection):
        dbapi_connection.ping()
        return True

    @classmethod
    def get_pool_class(cls, url):
        async_fallback = url.query.get("async_fallback", False)

        if util.asbool(async_fallback):
            return pool.FallbackAsyncAdaptedQueuePool
        else:
            return pool.AsyncAdaptedQueuePool

    def is_disconnect(self, e, connection, cursor):
        if connection:
            return connection._connection.is_closed()
        else:
            return isinstance(
                e, self.dbapi.InterfaceError
            ) and "connection is closed" in str(e)

    async def setup_asyncpg_json_codec(self, conn):
        """set up JSON codec for asyncpg.

        This occurs for all new connections and
        can be overridden by third party dialects.

        .. versionadded:: 1.4.27

        """

        asyncpg_connection = conn._connection
        deserializer = self._json_deserializer or _py_json.loads

        def _json_decoder(bin_value):
            return deserializer(bin_value.decode())

        await asyncpg_connection.set_type_codec(
            "json",
            encoder=str.encode,
            decoder=_json_decoder,
            schema="pg_catalog",
            format="binary",
        )

    async def setup_asyncpg_jsonb_codec(self, conn):
        """set up JSONB codec for asyncpg.

        This occurs for all new connections and
        can be overridden by third party dialects.

        .. versionadded:: 1.4.27

        """

        asyncpg_connection = conn._connection
        deserializer = self._json_deserializer or _py_json.loads

        def _jsonb_encoder(str_value):
            # \x01 is the prefix for jsonb used by PostgreSQL.
            # asyncpg requires it when format='binary'
            return b"\x01" + str_value.encode()

        deserializer = self._json_deserializer or _py_json.loads

        def _jsonb_decoder(bin_value):
            # the byte is the \x01 prefix for jsonb used by PostgreSQL.
            # asyncpg returns it when format='binary'
            return deserializer(bin_value[1:].decode())

        await asyncpg_connection.set_type_codec(
            "jsonb",
            encoder=_jsonb_encoder,
            decoder=_jsonb_decoder,
            schema="pg_catalog",
            format="binary",
        )

    async def _disable_asyncpg_inet_codecs(self, conn):
        asyncpg_connection = conn._connection

        await asyncpg_connection.set_type_codec(
            "inet",
            encoder=lambda s: s,
            decoder=lambda s: s,
            schema="pg_catalog",
            format="text",
        )

        await asyncpg_connection.set_type_codec(
            "cidr",
            encoder=lambda s: s,
            decoder=lambda s: s,
            schema="pg_catalog",
            format="text",
        )

    def on_connect(self):
        """on_connect for asyncpg

        A major component of this for asyncpg is to set up type decoders at the
        asyncpg level.

        See https://github.com/MagicStack/asyncpg/issues/623 for
        notes on JSON/JSONB implementation.

        """

        super_connect = super().on_connect()

        def connect(conn):
            conn.await_(self.setup_asyncpg_json_codec(conn))
            conn.await_(self.setup_asyncpg_jsonb_codec(conn))

            if self._native_inet_types is False:
                conn.await_(self._disable_asyncpg_inet_codecs(conn))
            if super_connect is not None:
                super_connect(conn)

        return connect

    def get_driver_connection(self, connection):
        return connection._connection


dialect = PGDialect_asyncpg
