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

from typing_extensions import deprecated

MESSAGE_COMPRESSED_SIZE: Final = "message.compressed_size"
"""
Deprecated: Replaced by `rpc.message.compressed_size`.
"""

MESSAGE_ID: Final = "message.id"
"""
Deprecated: Replaced by `rpc.message.id`.
"""

MESSAGE_TYPE: Final = "message.type"
"""
Deprecated: Replaced by `rpc.message.type`.
"""

MESSAGE_UNCOMPRESSED_SIZE: Final = "message.uncompressed_size"
"""
Deprecated: Replaced by `rpc.message.uncompressed_size`.
"""


@deprecated(
    "The attribute message.type is deprecated - Replaced by `rpc.message.type`"
)
class MessageTypeValues(Enum):
    SENT = "SENT"
    """sent."""
    RECEIVED = "RECEIVED"
    """received."""
