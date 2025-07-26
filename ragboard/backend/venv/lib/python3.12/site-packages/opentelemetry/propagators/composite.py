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
import logging
import typing

from typing_extensions import deprecated

from opentelemetry.context.context import Context
from opentelemetry.propagators import textmap

logger = logging.getLogger(__name__)


class CompositePropagator(textmap.TextMapPropagator):
    """CompositePropagator provides a mechanism for combining multiple
    propagators into a single one.

    Args:
        propagators: the list of propagators to use
    """

    def __init__(
        self, propagators: typing.Sequence[textmap.TextMapPropagator]
    ) -> None:
        self._propagators = propagators

    def extract(
        self,
        carrier: textmap.CarrierT,
        context: typing.Optional[Context] = None,
        getter: textmap.Getter[textmap.CarrierT] = textmap.default_getter,
    ) -> Context:
        """Run each of the configured propagators with the given context and carrier.
        Propagators are run in the order they are configured, if multiple
        propagators write the same context key, the propagator later in the list
        will override previous propagators.

        See `opentelemetry.propagators.textmap.TextMapPropagator.extract`
        """
        for propagator in self._propagators:
            context = propagator.extract(carrier, context, getter=getter)
        return context  # type: ignore

    def inject(
        self,
        carrier: textmap.CarrierT,
        context: typing.Optional[Context] = None,
        setter: textmap.Setter[textmap.CarrierT] = textmap.default_setter,
    ) -> None:
        """Run each of the configured propagators with the given context and carrier.
        Propagators are run in the order they are configured, if multiple
        propagators write the same carrier key, the propagator later in the list
        will override previous propagators.

        See `opentelemetry.propagators.textmap.TextMapPropagator.inject`
        """
        for propagator in self._propagators:
            propagator.inject(carrier, context, setter=setter)

    @property
    def fields(self) -> typing.Set[str]:
        """Returns a set with the fields set in `inject`.

        See
        `opentelemetry.propagators.textmap.TextMapPropagator.fields`
        """
        composite_fields = set()

        for propagator in self._propagators:
            for field in propagator.fields:
                composite_fields.add(field)

        return composite_fields


@deprecated(
    "You should use CompositePropagator. Deprecated since version 1.2.0."
)
class CompositeHTTPPropagator(CompositePropagator):
    """CompositeHTTPPropagator provides a mechanism for combining multiple
    propagators into a single one.
    """
