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


from typing import Final

from opentelemetry.metrics import Counter, Histogram, Meter

MESSAGING_CLIENT_CONSUMED_MESSAGES: Final = (
    "messaging.client.consumed.messages"
)
"""
Number of messages that were delivered to the application
Instrument: counter
Unit: {message}
Note: Records the number of messages pulled from the broker or number of messages dispatched to the application in push-based scenarios.
The metric SHOULD be reported once per message delivery. For example, if receiving and processing operations are both instrumented for a single message delivery, this counter is incremented when the message is received and not reported when it is processed.
"""


def create_messaging_client_consumed_messages(meter: Meter) -> Counter:
    """Number of messages that were delivered to the application"""
    return meter.create_counter(
        name=MESSAGING_CLIENT_CONSUMED_MESSAGES,
        description="Number of messages that were delivered to the application.",
        unit="{message}",
    )


MESSAGING_CLIENT_OPERATION_DURATION: Final = (
    "messaging.client.operation.duration"
)
"""
Duration of messaging operation initiated by a producer or consumer client
Instrument: histogram
Unit: s
Note: This metric SHOULD NOT be used to report processing duration - processing duration is reported in `messaging.process.duration` metric.
"""


def create_messaging_client_operation_duration(meter: Meter) -> Histogram:
    """Duration of messaging operation initiated by a producer or consumer client"""
    return meter.create_histogram(
        name=MESSAGING_CLIENT_OPERATION_DURATION,
        description="Duration of messaging operation initiated by a producer or consumer client.",
        unit="s",
    )


MESSAGING_CLIENT_PUBLISHED_MESSAGES: Final = (
    "messaging.client.published.messages"
)
"""
Deprecated: Replaced by `messaging.client.sent.messages`.
"""


def create_messaging_client_published_messages(meter: Meter) -> Counter:
    """Deprecated. Use `messaging.client.sent.messages` instead"""
    return meter.create_counter(
        name=MESSAGING_CLIENT_PUBLISHED_MESSAGES,
        description="Deprecated. Use `messaging.client.sent.messages` instead.",
        unit="{message}",
    )


MESSAGING_CLIENT_SENT_MESSAGES: Final = "messaging.client.sent.messages"
"""
Number of messages producer attempted to send to the broker
Instrument: counter
Unit: {message}
Note: This metric MUST NOT count messages that were created but haven't yet been sent.
"""


def create_messaging_client_sent_messages(meter: Meter) -> Counter:
    """Number of messages producer attempted to send to the broker"""
    return meter.create_counter(
        name=MESSAGING_CLIENT_SENT_MESSAGES,
        description="Number of messages producer attempted to send to the broker.",
        unit="{message}",
    )


MESSAGING_PROCESS_DURATION: Final = "messaging.process.duration"
"""
Duration of processing operation
Instrument: histogram
Unit: s
Note: This metric MUST be reported for operations with `messaging.operation.type` that matches `process`.
"""


def create_messaging_process_duration(meter: Meter) -> Histogram:
    """Duration of processing operation"""
    return meter.create_histogram(
        name=MESSAGING_PROCESS_DURATION,
        description="Duration of processing operation.",
        unit="s",
    )


MESSAGING_PROCESS_MESSAGES: Final = "messaging.process.messages"
"""
Deprecated: Replaced by `messaging.client.consumed.messages`.
"""


def create_messaging_process_messages(meter: Meter) -> Counter:
    """Deprecated. Use `messaging.client.consumed.messages` instead"""
    return meter.create_counter(
        name=MESSAGING_PROCESS_MESSAGES,
        description="Deprecated. Use `messaging.client.consumed.messages` instead.",
        unit="{message}",
    )


MESSAGING_PUBLISH_DURATION: Final = "messaging.publish.duration"
"""
Deprecated: Replaced by `messaging.client.operation.duration`.
"""


def create_messaging_publish_duration(meter: Meter) -> Histogram:
    """Deprecated. Use `messaging.client.operation.duration` instead"""
    return meter.create_histogram(
        name=MESSAGING_PUBLISH_DURATION,
        description="Deprecated. Use `messaging.client.operation.duration` instead.",
        unit="s",
    )


MESSAGING_PUBLISH_MESSAGES: Final = "messaging.publish.messages"
"""
Deprecated: Replaced by `messaging.client.sent.messages`.
"""


def create_messaging_publish_messages(meter: Meter) -> Counter:
    """Deprecated. Use `messaging.client.sent.messages` instead"""
    return meter.create_counter(
        name=MESSAGING_PUBLISH_MESSAGES,
        description="Deprecated. Use `messaging.client.sent.messages` instead.",
        unit="{message}",
    )


MESSAGING_RECEIVE_DURATION: Final = "messaging.receive.duration"
"""
Deprecated: Replaced by `messaging.client.operation.duration`.
"""


def create_messaging_receive_duration(meter: Meter) -> Histogram:
    """Deprecated. Use `messaging.client.operation.duration` instead"""
    return meter.create_histogram(
        name=MESSAGING_RECEIVE_DURATION,
        description="Deprecated. Use `messaging.client.operation.duration` instead.",
        unit="s",
    )


MESSAGING_RECEIVE_MESSAGES: Final = "messaging.receive.messages"
"""
Deprecated: Replaced by `messaging.client.consumed.messages`.
"""


def create_messaging_receive_messages(meter: Meter) -> Counter:
    """Deprecated. Use `messaging.client.consumed.messages` instead"""
    return meter.create_counter(
        name=MESSAGING_RECEIVE_MESSAGES,
        description="Deprecated. Use `messaging.client.consumed.messages` instead.",
        unit="{message}",
    )
