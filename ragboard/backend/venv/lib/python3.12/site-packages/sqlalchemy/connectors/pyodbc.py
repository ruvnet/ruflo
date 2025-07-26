# connectors/pyodbc.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

import re
from types import ModuleType
import typing
from typing import Any
from typing import Dict
from typing import List
from typing import Optional
from typing import Tuple
from typing import Union
from urllib.parse import unquote_plus

from . import Connector
from .. import ExecutionContext
from .. import pool
from .. import util
from ..engine import ConnectArgsType
from ..engine import Connection
from ..engine import interfaces
from ..engine import URL
from ..sql.type_api import TypeEngine

if typing.TYPE_CHECKING:
    from ..engine.interfaces import IsolationLevel


class PyODBCConnector(Connector):
    driver = "pyodbc"

    # this is no longer False for pyodbc in general
    supports_sane_rowcount_returning = True
    supports_sane_multi_rowcount = False

    supports_native_decimal = True
    default_paramstyle = "named"

    fast_executemany = False

    # for non-DSN connections, this *may* be used to
    # hold the desired driver name
    pyodbc_driver_name: Optional[str] = None

    dbapi: ModuleType

    def __init__(self, use_setinputsizes: bool = False, **kw: Any):
        super().__init__(**kw)
        if use_setinputsizes:
            self.bind_typing = interfaces.BindTyping.SETINPUTSIZES

    @classmethod
    def import_dbapi(cls) -> ModuleType:
        return __import__("pyodbc")

    def create_connect_args(self, url: URL) -> ConnectArgsType:
        opts = url.translate_connect_args(username="user")
        opts.update(url.query)

        keys = opts

        query = url.query

        connect_args: Dict[str, Any] = {}
        connectors: List[str]

        for param in ("ansi", "unicode_results", "autocommit"):
            if param in keys:
                connect_args[param] = util.asbool(keys.pop(param))

        if "odbc_connect" in keys:
            connectors = [unquote_plus(keys.pop("odbc_connect"))]
        else:

            def check_quote(token: str) -> str:
                if ";" in str(token) or str(token).startswith("{"):
                    token = "{%s}" % token.replace("}", "}}")
                return token

            keys = {k: check_quote(v) for k, v in keys.items()}

            dsn_connection = "dsn" in keys or (
                "host" in keys and "database" not in keys
            )
            if dsn_connection:
                connectors = [
                    "dsn=%s" % (keys.pop("host", "") or keys.pop("dsn", ""))
                ]
            else:
                port = ""
                if "port" in keys and "port" not in query:
                    port = ",%d" % int(keys.pop("port"))

                connectors = []
                driver = keys.pop("driver", self.pyodbc_driver_name)
                if driver is None and keys:
                    # note if keys is empty, this is a totally blank URL
                    util.warn(
                        "No driver name specified; "
                        "this is expected by PyODBC when using "
                        "DSN-less connections"
                    )
                else:
                    connectors.append("DRIVER={%s}" % driver)

                connectors.extend(
                    [
                        "Server=%s%s" % (keys.pop("host", ""), port),
                        "Database=%s" % keys.pop("database", ""),
                    ]
                )

            user = keys.pop("user", None)
            if user:
                connectors.append("UID=%s" % user)
                pwd = keys.pop("password", "")
                if pwd:
                    connectors.append("PWD=%s" % pwd)
            else:
                authentication = keys.pop("authentication", None)
                if authentication:
                    connectors.append("Authentication=%s" % authentication)
                else:
                    connectors.append("Trusted_Connection=Yes")

            # if set to 'Yes', the ODBC layer will try to automagically
            # convert textual data from your database encoding to your
            # client encoding.  This should obviously be set to 'No' if
            # you query a cp1253 encoded database from a latin1 client...
            if "odbc_autotranslate" in keys:
                connectors.append(
                    "AutoTranslate=%s" % keys.pop("odbc_autotranslate")
                )

            connectors.extend(["%s=%s" % (k, v) for k, v in keys.items()])

        return ((";".join(connectors),), connect_args)

    def is_disconnect(
        self,
        e: Exception,
        connection: Optional[
            Union[pool.PoolProxiedConnection, interfaces.DBAPIConnection]
        ],
        cursor: Optional[interfaces.DBAPICursor],
    ) -> bool:
        if isinstance(e, self.dbapi.ProgrammingError):
            return "The cursor's connection has been closed." in str(
                e
            ) or "Attempt to use a closed connection." in str(e)
        else:
            return False

    def _dbapi_version(self) -> interfaces.VersionInfoType:
        if not self.dbapi:
            return ()
        return self._parse_dbapi_version(self.dbapi.version)

    def _parse_dbapi_version(self, vers: str) -> interfaces.VersionInfoType:
        m = re.match(r"(?:py.*-)?([\d\.]+)(?:-(\w+))?", vers)
        if not m:
            return ()
        vers_tuple: interfaces.VersionInfoType = tuple(
            [int(x) for x in m.group(1).split(".")]
        )
        if m.group(2):
            vers_tuple += (m.group(2),)
        return vers_tuple

    def _get_server_version_info(
        self, connection: Connection
    ) -> interfaces.VersionInfoType:
        # NOTE: this function is not reliable, particularly when
        # freetds is in use.   Implement database-specific server version
        # queries.
        dbapi_con = connection.connection.dbapi_connection
        version: Tuple[Union[int, str], ...] = ()
        r = re.compile(r"[.\-]")
        for n in r.split(dbapi_con.getinfo(self.dbapi.SQL_DBMS_VER)):  # type: ignore[union-attr]  # noqa: E501
            try:
                version += (int(n),)
            except ValueError:
                pass
        return tuple(version)

    def do_set_input_sizes(
        self,
        cursor: interfaces.DBAPICursor,
        list_of_tuples: List[Tuple[str, Any, TypeEngine[Any]]],
        context: ExecutionContext,
    ) -> None:
        # the rules for these types seems a little strange, as you can pass
        # non-tuples as well as tuples, however it seems to assume "0"
        # for the subsequent values if you don't pass a tuple which fails
        # for types such as pyodbc.SQL_WLONGVARCHAR, which is the datatype
        # that ticket #5649 is targeting.

        # NOTE: as of #6058, this won't be called if the use_setinputsizes
        # parameter were not passed to the dialect, or if no types were
        # specified in list_of_tuples

        # as of #8177 for 2.0 we assume use_setinputsizes=True and only
        # omit the setinputsizes calls for .executemany() with
        # fast_executemany=True

        if (
            context.execute_style is interfaces.ExecuteStyle.EXECUTEMANY
            and self.fast_executemany
        ):
            return

        cursor.setinputsizes(
            [
                (dbtype, None, None)
                if not isinstance(dbtype, tuple)
                else dbtype
                for key, dbtype, sqltype in list_of_tuples
            ]
        )

    def get_isolation_level_values(
        self, dbapi_connection: interfaces.DBAPIConnection
    ) -> List[IsolationLevel]:
        return super().get_isolation_level_values(dbapi_connection) + [
            "AUTOCOMMIT"
        ]

    def set_isolation_level(
        self,
        dbapi_connection: interfaces.DBAPIConnection,
        level: IsolationLevel,
    ) -> None:
        # adjust for ConnectionFairy being present
        # allows attribute set e.g. "connection.autocommit = True"
        # to work properly

        if level == "AUTOCOMMIT":
            dbapi_connection.autocommit = True
        else:
            dbapi_connection.autocommit = False
            super().set_isolation_level(dbapi_connection, level)
