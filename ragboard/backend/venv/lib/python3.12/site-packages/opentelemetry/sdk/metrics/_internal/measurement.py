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

from dataclasses import dataclass
from typing import Union

from opentelemetry.context import Context
from opentelemetry.metrics import Instrument
from opentelemetry.util.types import Attributes


@dataclass(frozen=True)
class Measurement:
    """
    Represents a data point reported via the metrics API to the SDK.

    Attributes
        value: Measured value
        time_unix_nano: The time the API call was made to record the Measurement
        instrument: The instrument that produced this `Measurement`.
        context: The active Context of the Measurement at API call time.
        attributes: Measurement attributes
    """

    # TODO Fix doc - if using valid Google `Attributes:` key, the attributes are duplicated
    # one will come from napoleon extension and the other from autodoc extension. This
    # will raise an sphinx error of duplicated object description
    # See https://github.com/sphinx-doc/sphinx/issues/8664

    value: Union[int, float]
    time_unix_nano: int
    instrument: Instrument
    context: Context
    attributes: Attributes = None
