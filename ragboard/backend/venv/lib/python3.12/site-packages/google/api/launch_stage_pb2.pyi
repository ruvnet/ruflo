# Copyright 2025 Google LLC
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

from typing import ClassVar as _ClassVar

from google.protobuf import descriptor as _descriptor
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper

DESCRIPTOR: _descriptor.FileDescriptor

class LaunchStage(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    LAUNCH_STAGE_UNSPECIFIED: _ClassVar[LaunchStage]
    UNIMPLEMENTED: _ClassVar[LaunchStage]
    PRELAUNCH: _ClassVar[LaunchStage]
    EARLY_ACCESS: _ClassVar[LaunchStage]
    ALPHA: _ClassVar[LaunchStage]
    BETA: _ClassVar[LaunchStage]
    GA: _ClassVar[LaunchStage]
    DEPRECATED: _ClassVar[LaunchStage]

LAUNCH_STAGE_UNSPECIFIED: LaunchStage
UNIMPLEMENTED: LaunchStage
PRELAUNCH: LaunchStage
EARLY_ACCESS: LaunchStage
ALPHA: LaunchStage
BETA: LaunchStage
GA: LaunchStage
DEPRECATED: LaunchStage
