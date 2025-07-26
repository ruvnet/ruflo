"""Pyro transport module for kombu.

Pyro transport, and Kombu Broker daemon.

Requires the :mod:`Pyro4` library to be installed.

Features
========
* Type: Virtual
* Supports Direct: Yes
* Supports Topic: Yes
* Supports Fanout: No
* Supports Priority: No
* Supports TTL: No

Connection String
=================

To use the Pyro transport with Kombu, use an url of the form:

.. code-block::

    pyro://localhost/kombu.broker

The hostname is where the transport will be looking for a Pyro name server,
which is used in turn to locate the kombu.broker Pyro service.
This broker can be launched by simply executing this transport module directly,
with the command: ``python -m kombu.transport.pyro``

Transport Options
=================
"""


from __future__ import annotations

import sys
from queue import Empty, Queue

from kombu.exceptions import reraise
from kombu.log import get_logger
from kombu.utils.objects import cached_property

from . import virtual

try:
    import Pyro4 as pyro
    from Pyro4.errors import NamingError
    from Pyro4.util import SerializerBase
except ImportError:          # pragma: no cover
    pyro = NamingError = SerializerBase = None

DEFAULT_PORT = 9090
E_NAMESERVER = """\
Unable to locate pyro nameserver on host {0.hostname}\
"""
E_LOOKUP = """\
Unable to lookup '{0.virtual_host}' in pyro nameserver on host {0.hostname}\
"""

logger = get_logger(__name__)


class Channel(virtual.Channel):
    """Pyro Channel."""

    def close(self):
        super().close()
        if self.shared_queues:
            self.shared_queues._pyroRelease()

    def queues(self):
        return self.shared_queues.get_queue_names()

    def _new_queue(self, queue, **kwargs):
        if queue not in self.queues():
            self.shared_queues.new_queue(queue)

    def _has_queue(self, queue, **kwargs):
        return self.shared_queues.has_queue(queue)

    def _get(self, queue, timeout=None):
        queue = self._queue_for(queue)
        return self.shared_queues.get(queue)

    def _queue_for(self, queue):
        if queue not in self.queues():
            self.shared_queues.new_queue(queue)
        return queue

    def _put(self, queue, message, **kwargs):
        queue = self._queue_for(queue)
        self.shared_queues.put(queue, message)

    def _size(self, queue):
        return self.shared_queues.size(queue)

    def _delete(self, queue, *args, **kwargs):
        self.shared_queues.delete(queue)

    def _purge(self, queue):
        return self.shared_queues.purge(queue)

    def after_reply_message_received(self, queue):
        pass

    @cached_property
    def shared_queues(self):
        return self.connection.shared_queues


class Transport(virtual.Transport):
    """Pyro Transport."""

    Channel = Channel

    #: memory backend state is global.
    # TODO: To be checked whether state can be per-Transport
    global_state = virtual.BrokerState()

    default_port = DEFAULT_PORT

    driver_type = driver_name = 'pyro'

    def __init__(self, client, **kwargs):
        super().__init__(client, **kwargs)
        self.state = self.global_state

    def _open(self):
        logger.debug("trying Pyro nameserver to find the broker daemon")
        conninfo = self.client
        try:
            nameserver = pyro.locateNS(host=conninfo.hostname,
                                       port=self.default_port)
        except NamingError:
            reraise(NamingError, NamingError(E_NAMESERVER.format(conninfo)),
                    sys.exc_info()[2])
        try:
            # name of registered pyro object
            uri = nameserver.lookup(conninfo.virtual_host)
            return pyro.Proxy(uri)
        except NamingError:
            reraise(NamingError, NamingError(E_LOOKUP.format(conninfo)),
                    sys.exc_info()[2])

    def driver_version(self):
        return pyro.__version__

    @cached_property
    def shared_queues(self):
        return self._open()


if pyro is not None:
    SerializerBase.register_dict_to_class("queue.Empty",
                                          lambda cls, data: Empty())

    @pyro.expose
    @pyro.behavior(instance_mode="single")
    class KombuBroker:
        """Kombu Broker used by the Pyro transport.

        You have to run this as a separate (Pyro) service.
        """

        def __init__(self):
            self.queues = {}

        def get_queue_names(self):
            return list(self.queues)

        def new_queue(self, queue):
            if queue in self.queues:
                return   # silently ignore the fact that queue already exists
            self.queues[queue] = Queue()

        def has_queue(self, queue):
            return queue in self.queues

        def get(self, queue):
            return self.queues[queue].get(block=False)

        def put(self, queue, message):
            self.queues[queue].put(message)

        def size(self, queue):
            return self.queues[queue].qsize()

        def delete(self, queue):
            del self.queues[queue]

        def purge(self, queue):
            while True:
                try:
                    self.queues[queue].get(blocking=False)
                except Empty:
                    break


# launch a Kombu Broker daemon with the command:
# ``python -m kombu.transport.pyro``
if __name__ == "__main__":
    print("Launching Broker for Kombu's Pyro transport.")
    with pyro.Daemon() as daemon:
        print("(Expecting a Pyro name server at {}:{})"
              .format(pyro.config.NS_HOST, pyro.config.NS_PORT))
        with pyro.locateNS() as ns:
            print("You can connect with Kombu using the url "
                  "'pyro://{}/kombu.broker'".format(pyro.config.NS_HOST))
            uri = daemon.register(KombuBroker)
            ns.register("kombu.broker", uri)
        daemon.requestLoop()
