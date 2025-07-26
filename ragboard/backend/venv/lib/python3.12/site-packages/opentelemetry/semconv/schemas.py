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


class Schemas(Enum):
    V1_21_0 = "https://opentelemetry.io/schemas/1.21.0"
    """
    The URL of the OpenTelemetry schema version 1.21.0.
    """

    V1_23_1 = "https://opentelemetry.io/schemas/1.23.1"
    """
    The URL of the OpenTelemetry schema version 1.23.1.
    """

    V1_25_0 = "https://opentelemetry.io/schemas/1.25.0"
    """
    The URL of the OpenTelemetry schema version 1.25.0.
    """

    V1_26_0 = "https://opentelemetry.io/schemas/1.26.0"
    """
    The URL of the OpenTelemetry schema version 1.26.0.
    """

    V1_27_0 = "https://opentelemetry.io/schemas/1.27.0"
    """
    The URL of the OpenTelemetry schema version 1.27.0.
    """

    V1_28_0 = "https://opentelemetry.io/schemas/1.28.0"
    """
    The URL of the OpenTelemetry schema version 1.28.0.
    """

    V1_29_0 = "https://opentelemetry.io/schemas/1.29.0"
    """
    The URL of the OpenTelemetry schema version 1.29.0.
    """

    V1_30_0 = "https://opentelemetry.io/schemas/1.30.0"
    """
    The URL of the OpenTelemetry schema version 1.30.0.
    """

    V1_31_0 = "https://opentelemetry.io/schemas/1.31.0"
    """
    The URL of the OpenTelemetry schema version 1.31.0.
    """

    V1_32_0 = "https://opentelemetry.io/schemas/1.32.0"
    """
    The URL of the OpenTelemetry schema version 1.32.0.
    """

    V1_33_0 = "https://opentelemetry.io/schemas/1.33.0"
    """
    The URL of the OpenTelemetry schema version 1.33.0.
    """

    V1_34_0 = "https://opentelemetry.io/schemas/1.34.0"
    """
    The URL of the OpenTelemetry schema version 1.34.0.
    """
    V1_36_0 = "https://opentelemetry.io/schemas/1.36.0"
    """
    The URL of the OpenTelemetry schema version 1.36.0.
    """

    # when generating new semantic conventions,
    # make sure to add new versions version here.
