# Copyright 2015 Google Inc.
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

"""Helper functions for commonly used utilities."""

import base64
import calendar
import datetime
from email.message import Message
import hashlib
import json
import logging
import sys
from typing import Any, Dict, Mapping, Optional, Union
import urllib

from google.auth import exceptions


# _BASE_LOGGER_NAME is the base logger for all google-based loggers.
_BASE_LOGGER_NAME = "google"

# _LOGGING_INITIALIZED ensures that base logger is only configured once
# (unless already configured by the end-user).
_LOGGING_INITIALIZED = False


# The smallest MDS cache used by this library stores tokens until 4 minutes from
# expiry.
REFRESH_THRESHOLD = datetime.timedelta(minutes=3, seconds=45)

# TODO(https://github.com/googleapis/google-auth-library-python/issues/1684): Audit and update the list below.
_SENSITIVE_FIELDS = {
    "accessToken",
    "access_token",
    "id_token",
    "client_id",
    "refresh_token",
    "client_secret",
}


def copy_docstring(source_class):
    """Decorator that copies a method's docstring from another class.

    Args:
        source_class (type): The class that has the documented method.

    Returns:
        Callable: A decorator that will copy the docstring of the same
            named method in the source class to the decorated method.
    """

    def decorator(method):
        """Decorator implementation.

        Args:
            method (Callable): The method to copy the docstring to.

        Returns:
            Callable: the same method passed in with an updated docstring.

        Raises:
            google.auth.exceptions.InvalidOperation: if the method already has a docstring.
        """
        if method.__doc__:
            raise exceptions.InvalidOperation("Method already has a docstring.")

        source_method = getattr(source_class, method.__name__)
        method.__doc__ = source_method.__doc__

        return method

    return decorator


def parse_content_type(header_value):
    """Parse a 'content-type' header value to get just the plain media-type (without parameters).

    This is done using the class Message from email.message as suggested in PEP 594
        (because the cgi is now deprecated and will be removed in python 3.13,
        see https://peps.python.org/pep-0594/#cgi).

    Args:
        header_value (str): The value of a 'content-type' header as a string.

    Returns:
        str: A string with just the lowercase media-type from the parsed 'content-type' header.
            If the provided content-type is not parsable, returns 'text/plain',
            the default value for textual files.
    """
    m = Message()
    m["content-type"] = header_value
    return (
        m.get_content_type()
    )  # Despite the name, actually returns just the media-type


def utcnow():
    """Returns the current UTC datetime.

    Returns:
        datetime: The current time in UTC.
    """
    # We used datetime.utcnow() before, since it's deprecated from python 3.12,
    # we are using datetime.now(timezone.utc) now. "utcnow()" is offset-native
    # (no timezone info), but "now()" is offset-aware (with timezone info).
    # This will cause datetime comparison problem. For backward compatibility,
    # we need to remove the timezone info.
    now = datetime.datetime.now(datetime.timezone.utc)
    now = now.replace(tzinfo=None)
    return now


def datetime_to_secs(value):
    """Convert a datetime object to the number of seconds since the UNIX epoch.

    Args:
        value (datetime): The datetime to convert.

    Returns:
        int: The number of seconds since the UNIX epoch.
    """
    return calendar.timegm(value.utctimetuple())


def to_bytes(value, encoding="utf-8"):
    """Converts a string value to bytes, if necessary.

    Args:
        value (Union[str, bytes]): The value to be converted.
        encoding (str): The encoding to use to convert unicode to bytes.
            Defaults to "utf-8".

    Returns:
        bytes: The original value converted to bytes (if unicode) or as
            passed in if it started out as bytes.

    Raises:
        google.auth.exceptions.InvalidValue: If the value could not be converted to bytes.
    """
    result = value.encode(encoding) if isinstance(value, str) else value
    if isinstance(result, bytes):
        return result
    else:
        raise exceptions.InvalidValue(
            "{0!r} could not be converted to bytes".format(value)
        )


def from_bytes(value):
    """Converts bytes to a string value, if necessary.

    Args:
        value (Union[str, bytes]): The value to be converted.

    Returns:
        str: The original value converted to unicode (if bytes) or as passed in
            if it started out as unicode.

    Raises:
        google.auth.exceptions.InvalidValue: If the value could not be converted to unicode.
    """
    result = value.decode("utf-8") if isinstance(value, bytes) else value
    if isinstance(result, str):
        return result
    else:
        raise exceptions.InvalidValue(
            "{0!r} could not be converted to unicode".format(value)
        )


def update_query(url, params, remove=None):
    """Updates a URL's query parameters.

    Replaces any current values if they are already present in the URL.

    Args:
        url (str): The URL to update.
        params (Mapping[str, str]): A mapping of query parameter
            keys to values.
        remove (Sequence[str]): Parameters to remove from the query string.

    Returns:
        str: The URL with updated query parameters.

    Examples:

        >>> url = 'http://example.com?a=1'
        >>> update_query(url, {'a': '2'})
        http://example.com?a=2
        >>> update_query(url, {'b': '3'})
        http://example.com?a=1&b=3
        >> update_query(url, {'b': '3'}, remove=['a'])
        http://example.com?b=3

    """
    if remove is None:
        remove = []

    # Split the URL into parts.
    parts = urllib.parse.urlparse(url)
    # Parse the query string.
    query_params = urllib.parse.parse_qs(parts.query)
    # Update the query parameters with the new parameters.
    query_params.update(params)
    # Remove any values specified in remove.
    query_params = {
        key: value for key, value in query_params.items() if key not in remove
    }
    # Re-encoded the query string.
    new_query = urllib.parse.urlencode(query_params, doseq=True)
    # Unsplit the url.
    new_parts = parts._replace(query=new_query)
    return urllib.parse.urlunparse(new_parts)


def scopes_to_string(scopes):
    """Converts scope value to a string suitable for sending to OAuth 2.0
    authorization servers.

    Args:
        scopes (Sequence[str]): The sequence of scopes to convert.

    Returns:
        str: The scopes formatted as a single string.
    """
    return " ".join(scopes)


def string_to_scopes(scopes):
    """Converts stringifed scopes value to a list.

    Args:
        scopes (Union[Sequence, str]): The string of space-separated scopes
            to convert.
    Returns:
        Sequence(str): The separated scopes.
    """
    if not scopes:
        return []

    return scopes.split(" ")


def padded_urlsafe_b64decode(value):
    """Decodes base64 strings lacking padding characters.

    Google infrastructure tends to omit the base64 padding characters.

    Args:
        value (Union[str, bytes]): The encoded value.

    Returns:
        bytes: The decoded value
    """
    b64string = to_bytes(value)
    padded = b64string + b"=" * (-len(b64string) % 4)
    return base64.urlsafe_b64decode(padded)


def unpadded_urlsafe_b64encode(value):
    """Encodes base64 strings removing any padding characters.

    `rfc 7515`_ defines Base64url to NOT include any padding
    characters, but the stdlib doesn't do that by default.

    _rfc7515: https://tools.ietf.org/html/rfc7515#page-6

    Args:
        value (Union[str|bytes]): The bytes-like value to encode

    Returns:
        Union[str|bytes]: The encoded value
    """
    return base64.urlsafe_b64encode(value).rstrip(b"=")


def is_python_3():
    """Check if the Python interpreter is Python 2 or 3.

    Returns:
        bool: True if the Python interpreter is Python 3 and False otherwise.
    """
    return sys.version_info > (3, 0)


def _hash_sensitive_info(data: Union[dict, list]) -> Union[dict, list, str]:
    """
    Hashes sensitive information within a dictionary.

    Args:
        data: The dictionary containing data to be processed.

    Returns:
        A new dictionary with sensitive values replaced by their SHA512 hashes.
        If the input is a list, returns a list with each element recursively processed.
        If the input is neither a dict nor a list, returns the type of the input as a string.

    """
    if isinstance(data, dict):
        hashed_data: Dict[Any, Union[Optional[str], dict, list]] = {}
        for key, value in data.items():
            if key in _SENSITIVE_FIELDS and not isinstance(value, (dict, list)):
                hashed_data[key] = _hash_value(value, key)
            elif isinstance(value, (dict, list)):
                hashed_data[key] = _hash_sensitive_info(value)
            else:
                hashed_data[key] = value
        return hashed_data
    elif isinstance(data, list):
        hashed_list = []
        for val in data:
            hashed_list.append(_hash_sensitive_info(val))
        return hashed_list
    else:
        # TODO(https://github.com/googleapis/google-auth-library-python/issues/1701):
        # Investigate and hash sensitive info before logging when the data type is
        # not a dict or a list.
        return str(type(data))


def _hash_value(value, field_name: str) -> Optional[str]:
    """Hashes a value and returns a formatted hash string."""
    if value is None:
        return None
    encoded_value = str(value).encode("utf-8")
    hash_object = hashlib.sha512()
    hash_object.update(encoded_value)
    hex_digest = hash_object.hexdigest()
    return f"hashed_{field_name}-{hex_digest}"


def _logger_configured(logger: logging.Logger) -> bool:
    """Determines whether `logger` has non-default configuration

    Args:
      logger: The logger to check.

    Returns:
      bool: Whether the logger has any non-default configuration.
    """
    return (
        logger.handlers != [] or logger.level != logging.NOTSET or not logger.propagate
    )


def is_logging_enabled(logger: logging.Logger) -> bool:
    """
    Checks if debug logging is enabled for the given logger.

    Args:
        logger: The logging.Logger instance to check.

    Returns:
        True if debug logging is enabled, False otherwise.
    """
    # NOTE: Log propagation to the root logger is disabled unless
    # the base logger i.e. logging.getLogger("google") is
    # explicitly configured by the end user. Ideally this
    # needs to happen in the client layer (already does for GAPICs).
    # However, this is implemented here to avoid logging
    # (if a root logger is configured) when a version of google-auth
    # which supports logging is used with:
    #  - an older version of a GAPIC which does not support logging.
    #  - Apiary client which does not support logging.
    global _LOGGING_INITIALIZED
    if not _LOGGING_INITIALIZED:
        base_logger = logging.getLogger(_BASE_LOGGER_NAME)
        if not _logger_configured(base_logger):
            base_logger.propagate = False
        _LOGGING_INITIALIZED = True

    return logger.isEnabledFor(logging.DEBUG)


def request_log(
    logger: logging.Logger,
    method: str,
    url: str,
    body: Optional[bytes],
    headers: Optional[Mapping[str, str]],
) -> None:
    """
    Logs an HTTP request at the DEBUG level if logging is enabled.

    Args:
        logger: The logging.Logger instance to use.
        method: The HTTP method (e.g., "GET", "POST").
        url: The URL of the request.
        body: The request body (can be None).
        headers: The request headers (can be None).
    """
    if is_logging_enabled(logger):
        content_type = (
            headers["Content-Type"] if headers and "Content-Type" in headers else ""
        )
        json_body = _parse_request_body(body, content_type=content_type)
        logged_body = _hash_sensitive_info(json_body)
        logger.debug(
            "Making request...",
            extra={
                "httpRequest": {
                    "method": method,
                    "url": url,
                    "body": logged_body,
                    "headers": headers,
                }
            },
        )


def _parse_request_body(body: Optional[bytes], content_type: str = "") -> Any:
    """
    Parses a request body, handling bytes and string types, and different content types.

    Args:
        body (Optional[bytes]): The request body.
        content_type (str): The content type of the request body, e.g., "application/json",
            "application/x-www-form-urlencoded", or "text/plain". If empty, attempts
            to parse as JSON.

    Returns:
        Parsed body (dict, str, or None).
        - JSON: Decodes if content_type is "application/json" or None (fallback).
        - URL-encoded: Parses if content_type is "application/x-www-form-urlencoded".
        - Plain text: Returns string if content_type is "text/plain".
        - None: Returns if body is None, UTF-8 decode fails, or content_type is unknown.
    """
    if body is None:
        return None
    try:
        body_str = body.decode("utf-8")
    except (UnicodeDecodeError, AttributeError):
        return None
    content_type = content_type.lower()
    if not content_type or "application/json" in content_type:
        try:
            return json.loads(body_str)
        except (json.JSONDecodeError, TypeError):
            return body_str
    if "application/x-www-form-urlencoded" in content_type:
        parsed_query = urllib.parse.parse_qs(body_str)
        result = {k: v[0] for k, v in parsed_query.items()}
        return result
    if "text/plain" in content_type:
        return body_str
    return None


def _parse_response(response: Any) -> Any:
    """
    Parses a response, attempting to decode JSON.

    Args:
        response: The response object to parse. This can be any type, but
            it is expected to have a `json()` method if it contains JSON.

    Returns:
        The parsed response. If the response contains valid JSON, the
        decoded JSON object (e.g., a dictionary or list) is returned.
        If the response does not have a `json()` method or if the JSON
        decoding fails, None is returned.
    """
    try:
        json_response = response.json()
        return json_response
    except Exception:
        # TODO(https://github.com/googleapis/google-auth-library-python/issues/1744):
        # Parse and return response payload as json based on different content types.
        return None


def _response_log_base(logger: logging.Logger, parsed_response: Any) -> None:
    """
    Logs a parsed HTTP response at the DEBUG level.

    This internal helper function takes a parsed response and logs it
    using the provided logger. It also applies a hashing function to
    potentially sensitive information before logging.

    Args:
        logger: The logging.Logger instance to use for logging.
        parsed_response: The parsed HTTP response object (e.g., a dictionary,
            list, or the original response if parsing failed).
    """

    logged_response = _hash_sensitive_info(parsed_response)
    logger.debug("Response received...", extra={"httpResponse": logged_response})


def response_log(logger: logging.Logger, response: Any) -> None:
    """
    Logs an HTTP response at the DEBUG level if logging is enabled.

    Args:
        logger: The logging.Logger instance to use.
        response: The HTTP response object to log.
    """
    if is_logging_enabled(logger):
        json_response = _parse_response(response)
        _response_log_base(logger, json_response)
