# dialects/mysql/cymysql.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

r"""

.. dialect:: mysql+cymysql
    :name: CyMySQL
    :dbapi: cymysql
    :connectstring: mysql+cymysql://<username>:<password>@<host>/<dbname>[?<options>]
    :url: https://github.com/nakagami/CyMySQL

.. note::

    The CyMySQL dialect is **not tested as part of SQLAlchemy's continuous
    integration** and may have unresolved issues.  The recommended MySQL
    dialects are mysqlclient and PyMySQL.

"""  # noqa

from .base import BIT
from .base import MySQLDialect
from .mysqldb import MySQLDialect_mysqldb
from ... import util


class _cymysqlBIT(BIT):
    def result_processor(self, dialect, coltype):
        """Convert MySQL's 64 bit, variable length binary string to a long."""

        def process(value):
            if value is not None:
                v = 0
                for i in iter(value):
                    v = v << 8 | i
                return v
            return value

        return process


class MySQLDialect_cymysql(MySQLDialect_mysqldb):
    driver = "cymysql"
    supports_statement_cache = True

    description_encoding = None
    supports_sane_rowcount = True
    supports_sane_multi_rowcount = False
    supports_unicode_statements = True

    colspecs = util.update_copy(MySQLDialect.colspecs, {BIT: _cymysqlBIT})

    @classmethod
    def import_dbapi(cls):
        return __import__("cymysql")

    def _detect_charset(self, connection):
        return connection.connection.charset

    def _extract_error_code(self, exception):
        return exception.errno

    def is_disconnect(self, e, connection, cursor):
        if isinstance(e, self.dbapi.OperationalError):
            return self._extract_error_code(e) in (
                2006,
                2013,
                2014,
                2045,
                2055,
            )
        elif isinstance(e, self.dbapi.InterfaceError):
            # if underlying connection is closed,
            # this is the error you get
            return True
        else:
            return False


dialect = MySQLDialect_cymysql
