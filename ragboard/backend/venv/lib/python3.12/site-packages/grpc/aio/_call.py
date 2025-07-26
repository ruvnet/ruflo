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
import enum
from functools import partial
import inspect
import logging
import traceback
from typing import (
    Any,
    AsyncIterator,
    Generator,
    Generic,
    Optional,
    Tuple,
    Union,
)

import grpc
from grpc import _common
from grpc._cython import cygrpc

from . import _base_call
from ._metadata import Metadata
from ._typing import DeserializingFunction
from ._typing import DoneCallbackType
from ._typing import EOFType
from ._typing import MetadatumType
from ._typing import RequestIterableType
from ._typing import RequestType
from ._typing import ResponseType
from ._typing import SerializingFunction

__all__ = "AioRpcError", "Call", "UnaryUnaryCall", "UnaryStreamCall"

_LOCAL_CANCELLATION_DETAILS = "Locally cancelled by application!"
_GC_CANCELLATION_DETAILS = "Cancelled upon garbage collection!"
_RPC_ALREADY_FINISHED_DETAILS = "RPC already finished."
_RPC_HALF_CLOSED_DETAILS = 'RPC is half closed after calling "done_writing".'
_API_STYLE_ERROR = (
    "The iterator and read/write APIs may not be mixed on a single RPC."
)

_OK_CALL_REPRESENTATION = (
    '<{} of RPC that terminated with:\n\tstatus = {}\n\tdetails = "{}"\n>'
)

_NON_OK_CALL_REPRESENTATION = (
    "<{} of RPC that terminated with:\n"
    "\tstatus = {}\n"
    '\tdetails = "{}"\n'
    '\tdebug_error_string = "{}"\n'
    ">"
)

_LOGGER = logging.getLogger(__name__)


class AioRpcError(grpc.RpcError):
    """An implementation of RpcError to be used by the asynchronous API.

    Raised RpcError is a snapshot of the final status of the RPC, values are
    determined. Hence, its methods no longer needs to be coroutines.
    """

    _code: grpc.StatusCode
    _details: Optional[str]
    _initial_metadata: Optional[Metadata]
    _trailing_metadata: Optional[Metadata]
    _debug_error_string: Optional[str]

    def __init__(
        self,
        code: grpc.StatusCode,
        initial_metadata: Metadata,
        trailing_metadata: Metadata,
        details: Optional[str] = None,
        debug_error_string: Optional[str] = None,
    ) -> None:
        """Constructor.

        Args:
          code: The status code with which the RPC has been finalized.
          details: Optional details explaining the reason of the error.
          initial_metadata: Optional initial metadata that could be sent by the
            Server.
          trailing_metadata: Optional metadata that could be sent by the Server.
        """

        super().__init__()
        self._code = code
        self._details = details
        self._initial_metadata = initial_metadata
        self._trailing_metadata = trailing_metadata
        self._debug_error_string = debug_error_string

    def code(self) -> grpc.StatusCode:
        """Accesses the status code sent by the server.

        Returns:
          The `grpc.StatusCode` status code.
        """
        return self._code

    def details(self) -> Optional[str]:
        """Accesses the details sent by the server.

        Returns:
          The description of the error.
        """
        return self._details

    def initial_metadata(self) -> Metadata:
        """Accesses the initial metadata sent by the server.

        Returns:
          The initial metadata received.
        """
        return self._initial_metadata

    def trailing_metadata(self) -> Metadata:
        """Accesses the trailing metadata sent by the server.

        Returns:
          The trailing metadata received.
        """
        return self._trailing_metadata

    def debug_error_string(self) -> str:
        """Accesses the debug error string sent by the server.

        Returns:
          The debug error string received.
        """
        return self._debug_error_string

    def _repr(self) -> str:
        """Assembles the error string for the RPC error."""
        return _NON_OK_CALL_REPRESENTATION.format(
            self.__class__.__name__,
            self._code,
            self._details,
            self._debug_error_string,
        )

    def __repr__(self) -> str:
        return self._repr()

    def __str__(self) -> str:
        return self._repr()

    def __reduce__(self):
        return (
            type(self),
            (
                self._code,
                self._initial_metadata,
                self._trailing_metadata,
                self._details,
                self._debug_error_string,
            ),
        )


def _create_rpc_error(
    initial_metadata: Metadata, status: cygrpc.AioRpcStatus
) -> AioRpcError:
    return AioRpcError(
        _common.CYGRPC_STATUS_CODE_TO_STATUS_CODE[status.code()],
        Metadata.from_tuple(initial_metadata),
        Metadata.from_tuple(status.trailing_metadata()),
        details=status.details(),
        debug_error_string=status.debug_error_string(),
    )


class Call:
    """Base implementation of client RPC Call object.

    Implements logic around final status, metadata and cancellation.
    """

    _loop: asyncio.AbstractEventLoop
    _code: grpc.StatusCode
    _cython_call: cygrpc._AioCall
    _metadata: Tuple[MetadatumType, ...]
    _request_serializer: SerializingFunction
    _response_deserializer: DeserializingFunction

    def __init__(
        self,
        cython_call: cygrpc._AioCall,
        metadata: Metadata,
        request_serializer: SerializingFunction,
        response_deserializer: DeserializingFunction,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        self._loop = loop
        self._cython_call = cython_call
        self._metadata = tuple(metadata)
        self._request_serializer = request_serializer
        self._response_deserializer = response_deserializer

    def __del__(self) -> None:
        # The '_cython_call' object might be destructed before Call object
        if hasattr(self, "_cython_call"):
            if not self._cython_call.done():
                self._cancel(_GC_CANCELLATION_DETAILS)

    def cancelled(self) -> bool:
        return self._cython_call.cancelled()

    def _cancel(self, details: str) -> bool:
        """Forwards the application cancellation reasoning."""
        if not self._cython_call.done():
            self._cython_call.cancel(details)
            return True
        else:
            return False

    def cancel(self) -> bool:
        return self._cancel(_LOCAL_CANCELLATION_DETAILS)

    def done(self) -> bool:
        return self._cython_call.done()

    def add_done_callback(self, callback: DoneCallbackType) -> None:
        cb = partial(callback, self)
        self._cython_call.add_done_callback(cb)

    def time_remaining(self) -> Optional[float]:
        return self._cython_call.time_remaining()

    async def initial_metadata(self) -> Metadata:
        raw_metadata_tuple = await self._cython_call.initial_metadata()
        return Metadata.from_tuple(raw_metadata_tuple)

    async def trailing_metadata(self) -> Metadata:
        raw_metadata_tuple = (
            await self._cython_call.status()
        ).trailing_metadata()
        return Metadata.from_tuple(raw_metadata_tuple)

    async def code(self) -> grpc.StatusCode:
        cygrpc_code = (await self._cython_call.status()).code()
        return _common.CYGRPC_STATUS_CODE_TO_STATUS_CODE[cygrpc_code]

    async def details(self) -> str:
        return (await self._cython_call.status()).details()

    async def debug_error_string(self) -> str:
        return (await self._cython_call.status()).debug_error_string()

    async def _raise_for_status(self) -> None:
        if self._cython_call.is_locally_cancelled():
            raise asyncio.CancelledError()
        code = await self.code()
        if code != grpc.StatusCode.OK:
            raise _create_rpc_error(
                await self.initial_metadata(), await self._cython_call.status()
            )

    def _repr(self) -> str:
        return repr(self._cython_call)

    def __repr__(self) -> str:
        return self._repr()

    def __str__(self) -> str:
        return self._repr()


class _APIStyle(enum.IntEnum):
    UNKNOWN = 0
    ASYNC_GENERATOR = 1
    READER_WRITER = 2


class _UnaryResponseMixin(Call, Generic[ResponseType]):
    _call_response: asyncio.Task

    def _init_unary_response_mixin(self, response_task: asyncio.Task):
        self._call_response = response_task

    def cancel(self) -> bool:
        if super().cancel():
            self._call_response.cancel()
            return True
        else:
            return False

    def __await__(self) -> Generator[Any, None, ResponseType]:
        """Wait till the ongoing RPC request finishes."""
        try:
            response = yield from self._call_response
        except asyncio.CancelledError:
            # Even if we caught all other CancelledError, there is still
            # this corner case. If the application cancels immediately after
            # the Call object is created, we will observe this
            # `CancelledError`.
            if not self.cancelled():
                self.cancel()
            raise

        # NOTE(lidiz) If we raise RpcError in the task, and users doesn't
        # 'await' on it. AsyncIO will log 'Task exception was never retrieved'.
        # Instead, if we move the exception raising here, the spam stops.
        # Unfortunately, there can only be one 'yield from' in '__await__'. So,
        # we need to access the private instance variable.
        if response is cygrpc.EOF:
            if self._cython_call.is_locally_cancelled():
                raise asyncio.CancelledError()
            else:
                raise _create_rpc_error(
                    self._cython_call._initial_metadata,
                    self._cython_call._status,
                )
        else:
            return response


class _StreamResponseMixin(Call):
    _message_aiter: AsyncIterator[ResponseType]
    _preparation: asyncio.Task
    _response_style: _APIStyle

    def _init_stream_response_mixin(self, preparation: asyncio.Task):
        self._message_aiter = None
        self._preparation = preparation
        self._response_style = _APIStyle.UNKNOWN

    def _update_response_style(self, style: _APIStyle):
        if self._response_style is _APIStyle.UNKNOWN:
            self._response_style = style
        elif self._response_style is not style:
            raise cygrpc.UsageError(_API_STYLE_ERROR)

    def cancel(self) -> bool:
        if super().cancel():
            self._preparation.cancel()
            return True
        else:
            return False

    async def _fetch_stream_responses(self) -> ResponseType:
        message = await self._read()
        while message is not cygrpc.EOF:
            yield message
            message = await self._read()

        # If the read operation failed, Core should explain why.
        await self._raise_for_status()

    def __aiter__(self) -> AsyncIterator[ResponseType]:
        self._update_response_style(_APIStyle.ASYNC_GENERATOR)
        if self._message_aiter is None:
            self._message_aiter = self._fetch_stream_responses()
        return self._message_aiter

    async def _read(self) -> ResponseType:
        # Wait for the request being sent
        await self._preparation

        # Reads response message from Core
        try:
            raw_response = await self._cython_call.receive_serialized_message()
        except asyncio.CancelledError:
            if not self.cancelled():
                self.cancel()
            raise

        if raw_response is cygrpc.EOF:
            return cygrpc.EOF
        else:
            return _common.deserialize(
                raw_response, self._response_deserializer
            )

    async def read(self) -> Union[EOFType, ResponseType]:
        if self.done():
            await self._raise_for_status()
            return cygrpc.EOF
        self._update_response_style(_APIStyle.READER_WRITER)

        response_message = await self._read()

        if response_message is cygrpc.EOF:
            # If the read operation failed, Core should explain why.
            await self._raise_for_status()
        return response_message


class _StreamRequestMixin(Call):
    _metadata_sent: asyncio.Event
    _done_writing_flag: bool
    _async_request_poller: Optional[asyncio.Task]
    _request_style: _APIStyle

    def _init_stream_request_mixin(
        self, request_iterator: Optional[RequestIterableType]
    ):
        self._metadata_sent = asyncio.Event()
        self._done_writing_flag = False

        # If user passes in an async iterator, create a consumer Task.
        if request_iterator is not None:
            self._async_request_poller = self._loop.create_task(
                self._consume_request_iterator(request_iterator)
            )
            self._request_style = _APIStyle.ASYNC_GENERATOR
        else:
            self._async_request_poller = None
            self._request_style = _APIStyle.READER_WRITER

    def _raise_for_different_style(self, style: _APIStyle):
        if self._request_style is not style:
            raise cygrpc.UsageError(_API_STYLE_ERROR)

    def cancel(self) -> bool:
        if super().cancel():
            if self._async_request_poller is not None:
                self._async_request_poller.cancel()
            return True
        else:
            return False

    def _metadata_sent_observer(self):
        self._metadata_sent.set()

    async def _consume_request_iterator(
        self, request_iterator: RequestIterableType
    ) -> None:
        try:
            if inspect.isasyncgen(request_iterator) or hasattr(
                request_iterator, "__aiter__"
            ):
                async for request in request_iterator:
                    try:
                        await self._write(request)
                    except AioRpcError as rpc_error:
                        _LOGGER.debug(
                            (
                                "Exception while consuming the"
                                " request_iterator: %s"
                            ),
                            rpc_error,
                        )
                        return
            else:
                for request in request_iterator:
                    try:
                        await self._write(request)
                    except AioRpcError as rpc_error:
                        _LOGGER.debug(
                            (
                                "Exception while consuming the"
                                " request_iterator: %s"
                            ),
                            rpc_error,
                        )
                        return

            await self._done_writing()
        except:  # pylint: disable=bare-except
            # Client iterators can raise exceptions, which we should handle by
            # cancelling the RPC and logging the client's error. No exceptions
            # should escape this function.
            _LOGGER.debug(
                "Client request_iterator raised exception:\n%s",
                traceback.format_exc(),
            )
            self.cancel()

    async def _write(self, request: RequestType) -> None:
        if self.done():
            raise asyncio.InvalidStateError(_RPC_ALREADY_FINISHED_DETAILS)
        if self._done_writing_flag:
            raise asyncio.InvalidStateError(_RPC_HALF_CLOSED_DETAILS)
        if not self._metadata_sent.is_set():
            await self._metadata_sent.wait()
            if self.done():
                await self._raise_for_status()

        serialized_request = _common.serialize(
            request, self._request_serializer
        )
        try:
            await self._cython_call.send_serialized_message(serialized_request)
        except cygrpc.InternalError as err:
            self._cython_call.set_internal_error(str(err))
            await self._raise_for_status()
        except asyncio.CancelledError:
            if not self.cancelled():
                self.cancel()
            raise

    async def _done_writing(self) -> None:
        if self.done():
            # If the RPC is finished, do nothing.
            return
        if not self._done_writing_flag:
            # If the done writing is not sent before, try to send it.
            self._done_writing_flag = True
            try:
                await self._cython_call.send_receive_close()
            except asyncio.CancelledError:
                if not self.cancelled():
                    self.cancel()
                raise

    async def write(self, request: RequestType) -> None:
        self._raise_for_different_style(_APIStyle.READER_WRITER)
        await self._write(request)

    async def done_writing(self) -> None:
        """Signal peer that client is done writing.

        This method is idempotent.
        """
        self._raise_for_different_style(_APIStyle.READER_WRITER)
        await self._done_writing()

    async def wait_for_connection(self) -> None:
        await self._metadata_sent.wait()
        if self.done():
            await self._raise_for_status()


class UnaryUnaryCall(_UnaryResponseMixin, Call, _base_call.UnaryUnaryCall):
    """Object for managing unary-unary RPC calls.

    Returned when an instance of `UnaryUnaryMultiCallable` object is called.
    """

    _request: RequestType
    _invocation_task: asyncio.Task

    # pylint: disable=too-many-arguments
    def __init__(
        self,
        request: RequestType,
        deadline: Optional[float],
        metadata: Metadata,
        credentials: Optional[grpc.CallCredentials],
        wait_for_ready: Optional[bool],
        channel: cygrpc.AioChannel,
        method: bytes,
        request_serializer: SerializingFunction,
        response_deserializer: DeserializingFunction,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        super().__init__(
            channel.call(method, deadline, credentials, wait_for_ready),
            metadata,
            request_serializer,
            response_deserializer,
            loop,
        )
        self._request = request
        self._context = cygrpc.build_census_context()
        self._invocation_task = loop.create_task(self._invoke())
        self._init_unary_response_mixin(self._invocation_task)

    async def _invoke(self) -> ResponseType:
        serialized_request = _common.serialize(
            self._request, self._request_serializer
        )

        # NOTE(lidiz) asyncio.CancelledError is not a good transport for status,
        # because the asyncio.Task class do not cache the exception object.
        # https://github.com/python/cpython/blob/edad4d89e357c92f70c0324b937845d652b20afd/Lib/asyncio/tasks.py#L785
        try:
            serialized_response = await self._cython_call.unary_unary(
                serialized_request, self._metadata, self._context
            )
        except asyncio.CancelledError:
            if not self.cancelled():
                self.cancel()

        if self._cython_call.is_ok():
            return _common.deserialize(
                serialized_response, self._response_deserializer
            )
        else:
            return cygrpc.EOF

    async def wait_for_connection(self) -> None:
        await self._invocation_task
        if self.done():
            await self._raise_for_status()


class UnaryStreamCall(_StreamResponseMixin, Call, _base_call.UnaryStreamCall):
    """Object for managing unary-stream RPC calls.

    Returned when an instance of `UnaryStreamMultiCallable` object is called.
    """

    _request: RequestType
    _send_unary_request_task: asyncio.Task

    # pylint: disable=too-many-arguments
    def __init__(
        self,
        request: RequestType,
        deadline: Optional[float],
        metadata: Metadata,
        credentials: Optional[grpc.CallCredentials],
        wait_for_ready: Optional[bool],
        channel: cygrpc.AioChannel,
        method: bytes,
        request_serializer: SerializingFunction,
        response_deserializer: DeserializingFunction,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        super().__init__(
            channel.call(method, deadline, credentials, wait_for_ready),
            metadata,
            request_serializer,
            response_deserializer,
            loop,
        )
        self._request = request
        self._context = cygrpc.build_census_context()
        self._send_unary_request_task = loop.create_task(
            self._send_unary_request()
        )
        self._init_stream_response_mixin(self._send_unary_request_task)

    async def _send_unary_request(self) -> ResponseType:
        serialized_request = _common.serialize(
            self._request, self._request_serializer
        )
        try:
            await self._cython_call.initiate_unary_stream(
                serialized_request, self._metadata, self._context
            )
        except asyncio.CancelledError:
            if not self.cancelled():
                self.cancel()
            raise

    async def wait_for_connection(self) -> None:
        await self._send_unary_request_task
        if self.done():
            await self._raise_for_status()


# pylint: disable=too-many-ancestors
class StreamUnaryCall(
    _StreamRequestMixin, _UnaryResponseMixin, Call, _base_call.StreamUnaryCall
):
    """Object for managing stream-unary RPC calls.

    Returned when an instance of `StreamUnaryMultiCallable` object is called.
    """

    # pylint: disable=too-many-arguments
    def __init__(
        self,
        request_iterator: Optional[RequestIterableType],
        deadline: Optional[float],
        metadata: Metadata,
        credentials: Optional[grpc.CallCredentials],
        wait_for_ready: Optional[bool],
        channel: cygrpc.AioChannel,
        method: bytes,
        request_serializer: SerializingFunction,
        response_deserializer: DeserializingFunction,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        super().__init__(
            channel.call(method, deadline, credentials, wait_for_ready),
            metadata,
            request_serializer,
            response_deserializer,
            loop,
        )

        self._context = cygrpc.build_census_context()
        self._init_stream_request_mixin(request_iterator)
        self._init_unary_response_mixin(loop.create_task(self._conduct_rpc()))

    async def _conduct_rpc(self) -> ResponseType:
        try:
            serialized_response = await self._cython_call.stream_unary(
                self._metadata, self._metadata_sent_observer, self._context
            )
        except asyncio.CancelledError:
            if not self.cancelled():
                self.cancel()
            raise

        if self._cython_call.is_ok():
            return _common.deserialize(
                serialized_response, self._response_deserializer
            )
        else:
            return cygrpc.EOF


class StreamStreamCall(
    _StreamRequestMixin, _StreamResponseMixin, Call, _base_call.StreamStreamCall
):
    """Object for managing stream-stream RPC calls.

    Returned when an instance of `StreamStreamMultiCallable` object is called.
    """

    _initializer: asyncio.Task

    # pylint: disable=too-many-arguments
    def __init__(
        self,
        request_iterator: Optional[RequestIterableType],
        deadline: Optional[float],
        metadata: Metadata,
        credentials: Optional[grpc.CallCredentials],
        wait_for_ready: Optional[bool],
        channel: cygrpc.AioChannel,
        method: bytes,
        request_serializer: SerializingFunction,
        response_deserializer: DeserializingFunction,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        super().__init__(
            channel.call(method, deadline, credentials, wait_for_ready),
            metadata,
            request_serializer,
            response_deserializer,
            loop,
        )
        self._context = cygrpc.build_census_context()
        self._initializer = self._loop.create_task(self._prepare_rpc())
        self._init_stream_request_mixin(request_iterator)
        self._init_stream_response_mixin(self._initializer)

    async def _prepare_rpc(self):
        """This method prepares the RPC for receiving/sending messages.

        All other operations around the stream should only happen after the
        completion of this method.
        """
        try:
            await self._cython_call.initiate_stream_stream(
                self._metadata, self._metadata_sent_observer, self._context
            )
        except asyncio.CancelledError:
            if not self.cancelled():
                self.cancel()
            # No need to raise RpcError here, because no one will `await` this task.
