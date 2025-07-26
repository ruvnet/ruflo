# dialects/sqlite/aiosqlite.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors


r"""

.. dialect:: sqlite+aiosqlite
    :name: aiosqlite
    :dbapi: aiosqlite
    :connectstring: sqlite+aiosqlite:///file_path
    :url: https://pypi.org/project/aiosqlite/

The aiosqlite dialect provides support for the SQLAlchemy asyncio interface
running on top of pysqlite.

aiosqlite is a wrapper around pysqlite that uses a background thread for
each connection.   It does not actually use non-blocking IO, as SQLite
databases are not socket-based.  However it does provide a working asyncio
interface that's useful for testing and prototyping purposes.

Using a special asyncio mediation layer, the aiosqlite dialect is usable
as the backend for the :ref:`SQLAlchemy asyncio <asyncio_toplevel>`
extension package.

This dialect should normally be used only with the
:func:`_asyncio.create_async_engine` engine creation function::

    from sqlalchemy.ext.asyncio import create_async_engine
    engine = create_async_engine("sqlite+aiosqlite:///filename")

The URL passes through all arguments to the ``pysqlite`` driver, so all
connection arguments are the same as they are for that of :ref:`pysqlite`.

.. _aiosqlite_udfs:

User-Defined Functions
----------------------

aiosqlite extends pysqlite to support async, so we can create our own user-defined functions (UDFs)
in Python and use them directly in SQLite queries as described here: :ref:`pysqlite_udfs`.

.. _aiosqlite_serializable:

Serializable isolation / Savepoints / Transactional DDL (asyncio version)
-------------------------------------------------------------------------

Similarly to pysqlite, aiosqlite does not support SAVEPOINT feature.

The solution is similar to :ref:`pysqlite_serializable`. This is achieved by the event listeners in async::

    from sqlalchemy import create_engine, event
    from sqlalchemy.ext.asyncio import create_async_engine

    engine = create_async_engine("sqlite+aiosqlite:///myfile.db")

    @event.listens_for(engine.sync_engine, "connect")
    def do_connect(dbapi_connection, connection_record):
        # disable aiosqlite's emitting of the BEGIN statement entirely.
        # also stops it from emitting COMMIT before any DDL.
        dbapi_connection.isolation_level = None

    @event.listens_for(engine.sync_engine, "begin")
    def do_begin(conn):
        # emit our own BEGIN
        conn.exec_driver_sql("BEGIN")

.. warning:: When using the above recipe, it is advised to not use the
   :paramref:`.Connection.execution_options.isolation_level` setting on
   :class:`_engine.Connection` and :func:`_sa.create_engine`
   with the SQLite driver,
   as this function necessarily will also alter the ".isolation_level" setting.

"""  # noqa

import asyncio
from functools import partial

from .base import SQLiteExecutionContext
from .pysqlite import SQLiteDialect_pysqlite
from ... import pool
from ... import util
from ...engine import AdaptedConnection
from ...util.concurrency import await_fallback
from ...util.concurrency import await_only


class AsyncAdapt_aiosqlite_cursor:
    # TODO: base on connectors/asyncio.py
    # see #10415

    __slots__ = (
        "_adapt_connection",
        "_connection",
        "description",
        "await_",
        "_rows",
        "arraysize",
        "rowcount",
        "lastrowid",
    )

    server_side = False

    def __init__(self, adapt_connection):
        self._adapt_connection = adapt_connection
        self._connection = adapt_connection._connection
        self.await_ = adapt_connection.await_
        self.arraysize = 1
        self.rowcount = -1
        self.description = None
        self._rows = []

    def close(self):
        self._rows[:] = []

    def execute(self, operation, parameters=None):
        try:
            _cursor = self.await_(self._connection.cursor())

            if parameters is None:
                self.await_(_cursor.execute(operation))
            else:
                self.await_(_cursor.execute(operation, parameters))

            if _cursor.description:
                self.description = _cursor.description
                self.lastrowid = self.rowcount = -1

                if not self.server_side:
                    self._rows = self.await_(_cursor.fetchall())
            else:
                self.description = None
                self.lastrowid = _cursor.lastrowid
                self.rowcount = _cursor.rowcount

            if not self.server_side:
                self.await_(_cursor.close())
            else:
                self._cursor = _cursor
        except Exception as error:
            self._adapt_connection._handle_exception(error)

    def executemany(self, operation, seq_of_parameters):
        try:
            _cursor = self.await_(self._connection.cursor())
            self.await_(_cursor.executemany(operation, seq_of_parameters))
            self.description = None
            self.lastrowid = _cursor.lastrowid
            self.rowcount = _cursor.rowcount
            self.await_(_cursor.close())
        except Exception as error:
            self._adapt_connection._handle_exception(error)

    def setinputsizes(self, *inputsizes):
        pass

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


class AsyncAdapt_aiosqlite_ss_cursor(AsyncAdapt_aiosqlite_cursor):
    # TODO: base on connectors/asyncio.py
    # see #10415
    __slots__ = "_cursor"

    server_side = True

    def __init__(self, *arg, **kw):
        super().__init__(*arg, **kw)
        self._cursor = None

    def close(self):
        if self._cursor is not None:
            self.await_(self._cursor.close())
            self._cursor = None

    def fetchone(self):
        return self.await_(self._cursor.fetchone())

    def fetchmany(self, size=None):
        if size is None:
            size = self.arraysize
        return self.await_(self._cursor.fetchmany(size=size))

    def fetchall(self):
        return self.await_(self._cursor.fetchall())


class AsyncAdapt_aiosqlite_connection(AdaptedConnection):
    await_ = staticmethod(await_only)
    __slots__ = ("dbapi",)

    def __init__(self, dbapi, connection):
        self.dbapi = dbapi
        self._connection = connection

    @property
    def isolation_level(self):
        return self._connection.isolation_level

    @isolation_level.setter
    def isolation_level(self, value):
        # aiosqlite's isolation_level setter works outside the Thread
        # that it's supposed to, necessitating setting check_same_thread=False.
        # for improved stability, we instead invent our own awaitable version
        # using aiosqlite's async queue directly.

        def set_iso(connection, value):
            connection.isolation_level = value

        function = partial(set_iso, self._connection._conn, value)
        future = asyncio.get_event_loop().create_future()

        self._connection._tx.put_nowait((future, function))

        try:
            return self.await_(future)
        except Exception as error:
            self._handle_exception(error)

    def create_function(self, *args, **kw):
        try:
            self.await_(self._connection.create_function(*args, **kw))
        except Exception as error:
            self._handle_exception(error)

    def cursor(self, server_side=False):
        if server_side:
            return AsyncAdapt_aiosqlite_ss_cursor(self)
        else:
            return AsyncAdapt_aiosqlite_cursor(self)

    def execute(self, *args, **kw):
        return self.await_(self._connection.execute(*args, **kw))

    def rollback(self):
        try:
            self.await_(self._connection.rollback())
        except Exception as error:
            self._handle_exception(error)

    def commit(self):
        try:
            self.await_(self._connection.commit())
        except Exception as error:
            self._handle_exception(error)

    def close(self):
        try:
            self.await_(self._connection.close())
        except ValueError:
            # this is undocumented for aiosqlite, that ValueError
            # was raised if .close() was called more than once, which is
            # both not customary for DBAPI and is also not a DBAPI.Error
            # exception. This is now fixed in aiosqlite via my PR
            # https://github.com/omnilib/aiosqlite/pull/238, so we can be
            # assured this will not become some other kind of exception,
            # since it doesn't raise anymore.

            pass
        except Exception as error:
            self._handle_exception(error)

    def _handle_exception(self, error):
        if (
            isinstance(error, ValueError)
            and error.args[0] == "no active connection"
        ):
            raise self.dbapi.sqlite.OperationalError(
                "no active connection"
            ) from error
        else:
            raise error


class AsyncAdaptFallback_aiosqlite_connection(AsyncAdapt_aiosqlite_connection):
    __slots__ = ()

    await_ = staticmethod(await_fallback)


class AsyncAdapt_aiosqlite_dbapi:
    def __init__(self, aiosqlite, sqlite):
        self.aiosqlite = aiosqlite
        self.sqlite = sqlite
        self.paramstyle = "qmark"
        self._init_dbapi_attributes()

    def _init_dbapi_attributes(self):
        for name in (
            "DatabaseError",
            "Error",
            "IntegrityError",
            "NotSupportedError",
            "OperationalError",
            "ProgrammingError",
            "sqlite_version",
            "sqlite_version_info",
        ):
            setattr(self, name, getattr(self.aiosqlite, name))

        for name in ("PARSE_COLNAMES", "PARSE_DECLTYPES"):
            setattr(self, name, getattr(self.sqlite, name))

        for name in ("Binary",):
            setattr(self, name, getattr(self.sqlite, name))

    def connect(self, *arg, **kw):
        async_fallback = kw.pop("async_fallback", False)

        creator_fn = kw.pop("async_creator_fn", None)
        if creator_fn:
            connection = creator_fn(*arg, **kw)
        else:
            connection = self.aiosqlite.connect(*arg, **kw)
            # it's a Thread.   you'll thank us later
            connection.daemon = True

        if util.asbool(async_fallback):
            return AsyncAdaptFallback_aiosqlite_connection(
                self,
                await_fallback(connection),
            )
        else:
            return AsyncAdapt_aiosqlite_connection(
                self,
                await_only(connection),
            )


class SQLiteExecutionContext_aiosqlite(SQLiteExecutionContext):
    def create_server_side_cursor(self):
        return self._dbapi_connection.cursor(server_side=True)


class SQLiteDialect_aiosqlite(SQLiteDialect_pysqlite):
    driver = "aiosqlite"
    supports_statement_cache = True

    is_async = True

    supports_server_side_cursors = True

    execution_ctx_cls = SQLiteExecutionContext_aiosqlite

    @classmethod
    def import_dbapi(cls):
        return AsyncAdapt_aiosqlite_dbapi(
            __import__("aiosqlite"), __import__("sqlite3")
        )

    @classmethod
    def get_pool_class(cls, url):
        if cls._is_url_file_db(url):
            return pool.NullPool
        else:
            return pool.StaticPool

    def is_disconnect(self, e, connection, cursor):
        if isinstance(
            e, self.dbapi.OperationalError
        ) and "no active connection" in str(e):
            return True

        return super().is_disconnect(e, connection, cursor)

    def get_driver_connection(self, connection):
        return connection._connection


dialect = SQLiteDialect_aiosqlite
