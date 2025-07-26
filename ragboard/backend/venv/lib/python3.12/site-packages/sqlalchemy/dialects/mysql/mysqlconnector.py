# dialects/mysql/mysqlconnector.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors


r"""
.. dialect:: mysql+mysqlconnector
    :name: MySQL Connector/Python
    :dbapi: myconnpy
    :connectstring: mysql+mysqlconnector://<user>:<password>@<host>[:<port>]/<dbname>
    :url: https://pypi.org/project/mysql-connector-python/

.. note::

    The MySQL Connector/Python DBAPI has had many issues since its release,
    some of which may remain unresolved, and the mysqlconnector dialect is
    **not tested as part of SQLAlchemy's continuous integration**.
    The recommended MySQL dialects are mysqlclient and PyMySQL.

"""  # noqa

import re

from .base import BIT
from .base import MySQLCompiler
from .base import MySQLDialect
from .base import MySQLIdentifierPreparer
from ... import util


class MySQLCompiler_mysqlconnector(MySQLCompiler):
    def visit_mod_binary(self, binary, operator, **kw):
        return (
            self.process(binary.left, **kw)
            + " % "
            + self.process(binary.right, **kw)
        )


class MySQLIdentifierPreparer_mysqlconnector(MySQLIdentifierPreparer):
    @property
    def _double_percents(self):
        return False

    @_double_percents.setter
    def _double_percents(self, value):
        pass

    def _escape_identifier(self, value):
        value = value.replace(self.escape_quote, self.escape_to_quote)
        return value


class _myconnpyBIT(BIT):
    def result_processor(self, dialect, coltype):
        """MySQL-connector already converts mysql bits, so."""

        return None


class MySQLDialect_mysqlconnector(MySQLDialect):
    driver = "mysqlconnector"
    supports_statement_cache = True

    supports_sane_rowcount = True
    supports_sane_multi_rowcount = True

    supports_native_decimal = True

    default_paramstyle = "format"
    statement_compiler = MySQLCompiler_mysqlconnector

    preparer = MySQLIdentifierPreparer_mysqlconnector

    colspecs = util.update_copy(MySQLDialect.colspecs, {BIT: _myconnpyBIT})

    @classmethod
    def import_dbapi(cls):
        from mysql import connector

        return connector

    def do_ping(self, dbapi_connection):
        dbapi_connection.ping(False)
        return True

    def create_connect_args(self, url):
        opts = url.translate_connect_args(username="user")

        opts.update(url.query)

        util.coerce_kw_type(opts, "allow_local_infile", bool)
        util.coerce_kw_type(opts, "autocommit", bool)
        util.coerce_kw_type(opts, "buffered", bool)
        util.coerce_kw_type(opts, "compress", bool)
        util.coerce_kw_type(opts, "connection_timeout", int)
        util.coerce_kw_type(opts, "connect_timeout", int)
        util.coerce_kw_type(opts, "consume_results", bool)
        util.coerce_kw_type(opts, "force_ipv6", bool)
        util.coerce_kw_type(opts, "get_warnings", bool)
        util.coerce_kw_type(opts, "pool_reset_session", bool)
        util.coerce_kw_type(opts, "pool_size", int)
        util.coerce_kw_type(opts, "raise_on_warnings", bool)
        util.coerce_kw_type(opts, "raw", bool)
        util.coerce_kw_type(opts, "ssl_verify_cert", bool)
        util.coerce_kw_type(opts, "use_pure", bool)
        util.coerce_kw_type(opts, "use_unicode", bool)

        # unfortunately, MySQL/connector python refuses to release a
        # cursor without reading fully, so non-buffered isn't an option
        opts.setdefault("buffered", True)

        # FOUND_ROWS must be set in ClientFlag to enable
        # supports_sane_rowcount.
        if self.dbapi is not None:
            try:
                from mysql.connector.constants import ClientFlag

                client_flags = opts.get(
                    "client_flags", ClientFlag.get_default()
                )
                client_flags |= ClientFlag.FOUND_ROWS
                opts["client_flags"] = client_flags
            except Exception:
                pass
        return [[], opts]

    @util.memoized_property
    def _mysqlconnector_version_info(self):
        if self.dbapi and hasattr(self.dbapi, "__version__"):
            m = re.match(r"(\d+)\.(\d+)(?:\.(\d+))?", self.dbapi.__version__)
            if m:
                return tuple(int(x) for x in m.group(1, 2, 3) if x is not None)

    def _detect_charset(self, connection):
        return connection.connection.charset

    def _extract_error_code(self, exception):
        return exception.errno

    def is_disconnect(self, e, connection, cursor):
        errnos = (2006, 2013, 2014, 2045, 2055, 2048)
        exceptions = (self.dbapi.OperationalError, self.dbapi.InterfaceError)
        if isinstance(e, exceptions):
            return (
                e.errno in errnos
                or "MySQL Connection not available." in str(e)
                or "Connection to MySQL is not available" in str(e)
            )
        else:
            return False

    def _compat_fetchall(self, rp, charset=None):
        return rp.fetchall()

    def _compat_fetchone(self, rp, charset=None):
        return rp.fetchone()

    _isolation_lookup = {
        "SERIALIZABLE",
        "READ UNCOMMITTED",
        "READ COMMITTED",
        "REPEATABLE READ",
        "AUTOCOMMIT",
    }

    def _set_isolation_level(self, connection, level):
        if level == "AUTOCOMMIT":
            connection.autocommit = True
        else:
            connection.autocommit = False
            super()._set_isolation_level(connection, level)


dialect = MySQLDialect_mysqlconnector
