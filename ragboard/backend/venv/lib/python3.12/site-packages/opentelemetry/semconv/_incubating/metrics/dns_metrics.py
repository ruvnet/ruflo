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


from typing import Final

from opentelemetry.metrics import Histogram, Meter

DNS_LOOKUP_DURATION: Final = "dns.lookup.duration"
"""
Measures the time taken to perform a DNS lookup
Instrument: histogram
Unit: s
"""


def create_dns_lookup_duration(meter: Meter) -> Histogram:
    """Measures the time taken to perform a DNS lookup"""
    return meter.create_histogram(
        name=DNS_LOOKUP_DURATION,
        description="Measures the time taken to perform a DNS lookup.",
        unit="s",
    )
