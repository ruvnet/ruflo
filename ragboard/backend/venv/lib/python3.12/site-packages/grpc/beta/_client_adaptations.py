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
"""Translates gRPC's client-side API into gRPC's client-side Beta API."""

import grpc
from grpc import _common
from grpc.beta import _metadata
from grpc.beta import interfaces
from grpc.framework.common import cardinality
from grpc.framework.foundation import future
from grpc.framework.interfaces.face import face

# pylint: disable=too-many-arguments,too-many-locals,unused-argument

_STATUS_CODE_TO_ABORTION_KIND_AND_ABORTION_ERROR_CLASS = {
    grpc.StatusCode.CANCELLED: (
        face.Abortion.Kind.CANCELLED,
        face.CancellationError,
    ),
    grpc.StatusCode.UNKNOWN: (
        face.Abortion.Kind.REMOTE_FAILURE,
        face.RemoteError,
    ),
    grpc.StatusCode.DEADLINE_EXCEEDED: (
        face.Abortion.Kind.EXPIRED,
        face.ExpirationError,
    ),
    grpc.StatusCode.UNIMPLEMENTED: (
        face.Abortion.Kind.LOCAL_FAILURE,
        face.LocalError,
    ),
}


def _effective_metadata(metadata, metadata_transformer):
    non_none_metadata = () if metadata is None else metadata
    if metadata_transformer is None:
        return non_none_metadata
    else:
        return metadata_transformer(non_none_metadata)


def _credentials(grpc_call_options):
    return None if grpc_call_options is None else grpc_call_options.credentials


def _abortion(rpc_error_call):
    code = rpc_error_call.code()
    pair = _STATUS_CODE_TO_ABORTION_KIND_AND_ABORTION_ERROR_CLASS.get(code)
    error_kind = face.Abortion.Kind.LOCAL_FAILURE if pair is None else pair[0]
    return face.Abortion(
        error_kind,
        rpc_error_call.initial_metadata(),
        rpc_error_call.trailing_metadata(),
        code,
        rpc_error_call.details(),
    )


def _abortion_error(rpc_error_call):
    code = rpc_error_call.code()
    pair = _STATUS_CODE_TO_ABORTION_KIND_AND_ABORTION_ERROR_CLASS.get(code)
    exception_class = face.AbortionError if pair is None else pair[1]
    return exception_class(
        rpc_error_call.initial_metadata(),
        rpc_error_call.trailing_metadata(),
        code,
        rpc_error_call.details(),
    )


class _InvocationProtocolContext(interfaces.GRPCInvocationContext):
    def disable_next_request_compression(self):
        pass  # TODO(https://github.com/grpc/grpc/issues/4078): design, implement.


class _Rendezvous(future.Future, face.Call):
    def __init__(self, response_future, response_iterator, call):
        self._future = response_future
        self._iterator = response_iterator
        self._call = call

    def cancel(self):
        return self._call.cancel()

    def cancelled(self):
        return self._future.cancelled()

    def running(self):
        return self._future.running()

    def done(self):
        return self._future.done()

    def result(self, timeout=None):
        try:
            return self._future.result(timeout=timeout)
        except grpc.RpcError as rpc_error_call:
            raise _abortion_error(rpc_error_call)
        except grpc.FutureTimeoutError:
            raise future.TimeoutError()
        except grpc.FutureCancelledError:
            raise future.CancelledError()

    def exception(self, timeout=None):
        try:
            rpc_error_call = self._future.exception(timeout=timeout)
            if rpc_error_call is None:
                return None
            else:
                return _abortion_error(rpc_error_call)
        except grpc.FutureTimeoutError:
            raise future.TimeoutError()
        except grpc.FutureCancelledError:
            raise future.CancelledError()

    def traceback(self, timeout=None):
        try:
            return self._future.traceback(timeout=timeout)
        except grpc.FutureTimeoutError:
            raise future.TimeoutError()
        except grpc.FutureCancelledError:
            raise future.CancelledError()

    def add_done_callback(self, fn):
        self._future.add_done_callback(lambda ignored_callback: fn(self))

    def __iter__(self):
        return self

    def _next(self):
        try:
            return next(self._iterator)
        except grpc.RpcError as rpc_error_call:
            raise _abortion_error(rpc_error_call)

    def __next__(self):
        return self._next()

    def next(self):
        return self._next()

    def is_active(self):
        return self._call.is_active()

    def time_remaining(self):
        return self._call.time_remaining()

    def add_abortion_callback(self, abortion_callback):
        def done_callback():
            if self.code() is not grpc.StatusCode.OK:
                abortion_callback(_abortion(self._call))

        registered = self._call.add_callback(done_callback)
        return None if registered else done_callback()

    def protocol_context(self):
        return _InvocationProtocolContext()

    def initial_metadata(self):
        return _metadata.beta(self._call.initial_metadata())

    def terminal_metadata(self):
        return _metadata.beta(self._call.terminal_metadata())

    def code(self):
        return self._call.code()

    def details(self):
        return self._call.details()


def _blocking_unary_unary(
    channel,
    group,
    method,
    timeout,
    with_call,
    protocol_options,
    metadata,
    metadata_transformer,
    request,
    request_serializer,
    response_deserializer,
):
    try:
        multi_callable = channel.unary_unary(
            _common.fully_qualified_method(group, method),
            request_serializer=request_serializer,
            response_deserializer=response_deserializer,
        )
        effective_metadata = _effective_metadata(metadata, metadata_transformer)
        if with_call:
            response, call = multi_callable.with_call(
                request,
                timeout=timeout,
                metadata=_metadata.unbeta(effective_metadata),
                credentials=_credentials(protocol_options),
            )
            return response, _Rendezvous(None, None, call)
        else:
            return multi_callable(
                request,
                timeout=timeout,
                metadata=_metadata.unbeta(effective_metadata),
                credentials=_credentials(protocol_options),
            )
    except grpc.RpcError as rpc_error_call:
        raise _abortion_error(rpc_error_call)


def _future_unary_unary(
    channel,
    group,
    method,
    timeout,
    protocol_options,
    metadata,
    metadata_transformer,
    request,
    request_serializer,
    response_deserializer,
):
    multi_callable = channel.unary_unary(
        _common.fully_qualified_method(group, method),
        request_serializer=request_serializer,
        response_deserializer=response_deserializer,
    )
    effective_metadata = _effective_metadata(metadata, metadata_transformer)
    response_future = multi_callable.future(
        request,
        timeout=timeout,
        metadata=_metadata.unbeta(effective_metadata),
        credentials=_credentials(protocol_options),
    )
    return _Rendezvous(response_future, None, response_future)


def _unary_stream(
    channel,
    group,
    method,
    timeout,
    protocol_options,
    metadata,
    metadata_transformer,
    request,
    request_serializer,
    response_deserializer,
):
    multi_callable = channel.unary_stream(
        _common.fully_qualified_method(group, method),
        request_serializer=request_serializer,
        response_deserializer=response_deserializer,
    )
    effective_metadata = _effective_metadata(metadata, metadata_transformer)
    response_iterator = multi_callable(
        request,
        timeout=timeout,
        metadata=_metadata.unbeta(effective_metadata),
        credentials=_credentials(protocol_options),
    )
    return _Rendezvous(None, response_iterator, response_iterator)


def _blocking_stream_unary(
    channel,
    group,
    method,
    timeout,
    with_call,
    protocol_options,
    metadata,
    metadata_transformer,
    request_iterator,
    request_serializer,
    response_deserializer,
):
    try:
        multi_callable = channel.stream_unary(
            _common.fully_qualified_method(group, method),
            request_serializer=request_serializer,
            response_deserializer=response_deserializer,
        )
        effective_metadata = _effective_metadata(metadata, metadata_transformer)
        if with_call:
            response, call = multi_callable.with_call(
                request_iterator,
                timeout=timeout,
                metadata=_metadata.unbeta(effective_metadata),
                credentials=_credentials(protocol_options),
            )
            return response, _Rendezvous(None, None, call)
        else:
            return multi_callable(
                request_iterator,
                timeout=timeout,
                metadata=_metadata.unbeta(effective_metadata),
                credentials=_credentials(protocol_options),
            )
    except grpc.RpcError as rpc_error_call:
        raise _abortion_error(rpc_error_call)


def _future_stream_unary(
    channel,
    group,
    method,
    timeout,
    protocol_options,
    metadata,
    metadata_transformer,
    request_iterator,
    request_serializer,
    response_deserializer,
):
    multi_callable = channel.stream_unary(
        _common.fully_qualified_method(group, method),
        request_serializer=request_serializer,
        response_deserializer=response_deserializer,
    )
    effective_metadata = _effective_metadata(metadata, metadata_transformer)
    response_future = multi_callable.future(
        request_iterator,
        timeout=timeout,
        metadata=_metadata.unbeta(effective_metadata),
        credentials=_credentials(protocol_options),
    )
    return _Rendezvous(response_future, None, response_future)


def _stream_stream(
    channel,
    group,
    method,
    timeout,
    protocol_options,
    metadata,
    metadata_transformer,
    request_iterator,
    request_serializer,
    response_deserializer,
):
    multi_callable = channel.stream_stream(
        _common.fully_qualified_method(group, method),
        request_serializer=request_serializer,
        response_deserializer=response_deserializer,
    )
    effective_metadata = _effective_metadata(metadata, metadata_transformer)
    response_iterator = multi_callable(
        request_iterator,
        timeout=timeout,
        metadata=_metadata.unbeta(effective_metadata),
        credentials=_credentials(protocol_options),
    )
    return _Rendezvous(None, response_iterator, response_iterator)


class _UnaryUnaryMultiCallable(face.UnaryUnaryMultiCallable):
    def __init__(
        self,
        channel,
        group,
        method,
        metadata_transformer,
        request_serializer,
        response_deserializer,
    ):
        self._channel = channel
        self._group = group
        self._method = method
        self._metadata_transformer = metadata_transformer
        self._request_serializer = request_serializer
        self._response_deserializer = response_deserializer

    def __call__(
        self,
        request,
        timeout,
        metadata=None,
        with_call=False,
        protocol_options=None,
    ):
        return _blocking_unary_unary(
            self._channel,
            self._group,
            self._method,
            timeout,
            with_call,
            protocol_options,
            metadata,
            self._metadata_transformer,
            request,
            self._request_serializer,
            self._response_deserializer,
        )

    def future(self, request, timeout, metadata=None, protocol_options=None):
        return _future_unary_unary(
            self._channel,
            self._group,
            self._method,
            timeout,
            protocol_options,
            metadata,
            self._metadata_transformer,
            request,
            self._request_serializer,
            self._response_deserializer,
        )

    def event(
        self,
        request,
        receiver,
        abortion_callback,
        timeout,
        metadata=None,
        protocol_options=None,
    ):
        raise NotImplementedError()


class _UnaryStreamMultiCallable(face.UnaryStreamMultiCallable):
    def __init__(
        self,
        channel,
        group,
        method,
        metadata_transformer,
        request_serializer,
        response_deserializer,
    ):
        self._channel = channel
        self._group = group
        self._method = method
        self._metadata_transformer = metadata_transformer
        self._request_serializer = request_serializer
        self._response_deserializer = response_deserializer

    def __call__(self, request, timeout, metadata=None, protocol_options=None):
        return _unary_stream(
            self._channel,
            self._group,
            self._method,
            timeout,
            protocol_options,
            metadata,
            self._metadata_transformer,
            request,
            self._request_serializer,
            self._response_deserializer,
        )

    def event(
        self,
        request,
        receiver,
        abortion_callback,
        timeout,
        metadata=None,
        protocol_options=None,
    ):
        raise NotImplementedError()


class _StreamUnaryMultiCallable(face.StreamUnaryMultiCallable):
    def __init__(
        self,
        channel,
        group,
        method,
        metadata_transformer,
        request_serializer,
        response_deserializer,
    ):
        self._channel = channel
        self._group = group
        self._method = method
        self._metadata_transformer = metadata_transformer
        self._request_serializer = request_serializer
        self._response_deserializer = response_deserializer

    def __call__(
        self,
        request_iterator,
        timeout,
        metadata=None,
        with_call=False,
        protocol_options=None,
    ):
        return _blocking_stream_unary(
            self._channel,
            self._group,
            self._method,
            timeout,
            with_call,
            protocol_options,
            metadata,
            self._metadata_transformer,
            request_iterator,
            self._request_serializer,
            self._response_deserializer,
        )

    def future(
        self, request_iterator, timeout, metadata=None, protocol_options=None
    ):
        return _future_stream_unary(
            self._channel,
            self._group,
            self._method,
            timeout,
            protocol_options,
            metadata,
            self._metadata_transformer,
            request_iterator,
            self._request_serializer,
            self._response_deserializer,
        )

    def event(
        self,
        receiver,
        abortion_callback,
        timeout,
        metadata=None,
        protocol_options=None,
    ):
        raise NotImplementedError()


class _StreamStreamMultiCallable(face.StreamStreamMultiCallable):
    def __init__(
        self,
        channel,
        group,
        method,
        metadata_transformer,
        request_serializer,
        response_deserializer,
    ):
        self._channel = channel
        self._group = group
        self._method = method
        self._metadata_transformer = metadata_transformer
        self._request_serializer = request_serializer
        self._response_deserializer = response_deserializer

    def __call__(
        self, request_iterator, timeout, metadata=None, protocol_options=None
    ):
        return _stream_stream(
            self._channel,
            self._group,
            self._method,
            timeout,
            protocol_options,
            metadata,
            self._metadata_transformer,
            request_iterator,
            self._request_serializer,
            self._response_deserializer,
        )

    def event(
        self,
        receiver,
        abortion_callback,
        timeout,
        metadata=None,
        protocol_options=None,
    ):
        raise NotImplementedError()


class _GenericStub(face.GenericStub):
    def __init__(
        self,
        channel,
        metadata_transformer,
        request_serializers,
        response_deserializers,
    ):
        self._channel = channel
        self._metadata_transformer = metadata_transformer
        self._request_serializers = request_serializers or {}
        self._response_deserializers = response_deserializers or {}

    def blocking_unary_unary(
        self,
        group,
        method,
        request,
        timeout,
        metadata=None,
        with_call=None,
        protocol_options=None,
    ):
        request_serializer = self._request_serializers.get(
            (
                group,
                method,
            )
        )
        response_deserializer = self._response_deserializers.get(
            (
                group,
                method,
            )
        )
        return _blocking_unary_unary(
            self._channel,
            group,
            method,
            timeout,
            with_call,
            protocol_options,
            metadata,
            self._metadata_transformer,
            request,
            request_serializer,
            response_deserializer,
        )

    def future_unary_unary(
        self,
        group,
        method,
        request,
        timeout,
        metadata=None,
        protocol_options=None,
    ):
        request_serializer = self._request_serializers.get(
            (
                group,
                method,
            )
        )
        response_deserializer = self._response_deserializers.get(
            (
                group,
                method,
            )
        )
        return _future_unary_unary(
            self._channel,
            group,
            method,
            timeout,
            protocol_options,
            metadata,
            self._metadata_transformer,
            request,
            request_serializer,
            response_deserializer,
        )

    def inline_unary_stream(
        self,
        group,
        method,
        request,
        timeout,
        metadata=None,
        protocol_options=None,
    ):
        request_serializer = self._request_serializers.get(
            (
                group,
                method,
            )
        )
        response_deserializer = self._response_deserializers.get(
            (
                group,
                method,
            )
        )
        return _unary_stream(
            self._channel,
            group,
            method,
            timeout,
            protocol_options,
            metadata,
            self._metadata_transformer,
            request,
            request_serializer,
            response_deserializer,
        )

    def blocking_stream_unary(
        self,
        group,
        method,
        request_iterator,
        timeout,
        metadata=None,
        with_call=None,
        protocol_options=None,
    ):
        request_serializer = self._request_serializers.get(
            (
                group,
                method,
            )
        )
        response_deserializer = self._response_deserializers.get(
            (
                group,
                method,
            )
        )
        return _blocking_stream_unary(
            self._channel,
            group,
            method,
            timeout,
            with_call,
            protocol_options,
            metadata,
            self._metadata_transformer,
            request_iterator,
            request_serializer,
            response_deserializer,
        )

    def future_stream_unary(
        self,
        group,
        method,
        request_iterator,
        timeout,
        metadata=None,
        protocol_options=None,
    ):
        request_serializer = self._request_serializers.get(
            (
                group,
                method,
            )
        )
        response_deserializer = self._response_deserializers.get(
            (
                group,
                method,
            )
        )
        return _future_stream_unary(
            self._channel,
            group,
            method,
            timeout,
            protocol_options,
            metadata,
            self._metadata_transformer,
            request_iterator,
            request_serializer,
            response_deserializer,
        )

    def inline_stream_stream(
        self,
        group,
        method,
        request_iterator,
        timeout,
        metadata=None,
        protocol_options=None,
    ):
        request_serializer = self._request_serializers.get(
            (
                group,
                method,
            )
        )
        response_deserializer = self._response_deserializers.get(
            (
                group,
                method,
            )
        )
        return _stream_stream(
            self._channel,
            group,
            method,
            timeout,
            protocol_options,
            metadata,
            self._metadata_transformer,
            request_iterator,
            request_serializer,
            response_deserializer,
        )

    def event_unary_unary(
        self,
        group,
        method,
        request,
        receiver,
        abortion_callback,
        timeout,
        metadata=None,
        protocol_options=None,
    ):
        raise NotImplementedError()

    def event_unary_stream(
        self,
        group,
        method,
        request,
        receiver,
        abortion_callback,
        timeout,
        metadata=None,
        protocol_options=None,
    ):
        raise NotImplementedError()

    def event_stream_unary(
        self,
        group,
        method,
        receiver,
        abortion_callback,
        timeout,
        metadata=None,
        protocol_options=None,
    ):
        raise NotImplementedError()

    def event_stream_stream(
        self,
        group,
        method,
        receiver,
        abortion_callback,
        timeout,
        metadata=None,
        protocol_options=None,
    ):
        raise NotImplementedError()

    def unary_unary(self, group, method):
        request_serializer = self._request_serializers.get(
            (
                group,
                method,
            )
        )
        response_deserializer = self._response_deserializers.get(
            (
                group,
                method,
            )
        )
        return _UnaryUnaryMultiCallable(
            self._channel,
            group,
            method,
            self._metadata_transformer,
            request_serializer,
            response_deserializer,
        )

    def unary_stream(self, group, method):
        request_serializer = self._request_serializers.get(
            (
                group,
                method,
            )
        )
        response_deserializer = self._response_deserializers.get(
            (
                group,
                method,
            )
        )
        return _UnaryStreamMultiCallable(
            self._channel,
            group,
            method,
            self._metadata_transformer,
            request_serializer,
            response_deserializer,
        )

    def stream_unary(self, group, method):
        request_serializer = self._request_serializers.get(
            (
                group,
                method,
            )
        )
        response_deserializer = self._response_deserializers.get(
            (
                group,
                method,
            )
        )
        return _StreamUnaryMultiCallable(
            self._channel,
            group,
            method,
            self._metadata_transformer,
            request_serializer,
            response_deserializer,
        )

    def stream_stream(self, group, method):
        request_serializer = self._request_serializers.get(
            (
                group,
                method,
            )
        )
        response_deserializer = self._response_deserializers.get(
            (
                group,
                method,
            )
        )
        return _StreamStreamMultiCallable(
            self._channel,
            group,
            method,
            self._metadata_transformer,
            request_serializer,
            response_deserializer,
        )

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        return False


class _DynamicStub(face.DynamicStub):
    def __init__(self, backing_generic_stub, group, cardinalities):
        self._generic_stub = backing_generic_stub
        self._group = group
        self._cardinalities = cardinalities

    def __getattr__(self, attr):
        method_cardinality = self._cardinalities.get(attr)
        if method_cardinality is cardinality.Cardinality.UNARY_UNARY:
            return self._generic_stub.unary_unary(self._group, attr)
        elif method_cardinality is cardinality.Cardinality.UNARY_STREAM:
            return self._generic_stub.unary_stream(self._group, attr)
        elif method_cardinality is cardinality.Cardinality.STREAM_UNARY:
            return self._generic_stub.stream_unary(self._group, attr)
        elif method_cardinality is cardinality.Cardinality.STREAM_STREAM:
            return self._generic_stub.stream_stream(self._group, attr)
        else:
            raise AttributeError(
                '_DynamicStub object has no attribute "%s"!' % attr
            )

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        return False


def generic_stub(
    channel,
    host,
    metadata_transformer,
    request_serializers,
    response_deserializers,
):
    return _GenericStub(
        channel,
        metadata_transformer,
        request_serializers,
        response_deserializers,
    )


def dynamic_stub(
    channel,
    service,
    cardinalities,
    host,
    metadata_transformer,
    request_serializers,
    response_deserializers,
):
    return _DynamicStub(
        _GenericStub(
            channel,
            metadata_transformer,
            request_serializers,
            response_deserializers,
        ),
        service,
        cardinalities,
    )
