# Copyright 2025 Google Inc.
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


import logging
from typing import Any

from google.auth import _helpers


async def _parse_response_async(response: Any) -> Any:
    """
    Parses an async response, attempting to decode JSON.

    Args:
        response: The response object to parse. This can be any type, but
            it is expected to have a `json()` method if it contains JSON.

    Returns:
        The parsed response. If the response contains valid JSON, the
        decoded JSON object (e.g., a dictionary) is returned.
        If the response does not have a `json()` method or if the JSON
        decoding fails, None is returned.
    """
    try:
        json_response = await response.json()
        return json_response
    except Exception:
        # TODO(https://github.com/googleapis/google-auth-library-python/issues/1745):
        # Parse and return response payload as json based on different content types.
        return None


async def response_log_async(logger: logging.Logger, response: Any) -> None:
    """
    Logs an Async HTTP response at the DEBUG level if logging is enabled.

    Args:
        logger: The logging.Logger instance to use.
        response: The HTTP response object to log.
    """
    if _helpers.is_logging_enabled(logger):
        # TODO(https://github.com/googleapis/google-auth-library-python/issues/1755):
        # Parsing the response for async streaming logging results in
        # the stream to be empty downstream. For now, we will not be logging
        # the response for async responses until we investigate further.
        # json_response = await _parse_response_async(response)
        json_response = None
        _helpers._response_log_base(logger, json_response)
