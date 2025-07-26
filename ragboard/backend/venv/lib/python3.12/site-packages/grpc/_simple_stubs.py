# Copyright 2020 The gRPC authors.
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
"""Functions that obviate explicit stubs and explicit channels."""

import collections
import datetime
import logging
import os
import threading
from typing import (
    Any,
    AnyStr,
    Callable,
    Dict,
    Iterator,
    Optional,
    Sequence,
    Tuple,
    TypeVar,
    Union,
)

import grpc
from grpc.experimental import experimental_api

RequestType = TypeVar("RequestType")
ResponseType = TypeVar("ResponseType")

OptionsType = Sequence[Tuple[str, str]]
CacheKey = Tuple[
    str,
    OptionsType,
    Optional[grpc.ChannelCredentials],
    Optional[grpc.Compression],
]

_LOGGER = logging.getLogger(__name__)

_EVICTION_PERIOD_KEY = "GRPC_PYTHON_MANAGED_CHANNEL_EVICTION_SECONDS"
if _EVICTION_PERIOD_KEY in os.environ:
    _EVICTION_PERIOD = datetime.timedelta(
        seconds=float(os.environ[_EVICTION_PERIOD_KEY])
    )
    _LOGGER.debug(
        "Setting managed channel eviction period to %s", _EVICTION_PERIOD
    )
else:
    _EVICTION_PERIOD = datetime.timedelta(minutes=10)

_MAXIMUM_CHANNELS_KEY = "GRPC_PYTHON_MANAGED_CHANNEL_MAXIMUM"
if _MAXIMUM_CHANNELS_KEY in os.environ:
    _MAXIMUM_CHANNELS = int(os.environ[_MAXIMUM_CHANNELS_KEY])
    _LOGGER.debug("Setting maximum managed channels to %d", _MAXIMUM_CHANNELS)
else:
    _MAXIMUM_CHANNELS = 2**8

_DEFAULT_TIMEOUT_KEY = "GRPC_PYTHON_DEFAULT_TIMEOUT_SECONDS"
if _DEFAULT_TIMEOUT_KEY in os.environ:
    _DEFAULT_TIMEOUT = float(os.environ[_DEFAULT_TIMEOUT_KEY])
    _LOGGER.debug("Setting default timeout seconds to %f", _DEFAULT_TIMEOUT)
else:
    _DEFAULT_TIMEOUT = 60.0


def _create_channel(
    target: str,
    options: Sequence[Tuple[str, str]],
    channel_credentials: Optional[grpc.ChannelCredentials],
    compression: Optional[grpc.Compression],
) -> grpc.Channel:
    _LOGGER.debug(
        f"Creating secure channel with credentials '{channel_credentials}', "
        + f"options '{options}' and compression '{compression}'"
    )
    return grpc.secure_channel(
        target,
        credentials=channel_credentials,
        options=options,
        compression=compression,
    )


class ChannelCache:
    # NOTE(rbellevi): Untyped due to reference cycle.
    _singleton = None
    _lock: threading.RLock = threading.RLock()
    _condition: threading.Condition = threading.Condition(lock=_lock)
    _eviction_ready: threading.Event = threading.Event()

    _mapping: Dict[CacheKey, Tuple[grpc.Channel, datetime.datetime]]
    _eviction_thread: threading.Thread

    def __init__(self):
        self._mapping = collections.OrderedDict()
        self._eviction_thread = threading.Thread(
            target=ChannelCache._perform_evictions, daemon=True
        )
        self._eviction_thread.start()

    @staticmethod
    def get():
        with ChannelCache._lock:
            if ChannelCache._singleton is None:
                ChannelCache._singleton = ChannelCache()
        ChannelCache._eviction_ready.wait()
        return ChannelCache._singleton

    def _evict_locked(self, key: CacheKey):
        channel, _ = self._mapping.pop(key)
        _LOGGER.debug(
            "Evicting channel %s with configuration %s.", channel, key
        )
        channel.close()
        del channel

    @staticmethod
    def _perform_evictions():
        while True:
            with ChannelCache._lock:
                ChannelCache._eviction_ready.set()
                if not ChannelCache._singleton._mapping:
                    ChannelCache._condition.wait()
                elif len(ChannelCache._singleton._mapping) > _MAXIMUM_CHANNELS:
                    key = next(iter(ChannelCache._singleton._mapping.keys()))
                    ChannelCache._singleton._evict_locked(key)
                    # And immediately reevaluate.
                else:
                    key, (_, eviction_time) = next(
                        iter(ChannelCache._singleton._mapping.items())
                    )
                    now = datetime.datetime.now()
                    if eviction_time <= now:
                        ChannelCache._singleton._evict_locked(key)
                        continue
                    else:
                        time_to_eviction = (eviction_time - now).total_seconds()
                        # NOTE: We aim to *eventually* coalesce to a state in
                        # which no overdue channels are in the cache and the
                        # length of the cache is longer than _MAXIMUM_CHANNELS.
                        # We tolerate momentary states in which these two
                        # criteria are not met.
                        ChannelCache._condition.wait(timeout=time_to_eviction)

    def get_channel(
        self,
        target: str,
        options: Sequence[Tuple[str, str]],
        channel_credentials: Optional[grpc.ChannelCredentials],
        insecure: bool,
        compression: Optional[grpc.Compression],
        method: str,
        _registered_method: bool,
    ) -> Tuple[grpc.Channel, Optional[int]]:
        """Get a channel from cache or creates a new channel.

        This method also takes care of register method for channel,
          which means we'll register a new call handle if we're calling a
          non-registered method for an existing channel.

        Returns:
            A tuple with two items. The first item is the channel, second item is
              the call handle if the method is registered, None if it's not registered.
        """
        if insecure and channel_credentials:
            raise ValueError(
                "The insecure option is mutually exclusive with "
                + "the channel_credentials option. Please use one "
                + "or the other."
            )
        if insecure:
            channel_credentials = (
                grpc.experimental.insecure_channel_credentials()
            )
        elif channel_credentials is None:
            _LOGGER.debug("Defaulting to SSL channel credentials.")
            channel_credentials = grpc.ssl_channel_credentials()
        key = (target, options, channel_credentials, compression)
        with self._lock:
            channel_data = self._mapping.get(key, None)
            call_handle = None
            if channel_data is not None:
                channel = channel_data[0]
                # Register a new call handle if we're calling a registered method for an
                # existing channel and this method is not registered.
                if _registered_method:
                    call_handle = channel._get_registered_call_handle(method)
                self._mapping.pop(key)
                self._mapping[key] = (
                    channel,
                    datetime.datetime.now() + _EVICTION_PERIOD,
                )
                return channel, call_handle
            else:
                channel = _create_channel(
                    target, options, channel_credentials, compression
                )
                if _registered_method:
                    call_handle = channel._get_registered_call_handle(method)
                self._mapping[key] = (
                    channel,
                    datetime.datetime.now() + _EVICTION_PERIOD,
                )
                if (
                    len(self._mapping) == 1
                    or len(self._mapping) >= _MAXIMUM_CHANNELS
                ):
                    self._condition.notify()
                return channel, call_handle

    def _test_only_channel_count(self) -> int:
        with self._lock:
            return len(self._mapping)


@experimental_api
# pylint: disable=too-many-locals
def unary_unary(
    request: RequestType,
    target: str,
    method: str,
    request_serializer: Optional[Callable[[Any], bytes]] = None,
    response_deserializer: Optional[Callable[[bytes], Any]] = None,
    options: Sequence[Tuple[AnyStr, AnyStr]] = (),
    channel_credentials: Optional[grpc.ChannelCredentials] = None,
    insecure: bool = False,
    call_credentials: Optional[grpc.CallCredentials] = None,
    compression: Optional[grpc.Compression] = None,
    wait_for_ready: Optional[bool] = None,
    timeout: Optional[float] = _DEFAULT_TIMEOUT,
    metadata: Optional[Sequence[Tuple[str, Union[str, bytes]]]] = None,
    _registered_method: Optional[bool] = False,
) -> ResponseType:
    """Invokes a unary-unary RPC without an explicitly specified channel.

    THIS IS AN EXPERIMENTAL API.

    This is backed by a per-process cache of channels. Channels are evicted
    from the cache after a fixed period by a background. Channels will also be
    evicted if more than a configured maximum accumulate.

    The default eviction period is 10 minutes. One may set the environment
    variable "GRPC_PYTHON_MANAGED_CHANNEL_EVICTION_SECONDS" to configure this.

    The default maximum number of channels is 256. One may set the
    environment variable "GRPC_PYTHON_MANAGED_CHANNEL_MAXIMUM" to configure
    this.

    Args:
      request: An iterator that yields request values for the RPC.
      target: The server address.
      method: The name of the RPC method.
      request_serializer: Optional :term:`serializer` for serializing the request
        message. Request goes unserialized in case None is passed.
      response_deserializer: Optional :term:`deserializer` for deserializing the response
        message. Response goes undeserialized in case None is passed.
      options: An optional list of key-value pairs (:term:`channel_arguments` in gRPC Core
        runtime) to configure the channel.
      channel_credentials: A credential applied to the whole channel, e.g. the
        return value of grpc.ssl_channel_credentials() or
        grpc.insecure_channel_credentials().
      insecure: If True, specifies channel_credentials as
        :term:`grpc.insecure_channel_credentials()`. This option is mutually
        exclusive with the `channel_credentials` option.
      call_credentials: A call credential applied to each call individually,
        e.g. the output of grpc.metadata_call_credentials() or
        grpc.access_token_call_credentials().
      compression: An optional value indicating the compression method to be
        used over the lifetime of the channel, e.g. grpc.Compression.Gzip.
      wait_for_ready: An optional flag indicating whether the RPC should fail
        immediately if the connection is not ready at the time the RPC is
        invoked, or if it should wait until the connection to the server
        becomes ready. When using this option, the user will likely also want
        to set a timeout. Defaults to True.
      timeout: An optional duration of time in seconds to allow for the RPC,
        after which an exception will be raised. If timeout is unspecified,
        defaults to a timeout controlled by the
        GRPC_PYTHON_DEFAULT_TIMEOUT_SECONDS environment variable. If that is
        unset, defaults to 60 seconds. Supply a value of None to indicate that
        no timeout should be enforced.
      metadata: Optional metadata to send to the server.

    Returns:
      The response to the RPC.
    """
    channel, method_handle = ChannelCache.get().get_channel(
        target,
        options,
        channel_credentials,
        insecure,
        compression,
        method,
        _registered_method,
    )
    multicallable = channel.unary_unary(
        method, request_serializer, response_deserializer, method_handle
    )
    wait_for_ready = wait_for_ready if wait_for_ready is not None else True
    return multicallable(
        request,
        metadata=metadata,
        wait_for_ready=wait_for_ready,
        credentials=call_credentials,
        timeout=timeout,
    )


@experimental_api
# pylint: disable=too-many-locals
def unary_stream(
    request: RequestType,
    target: str,
    method: str,
    request_serializer: Optional[Callable[[Any], bytes]] = None,
    response_deserializer: Optional[Callable[[bytes], Any]] = None,
    options: Sequence[Tuple[AnyStr, AnyStr]] = (),
    channel_credentials: Optional[grpc.ChannelCredentials] = None,
    insecure: bool = False,
    call_credentials: Optional[grpc.CallCredentials] = None,
    compression: Optional[grpc.Compression] = None,
    wait_for_ready: Optional[bool] = None,
    timeout: Optional[float] = _DEFAULT_TIMEOUT,
    metadata: Optional[Sequence[Tuple[str, Union[str, bytes]]]] = None,
    _registered_method: Optional[bool] = False,
) -> Iterator[ResponseType]:
    """Invokes a unary-stream RPC without an explicitly specified channel.

    THIS IS AN EXPERIMENTAL API.

    This is backed by a per-process cache of channels. Channels are evicted
    from the cache after a fixed period by a background. Channels will also be
    evicted if more than a configured maximum accumulate.

    The default eviction period is 10 minutes. One may set the environment
    variable "GRPC_PYTHON_MANAGED_CHANNEL_EVICTION_SECONDS" to configure this.

    The default maximum number of channels is 256. One may set the
    environment variable "GRPC_PYTHON_MANAGED_CHANNEL_MAXIMUM" to configure
    this.

    Args:
      request: An iterator that yields request values for the RPC.
      target: The server address.
      method: The name of the RPC method.
      request_serializer: Optional :term:`serializer` for serializing the request
        message. Request goes unserialized in case None is passed.
      response_deserializer: Optional :term:`deserializer` for deserializing the response
        message. Response goes undeserialized in case None is passed.
      options: An optional list of key-value pairs (:term:`channel_arguments` in gRPC Core
        runtime) to configure the channel.
      channel_credentials: A credential applied to the whole channel, e.g. the
        return value of grpc.ssl_channel_credentials().
      insecure: If True, specifies channel_credentials as
        :term:`grpc.insecure_channel_credentials()`. This option is mutually
        exclusive with the `channel_credentials` option.
      call_credentials: A call credential applied to each call individually,
        e.g. the output of grpc.metadata_call_credentials() or
        grpc.access_token_call_credentials().
      compression: An optional value indicating the compression method to be
        used over the lifetime of the channel, e.g. grpc.Compression.Gzip.
      wait_for_ready: An optional flag indicating whether the RPC should fail
        immediately if the connection is not ready at the time the RPC is
        invoked, or if it should wait until the connection to the server
        becomes ready. When using this option, the user will likely also want
        to set a timeout. Defaults to True.
      timeout: An optional duration of time in seconds to allow for the RPC,
        after which an exception will be raised. If timeout is unspecified,
        defaults to a timeout controlled by the
        GRPC_PYTHON_DEFAULT_TIMEOUT_SECONDS environment variable. If that is
        unset, defaults to 60 seconds. Supply a value of None to indicate that
        no timeout should be enforced.
      metadata: Optional metadata to send to the server.

    Returns:
      An iterator of responses.
    """
    channel, method_handle = ChannelCache.get().get_channel(
        target,
        options,
        channel_credentials,
        insecure,
        compression,
        method,
        _registered_method,
    )
    multicallable = channel.unary_stream(
        method, request_serializer, response_deserializer, method_handle
    )
    wait_for_ready = wait_for_ready if wait_for_ready is not None else True
    return multicallable(
        request,
        metadata=metadata,
        wait_for_ready=wait_for_ready,
        credentials=call_credentials,
        timeout=timeout,
    )


@experimental_api
# pylint: disable=too-many-locals
def stream_unary(
    request_iterator: Iterator[RequestType],
    target: str,
    method: str,
    request_serializer: Optional[Callable[[Any], bytes]] = None,
    response_deserializer: Optional[Callable[[bytes], Any]] = None,
    options: Sequence[Tuple[AnyStr, AnyStr]] = (),
    channel_credentials: Optional[grpc.ChannelCredentials] = None,
    insecure: bool = False,
    call_credentials: Optional[grpc.CallCredentials] = None,
    compression: Optional[grpc.Compression] = None,
    wait_for_ready: Optional[bool] = None,
    timeout: Optional[float] = _DEFAULT_TIMEOUT,
    metadata: Optional[Sequence[Tuple[str, Union[str, bytes]]]] = None,
    _registered_method: Optional[bool] = False,
) -> ResponseType:
    """Invokes a stream-unary RPC without an explicitly specified channel.

    THIS IS AN EXPERIMENTAL API.

    This is backed by a per-process cache of channels. Channels are evicted
    from the cache after a fixed period by a background. Channels will also be
    evicted if more than a configured maximum accumulate.

    The default eviction period is 10 minutes. One may set the environment
    variable "GRPC_PYTHON_MANAGED_CHANNEL_EVICTION_SECONDS" to configure this.

    The default maximum number of channels is 256. One may set the
    environment variable "GRPC_PYTHON_MANAGED_CHANNEL_MAXIMUM" to configure
    this.

    Args:
      request_iterator: An iterator that yields request values for the RPC.
      target: The server address.
      method: The name of the RPC method.
      request_serializer: Optional :term:`serializer` for serializing the request
        message. Request goes unserialized in case None is passed.
      response_deserializer: Optional :term:`deserializer` for deserializing the response
        message. Response goes undeserialized in case None is passed.
      options: An optional list of key-value pairs (:term:`channel_arguments` in gRPC Core
        runtime) to configure the channel.
      channel_credentials: A credential applied to the whole channel, e.g. the
        return value of grpc.ssl_channel_credentials().
      call_credentials: A call credential applied to each call individually,
        e.g. the output of grpc.metadata_call_credentials() or
        grpc.access_token_call_credentials().
      insecure: If True, specifies channel_credentials as
        :term:`grpc.insecure_channel_credentials()`. This option is mutually
        exclusive with the `channel_credentials` option.
      compression: An optional value indicating the compression method to be
        used over the lifetime of the channel, e.g. grpc.Compression.Gzip.
      wait_for_ready: An optional flag indicating whether the RPC should fail
        immediately if the connection is not ready at the time the RPC is
        invoked, or if it should wait until the connection to the server
        becomes ready. When using this option, the user will likely also want
        to set a timeout. Defaults to True.
      timeout: An optional duration of time in seconds to allow for the RPC,
        after which an exception will be raised. If timeout is unspecified,
        defaults to a timeout controlled by the
        GRPC_PYTHON_DEFAULT_TIMEOUT_SECONDS environment variable. If that is
        unset, defaults to 60 seconds. Supply a value of None to indicate that
        no timeout should be enforced.
      metadata: Optional metadata to send to the server.

    Returns:
      The response to the RPC.
    """
    channel, method_handle = ChannelCache.get().get_channel(
        target,
        options,
        channel_credentials,
        insecure,
        compression,
        method,
        _registered_method,
    )
    multicallable = channel.stream_unary(
        method, request_serializer, response_deserializer, method_handle
    )
    wait_for_ready = wait_for_ready if wait_for_ready is not None else True
    return multicallable(
        request_iterator,
        metadata=metadata,
        wait_for_ready=wait_for_ready,
        credentials=call_credentials,
        timeout=timeout,
    )


@experimental_api
# pylint: disable=too-many-locals
def stream_stream(
    request_iterator: Iterator[RequestType],
    target: str,
    method: str,
    request_serializer: Optional[Callable[[Any], bytes]] = None,
    response_deserializer: Optional[Callable[[bytes], Any]] = None,
    options: Sequence[Tuple[AnyStr, AnyStr]] = (),
    channel_credentials: Optional[grpc.ChannelCredentials] = None,
    insecure: bool = False,
    call_credentials: Optional[grpc.CallCredentials] = None,
    compression: Optional[grpc.Compression] = None,
    wait_for_ready: Optional[bool] = None,
    timeout: Optional[float] = _DEFAULT_TIMEOUT,
    metadata: Optional[Sequence[Tuple[str, Union[str, bytes]]]] = None,
    _registered_method: Optional[bool] = False,
) -> Iterator[ResponseType]:
    """Invokes a stream-stream RPC without an explicitly specified channel.

    THIS IS AN EXPERIMENTAL API.

    This is backed by a per-process cache of channels. Channels are evicted
    from the cache after a fixed period by a background. Channels will also be
    evicted if more than a configured maximum accumulate.

    The default eviction period is 10 minutes. One may set the environment
    variable "GRPC_PYTHON_MANAGED_CHANNEL_EVICTION_SECONDS" to configure this.

    The default maximum number of channels is 256. One may set the
    environment variable "GRPC_PYTHON_MANAGED_CHANNEL_MAXIMUM" to configure
    this.

    Args:
      request_iterator: An iterator that yields request values for the RPC.
      target: The server address.
      method: The name of the RPC method.
      request_serializer: Optional :term:`serializer` for serializing the request
        message. Request goes unserialized in case None is passed.
      response_deserializer: Optional :term:`deserializer` for deserializing the response
        message. Response goes undeserialized in case None is passed.
      options: An optional list of key-value pairs (:term:`channel_arguments` in gRPC Core
        runtime) to configure the channel.
      channel_credentials: A credential applied to the whole channel, e.g. the
        return value of grpc.ssl_channel_credentials().
      call_credentials: A call credential applied to each call individually,
        e.g. the output of grpc.metadata_call_credentials() or
        grpc.access_token_call_credentials().
      insecure: If True, specifies channel_credentials as
        :term:`grpc.insecure_channel_credentials()`. This option is mutually
        exclusive with the `channel_credentials` option.
      compression: An optional value indicating the compression method to be
        used over the lifetime of the channel, e.g. grpc.Compression.Gzip.
      wait_for_ready: An optional flag indicating whether the RPC should fail
        immediately if the connection is not ready at the time the RPC is
        invoked, or if it should wait until the connection to the server
        becomes ready. When using this option, the user will likely also want
        to set a timeout. Defaults to True.
      timeout: An optional duration of time in seconds to allow for the RPC,
        after which an exception will be raised. If timeout is unspecified,
        defaults to a timeout controlled by the
        GRPC_PYTHON_DEFAULT_TIMEOUT_SECONDS environment variable. If that is
        unset, defaults to 60 seconds. Supply a value of None to indicate that
        no timeout should be enforced.
      metadata: Optional metadata to send to the server.

    Returns:
      An iterator of responses.
    """
    channel, method_handle = ChannelCache.get().get_channel(
        target,
        options,
        channel_credentials,
        insecure,
        compression,
        method,
        _registered_method,
    )
    multicallable = channel.stream_stream(
        method, request_serializer, response_deserializer, method_handle
    )
    wait_for_ready = wait_for_ready if wait_for_ready is not None else True
    return multicallable(
        request_iterator,
        metadata=metadata,
        wait_for_ready=wait_for_ready,
        credentials=call_credentials,
        timeout=timeout,
    )
