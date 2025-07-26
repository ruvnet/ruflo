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

from typing import Final

URL_DOMAIN: Final = "url.domain"
"""
Domain extracted from the `url.full`, such as "opentelemetry.io".
Note: In some cases a URL may refer to an IP and/or port directly, without a domain name. In this case, the IP address would go to the domain field. If the URL contains a [literal IPv6 address](https://www.rfc-editor.org/rfc/rfc2732#section-2) enclosed by `[` and `]`, the `[` and `]` characters should also be captured in the domain field.
"""

URL_EXTENSION: Final = "url.extension"
"""
The file extension extracted from the `url.full`, excluding the leading dot.
Note: The file extension is only set if it exists, as not every url has a file extension. When the file name has multiple extensions `example.tar.gz`, only the last one should be captured `gz`, not `tar.gz`.
"""

URL_FRAGMENT: Final = "url.fragment"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.url_attributes.URL_FRAGMENT`.
"""

URL_FULL: Final = "url.full"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.url_attributes.URL_FULL`.
"""

URL_ORIGINAL: Final = "url.original"
"""
Unmodified original URL as seen in the event source.
Note: In network monitoring, the observed URL may be a full URL, whereas in access logs, the URL is often just represented as a path. This field is meant to represent the URL as it was observed, complete or not.
`url.original` might contain credentials passed via URL in form of `https://username:password@www.example.com/`. In such case password and username SHOULD NOT be redacted and attribute's value SHOULD remain the same.
"""

URL_PATH: Final = "url.path"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.url_attributes.URL_PATH`.
"""

URL_PORT: Final = "url.port"
"""
Port extracted from the `url.full`.
"""

URL_QUERY: Final = "url.query"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.url_attributes.URL_QUERY`.
"""

URL_REGISTERED_DOMAIN: Final = "url.registered_domain"
"""
The highest registered url domain, stripped of the subdomain.
Note: This value can be determined precisely with the [public suffix list](https://publicsuffix.org/). For example, the registered domain for `foo.example.com` is `example.com`. Trying to approximate this by simply taking the last two labels will not work well for TLDs such as `co.uk`.
"""

URL_SCHEME: Final = "url.scheme"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.url_attributes.URL_SCHEME`.
"""

URL_SUBDOMAIN: Final = "url.subdomain"
"""
The subdomain portion of a fully qualified domain name includes all of the names except the host name under the registered_domain. In a partially qualified domain, or if the qualification level of the full name cannot be determined, subdomain contains all of the names below the registered domain.
Note: The subdomain portion of `www.east.mydomain.co.uk` is `east`. If the domain has multiple levels of subdomain, such as `sub2.sub1.example.com`, the subdomain field should contain `sub2.sub1`, with no trailing period.
"""

URL_TEMPLATE: Final = "url.template"
"""
The low-cardinality template of an [absolute path reference](https://www.rfc-editor.org/rfc/rfc3986#section-4.2).
"""

URL_TOP_LEVEL_DOMAIN: Final = "url.top_level_domain"
"""
The effective top level domain (eTLD), also known as the domain suffix, is the last part of the domain name. For example, the top level domain for example.com is `com`.
Note: This value can be determined precisely with the [public suffix list](https://publicsuffix.org/).
"""
