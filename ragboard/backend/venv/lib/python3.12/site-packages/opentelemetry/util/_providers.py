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
from os import environ
from typing import TYPE_CHECKING, TypeVar, cast

from opentelemetry.util._importlib_metadata import entry_points

if TYPE_CHECKING:
    from opentelemetry.metrics import MeterProvider
    from opentelemetry.trace import TracerProvider

Provider = TypeVar("Provider", "TracerProvider", "MeterProvider")

logger = getLogger(__name__)


def _load_provider(
    provider_environment_variable: str, provider: str
) -> Provider:  # type: ignore[type-var]
    try:
        provider_name = cast(
            str,
            environ.get(provider_environment_variable, f"default_{provider}"),
        )

        return cast(
            Provider,
            next(  # type: ignore
                iter(  # type: ignore
                    entry_points(  # type: ignore
                        group=f"opentelemetry_{provider}",
                        name=provider_name,
                    )
                )
            ).load()(),
        )
    except Exception:  # pylint: disable=broad-exception-caught
        logger.exception("Failed to load configured provider %s", provider)
        raise
