"""Base async HTTP client implementation."""

from __future__ import annotations

import sys
from http.client import responses
from typing import TYPE_CHECKING

from vine import Thenable, maybe_promise, promise

from kombu.exceptions import HttpError
from kombu.utils.compat import coro
from kombu.utils.encoding import bytes_to_str
from kombu.utils.functional import maybe_list, memoize

if TYPE_CHECKING:
    from types import TracebackType

__all__ = ('Headers', 'Response', 'Request', 'BaseClient')

PYPY = hasattr(sys, 'pypy_version_info')


@memoize(maxsize=1000)
def normalize_header(key):
    return '-'.join(p.capitalize() for p in key.split('-'))


class Headers(dict):
    """Represents a mapping of HTTP headers."""

    # TODO: This is just a regular dict and will not perform normalization
    # when looking up keys etc.

    #: Set when all of the headers have been read.
    complete = False

    #: Internal attribute used to keep track of continuation lines.
    _prev_key = None


@Thenable.register
class Request:
    """A HTTP Request.

    Arguments:
    ---------
        url (str): The URL to request.
        method (str): The HTTP method to use (defaults to ``GET``).

    Keyword Arguments:
    -----------------
        headers (Dict, ~kombu.asynchronous.http.Headers): Optional headers for
            this request
        body (str): Optional body for this request.
        connect_timeout (float): Connection timeout in float seconds
            Default is 30.0.
        timeout (float): Time in float seconds before the request times out
            Default is 30.0.
        follow_redirects (bool): Specify if the client should follow redirects
            Enabled by default.
        max_redirects (int): Maximum number of redirects (default 6).
        use_gzip (bool): Allow the server to use gzip compression.
            Enabled by default.
        validate_cert (bool): Set to true if the server certificate should be
            verified when performing ``https://`` requests.
            Enabled by default.
        auth_username (str): Username for HTTP authentication.
        auth_password (str): Password for HTTP authentication.
        auth_mode (str): Type of HTTP authentication (``basic`` or ``digest``).
        user_agent (str): Custom user agent for this request.
        network_interface (str): Network interface to use for this request.
        on_ready (Callable): Callback to be called when the response has been
            received. Must accept single ``response`` argument.
        on_stream (Callable): Optional callback to be called every time body
            content has been read from the socket.  If specified then the
            response body and buffer attributes will not be available.
        on_timeout (callable): Optional callback to be called if the request
            times out.
        on_header (Callable): Optional callback to be called for every header
            line received from the server.  The signature
            is ``(headers, line)`` and note that if you want
            ``response.headers`` to be populated then your callback needs to
            also call ``client.on_header(headers, line)``.
        on_prepare (Callable): Optional callback that is implementation
            specific (e.g. curl client will pass the ``curl`` instance to
            this callback).
        proxy_host (str): Optional proxy host.  Note that a ``proxy_port`` must
            also be provided or a :exc:`ValueError` will be raised.
        proxy_username (str): Optional username to use when logging in
            to the proxy.
        proxy_password (str): Optional password to use when authenticating
            with the proxy server.
        ca_certs (str): Custom CA certificates file to use.
        client_key (str): Optional filename for client SSL key.
        client_cert (str): Optional filename for client SSL certificate.
    """

    body = user_agent = network_interface = \
        auth_username = auth_password = auth_mode = \
        proxy_host = proxy_port = proxy_username = proxy_password = \
        ca_certs = client_key = client_cert = None

    connect_timeout = 30.0
    request_timeout = 30.0
    follow_redirects = True
    max_redirects = 6
    use_gzip = True
    validate_cert = True

    if not PYPY:  # pragma: no cover
        __slots__ = ('url', 'method', 'on_ready', 'on_timeout', 'on_stream',
                     'on_prepare', 'on_header', 'headers',
                     '__weakref__', '__dict__')

    def __init__(self, url, method='GET', on_ready=None, on_timeout=None,
                 on_stream=None, on_prepare=None, on_header=None,
                 headers=None, **kwargs):
        self.url = url
        self.method = method or self.method
        self.on_ready = maybe_promise(on_ready) or promise()
        self.on_timeout = maybe_promise(on_timeout)
        self.on_stream = maybe_promise(on_stream)
        self.on_prepare = maybe_promise(on_prepare)
        self.on_header = maybe_promise(on_header)
        if kwargs:
            for k, v in kwargs.items():
                setattr(self, k, v)
        if not isinstance(headers, Headers):
            headers = Headers(headers or {})
        self.headers = headers

    def then(self, callback, errback=None):
        self.on_ready.then(callback, errback)

    def __repr__(self):
        return '<Request: {0.method} {0.url} {0.body}>'.format(self)


class Response:
    """HTTP Response.

    Arguments
    ---------
        request (~kombu.asynchronous.http.Request): See :attr:`request`.
        code (int): See :attr:`code`.
        headers (~kombu.asynchronous.http.Headers): See :attr:`headers`.
        buffer (bytes): See :attr:`buffer`
        effective_url (str): See :attr:`effective_url`.
        status (str): See :attr:`status`.

    Attributes
    ----------
        request (~kombu.asynchronous.http.Request): object used to
            get this response.
        code (int): HTTP response code (e.g. 200, 404, or 500).
        headers (~kombu.asynchronous.http.Headers): HTTP headers
            for this response.
        buffer (bytes): Socket read buffer.
        effective_url (str): The destination url for this request after
            following redirects.
        error (Exception): Error instance if the request resulted in
            a HTTP error code.
        status (str): Human equivalent of :attr:`code`,
            e.g. ``OK``, `Not found`, or 'Internal Server Error'.
    """

    if not PYPY:  # pragma: no cover
        __slots__ = ('request', 'code', 'headers', 'buffer', 'effective_url',
                     'error', 'status', '_body', '__weakref__')

    def __init__(self, request, code, headers=None, buffer=None,
                 effective_url=None, error=None, status=None):
        self.request = request
        self.code = code
        self.headers = headers if headers is not None else Headers()
        self.buffer = buffer
        self.effective_url = effective_url or request.url
        self._body = None

        self.status = status or responses.get(self.code, 'Unknown')
        self.error = error
        if self.error is None and (self.code < 200 or self.code > 299):
            self.error = HttpError(self.code, self.status, self)

    def raise_for_error(self):
        """Raise if the request resulted in an HTTP error code.

        Raises
        ------
            :class:`~kombu.exceptions.HttpError`
        """
        if self.error:
            raise self.error

    @property
    def body(self):
        """The full contents of the response body.

        Note:
        ----
            Accessing this property will evaluate the buffer
            and subsequent accesses will be cached.
        """
        if self._body is None:
            if self.buffer is not None:
                self._body = self.buffer.getvalue()
        return self._body

    # these are for compatibility with Requests
    @property
    def status_code(self):
        return self.code

    @property
    def content(self):
        return self.body


@coro
def header_parser(keyt=normalize_header):
    while 1:
        (line, headers) = yield
        if line.startswith('HTTP/'):
            continue
        elif not line:
            headers.complete = True
            continue
        elif line[0].isspace():
            pkey = headers._prev_key
            headers[pkey] = ' '.join([headers.get(pkey) or '', line.lstrip()])
        else:
            key, value = line.split(':', 1)
            key = headers._prev_key = keyt(key)
            headers[key] = value.strip()


class BaseClient:
    """Base class for HTTP clients.

    This class provides the basic structure and functionality for HTTP clients.
    Subclasses should implement specific HTTP client behavior.
    """

    Headers = Headers
    Request = Request
    Response = Response

    def __init__(self, hub, **kwargs):
        self.hub = hub
        self._header_parser = header_parser()

    def perform(self, request, **kwargs):
        for req in maybe_list(request) or []:
            if not isinstance(req, self.Request):
                req = self.Request(req, **kwargs)
            self.add_request(req)

    def add_request(self, request):
        raise NotImplementedError('must implement add_request')

    def close(self):
        pass

    def on_header(self, headers, line):
        try:
            self._header_parser.send((bytes_to_str(line), headers))
        except StopIteration:
            self._header_parser = header_parser()

    def __enter__(self):
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None
    ) -> None:
        self.close()
