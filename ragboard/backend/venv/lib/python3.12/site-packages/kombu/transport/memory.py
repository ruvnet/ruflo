"""In-memory transport module for Kombu.

Simple transport using memory for storing messages.
Messages can be passed only between threads.

Features
========
* Type: Virtual
* Supports Direct: Yes
* Supports Topic: Yes
* Supports Fanout: No
* Supports Priority: No
* Supports TTL: Yes

Connection String
=================
Connection string is in the following format:

.. code-block::

    memory://

"""

from __future__ import annotations

from collections import defaultdict
from queue import Queue

from . import base, virtual


class Channel(virtual.Channel):
    """In-memory Channel."""

    events = defaultdict(set)
    queues = {}
    do_restore = False
    supports_fanout = True

    def _has_queue(self, queue, **kwargs):
        return queue in self.queues

    def _new_queue(self, queue, **kwargs):
        if queue not in self.queues:
            self.queues[queue] = Queue()

    def _get(self, queue, timeout=None):
        return self._queue_for(queue).get(block=False)

    def _queue_for(self, queue):
        if queue not in self.queues:
            self.queues[queue] = Queue()
        return self.queues[queue]

    def _queue_bind(self, *args):
        pass

    def _put_fanout(self, exchange, message, routing_key=None, **kwargs):
        for queue in self._lookup(exchange, routing_key):
            self._queue_for(queue).put(message)

    def _put(self, queue, message, **kwargs):
        self._queue_for(queue).put(message)

    def _size(self, queue):
        return self._queue_for(queue).qsize()

    def _delete(self, queue, *args, **kwargs):
        self.queues.pop(queue, None)

    def _purge(self, queue):
        q = self._queue_for(queue)
        size = q.qsize()
        q.queue.clear()
        return size

    def close(self):
        super().close()
        for queue in self.queues.values():
            queue.empty()
        self.queues = {}

    def after_reply_message_received(self, queue):
        pass


class Transport(virtual.Transport):
    """In-memory Transport."""

    Channel = Channel

    #: memory backend state is global.
    global_state = virtual.BrokerState()

    implements = base.Transport.implements

    driver_type = 'memory'
    driver_name = 'memory'

    def __init__(self, client, **kwargs):
        super().__init__(client, **kwargs)
        self.state = self.global_state

    def driver_version(self):
        return 'N/A'
