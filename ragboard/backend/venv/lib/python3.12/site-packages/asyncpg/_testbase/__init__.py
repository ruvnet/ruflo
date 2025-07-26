# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


import asyncio
import atexit
import contextlib
import functools
import inspect
import logging
import os
import re
import textwrap
import time
import traceback
import unittest


import asyncpg
from asyncpg import cluster as pg_cluster
from asyncpg import connection as pg_connection
from asyncpg import pool as pg_pool

from . import fuzzer


@contextlib.contextmanager
def silence_asyncio_long_exec_warning():
    def flt(log_record):
        msg = log_record.getMessage()
        return not msg.startswith('Executing ')

    logger = logging.getLogger('asyncio')
    logger.addFilter(flt)
    try:
        yield
    finally:
        logger.removeFilter(flt)


def with_timeout(timeout):
    def wrap(func):
        func.__timeout__ = timeout
        return func

    return wrap


class TestCaseMeta(type(unittest.TestCase)):
    TEST_TIMEOUT = None

    @staticmethod
    def _iter_methods(bases, ns):
        for base in bases:
            for methname in dir(base):
                if not methname.startswith('test_'):
                    continue

                meth = getattr(base, methname)
                if not inspect.iscoroutinefunction(meth):
                    continue

                yield methname, meth

        for methname, meth in ns.items():
            if not methname.startswith('test_'):
                continue

            if not inspect.iscoroutinefunction(meth):
                continue

            yield methname, meth

    def __new__(mcls, name, bases, ns):
        for methname, meth in mcls._iter_methods(bases, ns):
            @functools.wraps(meth)
            def wrapper(self, *args, __meth__=meth, **kwargs):
                coro = __meth__(self, *args, **kwargs)
                timeout = getattr(__meth__, '__timeout__', mcls.TEST_TIMEOUT)
                if timeout:
                    coro = asyncio.wait_for(coro, timeout)
                    try:
                        self.loop.run_until_complete(coro)
                    except asyncio.TimeoutError:
                        raise self.failureException(
                            'test timed out after {} seconds'.format(
                                timeout)) from None
                else:
                    self.loop.run_until_complete(coro)
            ns[methname] = wrapper

        return super().__new__(mcls, name, bases, ns)


class TestCase(unittest.TestCase, metaclass=TestCaseMeta):

    @classmethod
    def setUpClass(cls):
        if os.environ.get('USE_UVLOOP'):
            import uvloop
            asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(None)
        cls.loop = loop

    @classmethod
    def tearDownClass(cls):
        cls.loop.close()
        asyncio.set_event_loop(None)

    def setUp(self):
        self.loop.set_exception_handler(self.loop_exception_handler)
        self.__unhandled_exceptions = []

    def tearDown(self):
        if self.__unhandled_exceptions:
            formatted = []

            for i, context in enumerate(self.__unhandled_exceptions):
                formatted.append(self._format_loop_exception(context, i + 1))

            self.fail(
                'unexpected exceptions in asynchronous code:\n' +
                '\n'.join(formatted))

    @contextlib.contextmanager
    def assertRunUnder(self, delta):
        st = time.monotonic()
        try:
            yield
        finally:
            elapsed = time.monotonic() - st
            if elapsed > delta:
                raise AssertionError(
                    'running block took {:0.3f}s which is longer '
                    'than the expected maximum of {:0.3f}s'.format(
                        elapsed, delta))

    @contextlib.contextmanager
    def assertLoopErrorHandlerCalled(self, msg_re: str):
        contexts = []

        def handler(loop, ctx):
            contexts.append(ctx)

        old_handler = self.loop.get_exception_handler()
        self.loop.set_exception_handler(handler)
        try:
            yield

            for ctx in contexts:
                msg = ctx.get('message')
                if msg and re.search(msg_re, msg):
                    return

            raise AssertionError(
                'no message matching {!r} was logged with '
                'loop.call_exception_handler()'.format(msg_re))

        finally:
            self.loop.set_exception_handler(old_handler)

    def loop_exception_handler(self, loop, context):
        self.__unhandled_exceptions.append(context)
        loop.default_exception_handler(context)

    def _format_loop_exception(self, context, n):
        message = context.get('message', 'Unhandled exception in event loop')
        exception = context.get('exception')
        if exception is not None:
            exc_info = (type(exception), exception, exception.__traceback__)
        else:
            exc_info = None

        lines = []
        for key in sorted(context):
            if key in {'message', 'exception'}:
                continue
            value = context[key]
            if key == 'source_traceback':
                tb = ''.join(traceback.format_list(value))
                value = 'Object created at (most recent call last):\n'
                value += tb.rstrip()
            else:
                try:
                    value = repr(value)
                except Exception as ex:
                    value = ('Exception in __repr__ {!r}; '
                             'value type: {!r}'.format(ex, type(value)))
            lines.append('[{}]: {}\n\n'.format(key, value))

        if exc_info is not None:
            lines.append('[exception]:\n')
            formatted_exc = textwrap.indent(
                ''.join(traceback.format_exception(*exc_info)), '  ')
            lines.append(formatted_exc)

        details = textwrap.indent(''.join(lines), '    ')
        return '{:02d}. {}:\n{}\n'.format(n, message, details)


_default_cluster = None


def _init_cluster(ClusterCls, cluster_kwargs, initdb_options=None):
    cluster = ClusterCls(**cluster_kwargs)
    cluster.init(**(initdb_options or {}))
    cluster.trust_local_connections()
    atexit.register(_shutdown_cluster, cluster)
    return cluster


def _start_cluster(ClusterCls, cluster_kwargs, server_settings,
                   initdb_options=None):
    cluster = _init_cluster(ClusterCls, cluster_kwargs, initdb_options)
    cluster.start(port='dynamic', server_settings=server_settings)
    return cluster


def _get_initdb_options(initdb_options=None):
    if not initdb_options:
        initdb_options = {}
    else:
        initdb_options = dict(initdb_options)

    # Make the default superuser name stable.
    if 'username' not in initdb_options:
        initdb_options['username'] = 'postgres'

    return initdb_options


def _init_default_cluster(initdb_options=None):
    global _default_cluster

    if _default_cluster is None:
        pg_host = os.environ.get('PGHOST')
        if pg_host:
            # Using existing cluster, assuming it is initialized and running
            _default_cluster = pg_cluster.RunningCluster()
        else:
            _default_cluster = _init_cluster(
                pg_cluster.TempCluster, cluster_kwargs={},
                initdb_options=_get_initdb_options(initdb_options))

    return _default_cluster


def _shutdown_cluster(cluster):
    if cluster.get_status() == 'running':
        cluster.stop()
    if cluster.get_status() != 'not-initialized':
        cluster.destroy()


def create_pool(dsn=None, *,
                min_size=10,
                max_size=10,
                max_queries=50000,
                max_inactive_connection_lifetime=60.0,
                setup=None,
                init=None,
                loop=None,
                pool_class=pg_pool.Pool,
                connection_class=pg_connection.Connection,
                record_class=asyncpg.Record,
                **connect_kwargs):
    return pool_class(
        dsn,
        min_size=min_size, max_size=max_size,
        max_queries=max_queries, loop=loop, setup=setup, init=init,
        max_inactive_connection_lifetime=max_inactive_connection_lifetime,
        connection_class=connection_class,
        record_class=record_class,
        **connect_kwargs)


class ClusterTestCase(TestCase):
    @classmethod
    def get_server_settings(cls):
        settings = {
            'log_connections': 'on'
        }

        if cls.cluster.get_pg_version() >= (11, 0):
            # JITting messes up timing tests, and
            # is not essential for testing.
            settings['jit'] = 'off'

        return settings

    @classmethod
    def new_cluster(cls, ClusterCls, *, cluster_kwargs={}, initdb_options={}):
        cluster = _init_cluster(ClusterCls, cluster_kwargs,
                                _get_initdb_options(initdb_options))
        cls._clusters.append(cluster)
        return cluster

    @classmethod
    def start_cluster(cls, cluster, *, server_settings={}):
        cluster.start(port='dynamic', server_settings=server_settings)

    @classmethod
    def setup_cluster(cls):
        cls.cluster = _init_default_cluster()

        if cls.cluster.get_status() != 'running':
            cls.cluster.start(
                port='dynamic', server_settings=cls.get_server_settings())

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._clusters = []
        cls.setup_cluster()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        for cluster in cls._clusters:
            if cluster is not _default_cluster:
                cluster.stop()
                cluster.destroy()
        cls._clusters = []

    @classmethod
    def get_connection_spec(cls, kwargs={}):
        conn_spec = cls.cluster.get_connection_spec()
        if kwargs.get('dsn'):
            conn_spec.pop('host')
        conn_spec.update(kwargs)
        if not os.environ.get('PGHOST') and not kwargs.get('dsn'):
            if 'database' not in conn_spec:
                conn_spec['database'] = 'postgres'
            if 'user' not in conn_spec:
                conn_spec['user'] = 'postgres'
        return conn_spec

    @classmethod
    def connect(cls, **kwargs):
        conn_spec = cls.get_connection_spec(kwargs)
        return pg_connection.connect(**conn_spec, loop=cls.loop)

    def setUp(self):
        super().setUp()
        self._pools = []

    def tearDown(self):
        super().tearDown()
        for pool in self._pools:
            pool.terminate()
        self._pools = []

    def create_pool(self, pool_class=pg_pool.Pool,
                    connection_class=pg_connection.Connection, **kwargs):
        conn_spec = self.get_connection_spec(kwargs)
        pool = create_pool(loop=self.loop, pool_class=pool_class,
                           connection_class=connection_class, **conn_spec)
        self._pools.append(pool)
        return pool


class ProxiedClusterTestCase(ClusterTestCase):
    @classmethod
    def get_server_settings(cls):
        settings = dict(super().get_server_settings())
        settings['listen_addresses'] = '127.0.0.1'
        return settings

    @classmethod
    def get_proxy_settings(cls):
        return {'fuzzing-mode': None}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        conn_spec = cls.cluster.get_connection_spec()
        host = conn_spec.get('host')
        if not host:
            host = '127.0.0.1'
        elif host.startswith('/'):
            host = '127.0.0.1'
        cls.proxy = fuzzer.TCPFuzzingProxy(
            backend_host=host,
            backend_port=conn_spec['port'],
        )
        cls.proxy.start()

    @classmethod
    def tearDownClass(cls):
        cls.proxy.stop()
        super().tearDownClass()

    @classmethod
    def get_connection_spec(cls, kwargs):
        conn_spec = super().get_connection_spec(kwargs)
        conn_spec['host'] = cls.proxy.listening_addr
        conn_spec['port'] = cls.proxy.listening_port
        return conn_spec

    def tearDown(self):
        self.proxy.reset()
        super().tearDown()


def with_connection_options(**options):
    if not options:
        raise ValueError('no connection options were specified')

    def wrap(func):
        func.__connect_options__ = options
        return func

    return wrap


class ConnectedTestCase(ClusterTestCase):

    def setUp(self):
        super().setUp()

        # Extract options set up with `with_connection_options`.
        test_func = getattr(self, self._testMethodName).__func__
        opts = getattr(test_func, '__connect_options__', {})
        self.con = self.loop.run_until_complete(self.connect(**opts))
        self.server_version = self.con.get_server_version()

    def tearDown(self):
        try:
            self.loop.run_until_complete(self.con.close())
            self.con = None
        finally:
            super().tearDown()


class HotStandbyTestCase(ClusterTestCase):

    @classmethod
    def setup_cluster(cls):
        cls.master_cluster = cls.new_cluster(pg_cluster.TempCluster)
        cls.start_cluster(
            cls.master_cluster,
            server_settings={
                'max_wal_senders': 10,
                'wal_level': 'hot_standby'
            }
        )

        con = None

        try:
            con = cls.loop.run_until_complete(
                cls.master_cluster.connect(
                    database='postgres', user='postgres', loop=cls.loop))

            cls.loop.run_until_complete(
                con.execute('''
                    CREATE ROLE replication WITH LOGIN REPLICATION
                '''))

            cls.master_cluster.trust_local_replication_by('replication')

            conn_spec = cls.master_cluster.get_connection_spec()

            cls.standby_cluster = cls.new_cluster(
                pg_cluster.HotStandbyCluster,
                cluster_kwargs={
                    'master': conn_spec,
                    'replication_user': 'replication'
                }
            )
            cls.start_cluster(
                cls.standby_cluster,
                server_settings={
                    'hot_standby': True
                }
            )

        finally:
            if con is not None:
                cls.loop.run_until_complete(con.close())

    @classmethod
    def get_cluster_connection_spec(cls, cluster, kwargs={}):
        conn_spec = cluster.get_connection_spec()
        if kwargs.get('dsn'):
            conn_spec.pop('host')
        conn_spec.update(kwargs)
        if not os.environ.get('PGHOST') and not kwargs.get('dsn'):
            if 'database' not in conn_spec:
                conn_spec['database'] = 'postgres'
            if 'user' not in conn_spec:
                conn_spec['user'] = 'postgres'
        return conn_spec

    @classmethod
    def get_connection_spec(cls, kwargs={}):
        primary_spec = cls.get_cluster_connection_spec(
            cls.master_cluster, kwargs
        )
        standby_spec = cls.get_cluster_connection_spec(
            cls.standby_cluster, kwargs
        )
        return {
            'host': [primary_spec['host'], standby_spec['host']],
            'port': [primary_spec['port'], standby_spec['port']],
            'database': primary_spec['database'],
            'user': primary_spec['user'],
            **kwargs
        }

    @classmethod
    def connect_primary(cls, **kwargs):
        conn_spec = cls.get_cluster_connection_spec(cls.master_cluster, kwargs)
        return pg_connection.connect(**conn_spec, loop=cls.loop)

    @classmethod
    def connect_standby(cls, **kwargs):
        conn_spec = cls.get_cluster_connection_spec(
            cls.standby_cluster,
            kwargs
        )
        return pg_connection.connect(**conn_spec, loop=cls.loop)
