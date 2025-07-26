"""Event receiver implementation."""
import time
from operator import itemgetter

from kombu import Queue
from kombu.connection import maybe_channel
from kombu.mixins import ConsumerMixin

from celery import uuid
from celery.app import app_or_default
from celery.utils.time import adjust_timestamp

from .event import get_exchange

__all__ = ('EventReceiver',)

CLIENT_CLOCK_SKEW = -1

_TZGETTER = itemgetter('utcoffset', 'timestamp')


class EventReceiver(ConsumerMixin):
    """Capture events.

    Arguments:
        connection (kombu.Connection): Connection to the broker.
        handlers (Mapping[Callable]): Event handlers.
            This is  a map of event type names and their handlers.
            The special handler `"*"` captures all events that don't have a
            handler.
    """

    app = None

    def __init__(self, channel, handlers=None, routing_key='#',
                 node_id=None, app=None, queue_prefix=None,
                 accept=None, queue_ttl=None, queue_expires=None):
        self.app = app_or_default(app or self.app)
        self.channel = maybe_channel(channel)
        self.handlers = {} if handlers is None else handlers
        self.routing_key = routing_key
        self.node_id = node_id or uuid()
        self.queue_prefix = queue_prefix or self.app.conf.event_queue_prefix
        self.exchange = get_exchange(
            self.connection or self.app.connection_for_write(),
            name=self.app.conf.event_exchange)
        if queue_ttl is None:
            queue_ttl = self.app.conf.event_queue_ttl
        if queue_expires is None:
            queue_expires = self.app.conf.event_queue_expires
        self.queue = Queue(
            '.'.join([self.queue_prefix, self.node_id]),
            exchange=self.exchange,
            routing_key=self.routing_key,
            auto_delete=True, durable=False,
            message_ttl=queue_ttl,
            expires=queue_expires,
        )
        self.clock = self.app.clock
        self.adjust_clock = self.clock.adjust
        self.forward_clock = self.clock.forward
        if accept is None:
            accept = {self.app.conf.event_serializer, 'json'}
        self.accept = accept

    def process(self, type, event):
        """Process event by dispatching to configured handler."""
        handler = self.handlers.get(type) or self.handlers.get('*')
        handler and handler(event)

    def get_consumers(self, Consumer, channel):
        return [Consumer(queues=[self.queue],
                         callbacks=[self._receive], no_ack=True,
                         accept=self.accept)]

    def on_consume_ready(self, connection, channel, consumers,
                         wakeup=True, **kwargs):
        if wakeup:
            self.wakeup_workers(channel=channel)

    def itercapture(self, limit=None, timeout=None, wakeup=True):
        return self.consume(limit=limit, timeout=timeout, wakeup=wakeup)

    def capture(self, limit=None, timeout=None, wakeup=True):
        """Open up a consumer capturing events.

        This has to run in the main process, and it will never stop
        unless :attr:`EventDispatcher.should_stop` is set to True, or
        forced via :exc:`KeyboardInterrupt` or :exc:`SystemExit`.
        """
        for _ in self.consume(limit=limit, timeout=timeout, wakeup=wakeup):
            pass

    def wakeup_workers(self, channel=None):
        self.app.control.broadcast('heartbeat',
                                   connection=self.connection,
                                   channel=channel)

    def event_from_message(self, body, localize=True,
                           now=time.time, tzfields=_TZGETTER,
                           adjust_timestamp=adjust_timestamp,
                           CLIENT_CLOCK_SKEW=CLIENT_CLOCK_SKEW):
        type = body['type']
        if type == 'task-sent':
            # clients never sync so cannot use their clock value
            _c = body['clock'] = (self.clock.value or 1) + CLIENT_CLOCK_SKEW
            self.adjust_clock(_c)
        else:
            try:
                clock = body['clock']
            except KeyError:
                body['clock'] = self.forward_clock()
            else:
                self.adjust_clock(clock)

        if localize:
            try:
                offset, timestamp = tzfields(body)
            except KeyError:
                pass
            else:
                body['timestamp'] = adjust_timestamp(timestamp, offset)
        body['local_received'] = now()
        return type, body

    def _receive(self, body, message, list=list, isinstance=isinstance):
        if isinstance(body, list):  # celery 4.0+: List of events
            process, from_message = self.process, self.event_from_message
            [process(*from_message(event)) for event in body]
        else:
            self.process(*self.event_from_message(body))

    @property
    def connection(self):
        return self.channel.connection.client if self.channel else None
