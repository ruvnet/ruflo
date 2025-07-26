# connectors/aioodbc.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

from __future__ import annotations

from typing import TYPE_CHECKING

from .asyncio import AsyncAdapt_dbapi_connection
from .asyncio import AsyncAdapt_dbapi_cursor
from .asyncio import AsyncAdapt_dbapi_ss_cursor
from .asyncio import AsyncAdaptFallback_dbapi_connection
from .pyodbc import PyODBCConnector
from .. import pool
from .. import util
from ..util.concurrency import await_fallback
from ..util.concurrency import await_only

if TYPE_CHECKING:
    from ..engine.interfaces import ConnectArgsType
    from ..engine.url import URL


class AsyncAdapt_aioodbc_cursor(AsyncAdapt_dbapi_cursor):
    __slots__ = ()

    def setinputsizes(self, *inputsizes):
        # see https://github.com/aio-libs/aioodbc/issues/451
        return self._cursor._impl.setinputsizes(*inputsizes)

        # how it's supposed to work
        # return self.await_(self._cursor.setinputsizes(*inputsizes))


class AsyncAdapt_aioodbc_ss_cursor(
    AsyncAdapt_aioodbc_cursor, AsyncAdapt_dbapi_ss_cursor
):
    __slots__ = ()


class AsyncAdapt_aioodbc_connection(AsyncAdapt_dbapi_connection):
    _cursor_cls = AsyncAdapt_aioodbc_cursor
    _ss_cursor_cls = AsyncAdapt_aioodbc_ss_cursor
    __slots__ = ()

    @property
    def autocommit(self):
        return self._connection.autocommit

    @autocommit.setter
    def autocommit(self, value):
        # https://github.com/aio-libs/aioodbc/issues/448
        # self._connection.autocommit = value

        self._connection._conn.autocommit = value

    def cursor(self, server_side=False):
        # aioodbc sets connection=None when closed and just fails with
        # AttributeError here.  Here we use the same ProgrammingError +
        # message that pyodbc uses, so it triggers is_disconnect() as well.
        if self._connection.closed:
            raise self.dbapi.ProgrammingError(
                "Attempt to use a closed connection."
            )
        return super().cursor(server_side=server_side)

    def rollback(self):
        # aioodbc sets connection=None when closed and just fails with
        # AttributeError here.  should be a no-op
        if not self._connection.closed:
            super().rollback()

    def commit(self):
        # aioodbc sets connection=None when closed and just fails with
        # AttributeError here.  should be a no-op
        if not self._connection.closed:
            super().commit()

    def close(self):
        # aioodbc sets connection=None when closed and just fails with
        # AttributeError here.  should be a no-op
        if not self._connection.closed:
            super().close()


class AsyncAdaptFallback_aioodbc_connection(
    AsyncAdaptFallback_dbapi_connection, AsyncAdapt_aioodbc_connection
):
    __slots__ = ()


class AsyncAdapt_aioodbc_dbapi:
    def __init__(self, aioodbc, pyodbc):
        self.aioodbc = aioodbc
        self.pyodbc = pyodbc
        self.paramstyle = pyodbc.paramstyle
        self._init_dbapi_attributes()
        self.Cursor = AsyncAdapt_dbapi_cursor
        self.version = pyodbc.version

    def _init_dbapi_attributes(self):
        for name in (
            "Warning",
            "Error",
            "InterfaceError",
            "DataError",
            "DatabaseError",
            "OperationalError",
            "InterfaceError",
            "IntegrityError",
            "ProgrammingError",
            "InternalError",
            "NotSupportedError",
            "NUMBER",
            "STRING",
            "DATETIME",
            "BINARY",
            "Binary",
            "BinaryNull",
            "SQL_VARCHAR",
            "SQL_WVARCHAR",
        ):
            setattr(self, name, getattr(self.pyodbc, name))

    def connect(self, *arg, **kw):
        async_fallback = kw.pop("async_fallback", False)
        creator_fn = kw.pop("async_creator_fn", self.aioodbc.connect)

        if util.asbool(async_fallback):
            return AsyncAdaptFallback_aioodbc_connection(
                self,
                await_fallback(creator_fn(*arg, **kw)),
            )
        else:
            return AsyncAdapt_aioodbc_connection(
                self,
                await_only(creator_fn(*arg, **kw)),
            )


class aiodbcConnector(PyODBCConnector):
    is_async = True
    supports_statement_cache = True

    supports_server_side_cursors = True

    @classmethod
    def import_dbapi(cls):
        return AsyncAdapt_aioodbc_dbapi(
            __import__("aioodbc"), __import__("pyodbc")
        )

    def create_connect_args(self, url: URL) -> ConnectArgsType:
        arg, kw = super().create_connect_args(url)
        if arg and arg[0]:
            kw["dsn"] = arg[0]

        return (), kw

    @classmethod
    def get_pool_class(cls, url):
        async_fallback = url.query.get("async_fallback", False)

        if util.asbool(async_fallback):
            return pool.FallbackAsyncAdaptedQueuePool
        else:
            return pool.AsyncAdaptedQueuePool

    def get_driver_connection(self, connection):
        return connection._connection
