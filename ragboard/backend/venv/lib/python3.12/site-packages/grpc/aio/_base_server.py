# Copyright 2020 The gRPC Authors
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
"""Abstract base classes for server-side classes."""

import abc
from typing import Generic, Iterable, Mapping, NoReturn, Optional, Sequence

import grpc

from ._metadata import Metadata  # pylint: disable=unused-import
from ._typing import DoneCallbackType
from ._typing import MetadataType
from ._typing import RequestType
from ._typing import ResponseType


class Server(abc.ABC):
    """Serves RPCs."""

    @abc.abstractmethod
    def add_generic_rpc_handlers(
        self, generic_rpc_handlers: Sequence[grpc.GenericRpcHandler]
    ) -> None:
        """Registers GenericRpcHandlers with this Server.

        This method is only safe to call before the server is started.

        Args:
          generic_rpc_handlers: A sequence of GenericRpcHandlers that will be
          used to service RPCs.
        """

    @abc.abstractmethod
    def add_insecure_port(self, address: str) -> int:
        """Opens an insecure port for accepting RPCs.

        A port is a communication endpoint that used by networking protocols,
        like TCP and UDP. To date, we only support TCP.

        This method may only be called before starting the server.

        Args:
          address: The address for which to open a port. If the port is 0,
            or not specified in the address, then the gRPC runtime will choose a port.

        Returns:
          An integer port on which the server will accept RPC requests.
        """

    @abc.abstractmethod
    def add_secure_port(
        self, address: str, server_credentials: grpc.ServerCredentials
    ) -> int:
        """Opens a secure port for accepting RPCs.

        A port is a communication endpoint that used by networking protocols,
        like TCP and UDP. To date, we only support TCP.

        This method may only be called before starting the server.

        Args:
          address: The address for which to open a port.
            if the port is 0, or not specified in the address, then the gRPC
            runtime will choose a port.
          server_credentials: A ServerCredentials object.

        Returns:
          An integer port on which the server will accept RPC requests.
        """

    @abc.abstractmethod
    async def start(self) -> None:
        """Starts this Server.

        This method may only be called once. (i.e. it is not idempotent).
        """

    @abc.abstractmethod
    async def stop(self, grace: Optional[float]) -> None:
        """Stops this Server.

        This method immediately stops the server from servicing new RPCs in
        all cases.

        If a grace period is specified, this method waits until all active
        RPCs are finished or until the grace period is reached. RPCs that haven't
        been terminated within the grace period are aborted.
        If a grace period is not specified (by passing None for grace), all
        existing RPCs are aborted immediately and this method blocks until
        the last RPC handler terminates.

        This method is idempotent and may be called at any time. Passing a
        smaller grace value in a subsequent call will have the effect of
        stopping the Server sooner (passing None will have the effect of
        stopping the server immediately). Passing a larger grace value in a
        subsequent call will not have the effect of stopping the server later
        (i.e. the most restrictive grace value is used).

        Args:
          grace: A duration of time in seconds or None.
        """

    @abc.abstractmethod
    async def wait_for_termination(
        self, timeout: Optional[float] = None
    ) -> bool:
        """Continues current coroutine once the server stops.

        This is an EXPERIMENTAL API.

        The wait will not consume computational resources during blocking, and
        it will block until one of the two following conditions are met:

        1) The server is stopped or terminated;
        2) A timeout occurs if timeout is not `None`.

        The timeout argument works in the same way as `threading.Event.wait()`.
        https://docs.python.org/3/library/threading.html#threading.Event.wait

        Args:
          timeout: A floating point number specifying a timeout for the
            operation in seconds.

        Returns:
          A bool indicates if the operation times out.
        """

    def add_registered_method_handlers(self, service_name, method_handlers):
        """Registers GenericRpcHandlers with this Server.

        This method is only safe to call before the server is started.

        Args:
          service_name: The service name.
          method_handlers: A dictionary that maps method names to corresponding
            RpcMethodHandler.
        """


# pylint: disable=too-many-public-methods
class ServicerContext(Generic[RequestType, ResponseType], abc.ABC):
    """A context object passed to method implementations."""

    @abc.abstractmethod
    async def read(self) -> RequestType:
        """Reads one message from the RPC.

        Only one read operation is allowed simultaneously.

        Returns:
          A response message of the RPC.

        Raises:
          An RpcError exception if the read failed.
        """

    @abc.abstractmethod
    async def write(self, message: ResponseType) -> None:
        """Writes one message to the RPC.

        Only one write operation is allowed simultaneously.

        Raises:
          An RpcError exception if the write failed.
        """

    @abc.abstractmethod
    async def send_initial_metadata(
        self, initial_metadata: MetadataType
    ) -> None:
        """Sends the initial metadata value to the client.

        This method need not be called by implementations if they have no
        metadata to add to what the gRPC runtime will transmit.

        Args:
          initial_metadata: The initial :term:`metadata`.
        """

    @abc.abstractmethod
    async def abort(
        self,
        code: grpc.StatusCode,
        details: str = "",
        trailing_metadata: MetadataType = tuple(),
    ) -> NoReturn:
        """Raises an exception to terminate the RPC with a non-OK status.

        The code and details passed as arguments will supersede any existing
        ones.

        Args:
          code: A StatusCode object to be sent to the client.
            It must not be StatusCode.OK.
          details: A UTF-8-encodable string to be sent to the client upon
            termination of the RPC.
          trailing_metadata: A sequence of tuple represents the trailing
            :term:`metadata`.

        Raises:
          Exception: An exception is always raised to signal the abortion the
            RPC to the gRPC runtime.
        """

    @abc.abstractmethod
    def set_trailing_metadata(self, trailing_metadata: MetadataType) -> None:
        """Sends the trailing metadata for the RPC.

        This method need not be called by implementations if they have no
        metadata to add to what the gRPC runtime will transmit.

        Args:
          trailing_metadata: The trailing :term:`metadata`.
        """

    @abc.abstractmethod
    def invocation_metadata(self) -> Optional[MetadataType]:
        """Accesses the metadata sent by the client.

        Returns:
          The invocation :term:`metadata`.
        """

    @abc.abstractmethod
    def set_code(self, code: grpc.StatusCode) -> None:
        """Sets the value to be used as status code upon RPC completion.

        This method need not be called by method implementations if they wish
        the gRPC runtime to determine the status code of the RPC.

        Args:
          code: A StatusCode object to be sent to the client.
        """

    @abc.abstractmethod
    def set_details(self, details: str) -> None:
        """Sets the value to be used the as detail string upon RPC completion.

        This method need not be called by method implementations if they have
        no details to transmit.

        Args:
          details: A UTF-8-encodable string to be sent to the client upon
            termination of the RPC.
        """

    @abc.abstractmethod
    def set_compression(self, compression: grpc.Compression) -> None:
        """Set the compression algorithm to be used for the entire call.

        Args:
          compression: An element of grpc.compression, e.g.
            grpc.compression.Gzip.
        """

    @abc.abstractmethod
    def disable_next_message_compression(self) -> None:
        """Disables compression for the next response message.

        This method will override any compression configuration set during
        server creation or set on the call.
        """

    @abc.abstractmethod
    def peer(self) -> str:
        """Identifies the peer that invoked the RPC being serviced.

        Returns:
          A string identifying the peer that invoked the RPC being serviced.
          The string format is determined by gRPC runtime.
        """

    @abc.abstractmethod
    def peer_identities(self) -> Optional[Iterable[bytes]]:
        """Gets one or more peer identity(s).

        Equivalent to
        servicer_context.auth_context().get(servicer_context.peer_identity_key())

        Returns:
          An iterable of the identities, or None if the call is not
          authenticated. Each identity is returned as a raw bytes type.
        """

    @abc.abstractmethod
    def peer_identity_key(self) -> Optional[str]:
        """The auth property used to identify the peer.

        For example, "x509_common_name" or "x509_subject_alternative_name" are
        used to identify an SSL peer.

        Returns:
          The auth property (string) that indicates the
          peer identity, or None if the call is not authenticated.
        """

    @abc.abstractmethod
    def auth_context(self) -> Mapping[str, Iterable[bytes]]:
        """Gets the auth context for the call.

        Returns:
          A map of strings to an iterable of bytes for each auth property.
        """

    def time_remaining(self) -> float:
        """Describes the length of allowed time remaining for the RPC.

        Returns:
          A nonnegative float indicating the length of allowed time in seconds
          remaining for the RPC to complete before it is considered to have
          timed out, or None if no deadline was specified for the RPC.
        """

    def trailing_metadata(self):
        """Access value to be used as trailing metadata upon RPC completion.

        This is an EXPERIMENTAL API.

        Returns:
          The trailing :term:`metadata` for the RPC.
        """
        raise NotImplementedError()

    def code(self):
        """Accesses the value to be used as status code upon RPC completion.

        This is an EXPERIMENTAL API.

        Returns:
          The StatusCode value for the RPC.
        """
        raise NotImplementedError()

    def details(self):
        """Accesses the value to be used as detail string upon RPC completion.

        This is an EXPERIMENTAL API.

        Returns:
          The details string of the RPC.
        """
        raise NotImplementedError()

    def add_done_callback(self, callback: DoneCallbackType) -> None:
        """Registers a callback to be called on RPC termination.

        This is an EXPERIMENTAL API.

        Args:
          callback: A callable object will be called with the servicer context
            object as its only argument.
        """

    def cancelled(self) -> bool:
        """Return True if the RPC is cancelled.

        The RPC is cancelled when the cancellation was requested with cancel().

        This is an EXPERIMENTAL API.

        Returns:
          A bool indicates whether the RPC is cancelled or not.
        """

    def done(self) -> bool:
        """Return True if the RPC is done.

        An RPC is done if the RPC is completed, cancelled or aborted.

        This is an EXPERIMENTAL API.

        Returns:
          A bool indicates if the RPC is done.
        """
