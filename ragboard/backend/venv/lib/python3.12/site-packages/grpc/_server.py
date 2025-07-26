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
"""Service-side implementation of gRPC Python."""

from __future__ import annotations

import abc
import collections
from concurrent import futures
import contextvars
import enum
import logging
import threading
import time
import traceback
from typing import (
    Any,
    Callable,
    Dict,
    Iterable,
    Iterator,
    List,
    Mapping,
    Optional,
    Sequence,
    Set,
    Tuple,
    Union,
)

import grpc  # pytype: disable=pyi-error
from grpc import _common  # pytype: disable=pyi-error
from grpc import _compression  # pytype: disable=pyi-error
from grpc import _interceptor  # pytype: disable=pyi-error
from grpc import _observability  # pytype: disable=pyi-error
from grpc._cython import cygrpc
from grpc._typing import ArityAgnosticMethodHandler
from grpc._typing import ChannelArgumentType
from grpc._typing import DeserializingFunction
from grpc._typing import MetadataType
from grpc._typing import NullaryCallbackType
from grpc._typing import ResponseType
from grpc._typing import SerializingFunction
from grpc._typing import ServerCallbackTag
from grpc._typing import ServerTagCallbackType

_LOGGER = logging.getLogger(__name__)

_SHUTDOWN_TAG = "shutdown"
_REQUEST_CALL_TAG = "request_call"

_RECEIVE_CLOSE_ON_SERVER_TOKEN = "receive_close_on_server"
_SEND_INITIAL_METADATA_TOKEN = "send_initial_metadata"
_RECEIVE_MESSAGE_TOKEN = "receive_message"
_SEND_MESSAGE_TOKEN = "send_message"
_SEND_INITIAL_METADATA_AND_SEND_MESSAGE_TOKEN = (
    "send_initial_metadata * send_message"
)
_SEND_STATUS_FROM_SERVER_TOKEN = "send_status_from_server"
_SEND_INITIAL_METADATA_AND_SEND_STATUS_FROM_SERVER_TOKEN = (
    "send_initial_metadata * send_status_from_server"
)

_OPEN = "open"
_CLOSED = "closed"
_CANCELLED = "cancelled"

_EMPTY_FLAGS = 0

_DEALLOCATED_SERVER_CHECK_PERIOD_S = 1.0
_INF_TIMEOUT = 1e9


def _serialized_request(request_event: cygrpc.BaseEvent) -> bytes:
    return request_event.batch_operations[0].message()


def _application_code(code: grpc.StatusCode) -> cygrpc.StatusCode:
    cygrpc_code = _common.STATUS_CODE_TO_CYGRPC_STATUS_CODE.get(code)
    return cygrpc.StatusCode.unknown if cygrpc_code is None else cygrpc_code


def _completion_code(state: _RPCState) -> cygrpc.StatusCode:
    if state.code is None:
        return cygrpc.StatusCode.ok
    else:
        return _application_code(state.code)


def _abortion_code(
    state: _RPCState, code: cygrpc.StatusCode
) -> cygrpc.StatusCode:
    if state.code is None:
        return code
    else:
        return _application_code(state.code)


def _details(state: _RPCState) -> bytes:
    return b"" if state.details is None else state.details


class _HandlerCallDetails(
    collections.namedtuple(
        "_HandlerCallDetails",
        (
            "method",
            "invocation_metadata",
        ),
    ),
    grpc.HandlerCallDetails,
):
    pass


class _Method(abc.ABC):
    @abc.abstractmethod
    def name(self) -> Optional[str]:
        raise NotImplementedError()

    @abc.abstractmethod
    def handler(
        self, handler_call_details: _HandlerCallDetails
    ) -> Optional[grpc.RpcMethodHandler]:
        raise NotImplementedError()


class _RegisteredMethod(_Method):
    def __init__(
        self,
        name: str,
        registered_handler: Optional[grpc.RpcMethodHandler],
    ):
        self._name = name
        self._registered_handler = registered_handler

    def name(self) -> Optional[str]:
        return self._name

    def handler(
        self, handler_call_details: _HandlerCallDetails
    ) -> Optional[grpc.RpcMethodHandler]:
        return self._registered_handler


class _GenericMethod(_Method):
    def __init__(
        self,
        generic_handlers: List[grpc.GenericRpcHandler],
    ):
        self._generic_handlers = generic_handlers

    def name(self) -> Optional[str]:
        return None

    def handler(
        self, handler_call_details: _HandlerCallDetails
    ) -> Optional[grpc.RpcMethodHandler]:
        # If the same method have both generic and registered handler,
        # registered handler will take precedence.
        for generic_handler in self._generic_handlers:
            method_handler = generic_handler.service(handler_call_details)
            if method_handler is not None:
                return method_handler
        return None


class _RPCState(object):
    context: contextvars.Context
    condition: threading.Condition
    due = Set[str]
    request: Any
    client: str
    initial_metadata_allowed: bool
    compression_algorithm: Optional[grpc.Compression]
    disable_next_compression: bool
    trailing_metadata: Optional[MetadataType]
    code: Optional[grpc.StatusCode]
    details: Optional[bytes]
    statused: bool
    rpc_errors: List[Exception]
    callbacks: Optional[List[NullaryCallbackType]]
    aborted: bool

    def __init__(self):
        self.context = contextvars.Context()
        self.condition = threading.Condition()
        self.due = set()
        self.request = None
        self.client = _OPEN
        self.initial_metadata_allowed = True
        self.compression_algorithm = None
        self.disable_next_compression = False
        self.trailing_metadata = None
        self.code = None
        self.details = None
        self.statused = False
        self.rpc_errors = []
        self.callbacks = []
        self.aborted = False


def _raise_rpc_error(state: _RPCState) -> None:
    rpc_error = grpc.RpcError()
    state.rpc_errors.append(rpc_error)
    raise rpc_error


def _possibly_finish_call(
    state: _RPCState, token: str
) -> ServerTagCallbackType:
    state.due.remove(token)
    if not _is_rpc_state_active(state) and not state.due:
        callbacks = state.callbacks
        state.callbacks = None
        return state, callbacks
    else:
        return None, ()


def _send_status_from_server(state: _RPCState, token: str) -> ServerCallbackTag:
    def send_status_from_server(unused_send_status_from_server_event):
        with state.condition:
            return _possibly_finish_call(state, token)

    return send_status_from_server


def _get_initial_metadata(
    state: _RPCState, metadata: Optional[MetadataType]
) -> Optional[MetadataType]:
    with state.condition:
        if state.compression_algorithm:
            compression_metadata = (
                _compression.compression_algorithm_to_metadata(
                    state.compression_algorithm
                ),
            )
            if metadata is None:
                return compression_metadata
            else:
                return compression_metadata + tuple(metadata)
        else:
            return metadata


def _get_initial_metadata_operation(
    state: _RPCState, metadata: Optional[MetadataType]
) -> cygrpc.Operation:
    operation = cygrpc.SendInitialMetadataOperation(
        _get_initial_metadata(state, metadata), _EMPTY_FLAGS
    )
    return operation


def _abort(
    state: _RPCState, call: cygrpc.Call, code: cygrpc.StatusCode, details: bytes
) -> None:
    if state.client is not _CANCELLED:
        effective_code = _abortion_code(state, code)
        effective_details = details if state.details is None else state.details
        if state.initial_metadata_allowed:
            operations = (
                _get_initial_metadata_operation(state, None),
                cygrpc.SendStatusFromServerOperation(
                    state.trailing_metadata,
                    effective_code,
                    effective_details,
                    _EMPTY_FLAGS,
                ),
            )
            token = _SEND_INITIAL_METADATA_AND_SEND_STATUS_FROM_SERVER_TOKEN
        else:
            operations = (
                cygrpc.SendStatusFromServerOperation(
                    state.trailing_metadata,
                    effective_code,
                    effective_details,
                    _EMPTY_FLAGS,
                ),
            )
            token = _SEND_STATUS_FROM_SERVER_TOKEN
        call.start_server_batch(
            operations, _send_status_from_server(state, token)
        )
        state.statused = True
        state.due.add(token)


def _receive_close_on_server(state: _RPCState) -> ServerCallbackTag:
    def receive_close_on_server(receive_close_on_server_event):
        with state.condition:
            if receive_close_on_server_event.batch_operations[0].cancelled():
                state.client = _CANCELLED
            elif state.client is _OPEN:
                state.client = _CLOSED
            state.condition.notify_all()
            return _possibly_finish_call(state, _RECEIVE_CLOSE_ON_SERVER_TOKEN)

    return receive_close_on_server


def _receive_message(
    state: _RPCState,
    call: cygrpc.Call,
    request_deserializer: Optional[DeserializingFunction],
) -> ServerCallbackTag:
    def receive_message(receive_message_event):
        serialized_request = _serialized_request(receive_message_event)
        if serialized_request is None:
            with state.condition:
                if state.client is _OPEN:
                    state.client = _CLOSED
                state.condition.notify_all()
                return _possibly_finish_call(state, _RECEIVE_MESSAGE_TOKEN)
        else:
            request = _common.deserialize(
                serialized_request, request_deserializer
            )
            with state.condition:
                if request is None:
                    _abort(
                        state,
                        call,
                        cygrpc.StatusCode.internal,
                        b"Exception deserializing request!",
                    )
                else:
                    state.request = request
                state.condition.notify_all()
                return _possibly_finish_call(state, _RECEIVE_MESSAGE_TOKEN)

    return receive_message


def _send_initial_metadata(state: _RPCState) -> ServerCallbackTag:
    def send_initial_metadata(unused_send_initial_metadata_event):
        with state.condition:
            return _possibly_finish_call(state, _SEND_INITIAL_METADATA_TOKEN)

    return send_initial_metadata


def _send_message(state: _RPCState, token: str) -> ServerCallbackTag:
    def send_message(unused_send_message_event):
        with state.condition:
            state.condition.notify_all()
            return _possibly_finish_call(state, token)

    return send_message


class _Context(grpc.ServicerContext):
    _rpc_event: cygrpc.BaseEvent
    _state: _RPCState
    request_deserializer: Optional[DeserializingFunction]

    def __init__(
        self,
        rpc_event: cygrpc.BaseEvent,
        state: _RPCState,
        request_deserializer: Optional[DeserializingFunction],
    ):
        self._rpc_event = rpc_event
        self._state = state
        self._request_deserializer = request_deserializer

    def is_active(self) -> bool:
        with self._state.condition:
            return _is_rpc_state_active(self._state)

    def time_remaining(self) -> float:
        return max(self._rpc_event.call_details.deadline - time.time(), 0)

    def cancel(self) -> None:
        self._rpc_event.call.cancel()

    def add_callback(self, callback: NullaryCallbackType) -> bool:
        with self._state.condition:
            if self._state.callbacks is None:
                return False
            else:
                self._state.callbacks.append(callback)
                return True

    def disable_next_message_compression(self) -> None:
        with self._state.condition:
            self._state.disable_next_compression = True

    def invocation_metadata(self) -> Optional[MetadataType]:
        return self._rpc_event.invocation_metadata

    def peer(self) -> str:
        return _common.decode(self._rpc_event.call.peer())

    def peer_identities(self) -> Optional[Sequence[bytes]]:
        return cygrpc.peer_identities(self._rpc_event.call)

    def peer_identity_key(self) -> Optional[str]:
        id_key = cygrpc.peer_identity_key(self._rpc_event.call)
        return id_key if id_key is None else _common.decode(id_key)

    def auth_context(self) -> Mapping[str, Sequence[bytes]]:
        auth_context = cygrpc.auth_context(self._rpc_event.call)
        auth_context_dict = {} if auth_context is None else auth_context
        return {
            _common.decode(key): value
            for key, value in auth_context_dict.items()
        }

    def set_compression(self, compression: grpc.Compression) -> None:
        with self._state.condition:
            self._state.compression_algorithm = compression

    def send_initial_metadata(self, initial_metadata: MetadataType) -> None:
        with self._state.condition:
            if self._state.client is _CANCELLED:
                _raise_rpc_error(self._state)
            else:
                if self._state.initial_metadata_allowed:
                    operation = _get_initial_metadata_operation(
                        self._state, initial_metadata
                    )
                    self._rpc_event.call.start_server_batch(
                        (operation,), _send_initial_metadata(self._state)
                    )
                    self._state.initial_metadata_allowed = False
                    self._state.due.add(_SEND_INITIAL_METADATA_TOKEN)
                else:
                    raise ValueError("Initial metadata no longer allowed!")

    def set_trailing_metadata(self, trailing_metadata: MetadataType) -> None:
        with self._state.condition:
            self._state.trailing_metadata = trailing_metadata

    def trailing_metadata(self) -> Optional[MetadataType]:
        return self._state.trailing_metadata

    def abort(self, code: grpc.StatusCode, details: str) -> None:
        # treat OK like other invalid arguments: fail the RPC
        if code == grpc.StatusCode.OK:
            _LOGGER.error(
                "abort() called with StatusCode.OK; returning UNKNOWN"
            )
            code = grpc.StatusCode.UNKNOWN
            details = ""
        with self._state.condition:
            self._state.code = code
            self._state.details = _common.encode(details)
            self._state.aborted = True
            raise Exception()

    def abort_with_status(self, status: grpc.Status) -> None:
        self._state.trailing_metadata = status.trailing_metadata
        self.abort(status.code, status.details)

    def set_code(self, code: grpc.StatusCode) -> None:
        with self._state.condition:
            self._state.code = code

    def code(self) -> grpc.StatusCode:
        return self._state.code

    def set_details(self, details: str) -> None:
        with self._state.condition:
            self._state.details = _common.encode(details)

    def details(self) -> bytes:
        return self._state.details

    def _finalize_state(self) -> None:
        pass


class _RequestIterator(object):
    _state: _RPCState
    _call: cygrpc.Call
    _request_deserializer: Optional[DeserializingFunction]

    def __init__(
        self,
        state: _RPCState,
        call: cygrpc.Call,
        request_deserializer: Optional[DeserializingFunction],
    ):
        self._state = state
        self._call = call
        self._request_deserializer = request_deserializer

    def _raise_or_start_receive_message(self) -> None:
        if self._state.client is _CANCELLED:
            _raise_rpc_error(self._state)
        elif not _is_rpc_state_active(self._state):
            raise StopIteration()
        else:
            self._call.start_server_batch(
                (cygrpc.ReceiveMessageOperation(_EMPTY_FLAGS),),
                _receive_message(
                    self._state, self._call, self._request_deserializer
                ),
            )
            self._state.due.add(_RECEIVE_MESSAGE_TOKEN)

    def _look_for_request(self) -> Any:
        if self._state.client is _CANCELLED:
            _raise_rpc_error(self._state)
        elif (
            self._state.request is None
            and _RECEIVE_MESSAGE_TOKEN not in self._state.due
        ):
            raise StopIteration()
        else:
            request = self._state.request
            self._state.request = None
            return request

        raise AssertionError()  # should never run

    def _next(self) -> Any:
        with self._state.condition:
            self._raise_or_start_receive_message()
            while True:
                self._state.condition.wait()
                request = self._look_for_request()
                if request is not None:
                    return request

    def __iter__(self) -> _RequestIterator:
        return self

    def __next__(self) -> Any:
        return self._next()

    def next(self) -> Any:
        return self._next()


def _unary_request(
    rpc_event: cygrpc.BaseEvent,
    state: _RPCState,
    request_deserializer: Optional[DeserializingFunction],
) -> Callable[[], Any]:
    def unary_request():
        with state.condition:
            if not _is_rpc_state_active(state):
                return None
            else:
                rpc_event.call.start_server_batch(
                    (cygrpc.ReceiveMessageOperation(_EMPTY_FLAGS),),
                    _receive_message(
                        state, rpc_event.call, request_deserializer
                    ),
                )
                state.due.add(_RECEIVE_MESSAGE_TOKEN)
                while True:
                    state.condition.wait()
                    if state.request is None:
                        if state.client is _CLOSED:
                            details = '"{}" requires exactly one request message.'.format(
                                rpc_event.call_details.method
                            )
                            _abort(
                                state,
                                rpc_event.call,
                                cygrpc.StatusCode.unimplemented,
                                _common.encode(details),
                            )
                            return None
                        elif state.client is _CANCELLED:
                            return None
                    else:
                        request = state.request
                        state.request = None
                        return request

    return unary_request


def _call_behavior(
    rpc_event: cygrpc.BaseEvent,
    state: _RPCState,
    behavior: ArityAgnosticMethodHandler,
    argument: Any,
    request_deserializer: Optional[DeserializingFunction],
    send_response_callback: Optional[Callable[[ResponseType], None]] = None,
) -> Tuple[Union[ResponseType, Iterator[ResponseType]], bool]:
    from grpc import _create_servicer_context  # pytype: disable=pyi-error

    with _create_servicer_context(
        rpc_event, state, request_deserializer
    ) as context:
        try:
            response_or_iterator = None
            if send_response_callback is not None:
                response_or_iterator = behavior(
                    argument, context, send_response_callback
                )
            else:
                response_or_iterator = behavior(argument, context)
            return response_or_iterator, True
        except Exception as exception:  # pylint: disable=broad-except
            with state.condition:
                if state.aborted:
                    _abort(
                        state,
                        rpc_event.call,
                        cygrpc.StatusCode.unknown,
                        b"RPC Aborted",
                    )
                elif exception not in state.rpc_errors:
                    try:
                        details = "Exception calling application: {}".format(
                            exception
                        )
                    except Exception:  # pylint: disable=broad-except
                        details = (
                            "Calling application raised unprintable Exception!"
                        )
                        _LOGGER.exception(
                            traceback.format_exception(
                                type(exception),
                                exception,
                                exception.__traceback__,
                            )
                        )
                        traceback.print_exc()
                    _LOGGER.exception(details)
                    _abort(
                        state,
                        rpc_event.call,
                        cygrpc.StatusCode.unknown,
                        _common.encode(details),
                    )
            return None, False


def _take_response_from_response_iterator(
    rpc_event: cygrpc.BaseEvent,
    state: _RPCState,
    response_iterator: Iterator[ResponseType],
) -> Tuple[ResponseType, bool]:
    try:
        return next(response_iterator), True
    except StopIteration:
        return None, True
    except Exception as exception:  # pylint: disable=broad-except
        with state.condition:
            if state.aborted:
                _abort(
                    state,
                    rpc_event.call,
                    cygrpc.StatusCode.unknown,
                    b"RPC Aborted",
                )
            elif exception not in state.rpc_errors:
                details = "Exception iterating responses: {}".format(exception)
                _LOGGER.exception(details)
                _abort(
                    state,
                    rpc_event.call,
                    cygrpc.StatusCode.unknown,
                    _common.encode(details),
                )
        return None, False


def _serialize_response(
    rpc_event: cygrpc.BaseEvent,
    state: _RPCState,
    response: Any,
    response_serializer: Optional[SerializingFunction],
) -> Optional[bytes]:
    serialized_response = _common.serialize(response, response_serializer)
    if serialized_response is None:
        with state.condition:
            _abort(
                state,
                rpc_event.call,
                cygrpc.StatusCode.internal,
                b"Failed to serialize response!",
            )
        return None
    else:
        return serialized_response


def _get_send_message_op_flags_from_state(
    state: _RPCState,
) -> Union[int, cygrpc.WriteFlag]:
    if state.disable_next_compression:
        return cygrpc.WriteFlag.no_compress
    else:
        return _EMPTY_FLAGS


def _reset_per_message_state(state: _RPCState) -> None:
    with state.condition:
        state.disable_next_compression = False


def _send_response(
    rpc_event: cygrpc.BaseEvent, state: _RPCState, serialized_response: bytes
) -> bool:
    with state.condition:
        if not _is_rpc_state_active(state):
            return False
        else:
            if state.initial_metadata_allowed:
                operations = (
                    _get_initial_metadata_operation(state, None),
                    cygrpc.SendMessageOperation(
                        serialized_response,
                        _get_send_message_op_flags_from_state(state),
                    ),
                )
                state.initial_metadata_allowed = False
                token = _SEND_INITIAL_METADATA_AND_SEND_MESSAGE_TOKEN
            else:
                operations = (
                    cygrpc.SendMessageOperation(
                        serialized_response,
                        _get_send_message_op_flags_from_state(state),
                    ),
                )
                token = _SEND_MESSAGE_TOKEN
            rpc_event.call.start_server_batch(
                operations, _send_message(state, token)
            )
            state.due.add(token)
            _reset_per_message_state(state)
            while True:
                state.condition.wait()
                if token not in state.due:
                    return _is_rpc_state_active(state)


def _status(
    rpc_event: cygrpc.BaseEvent,
    state: _RPCState,
    serialized_response: Optional[bytes],
) -> None:
    with state.condition:
        if state.client is not _CANCELLED:
            code = _completion_code(state)
            details = _details(state)
            operations = [
                cygrpc.SendStatusFromServerOperation(
                    state.trailing_metadata, code, details, _EMPTY_FLAGS
                ),
            ]
            if state.initial_metadata_allowed:
                operations.append(_get_initial_metadata_operation(state, None))
            if serialized_response is not None:
                operations.append(
                    cygrpc.SendMessageOperation(
                        serialized_response,
                        _get_send_message_op_flags_from_state(state),
                    )
                )
            rpc_event.call.start_server_batch(
                operations,
                _send_status_from_server(state, _SEND_STATUS_FROM_SERVER_TOKEN),
            )
            state.statused = True
            _reset_per_message_state(state)
            state.due.add(_SEND_STATUS_FROM_SERVER_TOKEN)


def _unary_response_in_pool(
    rpc_event: cygrpc.BaseEvent,
    state: _RPCState,
    behavior: ArityAgnosticMethodHandler,
    argument_thunk: Callable[[], Any],
    request_deserializer: Optional[SerializingFunction],
    response_serializer: Optional[SerializingFunction],
) -> None:
    cygrpc.install_context_from_request_call_event(rpc_event)

    try:
        argument = argument_thunk()
        if argument is not None:
            response, proceed = _call_behavior(
                rpc_event, state, behavior, argument, request_deserializer
            )
            if proceed:
                serialized_response = _serialize_response(
                    rpc_event, state, response, response_serializer
                )
                if serialized_response is not None:
                    _status(rpc_event, state, serialized_response)
    except Exception:  # pylint: disable=broad-except
        traceback.print_exc()
    finally:
        cygrpc.uninstall_context()


def _stream_response_in_pool(
    rpc_event: cygrpc.BaseEvent,
    state: _RPCState,
    behavior: ArityAgnosticMethodHandler,
    argument_thunk: Callable[[], Any],
    request_deserializer: Optional[DeserializingFunction],
    response_serializer: Optional[SerializingFunction],
) -> None:
    cygrpc.install_context_from_request_call_event(rpc_event)

    def send_response(response: Any) -> None:
        if response is None:
            _status(rpc_event, state, None)
        else:
            serialized_response = _serialize_response(
                rpc_event, state, response, response_serializer
            )
            if serialized_response is not None:
                _send_response(rpc_event, state, serialized_response)

    try:
        argument = argument_thunk()
        if argument is not None:
            if (
                hasattr(behavior, "experimental_non_blocking")
                and behavior.experimental_non_blocking
            ):
                _call_behavior(
                    rpc_event,
                    state,
                    behavior,
                    argument,
                    request_deserializer,
                    send_response_callback=send_response,
                )
            else:
                response_iterator, proceed = _call_behavior(
                    rpc_event, state, behavior, argument, request_deserializer
                )
                if proceed:
                    _send_message_callback_to_blocking_iterator_adapter(
                        rpc_event, state, send_response, response_iterator
                    )
    except Exception:  # pylint: disable=broad-except
        traceback.print_exc()
    finally:
        cygrpc.uninstall_context()


def _is_rpc_state_active(state: _RPCState) -> bool:
    return state.client is not _CANCELLED and not state.statused


def _send_message_callback_to_blocking_iterator_adapter(
    rpc_event: cygrpc.BaseEvent,
    state: _RPCState,
    send_response_callback: Callable[[ResponseType], None],
    response_iterator: Iterator[ResponseType],
) -> None:
    while True:
        response, proceed = _take_response_from_response_iterator(
            rpc_event, state, response_iterator
        )
        if proceed:
            send_response_callback(response)
            if not _is_rpc_state_active(state):
                break
        else:
            break


def _select_thread_pool_for_behavior(
    behavior: ArityAgnosticMethodHandler,
    default_thread_pool: futures.ThreadPoolExecutor,
) -> futures.ThreadPoolExecutor:
    if hasattr(behavior, "experimental_thread_pool") and isinstance(
        behavior.experimental_thread_pool, futures.ThreadPoolExecutor
    ):
        return behavior.experimental_thread_pool
    else:
        return default_thread_pool


def _handle_unary_unary(
    rpc_event: cygrpc.BaseEvent,
    state: _RPCState,
    method_handler: grpc.RpcMethodHandler,
    default_thread_pool: futures.ThreadPoolExecutor,
) -> futures.Future:
    unary_request = _unary_request(
        rpc_event, state, method_handler.request_deserializer
    )
    thread_pool = _select_thread_pool_for_behavior(
        method_handler.unary_unary, default_thread_pool
    )
    return thread_pool.submit(
        state.context.run,
        _unary_response_in_pool,
        rpc_event,
        state,
        method_handler.unary_unary,
        unary_request,
        method_handler.request_deserializer,
        method_handler.response_serializer,
    )


def _handle_unary_stream(
    rpc_event: cygrpc.BaseEvent,
    state: _RPCState,
    method_handler: grpc.RpcMethodHandler,
    default_thread_pool: futures.ThreadPoolExecutor,
) -> futures.Future:
    unary_request = _unary_request(
        rpc_event, state, method_handler.request_deserializer
    )
    thread_pool = _select_thread_pool_for_behavior(
        method_handler.unary_stream, default_thread_pool
    )
    return thread_pool.submit(
        state.context.run,
        _stream_response_in_pool,
        rpc_event,
        state,
        method_handler.unary_stream,
        unary_request,
        method_handler.request_deserializer,
        method_handler.response_serializer,
    )


def _handle_stream_unary(
    rpc_event: cygrpc.BaseEvent,
    state: _RPCState,
    method_handler: grpc.RpcMethodHandler,
    default_thread_pool: futures.ThreadPoolExecutor,
) -> futures.Future:
    request_iterator = _RequestIterator(
        state, rpc_event.call, method_handler.request_deserializer
    )
    thread_pool = _select_thread_pool_for_behavior(
        method_handler.stream_unary, default_thread_pool
    )
    return thread_pool.submit(
        state.context.run,
        _unary_response_in_pool,
        rpc_event,
        state,
        method_handler.stream_unary,
        lambda: request_iterator,
        method_handler.request_deserializer,
        method_handler.response_serializer,
    )


def _handle_stream_stream(
    rpc_event: cygrpc.BaseEvent,
    state: _RPCState,
    method_handler: grpc.RpcMethodHandler,
    default_thread_pool: futures.ThreadPoolExecutor,
) -> futures.Future:
    request_iterator = _RequestIterator(
        state, rpc_event.call, method_handler.request_deserializer
    )
    thread_pool = _select_thread_pool_for_behavior(
        method_handler.stream_stream, default_thread_pool
    )
    return thread_pool.submit(
        state.context.run,
        _stream_response_in_pool,
        rpc_event,
        state,
        method_handler.stream_stream,
        lambda: request_iterator,
        method_handler.request_deserializer,
        method_handler.response_serializer,
    )


def _find_method_handler(
    rpc_event: cygrpc.BaseEvent,
    state: _RPCState,
    method_with_handler: _Method,
    interceptor_pipeline: Optional[_interceptor._ServicePipeline],
) -> Optional[grpc.RpcMethodHandler]:
    def query_handlers(
        handler_call_details: _HandlerCallDetails,
    ) -> Optional[grpc.RpcMethodHandler]:
        return method_with_handler.handler(handler_call_details)

    method_name = method_with_handler.name()
    if not method_name:
        method_name = _common.decode(rpc_event.call_details.method)

    handler_call_details = _HandlerCallDetails(
        method_name,
        rpc_event.invocation_metadata,
    )

    if interceptor_pipeline is not None:
        return state.context.run(
            interceptor_pipeline.execute, query_handlers, handler_call_details
        )
    else:
        return state.context.run(query_handlers, handler_call_details)


def _reject_rpc(
    rpc_event: cygrpc.BaseEvent,
    rpc_state: _RPCState,
    status: cygrpc.StatusCode,
    details: bytes,
):
    operations = (
        _get_initial_metadata_operation(rpc_state, None),
        cygrpc.ReceiveCloseOnServerOperation(_EMPTY_FLAGS),
        cygrpc.SendStatusFromServerOperation(
            None, status, details, _EMPTY_FLAGS
        ),
    )
    rpc_event.call.start_server_batch(
        operations,
        lambda ignored_event: (
            rpc_state,
            (),
        ),
    )


def _handle_with_method_handler(
    rpc_event: cygrpc.BaseEvent,
    state: _RPCState,
    method_handler: grpc.RpcMethodHandler,
    thread_pool: futures.ThreadPoolExecutor,
) -> futures.Future:
    with state.condition:
        rpc_event.call.start_server_batch(
            (cygrpc.ReceiveCloseOnServerOperation(_EMPTY_FLAGS),),
            _receive_close_on_server(state),
        )
        state.due.add(_RECEIVE_CLOSE_ON_SERVER_TOKEN)
        if method_handler.request_streaming:
            if method_handler.response_streaming:
                return _handle_stream_stream(
                    rpc_event, state, method_handler, thread_pool
                )
            else:
                return _handle_stream_unary(
                    rpc_event, state, method_handler, thread_pool
                )
        else:
            if method_handler.response_streaming:
                return _handle_unary_stream(
                    rpc_event, state, method_handler, thread_pool
                )
            else:
                return _handle_unary_unary(
                    rpc_event, state, method_handler, thread_pool
                )


def _handle_call(
    rpc_event: cygrpc.BaseEvent,
    method_with_handler: _Method,
    interceptor_pipeline: Optional[_interceptor._ServicePipeline],
    thread_pool: futures.ThreadPoolExecutor,
    concurrency_exceeded: bool,
) -> Tuple[Optional[_RPCState], Optional[futures.Future]]:
    """Handles RPC based on provided handlers.

      When receiving a call event from Core, registered method will have its
    name as tag, we pass the tag as registered_method_name to this method,
    then we can find the handler in registered_method_handlers based on
    the method name.

      For call event with unregistered method, the method name will be included
    in rpc_event.call_details.method and we need to query the generics handlers
    to find the actual handler.
    """
    if not rpc_event.success:
        return None, None
    if rpc_event.call_details.method or method_with_handler.name():
        rpc_state = _RPCState()
        try:
            method_handler = _find_method_handler(
                rpc_event,
                rpc_state,
                method_with_handler,
                interceptor_pipeline,
            )
        except Exception as exception:  # pylint: disable=broad-except
            details = "Exception servicing handler: {}".format(exception)
            _LOGGER.exception(details)
            _reject_rpc(
                rpc_event,
                rpc_state,
                cygrpc.StatusCode.unknown,
                b"Error in service handler!",
            )
            return rpc_state, None
        if method_handler is None:
            _reject_rpc(
                rpc_event,
                rpc_state,
                cygrpc.StatusCode.unimplemented,
                b"Method not found!",
            )
            return rpc_state, None
        elif concurrency_exceeded:
            _reject_rpc(
                rpc_event,
                rpc_state,
                cygrpc.StatusCode.resource_exhausted,
                b"Concurrent RPC limit exceeded!",
            )
            return rpc_state, None
        else:
            return (
                rpc_state,
                _handle_with_method_handler(
                    rpc_event, rpc_state, method_handler, thread_pool
                ),
            )
    else:
        return None, None


@enum.unique
class _ServerStage(enum.Enum):
    STOPPED = "stopped"
    STARTED = "started"
    GRACE = "grace"


class _ServerState(object):
    lock: threading.RLock
    completion_queue: cygrpc.CompletionQueue
    server: cygrpc.Server
    generic_handlers: List[grpc.GenericRpcHandler]
    registered_method_handlers: Dict[str, grpc.RpcMethodHandler]
    interceptor_pipeline: Optional[_interceptor._ServicePipeline]
    thread_pool: futures.ThreadPoolExecutor
    stage: _ServerStage
    termination_event: threading.Event
    shutdown_events: List[threading.Event]
    maximum_concurrent_rpcs: Optional[int]
    active_rpc_count: int
    rpc_states: Set[_RPCState]
    due: Set[str]
    server_deallocated: bool

    # pylint: disable=too-many-arguments
    def __init__(
        self,
        completion_queue: cygrpc.CompletionQueue,
        server: cygrpc.Server,
        generic_handlers: Sequence[grpc.GenericRpcHandler],
        interceptor_pipeline: Optional[_interceptor._ServicePipeline],
        thread_pool: futures.ThreadPoolExecutor,
        maximum_concurrent_rpcs: Optional[int],
    ):
        self.lock = threading.RLock()
        self.completion_queue = completion_queue
        self.server = server
        self.generic_handlers = list(generic_handlers)
        self.interceptor_pipeline = interceptor_pipeline
        self.thread_pool = thread_pool
        self.stage = _ServerStage.STOPPED
        self.termination_event = threading.Event()
        self.shutdown_events = [self.termination_event]
        self.maximum_concurrent_rpcs = maximum_concurrent_rpcs
        self.active_rpc_count = 0
        self.registered_method_handlers = {}

        # TODO(https://github.com/grpc/grpc/issues/6597): eliminate these fields.
        self.rpc_states = set()
        self.due = set()

        # A "volatile" flag to interrupt the daemon serving thread
        self.server_deallocated = False


def _add_generic_handlers(
    state: _ServerState, generic_handlers: Iterable[grpc.GenericRpcHandler]
) -> None:
    with state.lock:
        state.generic_handlers.extend(generic_handlers)


def _add_registered_method_handlers(
    state: _ServerState, method_handlers: Dict[str, grpc.RpcMethodHandler]
) -> None:
    with state.lock:
        state.registered_method_handlers.update(method_handlers)


def _add_insecure_port(state: _ServerState, address: bytes) -> int:
    with state.lock:
        return state.server.add_http2_port(address)


def _add_secure_port(
    state: _ServerState,
    address: bytes,
    server_credentials: grpc.ServerCredentials,
) -> int:
    with state.lock:
        return state.server.add_http2_port(
            address, server_credentials._credentials
        )


def _request_call(state: _ServerState) -> None:
    state.server.request_call(
        state.completion_queue, state.completion_queue, _REQUEST_CALL_TAG
    )
    state.due.add(_REQUEST_CALL_TAG)


def _request_registered_call(state: _ServerState, method: str) -> None:
    registered_call_tag = method
    state.server.request_registered_call(
        state.completion_queue,
        state.completion_queue,
        method,
        registered_call_tag,
    )
    state.due.add(registered_call_tag)


# TODO(https://github.com/grpc/grpc/issues/6597): delete this function.
def _stop_serving(state: _ServerState) -> bool:
    if not state.rpc_states and not state.due:
        state.server.destroy()
        for shutdown_event in state.shutdown_events:
            shutdown_event.set()
        state.stage = _ServerStage.STOPPED
        return True
    else:
        return False


def _on_call_completed(state: _ServerState) -> None:
    with state.lock:
        state.active_rpc_count -= 1


# pylint: disable=too-many-branches
def _process_event_and_continue(
    state: _ServerState, event: cygrpc.BaseEvent
) -> bool:
    should_continue = True
    if event.tag is _SHUTDOWN_TAG:
        with state.lock:
            state.due.remove(_SHUTDOWN_TAG)
            if _stop_serving(state):
                should_continue = False
    elif (
        event.tag is _REQUEST_CALL_TAG
        or event.tag in state.registered_method_handlers.keys()
    ):
        registered_method_name = None
        if event.tag in state.registered_method_handlers.keys():
            registered_method_name = event.tag
            method_with_handler = _RegisteredMethod(
                registered_method_name,
                state.registered_method_handlers.get(
                    registered_method_name, None
                ),
            )
        else:
            method_with_handler = _GenericMethod(
                state.generic_handlers,
            )
        with state.lock:
            state.due.remove(event.tag)
            concurrency_exceeded = (
                state.maximum_concurrent_rpcs is not None
                and state.active_rpc_count >= state.maximum_concurrent_rpcs
            )
            rpc_state, rpc_future = _handle_call(
                event,
                method_with_handler,
                state.interceptor_pipeline,
                state.thread_pool,
                concurrency_exceeded,
            )
            if rpc_state is not None:
                state.rpc_states.add(rpc_state)
            if rpc_future is not None:
                state.active_rpc_count += 1
                rpc_future.add_done_callback(
                    lambda unused_future: _on_call_completed(state)
                )
            if state.stage is _ServerStage.STARTED:
                if (
                    registered_method_name
                    in state.registered_method_handlers.keys()
                ):
                    _request_registered_call(state, registered_method_name)
                else:
                    _request_call(state)
            elif _stop_serving(state):
                should_continue = False
    else:
        rpc_state, callbacks = event.tag(event)
        for callback in callbacks:
            try:
                callback()
            except Exception:  # pylint: disable=broad-except
                _LOGGER.exception("Exception calling callback!")
        if rpc_state is not None:
            with state.lock:
                state.rpc_states.remove(rpc_state)
                if _stop_serving(state):
                    should_continue = False
    return should_continue


def _serve(state: _ServerState) -> None:
    while True:
        timeout = time.time() + _DEALLOCATED_SERVER_CHECK_PERIOD_S
        event = state.completion_queue.poll(timeout)
        if state.server_deallocated:
            _begin_shutdown_once(state)
        if event.completion_type != cygrpc.CompletionType.queue_timeout:
            if not _process_event_and_continue(state, event):
                return
        # We want to force the deletion of the previous event
        # ~before~ we poll again; if the event has a reference
        # to a shutdown Call object, this can induce spinlock.
        event = None


def _begin_shutdown_once(state: _ServerState) -> None:
    with state.lock:
        if state.stage is _ServerStage.STARTED:
            state.server.shutdown(state.completion_queue, _SHUTDOWN_TAG)
            state.stage = _ServerStage.GRACE
            state.due.add(_SHUTDOWN_TAG)


def _stop(state: _ServerState, grace: Optional[float]) -> threading.Event:
    with state.lock:
        if state.stage is _ServerStage.STOPPED:
            shutdown_event = threading.Event()
            shutdown_event.set()
            return shutdown_event
        else:
            _begin_shutdown_once(state)
            shutdown_event = threading.Event()
            state.shutdown_events.append(shutdown_event)
            if grace is None:
                state.server.cancel_all_calls()
            else:

                def cancel_all_calls_after_grace():
                    shutdown_event.wait(timeout=grace)
                    with state.lock:
                        state.server.cancel_all_calls()

                thread = threading.Thread(target=cancel_all_calls_after_grace)
                thread.start()
                return shutdown_event
    shutdown_event.wait()
    return shutdown_event


def _start(state: _ServerState) -> None:
    with state.lock:
        if state.stage is not _ServerStage.STOPPED:
            raise ValueError("Cannot start already-started server!")
        state.server.start()
        state.stage = _ServerStage.STARTED
        # Request a call for each registered method so we can handle any of them.
        for method in state.registered_method_handlers.keys():
            _request_registered_call(state, method)
        # Also request a call for non-registered method.
        _request_call(state)
        thread = threading.Thread(target=_serve, args=(state,))
        thread.daemon = True
        thread.start()


def _validate_generic_rpc_handlers(
    generic_rpc_handlers: Iterable[grpc.GenericRpcHandler],
) -> None:
    for generic_rpc_handler in generic_rpc_handlers:
        service_attribute = getattr(generic_rpc_handler, "service", None)
        if service_attribute is None:
            raise AttributeError(
                '"{}" must conform to grpc.GenericRpcHandler type but does '
                'not have "service" method!'.format(generic_rpc_handler)
            )


def _augment_options(
    base_options: Sequence[ChannelArgumentType],
    compression: Optional[grpc.Compression],
    xds: bool,
) -> Sequence[ChannelArgumentType]:
    compression_option = _compression.create_channel_option(compression)
    maybe_server_call_tracer_factory_option = (
        _observability.create_server_call_tracer_factory_option(xds)
    )
    return (
        tuple(base_options)
        + compression_option
        + maybe_server_call_tracer_factory_option
    )


class _Server(grpc.Server):
    _state: _ServerState

    # pylint: disable=too-many-arguments
    def __init__(
        self,
        thread_pool: futures.ThreadPoolExecutor,
        generic_handlers: Sequence[grpc.GenericRpcHandler],
        interceptors: Sequence[grpc.ServerInterceptor],
        options: Sequence[ChannelArgumentType],
        maximum_concurrent_rpcs: Optional[int],
        compression: Optional[grpc.Compression],
        xds: bool,
    ):
        completion_queue = cygrpc.CompletionQueue()
        server = cygrpc.Server(_augment_options(options, compression, xds), xds)
        server.register_completion_queue(completion_queue)
        self._state = _ServerState(
            completion_queue,
            server,
            generic_handlers,
            _interceptor.service_pipeline(interceptors),
            thread_pool,
            maximum_concurrent_rpcs,
        )
        self._cy_server = server

    def add_generic_rpc_handlers(
        self, generic_rpc_handlers: Iterable[grpc.GenericRpcHandler]
    ) -> None:
        _validate_generic_rpc_handlers(generic_rpc_handlers)
        _add_generic_handlers(self._state, generic_rpc_handlers)

    def add_registered_method_handlers(
        self,
        service_name: str,
        method_handlers: Dict[str, grpc.RpcMethodHandler],
    ) -> None:
        # Can't register method once server started.
        with self._state.lock:
            if self._state.stage is _ServerStage.STARTED:
                return

        # TODO(xuanwn): We should validate method_handlers first.
        method_to_handlers = {
            _common.fully_qualified_method(service_name, method): method_handler
            for method, method_handler in method_handlers.items()
        }
        for fully_qualified_method in method_to_handlers.keys():
            self._cy_server.register_method(fully_qualified_method)
        _add_registered_method_handlers(self._state, method_to_handlers)

    def add_insecure_port(self, address: str) -> int:
        return _common.validate_port_binding_result(
            address, _add_insecure_port(self._state, _common.encode(address))
        )

    def add_secure_port(
        self, address: str, server_credentials: grpc.ServerCredentials
    ) -> int:
        return _common.validate_port_binding_result(
            address,
            _add_secure_port(
                self._state, _common.encode(address), server_credentials
            ),
        )

    def start(self) -> None:
        _start(self._state)

    def wait_for_termination(self, timeout: Optional[float] = None) -> bool:
        # NOTE(https://bugs.python.org/issue35935)
        # Remove this workaround once threading.Event.wait() is working with
        # CTRL+C across platforms.
        return _common.wait(
            self._state.termination_event.wait,
            self._state.termination_event.is_set,
            timeout=timeout,
        )

    def stop(self, grace: Optional[float]) -> threading.Event:
        return _stop(self._state, grace)

    def __del__(self):
        if hasattr(self, "_state"):
            # We can not grab a lock in __del__(), so set a flag to signal the
            # serving daemon thread (if it exists) to initiate shutdown.
            self._state.server_deallocated = True


def create_server(
    thread_pool: futures.ThreadPoolExecutor,
    generic_rpc_handlers: Sequence[grpc.GenericRpcHandler],
    interceptors: Sequence[grpc.ServerInterceptor],
    options: Sequence[ChannelArgumentType],
    maximum_concurrent_rpcs: Optional[int],
    compression: Optional[grpc.Compression],
    xds: bool,
) -> _Server:
    _validate_generic_rpc_handlers(generic_rpc_handlers)
    return _Server(
        thread_pool,
        generic_rpc_handlers,
        interceptors,
        options,
        maximum_concurrent_rpcs,
        compression,
        xds,
    )
