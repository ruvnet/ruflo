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

OTEL_LOGS_EXPORTER = "OTEL_LOGS_EXPORTER"
"""
.. envvar:: OTEL_LOGS_EXPORTER

"""

OTEL_METRICS_EXPORTER = "OTEL_METRICS_EXPORTER"
"""
.. envvar:: OTEL_METRICS_EXPORTER

Specifies which exporter is used for metrics. See `General SDK Configuration
<https://opentelemetry.io/docs/concepts/sdk-configuration/general-sdk-configuration/#otel_metrics_exporter>`_.

**Default value:** ``"otlp"``

**Example:**

``export OTEL_METRICS_EXPORTER="prometheus"``

Accepted values for ``OTEL_METRICS_EXPORTER`` are:

- ``"otlp"``
- ``"prometheus"``
- ``"none"``: No automatically configured exporter for metrics.

.. note::

    Exporter packages may add entry points for group ``opentelemetry_metrics_exporter`` which
    can then be used with this environment variable by name. The entry point should point to
    either a `opentelemetry.sdk.metrics.export.MetricExporter` (push exporter) or
    `opentelemetry.sdk.metrics.export.MetricReader` (pull exporter) subclass; it must be
    constructable without any required arguments. This mechanism is considered experimental and
    may change in subsequent releases.
"""

OTEL_PROPAGATORS = "OTEL_PROPAGATORS"
"""
.. envvar:: OTEL_PROPAGATORS
"""

OTEL_PYTHON_CONTEXT = "OTEL_PYTHON_CONTEXT"
"""
.. envvar:: OTEL_PYTHON_CONTEXT
"""

OTEL_PYTHON_ID_GENERATOR = "OTEL_PYTHON_ID_GENERATOR"
"""
.. envvar:: OTEL_PYTHON_ID_GENERATOR
"""

OTEL_TRACES_EXPORTER = "OTEL_TRACES_EXPORTER"
"""
.. envvar:: OTEL_TRACES_EXPORTER
"""

OTEL_PYTHON_TRACER_PROVIDER = "OTEL_PYTHON_TRACER_PROVIDER"
"""
.. envvar:: OTEL_PYTHON_TRACER_PROVIDER
"""

OTEL_PYTHON_METER_PROVIDER = "OTEL_PYTHON_METER_PROVIDER"
"""
.. envvar:: OTEL_PYTHON_METER_PROVIDER
"""

_OTEL_PYTHON_LOGGER_PROVIDER = "OTEL_PYTHON_LOGGER_PROVIDER"
"""
.. envvar:: OTEL_PYTHON_LOGGER_PROVIDER
"""

_OTEL_PYTHON_EVENT_LOGGER_PROVIDER = "OTEL_PYTHON_EVENT_LOGGER_PROVIDER"
"""
.. envvar:: OTEL_PYTHON_EVENT_LOGGER_PROVIDER
"""
