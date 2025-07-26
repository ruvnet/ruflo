# engine/create.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

import inspect
import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import Dict
from typing import List
from typing import Optional
from typing import overload
from typing import Type
from typing import Union

from . import base
from . import url as _url
from .interfaces import DBAPIConnection
from .mock import create_mock_engine
from .. import event
from .. import exc
from .. import util
from ..pool import _AdhocProxiedConnection
from ..pool import ConnectionPoolEntry
from ..sql import compiler
from ..util import immutabledict

if typing.TYPE_CHECKING:
    from .base import Engine
    from .interfaces import _ExecuteOptions
    from .interfaces import _ParamStyle
    from .interfaces import IsolationLevel
    from .url import URL
    from ..log import _EchoFlagType
    from ..pool import _CreatorFnType
    from ..pool import _CreatorWRecFnType
    from ..pool import _ResetStyleArgType
    from ..pool import Pool
    from ..util.typing import Literal


@overload
def create_engine(
    url: Union[str, URL],
    *,
    connect_args: Dict[Any, Any] = ...,
    convert_unicode: bool = ...,
    creator: Union[_CreatorFnType, _CreatorWRecFnType] = ...,
    echo: _EchoFlagType = ...,
    echo_pool: _EchoFlagType = ...,
    enable_from_linting: bool = ...,
    execution_options: _ExecuteOptions = ...,
    future: Literal[True],
    hide_parameters: bool = ...,
    implicit_returning: Literal[True] = ...,
    insertmanyvalues_page_size: int = ...,
    isolation_level: IsolationLevel = ...,
    json_deserializer: Callable[..., Any] = ...,
    json_serializer: Callable[..., Any] = ...,
    label_length: Optional[int] = ...,
    logging_name: str = ...,
    max_identifier_length: Optional[int] = ...,
    max_overflow: int = ...,
    module: Optional[Any] = ...,
    paramstyle: Optional[_ParamStyle] = ...,
    pool: Optional[Pool] = ...,
    poolclass: Optional[Type[Pool]] = ...,
    pool_logging_name: str = ...,
    pool_pre_ping: bool = ...,
    pool_size: int = ...,
    pool_recycle: int = ...,
    pool_reset_on_return: Optional[_ResetStyleArgType] = ...,
    pool_timeout: float = ...,
    pool_use_lifo: bool = ...,
    plugins: List[str] = ...,
    query_cache_size: int = ...,
    use_insertmanyvalues: bool = ...,
    **kwargs: Any,
) -> Engine:
    ...


@overload
def create_engine(url: Union[str, URL], **kwargs: Any) -> Engine:
    ...


@util.deprecated_params(
    strategy=(
        "1.4",
        "The :paramref:`_sa.create_engine.strategy` keyword is deprecated, "
        "and the only argument accepted is 'mock'; please use "
        ":func:`.create_mock_engine` going forward.  For general "
        "customization of create_engine which may have been accomplished "
        "using strategies, see :class:`.CreateEnginePlugin`.",
    ),
    empty_in_strategy=(
        "1.4",
        "The :paramref:`_sa.create_engine.empty_in_strategy` keyword is "
        "deprecated, and no longer has any effect.  All IN expressions "
        "are now rendered using "
        'the "expanding parameter" strategy which renders a set of bound'
        'expressions, or an "empty set" SELECT, at statement execution'
        "time.",
    ),
    implicit_returning=(
        "2.0",
        "The :paramref:`_sa.create_engine.implicit_returning` parameter "
        "is deprecated and will be removed in a future release. ",
    ),
)
def create_engine(url: Union[str, _url.URL], **kwargs: Any) -> Engine:
    """Create a new :class:`_engine.Engine` instance.

    The standard calling form is to send the :ref:`URL <database_urls>` as the
    first positional argument, usually a string
    that indicates database dialect and connection arguments::

        engine = create_engine("postgresql+psycopg2://scott:tiger@localhost/test")

    .. note::

        Please review :ref:`database_urls` for general guidelines in composing
        URL strings.  In particular, special characters, such as those often
        part of passwords, must be URL encoded to be properly parsed.

    Additional keyword arguments may then follow it which
    establish various options on the resulting :class:`_engine.Engine`
    and its underlying :class:`.Dialect` and :class:`_pool.Pool`
    constructs::

        engine = create_engine("mysql+mysqldb://scott:tiger@hostname/dbname",
                                    pool_recycle=3600, echo=True)

    The string form of the URL is
    ``dialect[+driver]://user:password@host/dbname[?key=value..]``, where
    ``dialect`` is a database name such as ``mysql``, ``oracle``,
    ``postgresql``, etc., and ``driver`` the name of a DBAPI, such as
    ``psycopg2``, ``pyodbc``, ``cx_oracle``, etc.  Alternatively,
    the URL can be an instance of :class:`~sqlalchemy.engine.url.URL`.

    ``**kwargs`` takes a wide variety of options which are routed
    towards their appropriate components.  Arguments may be specific to
    the :class:`_engine.Engine`, the underlying :class:`.Dialect`,
    as well as the
    :class:`_pool.Pool`.  Specific dialects also accept keyword arguments that
    are unique to that dialect.   Here, we describe the parameters
    that are common to most :func:`_sa.create_engine()` usage.

    Once established, the newly resulting :class:`_engine.Engine` will
    request a connection from the underlying :class:`_pool.Pool` once
    :meth:`_engine.Engine.connect` is called, or a method which depends on it
    such as :meth:`_engine.Engine.execute` is invoked.   The
    :class:`_pool.Pool` in turn
    will establish the first actual DBAPI connection when this request
    is received.   The :func:`_sa.create_engine` call itself does **not**
    establish any actual DBAPI connections directly.

    .. seealso::

        :doc:`/core/engines`

        :doc:`/dialects/index`

        :ref:`connections_toplevel`

    :param connect_args: a dictionary of options which will be
        passed directly to the DBAPI's ``connect()`` method as
        additional keyword arguments.  See the example
        at :ref:`custom_dbapi_args`.

    :param creator: a callable which returns a DBAPI connection.
        This creation function will be passed to the underlying
        connection pool and will be used to create all new database
        connections. Usage of this function causes connection
        parameters specified in the URL argument to be bypassed.

        This hook is not as flexible as the newer
        :meth:`_events.DialectEvents.do_connect` hook which allows complete
        control over how a connection is made to the database, given the full
        set of URL arguments and state beforehand.

        .. seealso::

            :meth:`_events.DialectEvents.do_connect` - event hook that allows
            full control over DBAPI connection mechanics.

            :ref:`custom_dbapi_args`

    :param echo=False: if True, the Engine will log all statements
        as well as a ``repr()`` of their parameter lists to the default log
        handler, which defaults to ``sys.stdout`` for output.   If set to the
        string ``"debug"``, result rows will be printed to the standard output
        as well. The ``echo`` attribute of ``Engine`` can be modified at any
        time to turn logging on and off; direct control of logging is also
        available using the standard Python ``logging`` module.

        .. seealso::

            :ref:`dbengine_logging` - further detail on how to configure
            logging.


    :param echo_pool=False: if True, the connection pool will log
        informational output such as when connections are invalidated
        as well as when connections are recycled to the default log handler,
        which defaults to ``sys.stdout`` for output.   If set to the string
        ``"debug"``, the logging will include pool checkouts and checkins.
        Direct control of logging is also available using the standard Python
        ``logging`` module.

        .. seealso::

            :ref:`dbengine_logging` - further detail on how to configure
            logging.


    :param empty_in_strategy:   No longer used; SQLAlchemy now uses
        "empty set" behavior for IN in all cases.

    :param enable_from_linting: defaults to True.  Will emit a warning
        if a given SELECT statement is found to have un-linked FROM elements
        which would cause a cartesian product.

        .. versionadded:: 1.4

        .. seealso::

            :ref:`change_4737`

    :param execution_options: Dictionary execution options which will
        be applied to all connections.  See
        :meth:`~sqlalchemy.engine.Connection.execution_options`

    :param future: Use the 2.0 style :class:`_engine.Engine` and
        :class:`_engine.Connection` API.

        As of SQLAlchemy 2.0, this parameter is present for backwards
        compatibility only and must remain at its default value of ``True``.

        The :paramref:`_sa.create_engine.future` parameter will be
        deprecated in a subsequent 2.x release and eventually removed.

        .. versionadded:: 1.4

        .. versionchanged:: 2.0 All :class:`_engine.Engine` objects are
           "future" style engines and there is no longer a ``future=False``
           mode of operation.

        .. seealso::

            :ref:`migration_20_toplevel`

    :param hide_parameters: Boolean, when set to True, SQL statement parameters
        will not be displayed in INFO logging nor will they be formatted into
        the string representation of :class:`.StatementError` objects.

        .. versionadded:: 1.3.8

        .. seealso::

            :ref:`dbengine_logging` - further detail on how to configure
            logging.

    :param implicit_returning=True:  Legacy parameter that may only be set
        to True. In SQLAlchemy 2.0, this parameter does nothing. In order to
        disable "implicit returning" for statements invoked by the ORM,
        configure this on a per-table basis using the
        :paramref:`.Table.implicit_returning` parameter.


    :param insertmanyvalues_page_size: number of rows to format into an
     INSERT statement when the statement uses "insertmanyvalues" mode, which is
     a paged form of bulk insert that is used for many backends when using
     :term:`executemany` execution typically in conjunction with RETURNING.
     Defaults to 1000, but may also be subject to dialect-specific limiting
     factors which may override this value on a per-statement basis.

     .. versionadded:: 2.0

     .. seealso::

        :ref:`engine_insertmanyvalues`

        :ref:`engine_insertmanyvalues_page_size`

        :paramref:`_engine.Connection.execution_options.insertmanyvalues_page_size`

    :param isolation_level: optional string name of an isolation level
        which will be set on all new connections unconditionally.
        Isolation levels are typically some subset of the string names
        ``"SERIALIZABLE"``, ``"REPEATABLE READ"``,
        ``"READ COMMITTED"``, ``"READ UNCOMMITTED"`` and ``"AUTOCOMMIT"``
        based on backend.

        The :paramref:`_sa.create_engine.isolation_level` parameter is
        in contrast to the
        :paramref:`.Connection.execution_options.isolation_level`
        execution option, which may be set on an individual
        :class:`.Connection`, as well as the same parameter passed to
        :meth:`.Engine.execution_options`, where it may be used to create
        multiple engines with different isolation levels that share a common
        connection pool and dialect.

        .. versionchanged:: 2.0 The
           :paramref:`_sa.create_engine.isolation_level`
           parameter has been generalized to work on all dialects which support
           the concept of isolation level, and is provided as a more succinct,
           up front configuration switch in contrast to the execution option
           which is more of an ad-hoc programmatic option.

        .. seealso::

            :ref:`dbapi_autocommit`

    :param json_deserializer: for dialects that support the
        :class:`_types.JSON`
        datatype, this is a Python callable that will convert a JSON string
        to a Python object.  By default, the Python ``json.loads`` function is
        used.

        .. versionchanged:: 1.3.7  The SQLite dialect renamed this from
           ``_json_deserializer``.

    :param json_serializer: for dialects that support the :class:`_types.JSON`
        datatype, this is a Python callable that will render a given object
        as JSON.   By default, the Python ``json.dumps`` function is used.

        .. versionchanged:: 1.3.7  The SQLite dialect renamed this from
           ``_json_serializer``.


    :param label_length=None: optional integer value which limits
        the size of dynamically generated column labels to that many
        characters. If less than 6, labels are generated as
        "_(counter)". If ``None``, the value of
        ``dialect.max_identifier_length``, which may be affected via the
        :paramref:`_sa.create_engine.max_identifier_length` parameter,
        is used instead.   The value of
        :paramref:`_sa.create_engine.label_length`
        may not be larger than that of
        :paramref:`_sa.create_engine.max_identfier_length`.

        .. seealso::

            :paramref:`_sa.create_engine.max_identifier_length`

    :param logging_name:  String identifier which will be used within
        the "name" field of logging records generated within the
        "sqlalchemy.engine" logger. Defaults to a hexstring of the
        object's id.

        .. seealso::

            :ref:`dbengine_logging` - further detail on how to configure
            logging.

            :paramref:`_engine.Connection.execution_options.logging_token`

    :param max_identifier_length: integer; override the max_identifier_length
        determined by the dialect.  if ``None`` or zero, has no effect.  This
        is the database's configured maximum number of characters that may be
        used in a SQL identifier such as a table name, column name, or label
        name. All dialects determine this value automatically, however in the
        case of a new database version for which this value has changed but
        SQLAlchemy's dialect has not been adjusted, the value may be passed
        here.

        .. versionadded:: 1.3.9

        .. seealso::

            :paramref:`_sa.create_engine.label_length`

    :param max_overflow=10: the number of connections to allow in
        connection pool "overflow", that is connections that can be
        opened above and beyond the pool_size setting, which defaults
        to five. this is only used with :class:`~sqlalchemy.pool.QueuePool`.

    :param module=None: reference to a Python module object (the module
        itself, not its string name).  Specifies an alternate DBAPI module to
        be used by the engine's dialect.  Each sub-dialect references a
        specific DBAPI which will be imported before first connect.  This
        parameter causes the import to be bypassed, and the given module to
        be used instead. Can be used for testing of DBAPIs as well as to
        inject "mock" DBAPI implementations into the :class:`_engine.Engine`.

    :param paramstyle=None: The `paramstyle <https://legacy.python.org/dev/peps/pep-0249/#paramstyle>`_
        to use when rendering bound parameters.  This style defaults to the
        one recommended by the DBAPI itself, which is retrieved from the
        ``.paramstyle`` attribute of the DBAPI.  However, most DBAPIs accept
        more than one paramstyle, and in particular it may be desirable
        to change a "named" paramstyle into a "positional" one, or vice versa.
        When this attribute is passed, it should be one of the values
        ``"qmark"``, ``"numeric"``, ``"named"``, ``"format"`` or
        ``"pyformat"``, and should correspond to a parameter style known
        to be supported by the DBAPI in use.

    :param pool=None: an already-constructed instance of
        :class:`~sqlalchemy.pool.Pool`, such as a
        :class:`~sqlalchemy.pool.QueuePool` instance. If non-None, this
        pool will be used directly as the underlying connection pool
        for the engine, bypassing whatever connection parameters are
        present in the URL argument. For information on constructing
        connection pools manually, see :ref:`pooling_toplevel`.

    :param poolclass=None: a :class:`~sqlalchemy.pool.Pool`
        subclass, which will be used to create a connection pool
        instance using the connection parameters given in the URL. Note
        this differs from ``pool`` in that you don't actually
        instantiate the pool in this case, you just indicate what type
        of pool to be used.

    :param pool_logging_name:  String identifier which will be used within
       the "name" field of logging records generated within the
       "sqlalchemy.pool" logger. Defaults to a hexstring of the object's
       id.

       .. seealso::

            :ref:`dbengine_logging` - further detail on how to configure
            logging.

    :param pool_pre_ping: boolean, if True will enable the connection pool
        "pre-ping" feature that tests connections for liveness upon
        each checkout.

        .. versionadded:: 1.2

        .. seealso::

            :ref:`pool_disconnects_pessimistic`

    :param pool_size=5: the number of connections to keep open
        inside the connection pool. This used with
        :class:`~sqlalchemy.pool.QueuePool` as
        well as :class:`~sqlalchemy.pool.SingletonThreadPool`.  With
        :class:`~sqlalchemy.pool.QueuePool`, a ``pool_size`` setting
        of 0 indicates no limit; to disable pooling, set ``poolclass`` to
        :class:`~sqlalchemy.pool.NullPool` instead.

    :param pool_recycle=-1: this setting causes the pool to recycle
        connections after the given number of seconds has passed. It
        defaults to -1, or no timeout. For example, setting to 3600
        means connections will be recycled after one hour. Note that
        MySQL in particular will disconnect automatically if no
        activity is detected on a connection for eight hours (although
        this is configurable with the MySQLDB connection itself and the
        server configuration as well).

        .. seealso::

            :ref:`pool_setting_recycle`

    :param pool_reset_on_return='rollback': set the
        :paramref:`_pool.Pool.reset_on_return` parameter of the underlying
        :class:`_pool.Pool` object, which can be set to the values
        ``"rollback"``, ``"commit"``, or ``None``.

        .. seealso::

            :ref:`pool_reset_on_return`

    :param pool_timeout=30: number of seconds to wait before giving
        up on getting a connection from the pool. This is only used
        with :class:`~sqlalchemy.pool.QueuePool`. This can be a float but is
        subject to the limitations of Python time functions which may not be
        reliable in the tens of milliseconds.

        .. note: don't use 30.0 above, it seems to break with the :param tag

    :param pool_use_lifo=False: use LIFO (last-in-first-out) when retrieving
        connections from :class:`.QueuePool` instead of FIFO
        (first-in-first-out). Using LIFO, a server-side timeout scheme can
        reduce the number of connections used during non- peak   periods of
        use.   When planning for server-side timeouts, ensure that a recycle or
        pre-ping strategy is in use to gracefully   handle stale connections.

          .. versionadded:: 1.3

          .. seealso::

            :ref:`pool_use_lifo`

            :ref:`pool_disconnects`

    :param plugins: string list of plugin names to load.  See
        :class:`.CreateEnginePlugin` for background.

        .. versionadded:: 1.2.3

    :param query_cache_size: size of the cache used to cache the SQL string
     form of queries.  Set to zero to disable caching.

     The cache is pruned of its least recently used items when its size reaches
     N * 1.5.  Defaults to 500, meaning the cache will always store at least
     500 SQL statements when filled, and will grow up to 750 items at which
     point it is pruned back down to 500 by removing the 250 least recently
     used items.

     Caching is accomplished on a per-statement basis by generating a
     cache key that represents the statement's structure, then generating
     string SQL for the current dialect only if that key is not present
     in the cache.   All statements support caching, however some features
     such as an INSERT with a large set of parameters will intentionally
     bypass the cache.   SQL logging will indicate statistics for each
     statement whether or not it were pull from the cache.

     .. note:: some ORM functions related to unit-of-work persistence as well
        as some attribute loading strategies will make use of individual
        per-mapper caches outside of the main cache.


     .. seealso::

        :ref:`sql_caching`

     .. versionadded:: 1.4

    :param use_insertmanyvalues: True by default, use the "insertmanyvalues"
     execution style for INSERT..RETURNING statements by default.

     .. versionadded:: 2.0

     .. seealso::

        :ref:`engine_insertmanyvalues`

    """  # noqa

    if "strategy" in kwargs:
        strat = kwargs.pop("strategy")
        if strat == "mock":
            # this case is deprecated
            return create_mock_engine(url, **kwargs)  # type: ignore
        else:
            raise exc.ArgumentError("unknown strategy: %r" % strat)

    kwargs.pop("empty_in_strategy", None)

    # create url.URL object
    u = _url.make_url(url)

    u, plugins, kwargs = u._instantiate_plugins(kwargs)

    entrypoint = u._get_entrypoint()
    _is_async = kwargs.pop("_is_async", False)
    if _is_async:
        dialect_cls = entrypoint.get_async_dialect_cls(u)
    else:
        dialect_cls = entrypoint.get_dialect_cls(u)

    if kwargs.pop("_coerce_config", False):

        def pop_kwarg(key: str, default: Optional[Any] = None) -> Any:
            value = kwargs.pop(key, default)
            if key in dialect_cls.engine_config_types:
                value = dialect_cls.engine_config_types[key](value)
            return value

    else:
        pop_kwarg = kwargs.pop  # type: ignore

    dialect_args = {}
    # consume dialect arguments from kwargs
    for k in util.get_cls_kwargs(dialect_cls):
        if k in kwargs:
            dialect_args[k] = pop_kwarg(k)

    dbapi = kwargs.pop("module", None)
    if dbapi is None:
        dbapi_args = {}

        if "import_dbapi" in dialect_cls.__dict__:
            dbapi_meth = dialect_cls.import_dbapi

        elif hasattr(dialect_cls, "dbapi") and inspect.ismethod(
            dialect_cls.dbapi
        ):
            util.warn_deprecated(
                "The dbapi() classmethod on dialect classes has been "
                "renamed to import_dbapi().  Implement an import_dbapi() "
                f"classmethod directly on class {dialect_cls} to remove this "
                "warning; the old .dbapi() classmethod may be maintained for "
                "backwards compatibility.",
                "2.0",
            )
            dbapi_meth = dialect_cls.dbapi
        else:
            dbapi_meth = dialect_cls.import_dbapi

        for k in util.get_func_kwargs(dbapi_meth):
            if k in kwargs:
                dbapi_args[k] = pop_kwarg(k)
        dbapi = dbapi_meth(**dbapi_args)

    dialect_args["dbapi"] = dbapi

    dialect_args.setdefault("compiler_linting", compiler.NO_LINTING)
    enable_from_linting = kwargs.pop("enable_from_linting", True)
    if enable_from_linting:
        dialect_args["compiler_linting"] ^= compiler.COLLECT_CARTESIAN_PRODUCTS

    for plugin in plugins:
        plugin.handle_dialect_kwargs(dialect_cls, dialect_args)

    # create dialect
    dialect = dialect_cls(**dialect_args)

    # assemble connection arguments
    (cargs_tup, cparams) = dialect.create_connect_args(u)
    cparams.update(pop_kwarg("connect_args", {}))

    if "async_fallback" in cparams and util.asbool(cparams["async_fallback"]):
        util.warn_deprecated(
            "The async_fallback dialect argument is deprecated and will be "
            "removed in SQLAlchemy 2.1.",
            "2.0",
        )

    cargs = list(cargs_tup)  # allow mutability

    # look for existing pool or create
    pool = pop_kwarg("pool", None)
    if pool is None:

        def connect(
            connection_record: Optional[ConnectionPoolEntry] = None,
        ) -> DBAPIConnection:
            if dialect._has_events:
                for fn in dialect.dispatch.do_connect:
                    connection = cast(
                        DBAPIConnection,
                        fn(dialect, connection_record, cargs, cparams),
                    )
                    if connection is not None:
                        return connection

            return dialect.connect(*cargs, **cparams)

        creator = pop_kwarg("creator", connect)

        poolclass = pop_kwarg("poolclass", None)
        if poolclass is None:
            poolclass = dialect.get_dialect_pool_class(u)
        pool_args = {"dialect": dialect}

        # consume pool arguments from kwargs, translating a few of
        # the arguments
        for k in util.get_cls_kwargs(poolclass):
            tk = _pool_translate_kwargs.get(k, k)
            if tk in kwargs:
                pool_args[k] = pop_kwarg(tk)

        for plugin in plugins:
            plugin.handle_pool_kwargs(poolclass, pool_args)

        pool = poolclass(creator, **pool_args)
    else:
        pool._dialect = dialect

    # create engine.
    if not pop_kwarg("future", True):
        raise exc.ArgumentError(
            "The 'future' parameter passed to "
            "create_engine() may only be set to True."
        )

    engineclass = base.Engine

    engine_args = {}
    for k in util.get_cls_kwargs(engineclass):
        if k in kwargs:
            engine_args[k] = pop_kwarg(k)

    # internal flags used by the test suite for instrumenting / proxying
    # engines with mocks etc.
    _initialize = kwargs.pop("_initialize", True)

    # all kwargs should be consumed
    if kwargs:
        raise TypeError(
            "Invalid argument(s) %s sent to create_engine(), "
            "using configuration %s/%s/%s.  Please check that the "
            "keyword arguments are appropriate for this combination "
            "of components."
            % (
                ",".join("'%s'" % k for k in kwargs),
                dialect.__class__.__name__,
                pool.__class__.__name__,
                engineclass.__name__,
            )
        )

    engine = engineclass(pool, dialect, u, **engine_args)

    if _initialize:
        do_on_connect = dialect.on_connect_url(u)
        if do_on_connect:

            def on_connect(
                dbapi_connection: DBAPIConnection,
                connection_record: ConnectionPoolEntry,
            ) -> None:
                assert do_on_connect is not None
                do_on_connect(dbapi_connection)

            event.listen(pool, "connect", on_connect)

        builtin_on_connect = dialect._builtin_onconnect()
        if builtin_on_connect:
            event.listen(pool, "connect", builtin_on_connect)

        def first_connect(
            dbapi_connection: DBAPIConnection,
            connection_record: ConnectionPoolEntry,
        ) -> None:
            c = base.Connection(
                engine,
                connection=_AdhocProxiedConnection(
                    dbapi_connection, connection_record
                ),
                _has_events=False,
                # reconnecting will be a reentrant condition, so if the
                # connection goes away, Connection is then closed
                _allow_revalidate=False,
                # dont trigger the autobegin sequence
                # within the up front dialect checks
                _allow_autobegin=False,
            )
            c._execution_options = util.EMPTY_DICT

            try:
                dialect.initialize(c)
            finally:
                # note that "invalidated" and "closed" are mutually
                # exclusive in 1.4 Connection.
                if not c.invalidated and not c.closed:
                    # transaction is rolled back otherwise, tested by
                    # test/dialect/postgresql/test_dialect.py
                    # ::MiscBackendTest::test_initial_transaction_state
                    dialect.do_rollback(c.connection)

        # previously, the "first_connect" event was used here, which was then
        # scaled back if the "on_connect" handler were present.  now,
        # since "on_connect" is virtually always present, just use
        # "connect" event with once_unless_exception in all cases so that
        # the connection event flow is consistent in all cases.
        event.listen(
            pool, "connect", first_connect, _once_unless_exception=True
        )

    dialect_cls.engine_created(engine)
    if entrypoint is not dialect_cls:
        entrypoint.engine_created(engine)

    for plugin in plugins:
        plugin.engine_created(engine)

    return engine


def engine_from_config(
    configuration: Dict[str, Any], prefix: str = "sqlalchemy.", **kwargs: Any
) -> Engine:
    """Create a new Engine instance using a configuration dictionary.

    The dictionary is typically produced from a config file.

    The keys of interest to ``engine_from_config()`` should be prefixed, e.g.
    ``sqlalchemy.url``, ``sqlalchemy.echo``, etc.  The 'prefix' argument
    indicates the prefix to be searched for.  Each matching key (after the
    prefix is stripped) is treated as though it were the corresponding keyword
    argument to a :func:`_sa.create_engine` call.

    The only required key is (assuming the default prefix) ``sqlalchemy.url``,
    which provides the :ref:`database URL <database_urls>`.

    A select set of keyword arguments will be "coerced" to their
    expected type based on string values.    The set of arguments
    is extensible per-dialect using the ``engine_config_types`` accessor.

    :param configuration: A dictionary (typically produced from a config file,
        but this is not a requirement).  Items whose keys start with the value
        of 'prefix' will have that prefix stripped, and will then be passed to
        :func:`_sa.create_engine`.

    :param prefix: Prefix to match and then strip from keys
        in 'configuration'.

    :param kwargs: Each keyword argument to ``engine_from_config()`` itself
        overrides the corresponding item taken from the 'configuration'
        dictionary.  Keyword arguments should *not* be prefixed.

    """

    options = {
        key[len(prefix) :]: configuration[key]
        for key in configuration
        if key.startswith(prefix)
    }
    options["_coerce_config"] = True
    options.update(kwargs)
    url = options.pop("url")
    return create_engine(url, **options)


@overload
def create_pool_from_url(
    url: Union[str, URL],
    *,
    poolclass: Optional[Type[Pool]] = ...,
    logging_name: str = ...,
    pre_ping: bool = ...,
    size: int = ...,
    recycle: int = ...,
    reset_on_return: Optional[_ResetStyleArgType] = ...,
    timeout: float = ...,
    use_lifo: bool = ...,
    **kwargs: Any,
) -> Pool:
    ...


@overload
def create_pool_from_url(url: Union[str, URL], **kwargs: Any) -> Pool:
    ...


def create_pool_from_url(url: Union[str, URL], **kwargs: Any) -> Pool:
    """Create a pool instance from the given url.

    If ``poolclass`` is not provided the pool class used
    is selected using the dialect specified in the URL.

    The arguments passed to :func:`_sa.create_pool_from_url` are
    identical to the pool argument passed to the :func:`_sa.create_engine`
    function.

    .. versionadded:: 2.0.10
    """

    for key in _pool_translate_kwargs:
        if key in kwargs:
            kwargs[_pool_translate_kwargs[key]] = kwargs.pop(key)

    engine = create_engine(url, **kwargs, _initialize=False)
    return engine.pool


_pool_translate_kwargs = immutabledict(
    {
        "logging_name": "pool_logging_name",
        "echo": "echo_pool",
        "timeout": "pool_timeout",
        "recycle": "pool_recycle",
        "events": "pool_events",  # deprecated
        "reset_on_return": "pool_reset_on_return",
        "pre_ping": "pool_pre_ping",
        "use_lifo": "pool_use_lifo",
    }
)
