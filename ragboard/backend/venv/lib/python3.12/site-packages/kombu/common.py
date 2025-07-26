"""Common Utilities."""

from __future__ import annotations

import os
import socket
import threading
from collections import deque
from contextlib import contextmanager
from functools import partial
from itertools import count
from uuid import NAMESPACE_OID, uuid3, uuid4, uuid5

from amqp import ChannelError, RecoverableConnectionError

from .entity import Exchange, Queue
from .log import get_logger
from .serialization import registry as serializers
from .utils.uuid import uuid

__all__ = ('Broadcast', 'maybe_declare', 'uuid',
           'itermessages', 'send_reply',
           'collect_replies', 'insured', 'drain_consumer',
           'eventloop')

#: Prefetch count can't exceed short.
PREFETCH_COUNT_MAX = 0xFFFF

logger = get_logger(__name__)

_node_id = None


def get_node_id():
    global _node_id
    if _node_id is None:
        _node_id = uuid4().int
    return _node_id


def generate_oid(node_id, process_id, thread_id, instance):
    ent = '{:x}-{:x}-{:x}-{:x}'.format(
        node_id, process_id, thread_id, id(instance))
    try:
        ret = str(uuid3(NAMESPACE_OID, ent))
    except ValueError:
        ret = str(uuid5(NAMESPACE_OID, ent))
    return ret


def oid_from(instance, threads=True):
    return generate_oid(
        get_node_id(),
        os.getpid(),
        threading.get_ident() if threads else 0,
        instance,
    )


class Broadcast(Queue):
    """Broadcast queue.

    Convenience class used to define broadcast queues.

    Every queue instance will have a unique name,
    and both the queue and exchange is configured with auto deletion.

    Arguments:
    ---------
        name (str): This is used as the name of the exchange.
        queue (str): By default a unique id is used for the queue
            name for every consumer.  You can specify a custom
            queue name here.
        unique (bool): Always create a unique queue
            even if a queue name is supplied.
        **kwargs (Any): See :class:`~kombu.Queue` for a list
            of additional keyword arguments supported.
    """

    attrs = Queue.attrs + (('queue', None),)

    def __init__(self,
                 name=None,
                 queue=None,
                 unique=False,
                 auto_delete=True,
                 exchange=None,
                 alias=None,
                 **kwargs):
        if unique:
            queue = '{}.{}'.format(queue or 'bcast', uuid())
        else:
            queue = queue or f'bcast.{uuid()}'
        super().__init__(
            alias=alias or name,
            queue=queue,
            name=queue,
            auto_delete=auto_delete,
            exchange=(exchange if exchange is not None
                      else Exchange(name, type='fanout')),
            **kwargs
        )


def declaration_cached(entity, channel):
    return entity in channel.connection.client.declared_entities


def maybe_declare(entity, channel=None, retry=False, **retry_policy):
    """Declare entity (cached)."""
    if retry:
        return _imaybe_declare(entity, channel, **retry_policy)
    return _maybe_declare(entity, channel)


def _ensure_channel_is_bound(entity, channel):
    """Make sure the channel is bound to the entity.

    :param entity: generic kombu nomenclature, generally an exchange or queue
    :param channel: channel to bind to the entity
    :return: the updated entity
    """
    is_bound = entity.is_bound
    if not is_bound:
        if not channel:
            raise ChannelError(
                f"Cannot bind channel {channel} to entity {entity}")
        entity = entity.bind(channel)
    return entity


def _maybe_declare(entity, channel):
    # _maybe_declare sets name on original for autogen queues
    orig = entity

    _ensure_channel_is_bound(entity, channel)

    if channel is None or channel.connection is None:
        # If this was called from the `ensure()` method then the channel could have been invalidated
        # and the correct channel was re-bound to the entity by calling the `entity.revive()` method.
        if not entity.is_bound:
            raise ChannelError(
                f"channel is None and entity {entity} not bound.")
        channel = entity.channel

    declared = ident = None
    if channel.connection and entity.can_cache_declaration:
        declared = channel.connection.client.declared_entities
        ident = hash(entity)
        if ident in declared:
            return False

    if not channel.connection:
        raise RecoverableConnectionError('channel disconnected')
    entity.declare(channel=channel)
    if declared is not None and ident:
        declared.add(ident)
    if orig is not None:
        orig.name = entity.name
    return True


def _imaybe_declare(entity, channel, **retry_policy):
    entity = _ensure_channel_is_bound(entity, channel)

    if not entity.channel.connection:
        raise RecoverableConnectionError('channel disconnected')

    return entity.channel.connection.client.ensure(
        entity, _maybe_declare, **retry_policy)(entity, channel)


def drain_consumer(consumer, limit=1, timeout=None, callbacks=None):
    """Drain messages from consumer instance."""
    acc = deque()

    def on_message(body, message):
        acc.append((body, message))

    consumer.callbacks = [on_message] + (callbacks or [])

    with consumer:
        for _ in eventloop(consumer.channel.connection.client,
                           limit=limit, timeout=timeout, ignore_timeouts=True):
            try:
                yield acc.popleft()
            except IndexError:
                pass


def itermessages(conn, channel, queue, limit=1, timeout=None,
                 callbacks=None, **kwargs):
    """Iterator over messages."""
    return drain_consumer(
        conn.Consumer(queues=[queue], channel=channel, **kwargs),
        limit=limit, timeout=timeout, callbacks=callbacks,
    )


def eventloop(conn, limit=None, timeout=None, ignore_timeouts=False):
    """Best practice generator wrapper around ``Connection.drain_events``.

    Able to drain events forever, with a limit, and optionally ignoring
    timeout errors (a timeout of 1 is often used in environments where
    the socket can get "stuck", and is a best practice for Kombu consumers).

    ``eventloop`` is a generator.

    Examples
    --------
        >>> from kombu.common import eventloop

        >>> def run(conn):
        ...     it = eventloop(conn, timeout=1, ignore_timeouts=True)
        ...     next(it)   # one event consumed, or timed out.
        ...
        ...     for _ in eventloop(conn, timeout=1, ignore_timeouts=True):
        ...         pass  # loop forever.

    It also takes an optional limit parameter, and timeout errors
    are propagated by default::

        for _ in eventloop(connection, limit=1, timeout=1):
            pass

    See Also
    --------
        :func:`itermessages`, which is an event loop bound to one or more
        consumers, that yields any messages received.
    """
    for i in limit and range(limit) or count():
        try:
            yield conn.drain_events(timeout=timeout)
        except socket.timeout:
            if timeout and not ignore_timeouts:  # pragma: no cover
                raise


def send_reply(exchange, req, msg,
               producer=None, retry=False, retry_policy=None, **props):
    """Send reply for request.

    Arguments:
    ---------
        exchange (kombu.Exchange, str): Reply exchange
        req (~kombu.Message): Original request, a message with
            a ``reply_to`` property.
        producer (kombu.Producer): Producer instance
        retry (bool): If true must retry according to
            the ``reply_policy`` argument.
        retry_policy (Dict): Retry settings.
        **props (Any): Extra properties.
    """
    return producer.publish(
        msg, exchange=exchange,
        retry=retry, retry_policy=retry_policy,
        **dict({'routing_key': req.properties['reply_to'],
                'correlation_id': req.properties.get('correlation_id'),
                'serializer': serializers.type_to_name[req.content_type],
                'content_encoding': req.content_encoding}, **props)
    )


def collect_replies(conn, channel, queue, *args, **kwargs):
    """Generator collecting replies from ``queue``."""
    no_ack = kwargs.setdefault('no_ack', True)
    received = False
    try:
        for body, message in itermessages(conn, channel, queue,
                                          *args, **kwargs):
            if not no_ack:
                message.ack()
            received = True
            yield body
    finally:
        if received:
            channel.after_reply_message_received(queue.name)


def _ensure_errback(exc, interval):
    logger.error(
        'Connection error: %r. Retry in %ss\n', exc, interval,
        exc_info=True,
    )


@contextmanager
def _ignore_errors(conn):
    try:
        yield
    except conn.connection_errors + conn.channel_errors:
        pass


def ignore_errors(conn, fun=None, *args, **kwargs):
    """Ignore connection and channel errors.

    The first argument must be a connection object, or any other object
    with ``connection_error`` and ``channel_error`` attributes.

    Can be used as a function:

    .. code-block:: python

        def example(connection):
            ignore_errors(connection, consumer.channel.close)

    or as a context manager:

    .. code-block:: python

        def example(connection):
            with ignore_errors(connection):
                consumer.channel.close()


    Note:
    ----
        Connection and channel errors should be properly handled,
        and not ignored.  Using this function is only acceptable in a cleanup
        phase, like when a connection is lost or at shutdown.
    """
    if fun:
        with _ignore_errors(conn):
            return fun(*args, **kwargs)
    return _ignore_errors(conn)


def revive_connection(connection, channel, on_revive=None):
    if on_revive:
        on_revive(channel)


def insured(pool, fun, args, kwargs, errback=None, on_revive=None, **opts):
    """Function wrapper to handle connection errors.

    Ensures function performing broker commands completes
    despite intermittent connection failures.
    """
    errback = errback or _ensure_errback

    with pool.acquire(block=True) as conn:
        conn.ensure_connection(errback=errback)
        # we cache the channel for subsequent calls, this has to be
        # reset on revival.
        channel = conn.default_channel
        revive = partial(revive_connection, conn, on_revive=on_revive)
        insured = conn.autoretry(fun, channel, errback=errback,
                                 on_revive=revive, **opts)
        retval, _ = insured(*args, **dict(kwargs, connection=conn))
        return retval


class QoS:
    """Thread safe increment/decrement of a channels prefetch_count.

    Arguments:
    ---------
        callback (Callable): Function used to set new prefetch count,
            e.g. ``consumer.qos`` or ``channel.basic_qos``.  Will be called
            with a single ``prefetch_count`` keyword argument.
        initial_value (int): Initial prefetch count value..

    Example:
    -------
        >>> from kombu import Consumer, Connection
        >>> connection = Connection('amqp://')
        >>> consumer = Consumer(connection)
        >>> qos = QoS(consumer.qos, initial_prefetch_count=2)
        >>> qos.update()  # set initial

        >>> qos.value
        2

        >>> def in_some_thread():
        ...     qos.increment_eventually()

        >>> def in_some_other_thread():
        ...     qos.decrement_eventually()

        >>> while 1:
        ...    if qos.prev != qos.value:
        ...        qos.update()  # prefetch changed so update.

    It can be used with any function supporting a ``prefetch_count`` keyword
    argument::

        >>> channel = connection.channel()
        >>> QoS(channel.basic_qos, 10)


        >>> def set_qos(prefetch_count):
        ...     print('prefetch count now: %r' % (prefetch_count,))
        >>> QoS(set_qos, 10)
    """

    prev = None

    def __init__(self, callback, initial_value):
        self.callback = callback
        self._mutex = threading.RLock()
        self.value = initial_value or 0

    def increment_eventually(self, n=1):
        """Increment the value, but do not update the channels QoS.

        Note:
        ----
            The MainThread will be responsible for calling :meth:`update`
            when necessary.
        """
        with self._mutex:
            if self.value:
                self.value = self.value + max(n, 0)
        return self.value

    def decrement_eventually(self, n=1):
        """Decrement the value, but do not update the channels QoS.

        Note:
        ----
            The MainThread will be responsible for calling :meth:`update`
            when necessary.
        """
        with self._mutex:
            if self.value:
                self.value -= n
                if self.value < 1:
                    self.value = 1
        return self.value

    def set(self, pcount):
        """Set channel prefetch_count setting."""
        if pcount != self.prev:
            new_value = pcount
            if pcount > PREFETCH_COUNT_MAX:
                logger.warning('QoS: Disabled: prefetch_count exceeds %r',
                               PREFETCH_COUNT_MAX)
                new_value = 0
            logger.debug('basic.qos: prefetch_count->%s', new_value)
            self.callback(prefetch_count=new_value)
            self.prev = pcount
        return pcount

    def update(self):
        """Update prefetch count with current value."""
        with self._mutex:
            return self.set(self.value)
