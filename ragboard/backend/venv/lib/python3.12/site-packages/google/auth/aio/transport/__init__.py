# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Transport - Asynchronous HTTP client library support.

:mod:`google.auth.aio` is designed to work with various asynchronous client libraries such
as aiohttp. In order to work across these libraries with different
interfaces some abstraction is needed.

This module provides two interfaces that are implemented by transport adapters
to support HTTP libraries. :class:`Request` defines the interface expected by
:mod:`google.auth` to make asynchronous requests. :class:`Response` defines the interface
for the return value of :class:`Request`.
"""

import abc
from typing import AsyncGenerator, Mapping, Optional

import google.auth.transport


_DEFAULT_TIMEOUT_SECONDS = 180

DEFAULT_RETRYABLE_STATUS_CODES = google.auth.transport.DEFAULT_RETRYABLE_STATUS_CODES
"""Sequence[int]:  HTTP status codes indicating a request can be retried.
"""


DEFAULT_MAX_RETRY_ATTEMPTS = 3
"""int: How many times to retry a request."""


class Response(metaclass=abc.ABCMeta):
    """Asynchronous HTTP Response Interface."""

    @property
    @abc.abstractmethod
    def status_code(self) -> int:
        """
        The HTTP response status code.

        Returns:
            int: The HTTP response status code.

        """
        raise NotImplementedError("status_code must be implemented.")

    @property
    @abc.abstractmethod
    def headers(self) -> Mapping[str, str]:
        """The HTTP response headers.

        Returns:
            Mapping[str, str]: The HTTP response headers.
        """
        raise NotImplementedError("headers must be implemented.")

    @abc.abstractmethod
    async def content(self, chunk_size: int) -> AsyncGenerator[bytes, None]:
        """The raw response content.

        Args:
            chunk_size (int): The size of each chunk.

        Yields:
            AsyncGenerator[bytes, None]: An asynchronous generator yielding
            response chunks as bytes.
        """
        raise NotImplementedError("content must be implemented.")

    @abc.abstractmethod
    async def read(self) -> bytes:
        """Read the entire response content as bytes.

        Returns:
            bytes: The entire response content.
        """
        raise NotImplementedError("read must be implemented.")

    @abc.abstractmethod
    async def close(self):
        """Close the response after it is fully consumed to resource."""
        raise NotImplementedError("close must be implemented.")


class Request(metaclass=abc.ABCMeta):
    """Interface for a callable that makes HTTP requests.

    Specific transport implementations should provide an implementation of
    this that adapts their specific request / response API.

    .. automethod:: __call__
    """

    @abc.abstractmethod
    async def __call__(
        self,
        url: str,
        method: str,
        body: Optional[bytes],
        headers: Optional[Mapping[str, str]],
        timeout: float,
        **kwargs
    ) -> Response:
        """Make an HTTP request.

        Args:
            url (str): The URI to be requested.
            method (str): The HTTP method to use for the request. Defaults
                to 'GET'.
            body (Optional[bytes]): The payload / body in HTTP request.
            headers (Mapping[str, str]): Request headers.
            timeout (float): The number of seconds to wait for a
                response from the server. If not specified or if None, the
                transport-specific default timeout will be used.
            kwargs: Additional arguments passed on to the transport's
                request method.

        Returns:
            google.auth.aio.transport.Response: The HTTP response.

        Raises:
            google.auth.exceptions.TransportError: If any exception occurred.
        """
        # pylint: disable=redundant-returns-doc, missing-raises-doc
        # (pylint doesn't play well with abstract docstrings.)
        raise NotImplementedError("__call__ must be implemented.")

    async def close(self) -> None:
        """
        Close the underlying session.
        """
        raise NotImplementedError("close must be implemented.")
