"""Etcd Transport module for Kombu.

It uses Etcd as a store to transport messages in Queues

It uses python-etcd for talking to Etcd's HTTP API

Features
========
* Type: Virtual
* Supports Direct: *Unreviewed*
* Supports Topic: *Unreviewed*
* Supports Fanout: *Unreviewed*
* Supports Priority: *Unreviewed*
* Supports TTL: *Unreviewed*

Connection String
=================

Connection string has the following format:

.. code-block::

    'etcd'://SERVER:PORT

"""

from __future__ import annotations

import os
import socket
from collections import defaultdict
from contextlib import contextmanager
from queue import Empty

from kombu.exceptions import ChannelError
from kombu.log import get_logger
from kombu.utils.json import dumps, loads
from kombu.utils.objects import cached_property

from . import virtual

try:
    import etcd
except ImportError:
    etcd = None

logger = get_logger('kombu.transport.etcd')

DEFAULT_PORT = 2379
DEFAULT_HOST = 'localhost'


class Channel(virtual.Channel):
    """Etcd Channel class which talks to the Etcd."""

    prefix = 'kombu'
    index = None
    timeout = 10
    session_ttl = 30
    lock_ttl = 10

    def __init__(self, *args, **kwargs):
        if etcd is None:
            raise ImportError('Missing python-etcd library')

        super().__init__(*args, **kwargs)

        port = self.connection.client.port or self.connection.default_port
        host = self.connection.client.hostname or DEFAULT_HOST

        logger.debug('Host: %s Port: %s Timeout: %s', host, port, self.timeout)

        self.queues = defaultdict(dict)

        self.client = etcd.Client(host=host, port=int(port))

    def _key_prefix(self, queue):
        """Create and return the `queue` with the proper prefix.

        Arguments:
        ---------
            queue (str): The name of the queue.
        """
        return f'{self.prefix}/{queue}'

    @contextmanager
    def _queue_lock(self, queue):
        """Try to acquire a lock on the Queue.

        It does so by creating a object called 'lock' which is locked by the
        current session..

        This way other nodes are not able to write to the lock object which
        means that they have to wait before the lock is released.

        Arguments:
        ---------
            queue (str): The name of the queue.
        """
        lock = etcd.Lock(self.client, queue)
        lock._uuid = self.lock_value
        logger.debug(f'Acquiring lock {lock.name}')
        lock.acquire(blocking=True, lock_ttl=self.lock_ttl)
        try:
            yield
        finally:
            logger.debug(f'Releasing lock {lock.name}')
            lock.release()

    def _new_queue(self, queue, **_):
        """Create a new `queue` if the `queue` doesn't already exist.

        Arguments:
        ---------
            queue (str): The name of the queue.
        """
        self.queues[queue] = queue
        with self._queue_lock(queue):
            try:
                return self.client.write(
                    key=self._key_prefix(queue), dir=True, value=None)
            except etcd.EtcdNotFile:
                logger.debug(f'Queue "{queue}" already exists')
                return self.client.read(key=self._key_prefix(queue))

    def _has_queue(self, queue, **kwargs):
        """Verify that queue exists.

        Returns
        -------
            bool: Should return :const:`True` if the queue exists
                or :const:`False` otherwise.
        """
        try:
            self.client.read(self._key_prefix(queue))
            return True
        except etcd.EtcdKeyNotFound:
            return False

    def _delete(self, queue, *args, **_):
        """Delete a `queue`.

        Arguments:
        ---------
            queue (str): The name of the queue.
        """
        self.queues.pop(queue, None)
        self._purge(queue)

    def _put(self, queue, payload, **_):
        """Put `message` onto `queue`.

        This simply writes a key to the Etcd store

        Arguments:
        ---------
            queue (str): The name of the queue.
            payload (dict): Message data which will be dumped to etcd.
        """
        with self._queue_lock(queue):
            key = self._key_prefix(queue)
            if not self.client.write(
                    key=key,
                    value=dumps(payload),
                    append=True):
                raise ChannelError(f'Cannot add key {key!r} to etcd')

    def _get(self, queue, timeout=None):
        """Get the first available message from the queue.

        Before it does so it acquires a lock on the store so
        only one node reads at the same time. This is for read consistency

        Arguments:
        ---------
            queue (str): The name of the queue.
            timeout (int): Optional seconds to wait for a response.
        """
        with self._queue_lock(queue):
            key = self._key_prefix(queue)
            logger.debug('Fetching key %s with index %s', key, self.index)

            try:
                result = self.client.read(
                    key=key, recursive=True,
                    index=self.index, timeout=self.timeout)

                if result is None:
                    raise Empty()

                item = result._children[-1]
                logger.debug('Removing key {}'.format(item['key']))

                msg_content = loads(item['value'])
                self.client.delete(key=item['key'])
                return msg_content
            except (TypeError, IndexError, etcd.EtcdException) as error:
                logger.debug(f'_get failed: {type(error)}:{error}')

            raise Empty()

    def _purge(self, queue):
        """Remove all `message`s from a `queue`.

        Arguments:
        ---------
            queue (str): The name of the queue.
        """
        with self._queue_lock(queue):
            key = self._key_prefix(queue)
            logger.debug(f'Purging queue at key {key}')
            return self.client.delete(key=key, recursive=True)

    def _size(self, queue):
        """Return the size of the `queue`.

        Arguments:
        ---------
            queue (str): The name of the queue.
        """
        with self._queue_lock(queue):
            size = 0
            try:
                key = self._key_prefix(queue)
                logger.debug('Fetching key recursively %s with index %s',
                             key, self.index)
                result = self.client.read(
                    key=key, recursive=True,
                    index=self.index)
                size = len(result._children)
            except TypeError:
                pass

            logger.debug('Found %s keys under %s with index %s',
                         size, key, self.index)
            return size

    @cached_property
    def lock_value(self):
        return f'{socket.gethostname()}.{os.getpid()}'


class Transport(virtual.Transport):
    """Etcd storage Transport for Kombu."""

    Channel = Channel

    default_port = DEFAULT_PORT
    driver_type = 'etcd'
    driver_name = 'python-etcd'
    polling_interval = 3

    implements = virtual.Transport.implements.extend(
        exchange_type=frozenset(['direct']))

    if etcd:
        connection_errors = (
            virtual.Transport.connection_errors + (etcd.EtcdException, )
        )

        channel_errors = (
            virtual.Transport.channel_errors + (etcd.EtcdException, )
        )

    def __init__(self, *args, **kwargs):
        """Create a new instance of etcd.Transport."""
        if etcd is None:
            raise ImportError('Missing python-etcd library')

        super().__init__(*args, **kwargs)

    def verify_connection(self, connection):
        """Verify the connection works."""
        port = connection.client.port or self.default_port
        host = connection.client.hostname or DEFAULT_HOST

        logger.debug('Verify Etcd connection to %s:%s', host, port)

        try:
            etcd.Client(host=host, port=int(port))
            return True
        except ValueError:
            pass

        return False

    def driver_version(self):
        """Return the version of the etcd library.

        .. note::
           python-etcd has no __version__. This is a workaround.
        """
        try:
            import pip.commands.freeze
            for x in pip.commands.freeze.freeze():
                if x.startswith('python-etcd'):
                    return x.split('==')[1]
        except (ImportError, IndexError):
            logger.warning('Unable to find the python-etcd version.')
            return 'Unknown'
