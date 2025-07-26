# Copyright 2019 The gRPC Authors
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
"""Abstract base classes for client-side Call objects.

Call objects represents the RPC itself, and offer methods to access / modify
its information. They also offer methods to manipulate the life-cycle of the
RPC, e.g. cancellation.
"""

from abc import ABCMeta
from abc import abstractmethod
from typing import Any, AsyncIterator, Generator, Generic, Optional, Union

import grpc

from ._metadata import Metadata
from ._typing import DoneCallbackType
from ._typing import EOFType
from ._typing import RequestType
from ._typing import ResponseType

__all__ = "RpcContext", "Call", "UnaryUnaryCall", "UnaryStreamCall"


class RpcContext(metaclass=ABCMeta):
    """Provides RPC-related information and action."""

    @abstractmethod
    def cancelled(self) -> bool:
        """Return True if the RPC is cancelled.

        The RPC is cancelled when the cancellation was requested with cancel().

        Returns:
          A bool indicates whether the RPC is cancelled or not.
        """

    @abstractmethod
    def done(self) -> bool:
        """Return True if the RPC is done.

        An RPC is done if the RPC is completed, cancelled or aborted.

        Returns:
          A bool indicates if the RPC is done.
        """

    @abstractmethod
    def time_remaining(self) -> Optional[float]:
        """Describes the length of allowed time remaining for the RPC.

        Returns:
          A nonnegative float indicating the length of allowed time in seconds
          remaining for the RPC to complete before it is considered to have
          timed out, or None if no deadline was specified for the RPC.
        """

    @abstractmethod
    def cancel(self) -> bool:
        """Cancels the RPC.

        Idempotent and has no effect if the RPC has already terminated.

        Returns:
          A bool indicates if the cancellation is performed or not.
        """

    @abstractmethod
    def add_done_callback(self, callback: DoneCallbackType) -> None:
        """Registers a callback to be called on RPC termination.

        Args:
          callback: A callable object will be called with the call object as
          its only argument.
        """


class Call(RpcContext, metaclass=ABCMeta):
    """The abstract base class of an RPC on the client-side."""

    @abstractmethod
    async def initial_metadata(self) -> Metadata:
        """Accesses the initial metadata sent by the server.

        Returns:
          The initial :term:`metadata`.
        """

    @abstractmethod
    async def trailing_metadata(self) -> Metadata:
        """Accesses the trailing metadata sent by the server.

        Returns:
          The trailing :term:`metadata`.
        """

    @abstractmethod
    async def code(self) -> grpc.StatusCode:
        """Accesses the status code sent by the server.

        Returns:
          The StatusCode value for the RPC.
        """

    @abstractmethod
    async def details(self) -> str:
        """Accesses the details sent by the server.

        Returns:
          The details string of the RPC.
        """

    @abstractmethod
    async def wait_for_connection(self) -> None:
        """Waits until connected to peer and raises aio.AioRpcError if failed.

        This is an EXPERIMENTAL method.

        This method ensures the RPC has been successfully connected. Otherwise,
        an AioRpcError will be raised to explain the reason of the connection
        failure.

        This method is recommended for building retry mechanisms.
        """


class UnaryUnaryCall(
    Generic[RequestType, ResponseType], Call, metaclass=ABCMeta
):
    """The abstract base class of a unary-unary RPC on the client-side."""

    @abstractmethod
    def __await__(self) -> Generator[Any, None, ResponseType]:
        """Await the response message to be ready.

        Returns:
          The response message of the RPC.
        """


class UnaryStreamCall(
    Generic[RequestType, ResponseType], Call, metaclass=ABCMeta
):
    @abstractmethod
    def __aiter__(self) -> AsyncIterator[ResponseType]:
        """Returns the async iterator representation that yields messages.

        Under the hood, it is calling the "read" method.

        Returns:
          An async iterator object that yields messages.
        """

    @abstractmethod
    async def read(self) -> Union[EOFType, ResponseType]:
        """Reads one message from the stream.

        Read operations must be serialized when called from multiple
        coroutines.

        Note that the iterator and read/write APIs may not be mixed on
        a single RPC.

        Returns:
          A response message, or an `grpc.aio.EOF` to indicate the end of the
          stream.
        """


class StreamUnaryCall(
    Generic[RequestType, ResponseType], Call, metaclass=ABCMeta
):
    @abstractmethod
    async def write(self, request: RequestType) -> None:
        """Writes one message to the stream.

        Note that the iterator and read/write APIs may not be mixed on
        a single RPC.

        Raises:
          An RpcError exception if the write failed.
        """

    @abstractmethod
    async def done_writing(self) -> None:
        """Notifies server that the client is done sending messages.

        After done_writing is called, any additional invocation to the write
        function will fail. This function is idempotent.
        """

    @abstractmethod
    def __await__(self) -> Generator[Any, None, ResponseType]:
        """Await the response message to be ready.

        Returns:
          The response message of the stream.
        """


class StreamStreamCall(
    Generic[RequestType, ResponseType], Call, metaclass=ABCMeta
):
    @abstractmethod
    def __aiter__(self) -> AsyncIterator[ResponseType]:
        """Returns the async iterator representation that yields messages.

        Under the hood, it is calling the "read" method.

        Returns:
          An async iterator object that yields messages.
        """

    @abstractmethod
    async def read(self) -> Union[EOFType, ResponseType]:
        """Reads one message from the stream.

        Read operations must be serialized when called from multiple
        coroutines.

        Note that the iterator and read/write APIs may not be mixed on
        a single RPC.

        Returns:
          A response message, or an `grpc.aio.EOF` to indicate the end of the
          stream.
        """

    @abstractmethod
    async def write(self, request: RequestType) -> None:
        """Writes one message to the stream.

        Note that the iterator and read/write APIs may not be mixed on
        a single RPC.

        Raises:
          An RpcError exception if the write failed.
        """

    @abstractmethod
    async def done_writing(self) -> None:
        """Notifies server that the client is done sending messages.

        After done_writing is called, any additional invocation to the write
        function will fail. This function is idempotent.
        """
