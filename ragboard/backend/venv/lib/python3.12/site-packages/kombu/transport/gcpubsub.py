"""GCP Pub/Sub transport module for kombu.

More information about GCP Pub/Sub:
https://cloud.google.com/pubsub

Features
========
* Type: Virtual
* Supports Direct: Yes
* Supports Topic: No
* Supports Fanout: Yes
* Supports Priority: No
* Supports TTL: No

Connection String
=================

Connection string has the following formats:

.. code-block::

    gcpubsub://projects/project-name

Transport Options
=================
* ``queue_name_prefix``: (str) Prefix for queue names.
* ``ack_deadline_seconds``: (int) The maximum time after receiving a message
  and acknowledging it before pub/sub redelivers the message.
* ``expiration_seconds``: (int) Subscriptions without any subscriber
  activity or changes made to their properties are removed after this period.
  Examples of subscriber activities include open connections,
  active pulls, or successful pushes.
* ``wait_time_seconds``: (int) The maximum time to wait for new messages.
  Defaults to 10.
* ``retry_timeout_seconds``: (int) The maximum time to wait before retrying.
* ``bulk_max_messages``: (int) The maximum number of messages to pull in bulk.
  Defaults to 32.
"""

from __future__ import annotations

import dataclasses
import datetime
import string
import threading
from concurrent.futures import (FIRST_COMPLETED, Future, ThreadPoolExecutor,
                                wait)
from contextlib import suppress
from os import getpid
from queue import Empty
from threading import Lock
from time import monotonic, sleep
from uuid import NAMESPACE_OID, uuid3

from _socket import gethostname
from _socket import timeout as socket_timeout
from google.api_core.exceptions import (AlreadyExists, DeadlineExceeded,
                                        PermissionDenied)
from google.api_core.retry import Retry
from google.cloud import monitoring_v3
from google.cloud.monitoring_v3 import query
from google.cloud.pubsub_v1 import PublisherClient, SubscriberClient
from google.cloud.pubsub_v1 import exceptions as pubsub_exceptions
from google.cloud.pubsub_v1.publisher import exceptions as publisher_exceptions
from google.cloud.pubsub_v1.subscriber import \
    exceptions as subscriber_exceptions
from google.pubsub_v1 import gapic_version as package_version

from kombu.entity import TRANSIENT_DELIVERY_MODE
from kombu.log import get_logger
from kombu.utils.encoding import bytes_to_str, safe_str
from kombu.utils.json import dumps, loads
from kombu.utils.objects import cached_property

from . import virtual

logger = get_logger('kombu.transport.gcpubsub')

# dots are replaced by dash, all other punctuation replaced by underscore.
PUNCTUATIONS_TO_REPLACE = set(string.punctuation) - {'_', '.', '-'}
CHARS_REPLACE_TABLE = {
    ord('.'): ord('-'),
    **{ord(c): ord('_') for c in PUNCTUATIONS_TO_REPLACE},
}


class UnackedIds:
    """Threadsafe list of ack_ids."""

    def __init__(self):
        self._list = []
        self._lock = Lock()

    def append(self, val):
        # append is atomic
        self._list.append(val)

    def extend(self, vals: list):
        # extend is atomic
        self._list.extend(vals)

    def pop(self, index=-1):
        with self._lock:
            return self._list.pop(index)

    def remove(self, val):
        with self._lock, suppress(ValueError):
            self._list.remove(val)

    def __len__(self):
        with self._lock:
            return len(self._list)

    def __getitem__(self, item):
        # getitem is atomic
        return self._list[item]


class AtomicCounter:
    """Threadsafe counter.

    Returns the value after inc/dec operations.
    """

    def __init__(self, initial=0):
        self._value = initial
        self._lock = Lock()

    def inc(self, n=1):
        with self._lock:
            self._value += n
            return self._value

    def dec(self, n=1):
        with self._lock:
            self._value -= n
            return self._value

    def get(self):
        with self._lock:
            return self._value


@dataclasses.dataclass
class QueueDescriptor:
    """Pub/Sub queue descriptor."""

    name: str
    topic_path: str  # projects/{project_id}/topics/{topic_id}
    subscription_id: str
    subscription_path: str  # projects/{project_id}/subscriptions/{subscription_id}
    unacked_ids: UnackedIds = dataclasses.field(default_factory=UnackedIds)


class Channel(virtual.Channel):
    """GCP Pub/Sub channel."""

    supports_fanout = True
    do_restore = False  # pub/sub does that for us
    default_wait_time_seconds = 10
    default_ack_deadline_seconds = 240
    default_expiration_seconds = 86400
    default_retry_timeout_seconds = 300
    default_bulk_max_messages = 32

    _min_ack_deadline = 10
    _fanout_exchanges = set()
    _unacked_extender: threading.Thread = None
    _stop_extender = threading.Event()
    _n_channels = AtomicCounter()
    _queue_cache: dict[str, QueueDescriptor] = {}
    _tmp_subscriptions: set[str] = set()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pool = ThreadPoolExecutor()
        logger.info('new GCP pub/sub channel: %s', self.conninfo.hostname)

        self.project_id = Transport.parse_uri(self.conninfo.hostname)
        if self._n_channels.inc() == 1:
            Channel._unacked_extender = threading.Thread(
                target=self._extend_unacked_deadline,
                daemon=True,
            )
            self._stop_extender.clear()
            Channel._unacked_extender.start()

    def entity_name(self, name: str, table=CHARS_REPLACE_TABLE) -> str:
        """Format AMQP queue name into a valid Pub/Sub queue name."""
        if not name.startswith(self.queue_name_prefix):
            name = self.queue_name_prefix + name

        return str(safe_str(name)).translate(table)

    def _queue_bind(self, exchange, routing_key, pattern, queue):
        exchange_type = self.typeof(exchange).type
        queue = self.entity_name(queue)
        logger.debug(
            'binding queue: %s to %s exchange: %s with routing_key: %s',
            queue,
            exchange_type,
            exchange,
            routing_key,
        )

        filter_args = {}
        if exchange_type == 'direct':
            # Direct exchange is implemented as a single subscription
            # E.g. for exchange 'test_direct':
            # -topic:'test_direct'
            #  -bound queue:'direct1':
            #  -subscription: direct1' on topic 'test_direct'
            #   -filter:routing_key'
            filter_args = {
                'filter': f'attributes.routing_key="{routing_key}"'
            }
            subscription_path = self.subscriber.subscription_path(
                self.project_id, queue
            )
            message_retention_duration = self.expiration_seconds
        elif exchange_type == 'fanout':
            # Fanout exchange is implemented as a separate subscription.
            # E.g. for exchange 'test_fanout':
            # -topic:'test_fanout'
            #  -bound queue 'fanout1':
            #    -subscription:'fanout1-uuid' on topic 'test_fanout'
            #  -bound queue 'fanout2':
            #    -subscription:'fanout2-uuid' on topic 'test_fanout'
            uid = f'{uuid3(NAMESPACE_OID, f"{gethostname()}.{getpid()}")}'
            uniq_sub_name = f'{queue}-{uid}'
            subscription_path = self.subscriber.subscription_path(
                self.project_id, uniq_sub_name
            )
            self._tmp_subscriptions.add(subscription_path)
            self._fanout_exchanges.add(exchange)
            message_retention_duration = 600
        else:
            raise NotImplementedError(
                f'exchange type {exchange_type} not implemented'
            )
        exchange_topic = self._create_topic(
            self.project_id, exchange, message_retention_duration
        )
        self._create_subscription(
            topic_path=exchange_topic,
            subscription_path=subscription_path,
            filter_args=filter_args,
            msg_retention=message_retention_duration,
        )
        qdesc = QueueDescriptor(
            name=queue,
            topic_path=exchange_topic,
            subscription_id=queue,
            subscription_path=subscription_path,
        )
        self._queue_cache[queue] = qdesc

    def _create_topic(
        self,
        project_id: str,
        topic_id: str,
        message_retention_duration: int = None,
    ) -> str:
        topic_path = self.publisher.topic_path(project_id, topic_id)
        if self._is_topic_exists(topic_path):
            # topic creation takes a while, so skip if possible
            logger.debug('topic: %s exists', topic_path)
            return topic_path
        try:
            logger.debug('creating topic: %s', topic_path)
            request = {'name': topic_path}
            if message_retention_duration:
                request[
                    'message_retention_duration'
                ] = f'{message_retention_duration}s'
            self.publisher.create_topic(request=request)
        except AlreadyExists:
            pass

        return topic_path

    def _is_topic_exists(self, topic_path: str) -> bool:
        topics = self.publisher.list_topics(
            request={"project": f'projects/{self.project_id}'}
        )
        for t in topics:
            if t.name == topic_path:
                return True
        return False

    def _create_subscription(
        self,
        project_id: str = None,
        topic_id: str = None,
        topic_path: str = None,
        subscription_path: str = None,
        filter_args=None,
        msg_retention: int = None,
    ) -> str:
        subscription_path = (
            subscription_path
            or self.subscriber.subscription_path(self.project_id, topic_id)
        )
        topic_path = topic_path or self.publisher.topic_path(
            project_id, topic_id
        )
        try:
            logger.debug(
                'creating subscription: %s, topic: %s, filter: %s',
                subscription_path,
                topic_path,
                filter_args,
            )
            msg_retention = msg_retention or self.expiration_seconds
            self.subscriber.create_subscription(
                request={
                    "name": subscription_path,
                    "topic": topic_path,
                    'ack_deadline_seconds': self.ack_deadline_seconds,
                    'expiration_policy': {
                        'ttl': f'{self.expiration_seconds}s'
                    },
                    'message_retention_duration': f'{msg_retention}s',
                    **(filter_args or {}),
                }
            )
        except AlreadyExists:
            pass
        return subscription_path

    def _delete(self, queue, *args, **kwargs):
        """Delete a queue by name."""
        queue = self.entity_name(queue)
        logger.info('deleting queue: %s', queue)
        qdesc = self._queue_cache.get(queue)
        if not qdesc:
            return
        self.subscriber.delete_subscription(
            request={"subscription": qdesc.subscription_path}
        )
        self._queue_cache.pop(queue, None)

    def _put(self, queue, message, **kwargs):
        """Put a message onto the queue."""
        queue = self.entity_name(queue)
        qdesc = self._queue_cache[queue]
        routing_key = self._get_routing_key(message)
        logger.debug(
            'putting message to queue: %s, topic: %s, routing_key: %s',
            queue,
            qdesc.topic_path,
            routing_key,
        )
        encoded_message = dumps(message)
        self.publisher.publish(
            qdesc.topic_path,
            encoded_message.encode("utf-8"),
            routing_key=routing_key,
        )

    def _put_fanout(self, exchange, message, routing_key, **kwargs):
        """Put a message onto fanout exchange."""
        self._lookup(exchange, routing_key)
        topic_path = self.publisher.topic_path(self.project_id, exchange)
        logger.debug(
            'putting msg to fanout exchange: %s, topic: %s',
            exchange,
            topic_path,
        )
        encoded_message = dumps(message)
        self.publisher.publish(
            topic_path,
            encoded_message.encode("utf-8"),
            retry=Retry(deadline=self.retry_timeout_seconds),
        )

    def _get(self, queue: str, timeout: float = None):
        """Retrieves a single message from a queue."""
        queue = self.entity_name(queue)
        qdesc = self._queue_cache[queue]
        try:
            response = self.subscriber.pull(
                request={
                    'subscription': qdesc.subscription_path,
                    'max_messages': 1,
                },
                retry=Retry(deadline=self.retry_timeout_seconds),
                timeout=timeout or self.wait_time_seconds,
            )
        except DeadlineExceeded:
            raise Empty()

        if len(response.received_messages) == 0:
            raise Empty()

        message = response.received_messages[0]
        ack_id = message.ack_id
        payload = loads(message.message.data)
        delivery_info = payload['properties']['delivery_info']
        logger.debug(
            'queue:%s got message, ack_id: %s, payload: %s',
            queue,
            ack_id,
            payload['properties'],
        )
        if self._is_auto_ack(payload['properties']):
            logger.debug('auto acking message ack_id: %s', ack_id)
            self._do_ack([ack_id], qdesc.subscription_path)
        else:
            delivery_info['gcpubsub_message'] = {
                'queue': queue,
                'ack_id': ack_id,
                'message_id': message.message.message_id,
                'subscription_path': qdesc.subscription_path,
            }
            qdesc.unacked_ids.append(ack_id)

        return payload

    def _is_auto_ack(self, payload_properties: dict):
        exchange = payload_properties['delivery_info']['exchange']
        delivery_mode = payload_properties['delivery_mode']
        return (
            delivery_mode == TRANSIENT_DELIVERY_MODE
            or exchange in self._fanout_exchanges
        )

    def _get_bulk(self, queue: str, timeout: float):
        """Retrieves bulk of messages from a queue."""
        prefixed_queue = self.entity_name(queue)
        qdesc = self._queue_cache[prefixed_queue]
        max_messages = self._get_max_messages_estimate()
        if not max_messages:
            raise Empty()
        try:
            response = self.subscriber.pull(
                request={
                    'subscription': qdesc.subscription_path,
                    'max_messages': max_messages,
                },
                retry=Retry(deadline=self.retry_timeout_seconds),
                timeout=timeout or self.wait_time_seconds,
            )
        except DeadlineExceeded:
            raise Empty()

        received_messages = response.received_messages
        if len(received_messages) == 0:
            raise Empty()

        auto_ack_ids = []
        ret_payloads = []
        logger.debug(
            'batching %d messages from queue: %s',
            len(received_messages),
            prefixed_queue,
        )
        for message in received_messages:
            ack_id = message.ack_id
            payload = loads(bytes_to_str(message.message.data))
            delivery_info = payload['properties']['delivery_info']
            delivery_info['gcpubsub_message'] = {
                'queue': prefixed_queue,
                'ack_id': ack_id,
                'message_id': message.message.message_id,
                'subscription_path': qdesc.subscription_path,
            }
            if self._is_auto_ack(payload['properties']):
                auto_ack_ids.append(ack_id)
            else:
                qdesc.unacked_ids.append(ack_id)
            ret_payloads.append(payload)
        if auto_ack_ids:
            logger.debug('auto acking ack_ids: %s', auto_ack_ids)
            self._do_ack(auto_ack_ids, qdesc.subscription_path)

        return queue, ret_payloads

    def _get_max_messages_estimate(self) -> int:
        max_allowed = self.qos.can_consume_max_estimate()
        max_if_unlimited = self.bulk_max_messages
        return max_if_unlimited if max_allowed is None else max_allowed

    def _lookup(self, exchange, routing_key, default=None):
        exchange_info = self.state.exchanges.get(exchange, {})
        if not exchange_info:
            return super()._lookup(exchange, routing_key, default)
        ret = self.typeof(exchange).lookup(
            self.get_table(exchange),
            exchange,
            routing_key,
            default,
        )
        if ret:
            return ret
        logger.debug(
            'no queues bound to exchange: %s, binding on the fly',
            exchange,
        )
        self.queue_bind(exchange, exchange, routing_key)
        return [exchange]

    def _size(self, queue: str) -> int:
        """Return the number of messages in a queue.

        This is a *rough* estimation, as Pub/Sub doesn't provide
        an exact API.
        """
        queue = self.entity_name(queue)
        if queue not in self._queue_cache:
            return 0
        qdesc = self._queue_cache[queue]
        result = query.Query(
            self.monitor,
            self.project_id,
            'pubsub.googleapis.com/subscription/num_undelivered_messages',
            end_time=datetime.datetime.now(),
            minutes=1,
        ).select_resources(subscription_id=qdesc.subscription_id)

        # monitoring API requires the caller to have the monitoring.viewer
        # role. Since we can live without the exact number of messages
        # in the queue, we can ignore the exception and allow users to
        # use the transport without this role.
        with suppress(PermissionDenied):
            return sum(
                content.points[0].value.int64_value for content in result
            )
        return -1

    def basic_ack(self, delivery_tag, multiple=False):
        """Acknowledge one message."""
        if multiple:
            raise NotImplementedError('multiple acks not implemented')

        delivery_info = self.qos.get(delivery_tag).delivery_info
        pubsub_message = delivery_info['gcpubsub_message']
        ack_id = pubsub_message['ack_id']
        queue = pubsub_message['queue']
        logger.debug('ack message. queue: %s ack_id: %s', queue, ack_id)
        subscription_path = pubsub_message['subscription_path']
        self._do_ack([ack_id], subscription_path)
        qdesc = self._queue_cache[queue]
        qdesc.unacked_ids.remove(ack_id)
        super().basic_ack(delivery_tag)

    def _do_ack(self, ack_ids: list[str], subscription_path: str):
        self.subscriber.acknowledge(
            request={"subscription": subscription_path, "ack_ids": ack_ids},
            retry=Retry(deadline=self.retry_timeout_seconds),
        )

    def _purge(self, queue: str):
        """Delete all current messages in a queue."""
        queue = self.entity_name(queue)
        qdesc = self._queue_cache.get(queue)
        if not qdesc:
            return

        n = self._size(queue)
        self.subscriber.seek(
            request={
                "subscription": qdesc.subscription_path,
                "time": datetime.datetime.now(),
            }
        )
        return n

    def _extend_unacked_deadline(self):
        thread_id = threading.get_native_id()
        logger.info(
            'unacked deadline extension thread: [%s] started',
            thread_id,
        )
        min_deadline_sleep = self._min_ack_deadline / 2
        sleep_time = max(min_deadline_sleep, self.ack_deadline_seconds / 4)
        while not self._stop_extender.wait(sleep_time):
            for qdesc in self._queue_cache.values():
                if len(qdesc.unacked_ids) == 0:
                    logger.debug(
                        'thread [%s]: no unacked messages for %s',
                        thread_id,
                        qdesc.subscription_path,
                    )
                    continue
                logger.debug(
                    'thread [%s]: extend ack deadline for %s: %d msgs [%s]',
                    thread_id,
                    qdesc.subscription_path,
                    len(qdesc.unacked_ids),
                    list(qdesc.unacked_ids),
                )
                self.subscriber.modify_ack_deadline(
                    request={
                        "subscription": qdesc.subscription_path,
                        "ack_ids": list(qdesc.unacked_ids),
                        "ack_deadline_seconds": self.ack_deadline_seconds,
                    }
                )
        logger.info(
            'unacked deadline extension thread [%s] stopped', thread_id
        )

    def after_reply_message_received(self, queue: str):
        queue = self.entity_name(queue)
        sub = self.subscriber.subscription_path(self.project_id, queue)
        logger.debug(
            'after_reply_message_received: queue: %s, sub: %s', queue, sub
        )
        self._tmp_subscriptions.add(sub)

    @cached_property
    def subscriber(self):
        return SubscriberClient()

    @cached_property
    def publisher(self):
        return PublisherClient()

    @cached_property
    def monitor(self):
        return monitoring_v3.MetricServiceClient()

    @property
    def conninfo(self):
        return self.connection.client

    @property
    def transport_options(self):
        return self.connection.client.transport_options

    @cached_property
    def wait_time_seconds(self):
        return self.transport_options.get(
            'wait_time_seconds', self.default_wait_time_seconds
        )

    @cached_property
    def retry_timeout_seconds(self):
        return self.transport_options.get(
            'retry_timeout_seconds', self.default_retry_timeout_seconds
        )

    @cached_property
    def ack_deadline_seconds(self):
        return self.transport_options.get(
            'ack_deadline_seconds', self.default_ack_deadline_seconds
        )

    @cached_property
    def queue_name_prefix(self):
        return self.transport_options.get('queue_name_prefix', 'kombu-')

    @cached_property
    def expiration_seconds(self):
        return self.transport_options.get(
            'expiration_seconds', self.default_expiration_seconds
        )

    @cached_property
    def bulk_max_messages(self):
        return self.transport_options.get(
            'bulk_max_messages', self.default_bulk_max_messages
        )

    def close(self):
        """Close the channel."""
        logger.debug('closing channel')
        while self._tmp_subscriptions:
            sub = self._tmp_subscriptions.pop()
            with suppress(Exception):
                logger.debug('deleting subscription: %s', sub)
                self.subscriber.delete_subscription(
                    request={"subscription": sub}
                )
        if not self._n_channels.dec():
            self._stop_extender.set()
            Channel._unacked_extender.join()
        super().close()

    @staticmethod
    def _get_routing_key(message):
        routing_key = (
            message['properties']
            .get('delivery_info', {})
            .get('routing_key', '')
        )
        return routing_key


class Transport(virtual.Transport):
    """GCP Pub/Sub transport."""

    Channel = Channel

    can_parse_url = True
    polling_interval = 0.1
    connection_errors = virtual.Transport.connection_errors + (
        pubsub_exceptions.TimeoutError,
    )
    channel_errors = (
        virtual.Transport.channel_errors
        + (
            publisher_exceptions.FlowControlLimitError,
            publisher_exceptions.MessageTooLargeError,
            publisher_exceptions.PublishError,
            publisher_exceptions.TimeoutError,
            publisher_exceptions.PublishToPausedOrderingKeyException,
        )
        + (subscriber_exceptions.AcknowledgeError,)
    )

    driver_type = 'gcpubsub'
    driver_name = 'pubsub_v1'

    implements = virtual.Transport.implements.extend(
        exchange_type=frozenset(['direct', 'fanout']),
    )

    def __init__(self, client, **kwargs):
        super().__init__(client, **kwargs)
        self._pool = ThreadPoolExecutor()
        self._get_bulk_future_to_queue: dict[Future, str] = dict()

    def driver_version(self):
        return package_version.__version__

    @staticmethod
    def parse_uri(uri: str) -> str:
        # URL like:
        #  gcpubsub://projects/project-name

        project = uri.split('gcpubsub://projects/')[1]
        return project.strip('/')

    @classmethod
    def as_uri(self, uri: str, include_password=False, mask='**') -> str:
        return uri or 'gcpubsub://'

    def drain_events(self, connection, timeout=None):
        time_start = monotonic()
        polling_interval = self.polling_interval
        if timeout and polling_interval and polling_interval > timeout:
            polling_interval = timeout
        while 1:
            try:
                self._drain_from_active_queues(timeout=timeout)
            except Empty:
                if timeout and monotonic() - time_start >= timeout:
                    raise socket_timeout()
                if polling_interval:
                    sleep(polling_interval)
            else:
                break

    def _drain_from_active_queues(self, timeout):
        # cleanup empty requests from prev run
        self._rm_empty_bulk_requests()

        # submit new requests for all active queues
        # longer timeout means less frequent polling
        # and more messages in a single bulk
        self._submit_get_bulk_requests(timeout=10)

        done, _ = wait(
            self._get_bulk_future_to_queue,
            timeout=timeout,
            return_when=FIRST_COMPLETED,
        )
        empty = {f for f in done if f.exception()}
        done -= empty
        for f in empty:
            self._get_bulk_future_to_queue.pop(f, None)

        if not done:
            raise Empty()

        logger.debug('got %d done get_bulk tasks', len(done))
        for f in done:
            queue, payloads = f.result()
            for payload in payloads:
                logger.debug('consuming message from queue: %s', queue)
                if queue not in self._callbacks:
                    logger.warning(
                        'Message for queue %s without consumers', queue
                    )
                    continue
                self._deliver(payload, queue)
            self._get_bulk_future_to_queue.pop(f, None)

    def _rm_empty_bulk_requests(self):
        empty = {
            f
            for f in self._get_bulk_future_to_queue
            if f.done() and f.exception()
        }
        for f in empty:
            self._get_bulk_future_to_queue.pop(f, None)

    def _submit_get_bulk_requests(self, timeout):
        queues_with_submitted_get_bulk = set(
            self._get_bulk_future_to_queue.values()
        )

        for channel in self.channels:
            for queue in channel._active_queues:
                if queue in queues_with_submitted_get_bulk:
                    continue
                future = self._pool.submit(channel._get_bulk, queue, timeout)
                self._get_bulk_future_to_queue[future] = queue
