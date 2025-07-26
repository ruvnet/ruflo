# Copyright 2015-2016 gRPC authors.
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
"""gRPC's Python API."""

import abc
import contextlib
import enum
import logging
import sys

from grpc import _compression
from grpc._cython import cygrpc as _cygrpc
from grpc._runtime_protos import protos
from grpc._runtime_protos import protos_and_services
from grpc._runtime_protos import services

logging.getLogger(__name__).addHandler(logging.NullHandler())

try:
    # pylint: disable=ungrouped-imports
    from grpc._grpcio_metadata import __version__
except ImportError:
    __version__ = "dev0"

############################## Future Interface  ###############################


class FutureTimeoutError(Exception):
    """Indicates that a method call on a Future timed out."""


class FutureCancelledError(Exception):
    """Indicates that the computation underlying a Future was cancelled."""


class Future(abc.ABC):
    """A representation of a computation in another control flow.

    Computations represented by a Future may be yet to be begun,
    may be ongoing, or may have already completed.
    """

    @abc.abstractmethod
    def cancel(self):
        """Attempts to cancel the computation.

        This method does not block.

        Returns:
            bool:
            Returns True if the computation was canceled.

            Returns False under all other circumstances, for example:

            1. computation has begun and could not be canceled.
            2. computation has finished
            3. computation is scheduled for execution and it is impossible
                to determine its state without blocking.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def cancelled(self):
        """Describes whether the computation was cancelled.

        This method does not block.

        Returns:
            bool:
            Returns True if the computation was cancelled before its result became
            available.

            Returns False under all other circumstances, for example:

            1. computation was not cancelled.
            2. computation's result is available.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def running(self):
        """Describes whether the computation is taking place.

        This method does not block.

        Returns:
            Returns True if the computation is scheduled for execution or
            currently executing.

            Returns False if the computation already executed or was cancelled.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def done(self):
        """Describes whether the computation has taken place.

        This method does not block.

        Returns:
            bool:
            Returns True if the computation already executed or was cancelled.
            Returns False if the computation is scheduled for execution or
            currently executing.
            This is exactly opposite of the running() method's result.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def result(self, timeout=None):
        """Returns the result of the computation or raises its exception.

        This method may return immediately or may block.

        Args:
          timeout: The length of time in seconds to wait for the computation to
            finish or be cancelled. If None, the call will block until the
            computations's termination.

        Returns:
          The return value of the computation.

        Raises:
          FutureTimeoutError: If a timeout value is passed and the computation
            does not terminate within the allotted time.
          FutureCancelledError: If the computation was cancelled.
          Exception: If the computation raised an exception, this call will
            raise the same exception.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def exception(self, timeout=None):
        """Return the exception raised by the computation.

        This method may return immediately or may block.

        Args:
          timeout: The length of time in seconds to wait for the computation to
            terminate or be cancelled. If None, the call will block until the
            computations's termination.

        Returns:
            The exception raised by the computation, or None if the computation
            did not raise an exception.

        Raises:
          FutureTimeoutError: If a timeout value is passed and the computation
            does not terminate within the allotted time.
          FutureCancelledError: If the computation was cancelled.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def traceback(self, timeout=None):
        """Access the traceback of the exception raised by the computation.

        This method may return immediately or may block.

        Args:
          timeout: The length of time in seconds to wait for the computation
            to terminate or be cancelled. If None, the call will block until
            the computation's termination.

        Returns:
            The traceback of the exception raised by the computation, or None
            if the computation did not raise an exception.

        Raises:
          FutureTimeoutError: If a timeout value is passed and the computation
            does not terminate within the allotted time.
          FutureCancelledError: If the computation was cancelled.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def add_done_callback(self, fn):
        """Adds a function to be called at completion of the computation.

        The callback will be passed this Future object describing the outcome
        of the computation.  Callbacks will be invoked after the future is
        terminated, whether successfully or not.

        If the computation has already completed, the callback will be called
        immediately.

        Exceptions raised in the callback will be logged at ERROR level, but
        will not terminate any threads of execution.

        Args:
          fn: A callable taking this Future object as its single parameter.
        """
        raise NotImplementedError()


################################  gRPC Enums  ##################################


@enum.unique
class ChannelConnectivity(enum.Enum):
    """Mirrors grpc_connectivity_state in the gRPC Core.

    Attributes:
      IDLE: The channel is idle.
      CONNECTING: The channel is connecting.
      READY: The channel is ready to conduct RPCs.
      TRANSIENT_FAILURE: The channel has seen a failure from which it expects
        to recover.
      SHUTDOWN: The channel has seen a failure from which it cannot recover.
    """

    IDLE = (_cygrpc.ConnectivityState.idle, "idle")
    CONNECTING = (_cygrpc.ConnectivityState.connecting, "connecting")
    READY = (_cygrpc.ConnectivityState.ready, "ready")
    TRANSIENT_FAILURE = (
        _cygrpc.ConnectivityState.transient_failure,
        "transient failure",
    )
    SHUTDOWN = (_cygrpc.ConnectivityState.shutdown, "shutdown")


@enum.unique
class StatusCode(enum.Enum):
    """Mirrors grpc_status_code in the gRPC Core.

    Attributes:
      OK: Not an error; returned on success
      CANCELLED: The operation was cancelled (typically by the caller).
      UNKNOWN: Unknown error.
      INVALID_ARGUMENT: Client specified an invalid argument.
      DEADLINE_EXCEEDED: Deadline expired before operation could complete.
      NOT_FOUND: Some requested entity (e.g., file or directory) was not found.
      ALREADY_EXISTS: Some entity that we attempted to create (e.g., file or directory)
        already exists.
      PERMISSION_DENIED: The caller does not have permission to execute the specified
        operation.
      UNAUTHENTICATED: The request does not have valid authentication credentials for the
        operation.
      RESOURCE_EXHAUSTED: Some resource has been exhausted, perhaps a per-user quota, or
        perhaps the entire file system is out of space.
      FAILED_PRECONDITION: Operation was rejected because the system is not in a state
        required for the operation's execution.
      ABORTED: The operation was aborted, typically due to a concurrency issue
        like sequencer check failures, transaction aborts, etc.
      UNIMPLEMENTED: Operation is not implemented or not supported/enabled in this service.
      INTERNAL: Internal errors.  Means some invariants expected by underlying
        system has been broken.
      UNAVAILABLE: The service is currently unavailable.
      DATA_LOSS: Unrecoverable data loss or corruption.
    """

    OK = (_cygrpc.StatusCode.ok, "ok")
    CANCELLED = (_cygrpc.StatusCode.cancelled, "cancelled")
    UNKNOWN = (_cygrpc.StatusCode.unknown, "unknown")
    INVALID_ARGUMENT = (_cygrpc.StatusCode.invalid_argument, "invalid argument")
    DEADLINE_EXCEEDED = (
        _cygrpc.StatusCode.deadline_exceeded,
        "deadline exceeded",
    )
    NOT_FOUND = (_cygrpc.StatusCode.not_found, "not found")
    ALREADY_EXISTS = (_cygrpc.StatusCode.already_exists, "already exists")
    PERMISSION_DENIED = (
        _cygrpc.StatusCode.permission_denied,
        "permission denied",
    )
    RESOURCE_EXHAUSTED = (
        _cygrpc.StatusCode.resource_exhausted,
        "resource exhausted",
    )
    FAILED_PRECONDITION = (
        _cygrpc.StatusCode.failed_precondition,
        "failed precondition",
    )
    ABORTED = (_cygrpc.StatusCode.aborted, "aborted")
    OUT_OF_RANGE = (_cygrpc.StatusCode.out_of_range, "out of range")
    UNIMPLEMENTED = (_cygrpc.StatusCode.unimplemented, "unimplemented")
    INTERNAL = (_cygrpc.StatusCode.internal, "internal")
    UNAVAILABLE = (_cygrpc.StatusCode.unavailable, "unavailable")
    DATA_LOSS = (_cygrpc.StatusCode.data_loss, "data loss")
    UNAUTHENTICATED = (_cygrpc.StatusCode.unauthenticated, "unauthenticated")


#############################  gRPC Status  ################################


class Status(abc.ABC):
    """Describes the status of an RPC.

    This is an EXPERIMENTAL API.

    Attributes:
      code: A StatusCode object to be sent to the client.
      details: A UTF-8-encodable string to be sent to the client upon
        termination of the RPC.
      trailing_metadata: The trailing :term:`metadata` in the RPC.
    """


#############################  gRPC Exceptions  ################################


class RpcError(Exception):
    """Raised by the gRPC library to indicate non-OK-status RPC termination."""


##############################  Shared Context  ################################


class RpcContext(abc.ABC):
    """Provides RPC-related information and action."""

    @abc.abstractmethod
    def is_active(self):
        """Describes whether the RPC is active or has terminated.

        Returns:
          bool:
          True if RPC is active, False otherwise.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def time_remaining(self):
        """Describes the length of allowed time remaining for the RPC.

        Returns:
          A nonnegative float indicating the length of allowed time in seconds
          remaining for the RPC to complete before it is considered to have
          timed out, or None if no deadline was specified for the RPC.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def cancel(self):
        """Cancels the RPC.

        Idempotent and has no effect if the RPC has already terminated.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def add_callback(self, callback):
        """Registers a callback to be called on RPC termination.

        Args:
          callback: A no-parameter callable to be called on RPC termination.

        Returns:
          True if the callback was added and will be called later; False if
            the callback was not added and will not be called (because the RPC
            already terminated or some other reason).
        """
        raise NotImplementedError()


#########################  Invocation-Side Context  ############################


class Call(RpcContext, metaclass=abc.ABCMeta):
    """Invocation-side utility object for an RPC."""

    @abc.abstractmethod
    def initial_metadata(self):
        """Accesses the initial metadata sent by the server.

        This method blocks until the value is available.

        Returns:
          The initial :term:`metadata`.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def trailing_metadata(self):
        """Accesses the trailing metadata sent by the server.

        This method blocks until the value is available.

        Returns:
          The trailing :term:`metadata`.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def code(self):
        """Accesses the status code sent by the server.

        This method blocks until the value is available.

        Returns:
          The StatusCode value for the RPC.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def details(self):
        """Accesses the details sent by the server.

        This method blocks until the value is available.

        Returns:
          The details string of the RPC.
        """
        raise NotImplementedError()


##############  Invocation-Side Interceptor Interfaces & Classes  ##############


class ClientCallDetails(abc.ABC):
    """Describes an RPC to be invoked.

    Attributes:
      method: The method name of the RPC.
      timeout: An optional duration of time in seconds to allow for the RPC.
      metadata: Optional :term:`metadata` to be transmitted to
        the service-side of the RPC.
      credentials: An optional CallCredentials for the RPC.
      wait_for_ready: An optional flag to enable :term:`wait_for_ready` mechanism.
      compression: An element of grpc.compression, e.g.
        grpc.compression.Gzip.
    """


class UnaryUnaryClientInterceptor(abc.ABC):
    """Affords intercepting unary-unary invocations."""

    @abc.abstractmethod
    def intercept_unary_unary(self, continuation, client_call_details, request):
        """Intercepts a unary-unary invocation asynchronously.

        Args:
          continuation: A function that proceeds with the invocation by
            executing the next interceptor in chain or invoking the
            actual RPC on the underlying Channel. It is the interceptor's
            responsibility to call it if it decides to move the RPC forward.
            The interceptor can use
            `response_future = continuation(client_call_details, request)`
            to continue with the RPC. `continuation` returns an object that is
            both a Call for the RPC and a Future. In the event of RPC
            completion, the return Call-Future's result value will be
            the response message of the RPC. Should the event terminate
            with non-OK status, the returned Call-Future's exception value
            will be an RpcError.
          client_call_details: A ClientCallDetails object describing the
            outgoing RPC.
          request: The request value for the RPC.

        Returns:
            An object that is both a Call for the RPC and a Future.
            In the event of RPC completion, the return Call-Future's
            result value will be the response message of the RPC.
            Should the event terminate with non-OK status, the returned
            Call-Future's exception value will be an RpcError.
        """
        raise NotImplementedError()


class UnaryStreamClientInterceptor(abc.ABC):
    """Affords intercepting unary-stream invocations."""

    @abc.abstractmethod
    def intercept_unary_stream(
        self, continuation, client_call_details, request
    ):
        """Intercepts a unary-stream invocation.

        Args:
          continuation: A function that proceeds with the invocation by
            executing the next interceptor in chain or invoking the
            actual RPC on the underlying Channel. It is the interceptor's
            responsibility to call it if it decides to move the RPC forward.
            The interceptor can use
            `response_iterator = continuation(client_call_details, request)`
            to continue with the RPC. `continuation` returns an object that is
            both a Call for the RPC and an iterator for response values.
            Drawing response values from the returned Call-iterator may
            raise RpcError indicating termination of the RPC with non-OK
            status.
          client_call_details: A ClientCallDetails object describing the
            outgoing RPC.
          request: The request value for the RPC.

        Returns:
            An object that is both a Call for the RPC and an iterator of
            response values. Drawing response values from the returned
            Call-iterator may raise RpcError indicating termination of
            the RPC with non-OK status. This object *should* also fulfill the
            Future interface, though it may not.
        """
        raise NotImplementedError()


class StreamUnaryClientInterceptor(abc.ABC):
    """Affords intercepting stream-unary invocations."""

    @abc.abstractmethod
    def intercept_stream_unary(
        self, continuation, client_call_details, request_iterator
    ):
        """Intercepts a stream-unary invocation asynchronously.

        Args:
          continuation: A function that proceeds with the invocation by
            executing the next interceptor in chain or invoking the
            actual RPC on the underlying Channel. It is the interceptor's
            responsibility to call it if it decides to move the RPC forward.
            The interceptor can use
            `response_future = continuation(client_call_details, request_iterator)`
            to continue with the RPC. `continuation` returns an object that is
            both a Call for the RPC and a Future. In the event of RPC completion,
            the return Call-Future's result value will be the response message
            of the RPC. Should the event terminate with non-OK status, the
            returned Call-Future's exception value will be an RpcError.
          client_call_details: A ClientCallDetails object describing the
            outgoing RPC.
          request_iterator: An iterator that yields request values for the RPC.

        Returns:
          An object that is both a Call for the RPC and a Future.
          In the event of RPC completion, the return Call-Future's
          result value will be the response message of the RPC.
          Should the event terminate with non-OK status, the returned
          Call-Future's exception value will be an RpcError.
        """
        raise NotImplementedError()


class StreamStreamClientInterceptor(abc.ABC):
    """Affords intercepting stream-stream invocations."""

    @abc.abstractmethod
    def intercept_stream_stream(
        self, continuation, client_call_details, request_iterator
    ):
        """Intercepts a stream-stream invocation.

        Args:
          continuation: A function that proceeds with the invocation by
            executing the next interceptor in chain or invoking the
            actual RPC on the underlying Channel. It is the interceptor's
            responsibility to call it if it decides to move the RPC forward.
            The interceptor can use
            `response_iterator = continuation(client_call_details, request_iterator)`
            to continue with the RPC. `continuation` returns an object that is
            both a Call for the RPC and an iterator for response values.
            Drawing response values from the returned Call-iterator may
            raise RpcError indicating termination of the RPC with non-OK
            status.
          client_call_details: A ClientCallDetails object describing the
            outgoing RPC.
          request_iterator: An iterator that yields request values for the RPC.

        Returns:
          An object that is both a Call for the RPC and an iterator of
          response values. Drawing response values from the returned
          Call-iterator may raise RpcError indicating termination of
          the RPC with non-OK status. This object *should* also fulfill the
          Future interface, though it may not.
        """
        raise NotImplementedError()


############  Authentication & Authorization Interfaces & Classes  #############


class ChannelCredentials(object):
    """An encapsulation of the data required to create a secure Channel.

    This class has no supported interface - it exists to define the type of its
    instances and its instances exist to be passed to other functions. For
    example, ssl_channel_credentials returns an instance of this class and
    secure_channel requires an instance of this class.
    """

    def __init__(self, credentials):
        self._credentials = credentials


class CallCredentials(object):
    """An encapsulation of the data required to assert an identity over a call.

    A CallCredentials has to be used with secure Channel, otherwise the
    metadata will not be transmitted to the server.

    A CallCredentials may be composed with ChannelCredentials to always assert
    identity for every call over that Channel.

    This class has no supported interface - it exists to define the type of its
    instances and its instances exist to be passed to other functions.
    """

    def __init__(self, credentials):
        self._credentials = credentials


class AuthMetadataContext(abc.ABC):
    """Provides information to call credentials metadata plugins.

    Attributes:
      service_url: A string URL of the service being called into.
      method_name: A string of the fully qualified method name being called.
    """


class AuthMetadataPluginCallback(abc.ABC):
    """Callback object received by a metadata plugin."""

    def __call__(self, metadata, error):
        """Passes to the gRPC runtime authentication metadata for an RPC.

        Args:
          metadata: The :term:`metadata` used to construct the CallCredentials.
          error: An Exception to indicate error or None to indicate success.
        """
        raise NotImplementedError()


class AuthMetadataPlugin(abc.ABC):
    """A specification for custom authentication."""

    def __call__(self, context, callback):
        """Implements authentication by passing metadata to a callback.

        This method will be invoked asynchronously in a separate thread.

        Args:
          context: An AuthMetadataContext providing information on the RPC that
            the plugin is being called to authenticate.
          callback: An AuthMetadataPluginCallback to be invoked either
            synchronously or asynchronously.
        """
        raise NotImplementedError()


class ServerCredentials(object):
    """An encapsulation of the data required to open a secure port on a Server.

    This class has no supported interface - it exists to define the type of its
    instances and its instances exist to be passed to other functions.
    """

    def __init__(self, credentials):
        self._credentials = credentials


class ServerCertificateConfiguration(object):
    """A certificate configuration for use with an SSL-enabled Server.

    Instances of this class can be returned in the certificate configuration
    fetching callback.

    This class has no supported interface -- it exists to define the
    type of its instances and its instances exist to be passed to
    other functions.
    """

    def __init__(self, certificate_configuration):
        self._certificate_configuration = certificate_configuration


########################  Multi-Callable Interfaces  ###########################


class UnaryUnaryMultiCallable(abc.ABC):
    """Affords invoking a unary-unary RPC from client-side."""

    @abc.abstractmethod
    def __call__(
        self,
        request,
        timeout=None,
        metadata=None,
        credentials=None,
        wait_for_ready=None,
        compression=None,
    ):
        """Synchronously invokes the underlying RPC.

        Args:
          request: The request value for the RPC.
          timeout: An optional duration of time in seconds to allow
            for the RPC.
          metadata: Optional :term:`metadata` to be transmitted to the
            service-side of the RPC.
          credentials: An optional CallCredentials for the RPC. Only valid for
            secure Channel.
          wait_for_ready: An optional flag to enable :term:`wait_for_ready` mechanism.
          compression: An element of grpc.compression, e.g.
            grpc.compression.Gzip.

        Returns:
          The response value for the RPC.

        Raises:
          RpcError: Indicating that the RPC terminated with non-OK status. The
            raised RpcError will also be a Call for the RPC affording the RPC's
            metadata, status code, and details.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def with_call(
        self,
        request,
        timeout=None,
        metadata=None,
        credentials=None,
        wait_for_ready=None,
        compression=None,
    ):
        """Synchronously invokes the underlying RPC.

        Args:
          request: The request value for the RPC.
          timeout: An optional durating of time in seconds to allow for
            the RPC.
          metadata: Optional :term:`metadata` to be transmitted to the
            service-side of the RPC.
          credentials: An optional CallCredentials for the RPC. Only valid for
            secure Channel.
          wait_for_ready: An optional flag to enable :term:`wait_for_ready` mechanism.
          compression: An element of grpc.compression, e.g.
            grpc.compression.Gzip.

        Returns:
          The response value for the RPC and a Call value for the RPC.

        Raises:
          RpcError: Indicating that the RPC terminated with non-OK status. The
            raised RpcError will also be a Call for the RPC affording the RPC's
            metadata, status code, and details.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def future(
        self,
        request,
        timeout=None,
        metadata=None,
        credentials=None,
        wait_for_ready=None,
        compression=None,
    ):
        """Asynchronously invokes the underlying RPC.

        Args:
          request: The request value for the RPC.
          timeout: An optional duration of time in seconds to allow for
            the RPC.
          metadata: Optional :term:`metadata` to be transmitted to the
            service-side of the RPC.
          credentials: An optional CallCredentials for the RPC. Only valid for
            secure Channel.
          wait_for_ready: An optional flag to enable :term:`wait_for_ready` mechanism.
          compression: An element of grpc.compression, e.g.
            grpc.compression.Gzip.

        Returns:
            An object that is both a Call for the RPC and a Future.
            In the event of RPC completion, the return Call-Future's result
            value will be the response message of the RPC.
            Should the event terminate with non-OK status,
            the returned Call-Future's exception value will be an RpcError.
        """
        raise NotImplementedError()


class UnaryStreamMultiCallable(abc.ABC):
    """Affords invoking a unary-stream RPC from client-side."""

    @abc.abstractmethod
    def __call__(
        self,
        request,
        timeout=None,
        metadata=None,
        credentials=None,
        wait_for_ready=None,
        compression=None,
    ):
        """Invokes the underlying RPC.

        Args:
          request: The request value for the RPC.
          timeout: An optional duration of time in seconds to allow for
            the RPC. If None, the timeout is considered infinite.
          metadata: An optional :term:`metadata` to be transmitted to the
            service-side of the RPC.
          credentials: An optional CallCredentials for the RPC. Only valid for
            secure Channel.
          wait_for_ready: An optional flag to enable :term:`wait_for_ready` mechanism.
          compression: An element of grpc.compression, e.g.
            grpc.compression.Gzip.

        Returns:
            An object that is a Call for the RPC, an iterator of response
            values, and a Future for the RPC. Drawing response values from the
            returned Call-iterator may raise RpcError indicating termination of
            the RPC with non-OK status.
        """
        raise NotImplementedError()


class StreamUnaryMultiCallable(abc.ABC):
    """Affords invoking a stream-unary RPC from client-side."""

    @abc.abstractmethod
    def __call__(
        self,
        request_iterator,
        timeout=None,
        metadata=None,
        credentials=None,
        wait_for_ready=None,
        compression=None,
    ):
        """Synchronously invokes the underlying RPC.

        Args:
          request_iterator: An iterator that yields request values for
            the RPC.
          timeout: An optional duration of time in seconds to allow for
            the RPC. If None, the timeout is considered infinite.
          metadata: Optional :term:`metadata` to be transmitted to the
            service-side of the RPC.
          credentials: An optional CallCredentials for the RPC. Only valid for
            secure Channel.
          wait_for_ready: An optional flag to enable :term:`wait_for_ready` mechanism.
          compression: An element of grpc.compression, e.g.
            grpc.compression.Gzip.

        Returns:
          The response value for the RPC.

        Raises:
          RpcError: Indicating that the RPC terminated with non-OK status. The
            raised RpcError will also implement grpc.Call, affording methods
            such as metadata, code, and details.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def with_call(
        self,
        request_iterator,
        timeout=None,
        metadata=None,
        credentials=None,
        wait_for_ready=None,
        compression=None,
    ):
        """Synchronously invokes the underlying RPC on the client.

        Args:
          request_iterator: An iterator that yields request values for
            the RPC.
          timeout: An optional duration of time in seconds to allow for
            the RPC. If None, the timeout is considered infinite.
          metadata: Optional :term:`metadata` to be transmitted to the
            service-side of the RPC.
          credentials: An optional CallCredentials for the RPC. Only valid for
            secure Channel.
          wait_for_ready: An optional flag to enable :term:`wait_for_ready` mechanism.
          compression: An element of grpc.compression, e.g.
            grpc.compression.Gzip.

        Returns:
          The response value for the RPC and a Call object for the RPC.

        Raises:
          RpcError: Indicating that the RPC terminated with non-OK status. The
            raised RpcError will also be a Call for the RPC affording the RPC's
            metadata, status code, and details.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def future(
        self,
        request_iterator,
        timeout=None,
        metadata=None,
        credentials=None,
        wait_for_ready=None,
        compression=None,
    ):
        """Asynchronously invokes the underlying RPC on the client.

        Args:
          request_iterator: An iterator that yields request values for the RPC.
          timeout: An optional duration of time in seconds to allow for
            the RPC. If None, the timeout is considered infinite.
          metadata: Optional :term:`metadata` to be transmitted to the
            service-side of the RPC.
          credentials: An optional CallCredentials for the RPC. Only valid for
            secure Channel.
          wait_for_ready: An optional flag to enable :term:`wait_for_ready` mechanism.
          compression: An element of grpc.compression, e.g.
            grpc.compression.Gzip.

        Returns:
            An object that is both a Call for the RPC and a Future.
            In the event of RPC completion, the return Call-Future's result value
            will be the response message of the RPC. Should the event terminate
            with non-OK status, the returned Call-Future's exception value will
            be an RpcError.
        """
        raise NotImplementedError()


class StreamStreamMultiCallable(abc.ABC):
    """Affords invoking a stream-stream RPC on client-side."""

    @abc.abstractmethod
    def __call__(
        self,
        request_iterator,
        timeout=None,
        metadata=None,
        credentials=None,
        wait_for_ready=None,
        compression=None,
    ):
        """Invokes the underlying RPC on the client.

        Args:
          request_iterator: An iterator that yields request values for the RPC.
          timeout: An optional duration of time in seconds to allow for
            the RPC. If not specified, the timeout is considered infinite.
          metadata: Optional :term:`metadata` to be transmitted to the
            service-side of the RPC.
          credentials: An optional CallCredentials for the RPC. Only valid for
            secure Channel.
          wait_for_ready: An optional flag to enable :term:`wait_for_ready` mechanism.
          compression: An element of grpc.compression, e.g.
            grpc.compression.Gzip.

        Returns:
            An object that is a Call for the RPC, an iterator of response
            values, and a Future for the RPC. Drawing response values from the
            returned Call-iterator may raise RpcError indicating termination of
            the RPC with non-OK status.
        """
        raise NotImplementedError()


#############################  Channel Interface  ##############################


class Channel(abc.ABC):
    """Affords RPC invocation via generic methods on client-side.

    Channel objects implement the Context Manager type, although they need not
    support being entered and exited multiple times.
    """

    @abc.abstractmethod
    def subscribe(self, callback, try_to_connect=False):
        """Subscribe to this Channel's connectivity state machine.

        A Channel may be in any of the states described by ChannelConnectivity.
        This method allows application to monitor the state transitions.
        The typical use case is to debug or gain better visibility into gRPC
        runtime's state.

        Args:
          callback: A callable to be invoked with ChannelConnectivity argument.
            ChannelConnectivity describes current state of the channel.
            The callable will be invoked immediately upon subscription
            and again for every change to ChannelConnectivity until it
            is unsubscribed or this Channel object goes out of scope.
          try_to_connect: A boolean indicating whether or not this Channel
            should attempt to connect immediately. If set to False, gRPC
            runtime decides when to connect.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def unsubscribe(self, callback):
        """Unsubscribes a subscribed callback from this Channel's connectivity.

        Args:
          callback: A callable previously registered with this Channel from
          having been passed to its "subscribe" method.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def unary_unary(
        self,
        method,
        request_serializer=None,
        response_deserializer=None,
        _registered_method=False,
    ):
        """Creates a UnaryUnaryMultiCallable for a unary-unary method.

        Args:
          method: The name of the RPC method.
          request_serializer: Optional :term:`serializer` for serializing the request
            message. Request goes unserialized in case None is passed.
          response_deserializer: Optional :term:`deserializer` for deserializing the
            response message. Response goes undeserialized in case None
            is passed.
          _registered_method: Implementation Private. A bool representing whether the method
            is registered.

        Returns:
          A UnaryUnaryMultiCallable value for the named unary-unary method.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def unary_stream(
        self,
        method,
        request_serializer=None,
        response_deserializer=None,
        _registered_method=False,
    ):
        """Creates a UnaryStreamMultiCallable for a unary-stream method.

        Args:
          method: The name of the RPC method.
          request_serializer: Optional :term:`serializer` for serializing the request
            message. Request goes unserialized in case None is passed.
          response_deserializer: Optional :term:`deserializer` for deserializing the
            response message. Response goes undeserialized in case None is
            passed.
          _registered_method: Implementation Private. A bool representing whether the method
            is registered.

        Returns:
          A UnaryStreamMultiCallable value for the name unary-stream method.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def stream_unary(
        self,
        method,
        request_serializer=None,
        response_deserializer=None,
        _registered_method=False,
    ):
        """Creates a StreamUnaryMultiCallable for a stream-unary method.

        Args:
          method: The name of the RPC method.
          request_serializer: Optional :term:`serializer` for serializing the request
            message. Request goes unserialized in case None is passed.
          response_deserializer: Optional :term:`deserializer` for deserializing the
            response message. Response goes undeserialized in case None is
            passed.
          _registered_method: Implementation Private. A bool representing whether the method
            is registered.

        Returns:
          A StreamUnaryMultiCallable value for the named stream-unary method.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def stream_stream(
        self,
        method,
        request_serializer=None,
        response_deserializer=None,
        _registered_method=False,
    ):
        """Creates a StreamStreamMultiCallable for a stream-stream method.

        Args:
          method: The name of the RPC method.
          request_serializer: Optional :term:`serializer` for serializing the request
            message. Request goes unserialized in case None is passed.
          response_deserializer: Optional :term:`deserializer` for deserializing the
            response message. Response goes undeserialized in case None
            is passed.
          _registered_method: Implementation Private. A bool representing whether the method
            is registered.

        Returns:
          A StreamStreamMultiCallable value for the named stream-stream method.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def close(self):
        """Closes this Channel and releases all resources held by it.

        Closing the Channel will immediately terminate all RPCs active with the
        Channel and it is not valid to invoke new RPCs with the Channel.

        This method is idempotent.
        """
        raise NotImplementedError()

    def __enter__(self):
        """Enters the runtime context related to the channel object."""
        raise NotImplementedError()

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Exits the runtime context related to the channel object."""
        raise NotImplementedError()


##########################  Service-Side Context  ##############################


class ServicerContext(RpcContext, metaclass=abc.ABCMeta):
    """A context object passed to method implementations."""

    @abc.abstractmethod
    def invocation_metadata(self):
        """Accesses the metadata sent by the client.

        Returns:
          The invocation :term:`metadata`.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def peer(self):
        """Identifies the peer that invoked the RPC being serviced.

        Returns:
          A string identifying the peer that invoked the RPC being serviced.
          The string format is determined by gRPC runtime.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def peer_identities(self):
        """Gets one or more peer identity(s).

        Equivalent to
        servicer_context.auth_context().get(servicer_context.peer_identity_key())

        Returns:
          An iterable of the identities, or None if the call is not
          authenticated. Each identity is returned as a raw bytes type.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def peer_identity_key(self):
        """The auth property used to identify the peer.

        For example, "x509_common_name" or "x509_subject_alternative_name" are
        used to identify an SSL peer.

        Returns:
          The auth property (string) that indicates the
          peer identity, or None if the call is not authenticated.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def auth_context(self):
        """Gets the auth context for the call.

        Returns:
          A map of strings to an iterable of bytes for each auth property.
        """
        raise NotImplementedError()

    def set_compression(self, compression):
        """Set the compression algorithm to be used for the entire call.

        Args:
          compression: An element of grpc.compression, e.g.
            grpc.compression.Gzip.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def send_initial_metadata(self, initial_metadata):
        """Sends the initial metadata value to the client.

        This method need not be called by implementations if they have no
        metadata to add to what the gRPC runtime will transmit.

        Args:
          initial_metadata: The initial :term:`metadata`.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def set_trailing_metadata(self, trailing_metadata):
        """Sets the trailing metadata for the RPC.

        Sets the trailing metadata to be sent upon completion of the RPC.

        If this method is invoked multiple times throughout the lifetime of an
        RPC, the value supplied in the final invocation will be the value sent
        over the wire.

        This method need not be called by implementations if they have no
        metadata to add to what the gRPC runtime will transmit.

        Args:
          trailing_metadata: The trailing :term:`metadata`.
        """
        raise NotImplementedError()

    def trailing_metadata(self):
        """Access value to be used as trailing metadata upon RPC completion.

        This is an EXPERIMENTAL API.

        Returns:
          The trailing :term:`metadata` for the RPC.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def abort(self, code, details):
        """Raises an exception to terminate the RPC with a non-OK status.

        The code and details passed as arguments will supersede any existing
        ones.

        Args:
          code: A StatusCode object to be sent to the client.
            It must not be StatusCode.OK.
          details: A UTF-8-encodable string to be sent to the client upon
            termination of the RPC.

        Raises:
          Exception: An exception is always raised to signal the abortion the
            RPC to the gRPC runtime.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def abort_with_status(self, status):
        """Raises an exception to terminate the RPC with a non-OK status.

        The status passed as argument will supersede any existing status code,
        status message and trailing metadata.

        This is an EXPERIMENTAL API.

        Args:
          status: A grpc.Status object. The status code in it must not be
            StatusCode.OK.

        Raises:
          Exception: An exception is always raised to signal the abortion the
            RPC to the gRPC runtime.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def set_code(self, code):
        """Sets the value to be used as status code upon RPC completion.

        This method need not be called by method implementations if they wish
        the gRPC runtime to determine the status code of the RPC.

        Args:
          code: A StatusCode object to be sent to the client.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def set_details(self, details):
        """Sets the value to be used as detail string upon RPC completion.

        This method need not be called by method implementations if they have
        no details to transmit.

        Args:
          details: A UTF-8-encodable string to be sent to the client upon
            termination of the RPC.
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

    def disable_next_message_compression(self):
        """Disables compression for the next response message.

        This method will override any compression configuration set during
        server creation or set on the call.
        """
        raise NotImplementedError()


#####################  Service-Side Handler Interfaces  ########################


class RpcMethodHandler(abc.ABC):
    """An implementation of a single RPC method.

    Attributes:
      request_streaming: Whether the RPC supports exactly one request message
        or any arbitrary number of request messages.
      response_streaming: Whether the RPC supports exactly one response message
        or any arbitrary number of response messages.
      request_deserializer: A callable :term:`deserializer` that accepts a byte string and
        returns an object suitable to be passed to this object's business
        logic, or None to indicate that this object's business logic should be
        passed the raw request bytes.
      response_serializer: A callable :term:`serializer` that accepts an object produced
        by this object's business logic and returns a byte string, or None to
        indicate that the byte strings produced by this object's business logic
        should be transmitted on the wire as they are.
      unary_unary: This object's application-specific business logic as a
        callable value that takes a request value and a ServicerContext object
        and returns a response value. Only non-None if both request_streaming
        and response_streaming are False.
      unary_stream: This object's application-specific business logic as a
        callable value that takes a request value and a ServicerContext object
        and returns an iterator of response values. Only non-None if
        request_streaming is False and response_streaming is True.
      stream_unary: This object's application-specific business logic as a
        callable value that takes an iterator of request values and a
        ServicerContext object and returns a response value. Only non-None if
        request_streaming is True and response_streaming is False.
      stream_stream: This object's application-specific business logic as a
        callable value that takes an iterator of request values and a
        ServicerContext object and returns an iterator of response values.
        Only non-None if request_streaming and response_streaming are both
        True.
    """


class HandlerCallDetails(abc.ABC):
    """Describes an RPC that has just arrived for service.

    Attributes:
      method: The method name of the RPC.
      invocation_metadata: The :term:`metadata` sent by the client.
    """


class GenericRpcHandler(abc.ABC):
    """An implementation of arbitrarily many RPC methods."""

    @abc.abstractmethod
    def service(self, handler_call_details):
        """Returns the handler for servicing the RPC.

        Args:
          handler_call_details: A HandlerCallDetails describing the RPC.

        Returns:
          An RpcMethodHandler with which the RPC may be serviced if the
          implementation chooses to service this RPC, or None otherwise.
        """
        raise NotImplementedError()


class ServiceRpcHandler(GenericRpcHandler, metaclass=abc.ABCMeta):
    """An implementation of RPC methods belonging to a service.

    A service handles RPC methods with structured names of the form
    '/Service.Name/Service.Method', where 'Service.Name' is the value
    returned by service_name(), and 'Service.Method' is the method
    name.  A service can have multiple method names, but only a single
    service name.
    """

    @abc.abstractmethod
    def service_name(self):
        """Returns this service's name.

        Returns:
          The service name.
        """
        raise NotImplementedError()


####################  Service-Side Interceptor Interfaces  #####################


class ServerInterceptor(abc.ABC):
    """Affords intercepting incoming RPCs on the service-side."""

    @abc.abstractmethod
    def intercept_service(self, continuation, handler_call_details):
        """Intercepts incoming RPCs before handing them over to a handler.

        State can be passed from an interceptor to downstream interceptors
        via contextvars. The first interceptor is called from an empty
        contextvars.Context, and the same Context is used for downstream
        interceptors and for the final handler call. Note that there are no
        guarantees that interceptors and handlers will be called from the
        same thread.

        Args:
          continuation: A function that takes a HandlerCallDetails and
            proceeds to invoke the next interceptor in the chain, if any,
            or the RPC handler lookup logic, with the call details passed
            as an argument, and returns an RpcMethodHandler instance if
            the RPC is considered serviced, or None otherwise.
          handler_call_details: A HandlerCallDetails describing the RPC.

        Returns:
          An RpcMethodHandler with which the RPC may be serviced if the
          interceptor chooses to service this RPC, or None otherwise.
        """
        raise NotImplementedError()


#############################  Server Interface  ###############################


class Server(abc.ABC):
    """Services RPCs."""

    @abc.abstractmethod
    def add_generic_rpc_handlers(self, generic_rpc_handlers):
        """Registers GenericRpcHandlers with this Server.

        This method is only safe to call before the server is started.

        Args:
          generic_rpc_handlers: An iterable of GenericRpcHandlers that will be
          used to service RPCs.
        """
        raise NotImplementedError()

    def add_registered_method_handlers(self, service_name, method_handlers):
        """Registers GenericRpcHandlers with this Server.

        This method is only safe to call before the server is started.

        If the same method have both generic and registered handler,
        registered handler will take precedence.

        Args:
          service_name: The service name.
          method_handlers: A dictionary that maps method names to corresponding
            RpcMethodHandler.
        """

    @abc.abstractmethod
    def add_insecure_port(self, address):
        """Opens an insecure port for accepting RPCs.

        This method may only be called before starting the server.

        Args:
          address: The address for which to open a port. If the port is 0,
            or not specified in the address, then gRPC runtime will choose a port.

        Returns:
          An integer port on which server will accept RPC requests.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def add_secure_port(self, address, server_credentials):
        """Opens a secure port for accepting RPCs.

        This method may only be called before starting the server.

        Args:
          address: The address for which to open a port.
            if the port is 0, or not specified in the address, then gRPC
            runtime will choose a port.
          server_credentials: A ServerCredentials object.

        Returns:
          An integer port on which server will accept RPC requests.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def start(self):
        """Starts this Server.

        This method may only be called once. (i.e. it is not idempotent).
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def stop(self, grace):
        """Stops this Server.

        This method immediately stop service of new RPCs in all cases.

        If a grace period is specified, this method waits until all active
        RPCs are finished or until the grace period is reached. RPCs that haven't
        been terminated within the grace period are aborted.
        If a grace period is not specified (by passing None for `grace`),
        all existing RPCs are aborted immediately and this method
        blocks until the last RPC handler terminates.

        This method is idempotent and may be called at any time.
        Passing a smaller grace value in a subsequent call will have
        the effect of stopping the Server sooner (passing None will
        have the effect of stopping the server immediately). Passing
        a larger grace value in a subsequent call *will not* have the
        effect of stopping the server later (i.e. the most restrictive
        grace value is used).

        Args:
          grace: A duration of time in seconds or None.

        Returns:
          A threading.Event that will be set when this Server has completely
          stopped, i.e. when running RPCs either complete or are aborted and
          all handlers have terminated.
        """
        raise NotImplementedError()

    def wait_for_termination(self, timeout=None):
        """Block current thread until the server stops.

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
        raise NotImplementedError()


#################################  Functions    ################################


def unary_unary_rpc_method_handler(
    behavior, request_deserializer=None, response_serializer=None
):
    """Creates an RpcMethodHandler for a unary-unary RPC method.

    Args:
      behavior: The implementation of an RPC that accepts one request
        and returns one response.
      request_deserializer: An optional :term:`deserializer` for request deserialization.
      response_serializer: An optional :term:`serializer` for response serialization.

    Returns:
      An RpcMethodHandler object that is typically used by grpc.Server.
    """
    from grpc import _utilities  # pylint: disable=cyclic-import

    return _utilities.RpcMethodHandler(
        False,
        False,
        request_deserializer,
        response_serializer,
        behavior,
        None,
        None,
        None,
    )


def unary_stream_rpc_method_handler(
    behavior, request_deserializer=None, response_serializer=None
):
    """Creates an RpcMethodHandler for a unary-stream RPC method.

    Args:
      behavior: The implementation of an RPC that accepts one request
        and returns an iterator of response values.
      request_deserializer: An optional :term:`deserializer` for request deserialization.
      response_serializer: An optional :term:`serializer` for response serialization.

    Returns:
      An RpcMethodHandler object that is typically used by grpc.Server.
    """
    from grpc import _utilities  # pylint: disable=cyclic-import

    return _utilities.RpcMethodHandler(
        False,
        True,
        request_deserializer,
        response_serializer,
        None,
        behavior,
        None,
        None,
    )


def stream_unary_rpc_method_handler(
    behavior, request_deserializer=None, response_serializer=None
):
    """Creates an RpcMethodHandler for a stream-unary RPC method.

    Args:
      behavior: The implementation of an RPC that accepts an iterator of
        request values and returns a single response value.
      request_deserializer: An optional :term:`deserializer` for request deserialization.
      response_serializer: An optional :term:`serializer` for response serialization.

    Returns:
      An RpcMethodHandler object that is typically used by grpc.Server.
    """
    from grpc import _utilities  # pylint: disable=cyclic-import

    return _utilities.RpcMethodHandler(
        True,
        False,
        request_deserializer,
        response_serializer,
        None,
        None,
        behavior,
        None,
    )


def stream_stream_rpc_method_handler(
    behavior, request_deserializer=None, response_serializer=None
):
    """Creates an RpcMethodHandler for a stream-stream RPC method.

    Args:
      behavior: The implementation of an RPC that accepts an iterator of
        request values and returns an iterator of response values.
      request_deserializer: An optional :term:`deserializer` for request deserialization.
      response_serializer: An optional :term:`serializer` for response serialization.

    Returns:
      An RpcMethodHandler object that is typically used by grpc.Server.
    """
    from grpc import _utilities  # pylint: disable=cyclic-import

    return _utilities.RpcMethodHandler(
        True,
        True,
        request_deserializer,
        response_serializer,
        None,
        None,
        None,
        behavior,
    )


def method_handlers_generic_handler(service, method_handlers):
    """Creates a GenericRpcHandler from RpcMethodHandlers.

    Args:
      service: The name of the service that is implemented by the
        method_handlers.
      method_handlers: A dictionary that maps method names to corresponding
        RpcMethodHandler.

    Returns:
      A GenericRpcHandler. This is typically added to the grpc.Server object
      with add_generic_rpc_handlers() before starting the server.
    """
    from grpc import _utilities  # pylint: disable=cyclic-import

    return _utilities.DictionaryGenericHandler(service, method_handlers)


def ssl_channel_credentials(
    root_certificates=None, private_key=None, certificate_chain=None
):
    """Creates a ChannelCredentials for use with an SSL-enabled Channel.

    Args:
      root_certificates: The PEM-encoded root certificates as a byte string,
        or None to retrieve them from a default location chosen by gRPC
        runtime.
      private_key: The PEM-encoded private key as a byte string, or None if no
        private key should be used.
      certificate_chain: The PEM-encoded certificate chain as a byte string
        to use or None if no certificate chain should be used.

    Returns:
      A ChannelCredentials for use with an SSL-enabled Channel.
    """
    return ChannelCredentials(
        _cygrpc.SSLChannelCredentials(
            root_certificates, private_key, certificate_chain
        )
    )


def xds_channel_credentials(fallback_credentials=None):
    """Creates a ChannelCredentials for use with xDS. This is an EXPERIMENTAL
      API.

    Args:
      fallback_credentials: Credentials to use in case it is not possible to
        establish a secure connection via xDS. If no fallback_credentials
        argument is supplied, a default SSLChannelCredentials is used.
    """
    fallback_credentials = (
        ssl_channel_credentials()
        if fallback_credentials is None
        else fallback_credentials
    )
    return ChannelCredentials(
        _cygrpc.XDSChannelCredentials(fallback_credentials._credentials)
    )


def metadata_call_credentials(metadata_plugin, name=None):
    """Construct CallCredentials from an AuthMetadataPlugin.

    Args:
      metadata_plugin: An AuthMetadataPlugin to use for authentication.
      name: An optional name for the plugin.

    Returns:
      A CallCredentials.
    """
    from grpc import _plugin_wrapping  # pylint: disable=cyclic-import

    return _plugin_wrapping.metadata_plugin_call_credentials(
        metadata_plugin, name
    )


def access_token_call_credentials(access_token):
    """Construct CallCredentials from an access token.

    Args:
      access_token: A string to place directly in the http request
        authorization header, for example
        "authorization: Bearer <access_token>".

    Returns:
      A CallCredentials.
    """
    from grpc import _auth  # pylint: disable=cyclic-import
    from grpc import _plugin_wrapping  # pylint: disable=cyclic-import

    return _plugin_wrapping.metadata_plugin_call_credentials(
        _auth.AccessTokenAuthMetadataPlugin(access_token), None
    )


def composite_call_credentials(*call_credentials):
    """Compose multiple CallCredentials to make a new CallCredentials.

    Args:
      *call_credentials: At least two CallCredentials objects.

    Returns:
      A CallCredentials object composed of the given CallCredentials objects.
    """
    return CallCredentials(
        _cygrpc.CompositeCallCredentials(
            tuple(
                single_call_credentials._credentials
                for single_call_credentials in call_credentials
            )
        )
    )


def composite_channel_credentials(channel_credentials, *call_credentials):
    """Compose a ChannelCredentials and one or more CallCredentials objects.

    Args:
      channel_credentials: A ChannelCredentials object.
      *call_credentials: One or more CallCredentials objects.

    Returns:
      A ChannelCredentials composed of the given ChannelCredentials and
        CallCredentials objects.
    """
    return ChannelCredentials(
        _cygrpc.CompositeChannelCredentials(
            tuple(
                single_call_credentials._credentials
                for single_call_credentials in call_credentials
            ),
            channel_credentials._credentials,
        )
    )


def ssl_server_credentials(
    private_key_certificate_chain_pairs,
    root_certificates=None,
    require_client_auth=False,
):
    """Creates a ServerCredentials for use with an SSL-enabled Server.

    Args:
      private_key_certificate_chain_pairs: A list of pairs of the form
        [PEM-encoded private key, PEM-encoded certificate chain].
      root_certificates: An optional byte string of PEM-encoded client root
        certificates that the server will use to verify client authentication.
        If omitted, require_client_auth must also be False.
      require_client_auth: A boolean indicating whether or not to require
        clients to be authenticated. May only be True if root_certificates
        is not None.

    Returns:
      A ServerCredentials for use with an SSL-enabled Server. Typically, this
      object is an argument to add_secure_port() method during server setup.
    """
    if not private_key_certificate_chain_pairs:
        raise ValueError(
            "At least one private key-certificate chain pair is required!"
        )
    elif require_client_auth and root_certificates is None:
        raise ValueError(
            "Illegal to require client auth without providing root"
            " certificates!"
        )
    else:
        return ServerCredentials(
            _cygrpc.server_credentials_ssl(
                root_certificates,
                [
                    _cygrpc.SslPemKeyCertPair(key, pem)
                    for key, pem in private_key_certificate_chain_pairs
                ],
                require_client_auth,
            )
        )


def xds_server_credentials(fallback_credentials):
    """Creates a ServerCredentials for use with xDS. This is an EXPERIMENTAL
      API.

    Args:
      fallback_credentials: Credentials to use in case it is not possible to
        establish a secure connection via xDS. No default value is provided.
    """
    return ServerCredentials(
        _cygrpc.xds_server_credentials(fallback_credentials._credentials)
    )


def insecure_server_credentials():
    """Creates a credentials object directing the server to use no credentials.
      This is an EXPERIMENTAL API.

    This object cannot be used directly in a call to `add_secure_port`.
    Instead, it should be used to construct other credentials objects, e.g.
    with xds_server_credentials.
    """
    return ServerCredentials(_cygrpc.insecure_server_credentials())


def ssl_server_certificate_configuration(
    private_key_certificate_chain_pairs, root_certificates=None
):
    """Creates a ServerCertificateConfiguration for use with a Server.

    Args:
      private_key_certificate_chain_pairs: A collection of pairs of
        the form [PEM-encoded private key, PEM-encoded certificate
        chain].
      root_certificates: An optional byte string of PEM-encoded client root
        certificates that the server will use to verify client authentication.

    Returns:
      A ServerCertificateConfiguration that can be returned in the certificate
        configuration fetching callback.
    """
    if private_key_certificate_chain_pairs:
        return ServerCertificateConfiguration(
            _cygrpc.server_certificate_config_ssl(
                root_certificates,
                [
                    _cygrpc.SslPemKeyCertPair(key, pem)
                    for key, pem in private_key_certificate_chain_pairs
                ],
            )
        )
    else:
        raise ValueError(
            "At least one private key-certificate chain pair is required!"
        )


def dynamic_ssl_server_credentials(
    initial_certificate_configuration,
    certificate_configuration_fetcher,
    require_client_authentication=False,
):
    """Creates a ServerCredentials for use with an SSL-enabled Server.

    Args:
      initial_certificate_configuration (ServerCertificateConfiguration): The
        certificate configuration with which the server will be initialized.
      certificate_configuration_fetcher (callable): A callable that takes no
        arguments and should return a ServerCertificateConfiguration to
        replace the server's current certificate, or None for no change
        (i.e., the server will continue its current certificate
        config). The library will call this callback on *every* new
        client connection before starting the TLS handshake with the
        client, thus allowing the user application to optionally
        return a new ServerCertificateConfiguration that the server will then
        use for the handshake.
      require_client_authentication: A boolean indicating whether or not to
        require clients to be authenticated.

    Returns:
      A ServerCredentials.
    """
    return ServerCredentials(
        _cygrpc.server_credentials_ssl_dynamic_cert_config(
            initial_certificate_configuration,
            certificate_configuration_fetcher,
            require_client_authentication,
        )
    )


@enum.unique
class LocalConnectionType(enum.Enum):
    """Types of local connection for local credential creation.

    Attributes:
      UDS: Unix domain socket connections
      LOCAL_TCP: Local TCP connections.
    """

    UDS = _cygrpc.LocalConnectionType.uds
    LOCAL_TCP = _cygrpc.LocalConnectionType.local_tcp


def local_channel_credentials(local_connect_type=LocalConnectionType.LOCAL_TCP):
    """Creates a local ChannelCredentials used for local connections.

    This is an EXPERIMENTAL API.

    Local credentials are used by local TCP endpoints (e.g. localhost:10000)
    also UDS connections.

    The connections created by local channel credentials are not
    encrypted, but will be checked if they are local or not.
    The UDS connections are considered secure by providing peer authentication
    and data confidentiality while TCP connections are considered insecure.

    It is allowed to transmit call credentials over connections created by
    local channel credentials.

    Local channel credentials are useful for 1) eliminating insecure_channel usage;
    2) enable unit testing for call credentials without setting up secrets.

    Args:
      local_connect_type: Local connection type (either
        grpc.LocalConnectionType.UDS or grpc.LocalConnectionType.LOCAL_TCP)

    Returns:
      A ChannelCredentials for use with a local Channel
    """
    return ChannelCredentials(
        _cygrpc.channel_credentials_local(local_connect_type.value)
    )


def local_server_credentials(local_connect_type=LocalConnectionType.LOCAL_TCP):
    """Creates a local ServerCredentials used for local connections.

    This is an EXPERIMENTAL API.

    Local credentials are used by local TCP endpoints (e.g. localhost:10000)
    also UDS connections.

    The connections created by local server credentials are not
    encrypted, but will be checked if they are local or not.
    The UDS connections are considered secure by providing peer authentication
    and data confidentiality while TCP connections are considered insecure.

    It is allowed to transmit call credentials over connections created by local
    server credentials.

    Local server credentials are useful for 1) eliminating insecure_channel usage;
    2) enable unit testing for call credentials without setting up secrets.

    Args:
      local_connect_type: Local connection type (either
        grpc.LocalConnectionType.UDS or grpc.LocalConnectionType.LOCAL_TCP)

    Returns:
      A ServerCredentials for use with a local Server
    """
    return ServerCredentials(
        _cygrpc.server_credentials_local(local_connect_type.value)
    )


def alts_channel_credentials(service_accounts=None):
    """Creates a ChannelCredentials for use with an ALTS-enabled Channel.

    This is an EXPERIMENTAL API.
    ALTS credentials API can only be used in GCP environment as it relies on
    handshaker service being available. For more info about ALTS see
    https://cloud.google.com/security/encryption-in-transit/application-layer-transport-security

    Args:
      service_accounts: A list of server identities accepted by the client.
        If target service accounts are provided and none of them matches the
        peer identity of the server, handshake will fail. The arg can be empty
        if the client does not have any information about trusted server
        identity.
    Returns:
      A ChannelCredentials for use with an ALTS-enabled Channel
    """
    return ChannelCredentials(
        _cygrpc.channel_credentials_alts(service_accounts or [])
    )


def alts_server_credentials():
    """Creates a ServerCredentials for use with an ALTS-enabled connection.

    This is an EXPERIMENTAL API.
    ALTS credentials API can only be used in GCP environment as it relies on
    handshaker service being available. For more info about ALTS see
    https://cloud.google.com/security/encryption-in-transit/application-layer-transport-security

    Returns:
      A ServerCredentials for use with an ALTS-enabled Server
    """
    return ServerCredentials(_cygrpc.server_credentials_alts())


def compute_engine_channel_credentials(call_credentials):
    """Creates a compute engine channel credential.

    This credential can only be used in a GCP environment as it relies on
    a handshaker service. For more info about ALTS, see
    https://cloud.google.com/security/encryption-in-transit/application-layer-transport-security

    This channel credential is expected to be used as part of a composite
    credential in conjunction with a call credentials that authenticates the
    VM's default service account. If used with any other sort of call
    credential, the connection may suddenly and unexpectedly begin failing RPCs.
    """
    return ChannelCredentials(
        _cygrpc.channel_credentials_compute_engine(
            call_credentials._credentials
        )
    )


def channel_ready_future(channel):
    """Creates a Future that tracks when a Channel is ready.

    Cancelling the Future does not affect the channel's state machine.
    It merely decouples the Future from channel state machine.

    Args:
      channel: A Channel object.

    Returns:
      A Future object that matures when the channel connectivity is
      ChannelConnectivity.READY.
    """
    from grpc import _utilities  # pylint: disable=cyclic-import

    return _utilities.channel_ready_future(channel)


def insecure_channel(target, options=None, compression=None):
    """Creates an insecure Channel to a server.

    The returned Channel is thread-safe.

    Args:
      target: The server address
      options: An optional list of key-value pairs (:term:`channel_arguments`
        in gRPC Core runtime) to configure the channel.
      compression: An optional value indicating the compression method to be
        used over the lifetime of the channel.

    Returns:
      A Channel.
    """
    from grpc import _channel  # pylint: disable=cyclic-import

    return _channel.Channel(
        target, () if options is None else options, None, compression
    )


def secure_channel(target, credentials, options=None, compression=None):
    """Creates a secure Channel to a server.

    The returned Channel is thread-safe.

    Args:
      target: The server address.
      credentials: A ChannelCredentials instance.
      options: An optional list of key-value pairs (:term:`channel_arguments`
        in gRPC Core runtime) to configure the channel.
      compression: An optional value indicating the compression method to be
        used over the lifetime of the channel.

    Returns:
      A Channel.
    """
    from grpc import _channel  # pylint: disable=cyclic-import
    from grpc.experimental import _insecure_channel_credentials

    if credentials._credentials is _insecure_channel_credentials:
        raise ValueError(
            "secure_channel cannot be called with insecure credentials."
            + " Call insecure_channel instead."
        )
    return _channel.Channel(
        target,
        () if options is None else options,
        credentials._credentials,
        compression,
    )


def intercept_channel(channel, *interceptors):
    """Intercepts a channel through a set of interceptors.

    Args:
      channel: A Channel.
      interceptors: Zero or more objects of type
        UnaryUnaryClientInterceptor,
        UnaryStreamClientInterceptor,
        StreamUnaryClientInterceptor, or
        StreamStreamClientInterceptor.
        Interceptors are given control in the order they are listed.

    Returns:
      A Channel that intercepts each invocation via the provided interceptors.

    Raises:
      TypeError: If interceptor does not derive from any of
        UnaryUnaryClientInterceptor,
        UnaryStreamClientInterceptor,
        StreamUnaryClientInterceptor, or
        StreamStreamClientInterceptor.
    """
    from grpc import _interceptor  # pylint: disable=cyclic-import

    return _interceptor.intercept_channel(channel, *interceptors)


def server(
    thread_pool,
    handlers=None,
    interceptors=None,
    options=None,
    maximum_concurrent_rpcs=None,
    compression=None,
    xds=False,
):
    """Creates a Server with which RPCs can be serviced.

    Args:
      thread_pool: A futures.ThreadPoolExecutor to be used by the Server
        to execute RPC handlers.
      handlers: An optional list of GenericRpcHandlers used for executing RPCs.
        More handlers may be added by calling add_generic_rpc_handlers any time
        before the server is started.
      interceptors: An optional list of ServerInterceptor objects that observe
        and optionally manipulate the incoming RPCs before handing them over to
        handlers. The interceptors are given control in the order they are
        specified. This is an EXPERIMENTAL API.
      options: An optional list of key-value pairs (:term:`channel_arguments` in gRPC runtime)
        to configure the channel.
      maximum_concurrent_rpcs: The maximum number of concurrent RPCs this server
        will service before returning RESOURCE_EXHAUSTED status, or None to
        indicate no limit.
      compression: An element of grpc.compression, e.g.
        grpc.compression.Gzip. This compression algorithm will be used for the
        lifetime of the server unless overridden.
      xds: If set to true, retrieves server configuration via xDS. This is an
        EXPERIMENTAL option.

    Returns:
      A Server object.
    """
    from grpc import _server  # pylint: disable=cyclic-import

    return _server.create_server(
        thread_pool,
        () if handlers is None else handlers,
        () if interceptors is None else interceptors,
        () if options is None else options,
        maximum_concurrent_rpcs,
        compression,
        xds,
    )


@contextlib.contextmanager
def _create_servicer_context(rpc_event, state, request_deserializer):
    from grpc import _server  # pylint: disable=cyclic-import

    context = _server._Context(rpc_event, state, request_deserializer)
    yield context
    context._finalize_state()  # pylint: disable=protected-access


@enum.unique
class Compression(enum.IntEnum):
    """Indicates the compression method to be used for an RPC.

    Attributes:
     NoCompression: Do not use compression algorithm.
     Deflate: Use "Deflate" compression algorithm.
     Gzip: Use "Gzip" compression algorithm.
    """

    NoCompression = _compression.NoCompression
    Deflate = _compression.Deflate
    Gzip = _compression.Gzip


###################################  __all__  #################################

__all__ = (
    "FutureTimeoutError",
    "FutureCancelledError",
    "Future",
    "ChannelConnectivity",
    "StatusCode",
    "Status",
    "RpcError",
    "RpcContext",
    "Call",
    "ChannelCredentials",
    "CallCredentials",
    "AuthMetadataContext",
    "AuthMetadataPluginCallback",
    "AuthMetadataPlugin",
    "Compression",
    "ClientCallDetails",
    "ServerCertificateConfiguration",
    "ServerCredentials",
    "LocalConnectionType",
    "UnaryUnaryMultiCallable",
    "UnaryStreamMultiCallable",
    "StreamUnaryMultiCallable",
    "StreamStreamMultiCallable",
    "UnaryUnaryClientInterceptor",
    "UnaryStreamClientInterceptor",
    "StreamUnaryClientInterceptor",
    "StreamStreamClientInterceptor",
    "Channel",
    "ServicerContext",
    "RpcMethodHandler",
    "HandlerCallDetails",
    "GenericRpcHandler",
    "ServiceRpcHandler",
    "Server",
    "ServerInterceptor",
    "unary_unary_rpc_method_handler",
    "unary_stream_rpc_method_handler",
    "stream_unary_rpc_method_handler",
    "stream_stream_rpc_method_handler",
    "method_handlers_generic_handler",
    "ssl_channel_credentials",
    "metadata_call_credentials",
    "access_token_call_credentials",
    "composite_call_credentials",
    "composite_channel_credentials",
    "compute_engine_channel_credentials",
    "local_channel_credentials",
    "local_server_credentials",
    "alts_channel_credentials",
    "alts_server_credentials",
    "ssl_server_credentials",
    "ssl_server_certificate_configuration",
    "dynamic_ssl_server_credentials",
    "channel_ready_future",
    "insecure_channel",
    "secure_channel",
    "intercept_channel",
    "server",
    "protos",
    "services",
    "protos_and_services",
    "xds_channel_credentials",
    "xds_server_credentials",
    "insecure_server_credentials",
)

############################### Extension Shims ################################

# Here to maintain backwards compatibility; avoid using these in new code!
try:
    import grpc_tools

    sys.modules.update({"grpc.tools": grpc_tools})
except ImportError:
    pass
try:
    import grpc_health

    sys.modules.update({"grpc.health": grpc_health})
except ImportError:
    pass
try:
    import grpc_reflection

    sys.modules.update({"grpc.reflection": grpc_reflection})
except ImportError:
    pass

# Prevents import order issue in the case of renamed path.
if sys.version_info >= (3, 6) and __name__ == "grpc":
    from grpc import aio  # pylint: disable=ungrouped-imports

    sys.modules.update({"grpc.aio": aio})
