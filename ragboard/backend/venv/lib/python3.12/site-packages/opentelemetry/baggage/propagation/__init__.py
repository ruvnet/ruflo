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
#
from logging import getLogger
from re import split
from typing import Iterable, List, Mapping, Optional, Set
from urllib.parse import quote_plus, unquote_plus

from opentelemetry.baggage import _is_valid_pair, get_all, set_baggage
from opentelemetry.context import get_current
from opentelemetry.context.context import Context
from opentelemetry.propagators import textmap
from opentelemetry.util.re import _DELIMITER_PATTERN

_logger = getLogger(__name__)


class W3CBaggagePropagator(textmap.TextMapPropagator):
    """Extracts and injects Baggage which is used to annotate telemetry."""

    _MAX_HEADER_LENGTH = 8192
    _MAX_PAIR_LENGTH = 4096
    _MAX_PAIRS = 180
    _BAGGAGE_HEADER_NAME = "baggage"

    def extract(
        self,
        carrier: textmap.CarrierT,
        context: Optional[Context] = None,
        getter: textmap.Getter[textmap.CarrierT] = textmap.default_getter,
    ) -> Context:
        """Extract Baggage from the carrier.

        See
        `opentelemetry.propagators.textmap.TextMapPropagator.extract`
        """

        if context is None:
            context = get_current()

        header = _extract_first_element(
            getter.get(carrier, self._BAGGAGE_HEADER_NAME)
        )

        if not header:
            return context

        if len(header) > self._MAX_HEADER_LENGTH:
            _logger.warning(
                "Baggage header `%s` exceeded the maximum number of bytes per baggage-string",
                header,
            )
            return context

        baggage_entries: List[str] = split(_DELIMITER_PATTERN, header)
        total_baggage_entries = self._MAX_PAIRS

        if len(baggage_entries) > self._MAX_PAIRS:
            _logger.warning(
                "Baggage header `%s` exceeded the maximum number of list-members",
                header,
            )

        for entry in baggage_entries:
            if len(entry) > self._MAX_PAIR_LENGTH:
                _logger.warning(
                    "Baggage entry `%s` exceeded the maximum number of bytes per list-member",
                    entry,
                )
                continue
            if not entry:  # empty string
                continue
            try:
                name, value = entry.split("=", 1)
            except Exception:  # pylint: disable=broad-exception-caught
                _logger.warning(
                    "Baggage list-member `%s` doesn't match the format", entry
                )
                continue

            if not _is_valid_pair(name, value):
                _logger.warning("Invalid baggage entry: `%s`", entry)
                continue

            name = unquote_plus(name).strip()
            value = unquote_plus(value).strip()

            context = set_baggage(
                name,
                value,
                context=context,
            )
            total_baggage_entries -= 1
            if total_baggage_entries == 0:
                break

        return context

    def inject(
        self,
        carrier: textmap.CarrierT,
        context: Optional[Context] = None,
        setter: textmap.Setter[textmap.CarrierT] = textmap.default_setter,
    ) -> None:
        """Injects Baggage into the carrier.

        See
        `opentelemetry.propagators.textmap.TextMapPropagator.inject`
        """
        baggage_entries = get_all(context=context)
        if not baggage_entries:
            return

        baggage_string = _format_baggage(baggage_entries)
        setter.set(carrier, self._BAGGAGE_HEADER_NAME, baggage_string)

    @property
    def fields(self) -> Set[str]:
        """Returns a set with the fields set in `inject`."""
        return {self._BAGGAGE_HEADER_NAME}


def _format_baggage(baggage_entries: Mapping[str, object]) -> str:
    return ",".join(
        quote_plus(str(key)) + "=" + quote_plus(str(value))
        for key, value in baggage_entries.items()
    )


def _extract_first_element(
    items: Optional[Iterable[textmap.CarrierT]],
) -> Optional[textmap.CarrierT]:
    if items is None:
        return None
    return next(iter(items), None)
