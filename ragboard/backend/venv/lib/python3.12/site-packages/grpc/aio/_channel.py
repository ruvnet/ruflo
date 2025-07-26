# Copyright 2019 gRPC authors.
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
"""Invocation-side implementation of gRPC Asyncio Python."""

import asyncio
import sys
from typing import Any, Iterable, List, Optional, Sequence

import grpc
from grpc import _common
from grpc import _compression
from grpc import _grpcio_metadata
from grpc._cython import cygrpc

from . import _base_call
from . import _base_channel
from ._call import StreamStreamCall
from ._call import StreamUnaryCall
from ._call import UnaryStreamCall
from ._call import UnaryUnaryCall
from ._interceptor import ClientInterceptor
from ._interceptor import InterceptedStreamStreamCall
from ._interceptor import InterceptedStreamUnaryCall
from ._interceptor import InterceptedUnaryStreamCall
from ._interceptor import InterceptedUnaryUnaryCall
from ._interceptor import StreamStreamClientInterceptor
from ._interceptor import StreamUnaryClientInterceptor
from ._interceptor import UnaryStreamClientInterceptor
from ._interceptor import UnaryUnaryClientInterceptor
from ._metadata import Metadata
from ._typing import ChannelArgumentType
from ._typing import DeserializingFunction
from ._typing import MetadataType
from ._typing import RequestIterableType
from ._typing import RequestType
from ._typing import ResponseType
from ._typing import SerializingFunction
from ._utils import _timeout_to_deadline

_USER_AGENT = "grpc-python-asyncio/{}".format(_grpcio_metadata.__version__)

if sys.version_info[1] < 7:

    def _all_tasks() -> Iterable[asyncio.Task]:
        return asyncio.Task.all_tasks()  # pylint: disable=no-member

else:

    def _all_tasks() -> Iterable[asyncio.Task]:
        return asyncio.all_tasks()


def _augment_channel_arguments(
    base_options: ChannelArgumentType, compression: Optional[grpc.Compression]
):
    compression_channel_argument = _compression.create_channel_option(
        compression
    )
    user_agent_channel_argument = (
        (
            cygrpc.ChannelArgKey.primary_user_agent_string,
            _USER_AGENT,
        ),
    )
    return (
        tuple(base_options)
        + compression_channel_argument
        + user_agent_channel_argument
    )


class _BaseMultiCallable:
    """Base class of all multi callable objects.

    Handles the initialization logic and stores common attributes.
    """

    _loop: asyncio.AbstractEventLoop
    _channel: cygrpc.AioChannel
    _method: bytes
    _request_serializer: SerializingFunction
    _response_deserializer: DeserializingFunction
    _interceptors: Optional[Sequence[ClientInterceptor]]
    _references: List[Any]
    _loop: asyncio.AbstractEventLoop

    # pylint: disable=too-many-arguments
    def __init__(
        self,
        channel: cygrpc.AioChannel,
        method: bytes,
        request_serializer: SerializingFunction,
        response_deserializer: DeserializingFunction,
        interceptors: Optional[Sequence[ClientInterceptor]],
        references: List[Any],
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        self._loop = loop
        self._channel = channel
        self._method = method
        self._request_serializer = request_serializer
        self._response_deserializer = response_deserializer
        self._interceptors = interceptors
        self._references = references

    @staticmethod
    def _init_metadata(
        metadata: Optional[MetadataType] = None,
        compression: Optional[grpc.Compression] = None,
    ) -> Metadata:
        """Based on the provided values for <metadata> or <compression> initialise the final
        metadata, as it should be used for the current call.
        """
        metadata = metadata or Metadata()
        if not isinstance(metadata, Metadata) and isinstance(metadata, tuple):
            metadata = Metadata.from_tuple(metadata)
        if compression:
            metadata = Metadata(
                *_compression.augment_metadata(metadata, compression)
            )
        return metadata


class UnaryUnaryMultiCallable(
    _BaseMultiCallable, _base_channel.UnaryUnaryMultiCallable
):
    def __call__(
        self,
        request: RequestType,
        *,
        timeout: Optional[float] = None,
        metadata: Optional[MetadataType] = None,
        credentials: Optional[grpc.CallCredentials] = None,
        wait_for_ready: Optional[bool] = None,
        compression: Optional[grpc.Compression] = None,
    ) -> _base_call.UnaryUnaryCall[RequestType, ResponseType]:
        metadata = self._init_metadata(metadata, compression)
        if not self._interceptors:
            call = UnaryUnaryCall(
                request,
                _timeout_to_deadline(timeout),
                metadata,
                credentials,
                wait_for_ready,
                self._channel,
                self._method,
                self._request_serializer,
                self._response_deserializer,
                self._loop,
            )
        else:
            call = InterceptedUnaryUnaryCall(
                self._interceptors,
                request,
                timeout,
                metadata,
                credentials,
                wait_for_ready,
                self._channel,
                self._method,
                self._request_serializer,
                self._response_deserializer,
                self._loop,
            )

        return call


class UnaryStreamMultiCallable(
    _BaseMultiCallable, _base_channel.UnaryStreamMultiCallable
):
    def __call__(
        self,
        request: RequestType,
        *,
        timeout: Optional[float] = None,
        metadata: Optional[MetadataType] = None,
        credentials: Optional[grpc.CallCredentials] = None,
        wait_for_ready: Optional[bool] = None,
        compression: Optional[grpc.Compression] = None,
    ) -> _base_call.UnaryStreamCall[RequestType, ResponseType]:
        metadata = self._init_metadata(metadata, compression)

        if not self._interceptors:
            call = UnaryStreamCall(
                request,
                _timeout_to_deadline(timeout),
                metadata,
                credentials,
                wait_for_ready,
                self._channel,
                self._method,
                self._request_serializer,
                self._response_deserializer,
                self._loop,
            )
        else:
            call = InterceptedUnaryStreamCall(
                self._interceptors,
                request,
                timeout,
                metadata,
                credentials,
                wait_for_ready,
                self._channel,
                self._method,
                self._request_serializer,
                self._response_deserializer,
                self._loop,
            )

        return call


class StreamUnaryMultiCallable(
    _BaseMultiCallable, _base_channel.StreamUnaryMultiCallable
):
    def __call__(
        self,
        request_iterator: Optional[RequestIterableType] = None,
        timeout: Optional[float] = None,
        metadata: Optional[MetadataType] = None,
        credentials: Optional[grpc.CallCredentials] = None,
        wait_for_ready: Optional[bool] = None,
        compression: Optional[grpc.Compression] = None,
    ) -> _base_call.StreamUnaryCall:
        metadata = self._init_metadata(metadata, compression)

        if not self._interceptors:
            call = StreamUnaryCall(
                request_iterator,
                _timeout_to_deadline(timeout),
                metadata,
                credentials,
                wait_for_ready,
                self._channel,
                self._method,
                self._request_serializer,
                self._response_deserializer,
                self._loop,
            )
        else:
            call = InterceptedStreamUnaryCall(
                self._interceptors,
                request_iterator,
                timeout,
                metadata,
                credentials,
                wait_for_ready,
                self._channel,
                self._method,
                self._request_serializer,
                self._response_deserializer,
                self._loop,
            )

        return call


class StreamStreamMultiCallable(
    _BaseMultiCallable, _base_channel.StreamStreamMultiCallable
):
    def __call__(
        self,
        request_iterator: Optional[RequestIterableType] = None,
        timeout: Optional[float] = None,
        metadata: Optional[MetadataType] = None,
        credentials: Optional[grpc.CallCredentials] = None,
        wait_for_ready: Optional[bool] = None,
        compression: Optional[grpc.Compression] = None,
    ) -> _base_call.StreamStreamCall:
        metadata = self._init_metadata(metadata, compression)

        if not self._interceptors:
            call = StreamStreamCall(
                request_iterator,
                _timeout_to_deadline(timeout),
                metadata,
                credentials,
                wait_for_ready,
                self._channel,
                self._method,
                self._request_serializer,
                self._response_deserializer,
                self._loop,
            )
        else:
            call = InterceptedStreamStreamCall(
                self._interceptors,
                request_iterator,
                timeout,
                metadata,
                credentials,
                wait_for_ready,
                self._channel,
                self._method,
                self._request_serializer,
                self._response_deserializer,
                self._loop,
            )

        return call


class Channel(_base_channel.Channel):
    _loop: asyncio.AbstractEventLoop
    _channel: cygrpc.AioChannel
    _unary_unary_interceptors: List[UnaryUnaryClientInterceptor]
    _unary_stream_interceptors: List[UnaryStreamClientInterceptor]
    _stream_unary_interceptors: List[StreamUnaryClientInterceptor]
    _stream_stream_interceptors: List[StreamStreamClientInterceptor]

    def __init__(
        self,
        target: str,
        options: ChannelArgumentType,
        credentials: Optional[grpc.ChannelCredentials],
        compression: Optional[grpc.Compression],
        interceptors: Optional[Sequence[ClientInterceptor]],
    ):
        """Constructor.

        Args:
          target: The target to which to connect.
          options: Configuration options for the channel.
          credentials: A cygrpc.ChannelCredentials or None.
          compression: An optional value indicating the compression method to be
            used over the lifetime of the channel.
          interceptors: An optional list of interceptors that would be used for
            intercepting any RPC executed with that channel.
        """
        self._unary_unary_interceptors = []
        self._unary_stream_interceptors = []
        self._stream_unary_interceptors = []
        self._stream_stream_interceptors = []

        if interceptors is not None:
            for interceptor in interceptors:
                if isinstance(interceptor, UnaryUnaryClientInterceptor):
                    self._unary_unary_interceptors.append(interceptor)
                elif isinstance(interceptor, UnaryStreamClientInterceptor):
                    self._unary_stream_interceptors.append(interceptor)
                elif isinstance(interceptor, StreamUnaryClientInterceptor):
                    self._stream_unary_interceptors.append(interceptor)
                elif isinstance(interceptor, StreamStreamClientInterceptor):
                    self._stream_stream_interceptors.append(interceptor)
                else:
                    raise ValueError(
                        "Interceptor {} must be ".format(interceptor)
                        + "{} or ".format(UnaryUnaryClientInterceptor.__name__)
                        + "{} or ".format(UnaryStreamClientInterceptor.__name__)
                        + "{} or ".format(StreamUnaryClientInterceptor.__name__)
                        + "{}. ".format(StreamStreamClientInterceptor.__name__)
                    )

        self._loop = cygrpc.get_working_loop()
        self._channel = cygrpc.AioChannel(
            _common.encode(target),
            _augment_channel_arguments(options, compression),
            credentials,
            self._loop,
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self._close(None)

    async def _close(self, grace):  # pylint: disable=too-many-branches
        if self._channel.closed():
            return

        # No new calls will be accepted by the Cython channel.
        self._channel.closing()

        # Iterate through running tasks
        tasks = _all_tasks()
        calls = []
        call_tasks = []
        for task in tasks:
            try:
                stack = task.get_stack(limit=1)
            except AttributeError as attribute_error:
                # NOTE(lidiz) tl;dr: If the Task is created with a CPython
                # object, it will trigger AttributeError.
                #
                # In the global finalizer, the event loop schedules
                # a CPython PyAsyncGenAThrow object.
                # https://github.com/python/cpython/blob/00e45877e33d32bb61aa13a2033e3bba370bda4d/Lib/asyncio/base_events.py#L484
                #
                # However, the PyAsyncGenAThrow object is written in C and
                # failed to include the normal Python frame objects. Hence,
                # this exception is a false negative, and it is safe to ignore
                # the failure. It is fixed by https://github.com/python/cpython/pull/18669,
                # but not available until 3.9 or 3.8.3. So, we have to keep it
                # for a while.
                # TODO(lidiz) drop this hack after 3.8 deprecation
                if "frame" in str(attribute_error):
                    continue
                else:
                    raise

            # If the Task is created by a C-extension, the stack will be empty.
            if not stack:
                continue

            # Locate ones created by `aio.Call`.
            frame = stack[0]
            candidate = frame.f_locals.get("self")
            # Explicitly check for a non-null candidate instead of the more pythonic 'if candidate:'
            # because doing 'if candidate:' assumes that the coroutine implements '__bool__' which
            # might not always be the case.
            if candidate is not None:
                if isinstance(candidate, _base_call.Call):
                    if hasattr(candidate, "_channel"):
                        # For intercepted Call object
                        if candidate._channel is not self._channel:
                            continue
                    elif hasattr(candidate, "_cython_call"):
                        # For normal Call object
                        if candidate._cython_call._channel is not self._channel:
                            continue
                    else:
                        # Unidentified Call object
                        raise cygrpc.InternalError(
                            f"Unrecognized call object: {candidate}"
                        )

                    calls.append(candidate)
                    call_tasks.append(task)

        # If needed, try to wait for them to finish.
        # Call objects are not always awaitables.
        if grace and call_tasks:
            await asyncio.wait(call_tasks, timeout=grace)

        # Time to cancel existing calls.
        for call in calls:
            call.cancel()

        # Destroy the channel
        self._channel.close()

    async def close(self, grace: Optional[float] = None):
        await self._close(grace)

    def __del__(self):
        if hasattr(self, "_channel"):
            if not self._channel.closed():
                self._channel.close()

    def get_state(
        self, try_to_connect: bool = False
    ) -> grpc.ChannelConnectivity:
        result = self._channel.check_connectivity_state(try_to_connect)
        return _common.CYGRPC_CONNECTIVITY_STATE_TO_CHANNEL_CONNECTIVITY[result]

    async def wait_for_state_change(
        self,
        last_observed_state: grpc.ChannelConnectivity,
    ) -> None:
        assert await self._channel.watch_connectivity_state(
            last_observed_state.value[0], None
        )

    async def channel_ready(self) -> None:
        state = self.get_state(try_to_connect=True)
        while state != grpc.ChannelConnectivity.READY:
            await self.wait_for_state_change(state)
            state = self.get_state(try_to_connect=True)

    # TODO(xuanwn): Implement this method after we have
    # observability for Asyncio.
    def _get_registered_call_handle(self, method: str) -> int:
        pass

    # TODO(xuanwn): Implement _registered_method after we have
    # observability for Asyncio.
    # pylint: disable=arguments-differ,unused-argument
    def unary_unary(
        self,
        method: str,
        request_serializer: Optional[SerializingFunction] = None,
        response_deserializer: Optional[DeserializingFunction] = None,
        _registered_method: Optional[bool] = False,
    ) -> UnaryUnaryMultiCallable:
        return UnaryUnaryMultiCallable(
            self._channel,
            _common.encode(method),
            request_serializer,
            response_deserializer,
            self._unary_unary_interceptors,
            [self],
            self._loop,
        )

    # TODO(xuanwn): Implement _registered_method after we have
    # observability for Asyncio.
    # pylint: disable=arguments-differ,unused-argument
    def unary_stream(
        self,
        method: str,
        request_serializer: Optional[SerializingFunction] = None,
        response_deserializer: Optional[DeserializingFunction] = None,
        _registered_method: Optional[bool] = False,
    ) -> UnaryStreamMultiCallable:
        return UnaryStreamMultiCallable(
            self._channel,
            _common.encode(method),
            request_serializer,
            response_deserializer,
            self._unary_stream_interceptors,
            [self],
            self._loop,
        )

    # TODO(xuanwn): Implement _registered_method after we have
    # observability for Asyncio.
    # pylint: disable=arguments-differ,unused-argument
    def stream_unary(
        self,
        method: str,
        request_serializer: Optional[SerializingFunction] = None,
        response_deserializer: Optional[DeserializingFunction] = None,
        _registered_method: Optional[bool] = False,
    ) -> StreamUnaryMultiCallable:
        return StreamUnaryMultiCallable(
            self._channel,
            _common.encode(method),
            request_serializer,
            response_deserializer,
            self._stream_unary_interceptors,
            [self],
            self._loop,
        )

    # TODO(xuanwn): Implement _registered_method after we have
    # observability for Asyncio.
    # pylint: disable=arguments-differ,unused-argument
    def stream_stream(
        self,
        method: str,
        request_serializer: Optional[SerializingFunction] = None,
        response_deserializer: Optional[DeserializingFunction] = None,
        _registered_method: Optional[bool] = False,
    ) -> StreamStreamMultiCallable:
        return StreamStreamMultiCallable(
            self._channel,
            _common.encode(method),
            request_serializer,
            response_deserializer,
            self._stream_stream_interceptors,
            [self],
            self._loop,
        )


def insecure_channel(
    target: str,
    options: Optional[ChannelArgumentType] = None,
    compression: Optional[grpc.Compression] = None,
    interceptors: Optional[Sequence[ClientInterceptor]] = None,
):
    """Creates an insecure asynchronous Channel to a server.

    Args:
      target: The server address
      options: An optional list of key-value pairs (:term:`channel_arguments`
        in gRPC Core runtime) to configure the channel.
      compression: An optional value indicating the compression method to be
        used over the lifetime of the channel.
      interceptors: An optional sequence of interceptors that will be executed for
        any call executed with this channel.

    Returns:
      A Channel.
    """
    return Channel(
        target,
        () if options is None else options,
        None,
        compression,
        interceptors,
    )


def secure_channel(
    target: str,
    credentials: grpc.ChannelCredentials,
    options: Optional[ChannelArgumentType] = None,
    compression: Optional[grpc.Compression] = None,
    interceptors: Optional[Sequence[ClientInterceptor]] = None,
):
    """Creates a secure asynchronous Channel to a server.

    Args:
      target: The server address.
      credentials: A ChannelCredentials instance.
      options: An optional list of key-value pairs (:term:`channel_arguments`
        in gRPC Core runtime) to configure the channel.
      compression: An optional value indicating the compression method to be
        used over the lifetime of the channel.
      interceptors: An optional sequence of interceptors that will be executed for
        any call executed with this channel.

    Returns:
      An aio.Channel.
    """
    return Channel(
        target,
        () if options is None else options,
        credentials._credentials,
        compression,
        interceptors,
    )
