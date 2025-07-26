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
"""Utilities for the gRPC Python Beta API."""

import threading
import time

# implementations is referenced from specification in this module.
from grpc.beta import implementations  # pylint: disable=unused-import
from grpc.beta import interfaces
from grpc.framework.foundation import callable_util
from grpc.framework.foundation import future

_DONE_CALLBACK_EXCEPTION_LOG_MESSAGE = (
    'Exception calling connectivity future "done" callback!'
)


class _ChannelReadyFuture(future.Future):
    def __init__(self, channel):
        self._condition = threading.Condition()
        self._channel = channel

        self._matured = False
        self._cancelled = False
        self._done_callbacks = []

    def _block(self, timeout):
        until = None if timeout is None else time.time() + timeout
        with self._condition:
            while True:
                if self._cancelled:
                    raise future.CancelledError()
                elif self._matured:
                    return
                else:
                    if until is None:
                        self._condition.wait()
                    else:
                        remaining = until - time.time()
                        if remaining < 0:
                            raise future.TimeoutError()
                        else:
                            self._condition.wait(timeout=remaining)

    def _update(self, connectivity):
        with self._condition:
            if (
                not self._cancelled
                and connectivity is interfaces.ChannelConnectivity.READY
            ):
                self._matured = True
                self._channel.unsubscribe(self._update)
                self._condition.notify_all()
                done_callbacks = tuple(self._done_callbacks)
                self._done_callbacks = None
            else:
                return

        for done_callback in done_callbacks:
            callable_util.call_logging_exceptions(
                done_callback, _DONE_CALLBACK_EXCEPTION_LOG_MESSAGE, self
            )

    def cancel(self):
        with self._condition:
            if not self._matured:
                self._cancelled = True
                self._channel.unsubscribe(self._update)
                self._condition.notify_all()
                done_callbacks = tuple(self._done_callbacks)
                self._done_callbacks = None
            else:
                return False

        for done_callback in done_callbacks:
            callable_util.call_logging_exceptions(
                done_callback, _DONE_CALLBACK_EXCEPTION_LOG_MESSAGE, self
            )

        return True

    def cancelled(self):
        with self._condition:
            return self._cancelled

    def running(self):
        with self._condition:
            return not self._cancelled and not self._matured

    def done(self):
        with self._condition:
            return self._cancelled or self._matured

    def result(self, timeout=None):
        self._block(timeout)
        return None

    def exception(self, timeout=None):
        self._block(timeout)
        return None

    def traceback(self, timeout=None):
        self._block(timeout)
        return None

    def add_done_callback(self, fn):
        with self._condition:
            if not self._cancelled and not self._matured:
                self._done_callbacks.append(fn)
                return

        fn(self)

    def start(self):
        with self._condition:
            self._channel.subscribe(self._update, try_to_connect=True)

    def __del__(self):
        with self._condition:
            if not self._cancelled and not self._matured:
                self._channel.unsubscribe(self._update)


def channel_ready_future(channel):
    """Creates a future.Future tracking when an implementations.Channel is ready.

    Cancelling the returned future.Future does not tell the given
    implementations.Channel to abandon attempts it may have been making to
    connect; cancelling merely deactivates the return future.Future's
    subscription to the given implementations.Channel's connectivity.

    Args:
      channel: An implementations.Channel.

    Returns:
      A future.Future that matures when the given Channel has connectivity
        interfaces.ChannelConnectivity.READY.
    """
    ready_future = _ChannelReadyFuture(channel)
    ready_future.start()
    return ready_future
