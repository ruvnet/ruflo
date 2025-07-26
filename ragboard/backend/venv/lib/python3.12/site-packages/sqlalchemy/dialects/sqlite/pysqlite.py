# dialects/sqlite/pysqlite.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors


r"""
.. dialect:: sqlite+pysqlite
    :name: pysqlite
    :dbapi: sqlite3
    :connectstring: sqlite+pysqlite:///file_path
    :url: https://docs.python.org/library/sqlite3.html

    Note that ``pysqlite`` is the same driver as the ``sqlite3``
    module included with the Python distribution.

Driver
------

The ``sqlite3`` Python DBAPI is standard on all modern Python versions;
for cPython and Pypy, no additional installation is necessary.


Connect Strings
---------------

The file specification for the SQLite database is taken as the "database"
portion of the URL.  Note that the format of a SQLAlchemy url is::

    driver://user:pass@host/database

This means that the actual filename to be used starts with the characters to
the **right** of the third slash.   So connecting to a relative filepath
looks like::

    # relative path
    e = create_engine('sqlite:///path/to/database.db')

An absolute path, which is denoted by starting with a slash, means you
need **four** slashes::

    # absolute path
    e = create_engine('sqlite:////path/to/database.db')

To use a Windows path, regular drive specifications and backslashes can be
used. Double backslashes are probably needed::

    # absolute path on Windows
    e = create_engine('sqlite:///C:\\path\\to\\database.db')

The sqlite ``:memory:`` identifier is the default if no filepath is
present.  Specify ``sqlite://`` and nothing else::

    # in-memory database
    e = create_engine('sqlite://')

.. _pysqlite_uri_connections:

URI Connections
^^^^^^^^^^^^^^^

Modern versions of SQLite support an alternative system of connecting using a
`driver level URI <https://www.sqlite.org/uri.html>`_, which has the  advantage
that additional driver-level arguments can be passed including options such as
"read only".   The Python sqlite3 driver supports this mode under modern Python
3 versions.   The SQLAlchemy pysqlite driver supports this mode of use by
specifying "uri=true" in the URL query string.  The SQLite-level "URI" is kept
as the "database" portion of the SQLAlchemy url (that is, following a slash)::

    e = create_engine("sqlite:///file:path/to/database?mode=ro&uri=true")

.. note::  The "uri=true" parameter must appear in the **query string**
   of the URL.  It will not currently work as expected if it is only
   present in the :paramref:`_sa.create_engine.connect_args`
   parameter dictionary.

The logic reconciles the simultaneous presence of SQLAlchemy's query string and
SQLite's query string by separating out the parameters that belong to the
Python sqlite3 driver vs. those that belong to the SQLite URI.  This is
achieved through the use of a fixed list of parameters known to be accepted by
the Python side of the driver.  For example, to include a URL that indicates
the Python sqlite3 "timeout" and "check_same_thread" parameters, along with the
SQLite "mode" and "nolock" parameters, they can all be passed together on the
query string::

    e = create_engine(
        "sqlite:///file:path/to/database?"
        "check_same_thread=true&timeout=10&mode=ro&nolock=1&uri=true"
    )

Above, the pysqlite / sqlite3 DBAPI would be passed arguments as::

    sqlite3.connect(
        "file:path/to/database?mode=ro&nolock=1",
        check_same_thread=True, timeout=10, uri=True
    )

Regarding future parameters added to either the Python or native drivers. new
parameter names added to the SQLite URI scheme should be automatically
accommodated by this scheme.  New parameter names added to the Python driver
side can be accommodated by specifying them in the
:paramref:`_sa.create_engine.connect_args` dictionary,
until dialect support is
added by SQLAlchemy.   For the less likely case that the native SQLite driver
adds a new parameter name that overlaps with one of the existing, known Python
driver parameters (such as "timeout" perhaps), SQLAlchemy's dialect would
require adjustment for the URL scheme to continue to support this.

As is always the case for all SQLAlchemy dialects, the entire "URL" process
can be bypassed in :func:`_sa.create_engine` through the use of the
:paramref:`_sa.create_engine.creator`
parameter which allows for a custom callable
that creates a Python sqlite3 driver level connection directly.

.. versionadded:: 1.3.9

.. seealso::

    `Uniform Resource Identifiers <https://www.sqlite.org/uri.html>`_ - in
    the SQLite documentation

.. _pysqlite_regexp:

Regular Expression Support
---------------------------

.. versionadded:: 1.4

Support for the :meth:`_sql.ColumnOperators.regexp_match` operator is provided
using Python's re.search_ function.  SQLite itself does not include a working
regular expression operator; instead, it includes a non-implemented placeholder
operator ``REGEXP`` that calls a user-defined function that must be provided.

SQLAlchemy's implementation makes use of the pysqlite create_function_ hook
as follows::


    def regexp(a, b):
        return re.search(a, b) is not None

    sqlite_connection.create_function(
        "regexp", 2, regexp,
    )

There is currently no support for regular expression flags as a separate
argument, as these are not supported by SQLite's REGEXP operator, however these
may be included inline within the regular expression string.  See `Python regular expressions`_ for
details.

.. seealso::

    `Python regular expressions`_: Documentation for Python's regular expression syntax.

.. _create_function: https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.create_function

.. _re.search: https://docs.python.org/3/library/re.html#re.search

.. _Python regular expressions: https://docs.python.org/3/library/re.html#re.search



Compatibility with sqlite3 "native" date and datetime types
-----------------------------------------------------------

The pysqlite driver includes the sqlite3.PARSE_DECLTYPES and
sqlite3.PARSE_COLNAMES options, which have the effect of any column
or expression explicitly cast as "date" or "timestamp" will be converted
to a Python date or datetime object.  The date and datetime types provided
with the pysqlite dialect are not currently compatible with these options,
since they render the ISO date/datetime including microseconds, which
pysqlite's driver does not.   Additionally, SQLAlchemy does not at
this time automatically render the "cast" syntax required for the
freestanding functions "current_timestamp" and "current_date" to return
datetime/date types natively.   Unfortunately, pysqlite
does not provide the standard DBAPI types in ``cursor.description``,
leaving SQLAlchemy with no way to detect these types on the fly
without expensive per-row type checks.

Keeping in mind that pysqlite's parsing option is not recommended,
nor should be necessary, for use with SQLAlchemy, usage of PARSE_DECLTYPES
can be forced if one configures "native_datetime=True" on create_engine()::

    engine = create_engine('sqlite://',
        connect_args={'detect_types':
            sqlite3.PARSE_DECLTYPES|sqlite3.PARSE_COLNAMES},
        native_datetime=True
    )

With this flag enabled, the DATE and TIMESTAMP types (but note - not the
DATETIME or TIME types...confused yet ?) will not perform any bind parameter
or result processing. Execution of "func.current_date()" will return a string.
"func.current_timestamp()" is registered as returning a DATETIME type in
SQLAlchemy, so this function still receives SQLAlchemy-level result
processing.

.. _pysqlite_threading_pooling:

Threading/Pooling Behavior
---------------------------

The ``sqlite3`` DBAPI by default prohibits the use of a particular connection
in a thread which is not the one in which it was created.  As SQLite has
matured, it's behavior under multiple threads has improved, and even includes
options for memory only databases to be used in multiple threads.

The thread prohibition is known as "check same thread" and may be controlled
using the ``sqlite3`` parameter ``check_same_thread``, which will disable or
enable this check. SQLAlchemy's default behavior here is to set
``check_same_thread`` to ``False`` automatically whenever a file-based database
is in use, to establish compatibility with the default pool class
:class:`.QueuePool`.

The SQLAlchemy ``pysqlite`` DBAPI establishes the connection pool differently
based on the kind of SQLite database that's requested:

* When a ``:memory:`` SQLite database is specified, the dialect by default
  will use :class:`.SingletonThreadPool`. This pool maintains a single
  connection per thread, so that all access to the engine within the current
  thread use the same ``:memory:`` database - other threads would access a
  different ``:memory:`` database.  The ``check_same_thread`` parameter
  defaults to ``True``.
* When a file-based database is specified, the dialect will use
  :class:`.QueuePool` as the source of connections.   at the same time,
  the ``check_same_thread`` flag is set to False by default unless overridden.

  .. versionchanged:: 2.0

    SQLite file database engines now use :class:`.QueuePool` by default.
    Previously, :class:`.NullPool` were used.  The :class:`.NullPool` class
    may be used by specifying it via the
    :paramref:`_sa.create_engine.poolclass` parameter.

Disabling Connection Pooling for File Databases
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

Pooling may be disabled for a file based database by specifying the
:class:`.NullPool` implementation for the :func:`_sa.create_engine.poolclass`
parameter::

    from sqlalchemy import NullPool
    engine = create_engine("sqlite:///myfile.db", poolclass=NullPool)

It's been observed that the :class:`.NullPool` implementation incurs an
extremely small performance overhead for repeated checkouts due to the lack of
connection re-use implemented by :class:`.QueuePool`.  However, it still
may be beneficial to use this class if the application is experiencing
issues with files being locked.

Using a Memory Database in Multiple Threads
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

To use a ``:memory:`` database in a multithreaded scenario, the same
connection object must be shared among threads, since the database exists
only within the scope of that connection.   The
:class:`.StaticPool` implementation will maintain a single connection
globally, and the ``check_same_thread`` flag can be passed to Pysqlite
as ``False``::

    from sqlalchemy.pool import StaticPool
    engine = create_engine('sqlite://',
                        connect_args={'check_same_thread':False},
                        poolclass=StaticPool)

Note that using a ``:memory:`` database in multiple threads requires a recent
version of SQLite.

Using Temporary Tables with SQLite
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

Due to the way SQLite deals with temporary tables, if you wish to use a
temporary table in a file-based SQLite database across multiple checkouts
from the connection pool, such as when using an ORM :class:`.Session` where
the temporary table should continue to remain after :meth:`.Session.commit` or
:meth:`.Session.rollback` is called, a pool which maintains a single
connection must be used.   Use :class:`.SingletonThreadPool` if the scope is
only needed within the current thread, or :class:`.StaticPool` is scope is
needed within multiple threads for this case::

    # maintain the same connection per thread
    from sqlalchemy.pool import SingletonThreadPool
    engine = create_engine('sqlite:///mydb.db',
                        poolclass=SingletonThreadPool)


    # maintain the same connection across all threads
    from sqlalchemy.pool import StaticPool
    engine = create_engine('sqlite:///mydb.db',
                        poolclass=StaticPool)

Note that :class:`.SingletonThreadPool` should be configured for the number
of threads that are to be used; beyond that number, connections will be
closed out in a non deterministic way.


Dealing with Mixed String / Binary Columns
------------------------------------------------------

The SQLite database is weakly typed, and as such it is possible when using
binary values, which in Python are represented as ``b'some string'``, that a
particular SQLite database can have data values within different rows where
some of them will be returned as a ``b''`` value by the Pysqlite driver, and
others will be returned as Python strings, e.g. ``''`` values.   This situation
is not known to occur if the SQLAlchemy :class:`.LargeBinary` datatype is used
consistently, however if a particular SQLite database has data that was
inserted using the Pysqlite driver directly, or when using the SQLAlchemy
:class:`.String` type which was later changed to :class:`.LargeBinary`, the
table will not be consistently readable because SQLAlchemy's
:class:`.LargeBinary` datatype does not handle strings so it has no way of
"encoding" a value that is in string format.

To deal with a SQLite table that has mixed string / binary data in the
same column, use a custom type that will check each row individually::

    from sqlalchemy import String
    from sqlalchemy import TypeDecorator

    class MixedBinary(TypeDecorator):
        impl = String
        cache_ok = True

        def process_result_value(self, value, dialect):
            if isinstance(value, str):
                value = bytes(value, 'utf-8')
            elif value is not None:
                value = bytes(value)

            return value

Then use the above ``MixedBinary`` datatype in the place where
:class:`.LargeBinary` would normally be used.

.. _pysqlite_serializable:

Serializable isolation / Savepoints / Transactional DDL
-------------------------------------------------------

In the section :ref:`sqlite_concurrency`, we refer to the pysqlite
driver's assortment of issues that prevent several features of SQLite
from working correctly.  The pysqlite DBAPI driver has several
long-standing bugs which impact the correctness of its transactional
behavior.   In its default mode of operation, SQLite features such as
SERIALIZABLE isolation, transactional DDL, and SAVEPOINT support are
non-functional, and in order to use these features, workarounds must
be taken.

The issue is essentially that the driver attempts to second-guess the user's
intent, failing to start transactions and sometimes ending them prematurely, in
an effort to minimize the SQLite databases's file locking behavior, even
though SQLite itself uses "shared" locks for read-only activities.

SQLAlchemy chooses to not alter this behavior by default, as it is the
long-expected behavior of the pysqlite driver; if and when the pysqlite
driver attempts to repair these issues, that will be more of a driver towards
defaults for SQLAlchemy.

The good news is that with a few events, we can implement transactional
support fully, by disabling pysqlite's feature entirely and emitting BEGIN
ourselves. This is achieved using two event listeners::

    from sqlalchemy import create_engine, event

    engine = create_engine("sqlite:///myfile.db")

    @event.listens_for(engine, "connect")
    def do_connect(dbapi_connection, connection_record):
        # disable pysqlite's emitting of the BEGIN statement entirely.
        # also stops it from emitting COMMIT before any DDL.
        dbapi_connection.isolation_level = None

    @event.listens_for(engine, "begin")
    def do_begin(conn):
        # emit our own BEGIN
        conn.exec_driver_sql("BEGIN")

.. warning:: When using the above recipe, it is advised to not use the
   :paramref:`.Connection.execution_options.isolation_level` setting on
   :class:`_engine.Connection` and :func:`_sa.create_engine`
   with the SQLite driver,
   as this function necessarily will also alter the ".isolation_level" setting.


Above, we intercept a new pysqlite connection and disable any transactional
integration.   Then, at the point at which SQLAlchemy knows that transaction
scope is to begin, we emit ``"BEGIN"`` ourselves.

When we take control of ``"BEGIN"``, we can also control directly SQLite's
locking modes, introduced at
`BEGIN TRANSACTION <https://sqlite.org/lang_transaction.html>`_,
by adding the desired locking mode to our ``"BEGIN"``::

    @event.listens_for(engine, "begin")
    def do_begin(conn):
        conn.exec_driver_sql("BEGIN EXCLUSIVE")

.. seealso::

    `BEGIN TRANSACTION <https://sqlite.org/lang_transaction.html>`_ -
    on the SQLite site

    `sqlite3 SELECT does not BEGIN a transaction <https://bugs.python.org/issue9924>`_ -
    on the Python bug tracker

    `sqlite3 module breaks transactions and potentially corrupts data <https://bugs.python.org/issue10740>`_ -
    on the Python bug tracker

.. _pysqlite_udfs:

User-Defined Functions
----------------------

pysqlite supports a `create_function() <https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.create_function>`_
method that allows us to create our own user-defined functions (UDFs) in Python and use them directly in SQLite queries.
These functions are registered with a specific DBAPI Connection.

SQLAlchemy uses connection pooling with file-based SQLite databases, so we need to ensure that the UDF is attached to the
connection when it is created. That is accomplished with an event listener::

    from sqlalchemy import create_engine
    from sqlalchemy import event
    from sqlalchemy import text


    def udf():
        return "udf-ok"


    engine = create_engine("sqlite:///./db_file")


    @event.listens_for(engine, "connect")
    def connect(conn, rec):
        conn.create_function("udf", 0, udf)


    for i in range(5):
        with engine.connect() as conn:
            print(conn.scalar(text("SELECT UDF()")))


"""  # noqa

import math
import os
import re

from .base import DATE
from .base import DATETIME
from .base import SQLiteDialect
from ... import exc
from ... import pool
from ... import types as sqltypes
from ... import util


class _SQLite_pysqliteTimeStamp(DATETIME):
    def bind_processor(self, dialect):
        if dialect.native_datetime:
            return None
        else:
            return DATETIME.bind_processor(self, dialect)

    def result_processor(self, dialect, coltype):
        if dialect.native_datetime:
            return None
        else:
            return DATETIME.result_processor(self, dialect, coltype)


class _SQLite_pysqliteDate(DATE):
    def bind_processor(self, dialect):
        if dialect.native_datetime:
            return None
        else:
            return DATE.bind_processor(self, dialect)

    def result_processor(self, dialect, coltype):
        if dialect.native_datetime:
            return None
        else:
            return DATE.result_processor(self, dialect, coltype)


class SQLiteDialect_pysqlite(SQLiteDialect):
    default_paramstyle = "qmark"
    supports_statement_cache = True
    returns_native_bytes = True

    colspecs = util.update_copy(
        SQLiteDialect.colspecs,
        {
            sqltypes.Date: _SQLite_pysqliteDate,
            sqltypes.TIMESTAMP: _SQLite_pysqliteTimeStamp,
        },
    )

    description_encoding = None

    driver = "pysqlite"

    @classmethod
    def import_dbapi(cls):
        from sqlite3 import dbapi2 as sqlite

        return sqlite

    @classmethod
    def _is_url_file_db(cls, url):
        if (url.database and url.database != ":memory:") and (
            url.query.get("mode", None) != "memory"
        ):
            return True
        else:
            return False

    @classmethod
    def get_pool_class(cls, url):
        if cls._is_url_file_db(url):
            return pool.QueuePool
        else:
            return pool.SingletonThreadPool

    def _get_server_version_info(self, connection):
        return self.dbapi.sqlite_version_info

    _isolation_lookup = SQLiteDialect._isolation_lookup.union(
        {
            "AUTOCOMMIT": None,
        }
    )

    def set_isolation_level(self, dbapi_connection, level):
        if level == "AUTOCOMMIT":
            dbapi_connection.isolation_level = None
        else:
            dbapi_connection.isolation_level = ""
            return super().set_isolation_level(dbapi_connection, level)

    def on_connect(self):
        def regexp(a, b):
            if b is None:
                return None
            return re.search(a, b) is not None

        if util.py38 and self._get_server_version_info(None) >= (3, 9):
            # sqlite must be greater than 3.8.3 for deterministic=True
            # https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.create_function
            # the check is more conservative since there were still issues
            # with following 3.8 sqlite versions
            create_func_kw = {"deterministic": True}
        else:
            create_func_kw = {}

        def set_regexp(dbapi_connection):
            dbapi_connection.create_function(
                "regexp", 2, regexp, **create_func_kw
            )

        def floor_func(dbapi_connection):
            # NOTE: floor is optionally present in sqlite 3.35+ , however
            # as it is normally non-present we deliver floor() unconditionally
            # for now.
            # https://www.sqlite.org/lang_mathfunc.html
            dbapi_connection.create_function(
                "floor", 1, math.floor, **create_func_kw
            )

        fns = [set_regexp, floor_func]

        def connect(conn):
            for fn in fns:
                fn(conn)

        return connect

    def create_connect_args(self, url):
        if url.username or url.password or url.host or url.port:
            raise exc.ArgumentError(
                "Invalid SQLite URL: %s\n"
                "Valid SQLite URL forms are:\n"
                " sqlite:///:memory: (or, sqlite://)\n"
                " sqlite:///relative/path/to/file.db\n"
                " sqlite:////absolute/path/to/file.db" % (url,)
            )

        # theoretically, this list can be augmented, at least as far as
        # parameter names accepted by sqlite3/pysqlite, using
        # inspect.getfullargspec().  for the moment this seems like overkill
        # as these parameters don't change very often, and as always,
        # parameters passed to connect_args will always go to the
        # sqlite3/pysqlite driver.
        pysqlite_args = [
            ("uri", bool),
            ("timeout", float),
            ("isolation_level", str),
            ("detect_types", int),
            ("check_same_thread", bool),
            ("cached_statements", int),
        ]
        opts = url.query
        pysqlite_opts = {}
        for key, type_ in pysqlite_args:
            util.coerce_kw_type(opts, key, type_, dest=pysqlite_opts)

        if pysqlite_opts.get("uri", False):
            uri_opts = dict(opts)
            # here, we are actually separating the parameters that go to
            # sqlite3/pysqlite vs. those that go the SQLite URI.  What if
            # two names conflict?  again, this seems to be not the case right
            # now, and in the case that new names are added to
            # either side which overlap, again the sqlite3/pysqlite parameters
            # can be passed through connect_args instead of in the URL.
            # If SQLite native URIs add a parameter like "timeout" that
            # we already have listed here for the python driver, then we need
            # to adjust for that here.
            for key, type_ in pysqlite_args:
                uri_opts.pop(key, None)
            filename = url.database
            if uri_opts:
                # sorting of keys is for unit test support
                filename += "?" + (
                    "&".join(
                        "%s=%s" % (key, uri_opts[key])
                        for key in sorted(uri_opts)
                    )
                )
        else:
            filename = url.database or ":memory:"
            if filename != ":memory:":
                filename = os.path.abspath(filename)

        pysqlite_opts.setdefault(
            "check_same_thread", not self._is_url_file_db(url)
        )

        return ([filename], pysqlite_opts)

    def is_disconnect(self, e, connection, cursor):
        return isinstance(
            e, self.dbapi.ProgrammingError
        ) and "Cannot operate on a closed database." in str(e)


dialect = SQLiteDialect_pysqlite


class _SQLiteDialect_pysqlite_numeric(SQLiteDialect_pysqlite):
    """numeric dialect for testing only

    internal use only.  This dialect is **NOT** supported by SQLAlchemy
    and may change at any time.

    """

    supports_statement_cache = True
    default_paramstyle = "numeric"
    driver = "pysqlite_numeric"

    _first_bind = ":1"
    _not_in_statement_regexp = None

    def __init__(self, *arg, **kw):
        kw.setdefault("paramstyle", "numeric")
        super().__init__(*arg, **kw)

    def create_connect_args(self, url):
        arg, opts = super().create_connect_args(url)
        opts["factory"] = self._fix_sqlite_issue_99953()
        return arg, opts

    def _fix_sqlite_issue_99953(self):
        import sqlite3

        first_bind = self._first_bind
        if self._not_in_statement_regexp:
            nis = self._not_in_statement_regexp

            def _test_sql(sql):
                m = nis.search(sql)
                assert not m, f"Found {nis.pattern!r} in {sql!r}"

        else:

            def _test_sql(sql):
                pass

        def _numeric_param_as_dict(parameters):
            if parameters:
                assert isinstance(parameters, tuple)
                return {
                    str(idx): value for idx, value in enumerate(parameters, 1)
                }
            else:
                return ()

        class SQLiteFix99953Cursor(sqlite3.Cursor):
            def execute(self, sql, parameters=()):
                _test_sql(sql)
                if first_bind in sql:
                    parameters = _numeric_param_as_dict(parameters)
                return super().execute(sql, parameters)

            def executemany(self, sql, parameters):
                _test_sql(sql)
                if first_bind in sql:
                    parameters = [
                        _numeric_param_as_dict(p) for p in parameters
                    ]
                return super().executemany(sql, parameters)

        class SQLiteFix99953Connection(sqlite3.Connection):
            def cursor(self, factory=None):
                if factory is None:
                    factory = SQLiteFix99953Cursor
                return super().cursor(factory=factory)

            def execute(self, sql, parameters=()):
                _test_sql(sql)
                if first_bind in sql:
                    parameters = _numeric_param_as_dict(parameters)
                return super().execute(sql, parameters)

            def executemany(self, sql, parameters):
                _test_sql(sql)
                if first_bind in sql:
                    parameters = [
                        _numeric_param_as_dict(p) for p in parameters
                    ]
                return super().executemany(sql, parameters)

        return SQLiteFix99953Connection


class _SQLiteDialect_pysqlite_dollar(_SQLiteDialect_pysqlite_numeric):
    """numeric dialect that uses $ for testing only

    internal use only.  This dialect is **NOT** supported by SQLAlchemy
    and may change at any time.

    """

    supports_statement_cache = True
    default_paramstyle = "numeric_dollar"
    driver = "pysqlite_dollar"

    _first_bind = "$1"
    _not_in_statement_regexp = re.compile(r"[^\d]:\d+")

    def __init__(self, *arg, **kw):
        kw.setdefault("paramstyle", "numeric_dollar")
        super().__init__(*arg, **kw)
