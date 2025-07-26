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

import dataclasses
from typing import Optional, Union

from opentelemetry.util.types import Attributes


@dataclasses.dataclass(frozen=True)
class Exemplar:
    """A representation of an exemplar, which is a sample input measurement.

    Exemplars also hold information about the environment when the measurement
    was recorded, for example the span and trace ID of the active span when the
    exemplar was recorded.

    Attributes
        trace_id: (optional) The trace associated with a recording
        span_id: (optional) The span associated with a recording
        time_unix_nano: The time of the observation
        value: The recorded value
        filtered_attributes: A set of filtered attributes which provide additional insight into the Context when the observation was made.

    References:
        https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/data-model.md#exemplars
        https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#exemplar
    """

    # TODO Fix doc - if using valid Google `Attributes:` key, the attributes are duplicated
    # one will come from napoleon extension and the other from autodoc extension. This
    # will raise an sphinx error of duplicated object description
    # See https://github.com/sphinx-doc/sphinx/issues/8664

    filtered_attributes: Attributes
    value: Union[int, float]
    time_unix_nano: int
    span_id: Optional[int] = None
    trace_id: Optional[int] = None
