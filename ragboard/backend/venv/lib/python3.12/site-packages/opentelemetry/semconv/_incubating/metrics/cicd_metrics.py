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

from opentelemetry.metrics import Counter, Histogram, Meter, UpDownCounter

CICD_PIPELINE_RUN_ACTIVE: Final = "cicd.pipeline.run.active"
"""
The number of pipeline runs currently active in the system by state
Instrument: updowncounter
Unit: {run}
"""


def create_cicd_pipeline_run_active(meter: Meter) -> UpDownCounter:
    """The number of pipeline runs currently active in the system by state"""
    return meter.create_up_down_counter(
        name=CICD_PIPELINE_RUN_ACTIVE,
        description="The number of pipeline runs currently active in the system by state.",
        unit="{run}",
    )


CICD_PIPELINE_RUN_DURATION: Final = "cicd.pipeline.run.duration"
"""
Duration of a pipeline run grouped by pipeline, state and result
Instrument: histogram
Unit: s
"""


def create_cicd_pipeline_run_duration(meter: Meter) -> Histogram:
    """Duration of a pipeline run grouped by pipeline, state and result"""
    return meter.create_histogram(
        name=CICD_PIPELINE_RUN_DURATION,
        description="Duration of a pipeline run grouped by pipeline, state and result.",
        unit="s",
    )


CICD_PIPELINE_RUN_ERRORS: Final = "cicd.pipeline.run.errors"
"""
The number of errors encountered in pipeline runs (eg. compile, test failures)
Instrument: counter
Unit: {error}
Note: There might be errors in a pipeline run that are non fatal (eg. they are suppressed) or in a parallel stage multiple stages could have a fatal error.
This means that this error count might not be the same as the count of metric `cicd.pipeline.run.duration` with run result `failure`.
"""


def create_cicd_pipeline_run_errors(meter: Meter) -> Counter:
    """The number of errors encountered in pipeline runs (eg. compile, test failures)"""
    return meter.create_counter(
        name=CICD_PIPELINE_RUN_ERRORS,
        description="The number of errors encountered in pipeline runs (eg. compile, test failures).",
        unit="{error}",
    )


CICD_SYSTEM_ERRORS: Final = "cicd.system.errors"
"""
The number of errors in a component of the CICD system (eg. controller, scheduler, agent)
Instrument: counter
Unit: {error}
Note: Errors in pipeline run execution are explicitly excluded. Ie a test failure is not counted in this metric.
"""


def create_cicd_system_errors(meter: Meter) -> Counter:
    """The number of errors in a component of the CICD system (eg. controller, scheduler, agent)"""
    return meter.create_counter(
        name=CICD_SYSTEM_ERRORS,
        description="The number of errors in a component of the CICD system (eg. controller, scheduler, agent).",
        unit="{error}",
    )


CICD_WORKER_COUNT: Final = "cicd.worker.count"
"""
The number of workers on the CICD system by state
Instrument: updowncounter
Unit: {count}
"""


def create_cicd_worker_count(meter: Meter) -> UpDownCounter:
    """The number of workers on the CICD system by state"""
    return meter.create_up_down_counter(
        name=CICD_WORKER_COUNT,
        description="The number of workers on the CICD system by state.",
        unit="{count}",
    )
