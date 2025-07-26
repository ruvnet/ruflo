"""Carrot compatibility interface.

See https://pypi.org/project/carrot/ for documentation.
"""

from __future__ import annotations

from itertools import count
from typing import TYPE_CHECKING

from . import messaging
from .entity import Exchange, Queue

if TYPE_CHECKING:
    from types import TracebackType

__all__ = ('Publisher', 'Consumer')

# XXX compat attribute
entry_to_queue = Queue.from_dict


def _iterconsume(connection, consumer, no_ack=False, limit=None):
    consumer.consume(no_ack=no_ack)
    for iteration in count(0):  # for infinity
        if limit and iteration >= limit:
            break
        yield connection.drain_events()


class Publisher(messaging.Producer):
    """Carrot compatible producer."""

    exchange = ''
    exchange_type = 'direct'
    routing_key = ''
    durable = True
    auto_delete = False
    _closed = False

    def __init__(self, connection, exchange=None, routing_key=None,
                 exchange_type=None, durable=None, auto_delete=None,
                 channel=None, **kwargs):
        if channel:
            connection = channel

        self.exchange = exchange or self.exchange
        self.exchange_type = exchange_type or self.exchange_type
        self.routing_key = routing_key or self.routing_key

        if auto_delete is not None:
            self.auto_delete = auto_delete
        if durable is not None:
            self.durable = durable

        if not isinstance(self.exchange, Exchange):
            self.exchange = Exchange(name=self.exchange,
                                     type=self.exchange_type,
                                     routing_key=self.routing_key,
                                     auto_delete=self.auto_delete,
                                     durable=self.durable)
        super().__init__(connection, self.exchange, **kwargs)

    def send(self, *args, **kwargs):
        return self.publish(*args, **kwargs)

    def close(self):
        super().close()
        self._closed = True

    def __enter__(self):
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None
    ) -> None:
        self.close()

    @property
    def backend(self):
        return self.channel


class Consumer(messaging.Consumer):
    """Carrot compatible consumer."""

    queue = ''
    exchange = ''
    routing_key = ''
    exchange_type = 'direct'
    durable = True
    exclusive = False
    auto_delete = False
    _closed = False

    def __init__(self, connection, queue=None, exchange=None,
                 routing_key=None, exchange_type=None, durable=None,
                 exclusive=None, auto_delete=None, **kwargs):
        self.backend = connection.channel()

        if durable is not None:
            self.durable = durable
        if exclusive is not None:
            self.exclusive = exclusive
        if auto_delete is not None:
            self.auto_delete = auto_delete

        self.queue = queue or self.queue
        self.exchange = exchange or self.exchange
        self.exchange_type = exchange_type or self.exchange_type
        self.routing_key = routing_key or self.routing_key

        exchange = Exchange(self.exchange,
                            type=self.exchange_type,
                            routing_key=self.routing_key,
                            auto_delete=self.auto_delete,
                            durable=self.durable)
        queue = Queue(self.queue,
                      exchange=exchange,
                      routing_key=self.routing_key,
                      durable=self.durable,
                      exclusive=self.exclusive,
                      auto_delete=self.auto_delete)
        super().__init__(self.backend, queue, **kwargs)

    def revive(self, channel):
        self.backend = channel
        super().revive(channel)

    def close(self):
        self.cancel()
        self.backend.close()
        self._closed = True

    def __enter__(self):
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None
    ) -> None:
        self.close()

    def __iter__(self):
        return self.iterqueue(infinite=True)

    def fetch(self, no_ack=None, enable_callbacks=False):
        if no_ack is None:
            no_ack = self.no_ack
        message = self.queues[0].get(no_ack)
        if message:
            if enable_callbacks:
                self.receive(message.payload, message)
        return message

    def process_next(self):
        raise NotImplementedError('Use fetch(enable_callbacks=True)')

    def discard_all(self, filterfunc=None):
        if filterfunc is not None:
            raise NotImplementedError(
                'discard_all does not implement filters')
        return self.purge()

    def iterconsume(self, limit=None, no_ack=None):
        return _iterconsume(self.connection, self, no_ack, limit)

    def wait(self, limit=None):
        it = self.iterconsume(limit)
        return list(it)

    def iterqueue(self, limit=None, infinite=False):
        for items_since_start in count():  # for infinity
            item = self.fetch()
            if (not infinite and item is None) or \
                    (limit and items_since_start >= limit):
                break
            yield item


class ConsumerSet(messaging.Consumer):

    def __init__(self, connection, from_dict=None, consumers=None,
                 channel=None, **kwargs):
        if channel:
            self._provided_channel = True
            self.backend = channel
        else:
            self._provided_channel = False
            self.backend = connection.channel()

        queues = []
        if consumers:
            for consumer in consumers:
                queues.extend(consumer.queues)
        if from_dict:
            for queue_name, queue_options in from_dict.items():
                queues.append(Queue.from_dict(queue_name, **queue_options))

        super().__init__(self.backend, queues, **kwargs)

    def iterconsume(self, limit=None, no_ack=False):
        return _iterconsume(self.connection, self, no_ack, limit)

    def discard_all(self):
        return self.purge()

    def add_consumer_from_dict(self, queue, **options):
        return self.add_queue(Queue.from_dict(queue, **options))

    def add_consumer(self, consumer):
        for queue in consumer.queues:
            self.add_queue(queue)

    def revive(self, channel):
        self.backend = channel
        super().revive(channel)

    def close(self):
        self.cancel()
        if not self._provided_channel:
            self.channel.close()
