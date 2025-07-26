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

from logging import getLogger
from re import compile, split
from typing import Dict, List, Mapping
from urllib.parse import unquote

from typing_extensions import deprecated

_logger = getLogger(__name__)

# The following regexes reference this spec: https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/exporter.md#specifying-headers-via-environment-variables

# Optional whitespace
_OWS = r"[ \t]*"
# A key contains printable US-ASCII characters except: SP and "(),/:;<=>?@[\]{}
_KEY_FORMAT = (
    r"[\x21\x23-\x27\x2a\x2b\x2d\x2e\x30-\x39\x41-\x5a\x5e-\x7a\x7c\x7e]+"
)
# A value contains a URL-encoded UTF-8 string. The encoded form can contain any
# printable US-ASCII characters (0x20-0x7f) other than SP, DEL, and ",;/
_VALUE_FORMAT = r"[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*"
# Like above with SP included
_LIBERAL_VALUE_FORMAT = r"[\x20\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*"
# A key-value is key=value, with optional whitespace surrounding key and value
_KEY_VALUE_FORMAT = rf"{_OWS}{_KEY_FORMAT}{_OWS}={_OWS}{_VALUE_FORMAT}{_OWS}"

_HEADER_PATTERN = compile(_KEY_VALUE_FORMAT)
_LIBERAL_HEADER_PATTERN = compile(
    rf"{_OWS}{_KEY_FORMAT}{_OWS}={_OWS}{_LIBERAL_VALUE_FORMAT}{_OWS}"
)
_DELIMITER_PATTERN = compile(r"[ \t]*,[ \t]*")

_BAGGAGE_PROPERTY_FORMAT = rf"{_KEY_VALUE_FORMAT}|{_OWS}{_KEY_FORMAT}{_OWS}"

_INVALID_HEADER_ERROR_MESSAGE_STRICT_TEMPLATE = (
    "Header format invalid! Header values in environment variables must be "
    "URL encoded per the OpenTelemetry Protocol Exporter specification: %s"
)

_INVALID_HEADER_ERROR_MESSAGE_LIBERAL_TEMPLATE = (
    "Header format invalid! Header values in environment variables must be "
    "URL encoded per the OpenTelemetry Protocol Exporter specification or "
    "a comma separated list of name=value occurrences: %s"
)

# pylint: disable=invalid-name


@deprecated(
    "You should use parse_env_headers. Deprecated since version 1.15.0."
)
def parse_headers(s: str) -> Mapping[str, str]:
    return parse_env_headers(s)


def parse_env_headers(s: str, liberal: bool = False) -> Mapping[str, str]:
    """
    Parse ``s``, which is a ``str`` instance containing HTTP headers encoded
    for use in ENV variables per the W3C Baggage HTTP header format at
    https://www.w3.org/TR/baggage/#baggage-http-header-format, except that
    additional semi-colon delimited metadata is not supported.
    If ``liberal`` is True we try to parse ``s`` anyway to be more compatible
    with other languages SDKs that accept non URL-encoded headers by default.
    """
    headers: Dict[str, str] = {}
    headers_list: List[str] = split(_DELIMITER_PATTERN, s)
    for header in headers_list:
        if not header:  # empty string
            continue
        header_match = _HEADER_PATTERN.fullmatch(header.strip())
        if not header_match and not liberal:
            _logger.warning(
                _INVALID_HEADER_ERROR_MESSAGE_STRICT_TEMPLATE, header
            )
            continue

        if header_match:
            match_string: str = header_match.string
            # value may contain any number of `=`
            name, value = match_string.split("=", 1)
            name = unquote(name).strip().lower()
            value = unquote(value).strip()
            headers[name] = value
        else:
            # this is not url-encoded and does not match the spec but we decided to be
            # liberal in what we accept to match other languages SDKs behaviour
            liberal_header_match = _LIBERAL_HEADER_PATTERN.fullmatch(
                header.strip()
            )
            if not liberal_header_match:
                _logger.warning(
                    _INVALID_HEADER_ERROR_MESSAGE_LIBERAL_TEMPLATE, header
                )
                continue

            liberal_match_string: str = liberal_header_match.string
            # value may contain any number of `=`
            name, value = liberal_match_string.split("=", 1)
            name = name.strip().lower()
            value = value.strip()
            headers[name] = value

    return headers
