# Copyright The OpenTelemetry Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from enum import Enum
from typing import Final

MESSAGING_BATCH_MESSAGE_COUNT: Final = "messaging.batch.message_count"
"""
The number of messages sent, received, or processed in the scope of the batching operation.
Note: Instrumentations SHOULD NOT set `messaging.batch.message_count` on spans that operate with a single message. When a messaging client library supports both batch and single-message API for the same operation, instrumentations SHOULD use `messaging.batch.message_count` for batching APIs and SHOULD NOT use it for single-message APIs.
"""

MESSAGING_CLIENT_ID: Final = "messaging.client.id"
"""
A unique identifier for the client that consumes or produces a message.
"""

MESSAGING_CONSUMER_GROUP_NAME: Final = "messaging.consumer.group.name"
"""
The name of the consumer group with which a consumer is associated.
Note: Semantic conventions for individual messaging systems SHOULD document whether `messaging.consumer.group.name` is applicable and what it means in the context of that system.
"""

MESSAGING_DESTINATION_ANONYMOUS: Final = "messaging.destination.anonymous"
"""
A boolean that is true if the message destination is anonymous (could be unnamed or have auto-generated name).
"""

MESSAGING_DESTINATION_NAME: Final = "messaging.destination.name"
"""
The message destination name.
Note: Destination name SHOULD uniquely identify a specific queue, topic or other entity within the broker. If
the broker doesn't have such notion, the destination name SHOULD uniquely identify the broker.
"""

MESSAGING_DESTINATION_PARTITION_ID: Final = (
    "messaging.destination.partition.id"
)
"""
The identifier of the partition messages are sent to or received from, unique within the `messaging.destination.name`.
"""

MESSAGING_DESTINATION_SUBSCRIPTION_NAME: Final = (
    "messaging.destination.subscription.name"
)
"""
The name of the destination subscription from which a message is consumed.
Note: Semantic conventions for individual messaging systems SHOULD document whether `messaging.destination.subscription.name` is applicable and what it means in the context of that system.
"""

MESSAGING_DESTINATION_TEMPLATE: Final = "messaging.destination.template"
"""
Low cardinality representation of the messaging destination name.
Note: Destination names could be constructed from templates. An example would be a destination name involving a user name or product id. Although the destination name in this case is of high cardinality, the underlying template is of low cardinality and can be effectively used for grouping and aggregation.
"""

MESSAGING_DESTINATION_TEMPORARY: Final = "messaging.destination.temporary"
"""
A boolean that is true if the message destination is temporary and might not exist anymore after messages are processed.
"""

MESSAGING_DESTINATION_PUBLISH_ANONYMOUS: Final = (
    "messaging.destination_publish.anonymous"
)
"""
Deprecated: Removed. No replacement at this time.
"""

MESSAGING_DESTINATION_PUBLISH_NAME: Final = (
    "messaging.destination_publish.name"
)
"""
Deprecated: Removed. No replacement at this time.
"""

MESSAGING_EVENTHUBS_CONSUMER_GROUP: Final = (
    "messaging.eventhubs.consumer.group"
)
"""
Deprecated: Replaced by `messaging.consumer.group.name`.
"""

MESSAGING_EVENTHUBS_MESSAGE_ENQUEUED_TIME: Final = (
    "messaging.eventhubs.message.enqueued_time"
)
"""
The UTC epoch seconds at which the message has been accepted and stored in the entity.
"""

MESSAGING_GCP_PUBSUB_MESSAGE_ACK_DEADLINE: Final = (
    "messaging.gcp_pubsub.message.ack_deadline"
)
"""
The ack deadline in seconds set for the modify ack deadline request.
"""

MESSAGING_GCP_PUBSUB_MESSAGE_ACK_ID: Final = (
    "messaging.gcp_pubsub.message.ack_id"
)
"""
The ack id for a given message.
"""

MESSAGING_GCP_PUBSUB_MESSAGE_DELIVERY_ATTEMPT: Final = (
    "messaging.gcp_pubsub.message.delivery_attempt"
)
"""
The delivery attempt for a given message.
"""

MESSAGING_GCP_PUBSUB_MESSAGE_ORDERING_KEY: Final = (
    "messaging.gcp_pubsub.message.ordering_key"
)
"""
The ordering key for a given message. If the attribute is not present, the message does not have an ordering key.
"""

MESSAGING_KAFKA_CONSUMER_GROUP: Final = "messaging.kafka.consumer.group"
"""
Deprecated: Replaced by `messaging.consumer.group.name`.
"""

MESSAGING_KAFKA_DESTINATION_PARTITION: Final = (
    "messaging.kafka.destination.partition"
)
"""
Deprecated: Replaced by `messaging.destination.partition.id`.
"""

MESSAGING_KAFKA_MESSAGE_KEY: Final = "messaging.kafka.message.key"
"""
Message keys in Kafka are used for grouping alike messages to ensure they're processed on the same partition. They differ from `messaging.message.id` in that they're not unique. If the key is `null`, the attribute MUST NOT be set.
Note: If the key type is not string, it's string representation has to be supplied for the attribute. If the key has no unambiguous, canonical string form, don't include its value.
"""

MESSAGING_KAFKA_MESSAGE_OFFSET: Final = "messaging.kafka.message.offset"
"""
Deprecated: Replaced by `messaging.kafka.offset`.
"""

MESSAGING_KAFKA_MESSAGE_TOMBSTONE: Final = "messaging.kafka.message.tombstone"
"""
A boolean that is true if the message is a tombstone.
"""

MESSAGING_KAFKA_OFFSET: Final = "messaging.kafka.offset"
"""
The offset of a record in the corresponding Kafka partition.
"""

MESSAGING_MESSAGE_BODY_SIZE: Final = "messaging.message.body.size"
"""
The size of the message body in bytes.
Note: This can refer to both the compressed or uncompressed body size. If both sizes are known, the uncompressed
body size should be used.
"""

MESSAGING_MESSAGE_CONVERSATION_ID: Final = "messaging.message.conversation_id"
"""
The conversation ID identifying the conversation to which the message belongs, represented as a string. Sometimes called "Correlation ID".
"""

MESSAGING_MESSAGE_ENVELOPE_SIZE: Final = "messaging.message.envelope.size"
"""
The size of the message body and metadata in bytes.
Note: This can refer to both the compressed or uncompressed size. If both sizes are known, the uncompressed
size should be used.
"""

MESSAGING_MESSAGE_ID: Final = "messaging.message.id"
"""
A value used by the messaging system as an identifier for the message, represented as a string.
"""

MESSAGING_OPERATION: Final = "messaging.operation"
"""
Deprecated: Replaced by `messaging.operation.type`.
"""

MESSAGING_OPERATION_NAME: Final = "messaging.operation.name"
"""
The system-specific name of the messaging operation.
"""

MESSAGING_OPERATION_TYPE: Final = "messaging.operation.type"
"""
A string identifying the type of the messaging operation.
Note: If a custom value is used, it MUST be of low cardinality.
"""

MESSAGING_RABBITMQ_DESTINATION_ROUTING_KEY: Final = (
    "messaging.rabbitmq.destination.routing_key"
)
"""
RabbitMQ message routing key.
"""

MESSAGING_RABBITMQ_MESSAGE_DELIVERY_TAG: Final = (
    "messaging.rabbitmq.message.delivery_tag"
)
"""
RabbitMQ message delivery tag.
"""

MESSAGING_ROCKETMQ_CLIENT_GROUP: Final = "messaging.rocketmq.client_group"
"""
Deprecated: Replaced by `messaging.consumer.group.name` on the consumer spans. No replacement for producer spans.
"""

MESSAGING_ROCKETMQ_CONSUMPTION_MODEL: Final = (
    "messaging.rocketmq.consumption_model"
)
"""
Model of message consumption. This only applies to consumer spans.
"""

MESSAGING_ROCKETMQ_MESSAGE_DELAY_TIME_LEVEL: Final = (
    "messaging.rocketmq.message.delay_time_level"
)
"""
The delay time level for delay message, which determines the message delay time.
"""

MESSAGING_ROCKETMQ_MESSAGE_DELIVERY_TIMESTAMP: Final = (
    "messaging.rocketmq.message.delivery_timestamp"
)
"""
The timestamp in milliseconds that the delay message is expected to be delivered to consumer.
"""

MESSAGING_ROCKETMQ_MESSAGE_GROUP: Final = "messaging.rocketmq.message.group"
"""
It is essential for FIFO message. Messages that belong to the same message group are always processed one by one within the same consumer group.
"""

MESSAGING_ROCKETMQ_MESSAGE_KEYS: Final = "messaging.rocketmq.message.keys"
"""
Key(s) of message, another way to mark message besides message id.
"""

MESSAGING_ROCKETMQ_MESSAGE_TAG: Final = "messaging.rocketmq.message.tag"
"""
The secondary classifier of message besides topic.
"""

MESSAGING_ROCKETMQ_MESSAGE_TYPE: Final = "messaging.rocketmq.message.type"
"""
Type of message.
"""

MESSAGING_ROCKETMQ_NAMESPACE: Final = "messaging.rocketmq.namespace"
"""
Namespace of RocketMQ resources, resources in different namespaces are individual.
"""

MESSAGING_SERVICEBUS_DESTINATION_SUBSCRIPTION_NAME: Final = (
    "messaging.servicebus.destination.subscription_name"
)
"""
Deprecated: Replaced by `messaging.destination.subscription.name`.
"""

MESSAGING_SERVICEBUS_DISPOSITION_STATUS: Final = (
    "messaging.servicebus.disposition_status"
)
"""
Describes the [settlement type](https://learn.microsoft.com/azure/service-bus-messaging/message-transfers-locks-settlement#peeklock).
"""

MESSAGING_SERVICEBUS_MESSAGE_DELIVERY_COUNT: Final = (
    "messaging.servicebus.message.delivery_count"
)
"""
Number of deliveries that have been attempted for this message.
"""

MESSAGING_SERVICEBUS_MESSAGE_ENQUEUED_TIME: Final = (
    "messaging.servicebus.message.enqueued_time"
)
"""
The UTC epoch seconds at which the message has been accepted and stored in the entity.
"""

MESSAGING_SYSTEM: Final = "messaging.system"
"""
The messaging system as identified by the client instrumentation.
Note: The actual messaging system may differ from the one known by the client. For example, when using Kafka client libraries to communicate with Azure Event Hubs, the `messaging.system` is set to `kafka` based on the instrumentation's best knowledge.
"""


class MessagingOperationTypeValues(Enum):
    CREATE = "create"
    """A message is created. "Create" spans always refer to a single message and are used to provide a unique creation context for messages in batch sending scenarios."""
    SEND = "send"
    """One or more messages are provided for sending to an intermediary. If a single message is sent, the context of the "Send" span can be used as the creation context and no "Create" span needs to be created."""
    RECEIVE = "receive"
    """One or more messages are requested by a consumer. This operation refers to pull-based scenarios, where consumers explicitly call methods of messaging SDKs to receive messages."""
    PROCESS = "process"
    """One or more messages are processed by a consumer."""
    SETTLE = "settle"
    """One or more messages are settled."""
    DELIVER = "deliver"
    """Deprecated: Replaced by `process`."""
    PUBLISH = "publish"
    """Deprecated: Replaced by `send`."""


class MessagingRocketmqConsumptionModelValues(Enum):
    CLUSTERING = "clustering"
    """Clustering consumption model."""
    BROADCASTING = "broadcasting"
    """Broadcasting consumption model."""


class MessagingRocketmqMessageTypeValues(Enum):
    NORMAL = "normal"
    """Normal message."""
    FIFO = "fifo"
    """FIFO message."""
    DELAY = "delay"
    """Delay message."""
    TRANSACTION = "transaction"
    """Transaction message."""


class MessagingServicebusDispositionStatusValues(Enum):
    COMPLETE = "complete"
    """Message is completed."""
    ABANDON = "abandon"
    """Message is abandoned."""
    DEAD_LETTER = "dead_letter"
    """Message is sent to dead letter queue."""
    DEFER = "defer"
    """Message is deferred."""


class MessagingSystemValues(Enum):
    ACTIVEMQ = "activemq"
    """Apache ActiveMQ."""
    AWS_SQS = "aws_sqs"
    """Amazon Simple Queue Service (SQS)."""
    EVENTGRID = "eventgrid"
    """Azure Event Grid."""
    EVENTHUBS = "eventhubs"
    """Azure Event Hubs."""
    SERVICEBUS = "servicebus"
    """Azure Service Bus."""
    GCP_PUBSUB = "gcp_pubsub"
    """Google Cloud Pub/Sub."""
    JMS = "jms"
    """Java Message Service."""
    KAFKA = "kafka"
    """Apache Kafka."""
    RABBITMQ = "rabbitmq"
    """RabbitMQ."""
    ROCKETMQ = "rocketmq"
    """Apache RocketMQ."""
    PULSAR = "pulsar"
    """Apache Pulsar."""
