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
"""gRPC's Asynchronous Python API.

gRPC Async API objects may only be used on the thread on which they were
created. AsyncIO doesn't provide thread safety for most of its APIs.
"""

from typing import Any, Optional, Sequence, Tuple

import grpc
from grpc._cython.cygrpc import AbortError
from grpc._cython.cygrpc import BaseError
from grpc._cython.cygrpc import EOF
from grpc._cython.cygrpc import InternalError
from grpc._cython.cygrpc import UsageError
from grpc._cython.cygrpc import init_grpc_aio
from grpc._cython.cygrpc import shutdown_grpc_aio

from ._base_call import Call
from ._base_call import RpcContext
from ._base_call import StreamStreamCall
from ._base_call import StreamUnaryCall
from ._base_call import UnaryStreamCall
from ._base_call import UnaryUnaryCall
from ._base_channel import Channel
from ._base_channel import StreamStreamMultiCallable
from ._base_channel import StreamUnaryMultiCallable
from ._base_channel import UnaryStreamMultiCallable
from ._base_channel import UnaryUnaryMultiCallable
from ._base_server import Server
from ._base_server import ServicerContext
from ._call import AioRpcError
from ._channel import insecure_channel
from ._channel import secure_channel
from ._interceptor import ClientCallDetails
from ._interceptor import ClientInterceptor
from ._interceptor import InterceptedUnaryUnaryCall
from ._interceptor import ServerInterceptor
from ._interceptor import StreamStreamClientInterceptor
from ._interceptor import StreamUnaryClientInterceptor
from ._interceptor import UnaryStreamClientInterceptor
from ._interceptor import UnaryUnaryClientInterceptor
from ._metadata import Metadata
from ._server import server
from ._typing import ChannelArgumentType

###################################  __all__  #################################

__all__ = (
    "init_grpc_aio",
    "shutdown_grpc_aio",
    "AioRpcError",
    "RpcContext",
    "Call",
    "UnaryUnaryCall",
    "UnaryStreamCall",
    "StreamUnaryCall",
    "StreamStreamCall",
    "Channel",
    "UnaryUnaryMultiCallable",
    "UnaryStreamMultiCallable",
    "StreamUnaryMultiCallable",
    "StreamStreamMultiCallable",
    "ClientCallDetails",
    "ClientInterceptor",
    "UnaryStreamClientInterceptor",
    "UnaryUnaryClientInterceptor",
    "StreamUnaryClientInterceptor",
    "StreamStreamClientInterceptor",
    "InterceptedUnaryUnaryCall",
    "ServerInterceptor",
    "insecure_channel",
    "server",
    "Server",
    "ServicerContext",
    "EOF",
    "secure_channel",
    "AbortError",
    "BaseError",
    "UsageError",
    "InternalError",
    "Metadata",
)
