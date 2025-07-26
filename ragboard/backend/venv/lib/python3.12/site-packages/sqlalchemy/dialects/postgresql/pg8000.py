# dialects/postgresql/pg8000.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors <see AUTHORS
# file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

r"""
.. dialect:: postgresql+pg8000
    :name: pg8000
    :dbapi: pg8000
    :connectstring: postgresql+pg8000://user:password@host:port/dbname[?key=value&key=value...]
    :url: https://pypi.org/project/pg8000/

.. versionchanged:: 1.4  The pg8000 dialect has been updated for version
   1.16.6 and higher, and is again part of SQLAlchemy's continuous integration
   with full feature support.

.. _pg8000_unicode:

Unicode
-------

pg8000 will encode / decode string values between it and the server using the
PostgreSQL ``client_encoding`` parameter; by default this is the value in
the ``postgresql.conf`` file, which often defaults to ``SQL_ASCII``.
Typically, this can be changed to ``utf-8``, as a more useful default::

    #client_encoding = sql_ascii # actually, defaults to database
                                 # encoding
    client_encoding = utf8

The ``client_encoding`` can be overridden for a session by executing the SQL:

SET CLIENT_ENCODING TO 'utf8';

SQLAlchemy will execute this SQL on all new connections based on the value
passed to :func:`_sa.create_engine` using the ``client_encoding`` parameter::

    engine = create_engine(
        "postgresql+pg8000://user:pass@host/dbname", client_encoding='utf8')

.. _pg8000_ssl:

SSL Connections
---------------

pg8000 accepts a Python ``SSLContext`` object which may be specified using the
:paramref:`_sa.create_engine.connect_args` dictionary::

    import ssl
    ssl_context = ssl.create_default_context()
    engine = sa.create_engine(
        "postgresql+pg8000://scott:tiger@192.168.0.199/test",
        connect_args={"ssl_context": ssl_context},
    )

If the server uses an automatically-generated certificate that is self-signed
or does not match the host name (as seen from the client), it may also be
necessary to disable hostname checking::

    import ssl
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    engine = sa.create_engine(
        "postgresql+pg8000://scott:tiger@192.168.0.199/test",
        connect_args={"ssl_context": ssl_context},
    )

.. _pg8000_isolation_level:

pg8000 Transaction Isolation Level
-------------------------------------

The pg8000 dialect offers the same isolation level settings as that
of the :ref:`psycopg2 <psycopg2_isolation_level>` dialect:

* ``READ COMMITTED``
* ``READ UNCOMMITTED``
* ``REPEATABLE READ``
* ``SERIALIZABLE``
* ``AUTOCOMMIT``

.. seealso::

    :ref:`postgresql_isolation_level`

    :ref:`psycopg2_isolation_level`


"""  # noqa
import decimal
import re

from . import ranges
from .array import ARRAY as PGARRAY
from .base import _DECIMAL_TYPES
from .base import _FLOAT_TYPES
from .base import _INT_TYPES
from .base import ENUM
from .base import INTERVAL
from .base import PGCompiler
from .base import PGDialect
from .base import PGExecutionContext
from .base import PGIdentifierPreparer
from .json import JSON
from .json import JSONB
from .json import JSONPathType
from .pg_catalog import _SpaceVector
from .pg_catalog import OIDVECTOR
from .types import CITEXT
from ... import exc
from ... import util
from ...engine import processors
from ...sql import sqltypes
from ...sql.elements import quoted_name


class _PGString(sqltypes.String):
    render_bind_cast = True


class _PGNumeric(sqltypes.Numeric):
    render_bind_cast = True

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


class _PGFloat(_PGNumeric, sqltypes.Float):
    __visit_name__ = "float"
    render_bind_cast = True


class _PGNumericNoBind(_PGNumeric):
    def bind_processor(self, dialect):
        return None


class _PGJSON(JSON):
    render_bind_cast = True

    def result_processor(self, dialect, coltype):
        return None


class _PGJSONB(JSONB):
    render_bind_cast = True

    def result_processor(self, dialect, coltype):
        return None


class _PGJSONIndexType(sqltypes.JSON.JSONIndexType):
    def get_dbapi_type(self, dbapi):
        raise NotImplementedError("should not be here")


class _PGJSONIntIndexType(sqltypes.JSON.JSONIntIndexType):
    __visit_name__ = "json_int_index"

    render_bind_cast = True


class _PGJSONStrIndexType(sqltypes.JSON.JSONStrIndexType):
    __visit_name__ = "json_str_index"

    render_bind_cast = True


class _PGJSONPathType(JSONPathType):
    pass

    # DBAPI type 1009


class _PGEnum(ENUM):
    def get_dbapi_type(self, dbapi):
        return dbapi.UNKNOWN


class _PGInterval(INTERVAL):
    render_bind_cast = True

    def get_dbapi_type(self, dbapi):
        return dbapi.INTERVAL

    @classmethod
    def adapt_emulated_to_native(cls, interval, **kw):
        return _PGInterval(precision=interval.second_precision)


class _PGTimeStamp(sqltypes.DateTime):
    render_bind_cast = True


class _PGDate(sqltypes.Date):
    render_bind_cast = True


class _PGTime(sqltypes.Time):
    render_bind_cast = True


class _PGInteger(sqltypes.Integer):
    render_bind_cast = True


class _PGSmallInteger(sqltypes.SmallInteger):
    render_bind_cast = True


class _PGNullType(sqltypes.NullType):
    pass


class _PGBigInteger(sqltypes.BigInteger):
    render_bind_cast = True


class _PGBoolean(sqltypes.Boolean):
    render_bind_cast = True


class _PGARRAY(PGARRAY):
    render_bind_cast = True


class _PGOIDVECTOR(_SpaceVector, OIDVECTOR):
    pass


class _Pg8000Range(ranges.AbstractRangeImpl):
    def bind_processor(self, dialect):
        pg8000_Range = dialect.dbapi.Range

        def to_range(value):
            if isinstance(value, ranges.Range):
                value = pg8000_Range(
                    value.lower, value.upper, value.bounds, value.empty
                )
            return value

        return to_range

    def result_processor(self, dialect, coltype):
        def to_range(value):
            if value is not None:
                value = ranges.Range(
                    value.lower,
                    value.upper,
                    bounds=value.bounds,
                    empty=value.is_empty,
                )
            return value

        return to_range


class _Pg8000MultiRange(ranges.AbstractMultiRangeImpl):
    def bind_processor(self, dialect):
        pg8000_Range = dialect.dbapi.Range

        def to_multirange(value):
            if isinstance(value, list):
                mr = []
                for v in value:
                    if isinstance(v, ranges.Range):
                        mr.append(
                            pg8000_Range(v.lower, v.upper, v.bounds, v.empty)
                        )
                    else:
                        mr.append(v)
                return mr
            else:
                return value

        return to_multirange

    def result_processor(self, dialect, coltype):
        def to_multirange(value):
            if value is None:
                return None

            mr = []
            for v in value:
                mr.append(
                    ranges.Range(
                        v.lower, v.upper, bounds=v.bounds, empty=v.is_empty
                    )
                )
            return mr

        return to_multirange


_server_side_id = util.counter()


class PGExecutionContext_pg8000(PGExecutionContext):
    def create_server_side_cursor(self):
        ident = "c_%s_%s" % (hex(id(self))[2:], hex(_server_side_id())[2:])
        return ServerSideCursor(self._dbapi_connection.cursor(), ident)

    def pre_exec(self):
        if not self.compiled:
            return


class ServerSideCursor:
    server_side = True

    def __init__(self, cursor, ident):
        self.ident = ident
        self.cursor = cursor

    @property
    def connection(self):
        return self.cursor.connection

    @property
    def rowcount(self):
        return self.cursor.rowcount

    @property
    def description(self):
        return self.cursor.description

    def execute(self, operation, args=(), stream=None):
        op = "DECLARE " + self.ident + " NO SCROLL CURSOR FOR " + operation
        self.cursor.execute(op, args, stream=stream)
        return self

    def executemany(self, operation, param_sets):
        self.cursor.executemany(operation, param_sets)
        return self

    def fetchone(self):
        self.cursor.execute("FETCH FORWARD 1 FROM " + self.ident)
        return self.cursor.fetchone()

    def fetchmany(self, num=None):
        if num is None:
            return self.fetchall()
        else:
            self.cursor.execute(
                "FETCH FORWARD " + str(int(num)) + " FROM " + self.ident
            )
            return self.cursor.fetchall()

    def fetchall(self):
        self.cursor.execute("FETCH FORWARD ALL FROM " + self.ident)
        return self.cursor.fetchall()

    def close(self):
        self.cursor.execute("CLOSE " + self.ident)
        self.cursor.close()

    def setinputsizes(self, *sizes):
        self.cursor.setinputsizes(*sizes)

    def setoutputsize(self, size, column=None):
        pass


class PGCompiler_pg8000(PGCompiler):
    def visit_mod_binary(self, binary, operator, **kw):
        return (
            self.process(binary.left, **kw)
            + " %% "
            + self.process(binary.right, **kw)
        )


class PGIdentifierPreparer_pg8000(PGIdentifierPreparer):
    def __init__(self, *args, **kwargs):
        PGIdentifierPreparer.__init__(self, *args, **kwargs)
        self._double_percents = False


class PGDialect_pg8000(PGDialect):
    driver = "pg8000"
    supports_statement_cache = True

    supports_unicode_statements = True

    supports_unicode_binds = True

    default_paramstyle = "format"
    supports_sane_multi_rowcount = True
    execution_ctx_cls = PGExecutionContext_pg8000
    statement_compiler = PGCompiler_pg8000
    preparer = PGIdentifierPreparer_pg8000
    supports_server_side_cursors = True

    render_bind_cast = True

    # reversed as of pg8000 1.16.6.  1.16.5 and lower
    # are no longer compatible
    description_encoding = None
    # description_encoding = "use_encoding"

    colspecs = util.update_copy(
        PGDialect.colspecs,
        {
            sqltypes.String: _PGString,
            sqltypes.Numeric: _PGNumericNoBind,
            sqltypes.Float: _PGFloat,
            sqltypes.JSON: _PGJSON,
            sqltypes.Boolean: _PGBoolean,
            sqltypes.NullType: _PGNullType,
            JSONB: _PGJSONB,
            CITEXT: CITEXT,
            sqltypes.JSON.JSONPathType: _PGJSONPathType,
            sqltypes.JSON.JSONIndexType: _PGJSONIndexType,
            sqltypes.JSON.JSONIntIndexType: _PGJSONIntIndexType,
            sqltypes.JSON.JSONStrIndexType: _PGJSONStrIndexType,
            sqltypes.Interval: _PGInterval,
            INTERVAL: _PGInterval,
            sqltypes.DateTime: _PGTimeStamp,
            sqltypes.DateTime: _PGTimeStamp,
            sqltypes.Date: _PGDate,
            sqltypes.Time: _PGTime,
            sqltypes.Integer: _PGInteger,
            sqltypes.SmallInteger: _PGSmallInteger,
            sqltypes.BigInteger: _PGBigInteger,
            sqltypes.Enum: _PGEnum,
            sqltypes.ARRAY: _PGARRAY,
            OIDVECTOR: _PGOIDVECTOR,
            ranges.INT4RANGE: _Pg8000Range,
            ranges.INT8RANGE: _Pg8000Range,
            ranges.NUMRANGE: _Pg8000Range,
            ranges.DATERANGE: _Pg8000Range,
            ranges.TSRANGE: _Pg8000Range,
            ranges.TSTZRANGE: _Pg8000Range,
            ranges.INT4MULTIRANGE: _Pg8000MultiRange,
            ranges.INT8MULTIRANGE: _Pg8000MultiRange,
            ranges.NUMMULTIRANGE: _Pg8000MultiRange,
            ranges.DATEMULTIRANGE: _Pg8000MultiRange,
            ranges.TSMULTIRANGE: _Pg8000MultiRange,
            ranges.TSTZMULTIRANGE: _Pg8000MultiRange,
        },
    )

    def __init__(self, client_encoding=None, **kwargs):
        PGDialect.__init__(self, **kwargs)
        self.client_encoding = client_encoding

        if self._dbapi_version < (1, 16, 6):
            raise NotImplementedError("pg8000 1.16.6 or greater is required")

        if self._native_inet_types:
            raise NotImplementedError(
                "The pg8000 dialect does not fully implement "
                "ipaddress type handling; INET is supported by default, "
                "CIDR is not"
            )

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
        return __import__("pg8000")

    def create_connect_args(self, url):
        opts = url.translate_connect_args(username="user")
        if "port" in opts:
            opts["port"] = int(opts["port"])
        opts.update(url.query)
        return ([], opts)

    def is_disconnect(self, e, connection, cursor):
        if isinstance(e, self.dbapi.InterfaceError) and "network error" in str(
            e
        ):
            # new as of pg8000 1.19.0 for broken connections
            return True

        # connection was closed normally
        return "connection is closed" in str(e)

    def get_isolation_level_values(self, dbapi_connection):
        return (
            "AUTOCOMMIT",
            "READ COMMITTED",
            "READ UNCOMMITTED",
            "REPEATABLE READ",
            "SERIALIZABLE",
        )

    def set_isolation_level(self, dbapi_connection, level):
        level = level.replace("_", " ")

        if level == "AUTOCOMMIT":
            dbapi_connection.autocommit = True
        else:
            dbapi_connection.autocommit = False
            cursor = dbapi_connection.cursor()
            cursor.execute(
                "SET SESSION CHARACTERISTICS AS TRANSACTION "
                f"ISOLATION LEVEL {level}"
            )
            cursor.execute("COMMIT")
            cursor.close()

    def set_readonly(self, connection, value):
        cursor = connection.cursor()
        try:
            cursor.execute(
                "SET SESSION CHARACTERISTICS AS TRANSACTION %s"
                % ("READ ONLY" if value else "READ WRITE")
            )
            cursor.execute("COMMIT")
        finally:
            cursor.close()

    def get_readonly(self, connection):
        cursor = connection.cursor()
        try:
            cursor.execute("show transaction_read_only")
            val = cursor.fetchone()[0]
        finally:
            cursor.close()

        return val == "on"

    def set_deferrable(self, connection, value):
        cursor = connection.cursor()
        try:
            cursor.execute(
                "SET SESSION CHARACTERISTICS AS TRANSACTION %s"
                % ("DEFERRABLE" if value else "NOT DEFERRABLE")
            )
            cursor.execute("COMMIT")
        finally:
            cursor.close()

    def get_deferrable(self, connection):
        cursor = connection.cursor()
        try:
            cursor.execute("show transaction_deferrable")
            val = cursor.fetchone()[0]
        finally:
            cursor.close()

        return val == "on"

    def _set_client_encoding(self, dbapi_connection, client_encoding):
        cursor = dbapi_connection.cursor()
        cursor.execute(
            f"""SET CLIENT_ENCODING TO '{
                client_encoding.replace("'", "''")
            }'"""
        )
        cursor.execute("COMMIT")
        cursor.close()

    def do_begin_twophase(self, connection, xid):
        connection.connection.tpc_begin((0, xid, ""))

    def do_prepare_twophase(self, connection, xid):
        connection.connection.tpc_prepare()

    def do_rollback_twophase(
        self, connection, xid, is_prepared=True, recover=False
    ):
        connection.connection.tpc_rollback((0, xid, ""))

    def do_commit_twophase(
        self, connection, xid, is_prepared=True, recover=False
    ):
        connection.connection.tpc_commit((0, xid, ""))

    def do_recover_twophase(self, connection):
        return [row[1] for row in connection.connection.tpc_recover()]

    def on_connect(self):
        fns = []

        def on_connect(conn):
            conn.py_types[quoted_name] = conn.py_types[str]

        fns.append(on_connect)

        if self.client_encoding is not None:

            def on_connect(conn):
                self._set_client_encoding(conn, self.client_encoding)

            fns.append(on_connect)

        if self._native_inet_types is False:

            def on_connect(conn):
                # inet
                conn.register_in_adapter(869, lambda s: s)

                # cidr
                conn.register_in_adapter(650, lambda s: s)

            fns.append(on_connect)

        if self._json_deserializer:

            def on_connect(conn):
                # json
                conn.register_in_adapter(114, self._json_deserializer)

                # jsonb
                conn.register_in_adapter(3802, self._json_deserializer)

            fns.append(on_connect)

        if len(fns) > 0:

            def on_connect(conn):
                for fn in fns:
                    fn(conn)

            return on_connect
        else:
            return None

    @util.memoized_property
    def _dialect_specific_select_one(self):
        return ";"


dialect = PGDialect_pg8000
