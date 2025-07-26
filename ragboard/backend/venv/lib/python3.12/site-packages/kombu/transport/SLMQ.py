"""SoftLayer Message Queue transport module for kombu.

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
 *Unreviewed*

Transport Options
=================
 *Unreviewed*
"""

from __future__ import annotations

import os
import socket
import string
from queue import Empty

from kombu.utils.encoding import bytes_to_str, safe_str
from kombu.utils.json import dumps, loads
from kombu.utils.objects import cached_property

from . import virtual

try:
    from softlayer_messaging import get_client
    from softlayer_messaging.errors import ResponseError
except ImportError:  # pragma: no cover
    get_client = ResponseError = None

# dots are replaced by dash, all other punctuation replaced by underscore.
CHARS_REPLACE_TABLE = {
    ord(c): 0x5f for c in string.punctuation if c not in '_'
}


class Channel(virtual.Channel):
    """SLMQ Channel."""

    default_visibility_timeout = 1800  # 30 minutes.
    domain_format = 'kombu%(vhost)s'
    _slmq = None
    _queue_cache = {}
    _noack_queues = set()

    def __init__(self, *args, **kwargs):
        if get_client is None:
            raise ImportError(
                'SLMQ transport requires the softlayer_messaging library',
            )
        super().__init__(*args, **kwargs)
        queues = self.slmq.queues()
        for queue in queues:
            self._queue_cache[queue] = queue

    def basic_consume(self, queue, no_ack, *args, **kwargs):
        if no_ack:
            self._noack_queues.add(queue)
        return super().basic_consume(queue, no_ack,
                                     *args, **kwargs)

    def basic_cancel(self, consumer_tag):
        if consumer_tag in self._consumers:
            queue = self._tag_to_queue[consumer_tag]
            self._noack_queues.discard(queue)
        return super().basic_cancel(consumer_tag)

    def entity_name(self, name, table=CHARS_REPLACE_TABLE):
        """Format AMQP queue name into a valid SLQS queue name."""
        return str(safe_str(name)).translate(table)

    def _new_queue(self, queue, **kwargs):
        """Ensure a queue exists in SLQS."""
        queue = self.entity_name(self.queue_name_prefix + queue)
        try:
            return self._queue_cache[queue]
        except KeyError:
            try:
                self.slmq.create_queue(
                    queue, visibility_timeout=self.visibility_timeout)
            except ResponseError:
                pass
            q = self._queue_cache[queue] = self.slmq.queue(queue)
            return q

    def _delete(self, queue, *args, **kwargs):
        """Delete queue by name."""
        queue_name = self.entity_name(queue)
        self._queue_cache.pop(queue_name, None)
        self.slmq.queue(queue_name).delete(force=True)
        super()._delete(queue_name)

    def _put(self, queue, message, **kwargs):
        """Put message onto queue."""
        q = self._new_queue(queue)
        q.push(dumps(message))

    def _get(self, queue):
        """Try to retrieve a single message off ``queue``."""
        q = self._new_queue(queue)
        rs = q.pop(1)
        if rs['items']:
            m = rs['items'][0]
            payload = loads(bytes_to_str(m['body']))
            if queue in self._noack_queues:
                q.message(m['id']).delete()
            else:
                payload['properties']['delivery_info'].update({
                    'slmq_message_id': m['id'], 'slmq_queue_name': q.name})
            return payload
        raise Empty()

    def basic_ack(self, delivery_tag):
        delivery_info = self.qos.get(delivery_tag).delivery_info
        try:
            queue = delivery_info['slmq_queue_name']
        except KeyError:
            pass
        else:
            self.delete_message(queue, delivery_info['slmq_message_id'])
        super().basic_ack(delivery_tag)

    def _size(self, queue):
        """Return the number of messages in a queue."""
        return self._new_queue(queue).detail()['message_count']

    def _purge(self, queue):
        """Delete all current messages in a queue."""
        q = self._new_queue(queue)
        n = 0
        results = q.pop(10)
        while results['items']:
            for m in results['items']:
                self.delete_message(queue, m['id'])
                n += 1
            results = q.pop(10)
        return n

    def delete_message(self, queue, message_id):
        q = self.slmq.queue(self.entity_name(queue))
        return q.message(message_id).delete()

    @property
    def slmq(self):
        if self._slmq is None:
            conninfo = self.conninfo
            account = os.environ.get('SLMQ_ACCOUNT', conninfo.virtual_host)
            user = os.environ.get('SL_USERNAME', conninfo.userid)
            api_key = os.environ.get('SL_API_KEY', conninfo.password)
            host = os.environ.get('SLMQ_HOST', conninfo.hostname)
            port = os.environ.get('SLMQ_PORT', conninfo.port)
            secure = bool(os.environ.get(
                'SLMQ_SECURE', self.transport_options.get('secure')) or True,
            )
            endpoint = '{}://{}{}'.format(
                'https' if secure else 'http', host,
                f':{port}' if port else '',
            )

            self._slmq = get_client(account, endpoint=endpoint)
            self._slmq.authenticate(user, api_key)
        return self._slmq

    @property
    def conninfo(self):
        return self.connection.client

    @property
    def transport_options(self):
        return self.connection.client.transport_options

    @cached_property
    def visibility_timeout(self):
        return (self.transport_options.get('visibility_timeout') or
                self.default_visibility_timeout)

    @cached_property
    def queue_name_prefix(self):
        return self.transport_options.get('queue_name_prefix', '')


class Transport(virtual.Transport):
    """SLMQ Transport."""

    Channel = Channel

    polling_interval = 1
    default_port = None
    connection_errors = (
        virtual.Transport.connection_errors + (
            ResponseError, socket.error
        )
    )
