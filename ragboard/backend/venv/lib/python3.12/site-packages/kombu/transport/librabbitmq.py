"""`librabbitmq`_ transport.

.. _`librabbitmq`: https://pypi.org/project/librabbitmq/
"""

from __future__ import annotations

import os
import socket
import warnings

import librabbitmq as amqp
from librabbitmq import ChannelError, ConnectionError

from kombu.utils.amq_manager import get_manager
from kombu.utils.text import version_string_as_tuple

from . import base
from .base import to_rabbitmq_queue_arguments

W_VERSION = """
    librabbitmq version too old to detect RabbitMQ version information
    so make sure you are using librabbitmq 1.5 when using rabbitmq > 3.3
"""
DEFAULT_PORT = 5672
DEFAULT_SSL_PORT = 5671

NO_SSL_ERROR = """\
ssl not supported by librabbitmq, please use pyamqp:// or stunnel\
"""


class Message(base.Message):
    """AMQP Message (librabbitmq)."""

    def __init__(self, channel, props, info, body):
        super().__init__(
            channel=channel,
            body=body,
            delivery_info=info,
            properties=props,
            delivery_tag=info.get('delivery_tag'),
            content_type=props.get('content_type'),
            content_encoding=props.get('content_encoding'),
            headers=props.get('headers'))


class Channel(amqp.Channel, base.StdChannel):
    """AMQP Channel (librabbitmq)."""

    Message = Message

    def prepare_message(self, body, priority=None,
                        content_type=None, content_encoding=None,
                        headers=None, properties=None):
        """Encapsulate data into a AMQP message."""
        properties = properties if properties is not None else {}
        properties.update({'content_type': content_type,
                           'content_encoding': content_encoding,
                           'headers': headers})
        # Don't include priority if it's not an integer.
        # If that's the case librabbitmq will fail
        # and raise an exception.
        if priority is not None:
            properties['priority'] = priority
        return body, properties

    def prepare_queue_arguments(self, arguments, **kwargs):
        arguments = to_rabbitmq_queue_arguments(arguments, **kwargs)
        return {k.encode('utf8'): v for k, v in arguments.items()}


class Connection(amqp.Connection):
    """AMQP Connection (librabbitmq)."""

    Channel = Channel
    Message = Message


class Transport(base.Transport):
    """AMQP Transport (librabbitmq)."""

    Connection = Connection

    default_port = DEFAULT_PORT
    default_ssl_port = DEFAULT_SSL_PORT

    connection_errors = (
        base.Transport.connection_errors + (
            ConnectionError, socket.error, IOError, OSError)
    )
    channel_errors = (
        base.Transport.channel_errors + (ChannelError,)
    )
    driver_type = 'amqp'
    driver_name = 'librabbitmq'

    implements = base.Transport.implements.extend(
        asynchronous=True,
        heartbeats=False,
    )

    def __init__(self, client, **kwargs):
        self.client = client
        self.default_port = kwargs.get('default_port') or self.default_port
        self.default_ssl_port = (kwargs.get('default_ssl_port') or
                                 self.default_ssl_port)
        self.__reader = None

    def driver_version(self):
        return amqp.__version__

    def create_channel(self, connection):
        return connection.channel()

    def drain_events(self, connection, **kwargs):
        return connection.drain_events(**kwargs)

    def establish_connection(self):
        """Establish connection to the AMQP broker."""
        conninfo = self.client
        for name, default_value in self.default_connection_params.items():
            if not getattr(conninfo, name, None):
                setattr(conninfo, name, default_value)
        if conninfo.ssl:
            raise NotImplementedError(NO_SSL_ERROR)
        opts = dict({
            'host': conninfo.host,
            'userid': conninfo.userid,
            'password': conninfo.password,
            'virtual_host': conninfo.virtual_host,
            'login_method': conninfo.login_method,
            'insist': conninfo.insist,
            'ssl': conninfo.ssl,
            'connect_timeout': conninfo.connect_timeout,
        }, **conninfo.transport_options or {})
        conn = self.Connection(**opts)
        conn.client = self.client
        self.client.drain_events = conn.drain_events
        return conn

    def close_connection(self, connection):
        """Close the AMQP broker connection."""
        self.client.drain_events = None
        connection.close()

    def _collect(self, connection):
        if connection is not None:
            for channel in connection.channels.values():
                channel.connection = None
            try:
                os.close(connection.fileno())
            except (OSError, ValueError):
                pass
            connection.channels.clear()
            connection.callbacks.clear()
        self.client.drain_events = None
        self.client = None

    def verify_connection(self, connection):
        return connection.connected

    def register_with_event_loop(self, connection, loop):
        loop.add_reader(
            connection.fileno(), self.on_readable, connection, loop,
        )

    def get_manager(self, *args, **kwargs):
        return get_manager(self.client, *args, **kwargs)

    def qos_semantics_matches_spec(self, connection):
        try:
            props = connection.server_properties
        except AttributeError:
            warnings.warn(UserWarning(W_VERSION))
        else:
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
