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

from typing import Mapping, Optional, Sequence, Tuple, Union

# This is the implementation of the "Any" type as specified by the specifications of OpenTelemetry data model for logs.
# For more details, refer to the OTel specification:
# https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/logs/data-model.md#type-any
AnyValue = Union[
    str,
    bool,
    int,
    float,
    bytes,
    Sequence["AnyValue"],
    Mapping[str, "AnyValue"],
    None,
]

AttributeValue = Union[
    str,
    bool,
    int,
    float,
    Sequence[str],
    Sequence[bool],
    Sequence[int],
    Sequence[float],
]
Attributes = Optional[Mapping[str, AttributeValue]]
AttributesAsKey = Tuple[
    Tuple[
        str,
        Union[
            str,
            bool,
            int,
            float,
            Tuple[Optional[str], ...],
            Tuple[Optional[bool], ...],
            Tuple[Optional[int], ...],
            Tuple[Optional[float], ...],
        ],
    ],
    ...,
]

_ExtendedAttributes = Mapping[str, "AnyValue"]
