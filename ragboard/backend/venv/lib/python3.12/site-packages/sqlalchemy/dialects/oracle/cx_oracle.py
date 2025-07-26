# dialects/oracle/cx_oracle.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors


r"""
.. dialect:: oracle+cx_oracle
    :name: cx-Oracle
    :dbapi: cx_oracle
    :connectstring: oracle+cx_oracle://user:pass@hostname:port[/dbname][?service_name=<service>[&key=value&key=value...]]
    :url: https://oracle.github.io/python-cx_Oracle/

DSN vs. Hostname connections
-----------------------------

cx_Oracle provides several methods of indicating the target database.  The
dialect translates from a series of different URL forms.

Hostname Connections with Easy Connect Syntax
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

Given a hostname, port and service name of the target Oracle Database, for
example from Oracle's `Easy Connect syntax
<https://cx-oracle.readthedocs.io/en/latest/user_guide/connection_handling.html#easy-connect-syntax-for-connection-strings>`_,
then connect in SQLAlchemy using the ``service_name`` query string parameter::

    engine = create_engine("oracle+cx_oracle://scott:tiger@hostname:port/?service_name=myservice&encoding=UTF-8&nencoding=UTF-8")

The `full Easy Connect syntax
<https://www.oracle.com/pls/topic/lookup?ctx=dblatest&id=GUID-B0437826-43C1-49EC-A94D-B650B6A4A6EE>`_
is not supported.  Instead, use a ``tnsnames.ora`` file and connect using a
DSN.

Connections with tnsnames.ora or Oracle Cloud
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

Alternatively, if no port, database name, or ``service_name`` is provided, the
dialect will use an Oracle DSN "connection string".  This takes the "hostname"
portion of the URL as the data source name.  For example, if the
``tnsnames.ora`` file contains a `Net Service Name
<https://cx-oracle.readthedocs.io/en/latest/user_guide/connection_handling.html#net-service-names-for-connection-strings>`_
of ``myalias`` as below::

    myalias =
      (DESCRIPTION =
        (ADDRESS = (PROTOCOL = TCP)(HOST = mymachine.example.com)(PORT = 1521))
        (CONNECT_DATA =
          (SERVER = DEDICATED)
          (SERVICE_NAME = orclpdb1)
        )
      )

The cx_Oracle dialect connects to this database service when ``myalias`` is the
hostname portion of the URL, without specifying a port, database name or
``service_name``::

    engine = create_engine("oracle+cx_oracle://scott:tiger@myalias/?encoding=UTF-8&nencoding=UTF-8")

Users of Oracle Cloud should use this syntax and also configure the cloud
wallet as shown in cx_Oracle documentation `Connecting to Autononmous Databases
<https://cx-oracle.readthedocs.io/en/latest/user_guide/connection_handling.html#connecting-to-autononmous-databases>`_.

SID Connections
^^^^^^^^^^^^^^^

To use Oracle's obsolete SID connection syntax, the SID can be passed in a
"database name" portion of the URL as below::

    engine = create_engine("oracle+cx_oracle://scott:tiger@hostname:1521/dbname?encoding=UTF-8&nencoding=UTF-8")

Above, the DSN passed to cx_Oracle is created by ``cx_Oracle.makedsn()`` as
follows::

    >>> import cx_Oracle
    >>> cx_Oracle.makedsn("hostname", 1521, sid="dbname")
    '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=hostname)(PORT=1521))(CONNECT_DATA=(SID=dbname)))'

Passing cx_Oracle connect arguments
-----------------------------------

Additional connection arguments can usually be passed via the URL
query string; particular symbols like ``cx_Oracle.SYSDBA`` are intercepted
and converted to the correct symbol::

    e = create_engine(
        "oracle+cx_oracle://user:pass@dsn?encoding=UTF-8&nencoding=UTF-8&mode=SYSDBA&events=true")

.. versionchanged:: 1.3 the cx_oracle dialect now accepts all argument names
   within the URL string itself, to be passed to the cx_Oracle DBAPI.   As
   was the case earlier but not correctly documented, the
   :paramref:`_sa.create_engine.connect_args` parameter also accepts all
   cx_Oracle DBAPI connect arguments.

To pass arguments directly to ``.connect()`` without using the query
string, use the :paramref:`_sa.create_engine.connect_args` dictionary.
Any cx_Oracle parameter value and/or constant may be passed, such as::

    import cx_Oracle
    e = create_engine(
        "oracle+cx_oracle://user:pass@dsn",
        connect_args={
            "encoding": "UTF-8",
            "nencoding": "UTF-8",
            "mode": cx_Oracle.SYSDBA,
            "events": True
        }
    )

Note that the default value for ``encoding`` and ``nencoding`` was changed to
"UTF-8" in cx_Oracle 8.0 so these parameters can be omitted when using that
version, or later.

Options consumed by the SQLAlchemy cx_Oracle dialect outside of the driver
--------------------------------------------------------------------------

There are also options that are consumed by the SQLAlchemy cx_oracle dialect
itself.  These options are always passed directly to :func:`_sa.create_engine`
, such as::

    e = create_engine(
        "oracle+cx_oracle://user:pass@dsn", coerce_to_decimal=False)

The parameters accepted by the cx_oracle dialect are as follows:

* ``arraysize`` - set the cx_oracle.arraysize value on cursors, defaulted
  to 50.  This setting is significant with cx_Oracle as the contents of LOB
  objects are only readable within a "live" row (e.g. within a batch of
  50 rows).

* ``auto_convert_lobs`` - defaults to True; See :ref:`cx_oracle_lob`.

* ``coerce_to_decimal`` - see :ref:`cx_oracle_numeric` for detail.

* ``encoding_errors`` - see :ref:`cx_oracle_unicode_encoding_errors` for detail.

.. _cx_oracle_sessionpool:

Using cx_Oracle SessionPool
---------------------------

The cx_Oracle library provides its own connection pool implementation that may
be used in place of SQLAlchemy's pooling functionality.  This can be achieved
by using the :paramref:`_sa.create_engine.creator` parameter to provide a
function that returns a new connection, along with setting
:paramref:`_sa.create_engine.pool_class` to ``NullPool`` to disable
SQLAlchemy's pooling::

    import cx_Oracle
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    pool = cx_Oracle.SessionPool(
        user="scott", password="tiger", dsn="orclpdb",
        min=2, max=5, increment=1, threaded=True,
	encoding="UTF-8", nencoding="UTF-8"
    )

    engine = create_engine("oracle+cx_oracle://", creator=pool.acquire, poolclass=NullPool)

The above engine may then be used normally where cx_Oracle's pool handles
connection pooling::

    with engine.connect() as conn:
        print(conn.scalar("select 1 FROM dual"))


As well as providing a scalable solution for multi-user applications, the
cx_Oracle session pool supports some Oracle features such as DRCP and
`Application Continuity
<https://cx-oracle.readthedocs.io/en/latest/user_guide/ha.html#application-continuity-ac>`_.

Using Oracle Database Resident Connection Pooling (DRCP)
--------------------------------------------------------

When using Oracle's `DRCP
<https://www.oracle.com/pls/topic/lookup?ctx=dblatest&id=GUID-015CA8C1-2386-4626-855D-CC546DDC1086>`_,
the best practice is to pass a connection class and "purity" when acquiring a
connection from the SessionPool.  Refer to the `cx_Oracle DRCP documentation
<https://cx-oracle.readthedocs.io/en/latest/user_guide/connection_handling.html#database-resident-connection-pooling-drcp>`_.

This can be achieved by wrapping ``pool.acquire()``::

    import cx_Oracle
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    pool = cx_Oracle.SessionPool(
        user="scott", password="tiger", dsn="orclpdb",
        min=2, max=5, increment=1, threaded=True,
	encoding="UTF-8", nencoding="UTF-8"
    )

    def creator():
        return pool.acquire(cclass="MYCLASS", purity=cx_Oracle.ATTR_PURITY_SELF)

    engine = create_engine("oracle+cx_oracle://", creator=creator, poolclass=NullPool)

The above engine may then be used normally where cx_Oracle handles session
pooling and Oracle Database additionally uses DRCP::

    with engine.connect() as conn:
        print(conn.scalar("select 1 FROM dual"))

.. _cx_oracle_unicode:

Unicode
-------

As is the case for all DBAPIs under Python 3, all strings are inherently
Unicode strings.   In all cases however, the driver requires an explicit
encoding configuration.

Ensuring the Correct Client Encoding
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

The long accepted standard for establishing client encoding for nearly all
Oracle related software is via the `NLS_LANG <https://www.oracle.com/database/technologies/faq-nls-lang.html>`_
environment variable.   cx_Oracle like most other Oracle drivers will use
this environment variable as the source of its encoding configuration.  The
format of this variable is idiosyncratic; a typical value would be
``AMERICAN_AMERICA.AL32UTF8``.

The cx_Oracle driver also supports a programmatic alternative which is to
pass the ``encoding`` and ``nencoding`` parameters directly to its
``.connect()`` function.  These can be present in the URL as follows::

    engine = create_engine("oracle+cx_oracle://scott:tiger@orclpdb/?encoding=UTF-8&nencoding=UTF-8")

For the meaning of the ``encoding`` and ``nencoding`` parameters, please
consult
`Characters Sets and National Language Support (NLS) <https://cx-oracle.readthedocs.io/en/latest/user_guide/globalization.html#globalization>`_.

.. seealso::

    `Characters Sets and National Language Support (NLS) <https://cx-oracle.readthedocs.io/en/latest/user_guide/globalization.html#globalization>`_
    - in the cx_Oracle documentation.


Unicode-specific Column datatypes
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

The Core expression language handles unicode data by use of the :class:`.Unicode`
and :class:`.UnicodeText`
datatypes.  These types correspond to the  VARCHAR2 and CLOB Oracle datatypes by
default.   When using these datatypes with Unicode data, it is expected that
the Oracle database is configured with a Unicode-aware character set, as well
as that the ``NLS_LANG`` environment variable is set appropriately, so that
the VARCHAR2 and CLOB datatypes can accommodate the data.

In the case that the Oracle database is not configured with a Unicode character
set, the two options are to use the :class:`_types.NCHAR` and
:class:`_oracle.NCLOB` datatypes explicitly, or to pass the flag
``use_nchar_for_unicode=True`` to :func:`_sa.create_engine`,
which will cause the
SQLAlchemy dialect to use NCHAR/NCLOB for the :class:`.Unicode` /
:class:`.UnicodeText` datatypes instead of VARCHAR/CLOB.

.. versionchanged:: 1.3  The :class:`.Unicode` and :class:`.UnicodeText`
   datatypes now correspond to the ``VARCHAR2`` and ``CLOB`` Oracle datatypes
   unless the ``use_nchar_for_unicode=True`` is passed to the dialect
   when :func:`_sa.create_engine` is called.


.. _cx_oracle_unicode_encoding_errors:

Encoding Errors
^^^^^^^^^^^^^^^

For the unusual case that data in the Oracle database is present with a broken
encoding, the dialect accepts a parameter ``encoding_errors`` which will be
passed to Unicode decoding functions in order to affect how decoding errors are
handled.  The value is ultimately consumed by the Python `decode
<https://docs.python.org/3/library/stdtypes.html#bytes.decode>`_ function, and
is passed both via cx_Oracle's ``encodingErrors`` parameter consumed by
``Cursor.var()``, as well as SQLAlchemy's own decoding function, as the
cx_Oracle dialect makes use of both under different circumstances.

.. versionadded:: 1.3.11


.. _cx_oracle_setinputsizes:

Fine grained control over cx_Oracle data binding performance with setinputsizes
-------------------------------------------------------------------------------

The cx_Oracle DBAPI has a deep and fundamental reliance upon the usage of the
DBAPI ``setinputsizes()`` call.   The purpose of this call is to establish the
datatypes that are bound to a SQL statement for Python values being passed as
parameters.  While virtually no other DBAPI assigns any use to the
``setinputsizes()`` call, the cx_Oracle DBAPI relies upon it heavily in its
interactions with the Oracle client interface, and in some scenarios it is  not
possible for SQLAlchemy to know exactly how data should be bound, as some
settings can cause profoundly different performance characteristics, while
altering the type coercion behavior at the same time.

Users of the cx_Oracle dialect are **strongly encouraged** to read through
cx_Oracle's list of built-in datatype symbols at
https://cx-oracle.readthedocs.io/en/latest/api_manual/module.html#database-types.
Note that in some cases, significant performance degradation can occur when
using these types vs. not, in particular when specifying ``cx_Oracle.CLOB``.

On the SQLAlchemy side, the :meth:`.DialectEvents.do_setinputsizes` event can
be used both for runtime visibility (e.g. logging) of the setinputsizes step as
well as to fully control how ``setinputsizes()`` is used on a per-statement
basis.

.. versionadded:: 1.2.9 Added :meth:`.DialectEvents.setinputsizes`


Example 1 - logging all setinputsizes calls
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

The following example illustrates how to log the intermediary values from a
SQLAlchemy perspective before they are converted to the raw ``setinputsizes()``
parameter dictionary.  The keys of the dictionary are :class:`.BindParameter`
objects which have a ``.key`` and a ``.type`` attribute::

    from sqlalchemy import create_engine, event

    engine = create_engine("oracle+cx_oracle://scott:tiger@host/xe")

    @event.listens_for(engine, "do_setinputsizes")
    def _log_setinputsizes(inputsizes, cursor, statement, parameters, context):
        for bindparam, dbapitype in inputsizes.items():
                log.info(
                    "Bound parameter name: %s  SQLAlchemy type: %r  "
                    "DBAPI object: %s",
                    bindparam.key, bindparam.type, dbapitype)

Example 2 - remove all bindings to CLOB
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

The ``CLOB`` datatype in cx_Oracle incurs a significant performance overhead,
however is set by default for the ``Text`` type within the SQLAlchemy 1.2
series.   This setting can be modified as follows::

    from sqlalchemy import create_engine, event
    from cx_Oracle import CLOB

    engine = create_engine("oracle+cx_oracle://scott:tiger@host/xe")

    @event.listens_for(engine, "do_setinputsizes")
    def _remove_clob(inputsizes, cursor, statement, parameters, context):
        for bindparam, dbapitype in list(inputsizes.items()):
            if dbapitype is CLOB:
                del inputsizes[bindparam]

.. _cx_oracle_returning:

RETURNING Support
-----------------

The cx_Oracle dialect implements RETURNING using OUT parameters.
The dialect supports RETURNING fully.

.. _cx_oracle_lob:

LOB Datatypes
--------------

LOB datatypes refer to the "large object" datatypes such as CLOB, NCLOB and
BLOB. Modern versions of cx_Oracle and oracledb are optimized for these
datatypes to be delivered as a single buffer. As such, SQLAlchemy makes use of
these newer type handlers by default.

To disable the use of newer type handlers and deliver LOB objects as classic
buffered objects with a ``read()`` method, the parameter
``auto_convert_lobs=False`` may be passed to :func:`_sa.create_engine`,
which takes place only engine-wide.

Two Phase Transactions Not Supported
-------------------------------------

Two phase transactions are **not supported** under cx_Oracle due to poor
driver support.   As of cx_Oracle 6.0b1, the interface for
two phase transactions has been changed to be more of a direct pass-through
to the underlying OCI layer with less automation.  The additional logic
to support this system is not implemented in SQLAlchemy.

.. _cx_oracle_numeric:

Precision Numerics
------------------

SQLAlchemy's numeric types can handle receiving and returning values as Python
``Decimal`` objects or float objects.  When a :class:`.Numeric` object, or a
subclass such as :class:`.Float`, :class:`_oracle.DOUBLE_PRECISION` etc. is in
use, the :paramref:`.Numeric.asdecimal` flag determines if values should be
coerced to ``Decimal`` upon return, or returned as float objects.   To make
matters more complicated under Oracle, Oracle's ``NUMBER`` type can also
represent integer values if the "scale" is zero, so the Oracle-specific
:class:`_oracle.NUMBER` type takes this into account as well.

The cx_Oracle dialect makes extensive use of connection- and cursor-level
"outputtypehandler" callables in order to coerce numeric values as requested.
These callables are specific to the specific flavor of :class:`.Numeric` in
use, as well as if no SQLAlchemy typing objects are present.   There are
observed scenarios where Oracle may sends incomplete or ambiguous information
about the numeric types being returned, such as a query where the numeric types
are buried under multiple levels of subquery.  The type handlers do their best
to make the right decision in all cases, deferring to the underlying cx_Oracle
DBAPI for all those cases where the driver can make the best decision.

When no typing objects are present, as when executing plain SQL strings, a
default "outputtypehandler" is present which will generally return numeric
values which specify precision and scale as Python ``Decimal`` objects.  To
disable this coercion to decimal for performance reasons, pass the flag
``coerce_to_decimal=False`` to :func:`_sa.create_engine`::

    engine = create_engine("oracle+cx_oracle://dsn", coerce_to_decimal=False)

The ``coerce_to_decimal`` flag only impacts the results of plain string
SQL statements that are not otherwise associated with a :class:`.Numeric`
SQLAlchemy type (or a subclass of such).

.. versionchanged:: 1.2  The numeric handling system for cx_Oracle has been
   reworked to take advantage of newer cx_Oracle features as well
   as better integration of outputtypehandlers.

"""  # noqa
from __future__ import annotations

import decimal
import random
import re

from . import base as oracle
from .base import OracleCompiler
from .base import OracleDialect
from .base import OracleExecutionContext
from .types import _OracleDateLiteralRender
from ... import exc
from ... import util
from ...engine import cursor as _cursor
from ...engine import interfaces
from ...engine import processors
from ...sql import sqltypes
from ...sql._typing import is_sql_compiler

# source:
# https://github.com/oracle/python-cx_Oracle/issues/596#issuecomment-999243649
_CX_ORACLE_MAGIC_LOB_SIZE = 131072


class _OracleInteger(sqltypes.Integer):
    def get_dbapi_type(self, dbapi):
        # see https://github.com/oracle/python-cx_Oracle/issues/
        # 208#issuecomment-409715955
        return int

    def _cx_oracle_var(self, dialect, cursor, arraysize=None):
        cx_Oracle = dialect.dbapi
        return cursor.var(
            cx_Oracle.STRING,
            255,
            arraysize=arraysize if arraysize is not None else cursor.arraysize,
            outconverter=int,
        )

    def _cx_oracle_outputtypehandler(self, dialect):
        def handler(cursor, name, default_type, size, precision, scale):
            return self._cx_oracle_var(dialect, cursor)

        return handler


class _OracleNumeric(sqltypes.Numeric):
    is_number = False

    def bind_processor(self, dialect):
        if self.scale == 0:
            return None
        elif self.asdecimal:
            processor = processors.to_decimal_processor_factory(
                decimal.Decimal, self._effective_decimal_return_scale
            )

            def process(value):
                if isinstance(value, (int, float)):
                    return processor(value)
                elif value is not None and value.is_infinite():
                    return float(value)
                else:
                    return value

            return process
        else:
            return processors.to_float

    def result_processor(self, dialect, coltype):
        return None

    def _cx_oracle_outputtypehandler(self, dialect):
        cx_Oracle = dialect.dbapi

        def handler(cursor, name, default_type, size, precision, scale):
            outconverter = None

            if precision:
                if self.asdecimal:
                    if default_type == cx_Oracle.NATIVE_FLOAT:
                        # receiving float and doing Decimal after the fact
                        # allows for float("inf") to be handled
                        type_ = default_type
                        outconverter = decimal.Decimal
                    else:
                        type_ = decimal.Decimal
                else:
                    if self.is_number and scale == 0:
                        # integer. cx_Oracle is observed to handle the widest
                        # variety of ints when no directives are passed,
                        # from 5.2 to 7.0.  See [ticket:4457]
                        return None
                    else:
                        type_ = cx_Oracle.NATIVE_FLOAT

            else:
                if self.asdecimal:
                    if default_type == cx_Oracle.NATIVE_FLOAT:
                        type_ = default_type
                        outconverter = decimal.Decimal
                    else:
                        type_ = decimal.Decimal
                else:
                    if self.is_number and scale == 0:
                        # integer. cx_Oracle is observed to handle the widest
                        # variety of ints when no directives are passed,
                        # from 5.2 to 7.0.  See [ticket:4457]
                        return None
                    else:
                        type_ = cx_Oracle.NATIVE_FLOAT

            return cursor.var(
                type_,
                255,
                arraysize=cursor.arraysize,
                outconverter=outconverter,
            )

        return handler


class _OracleUUID(sqltypes.Uuid):
    def get_dbapi_type(self, dbapi):
        return dbapi.STRING


class _OracleBinaryFloat(_OracleNumeric):
    def get_dbapi_type(self, dbapi):
        return dbapi.NATIVE_FLOAT


class _OracleBINARY_FLOAT(_OracleBinaryFloat, oracle.BINARY_FLOAT):
    pass


class _OracleBINARY_DOUBLE(_OracleBinaryFloat, oracle.BINARY_DOUBLE):
    pass


class _OracleNUMBER(_OracleNumeric):
    is_number = True


class _CXOracleDate(oracle._OracleDate):
    def bind_processor(self, dialect):
        return None

    def result_processor(self, dialect, coltype):
        def process(value):
            if value is not None:
                return value.date()
            else:
                return value

        return process


class _CXOracleTIMESTAMP(_OracleDateLiteralRender, sqltypes.TIMESTAMP):
    def literal_processor(self, dialect):
        return self._literal_processor_datetime(dialect)


class _LOBDataType:
    pass


# TODO: the names used across CHAR / VARCHAR / NCHAR / NVARCHAR
# here are inconsistent and not very good
class _OracleChar(sqltypes.CHAR):
    def get_dbapi_type(self, dbapi):
        return dbapi.FIXED_CHAR


class _OracleNChar(sqltypes.NCHAR):
    def get_dbapi_type(self, dbapi):
        return dbapi.FIXED_NCHAR


class _OracleUnicodeStringNCHAR(oracle.NVARCHAR2):
    def get_dbapi_type(self, dbapi):
        return dbapi.NCHAR


class _OracleUnicodeStringCHAR(sqltypes.Unicode):
    def get_dbapi_type(self, dbapi):
        return dbapi.LONG_STRING


class _OracleUnicodeTextNCLOB(_LOBDataType, oracle.NCLOB):
    def get_dbapi_type(self, dbapi):
        # previously, this was dbapi.NCLOB.
        # DB_TYPE_NVARCHAR will instead be passed to setinputsizes()
        # when this datatype is used.
        return dbapi.DB_TYPE_NVARCHAR


class _OracleUnicodeTextCLOB(_LOBDataType, sqltypes.UnicodeText):
    def get_dbapi_type(self, dbapi):
        # previously, this was dbapi.CLOB.
        # DB_TYPE_NVARCHAR will instead be passed to setinputsizes()
        # when this datatype is used.
        return dbapi.DB_TYPE_NVARCHAR


class _OracleText(_LOBDataType, sqltypes.Text):
    def get_dbapi_type(self, dbapi):
        # previously, this was dbapi.CLOB.
        # DB_TYPE_NVARCHAR will instead be passed to setinputsizes()
        # when this datatype is used.
        return dbapi.DB_TYPE_NVARCHAR


class _OracleLong(_LOBDataType, oracle.LONG):
    def get_dbapi_type(self, dbapi):
        return dbapi.LONG_STRING


class _OracleString(sqltypes.String):
    pass


class _OracleEnum(sqltypes.Enum):
    def bind_processor(self, dialect):
        enum_proc = sqltypes.Enum.bind_processor(self, dialect)

        def process(value):
            raw_str = enum_proc(value)
            return raw_str

        return process


class _OracleBinary(_LOBDataType, sqltypes.LargeBinary):
    def get_dbapi_type(self, dbapi):
        # previously, this was dbapi.BLOB.
        # DB_TYPE_RAW will instead be passed to setinputsizes()
        # when this datatype is used.
        return dbapi.DB_TYPE_RAW

    def bind_processor(self, dialect):
        return None

    def result_processor(self, dialect, coltype):
        if not dialect.auto_convert_lobs:
            return None
        else:
            return super().result_processor(dialect, coltype)


class _OracleInterval(oracle.INTERVAL):
    def get_dbapi_type(self, dbapi):
        return dbapi.INTERVAL


class _OracleRaw(oracle.RAW):
    pass


class _OracleRowid(oracle.ROWID):
    def get_dbapi_type(self, dbapi):
        return dbapi.ROWID


class OracleCompiler_cx_oracle(OracleCompiler):
    _oracle_cx_sql_compiler = True

    _oracle_returning = False

    # Oracle bind names can't start with digits or underscores.
    # currently we rely upon Oracle-specific quoting of bind names in most
    # cases.  however for expanding params, the escape chars are used.
    # see #8708
    bindname_escape_characters = util.immutabledict(
        {
            "%": "P",
            "(": "A",
            ")": "Z",
            ":": "C",
            ".": "C",
            "[": "C",
            "]": "C",
            " ": "C",
            "\\": "C",
            "/": "C",
            "?": "C",
        }
    )

    def bindparam_string(self, name, **kw):
        quote = getattr(name, "quote", None)
        if (
            quote is True
            or quote is not False
            and self.preparer._bindparam_requires_quotes(name)
            # bind param quoting for Oracle doesn't work with post_compile
            # params.  For those, the default bindparam_string will escape
            # special chars, and the appending of a number "_1" etc. will
            # take care of reserved words
            and not kw.get("post_compile", False)
        ):
            # interesting to note about expanding parameters - since the
            # new parameters take the form <paramname>_<int>, at least if
            # they are originally formed from reserved words, they no longer
            # need quoting :).    names that include illegal characters
            # won't work however.
            quoted_name = '"%s"' % name
            kw["escaped_from"] = name
            name = quoted_name
            return OracleCompiler.bindparam_string(self, name, **kw)

        # TODO: we could likely do away with quoting altogether for
        # Oracle parameters and use the custom escaping here
        escaped_from = kw.get("escaped_from", None)
        if not escaped_from:
            if self._bind_translate_re.search(name):
                # not quite the translate use case as we want to
                # also get a quick boolean if we even found
                # unusual characters in the name
                new_name = self._bind_translate_re.sub(
                    lambda m: self._bind_translate_chars[m.group(0)],
                    name,
                )
                if new_name[0].isdigit() or new_name[0] == "_":
                    new_name = "D" + new_name
                kw["escaped_from"] = name
                name = new_name
            elif name[0].isdigit() or name[0] == "_":
                new_name = "D" + name
                kw["escaped_from"] = name
                name = new_name

        return OracleCompiler.bindparam_string(self, name, **kw)


class OracleExecutionContext_cx_oracle(OracleExecutionContext):
    out_parameters = None

    def _generate_out_parameter_vars(self):
        # check for has_out_parameters or RETURNING, create cx_Oracle.var
        # objects if so
        if self.compiled.has_out_parameters or self.compiled._oracle_returning:
            out_parameters = self.out_parameters
            assert out_parameters is not None

            len_params = len(self.parameters)

            quoted_bind_names = self.compiled.escaped_bind_names
            for bindparam in self.compiled.binds.values():
                if bindparam.isoutparam:
                    name = self.compiled.bind_names[bindparam]
                    type_impl = bindparam.type.dialect_impl(self.dialect)

                    if hasattr(type_impl, "_cx_oracle_var"):
                        out_parameters[name] = type_impl._cx_oracle_var(
                            self.dialect, self.cursor, arraysize=len_params
                        )
                    else:
                        dbtype = type_impl.get_dbapi_type(self.dialect.dbapi)

                        cx_Oracle = self.dialect.dbapi

                        assert cx_Oracle is not None

                        if dbtype is None:
                            raise exc.InvalidRequestError(
                                "Cannot create out parameter for "
                                "parameter "
                                "%r - its type %r is not supported by"
                                " cx_oracle" % (bindparam.key, bindparam.type)
                            )

                        # note this is an OUT parameter.   Using
                        # non-LOB datavalues with large unicode-holding
                        # values causes the failure (both cx_Oracle and
                        # oracledb):
                        # ORA-22835: Buffer too small for CLOB to CHAR or
                        # BLOB to RAW conversion (actual: 16507,
                        # maximum: 4000)
                        # [SQL: INSERT INTO long_text (x, y, z) VALUES
                        # (:x, :y, :z) RETURNING long_text.x, long_text.y,
                        # long_text.z INTO :ret_0, :ret_1, :ret_2]
                        # so even for DB_TYPE_NVARCHAR we convert to a LOB

                        if isinstance(type_impl, _LOBDataType):
                            if dbtype == cx_Oracle.DB_TYPE_NVARCHAR:
                                dbtype = cx_Oracle.NCLOB
                            elif dbtype == cx_Oracle.DB_TYPE_RAW:
                                dbtype = cx_Oracle.BLOB
                            # other LOB types go in directly

                            out_parameters[name] = self.cursor.var(
                                dbtype,
                                # this is fine also in oracledb_async since
                                # the driver will await the read coroutine
                                outconverter=lambda value: value.read(),
                                arraysize=len_params,
                            )
                        elif (
                            isinstance(type_impl, _OracleNumeric)
                            and type_impl.asdecimal
                        ):
                            out_parameters[name] = self.cursor.var(
                                decimal.Decimal,
                                arraysize=len_params,
                            )

                        else:
                            out_parameters[name] = self.cursor.var(
                                dbtype, arraysize=len_params
                            )

                    for param in self.parameters:
                        param[
                            quoted_bind_names.get(name, name)
                        ] = out_parameters[name]

    def _generate_cursor_outputtype_handler(self):
        output_handlers = {}

        for keyname, name, objects, type_ in self.compiled._result_columns:
            handler = type_._cached_custom_processor(
                self.dialect,
                "cx_oracle_outputtypehandler",
                self._get_cx_oracle_type_handler,
            )

            if handler:
                denormalized_name = self.dialect.denormalize_name(keyname)
                output_handlers[denormalized_name] = handler

        if output_handlers:
            default_handler = self._dbapi_connection.outputtypehandler

            def output_type_handler(
                cursor, name, default_type, size, precision, scale
            ):
                if name in output_handlers:
                    return output_handlers[name](
                        cursor, name, default_type, size, precision, scale
                    )
                else:
                    return default_handler(
                        cursor, name, default_type, size, precision, scale
                    )

            self.cursor.outputtypehandler = output_type_handler

    def _get_cx_oracle_type_handler(self, impl):
        if hasattr(impl, "_cx_oracle_outputtypehandler"):
            return impl._cx_oracle_outputtypehandler(self.dialect)
        else:
            return None

    def pre_exec(self):
        super().pre_exec()
        if not getattr(self.compiled, "_oracle_cx_sql_compiler", False):
            return

        self.out_parameters = {}

        self._generate_out_parameter_vars()

        self._generate_cursor_outputtype_handler()

    def post_exec(self):
        if (
            self.compiled
            and is_sql_compiler(self.compiled)
            and self.compiled._oracle_returning
        ):
            initial_buffer = self.fetchall_for_returning(
                self.cursor, _internal=True
            )

            fetch_strategy = _cursor.FullyBufferedCursorFetchStrategy(
                self.cursor,
                [
                    (entry.keyname, None)
                    for entry in self.compiled._result_columns
                ],
                initial_buffer=initial_buffer,
            )

            self.cursor_fetch_strategy = fetch_strategy

    def create_cursor(self):
        c = self._dbapi_connection.cursor()
        if self.dialect.arraysize:
            c.arraysize = self.dialect.arraysize

        return c

    def fetchall_for_returning(self, cursor, *, _internal=False):
        compiled = self.compiled
        if (
            not _internal
            and compiled is None
            or not is_sql_compiler(compiled)
            or not compiled._oracle_returning
        ):
            raise NotImplementedError(
                "execution context was not prepared for Oracle RETURNING"
            )

        # create a fake cursor result from the out parameters. unlike
        # get_out_parameter_values(), the result-row handlers here will be
        # applied at the Result level

        numcols = len(self.out_parameters)

        # [stmt_result for stmt_result in outparam.values] == each
        # statement in executemany
        # [val for val in stmt_result] == each row for a particular
        # statement
        return list(
            zip(
                *[
                    [
                        val
                        for stmt_result in self.out_parameters[
                            f"ret_{j}"
                        ].values
                        for val in (stmt_result or ())
                    ]
                    for j in range(numcols)
                ]
            )
        )

    def get_out_parameter_values(self, out_param_names):
        # this method should not be called when the compiler has
        # RETURNING as we've turned the has_out_parameters flag set to
        # False.
        assert not self.compiled.returning

        return [
            self.dialect._paramval(self.out_parameters[name])
            for name in out_param_names
        ]


class OracleDialect_cx_oracle(OracleDialect):
    supports_statement_cache = True
    execution_ctx_cls = OracleExecutionContext_cx_oracle
    statement_compiler = OracleCompiler_cx_oracle

    supports_sane_rowcount = True
    supports_sane_multi_rowcount = True

    insert_executemany_returning = True
    insert_executemany_returning_sort_by_parameter_order = True
    update_executemany_returning = True
    delete_executemany_returning = True

    bind_typing = interfaces.BindTyping.SETINPUTSIZES

    driver = "cx_oracle"

    colspecs = util.update_copy(
        OracleDialect.colspecs,
        {
            sqltypes.TIMESTAMP: _CXOracleTIMESTAMP,
            sqltypes.Numeric: _OracleNumeric,
            sqltypes.Float: _OracleNumeric,
            oracle.BINARY_FLOAT: _OracleBINARY_FLOAT,
            oracle.BINARY_DOUBLE: _OracleBINARY_DOUBLE,
            sqltypes.Integer: _OracleInteger,
            oracle.NUMBER: _OracleNUMBER,
            sqltypes.Date: _CXOracleDate,
            sqltypes.LargeBinary: _OracleBinary,
            sqltypes.Boolean: oracle._OracleBoolean,
            sqltypes.Interval: _OracleInterval,
            oracle.INTERVAL: _OracleInterval,
            sqltypes.Text: _OracleText,
            sqltypes.String: _OracleString,
            sqltypes.UnicodeText: _OracleUnicodeTextCLOB,
            sqltypes.CHAR: _OracleChar,
            sqltypes.NCHAR: _OracleNChar,
            sqltypes.Enum: _OracleEnum,
            oracle.LONG: _OracleLong,
            oracle.RAW: _OracleRaw,
            sqltypes.Unicode: _OracleUnicodeStringCHAR,
            sqltypes.NVARCHAR: _OracleUnicodeStringNCHAR,
            sqltypes.Uuid: _OracleUUID,
            oracle.NCLOB: _OracleUnicodeTextNCLOB,
            oracle.ROWID: _OracleRowid,
        },
    )

    execute_sequence_format = list

    _cx_oracle_threaded = None

    _cursor_var_unicode_kwargs = util.immutabledict()

    @util.deprecated_params(
        threaded=(
            "1.3",
            "The 'threaded' parameter to the cx_oracle/oracledb dialect "
            "is deprecated as a dialect-level argument, and will be removed "
            "in a future release.  As of version 1.3, it defaults to False "
            "rather than True.  The 'threaded' option can be passed to "
            "cx_Oracle directly in the URL query string passed to "
            ":func:`_sa.create_engine`.",
        )
    )
    def __init__(
        self,
        auto_convert_lobs=True,
        coerce_to_decimal=True,
        arraysize=50,
        encoding_errors=None,
        threaded=None,
        **kwargs,
    ):
        OracleDialect.__init__(self, **kwargs)
        self.arraysize = arraysize
        self.encoding_errors = encoding_errors
        if encoding_errors:
            self._cursor_var_unicode_kwargs = {
                "encodingErrors": encoding_errors
            }
        if threaded is not None:
            self._cx_oracle_threaded = threaded
        self.auto_convert_lobs = auto_convert_lobs
        self.coerce_to_decimal = coerce_to_decimal
        if self._use_nchar_for_unicode:
            self.colspecs = self.colspecs.copy()
            self.colspecs[sqltypes.Unicode] = _OracleUnicodeStringNCHAR
            self.colspecs[sqltypes.UnicodeText] = _OracleUnicodeTextNCLOB

        dbapi_module = self.dbapi
        self._load_version(dbapi_module)

        if dbapi_module is not None:
            # these constants will first be seen in SQLAlchemy datatypes
            # coming from the get_dbapi_type() method.   We then
            # will place the following types into setinputsizes() calls
            # on each statement.  Oracle constants that are not in this
            # list will not be put into setinputsizes().
            self.include_set_input_sizes = {
                dbapi_module.DATETIME,
                dbapi_module.DB_TYPE_NVARCHAR,  # used for CLOB, NCLOB
                dbapi_module.DB_TYPE_RAW,  # used for BLOB
                dbapi_module.NCLOB,  # not currently used except for OUT param
                dbapi_module.CLOB,  # not currently used except for OUT param
                dbapi_module.LOB,  # not currently used
                dbapi_module.BLOB,  # not currently used except for OUT param
                dbapi_module.NCHAR,
                dbapi_module.FIXED_NCHAR,
                dbapi_module.FIXED_CHAR,
                dbapi_module.TIMESTAMP,
                int,  # _OracleInteger,
                # _OracleBINARY_FLOAT, _OracleBINARY_DOUBLE,
                dbapi_module.NATIVE_FLOAT,
            }

            self._paramval = lambda value: value.getvalue()

    def _load_version(self, dbapi_module):
        version = (0, 0, 0)
        if dbapi_module is not None:
            m = re.match(r"(\d+)\.(\d+)(?:\.(\d+))?", dbapi_module.version)
            if m:
                version = tuple(
                    int(x) for x in m.group(1, 2, 3) if x is not None
                )
        self.cx_oracle_ver = version
        if self.cx_oracle_ver < (8,) and self.cx_oracle_ver > (0, 0, 0):
            raise exc.InvalidRequestError(
                "cx_Oracle version 8 and above are supported"
            )

    @classmethod
    def import_dbapi(cls):
        import cx_Oracle

        return cx_Oracle

    def initialize(self, connection):
        super().initialize(connection)
        self._detect_decimal_char(connection)

    def get_isolation_level(self, dbapi_connection):
        # sources:

        # general idea of transaction id, have to start one, etc.
        # https://stackoverflow.com/questions/10711204/how-to-check-isoloation-level

        # how to decode xid cols from v$transaction to match
        # https://asktom.oracle.com/pls/apex/f?p=100:11:0::::P11_QUESTION_ID:9532779900346079444

        # Oracle tuple comparison without using IN:
        # https://www.sql-workbench.eu/comparison/tuple_comparison.html

        with dbapi_connection.cursor() as cursor:
            # this is the only way to ensure a transaction is started without
            # actually running DML.   There's no way to see the configured
            # isolation level without getting it from v$transaction which
            # means transaction has to be started.
            outval = cursor.var(str)
            cursor.execute(
                """
                begin
                   :trans_id := dbms_transaction.local_transaction_id( TRUE );
                end;
                """,
                {"trans_id": outval},
            )
            trans_id = outval.getvalue()
            xidusn, xidslot, xidsqn = trans_id.split(".", 2)

            cursor.execute(
                "SELECT CASE BITAND(t.flag, POWER(2, 28)) "
                "WHEN 0 THEN 'READ COMMITTED' "
                "ELSE 'SERIALIZABLE' END AS isolation_level "
                "FROM v$transaction t WHERE "
                "(t.xidusn, t.xidslot, t.xidsqn) = "
                "((:xidusn, :xidslot, :xidsqn))",
                {"xidusn": xidusn, "xidslot": xidslot, "xidsqn": xidsqn},
            )
            row = cursor.fetchone()
            if row is None:
                raise exc.InvalidRequestError(
                    "could not retrieve isolation level"
                )
            result = row[0]

        return result

    def get_isolation_level_values(self, dbapi_connection):
        return super().get_isolation_level_values(dbapi_connection) + [
            "AUTOCOMMIT"
        ]

    def set_isolation_level(self, dbapi_connection, level):
        if level == "AUTOCOMMIT":
            dbapi_connection.autocommit = True
        else:
            dbapi_connection.autocommit = False
            dbapi_connection.rollback()
            with dbapi_connection.cursor() as cursor:
                cursor.execute(f"ALTER SESSION SET ISOLATION_LEVEL={level}")

    def _detect_decimal_char(self, connection):
        # we have the option to change this setting upon connect,
        # or just look at what it is upon connect and convert.
        # to minimize the chance of interference with changes to
        # NLS_TERRITORY or formatting behavior of the DB, we opt
        # to just look at it

        dbapi_connection = connection.connection

        with dbapi_connection.cursor() as cursor:
            # issue #8744
            # nls_session_parameters is not available in some Oracle
            # modes like "mount mode".  But then, v$nls_parameters is not
            # available if the connection doesn't have SYSDBA priv.
            #
            # simplify the whole thing and just use the method that we were
            # doing in the test suite already, selecting a number

            def output_type_handler(
                cursor, name, defaultType, size, precision, scale
            ):
                return cursor.var(
                    self.dbapi.STRING, 255, arraysize=cursor.arraysize
                )

            cursor.outputtypehandler = output_type_handler
            cursor.execute("SELECT 1.1 FROM DUAL")
            value = cursor.fetchone()[0]

            decimal_char = value.lstrip("0")[1]
            assert not decimal_char[0].isdigit()

        self._decimal_char = decimal_char

        if self._decimal_char != ".":
            _detect_decimal = self._detect_decimal
            _to_decimal = self._to_decimal

            self._detect_decimal = lambda value: _detect_decimal(
                value.replace(self._decimal_char, ".")
            )
            self._to_decimal = lambda value: _to_decimal(
                value.replace(self._decimal_char, ".")
            )

    def _detect_decimal(self, value):
        if "." in value:
            return self._to_decimal(value)
        else:
            return int(value)

    _to_decimal = decimal.Decimal

    def _generate_connection_outputtype_handler(self):
        """establish the default outputtypehandler established at the
        connection level.

        """

        dialect = self
        cx_Oracle = dialect.dbapi

        number_handler = _OracleNUMBER(
            asdecimal=True
        )._cx_oracle_outputtypehandler(dialect)
        float_handler = _OracleNUMBER(
            asdecimal=False
        )._cx_oracle_outputtypehandler(dialect)

        def output_type_handler(
            cursor, name, default_type, size, precision, scale
        ):
            if (
                default_type == cx_Oracle.NUMBER
                and default_type is not cx_Oracle.NATIVE_FLOAT
            ):
                if not dialect.coerce_to_decimal:
                    return None
                elif precision == 0 and scale in (0, -127):
                    # ambiguous type, this occurs when selecting
                    # numbers from deep subqueries
                    return cursor.var(
                        cx_Oracle.STRING,
                        255,
                        outconverter=dialect._detect_decimal,
                        arraysize=cursor.arraysize,
                    )
                elif precision and scale > 0:
                    return number_handler(
                        cursor, name, default_type, size, precision, scale
                    )
                else:
                    return float_handler(
                        cursor, name, default_type, size, precision, scale
                    )

            # if unicode options were specified, add a decoder, otherwise
            # cx_Oracle should return Unicode
            elif (
                dialect._cursor_var_unicode_kwargs
                and default_type
                in (
                    cx_Oracle.STRING,
                    cx_Oracle.FIXED_CHAR,
                )
                and default_type is not cx_Oracle.CLOB
                and default_type is not cx_Oracle.NCLOB
            ):
                return cursor.var(
                    str,
                    size,
                    cursor.arraysize,
                    **dialect._cursor_var_unicode_kwargs,
                )

            elif dialect.auto_convert_lobs and default_type in (
                cx_Oracle.CLOB,
                cx_Oracle.NCLOB,
            ):
                return cursor.var(
                    cx_Oracle.DB_TYPE_NVARCHAR,
                    _CX_ORACLE_MAGIC_LOB_SIZE,
                    cursor.arraysize,
                    **dialect._cursor_var_unicode_kwargs,
                )

            elif dialect.auto_convert_lobs and default_type in (
                cx_Oracle.BLOB,
            ):
                return cursor.var(
                    cx_Oracle.DB_TYPE_RAW,
                    _CX_ORACLE_MAGIC_LOB_SIZE,
                    cursor.arraysize,
                )

        return output_type_handler

    def on_connect(self):
        output_type_handler = self._generate_connection_outputtype_handler()

        def on_connect(conn):
            conn.outputtypehandler = output_type_handler

        return on_connect

    def create_connect_args(self, url):
        opts = dict(url.query)

        for opt in ("use_ansi", "auto_convert_lobs"):
            if opt in opts:
                util.warn_deprecated(
                    f"{self.driver} dialect option {opt!r} should only be "
                    "passed to create_engine directly, not within the URL "
                    "string",
                    version="1.3",
                )
                util.coerce_kw_type(opts, opt, bool)
                setattr(self, opt, opts.pop(opt))

        database = url.database
        service_name = opts.pop("service_name", None)
        if database or service_name:
            # if we have a database, then we have a remote host
            port = url.port
            if port:
                port = int(port)
            else:
                port = 1521

            if database and service_name:
                raise exc.InvalidRequestError(
                    '"service_name" option shouldn\'t '
                    'be used with a "database" part of the url'
                )
            if database:
                makedsn_kwargs = {"sid": database}
            if service_name:
                makedsn_kwargs = {"service_name": service_name}

            dsn = self.dbapi.makedsn(url.host, port, **makedsn_kwargs)
        else:
            # we have a local tnsname
            dsn = url.host

        if dsn is not None:
            opts["dsn"] = dsn
        if url.password is not None:
            opts["password"] = url.password
        if url.username is not None:
            opts["user"] = url.username

        if self._cx_oracle_threaded is not None:
            opts.setdefault("threaded", self._cx_oracle_threaded)

        def convert_cx_oracle_constant(value):
            if isinstance(value, str):
                try:
                    int_val = int(value)
                except ValueError:
                    value = value.upper()
                    return getattr(self.dbapi, value)
                else:
                    return int_val
            else:
                return value

        util.coerce_kw_type(opts, "mode", convert_cx_oracle_constant)
        util.coerce_kw_type(opts, "threaded", bool)
        util.coerce_kw_type(opts, "events", bool)
        util.coerce_kw_type(opts, "purity", convert_cx_oracle_constant)
        return ([], opts)

    def _get_server_version_info(self, connection):
        return tuple(int(x) for x in connection.connection.version.split("."))

    def is_disconnect(self, e, connection, cursor):
        (error,) = e.args
        if isinstance(
            e, (self.dbapi.InterfaceError, self.dbapi.DatabaseError)
        ) and "not connected" in str(e):
            return True

        if hasattr(error, "code") and error.code in {
            28,
            3114,
            3113,
            3135,
            1033,
            2396,
        }:
            # ORA-00028: your session has been killed
            # ORA-03114: not connected to ORACLE
            # ORA-03113: end-of-file on communication channel
            # ORA-03135: connection lost contact
            # ORA-01033: ORACLE initialization or shutdown in progress
            # ORA-02396: exceeded maximum idle time, please connect again
            # TODO: Others ?
            return True

        if re.match(r"^(?:DPI-1010|DPI-1080|DPY-1001|DPY-4011)", str(e)):
            # DPI-1010: not connected
            # DPI-1080: connection was closed by ORA-3113
            # python-oracledb's DPY-1001: not connected to database
            # python-oracledb's DPY-4011: the database or network closed the
            # connection
            # TODO: others?
            return True

        return False

    def create_xid(self):
        """create a two-phase transaction ID.

        this id will be passed to do_begin_twophase(), do_rollback_twophase(),
        do_commit_twophase().  its format is unspecified.

        """

        id_ = random.randint(0, 2**128)
        return (0x1234, "%032x" % id_, "%032x" % 9)

    def do_executemany(self, cursor, statement, parameters, context=None):
        if isinstance(parameters, tuple):
            parameters = list(parameters)
        cursor.executemany(statement, parameters)

    def do_begin_twophase(self, connection, xid):
        connection.connection.begin(*xid)
        connection.connection.info["cx_oracle_xid"] = xid

    def do_prepare_twophase(self, connection, xid):
        result = connection.connection.prepare()
        connection.info["cx_oracle_prepared"] = result

    def do_rollback_twophase(
        self, connection, xid, is_prepared=True, recover=False
    ):
        self.do_rollback(connection.connection)
        # TODO: need to end XA state here

    def do_commit_twophase(
        self, connection, xid, is_prepared=True, recover=False
    ):
        if not is_prepared:
            self.do_commit(connection.connection)
        else:
            if recover:
                raise NotImplementedError(
                    "2pc recovery not implemented for cx_Oracle"
                )
            oci_prepared = connection.info["cx_oracle_prepared"]
            if oci_prepared:
                self.do_commit(connection.connection)
        # TODO: need to end XA state here

    def do_set_input_sizes(self, cursor, list_of_tuples, context):
        if self.positional:
            # not usually used, here to support if someone is modifying
            # the dialect to use positional style
            cursor.setinputsizes(
                *[dbtype for key, dbtype, sqltype in list_of_tuples]
            )
        else:
            collection = (
                (key, dbtype)
                for key, dbtype, sqltype in list_of_tuples
                if dbtype
            )

            cursor.setinputsizes(**{key: dbtype for key, dbtype in collection})

    def do_recover_twophase(self, connection):
        raise NotImplementedError(
            "recover two phase query for cx_Oracle not implemented"
        )


dialect = OracleDialect_cx_oracle
