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
Helpful utility functions and classes in relation to exploring API endpoints
with the aim for a user-friendly interface.
"""

import math
import re
from typing import TYPE_CHECKING

from ..repocard_data import ModelCardData


if TYPE_CHECKING:
    from ..hf_api import ModelInfo


def _is_emission_within_threshold(model_info: "ModelInfo", minimum_threshold: float, maximum_threshold: float) -> bool:
    """Checks if a model's emission is within a given threshold.

    Args:
        model_info (`ModelInfo`):
            A model info object containing the model's emission information.
        minimum_threshold (`float`):
            A minimum carbon threshold to filter by, such as 1.
        maximum_threshold (`float`):
            A maximum carbon threshold to filter by, such as 10.

    Returns:
        `bool`: Whether the model's emission is within the given threshold.
    """
    if minimum_threshold is None and maximum_threshold is None:
        raise ValueError("Both `minimum_threshold` and `maximum_threshold` cannot both be `None`")
    if minimum_threshold is None:
        minimum_threshold = -1
    if maximum_threshold is None:
        maximum_threshold = math.inf

    card_data = getattr(model_info, "card_data", None)
    if card_data is None or not isinstance(card_data, (dict, ModelCardData)):
        return False

    # Get CO2 emission metadata
    emission = card_data.get("co2_eq_emissions", None)
    if isinstance(emission, dict):
        emission = emission["emissions"]
    if not emission:
        return False

    # Filter out if value is missing or out of range
    matched = re.search(r"\d+\.\d+|\d+", str(emission))
    if matched is None:
        return False

    emission_value = float(matched.group(0))
    return minimum_threshold <= emission_value <= maximum_threshold
