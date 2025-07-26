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

CPYTHON_GC_GENERATION: Final = "cpython.gc.generation"
"""
Value of the garbage collector collection generation.
"""


class CPythonGCGenerationValues(Enum):
    GENERATION_0 = 0
    """Generation 0."""
    GENERATION_1 = 1
    """Generation 1."""
    GENERATION_2 = 2
    """Generation 2."""
