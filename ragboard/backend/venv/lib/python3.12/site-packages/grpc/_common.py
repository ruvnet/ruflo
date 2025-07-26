# Copyright 2016 gRPC authors.
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
"""Shared implementation."""

import logging
import time
from typing import Any, AnyStr, Callable, Optional, Union

import grpc
from grpc._cython import cygrpc
from grpc._typing import DeserializingFunction
from grpc._typing import SerializingFunction

_LOGGER = logging.getLogger(__name__)

CYGRPC_CONNECTIVITY_STATE_TO_CHANNEL_CONNECTIVITY = {
    cygrpc.ConnectivityState.idle: grpc.ChannelConnectivity.IDLE,
    cygrpc.ConnectivityState.connecting: grpc.ChannelConnectivity.CONNECTING,
    cygrpc.ConnectivityState.ready: grpc.ChannelConnectivity.READY,
    cygrpc.ConnectivityState.transient_failure: grpc.ChannelConnectivity.TRANSIENT_FAILURE,
    cygrpc.ConnectivityState.shutdown: grpc.ChannelConnectivity.SHUTDOWN,
}

CYGRPC_STATUS_CODE_TO_STATUS_CODE = {
    cygrpc.StatusCode.ok: grpc.StatusCode.OK,
    cygrpc.StatusCode.cancelled: grpc.StatusCode.CANCELLED,
    cygrpc.StatusCode.unknown: grpc.StatusCode.UNKNOWN,
    cygrpc.StatusCode.invalid_argument: grpc.StatusCode.INVALID_ARGUMENT,
    cygrpc.StatusCode.deadline_exceeded: grpc.StatusCode.DEADLINE_EXCEEDED,
    cygrpc.StatusCode.not_found: grpc.StatusCode.NOT_FOUND,
    cygrpc.StatusCode.already_exists: grpc.StatusCode.ALREADY_EXISTS,
    cygrpc.StatusCode.permission_denied: grpc.StatusCode.PERMISSION_DENIED,
    cygrpc.StatusCode.unauthenticated: grpc.StatusCode.UNAUTHENTICATED,
    cygrpc.StatusCode.resource_exhausted: grpc.StatusCode.RESOURCE_EXHAUSTED,
    cygrpc.StatusCode.failed_precondition: grpc.StatusCode.FAILED_PRECONDITION,
    cygrpc.StatusCode.aborted: grpc.StatusCode.ABORTED,
    cygrpc.StatusCode.out_of_range: grpc.StatusCode.OUT_OF_RANGE,
    cygrpc.StatusCode.unimplemented: grpc.StatusCode.UNIMPLEMENTED,
    cygrpc.StatusCode.internal: grpc.StatusCode.INTERNAL,
    cygrpc.StatusCode.unavailable: grpc.StatusCode.UNAVAILABLE,
    cygrpc.StatusCode.data_loss: grpc.StatusCode.DATA_LOSS,
}
STATUS_CODE_TO_CYGRPC_STATUS_CODE = {
    grpc_code: cygrpc_code
    for cygrpc_code, grpc_code in CYGRPC_STATUS_CODE_TO_STATUS_CODE.items()
}

MAXIMUM_WAIT_TIMEOUT = 0.1

_ERROR_MESSAGE_PORT_BINDING_FAILED = (
    "Failed to bind to address %s; set "
    "GRPC_VERBOSITY=debug environment variable to see detailed error message."
)


def encode(s: AnyStr) -> bytes:
    if isinstance(s, bytes):
        return s
    else:
        return s.encode("utf8")


def decode(b: AnyStr) -> str:
    if isinstance(b, bytes):
        return b.decode("utf-8", "replace")
    return b


def _transform(
    message: Any,
    transformer: Union[SerializingFunction, DeserializingFunction, None],
    exception_message: str,
) -> Any:
    if transformer is None:
        return message
    else:
        try:
            return transformer(message)
        except Exception:  # pylint: disable=broad-except
            _LOGGER.exception(exception_message)
            return None


def serialize(message: Any, serializer: Optional[SerializingFunction]) -> bytes:
    return _transform(message, serializer, "Exception serializing message!")


def deserialize(
    serialized_message: bytes, deserializer: Optional[DeserializingFunction]
) -> Any:
    return _transform(
        serialized_message, deserializer, "Exception deserializing message!"
    )


def fully_qualified_method(group: str, method: str) -> str:
    return "/{}/{}".format(group, method)


def _wait_once(
    wait_fn: Callable[..., bool],
    timeout: float,
    spin_cb: Optional[Callable[[], None]],
):
    wait_fn(timeout=timeout)
    if spin_cb is not None:
        spin_cb()


def wait(
    wait_fn: Callable[..., bool],
    wait_complete_fn: Callable[[], bool],
    timeout: Optional[float] = None,
    spin_cb: Optional[Callable[[], None]] = None,
) -> bool:
    """Blocks waiting for an event without blocking the thread indefinitely.

    See https://github.com/grpc/grpc/issues/19464 for full context. CPython's
    `threading.Event.wait` and `threading.Condition.wait` methods, if invoked
    without a timeout kwarg, may block the calling thread indefinitely. If the
    call is made from the main thread, this means that signal handlers may not
    run for an arbitrarily long period of time.

    This wrapper calls the supplied wait function with an arbitrary short
    timeout to ensure that no signal handler has to wait longer than
    MAXIMUM_WAIT_TIMEOUT before executing.

    Args:
      wait_fn: A callable acceptable a single float-valued kwarg named
        `timeout`. This function is expected to be one of `threading.Event.wait`
        or `threading.Condition.wait`.
      wait_complete_fn: A callable taking no arguments and returning a bool.
        When this function returns true, it indicates that waiting should cease.
      timeout: An optional float-valued number of seconds after which the wait
        should cease.
      spin_cb: An optional Callable taking no arguments and returning nothing.
        This callback will be called on each iteration of the spin. This may be
        used for, e.g. work related to forking.

    Returns:
      True if a timeout was supplied and it was reached. False otherwise.
    """
    if timeout is None:
        while not wait_complete_fn():
            _wait_once(wait_fn, MAXIMUM_WAIT_TIMEOUT, spin_cb)
    else:
        end = time.time() + timeout
        while not wait_complete_fn():
            remaining = min(end - time.time(), MAXIMUM_WAIT_TIMEOUT)
            if remaining < 0:
                return True
            _wait_once(wait_fn, remaining, spin_cb)
    return False


def validate_port_binding_result(address: str, port: int) -> int:
    """Validates if the port binding succeed.

    If the port returned by Core is 0, the binding is failed. However, in that
    case, the Core API doesn't return a detailed failing reason. The best we
    can do is raising an exception to prevent further confusion.

    Args:
        address: The address string to be bound.
        port: An int returned by core
    """
    if port == 0:
        # The Core API doesn't return a failure message. The best we can do
        # is raising an exception to prevent further confusion.
        raise RuntimeError(_ERROR_MESSAGE_PORT_BINDING_FAILED % address)
    else:
        return port
