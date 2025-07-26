# dialects/mssql/pyodbc.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

r"""
.. dialect:: mssql+pyodbc
    :name: PyODBC
    :dbapi: pyodbc
    :connectstring: mssql+pyodbc://<username>:<password>@<dsnname>
    :url: https://pypi.org/project/pyodbc/

Connecting to PyODBC
--------------------

The URL here is to be translated to PyODBC connection strings, as
detailed in `ConnectionStrings <https://code.google.com/p/pyodbc/wiki/ConnectionStrings>`_.

DSN Connections
^^^^^^^^^^^^^^^

A DSN connection in ODBC means that a pre-existing ODBC datasource is
configured on the client machine.   The application then specifies the name
of this datasource, which encompasses details such as the specific ODBC driver
in use as well as the network address of the database.   Assuming a datasource
is configured on the client, a basic DSN-based connection looks like::

    engine = create_engine("mssql+pyodbc://scott:tiger@some_dsn")

Which above, will pass the following connection string to PyODBC::

    DSN=some_dsn;UID=scott;PWD=tiger

If the username and password are omitted, the DSN form will also add
the ``Trusted_Connection=yes`` directive to the ODBC string.

Hostname Connections
^^^^^^^^^^^^^^^^^^^^

Hostname-based connections are also supported by pyodbc.  These are often
easier to use than a DSN and have the additional advantage that the specific
database name to connect towards may be specified locally in the URL, rather
than it being fixed as part of a datasource configuration.

When using a hostname connection, the driver name must also be specified in the
query parameters of the URL.  As these names usually have spaces in them, the
name must be URL encoded which means using plus signs for spaces::

    engine = create_engine("mssql+pyodbc://scott:tiger@myhost:port/databasename?driver=ODBC+Driver+17+for+SQL+Server")

The ``driver`` keyword is significant to the pyodbc dialect and must be
specified in lowercase.

Any other names passed in the query string are passed through in the pyodbc
connect string, such as ``authentication``, ``TrustServerCertificate``, etc.
Multiple keyword arguments must be separated by an ampersand (``&``); these
will be translated to semicolons when the pyodbc connect string is generated
internally::

    e = create_engine(
        "mssql+pyodbc://scott:tiger@mssql2017:1433/test?"
        "driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes"
        "&authentication=ActiveDirectoryIntegrated"
    )

The equivalent URL can be constructed using :class:`_sa.engine.URL`::

    from sqlalchemy.engine import URL
    connection_url = URL.create(
        "mssql+pyodbc",
        username="scott",
        password="tiger",
        host="mssql2017",
        port=1433,
        database="test",
        query={
            "driver": "ODBC Driver 18 for SQL Server",
            "TrustServerCertificate": "yes",
            "authentication": "ActiveDirectoryIntegrated",
        },
    )


Pass through exact Pyodbc string
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

A PyODBC connection string can also be sent in pyodbc's format directly, as
specified in `the PyODBC documentation
<https://github.com/mkleehammer/pyodbc/wiki/Connecting-to-databases>`_,
using the parameter ``odbc_connect``.  A :class:`_sa.engine.URL` object
can help make this easier::

    from sqlalchemy.engine import URL
    connection_string = "DRIVER={SQL Server Native Client 10.0};SERVER=dagger;DATABASE=test;UID=user;PWD=password"
    connection_url = URL.create("mssql+pyodbc", query={"odbc_connect": connection_string})

    engine = create_engine(connection_url)

.. _mssql_pyodbc_access_tokens:

Connecting to databases with access tokens
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

Some database servers are set up to only accept access tokens for login. For
example, SQL Server allows the use of Azure Active Directory tokens to connect
to databases. This requires creating a credential object using the
``azure-identity`` library. More information about the authentication step can be
found in `Microsoft's documentation
<https://docs.microsoft.com/en-us/azure/developer/python/azure-sdk-authenticate?tabs=bash>`_.

After getting an engine, the credentials need to be sent to ``pyodbc.connect``
each time a connection is requested. One way to do this is to set up an event
listener on the engine that adds the credential token to the dialect's connect
call. This is discussed more generally in :ref:`engines_dynamic_tokens`. For
SQL Server in particular, this is passed as an ODBC connection attribute with
a data structure `described by Microsoft
<https://docs.microsoft.com/en-us/sql/connect/odbc/using-azure-active-directory#authenticating-with-an-access-token>`_.

The following code snippet will create an engine that connects to an Azure SQL
database using Azure credentials::

    import struct
    from sqlalchemy import create_engine, event
    from sqlalchemy.engine.url import URL
    from azure import identity

    SQL_COPT_SS_ACCESS_TOKEN = 1256  # Connection option for access tokens, as defined in msodbcsql.h
    TOKEN_URL = "https://database.windows.net/"  # The token URL for any Azure SQL database

    connection_string = "mssql+pyodbc://@my-server.database.windows.net/myDb?driver=ODBC+Driver+17+for+SQL+Server"

    engine = create_engine(connection_string)

    azure_credentials = identity.DefaultAzureCredential()

    @event.listens_for(engine, "do_connect")
    def provide_token(dialect, conn_rec, cargs, cparams):
        # remove the "Trusted_Connection" parameter that SQLAlchemy adds
        cargs[0] = cargs[0].replace(";Trusted_Connection=Yes", "")

        # create token credential
        raw_token = azure_credentials.get_token(TOKEN_URL).token.encode("utf-16-le")
        token_struct = struct.pack(f"<I{len(raw_token)}s", len(raw_token), raw_token)

        # apply it to keyword arguments
        cparams["attrs_before"] = {SQL_COPT_SS_ACCESS_TOKEN: token_struct}

.. tip::

    The ``Trusted_Connection`` token is currently added by the SQLAlchemy
    pyodbc dialect when no username or password is present.  This needs
    to be removed per Microsoft's
    `documentation for Azure access tokens
    <https://docs.microsoft.com/en-us/sql/connect/odbc/using-azure-active-directory#authenticating-with-an-access-token>`_,
    stating that a connection string when using an access token must not contain
    ``UID``, ``PWD``, ``Authentication`` or ``Trusted_Connection`` parameters.

.. _azure_synapse_ignore_no_transaction_on_rollback:

Avoiding transaction-related exceptions on Azure Synapse Analytics
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

Azure Synapse Analytics has a significant difference in its transaction
handling compared to plain SQL Server; in some cases an error within a Synapse
transaction can cause it to be arbitrarily terminated on the server side, which
then causes the DBAPI ``.rollback()`` method (as well as ``.commit()``) to
fail. The issue prevents the usual DBAPI contract of allowing ``.rollback()``
to pass silently if no transaction is present as the driver does not expect
this condition. The symptom of this failure is an exception with a message
resembling 'No corresponding transaction found. (111214)' when attempting to
emit a ``.rollback()`` after an operation had a failure of some kind.

This specific case can be handled by passing ``ignore_no_transaction_on_rollback=True`` to
the SQL Server dialect via the :func:`_sa.create_engine` function as follows::

    engine = create_engine(connection_url, ignore_no_transaction_on_rollback=True)

Using the above parameter, the dialect will catch ``ProgrammingError``
exceptions raised during ``connection.rollback()`` and emit a warning
if the error message contains code ``111214``, however will not raise
an exception.

.. versionadded:: 1.4.40  Added the
   ``ignore_no_transaction_on_rollback=True`` parameter.

Enable autocommit for Azure SQL Data Warehouse (DW) connections
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

Azure SQL Data Warehouse does not support transactions,
and that can cause problems with SQLAlchemy's "autobegin" (and implicit
commit/rollback) behavior. We can avoid these problems by enabling autocommit
at both the pyodbc and engine levels::

    connection_url = sa.engine.URL.create(
        "mssql+pyodbc",
        username="scott",
        password="tiger",
        host="dw.azure.example.com",
        database="mydb",
        query={
            "driver": "ODBC Driver 17 for SQL Server",
            "autocommit": "True",
        },
    )

    engine = create_engine(connection_url).execution_options(
        isolation_level="AUTOCOMMIT"
    )

Avoiding sending large string parameters as TEXT/NTEXT
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

By default, for historical reasons, Microsoft's ODBC drivers for SQL Server
send long string parameters (greater than 4000 SBCS characters or 2000 Unicode
characters) as TEXT/NTEXT values. TEXT and NTEXT have been deprecated for many
years and are starting to cause compatibility issues with newer versions of
SQL_Server/Azure. For example, see `this
issue <https://github.com/mkleehammer/pyodbc/issues/835>`_.

Starting with ODBC Driver 18 for SQL Server we can override the legacy
behavior and pass long strings as varchar(max)/nvarchar(max) using the
``LongAsMax=Yes`` connection string parameter::

    connection_url = sa.engine.URL.create(
        "mssql+pyodbc",
        username="scott",
        password="tiger",
        host="mssqlserver.example.com",
        database="mydb",
        query={
            "driver": "ODBC Driver 18 for SQL Server",
            "LongAsMax": "Yes",
        },
    )


Pyodbc Pooling / connection close behavior
------------------------------------------

PyODBC uses internal `pooling
<https://github.com/mkleehammer/pyodbc/wiki/The-pyodbc-Module#pooling>`_ by
default, which means connections will be longer lived than they are within
SQLAlchemy itself.  As SQLAlchemy has its own pooling behavior, it is often
preferable to disable this behavior.  This behavior can only be disabled
globally at the PyODBC module level, **before** any connections are made::

    import pyodbc

    pyodbc.pooling = False

    # don't use the engine before pooling is set to False
    engine = create_engine("mssql+pyodbc://user:pass@dsn")

If this variable is left at its default value of ``True``, **the application
will continue to maintain active database connections**, even when the
SQLAlchemy engine itself fully discards a connection or if the engine is
disposed.

.. seealso::

    `pooling <https://github.com/mkleehammer/pyodbc/wiki/The-pyodbc-Module#pooling>`_ -
    in the PyODBC documentation.

Driver / Unicode Support
-------------------------

PyODBC works best with Microsoft ODBC drivers, particularly in the area
of Unicode support on both Python 2 and Python 3.

Using the FreeTDS ODBC drivers on Linux or OSX with PyODBC is **not**
recommended; there have been historically many Unicode-related issues
in this area, including before Microsoft offered ODBC drivers for Linux
and OSX.   Now that Microsoft offers drivers for all platforms, for
PyODBC support these are recommended.  FreeTDS remains relevant for
non-ODBC drivers such as pymssql where it works very well.


Rowcount Support
----------------

Previous limitations with the SQLAlchemy ORM's "versioned rows" feature with
Pyodbc have been resolved as of SQLAlchemy 2.0.5. See the notes at
:ref:`mssql_rowcount_versioning`.

.. _mssql_pyodbc_fastexecutemany:

Fast Executemany Mode
---------------------

The PyODBC driver includes support for a "fast executemany" mode of execution
which greatly reduces round trips for a DBAPI ``executemany()`` call when using
Microsoft ODBC drivers, for **limited size batches that fit in memory**.  The
feature is enabled by setting the attribute ``.fast_executemany`` on the DBAPI
cursor when an executemany call is to be used.   The SQLAlchemy PyODBC SQL
Server dialect supports this parameter by passing the
``fast_executemany`` parameter to
:func:`_sa.create_engine` , when using the **Microsoft ODBC driver only**::

    engine = create_engine(
        "mssql+pyodbc://scott:tiger@mssql2017:1433/test?driver=ODBC+Driver+17+for+SQL+Server",
        fast_executemany=True)

.. versionchanged:: 2.0.9 - the ``fast_executemany`` parameter now has its
   intended effect of this PyODBC feature taking effect for all INSERT
   statements that are executed with multiple parameter sets, which don't
   include RETURNING.  Previously, SQLAlchemy 2.0's :term:`insertmanyvalues`
   feature would cause ``fast_executemany`` to not be used in most cases
   even if specified.

.. versionadded:: 1.3

.. seealso::

    `fast executemany <https://github.com/mkleehammer/pyodbc/wiki/Features-beyond-the-DB-API#fast_executemany>`_
    - on github

.. _mssql_pyodbc_setinputsizes:

Setinputsizes Support
-----------------------

As of version 2.0, the pyodbc ``cursor.setinputsizes()`` method is used for
all statement executions, except for ``cursor.executemany()`` calls when
fast_executemany=True where it is not supported (assuming
:ref:`insertmanyvalues <engine_insertmanyvalues>` is kept enabled,
"fastexecutemany" will not take place for INSERT statements in any case).

The use of ``cursor.setinputsizes()`` can be disabled by passing
``use_setinputsizes=False`` to :func:`_sa.create_engine`.

When ``use_setinputsizes`` is left at its default of ``True``, the
specific per-type symbols passed to ``cursor.setinputsizes()`` can be
programmatically customized using the :meth:`.DialectEvents.do_setinputsizes`
hook. See that method for usage examples.

.. versionchanged:: 2.0  The mssql+pyodbc dialect now defaults to using
   ``use_setinputsizes=True`` for all statement executions with the exception of
   cursor.executemany() calls when fast_executemany=True.  The behavior can
   be turned off by passing ``use_setinputsizes=False`` to
   :func:`_sa.create_engine`.

"""  # noqa


import datetime
import decimal
import re
import struct

from .base import _MSDateTime
from .base import _MSUnicode
from .base import _MSUnicodeText
from .base import BINARY
from .base import DATETIMEOFFSET
from .base import MSDialect
from .base import MSExecutionContext
from .base import VARBINARY
from .json import JSON as _MSJson
from .json import JSONIndexType as _MSJsonIndexType
from .json import JSONPathType as _MSJsonPathType
from ... import exc
from ... import types as sqltypes
from ... import util
from ...connectors.pyodbc import PyODBCConnector
from ...engine import cursor as _cursor


class _ms_numeric_pyodbc:

    """Turns Decimals with adjusted() < 0 or > 7 into strings.

    The routines here are needed for older pyodbc versions
    as well as current mxODBC versions.

    """

    def bind_processor(self, dialect):
        super_process = super().bind_processor(dialect)

        if not dialect._need_decimal_fix:
            return super_process

        def process(value):
            if self.asdecimal and isinstance(value, decimal.Decimal):
                adjusted = value.adjusted()
                if adjusted < 0:
                    return self._small_dec_to_string(value)
                elif adjusted > 7:
                    return self._large_dec_to_string(value)

            if super_process:
                return super_process(value)
            else:
                return value

        return process

    # these routines needed for older versions of pyodbc.
    # as of 2.1.8 this logic is integrated.

    def _small_dec_to_string(self, value):
        return "%s0.%s%s" % (
            (value < 0 and "-" or ""),
            "0" * (abs(value.adjusted()) - 1),
            "".join([str(nint) for nint in value.as_tuple()[1]]),
        )

    def _large_dec_to_string(self, value):
        _int = value.as_tuple()[1]
        if "E" in str(value):
            result = "%s%s%s" % (
                (value < 0 and "-" or ""),
                "".join([str(s) for s in _int]),
                "0" * (value.adjusted() - (len(_int) - 1)),
            )
        else:
            if (len(_int) - 1) > value.adjusted():
                result = "%s%s.%s" % (
                    (value < 0 and "-" or ""),
                    "".join([str(s) for s in _int][0 : value.adjusted() + 1]),
                    "".join([str(s) for s in _int][value.adjusted() + 1 :]),
                )
            else:
                result = "%s%s" % (
                    (value < 0 and "-" or ""),
                    "".join([str(s) for s in _int][0 : value.adjusted() + 1]),
                )
        return result


class _MSNumeric_pyodbc(_ms_numeric_pyodbc, sqltypes.Numeric):
    pass


class _MSFloat_pyodbc(_ms_numeric_pyodbc, sqltypes.Float):
    pass


class _ms_binary_pyodbc:
    """Wraps binary values in dialect-specific Binary wrapper.
    If the value is null, return a pyodbc-specific BinaryNull
    object to prevent pyODBC [and FreeTDS] from defaulting binary
    NULL types to SQLWCHAR and causing implicit conversion errors.
    """

    def bind_processor(self, dialect):
        if dialect.dbapi is None:
            return None

        DBAPIBinary = dialect.dbapi.Binary

        def process(value):
            if value is not None:
                return DBAPIBinary(value)
            else:
                # pyodbc-specific
                return dialect.dbapi.BinaryNull

        return process


class _ODBCDateTimeBindProcessor:
    """Add bind processors to handle datetimeoffset behaviors"""

    has_tz = False

    def bind_processor(self, dialect):
        def process(value):
            if value is None:
                return None
            elif isinstance(value, str):
                # if a string was passed directly, allow it through
                return value
            elif not value.tzinfo or (not self.timezone and not self.has_tz):
                # for DateTime(timezone=False)
                return value
            else:
                # for DATETIMEOFFSET or DateTime(timezone=True)
                #
                # Convert to string format required by T-SQL
                dto_string = value.strftime("%Y-%m-%d %H:%M:%S.%f %z")
                # offset needs a colon, e.g., -0700 -> -07:00
                # "UTC offset in the form (+-)HHMM[SS[.ffffff]]"
                # backend currently rejects seconds / fractional seconds
                dto_string = re.sub(
                    r"([\+\-]\d{2})([\d\.]+)$", r"\1:\2", dto_string
                )
                return dto_string

        return process


class _ODBCDateTime(_ODBCDateTimeBindProcessor, _MSDateTime):
    pass


class _ODBCDATETIMEOFFSET(_ODBCDateTimeBindProcessor, DATETIMEOFFSET):
    has_tz = True


class _VARBINARY_pyodbc(_ms_binary_pyodbc, VARBINARY):
    pass


class _BINARY_pyodbc(_ms_binary_pyodbc, BINARY):
    pass


class _String_pyodbc(sqltypes.String):
    def get_dbapi_type(self, dbapi):
        if self.length in (None, "max") or self.length >= 2000:
            return (dbapi.SQL_VARCHAR, 0, 0)
        else:
            return dbapi.SQL_VARCHAR


class _Unicode_pyodbc(_MSUnicode):
    def get_dbapi_type(self, dbapi):
        if self.length in (None, "max") or self.length >= 2000:
            return (dbapi.SQL_WVARCHAR, 0, 0)
        else:
            return dbapi.SQL_WVARCHAR


class _UnicodeText_pyodbc(_MSUnicodeText):
    def get_dbapi_type(self, dbapi):
        if self.length in (None, "max") or self.length >= 2000:
            return (dbapi.SQL_WVARCHAR, 0, 0)
        else:
            return dbapi.SQL_WVARCHAR


class _JSON_pyodbc(_MSJson):
    def get_dbapi_type(self, dbapi):
        return (dbapi.SQL_WVARCHAR, 0, 0)


class _JSONIndexType_pyodbc(_MSJsonIndexType):
    def get_dbapi_type(self, dbapi):
        return dbapi.SQL_WVARCHAR


class _JSONPathType_pyodbc(_MSJsonPathType):
    def get_dbapi_type(self, dbapi):
        return dbapi.SQL_WVARCHAR


class MSExecutionContext_pyodbc(MSExecutionContext):
    _embedded_scope_identity = False

    def pre_exec(self):
        """where appropriate, issue "select scope_identity()" in the same
        statement.

        Background on why "scope_identity()" is preferable to "@@identity":
        https://msdn.microsoft.com/en-us/library/ms190315.aspx

        Background on why we attempt to embed "scope_identity()" into the same
        statement as the INSERT:
        https://code.google.com/p/pyodbc/wiki/FAQs#How_do_I_retrieve_autogenerated/identity_values?

        """

        super().pre_exec()

        # don't embed the scope_identity select into an
        # "INSERT .. DEFAULT VALUES"
        if (
            self._select_lastrowid
            and self.dialect.use_scope_identity
            and len(self.parameters[0])
        ):
            self._embedded_scope_identity = True

            self.statement += "; select scope_identity()"

    def post_exec(self):
        if self._embedded_scope_identity:
            # Fetch the last inserted id from the manipulated statement
            # We may have to skip over a number of result sets with
            # no data (due to triggers, etc.)
            while True:
                try:
                    # fetchall() ensures the cursor is consumed
                    # without closing it (FreeTDS particularly)
                    rows = self.cursor.fetchall()
                except self.dialect.dbapi.Error:
                    # no way around this - nextset() consumes the previous set
                    # so we need to just keep flipping
                    self.cursor.nextset()
                else:
                    if not rows:
                        # async adapter drivers just return None here
                        self.cursor.nextset()
                        continue
                    row = rows[0]
                    break

            self._lastrowid = int(row[0])

            self.cursor_fetch_strategy = _cursor._NO_CURSOR_DML
        else:
            super().post_exec()


class MSDialect_pyodbc(PyODBCConnector, MSDialect):
    supports_statement_cache = True

    # note this parameter is no longer used by the ORM or default dialect
    # see #9414
    supports_sane_rowcount_returning = False

    execution_ctx_cls = MSExecutionContext_pyodbc

    colspecs = util.update_copy(
        MSDialect.colspecs,
        {
            sqltypes.Numeric: _MSNumeric_pyodbc,
            sqltypes.Float: _MSFloat_pyodbc,
            BINARY: _BINARY_pyodbc,
            # support DateTime(timezone=True)
            sqltypes.DateTime: _ODBCDateTime,
            DATETIMEOFFSET: _ODBCDATETIMEOFFSET,
            # SQL Server dialect has a VARBINARY that is just to support
            # "deprecate_large_types" w/ VARBINARY(max), but also we must
            # handle the usual SQL standard VARBINARY
            VARBINARY: _VARBINARY_pyodbc,
            sqltypes.VARBINARY: _VARBINARY_pyodbc,
            sqltypes.LargeBinary: _VARBINARY_pyodbc,
            sqltypes.String: _String_pyodbc,
            sqltypes.Unicode: _Unicode_pyodbc,
            sqltypes.UnicodeText: _UnicodeText_pyodbc,
            sqltypes.JSON: _JSON_pyodbc,
            sqltypes.JSON.JSONIndexType: _JSONIndexType_pyodbc,
            sqltypes.JSON.JSONPathType: _JSONPathType_pyodbc,
            # this excludes Enum from the string/VARCHAR thing for now
            # it looks like Enum's adaptation doesn't really support the
            # String type itself having a dialect-level impl
            sqltypes.Enum: sqltypes.Enum,
        },
    )

    def __init__(
        self,
        fast_executemany=False,
        use_setinputsizes=True,
        **params,
    ):
        super().__init__(use_setinputsizes=use_setinputsizes, **params)
        self.use_scope_identity = (
            self.use_scope_identity
            and self.dbapi
            and hasattr(self.dbapi.Cursor, "nextset")
        )
        self._need_decimal_fix = self.dbapi and self._dbapi_version() < (
            2,
            1,
            8,
        )
        self.fast_executemany = fast_executemany
        if fast_executemany:
            self.use_insertmanyvalues_wo_returning = False

    def _get_server_version_info(self, connection):
        try:
            # "Version of the instance of SQL Server, in the form
            # of 'major.minor.build.revision'"
            raw = connection.exec_driver_sql(
                "SELECT CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR)"
            ).scalar()
        except exc.DBAPIError:
            # SQL Server docs indicate this function isn't present prior to
            # 2008.  Before we had the VARCHAR cast above, pyodbc would also
            # fail on this query.
            return super()._get_server_version_info(connection)
        else:
            version = []
            r = re.compile(r"[.\-]")
            for n in r.split(raw):
                try:
                    version.append(int(n))
                except ValueError:
                    pass
            return tuple(version)

    def on_connect(self):
        super_ = super().on_connect()

        def on_connect(conn):
            if super_ is not None:
                super_(conn)

            self._setup_timestampoffset_type(conn)

        return on_connect

    def _setup_timestampoffset_type(self, connection):
        # output converter function for datetimeoffset
        def _handle_datetimeoffset(dto_value):
            tup = struct.unpack("<6hI2h", dto_value)
            return datetime.datetime(
                tup[0],
                tup[1],
                tup[2],
                tup[3],
                tup[4],
                tup[5],
                tup[6] // 1000,
                datetime.timezone(
                    datetime.timedelta(hours=tup[7], minutes=tup[8])
                ),
            )

        odbc_SQL_SS_TIMESTAMPOFFSET = -155  # as defined in SQLNCLI.h
        connection.add_output_converter(
            odbc_SQL_SS_TIMESTAMPOFFSET, _handle_datetimeoffset
        )

    def do_executemany(self, cursor, statement, parameters, context=None):
        if self.fast_executemany:
            cursor.fast_executemany = True
        super().do_executemany(cursor, statement, parameters, context=context)

    def is_disconnect(self, e, connection, cursor):
        if isinstance(e, self.dbapi.Error):
            code = e.args[0]
            if code in {
                "08S01",
                "01000",
                "01002",
                "08003",
                "08007",
                "08S02",
                "08001",
                "HYT00",
                "HY010",
                "10054",
            }:
                return True
        return super().is_disconnect(e, connection, cursor)


dialect = MSDialect_pyodbc
