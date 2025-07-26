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

import asyncio
from contextlib import asynccontextmanager
import functools
import time
from typing import Mapping, Optional

from google.auth import _exponential_backoff, exceptions
from google.auth.aio import transport
from google.auth.aio.credentials import Credentials
from google.auth.exceptions import TimeoutError

try:
    from google.auth.aio.transport.aiohttp import Request as AiohttpRequest

    AIOHTTP_INSTALLED = True
except ImportError:  # pragma: NO COVER
    AIOHTTP_INSTALLED = False


@asynccontextmanager
async def timeout_guard(timeout):
    """
    timeout_guard is an asynchronous context manager to apply a timeout to an asynchronous block of code.

    Args:
        timeout (float): The time in seconds before the context manager times out.

    Raises:
        google.auth.exceptions.TimeoutError: If the code within the context exceeds the provided timeout.

    Usage:
        async with timeout_guard(10) as with_timeout:
            await with_timeout(async_function())
    """
    start = time.monotonic()
    total_timeout = timeout

    def _remaining_time():
        elapsed = time.monotonic() - start
        remaining = total_timeout - elapsed
        if remaining <= 0:
            raise TimeoutError(
                f"Context manager exceeded the configured timeout of {total_timeout}s."
            )
        return remaining

    async def with_timeout(coro):
        try:
            remaining = _remaining_time()
            response = await asyncio.wait_for(coro, remaining)
            return response
        except (asyncio.TimeoutError, TimeoutError) as e:
            raise TimeoutError(
                f"The operation {coro} exceeded the configured timeout of {total_timeout}s."
            ) from e

    try:
        yield with_timeout

    finally:
        _remaining_time()


class AsyncAuthorizedSession:
    """This is an asynchronous implementation of :class:`google.auth.requests.AuthorizedSession` class.
    We utilize an instance of a class that implements :class:`google.auth.aio.transport.Request` configured
    by the caller or otherwise default to `google.auth.aio.transport.aiohttp.Request` if the external aiohttp
    package is installed.

    A Requests Session class with credentials.

    This class is used to perform asynchronous requests to API endpoints that require
    authorization::

        import aiohttp
        from google.auth.aio.transport import sessions

        async with sessions.AsyncAuthorizedSession(credentials) as authed_session:
            response = await authed_session.request(
                'GET', 'https://www.googleapis.com/storage/v1/b')

    The underlying :meth:`request` implementation handles adding the
    credentials' headers to the request and refreshing credentials as needed.

    Args:
        credentials (google.auth.aio.credentials.Credentials):
            The credentials to add to the request.
        auth_request (Optional[google.auth.aio.transport.Request]):
            An instance of a class that implements
            :class:`~google.auth.aio.transport.Request` used to make requests
            and refresh credentials. If not passed,
            an instance of :class:`~google.auth.aio.transport.aiohttp.Request`
            is created.

    Raises:
        - google.auth.exceptions.TransportError: If `auth_request` is `None`
            and the external package `aiohttp` is not installed.
        - google.auth.exceptions.InvalidType: If the provided credentials are
            not of type `google.auth.aio.credentials.Credentials`.
    """

    def __init__(
        self, credentials: Credentials, auth_request: Optional[transport.Request] = None
    ):
        if not isinstance(credentials, Credentials):
            raise exceptions.InvalidType(
                f"The configured credentials of type {type(credentials)} are invalid and must be of type `google.auth.aio.credentials.Credentials`"
            )
        self._credentials = credentials
        _auth_request = auth_request
        if not _auth_request and AIOHTTP_INSTALLED:
            _auth_request = AiohttpRequest()
        if _auth_request is None:
            raise exceptions.TransportError(
                "`auth_request` must either be configured or the external package `aiohttp` must be installed to use the default value."
            )
        self._auth_request = _auth_request

    async def request(
        self,
        method: str,
        url: str,
        data: Optional[bytes] = None,
        headers: Optional[Mapping[str, str]] = None,
        max_allowed_time: float = transport._DEFAULT_TIMEOUT_SECONDS,
        timeout: float = transport._DEFAULT_TIMEOUT_SECONDS,
        **kwargs,
    ) -> transport.Response:
        """
        Args:
                method (str): The http method used to make the request.
                url (str): The URI to be requested.
                data (Optional[bytes]): The payload or body in HTTP request.
                headers (Optional[Mapping[str, str]]): Request headers.
                timeout (float):
                The amount of time in seconds to wait for the server response
                with each individual request.
                max_allowed_time (float):
                If the method runs longer than this, a ``Timeout`` exception is
                automatically raised. Unlike the ``timeout`` parameter, this
                value applies to the total method execution time, even if
                multiple requests are made under the hood.

                Mind that it is not guaranteed that the timeout error is raised
                at ``max_allowed_time``. It might take longer, for example, if
                an underlying request takes a lot of time, but the request
                itself does not timeout, e.g. if a large file is being
                transmitted. The timout error will be raised after such
                request completes.

        Returns:
                google.auth.aio.transport.Response: The HTTP response.

        Raises:
                google.auth.exceptions.TimeoutError: If the method does not complete within
                the configured `max_allowed_time` or the request exceeds the configured
                `timeout`.
        """

        retries = _exponential_backoff.AsyncExponentialBackoff(
            total_attempts=transport.DEFAULT_MAX_RETRY_ATTEMPTS
        )
        async with timeout_guard(max_allowed_time) as with_timeout:
            await with_timeout(
                # Note: before_request will attempt to refresh credentials if expired.
                self._credentials.before_request(
                    self._auth_request, method, url, headers
                )
            )
            # Workaround issue in python 3.9 related to code coverage by adding `# pragma: no branch`
            # See https://github.com/googleapis/gapic-generator-python/pull/1174#issuecomment-1025132372
            async for _ in retries:  # pragma: no branch
                response = await with_timeout(
                    self._auth_request(url, method, data, headers, timeout, **kwargs)
                )
                if response.status_code not in transport.DEFAULT_RETRYABLE_STATUS_CODES:
                    break
        return response

    @functools.wraps(request)
    async def get(
        self,
        url: str,
        data: Optional[bytes] = None,
        headers: Optional[Mapping[str, str]] = None,
        max_allowed_time: float = transport._DEFAULT_TIMEOUT_SECONDS,
        timeout: float = transport._DEFAULT_TIMEOUT_SECONDS,
        **kwargs,
    ) -> transport.Response:
        return await self.request(
            "GET", url, data, headers, max_allowed_time, timeout, **kwargs
        )

    @functools.wraps(request)
    async def post(
        self,
        url: str,
        data: Optional[bytes] = None,
        headers: Optional[Mapping[str, str]] = None,
        max_allowed_time: float = transport._DEFAULT_TIMEOUT_SECONDS,
        timeout: float = transport._DEFAULT_TIMEOUT_SECONDS,
        **kwargs,
    ) -> transport.Response:
        return await self.request(
            "POST", url, data, headers, max_allowed_time, timeout, **kwargs
        )

    @functools.wraps(request)
    async def put(
        self,
        url: str,
        data: Optional[bytes] = None,
        headers: Optional[Mapping[str, str]] = None,
        max_allowed_time: float = transport._DEFAULT_TIMEOUT_SECONDS,
        timeout: float = transport._DEFAULT_TIMEOUT_SECONDS,
        **kwargs,
    ) -> transport.Response:
        return await self.request(
            "PUT", url, data, headers, max_allowed_time, timeout, **kwargs
        )

    @functools.wraps(request)
    async def patch(
        self,
        url: str,
        data: Optional[bytes] = None,
        headers: Optional[Mapping[str, str]] = None,
        max_allowed_time: float = transport._DEFAULT_TIMEOUT_SECONDS,
        timeout: float = transport._DEFAULT_TIMEOUT_SECONDS,
        **kwargs,
    ) -> transport.Response:
        return await self.request(
            "PATCH", url, data, headers, max_allowed_time, timeout, **kwargs
        )

    @functools.wraps(request)
    async def delete(
        self,
        url: str,
        data: Optional[bytes] = None,
        headers: Optional[Mapping[str, str]] = None,
        max_allowed_time: float = transport._DEFAULT_TIMEOUT_SECONDS,
        timeout: float = transport._DEFAULT_TIMEOUT_SECONDS,
        **kwargs,
    ) -> transport.Response:
        return await self.request(
            "DELETE", url, data, headers, max_allowed_time, timeout, **kwargs
        )

    async def close(self) -> None:
        """
        Close the underlying auth request session.
        """
        await self._auth_request.close()
