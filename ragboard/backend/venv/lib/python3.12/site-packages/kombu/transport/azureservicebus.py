"""Azure Service Bus Message Queue transport module for kombu.

Note that the Shared Access Policy used to connect to Azure Service Bus
requires Manage, Send and Listen claims since the broker will create new
queues and delete old queues as required.


Notes when using with Celery if you are experiencing issues with programs not
terminating properly. The Azure Service Bus SDK uses the Azure uAMQP library
which in turn creates some threads. If the AzureServiceBus Channel is closed,
said threads will be closed properly, but it seems there are times when Celery
does not do this so these threads will be left running. As the uAMQP threads
are not marked as Daemon threads, they will not be killed when the main thread
exits. Setting the ``uamqp_keep_alive_interval`` transport option to 0 will
prevent the keep_alive thread from starting


More information about Azure Service Bus:
https://azure.microsoft.com/en-us/services/service-bus/

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

Connection string has the following formats:

.. code-block::

    azureservicebus://SAS_POLICY_NAME:SAS_KEY@SERVICE_BUSNAMESPACE
    azureservicebus://DefaultAzureCredential@SERVICE_BUSNAMESPACE
    azureservicebus://ManagedIdentityCredential@SERVICE_BUSNAMESPACE

Transport Options
=================

* ``queue_name_prefix`` - String prefix to prepend to queue names in a
  service bus namespace.
* ``wait_time_seconds`` - Number of seconds to wait to receive messages.
  Default ``5``
* ``peek_lock_seconds`` - Number of seconds the message is visible for before
  it is requeued and sent to another consumer. Default ``60``
* ``uamqp_keep_alive_interval`` - Interval in seconds the Azure uAMQP library
  should send keepalive messages. Default ``30``
* ``retry_total`` - Azure SDK retry total. Default ``3``
* ``retry_backoff_factor`` - Azure SDK exponential backoff factor.
  Default ``0.8``
* ``retry_backoff_max`` - Azure SDK retry total time. Default ``120``
"""

from __future__ import annotations

import string
from queue import Empty
from typing import Any

import azure.core.exceptions
import azure.servicebus.exceptions
import isodate
from azure.servicebus import (ServiceBusClient, ServiceBusMessage,
                              ServiceBusReceiveMode, ServiceBusReceiver,
                              ServiceBusSender)
from azure.servicebus.management import ServiceBusAdministrationClient

try:
    from azure.identity import (DefaultAzureCredential,
                                ManagedIdentityCredential)
except ImportError:
    DefaultAzureCredential = None
    ManagedIdentityCredential = None

from kombu.utils.encoding import bytes_to_str, safe_str
from kombu.utils.json import dumps, loads
from kombu.utils.objects import cached_property

from . import virtual

# dots are replaced by dash, all other punctuation replaced by underscore.
PUNCTUATIONS_TO_REPLACE = set(string.punctuation) - {'_', '.', '-'}
CHARS_REPLACE_TABLE = {
    ord('.'): ord('-'),
    **{ord(c): ord('_') for c in PUNCTUATIONS_TO_REPLACE}
}


class SendReceive:
    """Container for Sender and Receiver."""

    def __init__(self,
                 receiver: ServiceBusReceiver | None = None,
                 sender: ServiceBusSender | None = None):
        self.receiver: ServiceBusReceiver = receiver
        self.sender: ServiceBusSender = sender

    def close(self) -> None:
        if self.receiver:
            self.receiver.close()
            self.receiver = None
        if self.sender:
            self.sender.close()
            self.sender = None


class Channel(virtual.Channel):
    """Azure Service Bus channel."""

    default_wait_time_seconds: int = 5  # in seconds
    default_peek_lock_seconds: int = 60  # in seconds (default 60, max 300)
    # in seconds (is the default from service bus repo)
    default_uamqp_keep_alive_interval: int = 30
    # number of retries (is the default from service bus repo)
    default_retry_total: int = 3
    # exponential backoff factor (is the default from service bus repo)
    default_retry_backoff_factor: float = 0.8
    # Max time to backoff (is the default from service bus repo)
    default_retry_backoff_max: int = 120
    domain_format: str = 'kombu%(vhost)s'
    _queue_cache: dict[str, SendReceive] = {}
    _noack_queues: set[str] = set()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        self._namespace = None
        self._policy = None
        self._sas_key = None
        self._connection_string = None

        self._try_parse_connection_string()

        self.qos.restore_at_shutdown = False

    def _try_parse_connection_string(self) -> None:
        self._namespace, self._credential = Transport.parse_uri(
            self.conninfo.hostname)

        if (
            DefaultAzureCredential is not None
            and isinstance(self._credential, DefaultAzureCredential)
        ) or (
            ManagedIdentityCredential is not None
            and isinstance(self._credential, ManagedIdentityCredential)
        ):
            return None

        if ":" in self._credential:
            self._policy, self._sas_key = self._credential.split(':', 1)

        conn_dict = {
            'Endpoint': 'sb://' + self._namespace,
            'SharedAccessKeyName': self._policy,
            'SharedAccessKey': self._sas_key,
        }
        self._connection_string = ';'.join(
            [key + '=' + value for key, value in conn_dict.items()])

    def basic_consume(self, queue, no_ack, *args, **kwargs):
        if no_ack:
            self._noack_queues.add(queue)
        return super().basic_consume(
            queue, no_ack, *args, **kwargs
        )

    def basic_cancel(self, consumer_tag):
        if consumer_tag in self._consumers:
            queue = self._tag_to_queue[consumer_tag]
            self._noack_queues.discard(queue)
        return super().basic_cancel(consumer_tag)

    def _add_queue_to_cache(
            self, name: str,
            receiver: ServiceBusReceiver | None = None,
            sender: ServiceBusSender | None = None
    ) -> SendReceive:
        if name in self._queue_cache:
            obj = self._queue_cache[name]
            obj.sender = obj.sender or sender
            obj.receiver = obj.receiver or receiver
        else:
            obj = SendReceive(receiver, sender)
            self._queue_cache[name] = obj
        return obj

    def _get_asb_sender(self, queue: str) -> SendReceive:
        queue_obj = self._queue_cache.get(queue, None)
        if queue_obj is None or queue_obj.sender is None:
            sender = self.queue_service.get_queue_sender(
                queue, keep_alive=self.uamqp_keep_alive_interval)
            queue_obj = self._add_queue_to_cache(queue, sender=sender)
        return queue_obj

    def _get_asb_receiver(
            self, queue: str,
            recv_mode: ServiceBusReceiveMode = ServiceBusReceiveMode.PEEK_LOCK,
            queue_cache_key: str | None = None) -> SendReceive:
        cache_key = queue_cache_key or queue
        queue_obj = self._queue_cache.get(cache_key, None)
        if queue_obj is None or queue_obj.receiver is None:
            receiver = self.queue_service.get_queue_receiver(
                queue_name=queue, receive_mode=recv_mode,
                keep_alive=self.uamqp_keep_alive_interval)
            queue_obj = self._add_queue_to_cache(cache_key, receiver=receiver)
        return queue_obj

    def entity_name(
            self, name: str, table: dict[int, int] | None = None) -> str:
        """Format AMQP queue name into a valid ServiceBus queue name."""
        return str(safe_str(name)).translate(table or CHARS_REPLACE_TABLE)

    def _restore(self, message: virtual.base.Message) -> None:
        # Not be needed as ASB handles unacked messages
        # Remove 'azure_message' as its not JSON serializable
        # message.delivery_info.pop('azure_message', None)
        # super()._restore(message)
        pass

    def _new_queue(self, queue: str, **kwargs) -> SendReceive:
        """Ensure a queue exists in ServiceBus."""
        queue = self.entity_name(self.queue_name_prefix + queue)

        try:
            return self._queue_cache[queue]
        except KeyError:
            # Converts seconds into ISO8601 duration format
            # ie 66seconds = P1M6S
            lock_duration = isodate.duration_isoformat(
                isodate.Duration(seconds=self.peek_lock_seconds))
            try:
                self.queue_mgmt_service.create_queue(
                    queue_name=queue, lock_duration=lock_duration)
            except azure.core.exceptions.ResourceExistsError:
                pass
            return self._add_queue_to_cache(queue)

    def _delete(self, queue: str, *args, **kwargs) -> None:
        """Delete queue by name."""
        queue = self.entity_name(self.queue_name_prefix + queue)

        self.queue_mgmt_service.delete_queue(queue)
        send_receive_obj = self._queue_cache.pop(queue, None)
        if send_receive_obj:
            send_receive_obj.close()

    def _put(self, queue: str, message, **kwargs) -> None:
        """Put message onto queue."""
        queue = self.entity_name(self.queue_name_prefix + queue)
        msg = ServiceBusMessage(dumps(message))

        queue_obj = self._get_asb_sender(queue)
        queue_obj.sender.send_messages(msg)

    def _get(
            self, queue: str,
            timeout: float | int | None = None
    ) -> dict[str, Any]:
        """Try to retrieve a single message off ``queue``."""
        # If we're not ack'ing for this queue, just change receive_mode
        recv_mode = ServiceBusReceiveMode.RECEIVE_AND_DELETE \
            if queue in self._noack_queues else ServiceBusReceiveMode.PEEK_LOCK

        queue = self.entity_name(self.queue_name_prefix + queue)

        queue_obj = self._get_asb_receiver(queue, recv_mode)
        messages = queue_obj.receiver.receive_messages(
            max_message_count=1,
            max_wait_time=timeout or self.wait_time_seconds)

        if not messages:
            raise Empty()

        # message.body is either byte or generator[bytes]
        message = messages[0]
        if not isinstance(message.body, bytes):
            body = b''.join(message.body)
        else:
            body = message.body

        msg = loads(bytes_to_str(body))
        msg['properties']['delivery_info']['azure_message'] = message
        msg['properties']['delivery_info']['azure_queue_name'] = queue

        return msg

    def basic_ack(self, delivery_tag: str, multiple: bool = False) -> None:
        try:
            delivery_info = self.qos.get(delivery_tag).delivery_info
        except KeyError:
            super().basic_ack(delivery_tag)
        else:
            queue = delivery_info['azure_queue_name']
            # recv_mode is PEEK_LOCK when ack'ing messages
            queue_obj = self._get_asb_receiver(queue)

            try:
                queue_obj.receiver.complete_message(
                    delivery_info['azure_message'])
            except azure.servicebus.exceptions.MessageAlreadySettled:
                super().basic_ack(delivery_tag)
            except Exception:
                super().basic_reject(delivery_tag)
            else:
                super().basic_ack(delivery_tag)

    def _size(self, queue: str) -> int:
        """Return the number of messages in a queue."""
        queue = self.entity_name(self.queue_name_prefix + queue)
        props = self.queue_mgmt_service.get_queue_runtime_properties(queue)

        return props.total_message_count

    def _purge(self, queue) -> int:
        """Delete all current messages in a queue."""
        # Azure doesn't provide a purge api yet
        n = 0
        max_purge_count = 10
        queue = self.entity_name(self.queue_name_prefix + queue)

        # By default all the receivers will be in PEEK_LOCK receive mode
        queue_obj = self._queue_cache.get(queue, None)
        if queue not in self._noack_queues or \
           queue_obj is None or queue_obj.receiver is None:
            queue_obj = self._get_asb_receiver(
                queue,
                ServiceBusReceiveMode.RECEIVE_AND_DELETE, 'purge_' + queue
            )

        while True:
            messages = queue_obj.receiver.receive_messages(
                max_message_count=max_purge_count,
                max_wait_time=0.2
            )
            n += len(messages)

            if len(messages) < max_purge_count:
                break

        return n

    def close(self) -> None:
        # receivers and senders spawn threads so clean them up
        if not self.closed:
            self.closed = True
            for queue_obj in self._queue_cache.values():
                queue_obj.close()
            self._queue_cache.clear()

            if self.connection is not None:
                self.connection.close_channel(self)

    @cached_property
    def queue_service(self) -> ServiceBusClient:
        if self._connection_string:
            return ServiceBusClient.from_connection_string(
                self._connection_string,
                retry_total=self.retry_total,
                retry_backoff_factor=self.retry_backoff_factor,
                retry_backoff_max=self.retry_backoff_max
            )

        return ServiceBusClient(
            self._namespace,
            self._credential,
            retry_total=self.retry_total,
            retry_backoff_factor=self.retry_backoff_factor,
            retry_backoff_max=self.retry_backoff_max
        )

    @cached_property
    def queue_mgmt_service(self) -> ServiceBusAdministrationClient:
        if self._connection_string:
            return ServiceBusAdministrationClient.from_connection_string(
                self._connection_string
            )

        return ServiceBusAdministrationClient(
            self._namespace, self._credential
        )

    @property
    def conninfo(self):
        return self.connection.client

    @property
    def transport_options(self):
        return self.connection.client.transport_options

    @cached_property
    def queue_name_prefix(self) -> str:
        return self.transport_options.get('queue_name_prefix', '')

    @cached_property
    def wait_time_seconds(self) -> int:
        return self.transport_options.get('wait_time_seconds',
                                          self.default_wait_time_seconds)

    @cached_property
    def peek_lock_seconds(self) -> int:
        return min(self.transport_options.get('peek_lock_seconds',
                                              self.default_peek_lock_seconds),
                   300)  # Limit upper bounds to 300

    @cached_property
    def uamqp_keep_alive_interval(self) -> int:
        return self.transport_options.get(
            'uamqp_keep_alive_interval',
            self.default_uamqp_keep_alive_interval
        )

    @cached_property
    def retry_total(self) -> int:
        return self.transport_options.get(
            'retry_total', self.default_retry_total)

    @cached_property
    def retry_backoff_factor(self) -> float:
        return self.transport_options.get(
            'retry_backoff_factor', self.default_retry_backoff_factor)

    @cached_property
    def retry_backoff_max(self) -> int:
        return self.transport_options.get(
            'retry_backoff_max', self.default_retry_backoff_max)


class Transport(virtual.Transport):
    """Azure Service Bus transport."""

    Channel = Channel

    polling_interval = 1
    default_port = None
    can_parse_url = True

    @staticmethod
    def parse_uri(uri: str) -> tuple[str, str | DefaultAzureCredential |
                                     ManagedIdentityCredential]:
        # URL like:
        #  azureservicebus://{SAS policy name}:{SAS key}@{ServiceBus Namespace}
        # urllib parse does not work as the sas key could contain a slash
        # e.g.: azureservicebus://rootpolicy:some/key@somenamespace

        # > 'rootpolicy:some/key@somenamespace'
        uri = uri.replace('azureservicebus://', '')
        # > 'rootpolicy:some/key',  'somenamespace'
        credential, namespace = uri.rsplit('@', 1)

        if not namespace.endswith('.net'):
            namespace += '.servicebus.windows.net'

        if "DefaultAzureCredential".lower() == credential.lower():
            if DefaultAzureCredential is None:
                raise ImportError('Azure Service Bus transport with a '
                                  'DefaultAzureCredential requires the '
                                  'azure-identity library')
            credential = DefaultAzureCredential()
        elif "ManagedIdentityCredential".lower() == credential.lower():
            if ManagedIdentityCredential is None:
                raise ImportError('Azure Service Bus transport with a '
                                  'ManagedIdentityCredential requires the '
                                  'azure-identity library')
            credential = ManagedIdentityCredential()
        else:
            # > 'rootpolicy', 'some/key'
            policy, sas_key = credential.split(':', 1)
            credential = f"{policy}:{sas_key}"

        # Validate ASB connection string
        if not all([namespace, credential]):
            raise ValueError(
                'Need a URI like '
                'azureservicebus://{SAS policy name}:{SAS key}@{ServiceBus Namespace} ' # noqa
                'or the azure Endpoint connection string'
            )

        return namespace, credential

    @classmethod
    def as_uri(cls, uri: str, include_password=False, mask='**') -> str:
        namespace, credential = cls.parse_uri(uri)
        if isinstance(credential, str) and ":" in credential:
            policy, sas_key = credential.split(':', 1)
            return 'azureservicebus://{}:{}@{}'.format(
                policy,
                sas_key if include_password else mask,
                namespace
            )

        return 'azureservicebus://{}@{}'.format(
            credential.__class__.__name__,
            namespace
        )
