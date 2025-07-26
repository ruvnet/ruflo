"""Amazon SQS transport module for Kombu.

This package implements an AMQP-like interface on top of Amazons SQS service,
with the goal of being optimized for high performance and reliability.

The default settings for this module are focused now on high performance in
task queue situations where tasks are small, idempotent and run very fast.

SQS Features supported by this transport
========================================
Long Polling
------------
https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-long-polling.html

Long polling is enabled by setting the `wait_time_seconds` transport
option to a number > 1.  Amazon supports up to 20 seconds.  This is
enabled with 10 seconds by default.

Batch API Actions
-----------------
https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-batch-api.html

The default behavior of the SQS Channel.drain_events() method is to
request up to the 'prefetch_count' messages on every request to SQS.
These messages are stored locally in a deque object and passed back
to the Transport until the deque is empty, before triggering a new
API call to Amazon.

This behavior dramatically speeds up the rate that you can pull tasks
from SQS when you have short-running tasks (or a large number of workers).

When a Celery worker has multiple queues to monitor, it will pull down
up to 'prefetch_count' messages from queueA and work on them all before
moving on to queueB.  If queueB is empty, it will wait up until
'polling_interval' expires before moving back and checking on queueA.

Message Attributes
-----------------
https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-message-metadata.html

SQS supports sending message attributes along with the message body.
To use this feature, you can pass a 'message_attributes' as keyword argument
to `basic_publish` method.

Other Features supported by this transport
==========================================
Predefined Queues
-----------------
The default behavior of this transport is to use a single AWS credential
pair in order to manage all SQS queues (e.g. listing queues, creating
queues, polling queues, deleting messages).

If it is preferable for your environment to use multiple AWS credentials, you
can use the 'predefined_queues' setting inside the 'transport_options' map.
This setting allows you to specify the SQS queue URL and AWS credentials for
each of your queues. For example, if you have two queues which both already
exist in AWS) you can tell this transport about them as follows:

.. code-block:: python

    transport_options = {
      'predefined_queues': {
        'queue-1': {
          'url': 'https://sqs.us-east-1.amazonaws.com/xxx/aaa',
          'access_key_id': 'a',
          'secret_access_key': 'b',
          'backoff_policy': {1: 10, 2: 20, 3: 40, 4: 80, 5: 320, 6: 640}, # optional
          'backoff_tasks': ['svc.tasks.tasks.task1'] # optional
        },
        'queue-2.fifo': {
          'url': 'https://sqs.us-east-1.amazonaws.com/xxx/bbb.fifo',
          'access_key_id': 'c',
          'secret_access_key': 'd',
          'backoff_policy': {1: 10, 2: 20, 3: 40, 4: 80, 5: 320, 6: 640}, # optional
          'backoff_tasks': ['svc.tasks.tasks.task2'] # optional
        },
      }
    'sts_role_arn': 'arn:aws:iam::<xxx>:role/STSTest', # optional
    'sts_token_timeout': 900 # optional
    }

Note that FIFO and standard queues must be named accordingly (the name of
a FIFO queue must end with the .fifo suffix).

backoff_policy & backoff_tasks are optional arguments. These arguments
automatically change the message visibility timeout, in order to have
different times between specific task retries. This would apply after
task failure.

AWS STS authentication is supported, by using sts_role_arn, and
sts_token_timeout. sts_role_arn is the assumed IAM role ARN we are trying
to access with. sts_token_timeout is the token timeout, defaults (and minimum)
to 900 seconds. After the mentioned period, a new token will be created.



If you authenticate using Okta_ (e.g. calling |gac|_), you can also specify
a 'session_token' to connect to a queue. Note that those tokens have a
limited lifetime and are therefore only suited for short-lived tests.

.. _Okta: https://www.okta.com/
.. _gac: https://github.com/Nike-Inc/gimme-aws-creds#readme
.. |gac| replace:: ``gimme-aws-creds``


Client config
-------------
In some cases you may need to override the botocore config. You can do it
as follows:

.. code-block:: python

    transport_option = {
      'client-config': {
          'connect_timeout': 5,
       },
    }

For a complete list of settings you can adjust using this option see
https://botocore.amazonaws.com/v1/documentation/api/latest/reference/config.html

Features
========
* Type: Virtual
* Supports Direct: Yes
* Supports Topic: Yes
* Supports Fanout: Yes
* Supports Priority: No
* Supports TTL: No
"""


from __future__ import annotations

import base64
import socket
import string
import uuid
from datetime import datetime
from queue import Empty

from botocore.client import Config
from botocore.exceptions import ClientError
from vine import ensure_promise, promise, transform

from kombu.asynchronous import get_event_loop
from kombu.asynchronous.aws.ext import boto3, exceptions
from kombu.asynchronous.aws.sqs.connection import AsyncSQSConnection
from kombu.asynchronous.aws.sqs.message import AsyncMessage
from kombu.log import get_logger
from kombu.utils import scheduling
from kombu.utils.encoding import bytes_to_str, safe_str
from kombu.utils.json import dumps, loads
from kombu.utils.objects import cached_property

from . import virtual

logger = get_logger(__name__)

# dots are replaced by dash, dash remains dash, all other punctuation
# replaced by underscore.
CHARS_REPLACE_TABLE = {
    ord(c): 0x5f for c in string.punctuation if c not in '-_.'
}
CHARS_REPLACE_TABLE[0x2e] = 0x2d  # '.' -> '-'

#: SQS bulk get supports a maximum of 10 messages at a time.
SQS_MAX_MESSAGES = 10


def maybe_int(x):
    """Try to convert x' to int, or return x' if that fails."""
    try:
        return int(x)
    except ValueError:
        return x


class UndefinedQueueException(Exception):
    """Predefined queues are being used and an undefined queue was used."""


class InvalidQueueException(Exception):
    """Predefined queues are being used and configuration is not valid."""


class AccessDeniedQueueException(Exception):
    """Raised when access to the AWS queue is denied.

    This may occur if the permissions are not correctly set or the
    credentials are invalid.
    """


class DoesNotExistQueueException(Exception):
    """The specified queue doesn't exist."""


class QoS(virtual.QoS):
    """Quality of Service guarantees implementation for SQS."""

    def reject(self, delivery_tag, requeue=False):
        super().reject(delivery_tag, requeue=requeue)
        routing_key, message, backoff_tasks, backoff_policy = \
            self._extract_backoff_policy_configuration_and_message(
                delivery_tag)
        if routing_key and message and backoff_tasks and backoff_policy:
            self.apply_backoff_policy(
                routing_key, delivery_tag, backoff_policy, backoff_tasks)

    def _extract_backoff_policy_configuration_and_message(self, delivery_tag):
        try:
            message = self._delivered[delivery_tag]
            routing_key = message.delivery_info['routing_key']
        except KeyError:
            return None, None, None, None
        if not routing_key or not message:
            return None, None, None, None
        queue_config = self.channel.predefined_queues.get(routing_key, {})
        backoff_tasks = queue_config.get('backoff_tasks')
        backoff_policy = queue_config.get('backoff_policy')
        return routing_key, message, backoff_tasks, backoff_policy

    def apply_backoff_policy(self, routing_key, delivery_tag,
                             backoff_policy, backoff_tasks):
        queue_url = self.channel._queue_cache[routing_key]
        task_name, number_of_retries = \
            self.extract_task_name_and_number_of_retries(delivery_tag)
        if not task_name or not number_of_retries:
            return None
        policy_value = backoff_policy.get(number_of_retries)
        if task_name in backoff_tasks and policy_value is not None:
            c = self.channel.sqs(routing_key)
            c.change_message_visibility(
                QueueUrl=queue_url,
                ReceiptHandle=delivery_tag,
                VisibilityTimeout=policy_value
            )

    def extract_task_name_and_number_of_retries(self, delivery_tag):
        message = self._delivered[delivery_tag]
        message_headers = message.headers
        task_name = message_headers['task']
        number_of_retries = int(
            message.properties['delivery_info']['sqs_message']
                              ['Attributes']['ApproximateReceiveCount'])
        return task_name, number_of_retries


class Channel(virtual.Channel):
    """SQS Channel."""

    default_region = 'us-east-1'
    default_visibility_timeout = 1800  # 30 minutes.
    default_wait_time_seconds = 10  # up to 20 seconds max
    domain_format = 'kombu%(vhost)s'
    _asynsqs = None
    _predefined_queue_async_clients = {}  # A client for each predefined queue
    _sqs = None
    _predefined_queue_clients = {}  # A client for each predefined queue
    _queue_cache = {}  # SQS queue name => SQS queue URL
    _noack_queues = set()
    QoS = QoS

    def __init__(self, *args, **kwargs):
        if boto3 is None:
            raise ImportError('boto3 is not installed')
        super().__init__(*args, **kwargs)
        self._validate_predifined_queues()

        # SQS blows up if you try to create a new queue when one already
        # exists but with a different visibility_timeout.  This prepopulates
        # the queue_cache to protect us from recreating
        # queues that are known to already exist.
        self._update_queue_cache(self.queue_name_prefix)

        self.hub = kwargs.get('hub') or get_event_loop()

    def _validate_predifined_queues(self):
        """Check that standard and FIFO queues are named properly.

        AWS requires FIFO queues to have a name
        that ends with the .fifo suffix.
        """
        for queue_name, q in self.predefined_queues.items():
            fifo_url = q['url'].endswith('.fifo')
            fifo_name = queue_name.endswith('.fifo')
            if fifo_url and not fifo_name:
                raise InvalidQueueException(
                    "Queue with url '{}' must have a name "
                    "ending with .fifo".format(q['url'])
                )
            elif not fifo_url and fifo_name:
                raise InvalidQueueException(
                    "Queue with name '{}' is not a FIFO queue: "
                    "'{}'".format(queue_name, q['url'])
                )

    def _update_queue_cache(self, queue_name_prefix):
        if self.predefined_queues:
            for queue_name, q in self.predefined_queues.items():
                self._queue_cache[queue_name] = q['url']
            return

        resp = self.sqs().list_queues(QueueNamePrefix=queue_name_prefix)
        for url in resp.get('QueueUrls', []):
            queue_name = url.split('/')[-1]
            self._queue_cache[queue_name] = url

    def basic_consume(self, queue, no_ack, *args, **kwargs):
        if no_ack:
            self._noack_queues.add(queue)
        if self.hub:
            self._loop1(queue)
        return super().basic_consume(
            queue, no_ack, *args, **kwargs
        )

    def basic_cancel(self, consumer_tag):
        if consumer_tag in self._consumers:
            queue = self._tag_to_queue[consumer_tag]
            self._noack_queues.discard(queue)
        return super().basic_cancel(consumer_tag)

    def drain_events(self, timeout=None, callback=None, **kwargs):
        """Return a single payload message from one of our queues.

        Raises
        ------
            Queue.Empty: if no messages available.
        """
        # If we're not allowed to consume or have no consumers, raise Empty
        if not self._consumers or not self.qos.can_consume():
            raise Empty()

        # At this point, go and get more messages from SQS
        self._poll(self.cycle, callback, timeout=timeout)

    def _reset_cycle(self):
        """Reset the consume cycle.

        Returns
        -------
            FairCycle: object that points to our _get_bulk() method
                rather than the standard _get() method.  This allows for
                multiple messages to be returned at once from SQS (
                based on the prefetch limit).
        """
        self._cycle = scheduling.FairCycle(
            self._get_bulk, self._active_queues, Empty,
        )

    def entity_name(self, name, table=CHARS_REPLACE_TABLE):
        """Format AMQP queue name into a legal SQS queue name."""
        if name.endswith('.fifo'):
            partial = name[:-len('.fifo')]
            partial = str(safe_str(partial)).translate(table)
            return partial + '.fifo'
        else:
            return str(safe_str(name)).translate(table)

    def canonical_queue_name(self, queue_name):
        return self.entity_name(self.queue_name_prefix + queue_name)

    def _resolve_queue_url(self, queue):
        """Try to retrieve the SQS queue URL for a given queue name."""
        # Translate to SQS name for consistency with initial
        # _queue_cache population.
        sqs_qname = self.canonical_queue_name(queue)

        # The SQS ListQueues method only returns 1000 queues.  When you have
        # so many queues, it's possible that the queue you are looking for is
        # not cached.  In this case, we could update the cache with the exact
        # queue name first.
        if sqs_qname not in self._queue_cache:
            self._update_queue_cache(sqs_qname)
        try:
            return self._queue_cache[sqs_qname]
        except KeyError:
            if self.predefined_queues:
                raise UndefinedQueueException((
                    "Queue with name '{}' must be "
                    "defined in 'predefined_queues'."
                ).format(sqs_qname))

            raise DoesNotExistQueueException(
                f"Queue with name '{sqs_qname}' doesn't exist in SQS"
            )

    def _new_queue(self, queue, **kwargs):
        """Ensure a queue with given name exists in SQS.

        Arguments:
        ---------
            queue (str): the AMQP queue name
        Returns
            str: the SQS queue URL
        """
        try:
            return self._resolve_queue_url(queue)
        except DoesNotExistQueueException:
            sqs_qname = self.canonical_queue_name(queue)
            attributes = {'VisibilityTimeout': str(self.visibility_timeout)}
            if sqs_qname.endswith('.fifo'):
                attributes['FifoQueue'] = 'true'

            resp = self._create_queue(sqs_qname, attributes)
            self._queue_cache[sqs_qname] = resp['QueueUrl']
            return resp['QueueUrl']

    def _create_queue(self, queue_name, attributes):
        """Create an SQS queue with a given name and nominal attributes."""
        # Allow specifying additional boto create_queue Attributes
        # via transport options
        if self.predefined_queues:
            return None

        attributes.update(
            self.transport_options.get('sqs-creation-attributes') or {},
        )

        return self.sqs(queue=queue_name).create_queue(
            QueueName=queue_name,
            Attributes=attributes,
        )

    def _delete(self, queue, *args, **kwargs):
        """Delete queue by name."""
        if self.predefined_queues:
            return

        q_url = self._resolve_queue_url(queue)
        self.sqs().delete_queue(
            QueueUrl=q_url,
        )
        self._queue_cache.pop(queue, None)

    def _put(self, queue, message, **kwargs):
        """Put message onto queue."""
        q_url = self._new_queue(queue)
        kwargs = {'QueueUrl': q_url}
        if 'properties' in message:
            if 'message_attributes' in message['properties']:
                # we don't want to want to have the attribute in the body
                kwargs['MessageAttributes'] = \
                    message['properties'].pop('message_attributes')
            if queue.endswith('.fifo'):
                if 'MessageGroupId' in message['properties']:
                    kwargs['MessageGroupId'] = \
                        message['properties']['MessageGroupId']
                else:
                    kwargs['MessageGroupId'] = 'default'
                if 'MessageDeduplicationId' in message['properties']:
                    kwargs['MessageDeduplicationId'] = \
                        message['properties']['MessageDeduplicationId']
                else:
                    kwargs['MessageDeduplicationId'] = str(uuid.uuid4())
            else:
                if "DelaySeconds" in message['properties']:
                    kwargs['DelaySeconds'] = \
                        message['properties']['DelaySeconds']

        if self.sqs_base64_encoding:
            body = AsyncMessage().encode(dumps(message))
        else:
            body = dumps(message)
        kwargs['MessageBody'] = body

        c = self.sqs(queue=self.canonical_queue_name(queue))
        if message.get('redelivered'):
            c.change_message_visibility(
                QueueUrl=q_url,
                ReceiptHandle=message['properties']['delivery_tag'],
                VisibilityTimeout=0
            )
        else:
            c.send_message(**kwargs)

    @staticmethod
    def _optional_b64_decode(byte_string):
        try:
            data = base64.b64decode(byte_string)
            if base64.b64encode(data) == byte_string:
                return data
            # else the base64 module found some embedded base64 content
            # that should be ignored.
        except Exception:  # pylint: disable=broad-except
            pass
        return byte_string

    def _message_to_python(self, message, queue_name, q_url):
        body = self._optional_b64_decode(message['Body'].encode())
        payload = loads(bytes_to_str(body))
        if queue_name in self._noack_queues:
            q_url = self._new_queue(queue_name)
            self.asynsqs(queue=queue_name).delete_message(
                q_url,
                message['ReceiptHandle'],
            )
        else:
            try:
                properties = payload['properties']
                delivery_info = payload['properties']['delivery_info']
            except KeyError:
                # json message not sent by kombu?
                delivery_info = {}
                properties = {'delivery_info': delivery_info}
                payload.update({
                    'body': bytes_to_str(body),
                    'properties': properties,
                })
            # set delivery tag to SQS receipt handle
            delivery_info.update({
                'sqs_message': message, 'sqs_queue': q_url,
            })
            properties['delivery_tag'] = message['ReceiptHandle']
        return payload

    def _messages_to_python(self, messages, queue):
        """Convert a list of SQS Message objects into Payloads.

        This method handles converting SQS Message objects into
        Payloads, and appropriately updating the queue depending on
        the 'ack' settings for that queue.

        Arguments:
        ---------
            messages (SQSMessage): A list of SQS Message objects.
            queue (str): Name representing the queue they came from.

        Returns
        -------
            List: A list of Payload objects
        """
        q_url = self._new_queue(queue)
        return [self._message_to_python(m, queue, q_url) for m in messages]

    def _get_bulk(self, queue,
                  max_if_unlimited=SQS_MAX_MESSAGES, callback=None):
        """Try to retrieve multiple messages off ``queue``.

        Where :meth:`_get` returns a single Payload object, this method
        returns a list of Payload objects.  The number of objects returned
        is determined by the total number of messages available in the queue
        and the number of messages the QoS object allows (based on the
        prefetch_count).

        Note:
        ----
            Ignores QoS limits so caller is responsible for checking
            that we are allowed to consume at least one message from the
            queue.  get_bulk will then ask QoS for an estimate of
            the number of extra messages that we can consume.

        Arguments:
        ---------
            queue (str): The queue name to pull from.

        Returns
        -------
            List[Message]
        """
        # drain_events calls `can_consume` first, consuming
        # a token, so we know that we are allowed to consume at least
        # one message.

        # Note: ignoring max_messages for SQS with boto3
        max_count = self._get_message_estimate()
        if max_count:
            q_url = self._new_queue(queue)
            resp = self.sqs(queue=queue).receive_message(
                QueueUrl=q_url, MaxNumberOfMessages=max_count,
                WaitTimeSeconds=self.wait_time_seconds)
            if resp.get('Messages'):
                for m in resp['Messages']:
                    m['Body'] = AsyncMessage(body=m['Body']).decode()
                for msg in self._messages_to_python(resp['Messages'], queue):
                    self.connection._deliver(msg, queue)
                return
        raise Empty()

    def _get(self, queue):
        """Try to retrieve a single message off ``queue``."""
        q_url = self._new_queue(queue)
        resp = self.sqs(queue=queue).receive_message(
            QueueUrl=q_url, MaxNumberOfMessages=1,
            WaitTimeSeconds=self.wait_time_seconds)
        if resp.get('Messages'):
            body = AsyncMessage(body=resp['Messages'][0]['Body']).decode()
            resp['Messages'][0]['Body'] = body
            return self._messages_to_python(resp['Messages'], queue)[0]
        raise Empty()

    def _loop1(self, queue, _=None):
        self.hub.call_soon(self._schedule_queue, queue)

    def _schedule_queue(self, queue):
        if queue in self._active_queues:
            if self.qos.can_consume():
                self._get_bulk_async(
                    queue, callback=promise(self._loop1, (queue,)),
                )
            else:
                self._loop1(queue)

    def _get_message_estimate(self, max_if_unlimited=SQS_MAX_MESSAGES):
        maxcount = self.qos.can_consume_max_estimate()
        return min(
            max_if_unlimited if maxcount is None else max(maxcount, 1),
            max_if_unlimited,
        )

    def _get_bulk_async(self, queue,
                        max_if_unlimited=SQS_MAX_MESSAGES, callback=None):
        maxcount = self._get_message_estimate()
        if maxcount:
            return self._get_async(queue, maxcount, callback=callback)
        # Not allowed to consume, make sure to notify callback..
        callback = ensure_promise(callback)
        callback([])
        return callback

    def _get_async(self, queue, count=1, callback=None):
        q_url = self._new_queue(queue)
        qname = self.canonical_queue_name(queue)
        return self._get_from_sqs(
            queue_name=qname, queue_url=q_url, count=count,
            connection=self.asynsqs(queue=qname),
            callback=transform(
                self._on_messages_ready, callback, q_url, queue
            ),
        )

    def _on_messages_ready(self, queue, qname, messages):
        if 'Messages' in messages and messages['Messages']:
            callbacks = self.connection._callbacks
            for msg in messages['Messages']:
                msg_parsed = self._message_to_python(msg, qname, queue)
                callbacks[qname](msg_parsed)

    def _get_from_sqs(self, queue_name, queue_url,
                      connection, count=1, callback=None):
        """Retrieve and handle messages from SQS.

        Uses long polling and returns :class:`~vine.promises.promise`.
        """
        return connection.receive_message(
            queue_name, queue_url, number_messages=count,
            wait_time_seconds=self.wait_time_seconds,
            callback=callback,
        )

    def _restore(self, message,
                 unwanted_delivery_info=('sqs_message', 'sqs_queue')):
        for unwanted_key in unwanted_delivery_info:
            # Remove objects that aren't JSON serializable (Issue #1108).
            message.delivery_info.pop(unwanted_key, None)
        return super()._restore(message)

    def basic_ack(self, delivery_tag, multiple=False):
        try:
            message = self.qos.get(delivery_tag).delivery_info
            sqs_message = message['sqs_message']
        except KeyError:
            super().basic_ack(delivery_tag)
        else:
            queue = None
            if 'routing_key' in message:
                queue = self.canonical_queue_name(message['routing_key'])

            try:
                self.sqs(queue=queue).delete_message(
                    QueueUrl=message['sqs_queue'],
                    ReceiptHandle=sqs_message['ReceiptHandle']
                )
            except ClientError as exception:
                if exception.response['Error']['Code'] == 'AccessDenied':
                    raise AccessDeniedQueueException(
                        exception.response["Error"]["Message"]
                        )
                super().basic_reject(delivery_tag)
            else:
                super().basic_ack(delivery_tag)

    def _size(self, queue):
        """Return the number of messages in a queue."""
        q_url = self._new_queue(queue)
        c = self.sqs(queue=self.canonical_queue_name(queue))
        resp = c.get_queue_attributes(
            QueueUrl=q_url,
            AttributeNames=['ApproximateNumberOfMessages'])
        return int(resp['Attributes']['ApproximateNumberOfMessages'])

    def _purge(self, queue):
        """Delete all current messages in a queue."""
        q_url = self._new_queue(queue)
        # SQS is slow at registering messages, so run for a few
        # iterations to ensure messages are detected and deleted.
        size = 0
        for i in range(10):
            size += int(self._size(queue))
            if not size:
                break
        self.sqs(queue=queue).purge_queue(QueueUrl=q_url)
        return size

    def close(self):
        super().close()
        # if self._asynsqs:
        #     try:
        #         self.asynsqs().close()
        #     except AttributeError as exc:  # FIXME ???
        #         if "can't set attribute" not in str(exc):
        #             raise

    def new_sqs_client(self, region, access_key_id,
                       secret_access_key, session_token=None):
        session = boto3.session.Session(
            region_name=region,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            aws_session_token=session_token,
        )
        is_secure = self.is_secure if self.is_secure is not None else True
        client_kwargs = {
            'use_ssl': is_secure
        }
        if self.endpoint_url is not None:
            client_kwargs['endpoint_url'] = self.endpoint_url
        client_config = self.transport_options.get('client-config') or {}
        config = Config(**client_config)
        return session.client('sqs', config=config, **client_kwargs)

    def sqs(self, queue=None):
        if queue is not None and self.predefined_queues:

            if queue not in self.predefined_queues:
                raise UndefinedQueueException(
                    f"Queue with name '{queue}' must be defined"
                    " in 'predefined_queues'.")
            q = self.predefined_queues[queue]
            if self.transport_options.get('sts_role_arn'):
                return self._handle_sts_session(queue, q)
            if not self.transport_options.get('sts_role_arn'):
                if queue in self._predefined_queue_clients:
                    return self._predefined_queue_clients[queue]
                else:
                    c = self._predefined_queue_clients[queue] = \
                        self.new_sqs_client(
                            region=q.get('region', self.region),
                            access_key_id=q.get(
                                'access_key_id', self.conninfo.userid),
                            secret_access_key=q.get(
                                'secret_access_key', self.conninfo.password)
                    )
                    return c

        if self._sqs is not None:
            return self._sqs

        c = self._sqs = self.new_sqs_client(
            region=self.region,
            access_key_id=self.conninfo.userid,
            secret_access_key=self.conninfo.password,
        )
        return c

    def _handle_sts_session(self, queue, q):
        region = q.get('region', self.region)
        if not hasattr(self, 'sts_expiration'):  # STS token - token init
            return self._new_predefined_queue_client_with_sts_session(queue, region)
        # STS token - refresh if expired
        elif self.sts_expiration.replace(tzinfo=None) < datetime.utcnow():
            return self._new_predefined_queue_client_with_sts_session(queue, region)
        else:  # STS token - ruse existing
            if queue not in self._predefined_queue_clients:
                return self._new_predefined_queue_client_with_sts_session(queue, region)
            return self._predefined_queue_clients[queue]

    def _new_predefined_queue_client_with_sts_session(self, queue, region):
        sts_creds = self.generate_sts_session_token(
            self.transport_options.get('sts_role_arn'),
            self.transport_options.get('sts_token_timeout', 900))
        self.sts_expiration = sts_creds['Expiration']
        c = self._predefined_queue_clients[queue] = self.new_sqs_client(
            region=region,
            access_key_id=sts_creds['AccessKeyId'],
            secret_access_key=sts_creds['SecretAccessKey'],
            session_token=sts_creds['SessionToken'],
        )
        return c

    def generate_sts_session_token(self, role_arn, token_expiry_seconds):
        sts_client = boto3.client('sts')
        sts_policy = sts_client.assume_role(
            RoleArn=role_arn,
            RoleSessionName='Celery',
            DurationSeconds=token_expiry_seconds
        )
        return sts_policy['Credentials']

    def asynsqs(self, queue=None):
        if queue is not None and self.predefined_queues:
            if queue in self._predefined_queue_async_clients and \
               not hasattr(self, 'sts_expiration'):
                return self._predefined_queue_async_clients[queue]
            if queue not in self.predefined_queues:
                raise UndefinedQueueException((
                    "Queue with name '{}' must be defined in "
                    "'predefined_queues'."
                ).format(queue))
            q = self.predefined_queues[queue]
            c = self._predefined_queue_async_clients[queue] = \
                AsyncSQSConnection(
                    sqs_connection=self.sqs(queue=queue),
                    region=q.get('region', self.region),
                    fetch_message_attributes=self.fetch_message_attributes,
            )
            return c

        if self._asynsqs is not None:
            return self._asynsqs

        c = self._asynsqs = AsyncSQSConnection(
            sqs_connection=self.sqs(queue=queue),
            region=self.region,
            fetch_message_attributes=self.fetch_message_attributes,
        )
        return c

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
    def predefined_queues(self):
        """Map of queue_name to predefined queue settings."""
        return self.transport_options.get('predefined_queues', {})

    @cached_property
    def queue_name_prefix(self):
        return self.transport_options.get('queue_name_prefix', '')

    @cached_property
    def supports_fanout(self):
        return False

    @cached_property
    def region(self):
        return (self.transport_options.get('region') or
                boto3.Session().region_name or
                self.default_region)

    @cached_property
    def regioninfo(self):
        return self.transport_options.get('regioninfo')

    @cached_property
    def is_secure(self):
        return self.transport_options.get('is_secure')

    @cached_property
    def port(self):
        return self.transport_options.get('port')

    @cached_property
    def endpoint_url(self):
        if self.conninfo.hostname is not None:
            scheme = 'https' if self.is_secure else 'http'
            if self.conninfo.port is not None:
                port = f':{self.conninfo.port}'
            else:
                port = ''
            return '{}://{}{}'.format(
                scheme,
                self.conninfo.hostname,
                port
            )

    @cached_property
    def wait_time_seconds(self):
        return self.transport_options.get('wait_time_seconds',
                                          self.default_wait_time_seconds)

    @cached_property
    def sqs_base64_encoding(self):
        return self.transport_options.get('sqs_base64_encoding', True)

    @cached_property
    def fetch_message_attributes(self):
        return self.transport_options.get('fetch_message_attributes')


class Transport(virtual.Transport):
    """SQS Transport.

    Additional queue attributes can be supplied to SQS during queue
    creation by passing an ``sqs-creation-attributes`` key in
    transport_options. ``sqs-creation-attributes`` must be a dict whose
    key-value pairs correspond with Attributes in the
    `CreateQueue SQS API`_.

    For example, to have SQS queues created with server-side encryption
    enabled using the default Amazon Managed Customer Master Key, you
    can set ``KmsMasterKeyId`` Attribute. When the queue is initially
    created by Kombu, encryption will be enabled.

    .. code-block:: python

        from kombu.transport.SQS import Transport

        transport = Transport(
            ...,
            transport_options={
                'sqs-creation-attributes': {
                    'KmsMasterKeyId': 'alias/aws/sqs',
                },
            }
        )

    .. _CreateQueue SQS API: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_CreateQueue.html#API_CreateQueue_RequestParameters

    The ``ApproximateReceiveCount`` message attribute is fetched by this
    transport by default. Requested message attributes can be changed by
    setting ``fetch_message_attributes`` in the transport options.

    .. code-block:: python

        from kombu.transport.SQS import Transport

        transport = Transport(
            ...,
            transport_options={
                'fetch_message_attributes': ["All"],
            }
        )

    .. _Message Attributes: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ReceiveMessage.html#SQS-ReceiveMessage-request-AttributeNames

    """  # noqa: E501

    Channel = Channel

    polling_interval = 1
    wait_time_seconds = 0
    default_port = None
    connection_errors = (
        virtual.Transport.connection_errors +
        (exceptions.BotoCoreError, socket.error)
    )
    channel_errors = (
        virtual.Transport.channel_errors + (exceptions.BotoCoreError,)
    )
    driver_type = 'sqs'
    driver_name = 'sqs'

    implements = virtual.Transport.implements.extend(
        asynchronous=True,
        exchange_type=frozenset(['direct']),
    )

    @property
    def default_connection_params(self):
        return {'port': self.default_port}
