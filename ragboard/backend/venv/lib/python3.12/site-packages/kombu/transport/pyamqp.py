"""pyamqp transport module for Kombu.

Pure-Python amqp transport using py-amqp library.

Features
========
* Type: Native
* Supports Direct: Yes
* Supports Topic: Yes
* Supports Fanout: Yes
* Supports Priority: Yes
* Supports TTL: Yes

Connection String
=================
Connection string can have the following formats:

.. code-block::

    amqp://[USER:PASSWORD@]BROKER_ADDRESS[:PORT][/VIRTUALHOST]
    [USER:PASSWORD@]BROKER_ADDRESS[:PORT][/VIRTUALHOST]
    amqp://

For TLS encryption use:

.. code-block::

    amqps://[USER:PASSWORD@]BROKER_ADDRESS[:PORT][/VIRTUALHOST]

Transport Options
=================
Transport Options are passed to constructor of underlying py-amqp
:class:`~kombu.connection.Connection` class.

Using TLS
=========
Transport over TLS can be enabled by ``ssl`` parameter of
:class:`~kombu.Connection` class. By setting ``ssl=True``, TLS transport is
used::

    conn = Connect('amqp://', ssl=True)

This is equivalent to ``amqps://`` transport URI::

    conn = Connect('amqps://')

For adding additional parameters to underlying TLS, ``ssl`` parameter should
be set with dict instead of True::

    conn = Connect('amqp://broker.example.com', ssl={
            'keyfile': '/path/to/keyfile'
            'certfile': '/path/to/certfile',
            'ca_certs': '/path/to/ca_certfile'
        }
    )

All parameters are passed to ``ssl`` parameter of
:class:`amqp.connection.Connection` class.

SSL option ``server_hostname`` can be set to ``None`` which is causing using
hostname from broker URL. This is useful when failover is used to fill
``server_hostname`` with currently used broker::

    conn = Connect('amqp://broker1.example.com;broker2.example.com', ssl={
            'server_hostname': None
        }
    )
"""


from __future__ import annotations

import amqp

from kombu.utils.amq_manager import get_manager
from kombu.utils.text import version_string_as_tuple

from . import base
from .base import to_rabbitmq_queue_arguments

DEFAULT_PORT = 5672
DEFAULT_SSL_PORT = 5671


class Message(base.Message):
    """AMQP Message."""

    def __init__(self, msg, channel=None, **kwargs):
        props = msg.properties
        super().__init__(
            body=msg.body,
            channel=channel,
            delivery_tag=msg.delivery_tag,
            content_type=props.get('content_type'),
            content_encoding=props.get('content_encoding'),
            delivery_info=msg.delivery_info,
            properties=msg.properties,
            headers=props.get('application_headers') or {},
            **kwargs)


class Channel(amqp.Channel, base.StdChannel):
    """AMQP Channel."""

    Message = Message

    def prepare_message(self, body, priority=None,
                        content_type=None, content_encoding=None,
                        headers=None, properties=None, _Message=amqp.Message):
        """Prepare message so that it can be sent using this transport."""
        return _Message(
            body,
            priority=priority,
            content_type=content_type,
            content_encoding=content_encoding,
            application_headers=headers,
            **properties or {}
        )

    def prepare_queue_arguments(self, arguments, **kwargs):
        return to_rabbitmq_queue_arguments(arguments, **kwargs)

    def message_to_python(self, raw_message):
        """Convert encoded message body back to a Python value."""
        return self.Message(raw_message, channel=self)


class Connection(amqp.Connection):
    """AMQP Connection."""

    Channel = Channel


class Transport(base.Transport):
    """AMQP Transport."""

    Connection = Connection

    default_port = DEFAULT_PORT
    default_ssl_port = DEFAULT_SSL_PORT

    # it's very annoying that pyamqp sometimes raises AttributeError
    # if the connection is lost, but nothing we can do about that here.
    connection_errors = amqp.Connection.connection_errors
    channel_errors = amqp.Connection.channel_errors
    recoverable_connection_errors = \
        amqp.Connection.recoverable_connection_errors
    recoverable_channel_errors = amqp.Connection.recoverable_channel_errors

    driver_name = 'py-amqp'
    driver_type = 'amqp'

    implements = base.Transport.implements.extend(
        asynchronous=True,
        heartbeats=True,
    )

    def __init__(self, client,
                 default_port=None, default_ssl_port=None, **kwargs):
        self.client = client
        self.default_port = default_port or self.default_port
        self.default_ssl_port = default_ssl_port or self.default_ssl_port

    def driver_version(self):
        return amqp.__version__

    def create_channel(self, connection):
        return connection.channel()

    def drain_events(self, connection, **kwargs):
        return connection.drain_events(**kwargs)

    def _collect(self, connection):
        if connection is not None:
            connection.collect()

    def establish_connection(self):
        """Establish connection to the AMQP broker."""
        conninfo = self.client
        for name, default_value in self.default_connection_params.items():
            if not getattr(conninfo, name, None):
                setattr(conninfo, name, default_value)
        if conninfo.hostname == 'localhost':
            conninfo.hostname = '127.0.0.1'
        # when server_hostname is None, use hostname from URI.
        if isinstance(conninfo.ssl, dict) and \
                'server_hostname' in conninfo.ssl and \
                conninfo.ssl['server_hostname'] is None:
            conninfo.ssl['server_hostname'] = conninfo.hostname
        opts = dict({
            'host': conninfo.host,
            'userid': conninfo.userid,
            'password': conninfo.password,
            'login_method': conninfo.login_method,
            'virtual_host': conninfo.virtual_host,
            'insist': conninfo.insist,
            'ssl': conninfo.ssl,
            'connect_timeout': conninfo.connect_timeout,
            'heartbeat': conninfo.heartbeat,
        }, **conninfo.transport_options or {})
        conn = self.Connection(**opts)
        conn.client = self.client
        conn.connect()
        return conn

    def verify_connection(self, connection):
        return connection.connected

    def close_connection(self, connection):
        """Close the AMQP broker connection."""
        connection.client = None
        connection.close()

    def get_heartbeat_interval(self, connection):
        return connection.heartbeat

    def register_with_event_loop(self, connection, loop):
        connection.transport.raise_on_initial_eintr = True
        loop.add_reader(connection.sock, self.on_readable, connection, loop)

    def heartbeat_check(self, connection, rate=2):
        return connection.heartbeat_tick(rate=rate)

    def qos_semantics_matches_spec(self, connection):
        props = connection.server_properties
        if props.get('product') == 'RabbitMQ':
            return version_string_as_tuple(props['version']) < (3, 3)
        return True

    @property
    def default_connection_params(self):
        return {
            'userid': 'guest',
            'password': 'guest',
            'port': (self.default_ssl_port if self.client.ssl
                     else self.default_port),
            'hostname': 'localhost',
            'login_method': 'PLAIN',
        }

    def get_manager(self, *args, **kwargs):
        return get_manager(self.client, *args, **kwargs)


class SSLTransport(Transport):
    """AMQP SSL Transport."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # ugh, not exactly pure, but hey, it's python.
        if not self.client.ssl:  # not dict or False
            self.client.ssl = True
