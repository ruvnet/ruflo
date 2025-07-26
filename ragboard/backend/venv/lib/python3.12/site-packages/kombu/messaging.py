"""Sending and receiving messages."""

from __future__ import annotations

from itertools import count
from typing import TYPE_CHECKING

from .common import maybe_declare
from .compression import compress
from .connection import PooledConnection, is_connection, maybe_channel
from .entity import Exchange, Queue, maybe_delivery_mode
from .exceptions import ContentDisallowed
from .serialization import dumps, prepare_accept_content
from .utils.functional import ChannelPromise, maybe_list

if TYPE_CHECKING:
    from types import TracebackType

__all__ = ('Exchange', 'Queue', 'Producer', 'Consumer')


class Producer:
    """Message Producer.

    Arguments:
    ---------
        channel (kombu.Connection, ChannelT): Connection or channel.
        exchange (kombu.entity.Exchange, str): Optional default exchange.
        routing_key (str): Optional default routing key.
        serializer (str): Default serializer. Default is `"json"`.
        compression (str): Default compression method.
            Default is no compression.
        auto_declare (bool): Automatically declare the default exchange
            at instantiation. Default is :const:`True`.
        on_return (Callable): Callback to call for undeliverable messages,
            when the `mandatory` or `immediate` arguments to
            :meth:`publish` is used. This callback needs the following
            signature: `(exception, exchange, routing_key, message)`.
            Note that the producer needs to drain events to use this feature.
    """

    #: Default exchange
    exchange = None

    #: Default routing key.
    routing_key = ''

    #: Default serializer to use. Default is JSON.
    serializer = None

    #: Default compression method.  Disabled by default.
    compression = None

    #: By default, if a default exchange is set,
    #: that exchange will be declare when publishing a message.
    auto_declare = True

    #: Basic return callback.
    on_return = None

    #: Set if channel argument was a Connection instance (using
    #: default_channel).
    __connection__ = None

    def __init__(self, channel, exchange=None, routing_key=None,
                 serializer=None, auto_declare=None, compression=None,
                 on_return=None):
        self._channel = channel
        self.exchange = exchange
        self.routing_key = routing_key or self.routing_key
        self.serializer = serializer or self.serializer
        self.compression = compression or self.compression
        self.on_return = on_return or self.on_return
        self._channel_promise = None
        if self.exchange is None:
            self.exchange = Exchange('')
        if auto_declare is not None:
            self.auto_declare = auto_declare

        if self._channel:
            self.revive(self._channel)

    def __repr__(self):
        return f'<Producer: {self._channel}>'

    def __reduce__(self):
        return self.__class__, self.__reduce_args__()

    def __reduce_args__(self):
        return (None, self.exchange, self.routing_key, self.serializer,
                self.auto_declare, self.compression)

    def declare(self):
        """Declare the exchange.

        Note:
        ----
            This happens automatically at instantiation when
            the :attr:`auto_declare` flag is enabled.
        """
        if self.exchange.name:
            self.exchange.declare()

    def maybe_declare(self, entity, retry=False, **retry_policy):
        """Declare exchange if not already declared during this session."""
        if entity:
            return maybe_declare(entity, self.channel, retry, **retry_policy)

    def _delivery_details(self, exchange, delivery_mode=None,
                          maybe_delivery_mode=maybe_delivery_mode,
                          Exchange=Exchange):
        if isinstance(exchange, Exchange):
            return exchange.name, maybe_delivery_mode(
                delivery_mode or exchange.delivery_mode,
            )
        # exchange is string, so inherit the delivery
        # mode of our default exchange.
        return exchange, maybe_delivery_mode(
            delivery_mode or self.exchange.delivery_mode,
        )

    def publish(self, body, routing_key=None, delivery_mode=None,
                mandatory=False, immediate=False, priority=0,
                content_type=None, content_encoding=None, serializer=None,
                headers=None, compression=None, exchange=None, retry=False,
                retry_policy=None, declare=None, expiration=None, timeout=None,
                confirm_timeout=None,
                **properties):
        """Publish message to the specified exchange.

        Arguments:
        ---------
            body (Any): Message body.
            routing_key (str): Message routing key.
            delivery_mode (enum): See :attr:`delivery_mode`.
            mandatory (bool): Currently not supported.
            immediate (bool): Currently not supported.
            priority (int): Message priority. A number between 0 and 9.
            content_type (str): Content type. Default is auto-detect.
            content_encoding (str): Content encoding. Default is auto-detect.
            serializer (str): Serializer to use. Default is auto-detect.
            compression (str): Compression method to use.  Default is none.
            headers (Dict): Mapping of arbitrary headers to pass along
                with the message body.
            exchange (kombu.entity.Exchange, str): Override the exchange.
                Note that this exchange must have been declared.
            declare (Sequence[EntityT]): Optional list of required entities
                that must have been declared before publishing the message.
                The entities will be declared using
                :func:`~kombu.common.maybe_declare`.
            retry (bool): Retry publishing, or declaring entities if the
                connection is lost.
            retry_policy (Dict): Retry configuration, this is the keywords
                supported by :meth:`~kombu.Connection.ensure`.
            expiration (float): A TTL in seconds can be specified per message.
                Default is no expiration.
            timeout (float): Set timeout to wait maximum timeout second
                for message to publish.
            confirm_timeout (float): Set confirm timeout to wait maximum timeout second
                for message to confirm publishing if the channel is set to confirm publish mode.
            **properties (Any): Additional message properties, see AMQP spec.
        """
        _publish = self._publish

        declare = [] if declare is None else declare
        headers = {} if headers is None else headers
        retry_policy = {} if retry_policy is None else retry_policy
        routing_key = self.routing_key if routing_key is None else routing_key
        compression = self.compression if compression is None else compression

        exchange_name, properties['delivery_mode'] = self._delivery_details(
            exchange or self.exchange, delivery_mode,
        )

        if expiration is not None:
            properties['expiration'] = str(int(expiration * 1000))

        body, content_type, content_encoding = self._prepare(
            body, serializer, content_type, content_encoding,
            compression, headers)

        if self.auto_declare and self.exchange.name:
            if self.exchange not in declare:
                # XXX declare should be a Set.
                declare.append(self.exchange)

        if retry:
            self.connection.transport_options.update(retry_policy)
            _publish = self.connection.ensure(self, _publish, **retry_policy)
        return _publish(
            body, priority, content_type, content_encoding,
            headers, properties, routing_key, mandatory, immediate,
            exchange_name, declare, timeout, confirm_timeout, retry, retry_policy
        )

    def _publish(self, body, priority, content_type, content_encoding,
                 headers, properties, routing_key, mandatory,
                 immediate, exchange, declare, timeout=None, confirm_timeout=None, retry=False, retry_policy=None):
        retry_policy = {} if retry_policy is None else retry_policy
        channel = self.channel
        message = channel.prepare_message(
            body, priority, content_type,
            content_encoding, headers, properties,
        )
        if declare:
            maybe_declare = self.maybe_declare
            for entity in declare:
                maybe_declare(entity, retry=retry, **retry_policy)

        # handle autogenerated queue names for reply_to
        reply_to = properties.get('reply_to')
        if isinstance(reply_to, Queue):
            properties['reply_to'] = reply_to.name
        return channel.basic_publish(
            message,
            exchange=exchange, routing_key=routing_key,
            mandatory=mandatory, immediate=immediate,
            timeout=timeout, confirm_timeout=confirm_timeout
        )

    def _get_channel(self):
        channel = self._channel
        if isinstance(channel, ChannelPromise):
            channel = self._channel = channel()
            self.exchange.revive(channel)
            if self.on_return:
                channel.events['basic_return'].add(self.on_return)
        return channel

    def _set_channel(self, channel):
        self._channel = channel

    channel = property(_get_channel, _set_channel)

    def revive(self, channel):
        """Revive the producer after connection loss."""
        if is_connection(channel):
            connection = channel
            self.__connection__ = connection
            channel = ChannelPromise(lambda: connection.default_channel)
        if isinstance(channel, ChannelPromise):
            self._channel = channel
            self.exchange = self.exchange(channel)
        else:
            # Channel already concrete
            self._channel = channel
            if self.on_return:
                self._channel.events['basic_return'].add(self.on_return)
            self.exchange = self.exchange(channel)

    def __enter__(self):
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None
    ) -> None:
        # In case the connection is part of a pool it needs to be
        # replaced in case of an exception
        if self.__connection__ is not None and exc_type is not None:
            if isinstance(self.__connection__, PooledConnection):
                self.__connection__._pool.replace(self.__connection__)

        self.release()

    def release(self):
        pass

    close = release

    def _prepare(self, body, serializer=None, content_type=None,
                 content_encoding=None, compression=None, headers=None):

        # No content_type? Then we're serializing the data internally.
        if not content_type:
            serializer = serializer or self.serializer
            (content_type, content_encoding,
             body) = dumps(body, serializer=serializer)
        else:
            # If the programmer doesn't want us to serialize,
            # make sure content_encoding is set.
            if isinstance(body, str):
                if not content_encoding:
                    content_encoding = 'utf-8'
                body = body.encode(content_encoding)

            # If they passed in a string, we can't know anything
            # about it. So assume it's binary data.
            elif not content_encoding:
                content_encoding = 'binary'

        if compression:
            body, headers['compression'] = compress(body, compression)

        return body, content_type, content_encoding

    @property
    def connection(self):
        try:
            return self.__connection__ or self.channel.connection.client
        except AttributeError:
            pass


class Consumer:
    """Message consumer.

    Arguments:
    ---------
        channel (kombu.Connection, ChannelT): see :attr:`channel`.
        queues (Sequence[kombu.Queue]): see :attr:`queues`.
        no_ack (bool): see :attr:`no_ack`.
        auto_declare (bool): see :attr:`auto_declare`
        callbacks (Sequence[Callable]): see :attr:`callbacks`.
        on_message (Callable): See :attr:`on_message`
        on_decode_error (Callable): see :attr:`on_decode_error`.
        prefetch_count (int): see :attr:`prefetch_count`.
    """

    ContentDisallowed = ContentDisallowed

    #: The connection/channel to use for this consumer.
    channel = None

    #: A single :class:`~kombu.Queue`, or a list of queues to
    #: consume from.
    queues = None

    #: Flag for automatic message acknowledgment.
    #: If enabled the messages are automatically acknowledged by the
    #: broker.  This can increase performance but means that you
    #: have no control of when the message is removed.
    #:
    #: Disabled by default.
    no_ack = None

    #: By default all entities will be declared at instantiation, if you
    #: want to handle this manually you can set this to :const:`False`.
    auto_declare = True

    #: List of callbacks called in order when a message is received.
    #:
    #: The signature of the callbacks must take two arguments:
    #: `(body, message)`, which is the decoded message body and
    #: the :class:`~kombu.Message` instance.
    callbacks = None

    #: Optional function called whenever a message is received.
    #:
    #: When defined this function will be called instead of the
    #: :meth:`receive` method, and :attr:`callbacks` will be disabled.
    #:
    #: So this can be used as an alternative to :attr:`callbacks` when
    #: you don't want the body to be automatically decoded.
    #: Note that the message will still be decompressed if the message
    #: has the ``compression`` header set.
    #:
    #: The signature of the callback must take a single argument,
    #: which is the :class:`~kombu.Message` object.
    #:
    #: Also note that the ``message.body`` attribute, which is the raw
    #: contents of the message body, may in some cases be a read-only
    #: :class:`buffer` object.
    on_message = None

    #: Callback called when a message can't be decoded.
    #:
    #: The signature of the callback must take two arguments: `(message,
    #: exc)`, which is the message that can't be decoded and the exception
    #: that occurred while trying to decode it.
    on_decode_error = None

    #: List of accepted content-types.
    #:
    #: An exception will be raised if the consumer receives
    #: a message with an untrusted content type.
    #: By default all content-types are accepted, but not if
    #: :func:`kombu.disable_untrusted_serializers` was called,
    #: in which case only json is allowed.
    accept = None

    #: Initial prefetch count
    #:
    #: If set, the consumer will set the prefetch_count QoS value at startup.
    #: Can also be changed using :meth:`qos`.
    prefetch_count = None

    #: Mapping of queues we consume from.
    _queues = None

    _tags = count(1)  # global

    def __init__(self, channel, queues=None, no_ack=None, auto_declare=None,
                 callbacks=None, on_decode_error=None, on_message=None,
                 accept=None, prefetch_count=None, tag_prefix=None):
        self.channel = channel
        self.queues = maybe_list(queues or [])
        self.no_ack = self.no_ack if no_ack is None else no_ack
        self.callbacks = (self.callbacks or [] if callbacks is None
                          else callbacks)
        self.on_message = on_message
        self.tag_prefix = tag_prefix
        self._active_tags = {}
        if auto_declare is not None:
            self.auto_declare = auto_declare
        if on_decode_error is not None:
            self.on_decode_error = on_decode_error
        self.accept = prepare_accept_content(accept)
        self.prefetch_count = prefetch_count

        if self.channel:
            self.revive(self.channel)

    @property
    def queues(self):  # noqa
        return list(self._queues.values())

    @queues.setter
    def queues(self, queues):
        self._queues = {q.name: q for q in queues}

    def revive(self, channel):
        """Revive consumer after connection loss."""
        self._active_tags.clear()
        channel = self.channel = maybe_channel(channel)
        # modify dict size while iterating over it is not allowed
        for qname, queue in list(self._queues.items()):
            # name may have changed after declare
            self._queues.pop(qname, None)
            queue = self._queues[queue.name] = queue(self.channel)
            queue.revive(channel)

        if self.auto_declare:
            self.declare()

        if self.prefetch_count is not None:
            self.qos(prefetch_count=self.prefetch_count)

    def declare(self):
        """Declare queues, exchanges and bindings.

        Note:
        ----
            This is done automatically at instantiation
            when :attr:`auto_declare` is set.
        """
        for queue in self._queues.values():
            queue.declare()

    def register_callback(self, callback):
        """Register a new callback to be called when a message is received.

        Note:
        ----
            The signature of the callback needs to accept two arguments:
            `(body, message)`, which is the decoded message body
            and the :class:`~kombu.Message` instance.
        """
        self.callbacks.append(callback)

    def __enter__(self):
        self.consume()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None
    ) -> None:
        if self.channel and self.channel.connection:
            conn_errors = self.channel.connection.client.connection_errors
            if not isinstance(exc_val, conn_errors):
                try:
                    self.cancel()
                except Exception:
                    pass

    def add_queue(self, queue):
        """Add a queue to the list of queues to consume from.

        Note:
        ----
            This will not start consuming from the queue,
            for that you will have to call :meth:`consume` after.
        """
        queue = queue(self.channel)
        if self.auto_declare:
            queue.declare()
        self._queues[queue.name] = queue
        return queue

    def consume(self, no_ack=None):
        """Start consuming messages.

        Can be called multiple times, but note that while it
        will consume from new queues added since the last call,
        it will not cancel consuming from removed queues (
        use :meth:`cancel_by_queue`).

        Arguments:
        ---------
            no_ack (bool): See :attr:`no_ack`.
        """
        queues = list(self._queues.values())
        if queues:
            no_ack = self.no_ack if no_ack is None else no_ack

            H, T = queues[:-1], queues[-1]
            for queue in H:
                self._basic_consume(queue, no_ack=no_ack, nowait=True)
            self._basic_consume(T, no_ack=no_ack, nowait=False)

    def cancel(self):
        """End all active queue consumers.

        Note:
        ----
            This does not affect already delivered messages, but it does
            mean the server will not send any more messages for this consumer.
        """
        cancel = self.channel.basic_cancel
        for tag in self._active_tags.values():
            cancel(tag)
        self._active_tags.clear()

    close = cancel

    def cancel_by_queue(self, queue):
        """Cancel consumer by queue name."""
        qname = queue.name if isinstance(queue, Queue) else queue
        try:
            tag = self._active_tags.pop(qname)
        except KeyError:
            pass
        else:
            self.channel.basic_cancel(tag)
        finally:
            self._queues.pop(qname, None)

    def consuming_from(self, queue):
        """Return :const:`True` if currently consuming from queue'."""
        name = queue
        if isinstance(queue, Queue):
            name = queue.name
        return name in self._active_tags

    def purge(self):
        """Purge messages from all queues.

        Warning:
        -------
            This will *delete all ready messages*, there is no undo operation.
        """
        return sum(queue.purge() for queue in self._queues.values())

    def flow(self, active):
        """Enable/disable flow from peer.

        This is a simple flow-control mechanism that a peer can use
        to avoid overflowing its queues or otherwise finding itself
        receiving more messages than it can process.

        The peer that receives a request to stop sending content
        will finish sending the current content (if any), and then wait
        until flow is reactivated.
        """
        self.channel.flow(active)

    def qos(self, prefetch_size=0, prefetch_count=0, apply_global=False):
        """Specify quality of service.

        The client can request that messages should be sent in
        advance so that when the client finishes processing a message,
        the following message is already held locally, rather than needing
        to be sent down the channel. Prefetching gives a performance
        improvement.

        The prefetch window is Ignored if the :attr:`no_ack` option is set.

        Arguments:
        ---------
            prefetch_size (int): Specify the prefetch window in octets.
                The server will send a message in advance if it is equal to
                or smaller in size than the available prefetch size (and
                also falls within other prefetch limits). May be set to zero,
                meaning "no specific limit", although other prefetch limits
                may still apply.

            prefetch_count (int): Specify the prefetch window in terms of
                whole messages.

            apply_global (bool): Apply new settings globally on all channels.
        """
        return self.channel.basic_qos(prefetch_size,
                                      prefetch_count,
                                      apply_global)

    def recover(self, requeue=False):
        """Redeliver unacknowledged messages.

        Asks the broker to redeliver all unacknowledged messages
        on the specified channel.

        Arguments:
        ---------
            requeue (bool): By default the messages will be redelivered
                to the original recipient. With `requeue` set to true, the
                server will attempt to requeue the message, potentially then
                delivering it to an alternative subscriber.
        """
        return self.channel.basic_recover(requeue=requeue)

    def receive(self, body, message):
        """Method called when a message is received.

        This dispatches to the registered :attr:`callbacks`.

        Arguments:
        ---------
            body (Any): The decoded message body.
            message (~kombu.Message): The message instance.

        Raises
        ------
            NotImplementedError: If no consumer callbacks have been
                registered.
        """
        callbacks = self.callbacks
        if not callbacks:
            raise NotImplementedError('Consumer does not have any callbacks')
        [callback(body, message) for callback in callbacks]

    def _basic_consume(self, queue, consumer_tag=None,
                       no_ack=no_ack, nowait=True):
        tag = self._active_tags.get(queue.name)
        if tag is None:
            tag = self._add_tag(queue, consumer_tag)
            queue.consume(tag, self._receive_callback,
                          no_ack=no_ack, nowait=nowait)
        return tag

    def _add_tag(self, queue, consumer_tag=None):
        tag = consumer_tag or '{}{}'.format(
            self.tag_prefix, next(self._tags))
        self._active_tags[queue.name] = tag
        return tag

    def _receive_callback(self, message):
        accept = self.accept
        on_m, channel, decoded = self.on_message, self.channel, None
        try:
            m2p = getattr(channel, 'message_to_python', None)
            if m2p:
                message = m2p(message)
            if accept is not None:
                message.accept = accept
            if message.errors:
                return message._reraise_error(self.on_decode_error)
            decoded = None if on_m else message.decode()
        except Exception as exc:
            if not self.on_decode_error:
                raise
            self.on_decode_error(message, exc)
        else:
            return on_m(message) if on_m else self.receive(decoded, message)

    def __repr__(self):
        return f'<{type(self).__name__}: {self.queues}>'

    @property
    def connection(self):
        try:
            return self.channel.connection.client
        except AttributeError:
            pass
