"""AMQP Connections."""
# Copyright (C) 2007-2008 Barry Pederson <bp@barryp.org>

import logging
import socket
import uuid
import warnings
from array import array
from time import monotonic

from vine import ensure_promise

from . import __version__, sasl, spec
from .abstract_channel import AbstractChannel
from .channel import Channel
from .exceptions import (AMQPDeprecationWarning, ChannelError, ConnectionError,
                         ConnectionForced, MessageNacked, RecoverableChannelError,
                         RecoverableConnectionError, ResourceError,
                         error_for_code)
from .method_framing import frame_handler, frame_writer
from .transport import Transport

try:
    from ssl import SSLError
except ImportError:  # pragma: no cover
    class SSLError(Exception):  # noqa
        pass

W_FORCE_CONNECT = """\
The .{attr} attribute on the connection was accessed before
the connection was established.  This is supported for now, but will
be deprecated in amqp 2.2.0.

Since amqp 2.0 you have to explicitly call Connection.connect()
before using the connection.
"""

START_DEBUG_FMT = """
Start from server, version: %d.%d, properties: %s, mechanisms: %s, locales: %s
""".strip()

__all__ = ('Connection',)

AMQP_LOGGER = logging.getLogger('amqp')
AMQP_HEARTBEAT_LOGGER = logging.getLogger(
    'amqp.connection.Connection.heartbeat_tick'
)

#: Default map for :attr:`Connection.library_properties`
LIBRARY_PROPERTIES = {
    'product': 'py-amqp',
    'product_version': __version__,
}

#: Default map for :attr:`Connection.negotiate_capabilities`
NEGOTIATE_CAPABILITIES = {
    'consumer_cancel_notify': True,
    'connection.blocked': True,
    'authentication_failure_close': True,
}


class Connection(AbstractChannel):
    """AMQP Connection.

    The connection class provides methods for a client to establish a
    network connection to a server, and for both peers to operate the
    connection thereafter.

    GRAMMAR::

        connection          = open-connection *use-connection close-connection
        open-connection     = C:protocol-header
                              S:START C:START-OK
                              *challenge
                              S:TUNE C:TUNE-OK
                              C:OPEN S:OPEN-OK
        challenge           = S:SECURE C:SECURE-OK
        use-connection      = *channel
        close-connection    = C:CLOSE S:CLOSE-OK
                            / S:CLOSE C:CLOSE-OK
    Create a connection to the specified host, which should be
    a 'host[:port]', such as 'localhost', or '1.2.3.4:5672'
    (defaults to 'localhost', if a port is not specified then
    5672 is used)

    Authentication can be controlled by passing one or more
    `amqp.sasl.SASL` instances as the `authentication` parameter, or
    setting the `login_method` string to one of the supported methods:
    'GSSAPI', 'EXTERNAL', 'AMQPLAIN', or 'PLAIN'.
    Otherwise authentication will be performed using any supported method
    preferred by the server. Userid and passwords apply to AMQPLAIN and
    PLAIN authentication, whereas on GSSAPI only userid will be used as the
    client name. For EXTERNAL authentication both userid and password are
    ignored.

    The 'ssl' parameter may be simply True/False, or
    a dictionary of options to pass to :class:`ssl.SSLContext` such as
    requiring certain certificates. For details, refer ``ssl`` parameter of
    :class:`~amqp.transport.SSLTransport`.

    The "socket_settings" parameter is a dictionary defining tcp
    settings which will be applied as socket options.

    When "confirm_publish" is set to True, the channel is put to
    confirm mode. In this mode, each published message is
    confirmed using Publisher confirms RabbitMQ extension.
    """

    Channel = Channel

    #: Mapping of protocol extensions to enable.
    #: The server will report these in server_properties[capabilities],
    #: and if a key in this map is present the client will tell the
    #: server to either enable or disable the capability depending
    #: on the value set in this map.
    #: For example with:
    #:     negotiate_capabilities = {
    #:         'consumer_cancel_notify': True,
    #:     }
    #: The client will enable this capability if the server reports
    #: support for it, but if the value is False the client will
    #: disable the capability.
    negotiate_capabilities = NEGOTIATE_CAPABILITIES

    #: These are sent to the server to announce what features
    #: we support, type of client etc.
    library_properties = LIBRARY_PROPERTIES

    #: Final heartbeat interval value (in float seconds) after negotiation
    heartbeat = None

    #: Original heartbeat interval value proposed by client.
    client_heartbeat = None

    #: Original heartbeat interval proposed by server.
    server_heartbeat = None

    #: Time of last heartbeat sent (in monotonic time, if available).
    last_heartbeat_sent = 0

    #: Time of last heartbeat received (in monotonic time, if available).
    last_heartbeat_received = 0

    #: Number of successful writes to socket.
    bytes_sent = 0

    #: Number of successful reads from socket.
    bytes_recv = 0

    #: Number of bytes sent to socket at the last heartbeat check.
    prev_sent = None

    #: Number of bytes received from socket at the last heartbeat check.
    prev_recv = None

    _METHODS = {
        spec.method(spec.Connection.Start, 'ooFSS'),
        spec.method(spec.Connection.OpenOk),
        spec.method(spec.Connection.Secure, 's'),
        spec.method(spec.Connection.Tune, 'BlB'),
        spec.method(spec.Connection.Close, 'BsBB'),
        spec.method(spec.Connection.Blocked),
        spec.method(spec.Connection.Unblocked),
        spec.method(spec.Connection.CloseOk),
    }
    _METHODS = {m.method_sig: m for m in _METHODS}

    _ALLOWED_METHODS_WHEN_CLOSING = (
        spec.Connection.Close, spec.Connection.CloseOk
    )

    connection_errors = (
        ConnectionError,
        socket.error,
        IOError,
        OSError,
    )
    channel_errors = (ChannelError,)
    recoverable_connection_errors = (
        RecoverableConnectionError,
        MessageNacked,
        socket.error,
        IOError,
        OSError,
    )
    recoverable_channel_errors = (
        RecoverableChannelError,
    )

    def __init__(self, host='localhost:5672', userid='guest', password='guest',
                 login_method=None, login_response=None,
                 authentication=(),
                 virtual_host='/', locale='en_US', client_properties=None,
                 ssl=False, connect_timeout=None, channel_max=None,
                 frame_max=None, heartbeat=0, on_open=None, on_blocked=None,
                 on_unblocked=None, confirm_publish=False,
                 on_tune_ok=None, read_timeout=None, write_timeout=None,
                 socket_settings=None, frame_handler=frame_handler,
                 frame_writer=frame_writer, **kwargs):
        self._connection_id = uuid.uuid4().hex
        channel_max = channel_max or 65535
        frame_max = frame_max or 131072
        if authentication:
            if isinstance(authentication, sasl.SASL):
                authentication = (authentication,)
            self.authentication = authentication
        elif login_method is not None:
            if login_method == 'GSSAPI':
                auth = sasl.GSSAPI(userid)
            elif login_method == 'EXTERNAL':
                auth = sasl.EXTERNAL()
            elif login_method == 'AMQPLAIN':
                if userid is None or password is None:
                    raise ValueError(
                        "Must supply authentication or userid/password")
                auth = sasl.AMQPLAIN(userid, password)
            elif login_method == 'PLAIN':
                if userid is None or password is None:
                    raise ValueError(
                        "Must supply authentication or userid/password")
                auth = sasl.PLAIN(userid, password)
            elif login_response is not None:
                auth = sasl.RAW(login_method, login_response)
            else:
                raise ValueError("Invalid login method", login_method)
            self.authentication = (auth,)
        else:
            self.authentication = (sasl.GSSAPI(userid, fail_soft=True),
                                   sasl.EXTERNAL(),
                                   sasl.AMQPLAIN(userid, password),
                                   sasl.PLAIN(userid, password))

        self.client_properties = dict(
            self.library_properties, **client_properties or {}
        )
        self.locale = locale
        self.host = host
        self.virtual_host = virtual_host
        self.on_tune_ok = ensure_promise(on_tune_ok)

        self.frame_handler_cls = frame_handler
        self.frame_writer_cls = frame_writer

        self._handshake_complete = False

        self.channels = {}
        # The connection object itself is treated as channel 0
        super().__init__(self, 0)

        self._frame_writer = None
        self._on_inbound_frame = None
        self._transport = None

        # Properties set in the Tune method
        self.channel_max = channel_max
        self.frame_max = frame_max
        self.client_heartbeat = heartbeat

        self.confirm_publish = confirm_publish
        self.ssl = ssl
        self.read_timeout = read_timeout
        self.write_timeout = write_timeout
        self.socket_settings = socket_settings

        # Callbacks
        self.on_blocked = on_blocked
        self.on_unblocked = on_unblocked
        self.on_open = ensure_promise(on_open)

        self._used_channel_ids = array('H')

        # Properties set in the Start method
        self.version_major = 0
        self.version_minor = 0
        self.server_properties = {}
        self.mechanisms = []
        self.locales = []

        self.connect_timeout = connect_timeout

    def __repr__(self):
        if self._transport:
            return f'<AMQP Connection: {self.host}/{self.virtual_host} '\
                   f'using {self._transport} at {id(self):#x}>'
        else:
            return f'<AMQP Connection: {self.host}/{self.virtual_host} '\
                   f'(disconnected) at {id(self):#x}>'

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *eargs):
        self.close()

    def then(self, on_success, on_error=None):
        return self.on_open.then(on_success, on_error)

    def _setup_listeners(self):
        self._callbacks.update({
            spec.Connection.Start: self._on_start,
            spec.Connection.OpenOk: self._on_open_ok,
            spec.Connection.Secure: self._on_secure,
            spec.Connection.Tune: self._on_tune,
            spec.Connection.Close: self._on_close,
            spec.Connection.Blocked: self._on_blocked,
            spec.Connection.Unblocked: self._on_unblocked,
            spec.Connection.CloseOk: self._on_close_ok,
        })

    def connect(self, callback=None):
        # Let the transport.py module setup the actual
        # socket connection to the broker.
        #
        if self.connected:
            return callback() if callback else None
        try:
            self.transport = self.Transport(
                self.host, self.connect_timeout, self.ssl,
                self.read_timeout, self.write_timeout,
                socket_settings=self.socket_settings,
            )
            self.transport.connect()
            self.on_inbound_frame = self.frame_handler_cls(
                self, self.on_inbound_method)
            self.frame_writer = self.frame_writer_cls(self, self.transport)

            while not self._handshake_complete:
                self.drain_events(timeout=self.connect_timeout)

        except (OSError, SSLError):
            self.collect()
            raise

    def _warn_force_connect(self, attr):
        warnings.warn(AMQPDeprecationWarning(
            W_FORCE_CONNECT.format(attr=attr)))

    @property
    def transport(self):
        if self._transport is None:
            self._warn_force_connect('transport')
            self.connect()
        return self._transport

    @transport.setter
    def transport(self, transport):
        self._transport = transport

    @property
    def on_inbound_frame(self):
        if self._on_inbound_frame is None:
            self._warn_force_connect('on_inbound_frame')
            self.connect()
        return self._on_inbound_frame

    @on_inbound_frame.setter
    def on_inbound_frame(self, on_inbound_frame):
        self._on_inbound_frame = on_inbound_frame

    @property
    def frame_writer(self):
        if self._frame_writer is None:
            self._warn_force_connect('frame_writer')
            self.connect()
        return self._frame_writer

    @frame_writer.setter
    def frame_writer(self, frame_writer):
        self._frame_writer = frame_writer

    def _on_start(self, version_major, version_minor, server_properties,
                  mechanisms, locales, argsig='FsSs'):
        client_properties = self.client_properties
        self.version_major = version_major
        self.version_minor = version_minor
        self.server_properties = server_properties
        if isinstance(mechanisms, str):
            mechanisms = mechanisms.encode('utf-8')
        self.mechanisms = mechanisms.split(b' ')
        self.locales = locales.split(' ')
        AMQP_LOGGER.debug(
            START_DEBUG_FMT,
            self.version_major, self.version_minor,
            self.server_properties, self.mechanisms, self.locales,
        )

        # Negotiate protocol extensions (capabilities)
        scap = server_properties.get('capabilities') or {}
        cap = client_properties.setdefault('capabilities', {})
        cap.update({
            wanted_cap: enable_cap
            for wanted_cap, enable_cap in self.negotiate_capabilities.items()
            if scap.get(wanted_cap)
        })
        if not cap:
            # no capabilities, server may not react well to having
            # this key present in client_properties, so we remove it.
            client_properties.pop('capabilities', None)

        for authentication in self.authentication:
            if authentication.mechanism in self.mechanisms:
                login_response = authentication.start(self)
                if login_response is not NotImplemented:
                    break
        else:
            raise ConnectionError(
                "Couldn't find appropriate auth mechanism "
                "(can offer: {}; available: {})".format(
                    b", ".join(m.mechanism
                               for m in self.authentication
                               if m.mechanism).decode(),
                    b", ".join(self.mechanisms).decode()))

        self.send_method(
            spec.Connection.StartOk, argsig,
            (client_properties, authentication.mechanism,
             login_response, self.locale),
        )

    def _on_secure(self, challenge):
        pass

    def _on_tune(self, channel_max, frame_max, server_heartbeat, argsig='BlB'):
        client_heartbeat = self.client_heartbeat or 0
        self.channel_max = channel_max or self.channel_max
        self.frame_max = frame_max or self.frame_max
        self.server_heartbeat = server_heartbeat or 0

        # negotiate the heartbeat interval to the smaller of the
        # specified values
        if self.server_heartbeat == 0 or client_heartbeat == 0:
            self.heartbeat = max(self.server_heartbeat, client_heartbeat)
        else:
            self.heartbeat = min(self.server_heartbeat, client_heartbeat)

        # Ignore server heartbeat if client_heartbeat is disabled
        if not self.client_heartbeat:
            self.heartbeat = 0

        self.send_method(
            spec.Connection.TuneOk, argsig,
            (self.channel_max, self.frame_max, self.heartbeat),
            callback=self._on_tune_sent,
        )

    def _on_tune_sent(self, argsig='ssb'):
        self.send_method(
            spec.Connection.Open, argsig, (self.virtual_host, '', False),
        )

    def _on_open_ok(self):
        self._handshake_complete = True
        self.on_open(self)

    def Transport(self, host, connect_timeout,
                  ssl=False, read_timeout=None, write_timeout=None,
                  socket_settings=None, **kwargs):
        return Transport(
            host, connect_timeout=connect_timeout, ssl=ssl,
            read_timeout=read_timeout, write_timeout=write_timeout,
            socket_settings=socket_settings, **kwargs)

    @property
    def connected(self):
        return self._transport and self._transport.connected

    def collect(self):
        if self._transport:
            self._transport.close()

        if self.channels:
            # Copy all the channels except self since the channels
            # dictionary changes during the collection process.
            channels = [
                ch for ch in self.channels.values()
                if ch is not self
            ]

            for ch in channels:
                ch.collect()
        self._transport = self.connection = self.channels = None

    def _get_free_channel_id(self):
        # Cast to a set for fast lookups, and keep stored as an array for lower memory usage.
        used_channel_ids = set(self._used_channel_ids)

        for channel_id in range(1, self.channel_max + 1):
            if channel_id not in used_channel_ids:
                self._used_channel_ids.append(channel_id)
                return channel_id

        raise ResourceError(
            'No free channel ids, current={}, channel_max={}'.format(
                len(self.channels), self.channel_max), spec.Channel.Open)

    def _claim_channel_id(self, channel_id):
        if channel_id in self._used_channel_ids:
            raise ConnectionError(f'Channel {channel_id!r} already open')
        else:
            self._used_channel_ids.append(channel_id)
            return channel_id

    def channel(self, channel_id=None, callback=None):
        """Create new channel.

        Fetch a Channel object identified by the numeric channel_id, or
        create that object if it doesn't already exist.
        """
        if self.channels is None:
            raise RecoverableConnectionError('Connection already closed.')

        try:
            return self.channels[channel_id]
        except KeyError:
            channel = self.Channel(self, channel_id, on_open=callback)
            channel.open()
            return channel

    def is_alive(self):
        raise NotImplementedError('Use AMQP heartbeats')

    def drain_events(self, timeout=None):
        # read until message is ready
        while not self.blocking_read(timeout):
            pass

    def blocking_read(self, timeout=None):
        with self.transport.having_timeout(timeout):
            frame = self.transport.read_frame()
        return self.on_inbound_frame(frame)

    def on_inbound_method(self, channel_id, method_sig, payload, content):
        if self.channels is None:
            raise RecoverableConnectionError('Connection already closed')

        return self.channels[channel_id].dispatch_method(
            method_sig, payload, content,
        )

    def close(self, reply_code=0, reply_text='', method_sig=(0, 0),
              argsig='BsBB'):
        """Request a connection close.

        This method indicates that the sender wants to close the
        connection. This may be due to internal conditions (e.g. a
        forced shut-down) or due to an error handling a specific
        method, i.e. an exception.  When a close is due to an
        exception, the sender provides the class and method id of the
        method which caused the exception.

        RULE:

            After sending this method any received method except the
            Close-OK method MUST be discarded.

        RULE:

            The peer sending this method MAY use a counter or timeout
            to detect failure of the other peer to respond correctly
            with the Close-OK method.

        RULE:

            When a server receives the Close method from a client it
            MUST delete all server-side resources associated with the
            client's context.  A client CANNOT reconnect to a context
            after sending or receiving a Close method.

        PARAMETERS:
            reply_code: short

                The reply code. The AMQ reply codes are defined in AMQ
                RFC 011.

            reply_text: shortstr

                The localised reply text.  This text can be logged as an
                aid to resolving issues.

            class_id: short

                failing method class

                When the close is provoked by a method exception, this
                is the class of the method.

            method_id: short

                failing method ID

                When the close is provoked by a method exception, this
                is the ID of the method.
        """
        if self._transport is None:
            # already closed
            return

        try:
            self.is_closing = True
            return self.send_method(
                spec.Connection.Close, argsig,
                (reply_code, reply_text, method_sig[0], method_sig[1]),
                wait=spec.Connection.CloseOk,
            )
        except (OSError, SSLError):
            # close connection
            self.collect()
            raise
        finally:
            self.is_closing = False

    def _on_close(self, reply_code, reply_text, class_id, method_id):
        """Request a connection close.

        This method indicates that the sender wants to close the
        connection. This may be due to internal conditions (e.g. a
        forced shut-down) or due to an error handling a specific
        method, i.e. an exception.  When a close is due to an
        exception, the sender provides the class and method id of the
        method which caused the exception.

        RULE:

            After sending this method any received method except the
            Close-OK method MUST be discarded.

        RULE:

            The peer sending this method MAY use a counter or timeout
            to detect failure of the other peer to respond correctly
            with the Close-OK method.

        RULE:

            When a server receives the Close method from a client it
            MUST delete all server-side resources associated with the
            client's context.  A client CANNOT reconnect to a context
            after sending or receiving a Close method.

        PARAMETERS:
            reply_code: short

                The reply code. The AMQ reply codes are defined in AMQ
                RFC 011.

            reply_text: shortstr

                The localised reply text.  This text can be logged as an
                aid to resolving issues.

            class_id: short

                failing method class

                When the close is provoked by a method exception, this
                is the class of the method.

            method_id: short

                failing method ID

                When the close is provoked by a method exception, this
                is the ID of the method.
        """
        self._x_close_ok()
        raise error_for_code(reply_code, reply_text,
                             (class_id, method_id), ConnectionError)

    def _x_close_ok(self):
        """Confirm a connection close.

        This method confirms a Connection.Close method and tells the
        recipient that it is safe to release resources for the
        connection and close the socket.

        RULE:
            A peer that detects a socket closure without having
            received a Close-Ok handshake method SHOULD log the error.
        """
        self.send_method(spec.Connection.CloseOk, callback=self._on_close_ok)

    def _on_close_ok(self):
        """Confirm a connection close.

        This method confirms a Connection.Close method and tells the
        recipient that it is safe to release resources for the
        connection and close the socket.

        RULE:

            A peer that detects a socket closure without having
            received a Close-Ok handshake method SHOULD log the error.
        """
        self.collect()

    def _on_blocked(self):
        """Callback called when connection blocked.

        Notes:
            This is an RabbitMQ Extension.
        """
        reason = 'connection blocked, see broker logs'
        if self.on_blocked:
            return self.on_blocked(reason)

    def _on_unblocked(self):
        if self.on_unblocked:
            return self.on_unblocked()

    def send_heartbeat(self):
        self.frame_writer(8, 0, None, None, None)

    def heartbeat_tick(self, rate=2):
        """Send heartbeat packets if necessary.

        Raises:
            ~amqp.exceptions.ConnectionForvced: if none have been
                received recently.

        Note:
            This should be called frequently, on the order of
            once per second.

        Keyword Arguments:
            rate (int): Number of heartbeat frames to send during the heartbeat
                        timeout
        """
        AMQP_HEARTBEAT_LOGGER.debug('heartbeat_tick : for connection %s',
                                    self._connection_id)
        if not self.heartbeat:
            return

        # If rate is wrong, let's use 2 as default
        if rate <= 0:
            rate = 2

        # treat actual data exchange in either direction as a heartbeat
        sent_now = self.bytes_sent
        recv_now = self.bytes_recv
        if self.prev_sent is None or self.prev_sent != sent_now:
            self.last_heartbeat_sent = monotonic()
        if self.prev_recv is None or self.prev_recv != recv_now:
            self.last_heartbeat_received = monotonic()

        now = monotonic()
        AMQP_HEARTBEAT_LOGGER.debug(
            'heartbeat_tick : Prev sent/recv: %s/%s, '
            'now - %s/%s, monotonic - %s, '
            'last_heartbeat_sent - %s, heartbeat int. - %s '
            'for connection %s',
            self.prev_sent, self.prev_recv,
            sent_now, recv_now, now,
            self.last_heartbeat_sent,
            self.heartbeat,
            self._connection_id,
        )

        self.prev_sent, self.prev_recv = sent_now, recv_now

        # send a heartbeat if it's time to do so
        if now > self.last_heartbeat_sent + self.heartbeat / rate:
            AMQP_HEARTBEAT_LOGGER.debug(
                'heartbeat_tick: sending heartbeat for connection %s',
                self._connection_id)
            self.send_heartbeat()
            self.last_heartbeat_sent = monotonic()

        # if we've missed two intervals' heartbeats, fail; this gives the
        # server enough time to send heartbeats a little late
        two_heartbeats = 2 * self.heartbeat
        two_heartbeats_interval = self.last_heartbeat_received + two_heartbeats
        heartbeats_missed = two_heartbeats_interval < monotonic()
        if self.last_heartbeat_received and heartbeats_missed:
            raise ConnectionForced('Too many heartbeats missed')

    @property
    def sock(self):
        return self.transport.sock

    @property
    def server_capabilities(self):
        return self.server_properties.get('capabilities') or {}
