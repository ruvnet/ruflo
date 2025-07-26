# copyright: (c) 2010 - 2013 by Mahendra M.
# license: BSD, see LICENSE for more details.

"""Zookeeper transport module for kombu.

Zookeeper based transport. This transport uses the built-in kazoo Zookeeper
based queue implementation.

**References**

- https://zookeeper.apache.org/doc/current/recipes.html#sc_recipes_Queues
- https://kazoo.readthedocs.io/en/latest/api/recipe/queue.html

**Limitations**
This queue does not offer reliable consumption.  An entry is removed from
the queue prior to being processed.  So if an error occurs, the consumer
has to re-queue the item or it will be lost.

Features
========
* Type: Virtual
* Supports Direct: Yes
* Supports Topic: Yes
* Supports Fanout: No
* Supports Priority: Yes
* Supports TTL: No

Connection String
=================
Connects to a zookeeper node as:

.. code-block::

    zookeeper://SERVER:PORT/VHOST

The <vhost> becomes the base for all the other znodes.  So we can use
it like a vhost.


Transport Options
=================

"""

from __future__ import annotations

import os
import socket
from queue import Empty

from kombu.utils.encoding import bytes_to_str, ensure_bytes
from kombu.utils.json import dumps, loads

from . import virtual

try:
    import kazoo
    from kazoo.client import KazooClient
    from kazoo.recipe.queue import Queue

    KZ_CONNECTION_ERRORS = (
        kazoo.exceptions.SystemErrorException,
        kazoo.exceptions.ConnectionLossException,
        kazoo.exceptions.MarshallingErrorException,
        kazoo.exceptions.UnimplementedException,
        kazoo.exceptions.OperationTimeoutException,
        kazoo.exceptions.NoAuthException,
        kazoo.exceptions.InvalidACLException,
        kazoo.exceptions.AuthFailedException,
        kazoo.exceptions.SessionExpiredException,
    )

    KZ_CHANNEL_ERRORS = (
        kazoo.exceptions.RuntimeInconsistencyException,
        kazoo.exceptions.DataInconsistencyException,
        kazoo.exceptions.BadArgumentsException,
        kazoo.exceptions.MarshallingErrorException,
        kazoo.exceptions.UnimplementedException,
        kazoo.exceptions.OperationTimeoutException,
        kazoo.exceptions.ApiErrorException,
        kazoo.exceptions.NoNodeException,
        kazoo.exceptions.NoAuthException,
        kazoo.exceptions.NodeExistsException,
        kazoo.exceptions.NoChildrenForEphemeralsException,
        kazoo.exceptions.NotEmptyException,
        kazoo.exceptions.SessionExpiredException,
        kazoo.exceptions.InvalidCallbackException,
        socket.error,
    )
except ImportError:
    kazoo = None
    KZ_CONNECTION_ERRORS = KZ_CHANNEL_ERRORS = ()

DEFAULT_PORT = 2181

__author__ = 'Mahendra M <mahendra.m@gmail.com>'


class Channel(virtual.Channel):
    """Zookeeper Channel."""

    _client = None
    _queues = {}

    def __init__(self, connection, **kwargs):
        super().__init__(connection, **kwargs)
        vhost = self.connection.client.virtual_host
        self._vhost = '/{}'.format(vhost.strip('/'))

    def _get_path(self, queue_name):
        return os.path.join(self._vhost, queue_name)

    def _get_queue(self, queue_name):
        queue = self._queues.get(queue_name, None)

        if queue is None:
            queue = Queue(self.client, self._get_path(queue_name))
            self._queues[queue_name] = queue

            # Ensure that the queue is created
            len(queue)

        return queue

    def _put(self, queue, message, **kwargs):
        return self._get_queue(queue).put(
            ensure_bytes(dumps(message)),
            priority=self._get_message_priority(message, reverse=True),
        )

    def _get(self, queue):
        queue = self._get_queue(queue)
        msg = queue.get()

        if msg is None:
            raise Empty()

        return loads(bytes_to_str(msg))

    def _purge(self, queue):
        count = 0
        queue = self._get_queue(queue)

        while True:
            msg = queue.get()
            if msg is None:
                break
            count += 1

        return count

    def _delete(self, queue, *args, **kwargs):
        if self._has_queue(queue):
            self._purge(queue)
            self.client.delete(self._get_path(queue))

    def _size(self, queue):
        queue = self._get_queue(queue)
        return len(queue)

    def _new_queue(self, queue, **kwargs):
        if not self._has_queue(queue):
            queue = self._get_queue(queue)

    def _has_queue(self, queue):
        return self.client.exists(self._get_path(queue)) is not None

    def _open(self):
        conninfo = self.connection.client
        hosts = []
        if conninfo.alt:
            for host_port in conninfo.alt:
                if host_port.startswith('zookeeper://'):
                    host_port = host_port[len('zookeeper://'):]
                if not host_port:
                    continue
                try:
                    host, port = host_port.split(':', 1)
                    host_port = (host, int(port))
                except ValueError:
                    if host_port == conninfo.hostname:
                        host_port = (host_port, conninfo.port or DEFAULT_PORT)
                    else:
                        host_port = (host_port, DEFAULT_PORT)
                hosts.append(host_port)
        host_port = (conninfo.hostname, conninfo.port or DEFAULT_PORT)
        if host_port not in hosts:
            hosts.insert(0, host_port)
        conn_str = ','.join([f'{h}:{p}' for h, p in hosts])
        conn = KazooClient(conn_str)
        conn.start()
        return conn

    @property
    def client(self):
        if self._client is None:
            self._client = self._open()
        return self._client


class Transport(virtual.Transport):
    """Zookeeper Transport."""

    Channel = Channel
    polling_interval = 1
    default_port = DEFAULT_PORT
    connection_errors = (
        virtual.Transport.connection_errors + KZ_CONNECTION_ERRORS
    )
    channel_errors = (
        virtual.Transport.channel_errors + KZ_CHANNEL_ERRORS
    )
    driver_type = 'zookeeper'
    driver_name = 'kazoo'

    def __init__(self, *args, **kwargs):
        if kazoo is None:
            raise ImportError('The kazoo library is not installed')

        super().__init__(*args, **kwargs)

    def driver_version(self):
        return kazoo.__version__
