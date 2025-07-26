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

from typing import (
    Iterable,
    Iterator,
    Mapping,
    MutableMapping,
    Sequence,
    TypeVar,
    overload,
)

from opentelemetry.util.types import AttributesAsKey, AttributeValue

_T = TypeVar("_T")
_KT = TypeVar("_KT")
_VT = TypeVar("_VT")

def ns_to_iso_str(nanoseconds: int) -> str: ...
def get_dict_as_key(
    labels: Mapping[str, AttributeValue],
) -> AttributesAsKey: ...

# pylint: disable=no-self-use
class BoundedList(Sequence[_T]):
    """An append only list with a fixed max size.

    Calls to `append` and `extend` will drop the oldest elements if there is
    not enough room.
    """

    dropped: int
    def __init__(self, maxlen: int): ...
    def insert(self, index: int, value: _T) -> None: ...
    @overload
    def __getitem__(self, i: int) -> _T: ...
    @overload
    def __getitem__(self, s: slice) -> Sequence[_T]: ...
    def __len__(self) -> int: ...
    def append(self, item: _T) -> None: ...
    def extend(self, seq: Sequence[_T]) -> None: ...
    @classmethod
    def from_seq(cls, maxlen: int, seq: Iterable[_T]) -> BoundedList[_T]: ...  # pylint: disable=undefined-variable

class BoundedDict(MutableMapping[_KT, _VT]):
    """An ordered dict with a fixed max capacity.

    Oldest elements are dropped when the dict is full and a new element is
    added.
    """

    dropped: int
    def __init__(self, maxlen: int): ...
    def __getitem__(self, k: _KT) -> _VT: ...
    def __setitem__(self, k: _KT, v: _VT) -> None: ...
    def __delitem__(self, v: _KT) -> None: ...
    def __iter__(self) -> Iterator[_KT]: ...
    def __len__(self) -> int: ...
    @classmethod
    def from_map(
        cls, maxlen: int, mapping: Mapping[_KT, _VT]
    ) -> BoundedDict[_KT, _VT]: ...  # pylint: disable=undefined-variable
