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

from opentelemetry.metrics import Counter, Histogram, Meter

FAAS_COLDSTARTS: Final = "faas.coldstarts"
"""
Number of invocation cold starts
Instrument: counter
Unit: {coldstart}
"""


def create_faas_coldstarts(meter: Meter) -> Counter:
    """Number of invocation cold starts"""
    return meter.create_counter(
        name=FAAS_COLDSTARTS,
        description="Number of invocation cold starts",
        unit="{coldstart}",
    )


FAAS_CPU_USAGE: Final = "faas.cpu_usage"
"""
Distribution of CPU usage per invocation
Instrument: histogram
Unit: s
"""


def create_faas_cpu_usage(meter: Meter) -> Histogram:
    """Distribution of CPU usage per invocation"""
    return meter.create_histogram(
        name=FAAS_CPU_USAGE,
        description="Distribution of CPU usage per invocation",
        unit="s",
    )


FAAS_ERRORS: Final = "faas.errors"
"""
Number of invocation errors
Instrument: counter
Unit: {error}
"""


def create_faas_errors(meter: Meter) -> Counter:
    """Number of invocation errors"""
    return meter.create_counter(
        name=FAAS_ERRORS,
        description="Number of invocation errors",
        unit="{error}",
    )


FAAS_INIT_DURATION: Final = "faas.init_duration"
"""
Measures the duration of the function's initialization, such as a cold start
Instrument: histogram
Unit: s
"""


def create_faas_init_duration(meter: Meter) -> Histogram:
    """Measures the duration of the function's initialization, such as a cold start"""
    return meter.create_histogram(
        name=FAAS_INIT_DURATION,
        description="Measures the duration of the function's initialization, such as a cold start",
        unit="s",
    )


FAAS_INVOCATIONS: Final = "faas.invocations"
"""
Number of successful invocations
Instrument: counter
Unit: {invocation}
"""


def create_faas_invocations(meter: Meter) -> Counter:
    """Number of successful invocations"""
    return meter.create_counter(
        name=FAAS_INVOCATIONS,
        description="Number of successful invocations",
        unit="{invocation}",
    )


FAAS_INVOKE_DURATION: Final = "faas.invoke_duration"
"""
Measures the duration of the function's logic execution
Instrument: histogram
Unit: s
"""


def create_faas_invoke_duration(meter: Meter) -> Histogram:
    """Measures the duration of the function's logic execution"""
    return meter.create_histogram(
        name=FAAS_INVOKE_DURATION,
        description="Measures the duration of the function's logic execution",
        unit="s",
    )


FAAS_MEM_USAGE: Final = "faas.mem_usage"
"""
Distribution of max memory usage per invocation
Instrument: histogram
Unit: By
"""


def create_faas_mem_usage(meter: Meter) -> Histogram:
    """Distribution of max memory usage per invocation"""
    return meter.create_histogram(
        name=FAAS_MEM_USAGE,
        description="Distribution of max memory usage per invocation",
        unit="By",
    )


FAAS_NET_IO: Final = "faas.net_io"
"""
Distribution of net I/O usage per invocation
Instrument: histogram
Unit: By
"""


def create_faas_net_io(meter: Meter) -> Histogram:
    """Distribution of net I/O usage per invocation"""
    return meter.create_histogram(
        name=FAAS_NET_IO,
        description="Distribution of net I/O usage per invocation",
        unit="By",
    )


FAAS_TIMEOUTS: Final = "faas.timeouts"
"""
Number of invocation timeouts
Instrument: counter
Unit: {timeout}
"""


def create_faas_timeouts(meter: Meter) -> Counter:
    """Number of invocation timeouts"""
    return meter.create_counter(
        name=FAAS_TIMEOUTS,
        description="Number of invocation timeouts",
        unit="{timeout}",
    )
