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

from opentelemetry.metrics import Counter, Meter

CPYTHON_GC_COLLECTED_OBJECTS: Final = "cpython.gc.collected_objects"
"""
The total number of objects collected inside a generation since interpreter start
Instrument: counter
Unit: {object}
Note: This metric reports data from [`gc.stats()`](https://docs.python.org/3/library/gc.html#gc.get_stats).
"""


def create_cpython_gc_collected_objects(meter: Meter) -> Counter:
    """The total number of objects collected inside a generation since interpreter start"""
    return meter.create_counter(
        name=CPYTHON_GC_COLLECTED_OBJECTS,
        description="The total number of objects collected inside a generation since interpreter start.",
        unit="{object}",
    )


CPYTHON_GC_COLLECTIONS: Final = "cpython.gc.collections"
"""
The number of times a generation was collected since interpreter start
Instrument: counter
Unit: {collection}
Note: This metric reports data from [`gc.stats()`](https://docs.python.org/3/library/gc.html#gc.get_stats).
"""


def create_cpython_gc_collections(meter: Meter) -> Counter:
    """The number of times a generation was collected since interpreter start"""
    return meter.create_counter(
        name=CPYTHON_GC_COLLECTIONS,
        description="The number of times a generation was collected since interpreter start.",
        unit="{collection}",
    )


CPYTHON_GC_UNCOLLECTABLE_OBJECTS: Final = "cpython.gc.uncollectable_objects"
"""
The total number of objects which were found to be uncollectable inside a generation since interpreter start
Instrument: counter
Unit: {object}
Note: This metric reports data from [`gc.stats()`](https://docs.python.org/3/library/gc.html#gc.get_stats).
"""


def create_cpython_gc_uncollectable_objects(meter: Meter) -> Counter:
    """The total number of objects which were found to be uncollectable inside a generation since interpreter start"""
    return meter.create_counter(
        name=CPYTHON_GC_UNCOLLECTABLE_OBJECTS,
        description="The total number of objects which were found to be uncollectable inside a generation since interpreter start.",
        unit="{object}",
    )
