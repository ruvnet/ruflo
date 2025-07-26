"""Client (Connection)."""

from __future__ import annotations

import os
import socket
import sys
from contextlib import contextmanager
from itertools import count, cycle
from operator import itemgetter
from typing import TYPE_CHECKING, Any

try:
    from ssl import CERT_NONE
    ssl_available = True
except ImportError:  # pragma: no cover
    CERT_NONE = None
    ssl_available = False


# jython breaks on relative import for .exceptions for some reason
# (Issue #112)
from kombu import exceptions

from .log import get_logger
from .resource import Resource
from .transport import get_transport_cls, supports_librabbitmq
from .utils.collections import HashedSeq
from .utils.functional import dictfilter, lazy, retry_over_time, shufflecycle
from .utils.objects import cached_property
from .utils.url import as_url, maybe_sanitize_url, parse_url, quote, urlparse

if TYPE_CHECKING:
    from kombu.transport.virtual import Channel

    if sys.version_info < (3, 10):
        from typing_extensions import TypeGuard
    else:
        from typing import TypeGuard

    from types import TracebackType

__all__ = ('Connection', 'ConnectionPool', 'ChannelPool')

logger = get_logger(__name__)

roundrobin_failover = cycle

resolve_aliases = {
    'pyamqp': 'amqp',
    'librabbitmq': 'amqp',
}

failover_strategies = {
    'round-robin': roundrobin_failover,
    'shuffle': shufflecycle,
}

_log_connection = os.environ.get('KOMBU_LOG_CONNECTION', False)
_log_channel = os.environ.get('KOMBU_LOG_CHANNEL', False)


class Connection:
    """A connection to the broker.

    Example:
    -------
        >>> Connection('amqp://guest:guest@localhost:5672//')
        >>> Connection('amqp://foo;amqp://bar',
        ...            failover_strategy='round-robin')
        >>> Connection('redis://', transport_options={
        ...     'visibility_timeout': 3000,
        ... })

        >>> import ssl
        >>> Connection('amqp://', login_method='EXTERNAL', ssl={
        ...    'ca_certs': '/etc/pki/tls/certs/something.crt',
        ...    'keyfile': '/etc/something/system.key',
        ...    'certfile': '/etc/something/system.cert',
        ...    'cert_reqs': ssl.CERT_REQUIRED,
        ... })

    Note:
    ----
        SSL currently only works with the py-amqp, qpid and redis
        transports.  For other transports you can use stunnel.

    Arguments:
    ---------
        URL (str, Sequence): Broker URL, or a list of URLs.

    Keyword Arguments:
    -----------------
        ssl (bool/dict): Use SSL to connect to the server.
            Default is ``False``.
            May not be supported by the specified transport.
        transport (Transport): Default transport if not specified in the URL.
        connect_timeout (float): Timeout in seconds for connecting to the
            server. May not be supported by the specified transport.
        transport_options (Dict): A dict of additional connection arguments to
            pass to alternate kombu channel implementations.  Consult the
            transport documentation for available options.
        heartbeat (float): Heartbeat interval in int/float seconds.
            Note that if heartbeats are enabled then the
            :meth:`heartbeat_check` method must be called regularly,
            around once per second.

    Note:
    ----
        The connection is established lazily when needed. If you need the
        connection to be established, then force it by calling
        :meth:`connect`::

            >>> conn = Connection('amqp://')
            >>> conn.connect()

        and always remember to close the connection::

            >>> conn.release()

    These options have been replaced by the URL argument, but are still
    supported for backwards compatibility:

    :keyword hostname: Host name/address.
        NOTE: You cannot specify both the URL argument and use the hostname
        keyword argument at the same time.
    :keyword userid: Default user name if not provided in the URL.
    :keyword password: Default password if not provided in the URL.
    :keyword virtual_host: Default virtual host if not provided in the URL.
    :keyword port: Default port if not provided in the URL.
    """

    port = None
    virtual_host = '/'
    connect_timeout = 5

    _closed = None
    _connection = None
    _default_channel = None
    _transport = None
    _logger = False
    uri_prefix = None

    #: The cache of declared entities is per connection,
    #: in case the server loses data.
    declared_entities = None

    #: Iterator returning the next broker URL to try in the event
    #: of connection failure (initialized by :attr:`failover_strategy`).
    cycle = None

    #: Additional transport specific options,
    #: passed on to the transport instance.
    transport_options = None

    #: Strategy used to select new hosts when reconnecting after connection
    #: failure.  One of "round-robin", "shuffle" or any custom iterator
    #: constantly yielding new URLs to try.
    failover_strategy = 'round-robin'

    #: Heartbeat value, currently only supported by the py-amqp transport.
    heartbeat = None

    resolve_aliases = resolve_aliases
    failover_strategies = failover_strategies

    hostname = userid = password = ssl = login_method = None

    def __init__(self, hostname='localhost', userid=None,
                 password=None, virtual_host=None, port=None, insist=False,
                 ssl=False, transport=None, connect_timeout=5,
                 transport_options=None, login_method=None, uri_prefix=None,
                 heartbeat=0, failover_strategy='round-robin',
                 alternates=None, **kwargs):
        alt = [] if alternates is None else alternates
        # have to spell the args out, just to get nice docstrings :(
        params = self._initial_params = {
            'hostname': hostname, 'userid': userid,
            'password': password, 'virtual_host': virtual_host,
            'port': port, 'insist': insist, 'ssl': ssl,
            'transport': transport, 'connect_timeout': connect_timeout,
            'login_method': login_method, 'heartbeat': heartbeat
        }

        if hostname and not isinstance(hostname, str):
            alt.extend(hostname)
            hostname = alt[0]
            params.update(hostname=hostname)
        if hostname:
            if ';' in hostname:
                alt = hostname.split(';') + alt
                hostname = alt[0]
                params.update(hostname=hostname)
            if '://' in hostname and '+' in hostname[:hostname.index('://')]:
                # e.g. sqla+mysql://root:masterkey@localhost/
                params['transport'], params['hostname'] = \
                    hostname.split('+', 1)
                self.uri_prefix = params['transport']
            elif '://' in hostname:
                transport = transport or urlparse(hostname).scheme
                if not get_transport_cls(transport).can_parse_url:
                    # we must parse the URL
                    url_params = parse_url(hostname)
                    params.update(
                        dictfilter(url_params),
                        hostname=url_params['hostname'],
                    )

                params['transport'] = transport

        self._init_params(**params)

        # fallback hosts
        self.alt = alt
        # keep text representation for .info
        # only temporary solution as this won't work when
        # passing a custom object (Issue celery/celery#3320).
        self._failover_strategy = failover_strategy or 'round-robin'
        self.failover_strategy = self.failover_strategies.get(
            self._failover_strategy) or self._failover_strategy
        if self.alt:
            self.cycle = self.failover_strategy(self.alt)
            next(self.cycle)  # skip first entry

        if transport_options is None:
            transport_options = {}
        self.transport_options = transport_options

        if _log_connection:  # pragma: no cover
            self._logger = True

        if uri_prefix:
            self.uri_prefix = uri_prefix

        self.declared_entities = set()

    def switch(self, conn_str):
        """Switch connection parameters to use a new URL or hostname.

        Note:
        ----
            Does not reconnect!

        Arguments:
        ---------
            conn_str (str): either a hostname or URL.
        """
        self.close()
        self.declared_entities.clear()
        self._closed = False
        conn_params = (
            parse_url(conn_str) if "://" in conn_str else {"hostname": conn_str}
        )
        self._init_params(**dict(self._initial_params, **conn_params))

    def maybe_switch_next(self):
        """Switch to next URL given by the current failover strategy."""
        if self.cycle:
            self.switch(next(self.cycle))

    def _init_params(self, hostname, userid, password, virtual_host, port,
                     insist, ssl, transport, connect_timeout,
                     login_method, heartbeat):
        transport = transport or 'amqp'
        if transport == 'amqp' and supports_librabbitmq():
            transport = 'librabbitmq'
        if transport == 'rediss' and ssl_available and not ssl:
            logger.warning(
                'Secure redis scheme specified (rediss) with no ssl '
                'options, defaulting to insecure SSL behaviour.'
            )
            ssl = {'ssl_cert_reqs': CERT_NONE}
        self.hostname = hostname
        self.userid = userid
        self.password = password
        self.login_method = login_method
        self.virtual_host = virtual_host or self.virtual_host
        self.port = port or self.port
        self.insist = insist
        self.connect_timeout = connect_timeout
        self.ssl = ssl
        self.transport_cls = transport
        self.heartbeat = heartbeat and float(heartbeat)

    def register_with_event_loop(self, loop):
        self.transport.register_with_event_loop(self.connection, loop)

    def _debug(self, msg, *args, **kwargs):
        if self._logger:  # pragma: no cover
            fmt = '[Kombu connection:{id:#x}] {msg}'
            logger.debug(fmt.format(id=id(self), msg=str(msg)),
                         *args, **kwargs)

    def connect(self):
        """Establish connection to server immediately."""
        return self._ensure_connection(
            max_retries=1, reraise_as_library_errors=False
        )

    def channel(self):
        """Create and return a new channel."""
        self._debug('create channel')
        chan = self.transport.create_channel(self.connection)
        if _log_channel:  # pragma: no cover
            from .utils.debug import Logwrapped
            return Logwrapped(chan, 'kombu.channel',
                              '[Kombu channel:{0.channel_id}] ')
        return chan

    def heartbeat_check(self, rate=2):
        """Check heartbeats.

        Allow the transport to perform any periodic tasks
        required to make heartbeats work.  This should be called
        approximately every second.

        If the current transport does not support heartbeats then
        this is a noop operation.

        Arguments:
        ---------
            rate (int): Rate is how often the tick is called
                compared to the actual heartbeat value.  E.g. if
                the heartbeat is set to 3 seconds, and the tick
                is called every 3 / 2 seconds, then the rate is 2.
                This value is currently unused by any transports.
        """
        return self.transport.heartbeat_check(self.connection, rate=rate)

    def drain_events(self, **kwargs):
        """Wait for a single event from the server.

        Arguments:
        ---------
            timeout (float): Timeout in seconds before we give up.

        Raises
        ------
            socket.timeout: if the timeout is exceeded.
        """
        return self.transport.drain_events(self.connection, **kwargs)

    def maybe_close_channel(self, channel):
        """Close given channel, but ignore connection and channel errors."""
        try:
            channel.close()
        except (self.connection_errors + self.channel_errors):
            pass

    def _do_close_self(self):
        # Close only connection and channel(s), but not transport.
        self.declared_entities.clear()
        if self._default_channel:
            self.maybe_close_channel(self._default_channel)
        if self._connection:
            try:
                self.transport.close_connection(self._connection)
            except self.connection_errors + (AttributeError, socket.error):
                pass
            self._connection = None

    def _close(self):
        """Really close connection, even if part of a connection pool."""
        self._do_close_self()
        self._do_close_transport()
        self._debug('closed')
        self._closed = True

    def _do_close_transport(self):
        if self._transport:
            self._transport.client = None
            self._transport = None

    def collect(self, socket_timeout=None):
        # amqp requires communication to close, we don't need that just
        # to clear out references, Transport._collect can also be implemented
        # by other transports that want fast after fork
        try:
            gc_transport = self._transport._collect
        except AttributeError:
            _timeo = socket.getdefaulttimeout()
            socket.setdefaulttimeout(socket_timeout)
            try:
                self._do_close_self()
            except socket.timeout:
                pass
            finally:
                socket.setdefaulttimeout(_timeo)
        else:
            gc_transport(self._connection)

        self._do_close_transport()
        self.declared_entities.clear()
        self._connection = None

    def release(self):
        """Close the connection (if open)."""
        self._close()
    close = release

    def ensure_connection(self, *args, **kwargs):
        """Public interface of _ensure_connection for retro-compatibility.

        Returns kombu.Connection instance.
        """
        self._ensure_connection(*args, **kwargs)
        return self

    def _ensure_connection(
        self, errback=None, max_retries=None,
        interval_start=2, interval_step=2, interval_max=30,
        callback=None, reraise_as_library_errors=True,
        timeout=None
    ):
        """Ensure we have a connection to the server.

        If not retry establishing the connection with the settings
        specified.

        Arguments:
        ---------
            errback (Callable): Optional callback called each time the
                connection can't be established.  Arguments provided are
                the exception raised and the interval that will be
                slept ``(exc, interval)``.

            max_retries (int): Maximum number of times to retry.
                If this limit is exceeded the connection error
                will be re-raised.

            interval_start (float): The number of seconds we start
                sleeping for.
            interval_step (float): How many seconds added to the interval
                for each retry.
            interval_max (float): Maximum number of seconds to sleep between
                each retry.
            callback (Callable): Optional callback that is called for every
                internal iteration (1 s).
            timeout (int): Maximum amount of time in seconds to spend
                attempting to connect, total over all retries.
        """
        if self.connected:
            return self._connection

        def on_error(exc, intervals, retries, interval=0):
            round = self.completes_cycle(retries)
            if round:
                interval = next(intervals)
            if errback:
                errback(exc, interval)
            self.maybe_switch_next()  # select next host

            return interval if round else 0

        ctx = self._reraise_as_library_errors
        if not reraise_as_library_errors:
            ctx = self._dummy_context
        with ctx():
            return retry_over_time(
                self._connection_factory, self.recoverable_connection_errors,
                (), {}, on_error, max_retries,
                interval_start, interval_step, interval_max,
                callback, timeout=timeout
            )

    @contextmanager
    def _reraise_as_library_errors(
            self,
            ConnectionError=exceptions.OperationalError,
            ChannelError=exceptions.OperationalError):
        try:
            yield
        except (ConnectionError, ChannelError):
            raise
        except self.recoverable_connection_errors as exc:
            raise ConnectionError(str(exc)) from exc
        except self.recoverable_channel_errors as exc:
            raise ChannelError(str(exc)) from exc

    @contextmanager
    def _dummy_context(self):
        yield

    def completes_cycle(self, retries):
        """Return true if the cycle is complete after number of `retries`."""
        return not (retries + 1) % len(self.alt) if self.alt else True

    def revive(self, new_channel):
        """Revive connection after connection re-established."""
        if self._default_channel and new_channel is not self._default_channel:
            self.maybe_close_channel(self._default_channel)
            self._default_channel = None

    def ensure(self, obj, fun, errback=None, max_retries=None,
               interval_start=1, interval_step=1, interval_max=1,
               on_revive=None, retry_errors=None):
        """Ensure operation completes.

        Regardless of any channel/connection errors occurring.

        Retries by establishing the connection, and reapplying
        the function.

        Arguments:
        ---------
            obj: The object to ensure an action on.
            fun (Callable): Method to apply.

            errback (Callable): Optional callback called each time the
                connection can't be established.  Arguments provided are
                the exception raised and the interval that will
                be slept ``(exc, interval)``.

            max_retries (int): Maximum number of times to retry.
                If this limit is exceeded the connection error
                will be re-raised.

            interval_start (float): The number of seconds we start
                sleeping for.
            interval_step (float): How many seconds added to the interval
                for each retry.
            interval_max (float): Maximum number of seconds to sleep between
                each retry.
            on_revive (Callable): Optional callback called whenever
                revival completes successfully
            retry_errors (tuple): Optional list of errors to retry on
                regardless of the connection state.

        Examples
        --------
            >>> from kombu import Connection, Producer
            >>> conn = Connection('amqp://')
            >>> producer = Producer(conn)

            >>> def errback(exc, interval):
            ...     logger.error('Error: %r', exc, exc_info=1)
            ...     logger.info('Retry in %s seconds.', interval)

            >>> publish = conn.ensure(producer, producer.publish,
            ...                       errback=errback, max_retries=3)
            >>> publish({'hello': 'world'}, routing_key='dest')
        """
        if retry_errors is None:
            retry_errors = tuple()

        def _ensured(*args, **kwargs):
            got_connection = 0
            conn_errors = self.recoverable_connection_errors
            chan_errors = self.recoverable_channel_errors
            has_modern_errors = hasattr(
                self.transport, 'recoverable_connection_errors',
            )
            with self._reraise_as_library_errors():
                for retries in count(0):  # for infinity
                    try:
                        return fun(*args, **kwargs)
                    except retry_errors as exc:
                        if max_retries is not None and retries >= max_retries:
                            raise
                        self._debug('ensure retry policy error: %r',
                                    exc, exc_info=1)
                    except conn_errors as exc:
                        if got_connection and not has_modern_errors:
                            # transport can not distinguish between
                            # recoverable/irrecoverable errors, so we propagate
                            # the error if it persists after a new connection
                            # was successfully established.
                            raise
                        if max_retries is not None and retries >= max_retries:
                            raise
                        self._debug('ensure connection error: %r',
                                    exc, exc_info=1)
                        self.collect()
                        errback and errback(exc, 0)
                        remaining_retries = None
                        if max_retries is not None:
                            remaining_retries = max(max_retries - retries, 1)
                        self._ensure_connection(
                            errback,
                            remaining_retries,
                            interval_start, interval_step, interval_max,
                            reraise_as_library_errors=False,
                        )
                        channel = self.default_channel
                        obj.revive(channel)
                        if on_revive:
                            on_revive(channel)
                        got_connection += 1
                    except chan_errors as exc:
                        if max_retries is not None and retries > max_retries:
                            raise
                        self._debug('ensure channel error: %r',
                                    exc, exc_info=1)
                        errback and errback(exc, 0)
        _ensured.__name__ = f'{fun.__name__}(ensured)'
        _ensured.__doc__ = fun.__doc__
        _ensured.__module__ = fun.__module__
        return _ensured

    def autoretry(self, fun, channel=None, **ensure_options):
        """Decorator for functions supporting a ``channel`` keyword argument.

        The resulting callable will retry calling the function if
        it raises connection or channel related errors.
        The return value will be a tuple of ``(retval, last_created_channel)``.

        If a ``channel`` is not provided, then one will be automatically
        acquired (remember to close it afterwards).

        See Also
        --------
            :meth:`ensure` for the full list of supported keyword arguments.

        Example:
        -------
            >>> channel = connection.channel()
            >>> try:
            ...    ret, channel = connection.autoretry(
            ...         publish_messages, channel)
            ... finally:
            ...    channel.close()
        """
        channels = [channel]

        class Revival:
            __name__ = getattr(fun, '__name__', None)
            __module__ = getattr(fun, '__module__', None)
            __doc__ = getattr(fun, '__doc__', None)

            def __init__(self, connection):
                self.connection = connection

            def revive(self, channel):
                channels[0] = channel

            def __call__(self, *args, **kwargs):
                if channels[0] is None:
                    self.revive(self.connection.default_channel)
                return fun(*args, channel=channels[0], **kwargs), channels[0]

        revive = Revival(self)
        return self.ensure(revive, revive, **ensure_options)

    def create_transport(self):
        return self.get_transport_cls()(client=self)

    def get_transport_cls(self):
        """Get the currently used transport class."""
        transport_cls = self.transport_cls
        if not transport_cls or isinstance(transport_cls, str):
            transport_cls = get_transport_cls(transport_cls)
        return transport_cls

    def clone(self, **kwargs):
        """Create a copy of the connection with same settings."""
        return self.__class__(**dict(self._info(resolve=False), **kwargs))

    def get_heartbeat_interval(self):
        return self.transport.get_heartbeat_interval(self.connection)

    def _info(self, resolve=True):
        transport_cls = self.transport_cls
        if resolve:
            transport_cls = self.resolve_aliases.get(
                transport_cls, transport_cls)
        D = self.transport.default_connection_params

        if not self.hostname and D.get('hostname'):
            logger.warning(
                "No hostname was supplied. "
                f"Reverting to default '{D.get('hostname')}'")
            hostname = D.get('hostname')
        else:
            hostname = self.hostname

        if self.uri_prefix:
            hostname = f'{self.uri_prefix}+{hostname}'

        info = (
            ('hostname', hostname),
            ('userid', self.userid or D.get('userid')),
            ('password', self.password or D.get('password')),
            ('virtual_host', self.virtual_host or D.get('virtual_host')),
            ('port', self.port or D.get('port')),
            ('insist', self.insist),
            ('ssl', self.ssl),
            ('transport', transport_cls),
            ('connect_timeout', self.connect_timeout),
            ('transport_options', self.transport_options),
            ('login_method', self.login_method or D.get('login_method')),
            ('uri_prefix', self.uri_prefix),
            ('heartbeat', self.heartbeat),
            ('failover_strategy', self._failover_strategy),
            ('alternates', self.alt),
        )
        return info

    def info(self):
        """Get connection info."""
        return dict(self._info())

    def __eqhash__(self):
        return HashedSeq(self.transport_cls, self.hostname, self.userid,
                         self.password, self.virtual_host, self.port,
                         repr(self.transport_options))

    def as_uri(self, include_password=False, mask='**',
               getfields=itemgetter('port', 'userid', 'password',
                                    'virtual_host', 'transport')) -> str:
        """Convert connection parameters to URL form."""
        hostname = self.hostname or 'localhost'
        if self.transport.can_parse_url:
            connection_as_uri = self.hostname
            try:
                return self.transport.as_uri(
                    connection_as_uri, include_password, mask)
            except NotImplementedError:
                pass

            if self.uri_prefix:
                connection_as_uri = f'{self.uri_prefix}+{hostname}'
            if not include_password:
                connection_as_uri = maybe_sanitize_url(connection_as_uri)
            return connection_as_uri
        if self.uri_prefix:
            connection_as_uri = f'{self.uri_prefix}+{hostname}'
            if not include_password:
                connection_as_uri = maybe_sanitize_url(connection_as_uri)
            return connection_as_uri
        fields = self.info()
        port, userid, password, vhost, transport = getfields(fields)

        return as_url(
            transport, hostname, port, userid, password, quote(vhost),
            sanitize=not include_password, mask=mask,
        )

    def Pool(self, limit=None, **kwargs):
        """Pool of connections.

        See Also
        --------
            :class:`ConnectionPool`.

        Arguments:
        ---------
            limit (int): Maximum number of active connections.
                Default is no limit.

        Example:
        -------
            >>> connection = Connection('amqp://')
            >>> pool = connection.Pool(2)
            >>> c1 = pool.acquire()
            >>> c2 = pool.acquire()
            >>> c3 = pool.acquire()
            Traceback (most recent call last):
              File "<stdin>", line 1, in <module>
              File "kombu/connection.py", line 354, in acquire
              raise ConnectionLimitExceeded(self.limit)
                kombu.exceptions.ConnectionLimitExceeded: 2
            >>> c1.release()
            >>> c3 = pool.acquire()
        """
        return ConnectionPool(self, limit, **kwargs)

    def ChannelPool(self, limit=None, **kwargs):
        """Pool of channels.

        See Also
        --------
            :class:`ChannelPool`.

        Arguments:
        ---------
            limit (int): Maximum number of active channels.
                Default is no limit.

        Example:
        -------
            >>> connection = Connection('amqp://')
            >>> pool = connection.ChannelPool(2)
            >>> c1 = pool.acquire()
            >>> c2 = pool.acquire()
            >>> c3 = pool.acquire()
            Traceback (most recent call last):
              File "<stdin>", line 1, in <module>
              File "kombu/connection.py", line 354, in acquire
              raise ChannelLimitExceeded(self.limit)
                kombu.connection.ChannelLimitExceeded: 2
            >>> c1.release()
            >>> c3 = pool.acquire()
        """
        return ChannelPool(self, limit, **kwargs)

    def Producer(self, channel=None, *args, **kwargs):
        """Create new :class:`kombu.Producer` instance."""
        from .messaging import Producer
        return Producer(channel or self, *args, **kwargs)

    def Consumer(self, queues=None, channel=None, *args, **kwargs):
        """Create new :class:`kombu.Consumer` instance."""
        from .messaging import Consumer
        return Consumer(channel or self, queues, *args, **kwargs)

    def SimpleQueue(self, name, no_ack=None, queue_opts=None,
                    queue_args=None,
                    exchange_opts=None, channel=None, **kwargs):
        """Simple persistent queue API.

        Create new :class:`~kombu.simple.SimpleQueue`, using a channel
        from this connection.

        If ``name`` is a string, a queue and exchange will be automatically
        created using that name as the name of the queue and exchange,
        also it will be used as the default routing key.

        Arguments:
        ---------
            name (str, kombu.Queue): Name of the queue/or a queue.
            no_ack (bool): Disable acknowledgments. Default is false.
            queue_opts (Dict): Additional keyword arguments passed to the
                constructor of the automatically created :class:`~kombu.Queue`.
            queue_args (Dict): Additional keyword arguments passed to the
                constructor of the automatically created :class:`~kombu.Queue`
                for setting implementation extensions (e.g., in RabbitMQ).
            exchange_opts (Dict): Additional keyword arguments passed to the
                constructor of the automatically created
                :class:`~kombu.Exchange`.
            channel (ChannelT): Custom channel to use. If not specified the
                connection default channel is used.
        """
        from .simple import SimpleQueue
        return SimpleQueue(channel or self, name, no_ack, queue_opts,
                           queue_args,
                           exchange_opts, **kwargs)

    def SimpleBuffer(self, name, no_ack=None, queue_opts=None,
                     queue_args=None,
                     exchange_opts=None, channel=None, **kwargs):
        """Simple ephemeral queue API.

        Create new :class:`~kombu.simple.SimpleQueue` using a channel
        from this connection.

        See Also
        --------
            Same as :meth:`SimpleQueue`, but configured with buffering
            semantics. The resulting queue and exchange will not be durable,
            also auto delete is enabled. Messages will be transient (not
            persistent), and acknowledgments are disabled (``no_ack``).
        """
        from .simple import SimpleBuffer
        return SimpleBuffer(channel or self, name, no_ack, queue_opts,
                            queue_args,
                            exchange_opts, **kwargs)

    def _establish_connection(self):
        self._debug('establishing connection...')
        conn = self.transport.establish_connection()
        self._debug('connection established: %r', self)
        return conn

    def supports_exchange_type(self, exchange_type):
        return exchange_type in self.transport.implements.exchange_type

    def __repr__(self):
        return f'<Connection: {self.as_uri()} at {id(self):#x}>'

    def __copy__(self):
        return self.clone()

    def __reduce__(self):
        return self.__class__, tuple(self.info().values()), None

    def __enter__(self):
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None
    ) -> None:
        self.release()

    @property
    def qos_semantics_matches_spec(self):
        return self.transport.qos_semantics_matches_spec(self.connection)

    def _extract_failover_opts(self):
        conn_opts = {'timeout': self.connect_timeout}
        transport_opts = self.transport_options
        if transport_opts:
            if 'max_retries' in transport_opts:
                conn_opts['max_retries'] = transport_opts['max_retries']
            if 'interval_start' in transport_opts:
                conn_opts['interval_start'] = transport_opts['interval_start']
            if 'interval_step' in transport_opts:
                conn_opts['interval_step'] = transport_opts['interval_step']
            if 'interval_max' in transport_opts:
                conn_opts['interval_max'] = transport_opts['interval_max']
            if 'connect_retries_timeout' in transport_opts:
                conn_opts['timeout'] = \
                    transport_opts['connect_retries_timeout']
            if 'errback' in transport_opts:
                conn_opts['errback'] = transport_opts['errback']
            if 'callback' in transport_opts:
                conn_opts['callback'] = transport_opts['callback']
        return conn_opts

    @property
    def connected(self):
        """Return true if the connection has been established."""
        return (not self._closed and
                self._connection is not None and
                self.transport.verify_connection(self._connection))

    @property
    def connection(self):
        """The underlying connection object.

        Warning:
        -------
            This instance is transport specific, so do not
            depend on the interface of this object.
        """
        if not self._closed:
            if not self.connected:
                return self._ensure_connection(
                    max_retries=1, reraise_as_library_errors=False
                )
            return self._connection

    def _connection_factory(self):
        self.declared_entities.clear()
        self._default_channel = None
        self._connection = self._establish_connection()
        self._closed = False
        return self._connection

    @property
    def default_channel(self) -> Channel:
        """Default channel.

        Created upon access and closed when the connection is closed.

        Note:
        ----
            Can be used for automatic channel handling when you only need one
            channel, and also it is the channel implicitly used if
            a connection is passed instead of a channel, to functions that
            require a channel.
        """
        # make sure we're still connected, and if not refresh.
        conn_opts = self._extract_failover_opts()
        self._ensure_connection(**conn_opts)

        if self._default_channel is None:
            self._default_channel = self.channel()
        return self._default_channel

    @property
    def host(self):
        """The host as a host name/port pair separated by colon."""
        return ':'.join([self.hostname, str(self.port)])

    @property
    def transport(self):
        if self._transport is None:
            self._transport = self.create_transport()
        return self._transport

    @cached_property
    def manager(self):
        """AMQP Management API.

        Experimental manager that can be used to manage/monitor the broker
        instance.

        Not available for all transports.
        """
        return self.transport.manager

    def get_manager(self, *args, **kwargs):
        return self.transport.get_manager(*args, **kwargs)

    @cached_property
    def recoverable_connection_errors(self):
        """Recoverable connection errors.

        List of connection related exceptions that can be recovered from,
        but where the connection must be closed and re-established first.
        """
        try:
            return self.get_transport_cls().recoverable_connection_errors
        except AttributeError:
            # There were no such classification before,
            # and all errors were assumed to be recoverable,
            # so this is a fallback for transports that do
            # not support the new recoverable/irrecoverable classes.
            return self.connection_errors + self.channel_errors

    @cached_property
    def recoverable_channel_errors(self):
        """Recoverable channel errors.

        List of channel related exceptions that can be automatically
        recovered from without re-establishing the connection.
        """
        try:
            return self.get_transport_cls().recoverable_channel_errors
        except AttributeError:
            return ()

    @cached_property
    def connection_errors(self):
        """List of exceptions that may be raised by the connection."""
        return self.get_transport_cls().connection_errors

    @cached_property
    def channel_errors(self):
        """List of exceptions that may be raised by the channel."""
        return self.get_transport_cls().channel_errors

    @property
    def supports_heartbeats(self):
        return self.transport.implements.heartbeats

    @property
    def is_evented(self):
        return self.transport.implements.asynchronous


BrokerConnection = Connection


class PooledConnection(Connection):
    """Wraps :class:`kombu.Connection`.

    This wrapper modifies :meth:`kombu.Connection.__exit__` to close the connection
    in case any exception occurred while the context was active.
    """

    def __init__(self, pool, **kwargs):
        self._pool = pool
        super().__init__(**kwargs)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None and self._pool.limit:
            self._pool.replace(self)
        return super().__exit__(exc_type, exc_val, exc_tb)


class ConnectionPool(Resource):
    """Pool of connections."""

    LimitExceeded = exceptions.ConnectionLimitExceeded
    close_after_fork = True

    def __init__(self, connection, limit=None, **kwargs):
        self.connection = connection
        super().__init__(limit=limit)

    def new(self):
        return PooledConnection(self, **dict(self.connection._info(resolve=False)))

    def release_resource(self, resource):
        try:
            resource._debug('released')
        except AttributeError:
            pass

    def close_resource(self, resource):
        resource._close()

    def collect_resource(self, resource, socket_timeout=0.1):
        if not isinstance(resource, lazy):
            return resource.collect(socket_timeout)

    @contextmanager
    def acquire_channel(self, block=False):
        with self.acquire(block=block) as connection:
            yield connection, connection.default_channel

    def setup(self):
        if self.limit:
            q = self._resource.queue
            # Keep in mind dirty/used resources
            while len(q) < self.limit - len(self._dirty):
                self._resource.put_nowait(lazy(self.new))

    def prepare(self, resource):
        if callable(resource):
            resource = resource()
        resource._debug('acquired')
        return resource


class ChannelPool(Resource):
    """Pool of channels."""

    LimitExceeded = exceptions.ChannelLimitExceeded

    def __init__(self, connection, limit=None, **kwargs):
        self.connection = connection
        super().__init__(limit=limit)

    def new(self):
        return lazy(self.connection.channel)

    def setup(self):
        channel = self.new()
        if self.limit:
            q = self._resource.queue
            # Keep in mind dirty/used resources
            while len(q) < self.limit - len(self._dirty):
                self._resource.put_nowait(lazy(channel))

    def prepare(self, channel):
        if callable(channel):
            channel = channel()
        return channel


def maybe_channel(channel: Channel | Connection) -> Channel:
    """Get channel from object.

    Return the default channel if argument is a connection instance,
    otherwise just return the channel given.
    """
    if is_connection(channel):
        return channel.default_channel
    return channel


def is_connection(obj: Any) -> TypeGuard[Connection]:
    return isinstance(obj, Connection)
