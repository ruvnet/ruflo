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
"""Translates gRPC's server-side API into gRPC's server-side Beta API."""

import collections
import threading

import grpc
from grpc import _common
from grpc.beta import _metadata
from grpc.beta import interfaces
from grpc.framework.common import cardinality
from grpc.framework.common import style
from grpc.framework.foundation import abandonment
from grpc.framework.foundation import logging_pool
from grpc.framework.foundation import stream
from grpc.framework.interfaces.face import face

# pylint: disable=too-many-return-statements

_DEFAULT_POOL_SIZE = 8


class _ServerProtocolContext(interfaces.GRPCServicerContext):
    def __init__(self, servicer_context):
        self._servicer_context = servicer_context

    def peer(self):
        return self._servicer_context.peer()

    def disable_next_response_compression(self):
        pass  # TODO(https://github.com/grpc/grpc/issues/4078): design, implement.


class _FaceServicerContext(face.ServicerContext):
    def __init__(self, servicer_context):
        self._servicer_context = servicer_context

    def is_active(self):
        return self._servicer_context.is_active()

    def time_remaining(self):
        return self._servicer_context.time_remaining()

    def add_abortion_callback(self, abortion_callback):
        raise NotImplementedError(
            "add_abortion_callback no longer supported server-side!"
        )

    def cancel(self):
        self._servicer_context.cancel()

    def protocol_context(self):
        return _ServerProtocolContext(self._servicer_context)

    def invocation_metadata(self):
        return _metadata.beta(self._servicer_context.invocation_metadata())

    def initial_metadata(self, initial_metadata):
        self._servicer_context.send_initial_metadata(
            _metadata.unbeta(initial_metadata)
        )

    def terminal_metadata(self, terminal_metadata):
        self._servicer_context.set_terminal_metadata(
            _metadata.unbeta(terminal_metadata)
        )

    def code(self, code):
        self._servicer_context.set_code(code)

    def details(self, details):
        self._servicer_context.set_details(details)


def _adapt_unary_request_inline(unary_request_inline):
    def adaptation(request, servicer_context):
        return unary_request_inline(
            request, _FaceServicerContext(servicer_context)
        )

    return adaptation


def _adapt_stream_request_inline(stream_request_inline):
    def adaptation(request_iterator, servicer_context):
        return stream_request_inline(
            request_iterator, _FaceServicerContext(servicer_context)
        )

    return adaptation


class _Callback(stream.Consumer):
    def __init__(self):
        self._condition = threading.Condition()
        self._values = []
        self._terminated = False
        self._cancelled = False

    def consume(self, value):
        with self._condition:
            self._values.append(value)
            self._condition.notify_all()

    def terminate(self):
        with self._condition:
            self._terminated = True
            self._condition.notify_all()

    def consume_and_terminate(self, value):
        with self._condition:
            self._values.append(value)
            self._terminated = True
            self._condition.notify_all()

    def cancel(self):
        with self._condition:
            self._cancelled = True
            self._condition.notify_all()

    def draw_one_value(self):
        with self._condition:
            while True:
                if self._cancelled:
                    raise abandonment.Abandoned()
                elif self._values:
                    return self._values.pop(0)
                elif self._terminated:
                    return None
                else:
                    self._condition.wait()

    def draw_all_values(self):
        with self._condition:
            while True:
                if self._cancelled:
                    raise abandonment.Abandoned()
                elif self._terminated:
                    all_values = tuple(self._values)
                    self._values = None
                    return all_values
                else:
                    self._condition.wait()


def _run_request_pipe_thread(
    request_iterator, request_consumer, servicer_context
):
    thread_joined = threading.Event()

    def pipe_requests():
        for request in request_iterator:
            if not servicer_context.is_active() or thread_joined.is_set():
                return
            request_consumer.consume(request)
            if not servicer_context.is_active() or thread_joined.is_set():
                return
        request_consumer.terminate()

    request_pipe_thread = threading.Thread(target=pipe_requests)
    request_pipe_thread.daemon = True
    request_pipe_thread.start()


def _adapt_unary_unary_event(unary_unary_event):
    def adaptation(request, servicer_context):
        callback = _Callback()
        if not servicer_context.add_callback(callback.cancel):
            raise abandonment.Abandoned()
        unary_unary_event(
            request,
            callback.consume_and_terminate,
            _FaceServicerContext(servicer_context),
        )
        return callback.draw_all_values()[0]

    return adaptation


def _adapt_unary_stream_event(unary_stream_event):
    def adaptation(request, servicer_context):
        callback = _Callback()
        if not servicer_context.add_callback(callback.cancel):
            raise abandonment.Abandoned()
        unary_stream_event(
            request, callback, _FaceServicerContext(servicer_context)
        )
        while True:
            response = callback.draw_one_value()
            if response is None:
                return
            else:
                yield response

    return adaptation


def _adapt_stream_unary_event(stream_unary_event):
    def adaptation(request_iterator, servicer_context):
        callback = _Callback()
        if not servicer_context.add_callback(callback.cancel):
            raise abandonment.Abandoned()
        request_consumer = stream_unary_event(
            callback.consume_and_terminate,
            _FaceServicerContext(servicer_context),
        )
        _run_request_pipe_thread(
            request_iterator, request_consumer, servicer_context
        )
        return callback.draw_all_values()[0]

    return adaptation


def _adapt_stream_stream_event(stream_stream_event):
    def adaptation(request_iterator, servicer_context):
        callback = _Callback()
        if not servicer_context.add_callback(callback.cancel):
            raise abandonment.Abandoned()
        request_consumer = stream_stream_event(
            callback, _FaceServicerContext(servicer_context)
        )
        _run_request_pipe_thread(
            request_iterator, request_consumer, servicer_context
        )
        while True:
            response = callback.draw_one_value()
            if response is None:
                return
            else:
                yield response

    return adaptation


class _SimpleMethodHandler(
    collections.namedtuple(
        "_MethodHandler",
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


def _simple_method_handler(
    implementation, request_deserializer, response_serializer
):
    if implementation.style is style.Service.INLINE:
        if implementation.cardinality is cardinality.Cardinality.UNARY_UNARY:
            return _SimpleMethodHandler(
                False,
                False,
                request_deserializer,
                response_serializer,
                _adapt_unary_request_inline(implementation.unary_unary_inline),
                None,
                None,
                None,
            )
        elif implementation.cardinality is cardinality.Cardinality.UNARY_STREAM:
            return _SimpleMethodHandler(
                False,
                True,
                request_deserializer,
                response_serializer,
                None,
                _adapt_unary_request_inline(implementation.unary_stream_inline),
                None,
                None,
            )
        elif implementation.cardinality is cardinality.Cardinality.STREAM_UNARY:
            return _SimpleMethodHandler(
                True,
                False,
                request_deserializer,
                response_serializer,
                None,
                None,
                _adapt_stream_request_inline(
                    implementation.stream_unary_inline
                ),
                None,
            )
        elif (
            implementation.cardinality is cardinality.Cardinality.STREAM_STREAM
        ):
            return _SimpleMethodHandler(
                True,
                True,
                request_deserializer,
                response_serializer,
                None,
                None,
                None,
                _adapt_stream_request_inline(
                    implementation.stream_stream_inline
                ),
            )
    elif implementation.style is style.Service.EVENT:
        if implementation.cardinality is cardinality.Cardinality.UNARY_UNARY:
            return _SimpleMethodHandler(
                False,
                False,
                request_deserializer,
                response_serializer,
                _adapt_unary_unary_event(implementation.unary_unary_event),
                None,
                None,
                None,
            )
        elif implementation.cardinality is cardinality.Cardinality.UNARY_STREAM:
            return _SimpleMethodHandler(
                False,
                True,
                request_deserializer,
                response_serializer,
                None,
                _adapt_unary_stream_event(implementation.unary_stream_event),
                None,
                None,
            )
        elif implementation.cardinality is cardinality.Cardinality.STREAM_UNARY:
            return _SimpleMethodHandler(
                True,
                False,
                request_deserializer,
                response_serializer,
                None,
                None,
                _adapt_stream_unary_event(implementation.stream_unary_event),
                None,
            )
        elif (
            implementation.cardinality is cardinality.Cardinality.STREAM_STREAM
        ):
            return _SimpleMethodHandler(
                True,
                True,
                request_deserializer,
                response_serializer,
                None,
                None,
                None,
                _adapt_stream_stream_event(implementation.stream_stream_event),
            )
    raise ValueError()


def _flatten_method_pair_map(method_pair_map):
    method_pair_map = method_pair_map or {}
    flat_map = {}
    for method_pair in method_pair_map:
        method = _common.fully_qualified_method(method_pair[0], method_pair[1])
        flat_map[method] = method_pair_map[method_pair]
    return flat_map


class _GenericRpcHandler(grpc.GenericRpcHandler):
    def __init__(
        self,
        method_implementations,
        multi_method_implementation,
        request_deserializers,
        response_serializers,
    ):
        self._method_implementations = _flatten_method_pair_map(
            method_implementations
        )
        self._request_deserializers = _flatten_method_pair_map(
            request_deserializers
        )
        self._response_serializers = _flatten_method_pair_map(
            response_serializers
        )
        self._multi_method_implementation = multi_method_implementation

    def service(self, handler_call_details):
        method_implementation = self._method_implementations.get(
            handler_call_details.method
        )
        if method_implementation is not None:
            return _simple_method_handler(
                method_implementation,
                self._request_deserializers.get(handler_call_details.method),
                self._response_serializers.get(handler_call_details.method),
            )
        elif self._multi_method_implementation is None:
            return None
        else:
            try:
                return None  # TODO(nathaniel): call the multimethod.
            except face.NoSuchMethodError:
                return None


class _Server(interfaces.Server):
    def __init__(self, grpc_server):
        self._grpc_server = grpc_server

    def add_insecure_port(self, address):
        return self._grpc_server.add_insecure_port(address)

    def add_secure_port(self, address, server_credentials):
        return self._grpc_server.add_secure_port(address, server_credentials)

    def start(self):
        self._grpc_server.start()

    def stop(self, grace):
        return self._grpc_server.stop(grace)

    def __enter__(self):
        self._grpc_server.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self._grpc_server.stop(None)
        return False


def server(
    service_implementations,
    multi_method_implementation,
    request_deserializers,
    response_serializers,
    thread_pool,
    thread_pool_size,
):
    generic_rpc_handler = _GenericRpcHandler(
        service_implementations,
        multi_method_implementation,
        request_deserializers,
        response_serializers,
    )
    if thread_pool is None:
        effective_thread_pool = logging_pool.pool(
            _DEFAULT_POOL_SIZE if thread_pool_size is None else thread_pool_size
        )
    else:
        effective_thread_pool = thread_pool
    return _Server(
        grpc.server(effective_thread_pool, handlers=(generic_rpc_handler,))
    )
