# Copyright 2015 gRPC authors.
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
"""Utilities for RPC Framework's Face interface."""

import collections

# stream is referenced from specification in this module.
from grpc.framework.common import cardinality
from grpc.framework.common import style
from grpc.framework.foundation import stream  # pylint: disable=unused-import
from grpc.framework.interfaces.face import face


class _MethodImplementation(
    face.MethodImplementation,
    collections.namedtuple(
        "_MethodImplementation",
        [
            "cardinality",
            "style",
            "unary_unary_inline",
            "unary_stream_inline",
            "stream_unary_inline",
            "stream_stream_inline",
            "unary_unary_event",
            "unary_stream_event",
            "stream_unary_event",
            "stream_stream_event",
        ],
    ),
):
    pass


def unary_unary_inline(behavior):
    """Creates an face.MethodImplementation for the given behavior.

    Args:
      behavior: The implementation of a unary-unary RPC method as a callable value
        that takes a request value and an face.ServicerContext object and
        returns a response value.

    Returns:
      An face.MethodImplementation derived from the given behavior.
    """
    return _MethodImplementation(
        cardinality.Cardinality.UNARY_UNARY,
        style.Service.INLINE,
        behavior,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )


def unary_stream_inline(behavior):
    """Creates an face.MethodImplementation for the given behavior.

    Args:
      behavior: The implementation of a unary-stream RPC method as a callable
        value that takes a request value and an face.ServicerContext object and
        returns an iterator of response values.

    Returns:
      An face.MethodImplementation derived from the given behavior.
    """
    return _MethodImplementation(
        cardinality.Cardinality.UNARY_STREAM,
        style.Service.INLINE,
        None,
        behavior,
        None,
        None,
        None,
        None,
        None,
        None,
    )


def stream_unary_inline(behavior):
    """Creates an face.MethodImplementation for the given behavior.

    Args:
      behavior: The implementation of a stream-unary RPC method as a callable
        value that takes an iterator of request values and an
        face.ServicerContext object and returns a response value.

    Returns:
      An face.MethodImplementation derived from the given behavior.
    """
    return _MethodImplementation(
        cardinality.Cardinality.STREAM_UNARY,
        style.Service.INLINE,
        None,
        None,
        behavior,
        None,
        None,
        None,
        None,
        None,
    )


def stream_stream_inline(behavior):
    """Creates an face.MethodImplementation for the given behavior.

    Args:
      behavior: The implementation of a stream-stream RPC method as a callable
        value that takes an iterator of request values and an
        face.ServicerContext object and returns an iterator of response values.

    Returns:
      An face.MethodImplementation derived from the given behavior.
    """
    return _MethodImplementation(
        cardinality.Cardinality.STREAM_STREAM,
        style.Service.INLINE,
        None,
        None,
        None,
        behavior,
        None,
        None,
        None,
        None,
    )


def unary_unary_event(behavior):
    """Creates an face.MethodImplementation for the given behavior.

    Args:
      behavior: The implementation of a unary-unary RPC method as a callable
        value that takes a request value, a response callback to which to pass
        the response value of the RPC, and an face.ServicerContext.

    Returns:
      An face.MethodImplementation derived from the given behavior.
    """
    return _MethodImplementation(
        cardinality.Cardinality.UNARY_UNARY,
        style.Service.EVENT,
        None,
        None,
        None,
        None,
        behavior,
        None,
        None,
        None,
    )


def unary_stream_event(behavior):
    """Creates an face.MethodImplementation for the given behavior.

    Args:
      behavior: The implementation of a unary-stream RPC method as a callable
        value that takes a request value, a stream.Consumer to which to pass the
        response values of the RPC, and an face.ServicerContext.

    Returns:
      An face.MethodImplementation derived from the given behavior.
    """
    return _MethodImplementation(
        cardinality.Cardinality.UNARY_STREAM,
        style.Service.EVENT,
        None,
        None,
        None,
        None,
        None,
        behavior,
        None,
        None,
    )


def stream_unary_event(behavior):
    """Creates an face.MethodImplementation for the given behavior.

    Args:
      behavior: The implementation of a stream-unary RPC method as a callable
        value that takes a response callback to which to pass the response value
        of the RPC and an face.ServicerContext and returns a stream.Consumer to
        which the request values of the RPC should be passed.

    Returns:
      An face.MethodImplementation derived from the given behavior.
    """
    return _MethodImplementation(
        cardinality.Cardinality.STREAM_UNARY,
        style.Service.EVENT,
        None,
        None,
        None,
        None,
        None,
        None,
        behavior,
        None,
    )


def stream_stream_event(behavior):
    """Creates an face.MethodImplementation for the given behavior.

    Args:
      behavior: The implementation of a stream-stream RPC method as a callable
        value that takes a stream.Consumer to which to pass the response values
        of the RPC and an face.ServicerContext and returns a stream.Consumer to
        which the request values of the RPC should be passed.

    Returns:
      An face.MethodImplementation derived from the given behavior.
    """
    return _MethodImplementation(
        cardinality.Cardinality.STREAM_STREAM,
        style.Service.EVENT,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        behavior,
    )
