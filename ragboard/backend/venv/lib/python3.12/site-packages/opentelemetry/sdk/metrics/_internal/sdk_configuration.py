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

# pylint: disable=unused-import

from dataclasses import dataclass
from typing import Sequence

# This kind of import is needed to avoid Sphinx errors.
import opentelemetry.sdk.metrics
import opentelemetry.sdk.resources


@dataclass
class SdkConfiguration:
    exemplar_filter: "opentelemetry.sdk.metrics.ExemplarFilter"
    resource: "opentelemetry.sdk.resources.Resource"
    metric_readers: Sequence["opentelemetry.sdk.metrics.MetricReader"]
    views: Sequence["opentelemetry.sdk.metrics.View"]
