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

from typing_extensions import deprecated


@deprecated(
    "Use metrics defined in the :py:const:`opentelemetry.semconv.metrics` and :py:const:`opentelemetry.semconv._incubating.metrics` modules instead. Deprecated since version 1.25.0.",
)
class MetricInstruments:
    SCHEMA_URL = "https://opentelemetry.io/schemas/1.21.0"
    """
    The URL of the OpenTelemetry schema for these keys and values.
    """

    HTTP_SERVER_DURATION = "http.server.duration"
    """
    Measures the duration of inbound HTTP requests
    Instrument: histogram
    Unit: s
    """

    HTTP_SERVER_ACTIVE_REQUESTS = "http.server.active_requests"
    """
    Measures the number of concurrent HTTP requests that are currently in-flight
    Instrument: updowncounter
    Unit: {request}
    """

    HTTP_SERVER_REQUEST_SIZE = "http.server.request.size"
    """
    Measures the size of HTTP request messages (compressed)
    Instrument: histogram
    Unit: By
    """

    HTTP_SERVER_RESPONSE_SIZE = "http.server.response.size"
    """
    Measures the size of HTTP response messages (compressed)
    Instrument: histogram
    Unit: By
    """

    HTTP_CLIENT_DURATION = "http.client.duration"
    """
    Measures the duration of outbound HTTP requests
    Instrument: histogram
    Unit: s
    """

    HTTP_CLIENT_REQUEST_SIZE = "http.client.request.size"
    """
    Measures the size of HTTP request messages (compressed)
    Instrument: histogram
    Unit: By
    """

    HTTP_CLIENT_RESPONSE_SIZE = "http.client.response.size"
    """
    Measures the size of HTTP response messages (compressed)
    Instrument: histogram
    Unit: By
    """

    PROCESS_RUNTIME_JVM_MEMORY_INIT = "process.runtime.jvm.memory.init"
    """
    Measure of initial memory requested
    Instrument: updowncounter
    Unit: By
    """

    PROCESS_RUNTIME_JVM_SYSTEM_CPU_UTILIZATION = (
        "process.runtime.jvm.system.cpu.utilization"
    )
    """
    Recent CPU utilization for the whole system as reported by the JVM
    Instrument: gauge
    Unit: 1
    """

    PROCESS_RUNTIME_JVM_SYSTEM_CPU_LOAD_1M = (
        "process.runtime.jvm.system.cpu.load_1m"
    )
    """
    Average CPU load of the whole system for the last minute as reported by the JVM
    Instrument: gauge
    Unit: 1
    """

    PROCESS_RUNTIME_JVM_BUFFER_USAGE = "process.runtime.jvm.buffer.usage"
    """
    Measure of memory used by buffers
    Instrument: updowncounter
    Unit: By
    """

    PROCESS_RUNTIME_JVM_BUFFER_LIMIT = "process.runtime.jvm.buffer.limit"
    """
    Measure of total memory capacity of buffers
    Instrument: updowncounter
    Unit: By
    """

    PROCESS_RUNTIME_JVM_BUFFER_COUNT = "process.runtime.jvm.buffer.count"
    """
    Number of buffers in the pool
    Instrument: updowncounter
    Unit: {buffer}
    """

    PROCESS_RUNTIME_JVM_MEMORY_USAGE = "process.runtime.jvm.memory.usage"
    """
    Measure of memory used
    Instrument: updowncounter
    Unit: By
    """

    PROCESS_RUNTIME_JVM_MEMORY_COMMITTED = (
        "process.runtime.jvm.memory.committed"
    )
    """
    Measure of memory committed
    Instrument: updowncounter
    Unit: By
    """

    PROCESS_RUNTIME_JVM_MEMORY_LIMIT = "process.runtime.jvm.memory.limit"
    """
    Measure of max obtainable memory
    Instrument: updowncounter
    Unit: By
    """

    PROCESS_RUNTIME_JVM_MEMORY_USAGE_AFTER_LAST_GC = (
        "process.runtime.jvm.memory.usage_after_last_gc"
    )
    """
    Measure of memory used, as measured after the most recent garbage collection event on this pool
    Instrument: updowncounter
    Unit: By
    """

    PROCESS_RUNTIME_JVM_GC_DURATION = "process.runtime.jvm.gc.duration"
    """
    Duration of JVM garbage collection actions
    Instrument: histogram
    Unit: s
    """

    PROCESS_RUNTIME_JVM_THREADS_COUNT = "process.runtime.jvm.threads.count"
    """
    Number of executing platform threads
    Instrument: updowncounter
    Unit: {thread}
    """

    PROCESS_RUNTIME_JVM_CLASSES_LOADED = "process.runtime.jvm.classes.loaded"
    """
    Number of classes loaded since JVM start
    Instrument: counter
    Unit: {class}
    """

    PROCESS_RUNTIME_JVM_CLASSES_UNLOADED = (
        "process.runtime.jvm.classes.unloaded"
    )
    """
    Number of classes unloaded since JVM start
    Instrument: counter
    Unit: {class}
    """

    PROCESS_RUNTIME_JVM_CLASSES_CURRENT_LOADED = (
        "process.runtime.jvm.classes.current_loaded"
    )
    """
    Number of classes currently loaded
    Instrument: updowncounter
    Unit: {class}
    """

    PROCESS_RUNTIME_JVM_CPU_TIME = "process.runtime.jvm.cpu.time"
    """
    CPU time used by the process as reported by the JVM
    Instrument: counter
    Unit: s
    """

    PROCESS_RUNTIME_JVM_CPU_RECENT_UTILIZATION = (
        "process.runtime.jvm.cpu.recent_utilization"
    )
    """
    Recent CPU utilization for the process as reported by the JVM
    Instrument: gauge
    Unit: 1
    """

    # Manually defined metrics

    DB_CLIENT_CONNECTIONS_USAGE = "db.client.connections.usage"
    """
    The number of connections that are currently in state described by the `state` attribute
    Instrument: UpDownCounter
    Unit: {connection}
    """
