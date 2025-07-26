# Copyright 2015 gRPC authors.
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
"""Utilities for use with the base interface of RPC Framework."""

import collections

from grpc.framework.interfaces.base import base


class _Completion(
    base.Completion,
    collections.namedtuple(
        "_Completion",
        (
            "terminal_metadata",
            "code",
            "message",
        ),
    ),
):
    """A trivial implementation of base.Completion."""


class _Subscription(
    base.Subscription,
    collections.namedtuple(
        "_Subscription",
        (
            "kind",
            "termination_callback",
            "allowance",
            "operator",
            "protocol_receiver",
        ),
    ),
):
    """A trivial implementation of base.Subscription."""


_NONE_SUBSCRIPTION = _Subscription(
    base.Subscription.Kind.NONE, None, None, None, None
)


def completion(terminal_metadata, code, message):
    """Creates a base.Completion aggregating the given operation values.

    Args:
      terminal_metadata: A terminal metadata value for an operation.
      code: A code value for an operation.
      message: A message value for an operation.

    Returns:
      A base.Completion aggregating the given operation values.
    """
    return _Completion(terminal_metadata, code, message)


def full_subscription(operator, protocol_receiver):
    """Creates a "full" base.Subscription for the given base.Operator.

    Args:
      operator: A base.Operator to be used in an operation.
      protocol_receiver: A base.ProtocolReceiver to be used in an operation.

    Returns:
      A base.Subscription of kind base.Subscription.Kind.FULL wrapping the given
        base.Operator and base.ProtocolReceiver.
    """
    return _Subscription(
        base.Subscription.Kind.FULL, None, None, operator, protocol_receiver
    )
