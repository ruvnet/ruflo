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
"""Utilities for working with callables."""

from abc import ABC
import collections
import enum
import functools
import logging

_LOGGER = logging.getLogger(__name__)


class Outcome(ABC):
    """A sum type describing the outcome of some call.

    Attributes:
      kind: One of Kind.RETURNED or Kind.RAISED respectively indicating that the
        call returned a value or raised an exception.
      return_value: The value returned by the call. Must be present if kind is
        Kind.RETURNED.
      exception: The exception raised by the call. Must be present if kind is
        Kind.RAISED.
    """

    @enum.unique
    class Kind(enum.Enum):
        """Identifies the general kind of the outcome of some call."""

        RETURNED = object()
        RAISED = object()


class _EasyOutcome(
    collections.namedtuple(
        "_EasyOutcome", ["kind", "return_value", "exception"]
    ),
    Outcome,
):
    """A trivial implementation of Outcome."""


def _call_logging_exceptions(behavior, message, *args, **kwargs):
    try:
        return _EasyOutcome(
            Outcome.Kind.RETURNED, behavior(*args, **kwargs), None
        )
    except Exception as e:  # pylint: disable=broad-except
        _LOGGER.exception(message)
        return _EasyOutcome(Outcome.Kind.RAISED, None, e)


def with_exceptions_logged(behavior, message):
    """Wraps a callable in a try-except that logs any exceptions it raises.

    Args:
      behavior: Any callable.
      message: A string to log if the behavior raises an exception.

    Returns:
      A callable that when executed invokes the given behavior. The returned
        callable takes the same arguments as the given behavior but returns a
        future.Outcome describing whether the given behavior returned a value or
        raised an exception.
    """

    @functools.wraps(behavior)
    def wrapped_behavior(*args, **kwargs):
        return _call_logging_exceptions(behavior, message, *args, **kwargs)

    return wrapped_behavior


def call_logging_exceptions(behavior, message, *args, **kwargs):
    """Calls a behavior in a try-except that logs any exceptions it raises.

    Args:
      behavior: Any callable.
      message: A string to log if the behavior raises an exception.
      *args: Positional arguments to pass to the given behavior.
      **kwargs: Keyword arguments to pass to the given behavior.

    Returns:
      An Outcome describing whether the given behavior returned a value or raised
        an exception.
    """
    return _call_logging_exceptions(behavior, message, *args, **kwargs)
