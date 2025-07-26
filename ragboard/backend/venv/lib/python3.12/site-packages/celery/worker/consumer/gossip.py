"""Worker <-> Worker communication Bootstep."""
from collections import defaultdict
from functools import partial
from heapq import heappush
from operator import itemgetter

from kombu import Consumer
from kombu.asynchronous.semaphore import DummyLock
from kombu.exceptions import ContentDisallowed, DecodeError

from celery import bootsteps
from celery.utils.log import get_logger
from celery.utils.objects import Bunch

from .mingle import Mingle

__all__ = ('Gossip',)

logger = get_logger(__name__)
debug, info = logger.debug, logger.info


class Gossip(bootsteps.ConsumerStep):
    """Bootstep consuming events from other workers.

    This keeps the logical clock value up to date.
    """

    label = 'Gossip'
    requires = (Mingle,)
    _cons_stamp_fields = itemgetter(
        'id', 'clock', 'hostname', 'pid', 'topic', 'action', 'cver',
    )
    compatible_transports = {'amqp', 'redis'}

    def __init__(self, c, without_gossip=False,
                 interval=5.0, heartbeat_interval=2.0, **kwargs):
        self.enabled = not without_gossip and self.compatible_transport(c.app)
        self.app = c.app
        c.gossip = self
        self.Receiver = c.app.events.Receiver
        self.hostname = c.hostname
        self.full_hostname = '.'.join([self.hostname, str(c.pid)])
        self.on = Bunch(
            node_join=set(),
            node_leave=set(),
            node_lost=set(),
        )

        self.timer = c.timer
        if self.enabled:
            self.state = c.app.events.State(
                on_node_join=self.on_node_join,
                on_node_leave=self.on_node_leave,
                max_tasks_in_memory=1,
            )
            if c.hub:
                c._mutex = DummyLock()
            self.update_state = self.state.event
        self.interval = interval
        self.heartbeat_interval = heartbeat_interval
        self._tref = None
        self.consensus_requests = defaultdict(list)
        self.consensus_replies = {}
        self.event_handlers = {
            'worker.elect': self.on_elect,
            'worker.elect.ack': self.on_elect_ack,
        }
        self.clock = c.app.clock

        self.election_handlers = {
            'task': self.call_task
        }

        super().__init__(c, **kwargs)

    def compatible_transport(self, app):
        with app.connection_for_read() as conn:
            return conn.transport.driver_type in self.compatible_transports

    def election(self, id, topic, action=None):
        self.consensus_replies[id] = []
        self.dispatcher.send(
            'worker-elect',
            id=id, topic=topic, action=action, cver=1,
        )

    def call_task(self, task):
        try:
            self.app.signature(task).apply_async()
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception('Could not call task: %r', exc)

    def on_elect(self, event):
        try:
            (id_, clock, hostname, pid,
             topic, action, _) = self._cons_stamp_fields(event)
        except KeyError as exc:
            return logger.exception('election request missing field %s', exc)
        heappush(
            self.consensus_requests[id_],
            (clock, f'{hostname}.{pid}', topic, action),
        )
        self.dispatcher.send('worker-elect-ack', id=id_)

    def start(self, c):
        super().start(c)
        self.dispatcher = c.event_dispatcher

    def on_elect_ack(self, event):
        id = event['id']
        try:
            replies = self.consensus_replies[id]
        except KeyError:
            return  # not for us
        alive_workers = set(self.state.alive_workers())
        replies.append(event['hostname'])

        if len(replies) >= len(alive_workers):
            _, leader, topic, action = self.clock.sort_heap(
                self.consensus_requests[id],
            )
            if leader == self.full_hostname:
                info('I won the election %r', id)
                try:
                    handler = self.election_handlers[topic]
                except KeyError:
                    logger.exception('Unknown election topic %r', topic)
                else:
                    handler(action)
            else:
                info('node %s elected for %r', leader, id)
            self.consensus_requests.pop(id, None)
            self.consensus_replies.pop(id, None)

    def on_node_join(self, worker):
        debug('%s joined the party', worker.hostname)
        self._call_handlers(self.on.node_join, worker)

    def on_node_leave(self, worker):
        debug('%s left', worker.hostname)
        self._call_handlers(self.on.node_leave, worker)

    def on_node_lost(self, worker):
        info('missed heartbeat from %s', worker.hostname)
        self._call_handlers(self.on.node_lost, worker)

    def _call_handlers(self, handlers, *args, **kwargs):
        for handler in handlers:
            try:
                handler(*args, **kwargs)
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception(
                    'Ignored error from handler %r: %r', handler, exc)

    def register_timer(self):
        if self._tref is not None:
            self._tref.cancel()
        self._tref = self.timer.call_repeatedly(self.interval, self.periodic)

    def periodic(self):
        workers = self.state.workers
        dirty = set()
        for worker in workers.values():
            if not worker.alive:
                dirty.add(worker)
                self.on_node_lost(worker)
        for worker in dirty:
            workers.pop(worker.hostname, None)

    def get_consumers(self, channel):
        self.register_timer()
        ev = self.Receiver(channel, routing_key='worker.#',
                           queue_ttl=self.heartbeat_interval)
        return [Consumer(
            channel,
            queues=[ev.queue],
            on_message=partial(self.on_message, ev.event_from_message),
            no_ack=True
        )]

    def on_message(self, prepare, message):
        _type = message.delivery_info['routing_key']

        # For redis when `fanout_patterns=False` (See Issue #1882)
        if _type.split('.', 1)[0] == 'task':
            return
        try:
            handler = self.event_handlers[_type]
        except KeyError:
            pass
        else:
            return handler(message.payload)

        # proto2: hostname in header; proto1: in body
        hostname = (message.headers.get('hostname') or
                    message.payload['hostname'])
        if hostname != self.hostname:
            try:
                _, event = prepare(message.payload)
                self.update_state(event)
            except (DecodeError, ContentDisallowed, TypeError) as exc:
                logger.error(exc)
        else:
            self.clock.forward()
