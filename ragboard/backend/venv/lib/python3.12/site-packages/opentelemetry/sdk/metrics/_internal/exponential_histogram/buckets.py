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

from math import ceil, log2


class Buckets:
    # No method of this class is protected by locks because instances of this
    # class are only used in methods that are protected by locks themselves.

    def __init__(self):
        self._counts = [0]

        # The term index refers to the number of the exponential histogram bucket
        # used to determine its boundaries. The lower boundary of a bucket is
        # determined by base ** index and the upper boundary of a bucket is
        # determined by base ** (index + 1). index values are signedto account
        # for values less than or equal to 1.

        # self._index_* will all have values equal to a certain index that is
        # determined by the corresponding mapping _map_to_index function and
        # the value of the index depends on the value passed to _map_to_index.

        # Index of the 0th position in self._counts: self._counts[0] is the
        # count in the bucket with index self.__index_base.
        self.__index_base = 0

        # self.__index_start is the smallest index value represented in
        # self._counts.
        self.__index_start = 0

        # self.__index_start is the largest index value represented in
        # self._counts.
        self.__index_end = 0

    @property
    def index_start(self) -> int:
        return self.__index_start

    @index_start.setter
    def index_start(self, value: int) -> None:
        self.__index_start = value

    @property
    def index_end(self) -> int:
        return self.__index_end

    @index_end.setter
    def index_end(self, value: int) -> None:
        self.__index_end = value

    @property
    def index_base(self) -> int:
        return self.__index_base

    @index_base.setter
    def index_base(self, value: int) -> None:
        self.__index_base = value

    @property
    def counts(self):
        return self._counts

    def get_offset_counts(self):
        bias = self.__index_base - self.__index_start
        return self._counts[-bias:] + self._counts[:-bias]

    def grow(self, needed: int, max_size: int) -> None:
        size = len(self._counts)
        bias = self.__index_base - self.__index_start
        old_positive_limit = size - bias

        # 2 ** ceil(log2(needed)) finds the smallest power of two that is larger
        # or equal than needed:
        # 2 ** ceil(log2(1)) == 1
        # 2 ** ceil(log2(2)) == 2
        # 2 ** ceil(log2(3)) == 4
        # 2 ** ceil(log2(4)) == 4
        # 2 ** ceil(log2(5)) == 8
        # 2 ** ceil(log2(6)) == 8
        # 2 ** ceil(log2(7)) == 8
        # 2 ** ceil(log2(8)) == 8
        new_size = min(2 ** ceil(log2(needed)), max_size)

        new_positive_limit = new_size - bias

        tmp = [0] * new_size
        tmp[new_positive_limit:] = self._counts[old_positive_limit:]
        tmp[0:old_positive_limit] = self._counts[0:old_positive_limit]
        self._counts = tmp

    @property
    def offset(self) -> int:
        return self.__index_start

    def __len__(self) -> int:
        if len(self._counts) == 0:
            return 0

        if self.__index_end == self.__index_start and self[0] == 0:
            return 0

        return self.__index_end - self.__index_start + 1

    def __getitem__(self, key: int) -> int:
        bias = self.__index_base - self.__index_start

        if key < bias:
            key += len(self._counts)

        key -= bias

        return self._counts[key]

    def downscale(self, amount: int) -> None:
        """
        Rotates, then collapses 2 ** amount to 1 buckets.
        """

        bias = self.__index_base - self.__index_start

        if bias != 0:
            self.__index_base = self.__index_start

            # [0, 1, 2, 3, 4] Original backing array

            self._counts = self._counts[::-1]
            # [4, 3, 2, 1, 0]

            self._counts = (
                self._counts[:bias][::-1] + self._counts[bias:][::-1]
            )
            # [3, 4, 0, 1, 2] This is a rotation of the backing array.

        size = 1 + self.__index_end - self.__index_start
        each = 1 << amount
        inpos = 0
        outpos = 0

        pos = self.__index_start

        while pos <= self.__index_end:
            mod = pos % each
            if mod < 0:
                mod += each

            index = mod

            while index < each and inpos < size:
                if outpos != inpos:
                    self._counts[outpos] += self._counts[inpos]
                    self._counts[inpos] = 0

                inpos += 1
                pos += 1
                index += 1

            outpos += 1

        self.__index_start >>= amount
        self.__index_end >>= amount
        self.__index_base = self.__index_start

    def increment_bucket(self, bucket_index: int, increment: int = 1) -> None:
        self._counts[bucket_index] += increment

    def copy_empty(self) -> "Buckets":
        copy = Buckets()

        # pylint: disable=no-member
        # pylint: disable=protected-access
        # pylint: disable=attribute-defined-outside-init
        # pylint: disable=invalid-name
        copy._Buckets__index_base = self._Buckets__index_base
        copy._Buckets__index_start = self._Buckets__index_start
        copy._Buckets__index_end = self._Buckets__index_end
        copy._counts = [0 for _ in self._counts]

        return copy
