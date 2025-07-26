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

from enum import Enum
from typing import Final

OPENTRACING_REF_TYPE: Final = "opentracing.ref_type"
"""
Parent-child Reference type.
Note: The causal relationship between a child Span and a parent Span.
"""


class OpentracingRefTypeValues(Enum):
    CHILD_OF = "child_of"
    """The parent Span depends on the child Span in some capacity."""
    FOLLOWS_FROM = "follows_from"
    """The parent Span doesn't depend in any way on the result of the child Span."""
