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

CASSANDRA_CONSISTENCY_LEVEL: Final = "cassandra.consistency.level"
"""
The consistency level of the query. Based on consistency values from [CQL](https://docs.datastax.com/en/cassandra-oss/3.0/cassandra/dml/dmlConfigConsistency.html).
"""

CASSANDRA_COORDINATOR_DC: Final = "cassandra.coordinator.dc"
"""
The data center of the coordinating node for a query.
"""

CASSANDRA_COORDINATOR_ID: Final = "cassandra.coordinator.id"
"""
The ID of the coordinating node for a query.
"""

CASSANDRA_PAGE_SIZE: Final = "cassandra.page.size"
"""
The fetch size used for paging, i.e. how many rows will be returned at once.
"""

CASSANDRA_QUERY_IDEMPOTENT: Final = "cassandra.query.idempotent"
"""
Whether or not the query is idempotent.
"""

CASSANDRA_SPECULATIVE_EXECUTION_COUNT: Final = (
    "cassandra.speculative_execution.count"
)
"""
The number of times a query was speculatively executed. Not set or `0` if the query was not executed speculatively.
"""


class CassandraConsistencyLevelValues(Enum):
    ALL = "all"
    """all."""
    EACH_QUORUM = "each_quorum"
    """each_quorum."""
    QUORUM = "quorum"
    """quorum."""
    LOCAL_QUORUM = "local_quorum"
    """local_quorum."""
    ONE = "one"
    """one."""
    TWO = "two"
    """two."""
    THREE = "three"
    """three."""
    LOCAL_ONE = "local_one"
    """local_one."""
    ANY = "any"
    """any."""
    SERIAL = "serial"
    """serial."""
    LOCAL_SERIAL = "local_serial"
    """local_serial."""
