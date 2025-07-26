# dialects/oracle/oracledb.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

r"""
.. dialect:: oracle+oracledb
    :name: python-oracledb
    :dbapi: oracledb
    :connectstring: oracle+oracledb://user:pass@hostname:port[/dbname][?service_name=<service>[&key=value&key=value...]]
    :url: https://oracle.github.io/python-oracledb/

python-oracledb is released by Oracle to supersede the cx_Oracle driver.
It is fully compatible with cx_Oracle and features both a "thin" client
mode that requires no dependencies, as well as a "thick" mode that uses
the Oracle Client Interface in the same way as cx_Oracle.

.. seealso::

    :ref:`cx_oracle` - all of cx_Oracle's notes apply to the oracledb driver
    as well.

The SQLAlchemy ``oracledb`` dialect provides both a sync and an async
implementation under the same dialect name. The proper version is
selected depending on how the engine is created:

* calling :func:`_sa.create_engine` with ``oracle+oracledb://...`` will
  automatically select the sync version, e.g.::

    from sqlalchemy import create_engine
    sync_engine = create_engine("oracle+oracledb://scott:tiger@localhost/?service_name=XEPDB1")

* calling :func:`_asyncio.create_async_engine` with
  ``oracle+oracledb://...`` will automatically select the async version,
  e.g.::

    from sqlalchemy.ext.asyncio import create_async_engine
    asyncio_engine = create_async_engine("oracle+oracledb://scott:tiger@localhost/?service_name=XEPDB1")

The asyncio version of the dialect may also be specified explicitly using the
``oracledb_async`` suffix, as::

    from sqlalchemy.ext.asyncio import create_async_engine
    asyncio_engine = create_async_engine("oracle+oracledb_async://scott:tiger@localhost/?service_name=XEPDB1")

.. versionadded:: 2.0.25 added support for the async version of oracledb.

Thick mode support
------------------

By default the ``python-oracledb`` is started in thin mode, that does not
require oracle client libraries to be installed in the system. The
``python-oracledb`` driver also support a "thick" mode, that behaves
similarly to ``cx_oracle`` and requires that Oracle Client Interface (OCI)
is installed.

To enable this mode, the user may call ``oracledb.init_oracle_client``
manually, or by passing the parameter ``thick_mode=True`` to
:func:`_sa.create_engine`. To pass custom arguments to ``init_oracle_client``,
like the ``lib_dir`` path, a dict may be passed to this parameter, as in::

    engine = sa.create_engine("oracle+oracledb://...", thick_mode={
        "lib_dir": "/path/to/oracle/client/lib", "driver_name": "my-app"
    })

.. seealso::

    https://python-oracledb.readthedocs.io/en/latest/api_manual/module.html#oracledb.init_oracle_client


.. versionadded:: 2.0.0 added support for oracledb driver.

"""  # noqa
from __future__ import annotations

import collections
import re
from typing import Any
from typing import TYPE_CHECKING

from .cx_oracle import OracleDialect_cx_oracle as _OracleDialect_cx_oracle
from ... import exc
from ... import pool
from ...connectors.asyncio import AsyncAdapt_dbapi_connection
from ...connectors.asyncio import AsyncAdapt_dbapi_cursor
from ...connectors.asyncio import AsyncAdaptFallback_dbapi_connection
from ...util import asbool
from ...util import await_fallback
from ...util import await_only

if TYPE_CHECKING:
    from oracledb import AsyncConnection
    from oracledb import AsyncCursor


class OracleDialect_oracledb(_OracleDialect_cx_oracle):
    supports_statement_cache = True
    driver = "oracledb"
    _min_version = (1,)

    def __init__(
        self,
        auto_convert_lobs=True,
        coerce_to_decimal=True,
        arraysize=50,
        encoding_errors=None,
        thick_mode=None,
        **kwargs,
    ):
        super().__init__(
            auto_convert_lobs,
            coerce_to_decimal,
            arraysize,
            encoding_errors,
            **kwargs,
        )

        if self.dbapi is not None and (
            thick_mode or isinstance(thick_mode, dict)
        ):
            kw = thick_mode if isinstance(thick_mode, dict) else {}
            self.dbapi.init_oracle_client(**kw)

    @classmethod
    def import_dbapi(cls):
        import oracledb

        return oracledb

    @classmethod
    def is_thin_mode(cls, connection):
        return connection.connection.dbapi_connection.thin

    @classmethod
    def get_async_dialect_cls(cls, url):
        return OracleDialectAsync_oracledb

    def _load_version(self, dbapi_module):
        version = (0, 0, 0)
        if dbapi_module is not None:
            m = re.match(r"(\d+)\.(\d+)(?:\.(\d+))?", dbapi_module.version)
            if m:
                version = tuple(
                    int(x) for x in m.group(1, 2, 3) if x is not None
                )
        self.oracledb_ver = version
        if (
            self.oracledb_ver > (0, 0, 0)
            and self.oracledb_ver < self._min_version
        ):
            raise exc.InvalidRequestError(
                f"oracledb version {self._min_version} and above are supported"
            )


class AsyncAdapt_oracledb_cursor(AsyncAdapt_dbapi_cursor):
    _cursor: AsyncCursor
    __slots__ = ()

    @property
    def outputtypehandler(self):
        return self._cursor.outputtypehandler

    @outputtypehandler.setter
    def outputtypehandler(self, value):
        self._cursor.outputtypehandler = value

    def var(self, *args, **kwargs):
        return self._cursor.var(*args, **kwargs)

    def close(self):
        self._rows.clear()
        self._cursor.close()

    def setinputsizes(self, *args: Any, **kwargs: Any) -> Any:
        return self._cursor.setinputsizes(*args, **kwargs)

    def _aenter_cursor(self, cursor: AsyncCursor) -> AsyncCursor:
        try:
            return cursor.__enter__()
        except Exception as error:
            self._adapt_connection._handle_exception(error)

    async def _execute_async(self, operation, parameters):
        # override to not use mutex, oracledb already has mutex

        if parameters is None:
            result = await self._cursor.execute(operation)
        else:
            result = await self._cursor.execute(operation, parameters)

        if self._cursor.description and not self.server_side:
            self._rows = collections.deque(await self._cursor.fetchall())
        return result

    async def _executemany_async(
        self,
        operation,
        seq_of_parameters,
    ):
        # override to not use mutex, oracledb already has mutex
        return await self._cursor.executemany(operation, seq_of_parameters)

    def __enter__(self):
        return self

    def __exit__(self, type_: Any, value: Any, traceback: Any) -> None:
        self.close()


class AsyncAdapt_oracledb_connection(AsyncAdapt_dbapi_connection):
    _connection: AsyncConnection
    __slots__ = ()

    thin = True

    _cursor_cls = AsyncAdapt_oracledb_cursor
    _ss_cursor_cls = None

    @property
    def autocommit(self):
        return self._connection.autocommit

    @autocommit.setter
    def autocommit(self, value):
        self._connection.autocommit = value

    @property
    def outputtypehandler(self):
        return self._connection.outputtypehandler

    @outputtypehandler.setter
    def outputtypehandler(self, value):
        self._connection.outputtypehandler = value

    @property
    def version(self):
        return self._connection.version

    @property
    def stmtcachesize(self):
        return self._connection.stmtcachesize

    @stmtcachesize.setter
    def stmtcachesize(self, value):
        self._connection.stmtcachesize = value

    def cursor(self):
        return AsyncAdapt_oracledb_cursor(self)


class AsyncAdaptFallback_oracledb_connection(
    AsyncAdaptFallback_dbapi_connection, AsyncAdapt_oracledb_connection
):
    __slots__ = ()


class OracledbAdaptDBAPI:
    def __init__(self, oracledb) -> None:
        self.oracledb = oracledb

        for k, v in self.oracledb.__dict__.items():
            if k != "connect":
                self.__dict__[k] = v

    def connect(self, *arg, **kw):
        async_fallback = kw.pop("async_fallback", False)
        creator_fn = kw.pop("async_creator_fn", self.oracledb.connect_async)

        if asbool(async_fallback):
            return AsyncAdaptFallback_oracledb_connection(
                self, await_fallback(creator_fn(*arg, **kw))
            )

        else:
            return AsyncAdapt_oracledb_connection(
                self, await_only(creator_fn(*arg, **kw))
            )


class OracleDialectAsync_oracledb(OracleDialect_oracledb):
    is_async = True
    supports_statement_cache = True

    _min_version = (2,)

    # thick_mode mode is not supported by asyncio, oracledb will raise
    @classmethod
    def import_dbapi(cls):
        import oracledb

        return OracledbAdaptDBAPI(oracledb)

    @classmethod
    def get_pool_class(cls, url):
        async_fallback = url.query.get("async_fallback", False)

        if asbool(async_fallback):
            return pool.FallbackAsyncAdaptedQueuePool
        else:
            return pool.AsyncAdaptedQueuePool

    def get_driver_connection(self, connection):
        return connection._connection


dialect = OracleDialect_oracledb
dialect_async = OracleDialectAsync_oracledb
