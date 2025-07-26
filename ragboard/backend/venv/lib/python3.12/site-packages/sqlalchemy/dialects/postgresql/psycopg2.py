# dialects/postgresql/psycopg2.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

r"""
.. dialect:: postgresql+psycopg2
    :name: psycopg2
    :dbapi: psycopg2
    :connectstring: postgresql+psycopg2://user:password@host:port/dbname[?key=value&key=value...]
    :url: https://pypi.org/project/psycopg2/

.. _psycopg2_toplevel:

psycopg2 Connect Arguments
--------------------------

Keyword arguments that are specific to the SQLAlchemy psycopg2 dialect
may be passed to :func:`_sa.create_engine()`, and include the following:


* ``isolation_level``: This option, available for all PostgreSQL dialects,
  includes the ``AUTOCOMMIT`` isolation level when using the psycopg2
  dialect.   This option sets the **default** isolation level for the
  connection that is set immediately upon connection to the database before
  the connection is pooled.  This option is generally superseded by the more
  modern :paramref:`_engine.Connection.execution_options.isolation_level`
  execution option, detailed at :ref:`dbapi_autocommit`.

  .. seealso::

    :ref:`psycopg2_isolation_level`

    :ref:`dbapi_autocommit`


* ``client_encoding``: sets the client encoding in a libpq-agnostic way,
  using psycopg2's ``set_client_encoding()`` method.

  .. seealso::

    :ref:`psycopg2_unicode`


* ``executemany_mode``, ``executemany_batch_page_size``,
  ``executemany_values_page_size``: Allows use of psycopg2
  extensions for optimizing "executemany"-style queries.  See the referenced
  section below for details.

  .. seealso::

    :ref:`psycopg2_executemany_mode`

.. tip::

    The above keyword arguments are **dialect** keyword arguments, meaning
    that they are passed as explicit keyword arguments to :func:`_sa.create_engine()`::

        engine = create_engine(
            "postgresql+psycopg2://scott:tiger@localhost/test",
            isolation_level="SERIALIZABLE",
        )

    These should not be confused with **DBAPI** connect arguments, which
    are passed as part of the :paramref:`_sa.create_engine.connect_args`
    dictionary and/or are passed in the URL query string, as detailed in
    the section :ref:`custom_dbapi_args`.

.. _psycopg2_ssl:

SSL Connections
---------------

The psycopg2 module has a connection argument named ``sslmode`` for
controlling its behavior regarding secure (SSL) connections. The default is
``sslmode=prefer``; it will attempt an SSL connection and if that fails it
will fall back to an unencrypted connection. ``sslmode=require`` may be used
to ensure that only secure connections are established.  Consult the
psycopg2 / libpq documentation for further options that are available.

Note that ``sslmode`` is specific to psycopg2 so it is included in the
connection URI::

    engine = sa.create_engine(
        "postgresql+psycopg2://scott:tiger@192.168.0.199:5432/test?sslmode=require"
    )


Unix Domain Connections
------------------------

psycopg2 supports connecting via Unix domain connections.   When the ``host``
portion of the URL is omitted, SQLAlchemy passes ``None`` to psycopg2,
which specifies Unix-domain communication rather than TCP/IP communication::

    create_engine("postgresql+psycopg2://user:password@/dbname")

By default, the socket file used is to connect to a Unix-domain socket
in ``/tmp``, or whatever socket directory was specified when PostgreSQL
was built.  This value can be overridden by passing a pathname to psycopg2,
using ``host`` as an additional keyword argument::

    create_engine("postgresql+psycopg2://user:password@/dbname?host=/var/lib/postgresql")

.. warning::  The format accepted here allows for a hostname in the main URL
   in addition to the "host" query string argument.  **When using this URL
   format, the initial host is silently ignored**.  That is, this URL::

        engine = create_engine("postgresql+psycopg2://user:password@myhost1/dbname?host=myhost2")

   Above, the hostname ``myhost1`` is **silently ignored and discarded.**  The
   host which is connected is the ``myhost2`` host.

   This is to maintain some degree of compatibility with PostgreSQL's own URL
   format which has been tested to behave the same way and for which tools like
   PifPaf hardcode two hostnames.

.. seealso::

    `PQconnectdbParams \
    <https://www.postgresql.org/docs/current/static/libpq-connect.html#LIBPQ-PQCONNECTDBPARAMS>`_

.. _psycopg2_multi_host:

Specifying multiple fallback hosts
-----------------------------------

psycopg2 supports multiple connection points in the connection string.
When the ``host`` parameter is used multiple times in the query section of
the URL, SQLAlchemy will create a single string of the host and port
information provided to make the connections.  Tokens may consist of
``host::port`` or just ``host``; in the latter case, the default port
is selected by libpq.  In the example below, three host connections
are specified, for ``HostA::PortA``, ``HostB`` connecting to the default port,
and ``HostC::PortC``::

    create_engine(
        "postgresql+psycopg2://user:password@/dbname?host=HostA:PortA&host=HostB&host=HostC:PortC"
    )

As an alternative, libpq query string format also may be used; this specifies
``host`` and ``port`` as single query string arguments with comma-separated
lists - the default port can be chosen by indicating an empty value
in the comma separated list::

    create_engine(
        "postgresql+psycopg2://user:password@/dbname?host=HostA,HostB,HostC&port=PortA,,PortC"
    )

With either URL style, connections to each host is attempted based on a
configurable strategy, which may be configured using the libpq
``target_session_attrs`` parameter.  Per libpq this defaults to ``any``
which indicates a connection to each host is then attempted until a connection is successful.
Other strategies include ``primary``, ``prefer-standby``, etc.  The complete
list is documented by PostgreSQL at
`libpq connection strings <https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING>`_.

For example, to indicate two hosts using the ``primary`` strategy::

    create_engine(
        "postgresql+psycopg2://user:password@/dbname?host=HostA:PortA&host=HostB&host=HostC:PortC&target_session_attrs=primary"
    )

.. versionchanged:: 1.4.40 Port specification in psycopg2 multiple host format
   is repaired, previously ports were not correctly interpreted in this context.
   libpq comma-separated format is also now supported.

.. versionadded:: 1.3.20 Support for multiple hosts in PostgreSQL connection
   string.

.. seealso::

    `libpq connection strings <https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING>`_ - please refer
    to this section in the libpq documentation for complete background on multiple host support.


Empty DSN Connections / Environment Variable Connections
---------------------------------------------------------

The psycopg2 DBAPI can connect to PostgreSQL by passing an empty DSN to the
libpq client library, which by default indicates to connect to a localhost
PostgreSQL database that is open for "trust" connections.  This behavior can be
further tailored using a particular set of environment variables which are
prefixed with ``PG_...``, which are  consumed by ``libpq`` to take the place of
any or all elements of the connection string.

For this form, the URL can be passed without any elements other than the
initial scheme::

    engine = create_engine('postgresql+psycopg2://')

In the above form, a blank "dsn" string is passed to the ``psycopg2.connect()``
function which in turn represents an empty DSN passed to libpq.

.. versionadded:: 1.3.2 support for parameter-less connections with psycopg2.

.. seealso::

    `Environment Variables\
    <https://www.postgresql.org/docs/current/libpq-envars.html>`_ -
    PostgreSQL documentation on how to use ``PG_...``
    environment variables for connections.

.. _psycopg2_execution_options:

Per-Statement/Connection Execution Options
-------------------------------------------

The following DBAPI-specific options are respected when used with
:meth:`_engine.Connection.execution_options`,
:meth:`.Executable.execution_options`,
:meth:`_query.Query.execution_options`,
in addition to those not specific to DBAPIs:

* ``isolation_level`` - Set the transaction isolation level for the lifespan
  of a :class:`_engine.Connection` (can only be set on a connection,
  not a statement
  or query).   See :ref:`psycopg2_isolation_level`.

* ``stream_results`` - Enable or disable usage of psycopg2 server side
  cursors - this feature makes use of "named" cursors in combination with
  special result handling methods so that result rows are not fully buffered.
  Defaults to False, meaning cursors are buffered by default.

* ``max_row_buffer`` - when using ``stream_results``, an integer value that
  specifies the maximum number of rows to buffer at a time.  This is
  interpreted by the :class:`.BufferedRowCursorResult`, and if omitted the
  buffer will grow to ultimately store 1000 rows at a time.

  .. versionchanged:: 1.4  The ``max_row_buffer`` size can now be greater than
     1000, and the buffer will grow to that size.

.. _psycopg2_batch_mode:

.. _psycopg2_executemany_mode:

Psycopg2 Fast Execution Helpers
-------------------------------

Modern versions of psycopg2 include a feature known as
`Fast Execution Helpers \
<https://initd.org/psycopg/docs/extras.html#fast-execution-helpers>`_, which
have been shown in benchmarking to improve psycopg2's executemany()
performance, primarily with INSERT statements, by at least
an order of magnitude.

SQLAlchemy implements a native form of the "insert many values"
handler that will rewrite a single-row INSERT statement to accommodate for
many values at once within an extended VALUES clause; this handler is
equivalent to psycopg2's ``execute_values()`` handler; an overview of this
feature and its configuration are at :ref:`engine_insertmanyvalues`.

.. versionadded:: 2.0 Replaced psycopg2's ``execute_values()`` fast execution
   helper with a native SQLAlchemy mechanism known as
   :ref:`insertmanyvalues <engine_insertmanyvalues>`.

The psycopg2 dialect retains the ability to use the psycopg2-specific
``execute_batch()`` feature, although it is not expected that this is a widely
used feature.  The use of this extension may be enabled using the
``executemany_mode`` flag which may be passed to :func:`_sa.create_engine`::

    engine = create_engine(
        "postgresql+psycopg2://scott:tiger@host/dbname",
        executemany_mode='values_plus_batch')


Possible options for ``executemany_mode`` include:

* ``values_only`` - this is the default value.  SQLAlchemy's native
  :ref:`insertmanyvalues <engine_insertmanyvalues>` handler is used for qualifying
  INSERT statements, assuming
  :paramref:`_sa.create_engine.use_insertmanyvalues` is left at
  its default value of ``True``.  This handler rewrites simple
  INSERT statements to include multiple VALUES clauses so that many
  parameter sets can be inserted with one statement.

* ``'values_plus_batch'``- SQLAlchemy's native
  :ref:`insertmanyvalues <engine_insertmanyvalues>` handler is used for qualifying
  INSERT statements, assuming
  :paramref:`_sa.create_engine.use_insertmanyvalues` is left at its default
  value of ``True``. Then, psycopg2's ``execute_batch()`` handler is used for
  qualifying UPDATE and DELETE statements when executed with multiple parameter
  sets. When using this mode, the :attr:`_engine.CursorResult.rowcount`
  attribute will not contain a value for executemany-style executions against
  UPDATE and DELETE statements.

.. versionchanged:: 2.0 Removed the ``'batch'`` and ``'None'`` options
   from psycopg2 ``executemany_mode``.  Control over batching for INSERT
   statements is now configured via the
   :paramref:`_sa.create_engine.use_insertmanyvalues` engine-level parameter.

The term "qualifying statements" refers to the statement being executed
being a Core :func:`_expression.insert`, :func:`_expression.update`
or :func:`_expression.delete` construct, and **not** a plain textual SQL
string or one constructed using :func:`_expression.text`.  It also may **not** be
a special "extension" statement such as an "ON CONFLICT" "upsert" statement.
When using the ORM, all insert/update/delete statements used by the ORM flush process
are qualifying.

The "page size" for the psycopg2 "batch" strategy can be affected
by using the ``executemany_batch_page_size`` parameter, which defaults to
100.

For the "insertmanyvalues" feature, the page size can be controlled using the
:paramref:`_sa.create_engine.insertmanyvalues_page_size` parameter,
which defaults to 1000.  An example of modifying both parameters
is below::

    engine = create_engine(
        "postgresql+psycopg2://scott:tiger@host/dbname",
        executemany_mode='values_plus_batch',
        insertmanyvalues_page_size=5000, executemany_batch_page_size=500)

.. seealso::

    :ref:`engine_insertmanyvalues` - background on "insertmanyvalues"

    :ref:`tutorial_multiple_parameters` - General information on using the
    :class:`_engine.Connection`
    object to execute statements in such a way as to make
    use of the DBAPI ``.executemany()`` method.


.. _psycopg2_unicode:

Unicode with Psycopg2
----------------------

The psycopg2 DBAPI driver supports Unicode data transparently.

The client character encoding can be controlled for the psycopg2 dialect
in the following ways:

* For PostgreSQL 9.1 and above, the ``client_encoding`` parameter may be
  passed in the database URL; this parameter is consumed by the underlying
  ``libpq`` PostgreSQL client library::

    engine = create_engine("postgresql+psycopg2://user:pass@host/dbname?client_encoding=utf8")

  Alternatively, the above ``client_encoding`` value may be passed using
  :paramref:`_sa.create_engine.connect_args` for programmatic establishment with
  ``libpq``::

    engine = create_engine(
        "postgresql+psycopg2://user:pass@host/dbname",
        connect_args={'client_encoding': 'utf8'}
    )

* For all PostgreSQL versions, psycopg2 supports a client-side encoding
  value that will be passed to database connections when they are first
  established.  The SQLAlchemy psycopg2 dialect supports this using the
  ``client_encoding`` parameter passed to :func:`_sa.create_engine`::

      engine = create_engine(
          "postgresql+psycopg2://user:pass@host/dbname",
          client_encoding="utf8"
      )

  .. tip:: The above ``client_encoding`` parameter admittedly is very similar
      in appearance to usage of the parameter within the
      :paramref:`_sa.create_engine.connect_args` dictionary; the difference
      above is that the parameter is consumed by psycopg2 and is
      passed to the database connection using ``SET client_encoding TO
      'utf8'``; in the previously mentioned style, the parameter is instead
      passed through psycopg2 and consumed by the ``libpq`` library.

* A common way to set up client encoding with PostgreSQL databases is to
  ensure it is configured within the server-side postgresql.conf file;
  this is the recommended way to set encoding for a server that is
  consistently of one encoding in all databases::

    # postgresql.conf file

    # client_encoding = sql_ascii # actually, defaults to database
                                 # encoding
    client_encoding = utf8



Transactions
------------

The psycopg2 dialect fully supports SAVEPOINT and two-phase commit operations.

.. _psycopg2_isolation_level:

Psycopg2 Transaction Isolation Level
-------------------------------------

As discussed in :ref:`postgresql_isolation_level`,
all PostgreSQL dialects support setting of transaction isolation level
both via the ``isolation_level`` parameter passed to :func:`_sa.create_engine`
,
as well as the ``isolation_level`` argument used by
:meth:`_engine.Connection.execution_options`.  When using the psycopg2 dialect
, these
options make use of psycopg2's ``set_isolation_level()`` connection method,
rather than emitting a PostgreSQL directive; this is because psycopg2's
API-level setting is always emitted at the start of each transaction in any
case.

The psycopg2 dialect supports these constants for isolation level:

* ``READ COMMITTED``
* ``READ UNCOMMITTED``
* ``REPEATABLE READ``
* ``SERIALIZABLE``
* ``AUTOCOMMIT``

.. seealso::

    :ref:`postgresql_isolation_level`

    :ref:`pg8000_isolation_level`


NOTICE logging
---------------

The psycopg2 dialect will log PostgreSQL NOTICE messages
via the ``sqlalchemy.dialects.postgresql`` logger.  When this logger
is set to the ``logging.INFO`` level, notice messages will be logged::

    import logging

    logging.getLogger('sqlalchemy.dialects.postgresql').setLevel(logging.INFO)

Above, it is assumed that logging is configured externally.  If this is not
the case, configuration such as ``logging.basicConfig()`` must be utilized::

    import logging

    logging.basicConfig()   # log messages to stdout
    logging.getLogger('sqlalchemy.dialects.postgresql').setLevel(logging.INFO)

.. seealso::

    `Logging HOWTO <https://docs.python.org/3/howto/logging.html>`_ - on the python.org website

.. _psycopg2_hstore:

HSTORE type
------------

The ``psycopg2`` DBAPI includes an extension to natively handle marshalling of
the HSTORE type.   The SQLAlchemy psycopg2 dialect will enable this extension
by default when psycopg2 version 2.4 or greater is used, and
it is detected that the target database has the HSTORE type set up for use.
In other words, when the dialect makes the first
connection, a sequence like the following is performed:

1. Request the available HSTORE oids using
   ``psycopg2.extras.HstoreAdapter.get_oids()``.
   If this function returns a list of HSTORE identifiers, we then determine
   that the ``HSTORE`` extension is present.
   This function is **skipped** if the version of psycopg2 installed is
   less than version 2.4.

2. If the ``use_native_hstore`` flag is at its default of ``True``, and
   we've detected that ``HSTORE`` oids are available, the
   ``psycopg2.extensions.register_hstore()`` extension is invoked for all
   connections.

The ``register_hstore()`` extension has the effect of **all Python
dictionaries being accepted as parameters regardless of the type of target
column in SQL**. The dictionaries are converted by this extension into a
textual HSTORE expression.  If this behavior is not desired, disable the
use of the hstore extension by setting ``use_native_hstore`` to ``False`` as
follows::

    engine = create_engine("postgresql+psycopg2://scott:tiger@localhost/test",
                use_native_hstore=False)

The ``HSTORE`` type is **still supported** when the
``psycopg2.extensions.register_hstore()`` extension is not used.  It merely
means that the coercion between Python dictionaries and the HSTORE
string format, on both the parameter side and the result side, will take
place within SQLAlchemy's own marshalling logic, and not that of ``psycopg2``
which may be more performant.

"""  # noqa
from __future__ import annotations

import collections.abc as collections_abc
import logging
import re
from typing import cast

from . import ranges
from ._psycopg_common import _PGDialect_common_psycopg
from ._psycopg_common import _PGExecutionContext_common_psycopg
from .base import PGIdentifierPreparer
from .json import JSON
from .json import JSONB
from ... import types as sqltypes
from ... import util
from ...util import FastIntFlag
from ...util import parse_user_argument_for_enum

logger = logging.getLogger("sqlalchemy.dialects.postgresql")


class _PGJSON(JSON):
    def result_processor(self, dialect, coltype):
        return None


class _PGJSONB(JSONB):
    def result_processor(self, dialect, coltype):
        return None


class _Psycopg2Range(ranges.AbstractRangeImpl):
    _psycopg2_range_cls = "none"

    def bind_processor(self, dialect):
        psycopg2_Range = getattr(
            cast(PGDialect_psycopg2, dialect)._psycopg2_extras,
            self._psycopg2_range_cls,
        )

        def to_range(value):
            if isinstance(value, ranges.Range):
                value = psycopg2_Range(
                    value.lower, value.upper, value.bounds, value.empty
                )
            return value

        return to_range

    def result_processor(self, dialect, coltype):
        def to_range(value):
            if value is not None:
                value = ranges.Range(
                    value._lower,
                    value._upper,
                    bounds=value._bounds if value._bounds else "[)",
                    empty=not value._bounds,
                )
            return value

        return to_range


class _Psycopg2NumericRange(_Psycopg2Range):
    _psycopg2_range_cls = "NumericRange"


class _Psycopg2DateRange(_Psycopg2Range):
    _psycopg2_range_cls = "DateRange"


class _Psycopg2DateTimeRange(_Psycopg2Range):
    _psycopg2_range_cls = "DateTimeRange"


class _Psycopg2DateTimeTZRange(_Psycopg2Range):
    _psycopg2_range_cls = "DateTimeTZRange"


class PGExecutionContext_psycopg2(_PGExecutionContext_common_psycopg):
    _psycopg2_fetched_rows = None

    def post_exec(self):
        self._log_notices(self.cursor)

    def _log_notices(self, cursor):
        # check also that notices is an iterable, after it's already
        # established that we will be iterating through it.  This is to get
        # around test suites such as SQLAlchemy's using a Mock object for
        # cursor
        if not cursor.connection.notices or not isinstance(
            cursor.connection.notices, collections_abc.Iterable
        ):
            return

        for notice in cursor.connection.notices:
            # NOTICE messages have a
            # newline character at the end
            logger.info(notice.rstrip())

        cursor.connection.notices[:] = []


class PGIdentifierPreparer_psycopg2(PGIdentifierPreparer):
    pass


class ExecutemanyMode(FastIntFlag):
    EXECUTEMANY_VALUES = 0
    EXECUTEMANY_VALUES_PLUS_BATCH = 1


(
    EXECUTEMANY_VALUES,
    EXECUTEMANY_VALUES_PLUS_BATCH,
) = ExecutemanyMode.__members__.values()


class PGDialect_psycopg2(_PGDialect_common_psycopg):
    driver = "psycopg2"

    supports_statement_cache = True
    supports_server_side_cursors = True

    default_paramstyle = "pyformat"
    # set to true based on psycopg2 version
    supports_sane_multi_rowcount = False
    execution_ctx_cls = PGExecutionContext_psycopg2
    preparer = PGIdentifierPreparer_psycopg2
    psycopg2_version = (0, 0)
    use_insertmanyvalues_wo_returning = True

    returns_native_bytes = False

    _has_native_hstore = True

    colspecs = util.update_copy(
        _PGDialect_common_psycopg.colspecs,
        {
            JSON: _PGJSON,
            sqltypes.JSON: _PGJSON,
            JSONB: _PGJSONB,
            ranges.INT4RANGE: _Psycopg2NumericRange,
            ranges.INT8RANGE: _Psycopg2NumericRange,
            ranges.NUMRANGE: _Psycopg2NumericRange,
            ranges.DATERANGE: _Psycopg2DateRange,
            ranges.TSRANGE: _Psycopg2DateTimeRange,
            ranges.TSTZRANGE: _Psycopg2DateTimeTZRange,
        },
    )

    def __init__(
        self,
        executemany_mode="values_only",
        executemany_batch_page_size=100,
        **kwargs,
    ):
        _PGDialect_common_psycopg.__init__(self, **kwargs)

        if self._native_inet_types:
            raise NotImplementedError(
                "The psycopg2 dialect does not implement "
                "ipaddress type handling; native_inet_types cannot be set "
                "to ``True`` when using this dialect."
            )

        # Parse executemany_mode argument, allowing it to be only one of the
        # symbol names
        self.executemany_mode = parse_user_argument_for_enum(
            executemany_mode,
            {
                EXECUTEMANY_VALUES: ["values_only"],
                EXECUTEMANY_VALUES_PLUS_BATCH: ["values_plus_batch"],
            },
            "executemany_mode",
        )

        self.executemany_batch_page_size = executemany_batch_page_size

        if self.dbapi and hasattr(self.dbapi, "__version__"):
            m = re.match(r"(\d+)\.(\d+)(?:\.(\d+))?", self.dbapi.__version__)
            if m:
                self.psycopg2_version = tuple(
                    int(x) for x in m.group(1, 2, 3) if x is not None
                )

            if self.psycopg2_version < (2, 7):
                raise ImportError(
                    "psycopg2 version 2.7 or higher is required."
                )

    def initialize(self, connection):
        super().initialize(connection)
        self._has_native_hstore = (
            self.use_native_hstore
            and self._hstore_oids(connection.connection.dbapi_connection)
            is not None
        )

        self.supports_sane_multi_rowcount = (
            self.executemany_mode is not EXECUTEMANY_VALUES_PLUS_BATCH
        )

    @classmethod
    def import_dbapi(cls):
        import psycopg2

        return psycopg2

    @util.memoized_property
    def _psycopg2_extensions(cls):
        from psycopg2 import extensions

        return extensions

    @util.memoized_property
    def _psycopg2_extras(cls):
        from psycopg2 import extras

        return extras

    @util.memoized_property
    def _isolation_lookup(self):
        extensions = self._psycopg2_extensions
        return {
            "AUTOCOMMIT": extensions.ISOLATION_LEVEL_AUTOCOMMIT,
            "READ COMMITTED": extensions.ISOLATION_LEVEL_READ_COMMITTED,
            "READ UNCOMMITTED": extensions.ISOLATION_LEVEL_READ_UNCOMMITTED,
            "REPEATABLE READ": extensions.ISOLATION_LEVEL_REPEATABLE_READ,
            "SERIALIZABLE": extensions.ISOLATION_LEVEL_SERIALIZABLE,
        }

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

    def on_connect(self):
        extras = self._psycopg2_extras

        fns = []
        if self.client_encoding is not None:

            def on_connect(dbapi_conn):
                dbapi_conn.set_client_encoding(self.client_encoding)

            fns.append(on_connect)

        if self.dbapi:

            def on_connect(dbapi_conn):
                extras.register_uuid(None, dbapi_conn)

            fns.append(on_connect)

        if self.dbapi and self.use_native_hstore:

            def on_connect(dbapi_conn):
                hstore_oids = self._hstore_oids(dbapi_conn)
                if hstore_oids is not None:
                    oid, array_oid = hstore_oids
                    kw = {"oid": oid}
                    kw["array_oid"] = array_oid
                    extras.register_hstore(dbapi_conn, **kw)

            fns.append(on_connect)

        if self.dbapi and self._json_deserializer:

            def on_connect(dbapi_conn):
                extras.register_default_json(
                    dbapi_conn, loads=self._json_deserializer
                )
                extras.register_default_jsonb(
                    dbapi_conn, loads=self._json_deserializer
                )

            fns.append(on_connect)

        if fns:

            def on_connect(dbapi_conn):
                for fn in fns:
                    fn(dbapi_conn)

            return on_connect
        else:
            return None

    def do_executemany(self, cursor, statement, parameters, context=None):
        if self.executemany_mode is EXECUTEMANY_VALUES_PLUS_BATCH:
            if self.executemany_batch_page_size:
                kwargs = {"page_size": self.executemany_batch_page_size}
            else:
                kwargs = {}
            self._psycopg2_extras.execute_batch(
                cursor, statement, parameters, **kwargs
            )
        else:
            cursor.executemany(statement, parameters)

    def do_begin_twophase(self, connection, xid):
        connection.connection.tpc_begin(xid)

    def do_prepare_twophase(self, connection, xid):
        connection.connection.tpc_prepare()

    def _do_twophase(self, dbapi_conn, operation, xid, recover=False):
        if recover:
            if dbapi_conn.status != self._psycopg2_extensions.STATUS_READY:
                dbapi_conn.rollback()
            operation(xid)
        else:
            operation()

    def do_rollback_twophase(
        self, connection, xid, is_prepared=True, recover=False
    ):
        dbapi_conn = connection.connection.dbapi_connection
        self._do_twophase(
            dbapi_conn, dbapi_conn.tpc_rollback, xid, recover=recover
        )

    def do_commit_twophase(
        self, connection, xid, is_prepared=True, recover=False
    ):
        dbapi_conn = connection.connection.dbapi_connection
        self._do_twophase(
            dbapi_conn, dbapi_conn.tpc_commit, xid, recover=recover
        )

    @util.memoized_instancemethod
    def _hstore_oids(self, dbapi_connection):
        extras = self._psycopg2_extras
        oids = extras.HstoreAdapter.get_oids(dbapi_connection)
        if oids is not None and oids[0]:
            return oids[0:2]
        else:
            return None

    def is_disconnect(self, e, connection, cursor):
        if isinstance(e, self.dbapi.Error):
            # check the "closed" flag.  this might not be
            # present on old psycopg2 versions.   Also,
            # this flag doesn't actually help in a lot of disconnect
            # situations, so don't rely on it.
            if getattr(connection, "closed", False):
                return True

            # checks based on strings.  in the case that .closed
            # didn't cut it, fall back onto these.
            str_e = str(e).partition("\n")[0]
            for msg in [
                # these error messages from libpq: interfaces/libpq/fe-misc.c
                # and interfaces/libpq/fe-secure.c.
                "terminating connection",
                "closed the connection",
                "connection not open",
                "could not receive data from server",
                "could not send data to server",
                # psycopg2 client errors, psycopg2/connection.h,
                # psycopg2/cursor.h
                "connection already closed",
                "cursor already closed",
                # not sure where this path is originally from, it may
                # be obsolete.   It really says "losed", not "closed".
                "losed the connection unexpectedly",
                # these can occur in newer SSL
                "connection has been closed unexpectedly",
                "SSL error: decryption failed or bad record mac",
                "SSL SYSCALL error: Bad file descriptor",
                "SSL SYSCALL error: EOF detected",
                "SSL SYSCALL error: Operation timed out",
                "SSL SYSCALL error: Bad address",
            ]:
                idx = str_e.find(msg)
                if idx >= 0 and '"' not in str_e[:idx]:
                    return True
        return False


dialect = PGDialect_psycopg2
