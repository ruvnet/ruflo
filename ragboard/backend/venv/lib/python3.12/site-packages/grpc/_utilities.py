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
"""Internal utilities for gRPC Python."""

import collections
import logging
import threading
import time
from typing import Callable, Dict, Optional, Sequence

import grpc  # pytype: disable=pyi-error
from grpc import _common  # pytype: disable=pyi-error
from grpc._typing import DoneCallbackType

_LOGGER = logging.getLogger(__name__)

_DONE_CALLBACK_EXCEPTION_LOG_MESSAGE = (
    'Exception calling connectivity future "done" callback!'
)


class RpcMethodHandler(
    collections.namedtuple(
        "_RpcMethodHandler",
        (
            "request_streaming",
            "response_streaming",
            "request_deserializer",
            "response_serializer",
            "unary_unary",
            "unary_stream",
            "stream_unary",
            "stream_stream",
        ),
    ),
    grpc.RpcMethodHandler,
):
    pass


class DictionaryGenericHandler(grpc.ServiceRpcHandler):
    _name: str
    _method_handlers: Dict[str, grpc.RpcMethodHandler]

    def __init__(
        self, service: str, method_handlers: Dict[str, grpc.RpcMethodHandler]
    ):
        self._name = service
        self._method_handlers = {
            _common.fully_qualified_method(service, method): method_handler
            for method, method_handler in method_handlers.items()
        }

    def service_name(self) -> str:
        return self._name

    def service(
        self, handler_call_details: grpc.HandlerCallDetails
    ) -> Optional[grpc.RpcMethodHandler]:
        details_method = handler_call_details.method
        return self._method_handlers.get(
            details_method
        )  # pytype: disable=attribute-error


class _ChannelReadyFuture(grpc.Future):
    _condition: threading.Condition
    _channel: grpc.Channel
    _matured: bool
    _cancelled: bool
    _done_callbacks: Sequence[Callable]

    def __init__(self, channel: grpc.Channel):
        self._condition = threading.Condition()
        self._channel = channel

        self._matured = False
        self._cancelled = False
        self._done_callbacks = []

    def _block(self, timeout: Optional[float]) -> None:
        until = None if timeout is None else time.time() + timeout
        with self._condition:
            while True:
                if self._cancelled:
                    raise grpc.FutureCancelledError()
                elif self._matured:
                    return
                else:
                    if until is None:
                        self._condition.wait()
                    else:
                        remaining = until - time.time()
                        if remaining < 0:
                            raise grpc.FutureTimeoutError()
                        else:
                            self._condition.wait(timeout=remaining)

    def _update(self, connectivity: Optional[grpc.ChannelConnectivity]) -> None:
        with self._condition:
            if (
                not self._cancelled
                and connectivity is grpc.ChannelConnectivity.READY
            ):
                self._matured = True
                self._channel.unsubscribe(self._update)
                self._condition.notify_all()
                done_callbacks = tuple(self._done_callbacks)
                self._done_callbacks = None
            else:
                return

        for done_callback in done_callbacks:
            try:
                done_callback(self)
            except Exception:  # pylint: disable=broad-except
                _LOGGER.exception(_DONE_CALLBACK_EXCEPTION_LOG_MESSAGE)

    def cancel(self) -> bool:
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
            try:
                done_callback(self)
            except Exception:  # pylint: disable=broad-except
                _LOGGER.exception(_DONE_CALLBACK_EXCEPTION_LOG_MESSAGE)

        return True

    def cancelled(self) -> bool:
        with self._condition:
            return self._cancelled

    def running(self) -> bool:
        with self._condition:
            return not self._cancelled and not self._matured

    def done(self) -> bool:
        with self._condition:
            return self._cancelled or self._matured

    def result(self, timeout: Optional[float] = None) -> None:
        self._block(timeout)

    def exception(self, timeout: Optional[float] = None) -> None:
        self._block(timeout)

    def traceback(self, timeout: Optional[float] = None) -> None:
        self._block(timeout)

    def add_done_callback(self, fn: DoneCallbackType):
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


def channel_ready_future(channel: grpc.Channel) -> _ChannelReadyFuture:
    ready_future = _ChannelReadyFuture(channel)
    ready_future.start()
    return ready_future


def first_version_is_lower(version1: str, version2: str) -> bool:
    """
    Compares two versions in the format '1.60.1' or '1.60.1.dev0'.

    This method will be used in all stubs generated by grpcio-tools to check whether
    the stub version is compatible with the runtime grpcio.

    Args:
        version1: The first version string.
        version2: The second version string.

    Returns:
        True if version1 is lower, False otherwise.
    """
    version1_list = version1.split(".")
    version2_list = version2.split(".")

    try:
        for i in range(3):
            if int(version1_list[i]) < int(version2_list[i]):
                return True
            elif int(version1_list[i]) > int(version2_list[i]):
                return False
    except ValueError:
        # Return false in case we can't convert version to int.
        return False

    # The version without dev0 will be considered lower.
    return len(version1_list) < len(version2_list)
