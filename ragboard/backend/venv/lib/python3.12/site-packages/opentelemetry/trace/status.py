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

import enum
import logging
import typing

logger = logging.getLogger(__name__)


class StatusCode(enum.Enum):
    """Represents the canonical set of status codes of a finished Span."""

    UNSET = 0
    """The default status."""

    OK = 1
    """The operation has been validated by an Application developer or Operator to have completed successfully."""

    ERROR = 2
    """The operation contains an error."""


class Status:
    """Represents the status of a finished Span.

    Args:
        status_code: The canonical status code that describes the result
            status of the operation.
        description: An optional description of the status.
    """

    def __init__(
        self,
        status_code: StatusCode = StatusCode.UNSET,
        description: typing.Optional[str] = None,
    ):
        self._status_code = status_code
        self._description = None

        if description:
            if not isinstance(description, str):
                logger.warning("Invalid status description type, expected str")
                return
            if status_code is not StatusCode.ERROR:
                logger.warning(
                    "description should only be set when status_code is set to StatusCode.ERROR"
                )
                return

        self._description = description

    @property
    def status_code(self) -> StatusCode:
        """Represents the canonical status code of a finished Span."""
        return self._status_code

    @property
    def description(self) -> typing.Optional[str]:
        """Status description"""
        return self._description

    @property
    def is_ok(self) -> bool:
        """Returns false if this represents an error, true otherwise."""
        return self.is_unset or self._status_code is StatusCode.OK

    @property
    def is_unset(self) -> bool:
        """Returns true if unset, false otherwise."""
        return self._status_code is StatusCode.UNSET
