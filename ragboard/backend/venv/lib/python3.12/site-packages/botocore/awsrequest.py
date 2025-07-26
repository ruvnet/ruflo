# Copyright (c) 2012-2013 Mitch Garnaat http://garnaat.org/
# Copyright 2012-2014 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License"). You
# may not use this file except in compliance with the License. A copy of
# the License is located at
#
# http://aws.amazon.com/apache2.0/
#
# or in the "license" file accompanying this file. This file is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
# ANY KIND, either express or implied. See the License for the specific
# language governing permissions and limitations under the License.
import functools
import logging
from collections.abc import Mapping

import urllib3.util
from urllib3.connection import HTTPConnection, VerifiedHTTPSConnection
from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool

import botocore.utils
from botocore.compat import (
    HTTPHeaders,
    HTTPResponse,
    MutableMapping,
    urlencode,
    urlparse,
    urlsplit,
    urlunsplit,
)
from botocore.exceptions import UnseekableStreamError

logger = logging.getLogger(__name__)


class AWSHTTPResponse(HTTPResponse):
    # The *args, **kwargs is used because the args are slightly
    # different in py2.6 than in py2.7/py3.
    def __init__(self, *args, **kwargs):
        self._status_tuple = kwargs.pop('status_tuple')
        HTTPResponse.__init__(self, *args, **kwargs)

    def _read_status(self):
        if self._status_tuple is not None:
            status_tuple = self._status_tuple
            self._status_tuple = None
            return status_tuple
        else:
            return HTTPResponse._read_status(self)


class AWSConnection:
    """Mixin for HTTPConnection that supports Expect 100-continue.

    This when mixed with a subclass of httplib.HTTPConnection (though
    technically we subclass from urllib3, which subclasses
    httplib.HTTPConnection) and we only override this class to support Expect
    100-continue, which we need for S3.  As far as I can tell, this is
    general purpose enough to not be specific to S3, but I'm being
    tentative and keeping it in botocore because I've only tested
    this against AWS services.

    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._original_response_cls = self.response_class
        # This variable is set when we receive an early response from the
        # server. If this value is set to True, any calls to send() are noops.
        # This value is reset to false every time _send_request is called.
        # This is to workaround changes in urllib3 2.0 which uses separate
        # send() calls in request() instead of delegating to endheaders(),
        # which is where the body is sent in CPython's HTTPConnection.
        self._response_received = False
        self._expect_header_set = False
        self._send_called = False

    def close(self):
        super().close()
        # Reset all of our instance state we were tracking.
        self._response_received = False
        self._expect_header_set = False
        self._send_called = False
        self.response_class = self._original_response_cls

    def request(self, method, url, body=None, headers=None, *args, **kwargs):
        if headers is None:
            headers = {}
        self._response_received = False
        if headers.get('Expect', b'') == b'100-continue':
            self._expect_header_set = True
        else:
            self._expect_header_set = False
            self.response_class = self._original_response_cls
        rval = super().request(method, url, body, headers, *args, **kwargs)
        self._expect_header_set = False
        return rval

    def _convert_to_bytes(self, mixed_buffer):
        # Take a list of mixed str/bytes and convert it
        # all into a single bytestring.
        # Any str will be encoded as utf-8.
        bytes_buffer = []
        for chunk in mixed_buffer:
            if isinstance(chunk, str):
                bytes_buffer.append(chunk.encode('utf-8'))
            else:
                bytes_buffer.append(chunk)
        msg = b"\r\n".join(bytes_buffer)
        return msg

    def _send_output(self, message_body=None, *args, **kwargs):
        self._buffer.extend((b"", b""))
        msg = self._convert_to_bytes(self._buffer)
        del self._buffer[:]
        # If msg and message_body are sent in a single send() call,
        # it will avoid performance problems caused by the interaction
        # between delayed ack and the Nagle algorithm.
        if isinstance(message_body, bytes):
            msg += message_body
            message_body = None
        self.send(msg)
        if self._expect_header_set:
            # This is our custom behavior.  If the Expect header was
            # set, it will trigger this custom behavior.
            logger.debug("Waiting for 100 Continue response.")
            # Wait for 1 second for the server to send a response.
            if urllib3.util.wait_for_read(self.sock, 1):
                self._handle_expect_response(message_body)
                return
            else:
                # From the RFC:
                # Because of the presence of older implementations, the
                # protocol allows ambiguous situations in which a client may
                # send "Expect: 100-continue" without receiving either a 417
                # (Expectation Failed) status or a 100 (Continue) status.
                # Therefore, when a client sends this header field to an origin
                # server (possibly via a proxy) from which it has never seen a
                # 100 (Continue) status, the client SHOULD NOT wait for an
                # indefinite period before sending the request body.
                logger.debug(
                    "No response seen from server, continuing to "
                    "send the response body."
                )
        if message_body is not None:
            # message_body was not a string (i.e. it is a file), and
            # we must run the risk of Nagle.
            self.send(message_body)

    def _consume_headers(self, fp):
        # Most servers (including S3) will just return
        # the CLRF after the 100 continue response.  However,
        # some servers (I've specifically seen this for squid when
        # used as a straight HTTP proxy) will also inject a
        # Connection: keep-alive header.  To account for this
        # we'll read until we read '\r\n', and ignore any headers
        # that come immediately after the 100 continue response.
        current = None
        while current != b'\r\n':
            current = fp.readline()

    def _handle_expect_response(self, message_body):
        # This is called when we sent the request headers containing
        # an Expect: 100-continue header and received a response.
        # We now need to figure out what to do.
        fp = self.sock.makefile('rb', 0)
        try:
            maybe_status_line = fp.readline()
            parts = maybe_status_line.split(None, 2)
            if self._is_100_continue_status(maybe_status_line):
                self._consume_headers(fp)
                logger.debug(
                    "100 Continue response seen, now sending request body."
                )
                self._send_message_body(message_body)
            elif len(parts) == 3 and parts[0].startswith(b'HTTP/'):
                # From the RFC:
                # Requirements for HTTP/1.1 origin servers:
                #
                # - Upon receiving a request which includes an Expect
                #   request-header field with the "100-continue"
                #   expectation, an origin server MUST either respond with
                #   100 (Continue) status and continue to read from the
                #   input stream, or respond with a final status code.
                #
                # So if we don't get a 100 Continue response, then
                # whatever the server has sent back is the final response
                # and don't send the message_body.
                logger.debug(
                    "Received a non 100 Continue response "
                    "from the server, NOT sending request body."
                )
                status_tuple = (
                    parts[0].decode('ascii'),
                    int(parts[1]),
                    parts[2].decode('ascii'),
                )
                response_class = functools.partial(
                    AWSHTTPResponse, status_tuple=status_tuple
                )
                self.response_class = response_class
                self._response_received = True
        finally:
            fp.close()

    def _send_message_body(self, message_body):
        if message_body is not None:
            self.send(message_body)

    def send(self, str):
        if self._response_received:
            if not self._send_called:
                # urllib3 2.0 chunks and calls send potentially
                # thousands of times inside `request` unlike the
                # standard library. Only log this once for sanity.
                logger.debug(
                    "send() called, but response already received. "
                    "Not sending data."
                )
            self._send_called = True
            return
        return super().send(str)

    def _is_100_continue_status(self, maybe_status_line):
        parts = maybe_status_line.split(None, 2)
        # Check for HTTP/<version> 100 Continue\r\n
        return (
            len(parts) >= 3
            and parts[0].startswith(b'HTTP/')
            and parts[1] == b'100'
        )


class AWSHTTPConnection(AWSConnection, HTTPConnection):
    """An HTTPConnection that supports 100 Continue behavior."""


class AWSHTTPSConnection(AWSConnection, VerifiedHTTPSConnection):
    """An HTTPSConnection that supports 100 Continue behavior."""


class AWSHTTPConnectionPool(HTTPConnectionPool):
    ConnectionCls = AWSHTTPConnection


class AWSHTTPSConnectionPool(HTTPSConnectionPool):
    ConnectionCls = AWSHTTPSConnection


def prepare_request_dict(
    request_dict, endpoint_url, context=None, user_agent=None
):
    """
    This method prepares a request dict to be created into an
    AWSRequestObject. This prepares the request dict by adding the
    url and the user agent to the request dict.

    :type request_dict: dict
    :param request_dict:  The request dict (created from the
        ``serialize`` module).

    :type user_agent: string
    :param user_agent: The user agent to use for this request.

    :type endpoint_url: string
    :param endpoint_url: The full endpoint url, which contains at least
        the scheme, the hostname, and optionally any path components.
    """
    r = request_dict
    if user_agent is not None:
        headers = r['headers']
        headers['User-Agent'] = user_agent
    host_prefix = r.get('host_prefix')
    url = _urljoin(endpoint_url, r['url_path'], host_prefix)
    if r['query_string']:
        # NOTE: This is to avoid circular import with utils. This is being
        # done to avoid moving classes to different modules as to not cause
        # breaking chainges.
        percent_encode_sequence = botocore.utils.percent_encode_sequence
        encoded_query_string = percent_encode_sequence(r['query_string'])
        if '?' not in url:
            url += f'?{encoded_query_string}'
        else:
            url += f'&{encoded_query_string}'
    r['url'] = url
    r['context'] = context
    if context is None:
        r['context'] = {}


def create_request_object(request_dict):
    """
    This method takes a request dict and creates an AWSRequest object
    from it.

    :type request_dict: dict
    :param request_dict:  The request dict (created from the
        ``prepare_request_dict`` method).

    :rtype: ``botocore.awsrequest.AWSRequest``
    :return: An AWSRequest object based on the request_dict.

    """
    r = request_dict
    request_object = AWSRequest(
        method=r['method'],
        url=r['url'],
        data=r['body'],
        headers=r['headers'],
        auth_path=r.get('auth_path'),
    )
    request_object.context = r['context']
    return request_object


def _urljoin(endpoint_url, url_path, host_prefix):
    p = urlsplit(endpoint_url)
    # <part>   - <index>
    # scheme   - p[0]
    # netloc   - p[1]
    # path     - p[2]
    # query    - p[3]
    # fragment - p[4]
    if not url_path or url_path == '/':
        # If there's no path component, ensure the URL ends with
        # a '/' for backwards compatibility.
        if not p[2]:
            new_path = '/'
        else:
            new_path = p[2]
    elif p[2].endswith('/') and url_path.startswith('/'):
        new_path = p[2][:-1] + url_path
    else:
        new_path = p[2] + url_path

    new_netloc = p[1]
    if host_prefix is not None:
        new_netloc = host_prefix + new_netloc

    reconstructed = urlunsplit((p[0], new_netloc, new_path, p[3], p[4]))
    return reconstructed


class AWSRequestPreparer:
    """
    This class performs preparation on AWSRequest objects similar to that of
    the PreparedRequest class does in the requests library. However, the logic
    has been boiled down to meet the specific use cases in botocore. Of note
    there are the following differences:
        This class does not heavily prepare the URL. Requests performed many
        validations and corrections to ensure the URL is properly formatted.
        Botocore either performs these validations elsewhere or otherwise
        consistently provides well formatted URLs.

        This class does not heavily prepare the body. Body preperation is
        simple and supports only the cases that we document: bytes and
        file-like objects to determine the content-length. This will also
        additionally prepare a body that is a dict to be url encoded params
        string as some signers rely on this. Finally, this class does not
        support multipart file uploads.

        This class does not prepare the method, auth or cookies.
    """

    def prepare(self, original):
        method = original.method
        url = self._prepare_url(original)
        body = self._prepare_body(original)
        headers = self._prepare_headers(original, body)
        stream_output = original.stream_output

        return AWSPreparedRequest(method, url, headers, body, stream_output)

    def _prepare_url(self, original):
        url = original.url
        if original.params:
            url_parts = urlparse(url)
            delim = '&' if url_parts.query else '?'
            if isinstance(original.params, Mapping):
                params_to_encode = list(original.params.items())
            else:
                params_to_encode = original.params
            params = urlencode(params_to_encode, doseq=True)
            url = delim.join((url, params))
        return url

    def _prepare_headers(self, original, prepared_body=None):
        headers = HeadersDict(original.headers.items())

        # If the transfer encoding or content length is already set, use that
        if 'Transfer-Encoding' in headers or 'Content-Length' in headers:
            return headers

        # Ensure we set the content length when it is expected
        if original.method not in ('GET', 'HEAD', 'OPTIONS'):
            length = self._determine_content_length(prepared_body)
            if length is not None:
                headers['Content-Length'] = str(length)
            else:
                # Failed to determine content length, using chunked
                # NOTE: This shouldn't ever happen in practice
                body_type = type(prepared_body)
                logger.debug('Failed to determine length of %s', body_type)
                headers['Transfer-Encoding'] = 'chunked'

        return headers

    def _to_utf8(self, item):
        key, value = item
        if isinstance(key, str):
            key = key.encode('utf-8')
        if isinstance(value, str):
            value = value.encode('utf-8')
        return key, value

    def _prepare_body(self, original):
        """Prepares the given HTTP body data."""
        body = original.data
        if body == b'':
            body = None

        if isinstance(body, dict):
            params = [self._to_utf8(item) for item in body.items()]
            body = urlencode(params, doseq=True)

        return body

    def _determine_content_length(self, body):
        return botocore.utils.determine_content_length(body)


class AWSRequest:
    """Represents the elements of an HTTP request.

    This class was originally inspired by requests.models.Request, but has been
    boiled down to meet the specific use cases in botocore. That being said this
    class (even in requests) is effectively a named-tuple.
    """

    _REQUEST_PREPARER_CLS = AWSRequestPreparer

    def __init__(
        self,
        method=None,
        url=None,
        headers=None,
        data=None,
        params=None,
        auth_path=None,
        stream_output=False,
    ):
        self._request_preparer = self._REQUEST_PREPARER_CLS()

        # Default empty dicts for dict params.
        params = {} if params is None else params

        self.method = method
        self.url = url
        self.headers = HTTPHeaders()
        self.data = data
        self.params = params
        self.auth_path = auth_path
        self.stream_output = stream_output

        if headers is not None:
            for key, value in headers.items():
                self.headers[key] = value

        # This is a dictionary to hold information that is used when
        # processing the request. What is inside of ``context`` is open-ended.
        # For example, it may have a timestamp key that is used for holding
        # what the timestamp is when signing the request. Note that none
        # of the information that is inside of ``context`` is directly
        # sent over the wire; the information is only used to assist in
        # creating what is sent over the wire.
        self.context = {}

    def prepare(self):
        """Constructs a :class:`AWSPreparedRequest <AWSPreparedRequest>`."""
        return self._request_preparer.prepare(self)

    @property
    def body(self):
        body = self.prepare().body
        if isinstance(body, str):
            body = body.encode('utf-8')
        return body


class AWSPreparedRequest:
    """A data class representing a finalized request to be sent over the wire.

    Requests at this stage should be treated as final, and the properties of
    the request should not be modified.

    :ivar method: The HTTP Method
    :ivar url: The full url
    :ivar headers: The HTTP headers to send.
    :ivar body: The HTTP body.
    :ivar stream_output: If the response for this request should be streamed.
    """

    def __init__(self, method, url, headers, body, stream_output):
        self.method = method
        self.url = url
        self.headers = headers
        self.body = body
        self.stream_output = stream_output

    def __repr__(self):
        fmt = (
            '<AWSPreparedRequest stream_output=%s, method=%s, url=%s, '
            'headers=%s>'
        )
        return fmt % (self.stream_output, self.method, self.url, self.headers)

    def reset_stream(self):
        """Resets the streaming body to it's initial position.

        If the request contains a streaming body (a streamable file-like object)
        seek to the object's initial position to ensure the entire contents of
        the object is sent. This is a no-op for static bytes-like body types.
        """
        # Trying to reset a stream when there is a no stream will
        # just immediately return.  It's not an error, it will produce
        # the same result as if we had actually reset the stream (we'll send
        # the entire body contents again if we need to).
        # Same case if the body is a string/bytes/bytearray type.

        non_seekable_types = (bytes, str, bytearray)
        if self.body is None or isinstance(self.body, non_seekable_types):
            return
        try:
            logger.debug("Rewinding stream: %s", self.body)
            self.body.seek(0)
        except Exception as e:
            logger.debug("Unable to rewind stream: %s", e)
            raise UnseekableStreamError(stream_object=self.body)


class AWSResponse:
    """A data class representing an HTTP response.

    This class was originally inspired by requests.models.Response, but has
    been boiled down to meet the specific use cases in botocore. This has
    effectively been reduced to a named tuple.

    :ivar url: The full url.
    :ivar status_code: The status code of the HTTP response.
    :ivar headers: The HTTP headers received.
    :ivar body: The HTTP response body.
    """

    def __init__(self, url, status_code, headers, raw):
        self.url = url
        self.status_code = status_code
        self.headers = HeadersDict(headers)
        self.raw = raw

        self._content = None

    @property
    def content(self):
        """Content of the response as bytes."""

        if self._content is None:
            # Read the contents.
            # NOTE: requests would attempt to call stream and fall back
            # to a custom generator that would call read in a loop, but
            # we don't rely on this behavior
            self._content = b''.join(self.raw.stream()) or b''

        return self._content

    @property
    def text(self):
        """Content of the response as a proper text type.

        Uses the encoding type provided in the reponse headers to decode the
        response content into a proper text type. If the encoding is not
        present in the headers, UTF-8 is used as a default.
        """
        encoding = botocore.utils.get_encoding_from_headers(self.headers)
        if encoding:
            return self.content.decode(encoding)
        else:
            return self.content.decode('utf-8')


class _HeaderKey:
    def __init__(self, key):
        self._key = key
        self._lower = key.lower()

    def __hash__(self):
        return hash(self._lower)

    def __eq__(self, other):
        return isinstance(other, _HeaderKey) and self._lower == other._lower

    def __str__(self):
        return self._key

    def __repr__(self):
        return repr(self._key)


class HeadersDict(MutableMapping):
    """A case-insenseitive dictionary to represent HTTP headers."""

    def __init__(self, *args, **kwargs):
        self._dict = {}
        self.update(*args, **kwargs)

    def __setitem__(self, key, value):
        self._dict[_HeaderKey(key)] = value

    def __getitem__(self, key):
        return self._dict[_HeaderKey(key)]

    def __delitem__(self, key):
        del self._dict[_HeaderKey(key)]

    def __iter__(self):
        return (str(key) for key in self._dict)

    def __len__(self):
        return len(self._dict)

    def __repr__(self):
        return repr(self._dict)

    def copy(self):
        return HeadersDict(self.items())
