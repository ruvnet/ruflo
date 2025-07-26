# Copyright The OpenTelemetry Authors
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

from enum import Enum
from typing import Final

HTTP_REQUEST_HEADER_TEMPLATE: Final = "http.request.header"
"""
HTTP request headers, `<key>` being the normalized HTTP Header name (lowercase), the value being the header values.
Note: Instrumentations SHOULD require an explicit configuration of which headers are to be captured.
Including all request headers can be a security risk - explicit configuration helps avoid leaking sensitive information.

The `User-Agent` header is already captured in the `user_agent.original` attribute.
Users MAY explicitly configure instrumentations to capture them even though it is not recommended.

The attribute value MUST consist of either multiple header values as an array of strings
or a single-item array containing a possibly comma-concatenated string, depending on the way
the HTTP library provides access to headers.

Examples:

- A header `Content-Type: application/json` SHOULD be recorded as the `http.request.header.content-type`
  attribute with value `["application/json"]`.
- A header `X-Forwarded-For: 1.2.3.4, 1.2.3.5` SHOULD be recorded as the `http.request.header.x-forwarded-for`
  attribute with value `["1.2.3.4", "1.2.3.5"]` or `["1.2.3.4, 1.2.3.5"]` depending on the HTTP library.
"""

HTTP_REQUEST_METHOD: Final = "http.request.method"
"""
HTTP request method.
Note: HTTP request method value SHOULD be "known" to the instrumentation.
By default, this convention defines "known" methods as the ones listed in [RFC9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-methods)
and the PATCH method defined in [RFC5789](https://www.rfc-editor.org/rfc/rfc5789.html).

If the HTTP request method is not known to instrumentation, it MUST set the `http.request.method` attribute to `_OTHER`.

If the HTTP instrumentation could end up converting valid HTTP request methods to `_OTHER`, then it MUST provide a way to override
the list of known HTTP methods. If this override is done via environment variable, then the environment variable MUST be named
OTEL_INSTRUMENTATION_HTTP_KNOWN_METHODS and support a comma-separated list of case-sensitive known HTTP methods
(this list MUST be a full override of the default known method, it is not a list of known methods in addition to the defaults).

HTTP method names are case-sensitive and `http.request.method` attribute value MUST match a known HTTP method name exactly.
Instrumentations for specific web frameworks that consider HTTP methods to be case insensitive, SHOULD populate a canonical equivalent.
Tracing instrumentations that do so, MUST also set `http.request.method_original` to the original value.
"""

HTTP_REQUEST_METHOD_ORIGINAL: Final = "http.request.method_original"
"""
Original HTTP method sent by the client in the request line.
"""

HTTP_REQUEST_RESEND_COUNT: Final = "http.request.resend_count"
"""
The ordinal number of request resending attempt (for any reason, including redirects).
Note: The resend count SHOULD be updated each time an HTTP request gets resent by the client, regardless of what was the cause of the resending (e.g. redirection, authorization failure, 503 Server Unavailable, network issues, or any other).
"""

HTTP_RESPONSE_HEADER_TEMPLATE: Final = "http.response.header"
"""
HTTP response headers, `<key>` being the normalized HTTP Header name (lowercase), the value being the header values.
Note: Instrumentations SHOULD require an explicit configuration of which headers are to be captured.
Including all response headers can be a security risk - explicit configuration helps avoid leaking sensitive information.

Users MAY explicitly configure instrumentations to capture them even though it is not recommended.

The attribute value MUST consist of either multiple header values as an array of strings
or a single-item array containing a possibly comma-concatenated string, depending on the way
the HTTP library provides access to headers.

Examples:

- A header `Content-Type: application/json` header SHOULD be recorded as the `http.request.response.content-type`
  attribute with value `["application/json"]`.
- A header `My-custom-header: abc, def` header SHOULD be recorded as the `http.response.header.my-custom-header`
  attribute with value `["abc", "def"]` or `["abc, def"]` depending on the HTTP library.
"""

HTTP_RESPONSE_STATUS_CODE: Final = "http.response.status_code"
"""
[HTTP response status code](https://tools.ietf.org/html/rfc7231#section-6).
"""

HTTP_ROUTE: Final = "http.route"
"""
The matched route, that is, the path template in the format used by the respective server framework.
Note: MUST NOT be populated when this is not supported by the HTTP server framework as the route attribute should have low-cardinality and the URI path can NOT substitute it.
SHOULD include the [application root](/docs/http/http-spans.md#http-server-definitions) if there is one.
"""


class HttpRequestMethodValues(Enum):
    CONNECT = "CONNECT"
    """CONNECT method."""
    DELETE = "DELETE"
    """DELETE method."""
    GET = "GET"
    """GET method."""
    HEAD = "HEAD"
    """HEAD method."""
    OPTIONS = "OPTIONS"
    """OPTIONS method."""
    PATCH = "PATCH"
    """PATCH method."""
    POST = "POST"
    """POST method."""
    PUT = "PUT"
    """PUT method."""
    TRACE = "TRACE"
    """TRACE method."""
    OTHER = "_OTHER"
    """Any HTTP method that the instrumentation has no prior knowledge of."""
