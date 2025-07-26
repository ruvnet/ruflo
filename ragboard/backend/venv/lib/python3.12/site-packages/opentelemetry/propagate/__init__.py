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

"""
API for propagation of context.

The propagators for the
``opentelemetry.propagators.composite.CompositePropagator`` can be defined
via configuration in the ``OTEL_PROPAGATORS`` environment variable. This
variable should be set to a comma-separated string of names of values for the
``opentelemetry_propagator`` entry point. For example, setting
``OTEL_PROPAGATORS`` to ``tracecontext,baggage`` (which is the default value)
would instantiate
``opentelemetry.propagators.composite.CompositePropagator`` with 2
propagators, one of type
``opentelemetry.trace.propagation.tracecontext.TraceContextTextMapPropagator``
and other of type ``opentelemetry.baggage.propagation.W3CBaggagePropagator``.
Notice that these propagator classes are defined as
``opentelemetry_propagator`` entry points in the ``pyproject.toml`` file of
``opentelemetry``.

Example::

    import flask
    import requests
    from opentelemetry import propagate


    PROPAGATOR = propagate.get_global_textmap()


    def get_header_from_flask_request(request, key):
        return request.headers.get_all(key)

    def set_header_into_requests_request(request: requests.Request,
                                            key: str, value: str):
        request.headers[key] = value

    def example_route():
        context = PROPAGATOR.extract(
            get_header_from_flask_request,
            flask.request
        )
        request_to_downstream = requests.Request(
            "GET", "http://httpbin.org/get"
        )
        PROPAGATOR.inject(
            set_header_into_requests_request,
            request_to_downstream,
            context=context
        )
        session = requests.Session()
        session.send(request_to_downstream.prepare())


.. _Propagation API Specification:
    https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/context/api-propagators.md
"""

from logging import getLogger
from os import environ
from typing import List, Optional

from opentelemetry.context.context import Context
from opentelemetry.environment_variables import OTEL_PROPAGATORS
from opentelemetry.propagators import composite, textmap
from opentelemetry.util._importlib_metadata import entry_points

logger = getLogger(__name__)


def extract(
    carrier: textmap.CarrierT,
    context: Optional[Context] = None,
    getter: textmap.Getter[textmap.CarrierT] = textmap.default_getter,
) -> Context:
    """Uses the configured propagator to extract a Context from the carrier.

    Args:
        getter: an object which contains a get function that can retrieve zero
            or more values from the carrier and a keys function that can get all the keys
            from carrier.
        carrier: and object which contains values that are
            used to construct a Context. This object
            must be paired with an appropriate getter
            which understands how to extract a value from it.
        context: an optional Context to use. Defaults to root
            context if not set.
    """
    return get_global_textmap().extract(carrier, context, getter=getter)


def inject(
    carrier: textmap.CarrierT,
    context: Optional[Context] = None,
    setter: textmap.Setter[textmap.CarrierT] = textmap.default_setter,
) -> None:
    """Uses the configured propagator to inject a Context into the carrier.

    Args:
        carrier: the medium used by Propagators to read
            values from and write values to.
            Should be paired with setter, which
            should know how to set header values on the carrier.
        context: An optional Context to use. Defaults to current
            context if not set.
        setter: An optional `Setter` object that can set values
            on the carrier.
    """
    get_global_textmap().inject(carrier, context=context, setter=setter)


propagators: List[textmap.TextMapPropagator] = []

# Single use variable here to hack black and make lint pass
environ_propagators = environ.get(
    OTEL_PROPAGATORS,
    "tracecontext,baggage",
)


for propagator in environ_propagators.split(","):
    propagator = propagator.strip()
    if propagator.lower() == "none":
        logger.debug(
            "OTEL_PROPAGATORS environment variable contains none, removing all propagators"
        )
        propagators = []
        break
    try:
        propagators.append(
            next(  # type: ignore
                iter(  # type: ignore
                    entry_points(  # type: ignore[misc]
                        group="opentelemetry_propagator",
                        name=propagator,
                    )
                )
            ).load()()
        )
    except StopIteration:
        raise ValueError(
            f"Propagator {propagator} not found. It is either misspelled or not installed."
        )
    except Exception:  # pylint: disable=broad-exception-caught
        logger.exception("Failed to load propagator: %s", propagator)
        raise


_HTTP_TEXT_FORMAT: textmap.TextMapPropagator = composite.CompositePropagator(
    propagators
)


def get_global_textmap() -> textmap.TextMapPropagator:
    return _HTTP_TEXT_FORMAT


def set_global_textmap(
    http_text_format: textmap.TextMapPropagator,
) -> None:
    global _HTTP_TEXT_FORMAT  # pylint:disable=global-statement
    _HTTP_TEXT_FORMAT = http_text_format
