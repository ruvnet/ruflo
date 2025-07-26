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
from typing import Iterable as _Iterable
from typing import Mapping as _Mapping
from typing import Optional as _Optional
from typing import Union as _Union

from google.protobuf import any_pb2 as _any_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers

DESCRIPTOR: _descriptor.FileDescriptor

class Distribution(_message.Message):
    __slots__ = (
        "count",
        "mean",
        "sum_of_squared_deviation",
        "range",
        "bucket_options",
        "bucket_counts",
        "exemplars",
    )

    class Range(_message.Message):
        __slots__ = ("min", "max")
        MIN_FIELD_NUMBER: _ClassVar[int]
        MAX_FIELD_NUMBER: _ClassVar[int]
        min: float
        max: float
        def __init__(
            self, min: _Optional[float] = ..., max: _Optional[float] = ...
        ) -> None: ...

    class BucketOptions(_message.Message):
        __slots__ = ("linear_buckets", "exponential_buckets", "explicit_buckets")

        class Linear(_message.Message):
            __slots__ = ("num_finite_buckets", "width", "offset")
            NUM_FINITE_BUCKETS_FIELD_NUMBER: _ClassVar[int]
            WIDTH_FIELD_NUMBER: _ClassVar[int]
            OFFSET_FIELD_NUMBER: _ClassVar[int]
            num_finite_buckets: int
            width: float
            offset: float
            def __init__(
                self,
                num_finite_buckets: _Optional[int] = ...,
                width: _Optional[float] = ...,
                offset: _Optional[float] = ...,
            ) -> None: ...

        class Exponential(_message.Message):
            __slots__ = ("num_finite_buckets", "growth_factor", "scale")
            NUM_FINITE_BUCKETS_FIELD_NUMBER: _ClassVar[int]
            GROWTH_FACTOR_FIELD_NUMBER: _ClassVar[int]
            SCALE_FIELD_NUMBER: _ClassVar[int]
            num_finite_buckets: int
            growth_factor: float
            scale: float
            def __init__(
                self,
                num_finite_buckets: _Optional[int] = ...,
                growth_factor: _Optional[float] = ...,
                scale: _Optional[float] = ...,
            ) -> None: ...

        class Explicit(_message.Message):
            __slots__ = ("bounds",)
            BOUNDS_FIELD_NUMBER: _ClassVar[int]
            bounds: _containers.RepeatedScalarFieldContainer[float]
            def __init__(self, bounds: _Optional[_Iterable[float]] = ...) -> None: ...
        LINEAR_BUCKETS_FIELD_NUMBER: _ClassVar[int]
        EXPONENTIAL_BUCKETS_FIELD_NUMBER: _ClassVar[int]
        EXPLICIT_BUCKETS_FIELD_NUMBER: _ClassVar[int]
        linear_buckets: Distribution.BucketOptions.Linear
        exponential_buckets: Distribution.BucketOptions.Exponential
        explicit_buckets: Distribution.BucketOptions.Explicit
        def __init__(
            self,
            linear_buckets: _Optional[
                _Union[Distribution.BucketOptions.Linear, _Mapping]
            ] = ...,
            exponential_buckets: _Optional[
                _Union[Distribution.BucketOptions.Exponential, _Mapping]
            ] = ...,
            explicit_buckets: _Optional[
                _Union[Distribution.BucketOptions.Explicit, _Mapping]
            ] = ...,
        ) -> None: ...

    class Exemplar(_message.Message):
        __slots__ = ("value", "timestamp", "attachments")
        VALUE_FIELD_NUMBER: _ClassVar[int]
        TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
        ATTACHMENTS_FIELD_NUMBER: _ClassVar[int]
        value: float
        timestamp: _timestamp_pb2.Timestamp
        attachments: _containers.RepeatedCompositeFieldContainer[_any_pb2.Any]
        def __init__(
            self,
            value: _Optional[float] = ...,
            timestamp: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...,
            attachments: _Optional[_Iterable[_Union[_any_pb2.Any, _Mapping]]] = ...,
        ) -> None: ...
    COUNT_FIELD_NUMBER: _ClassVar[int]
    MEAN_FIELD_NUMBER: _ClassVar[int]
    SUM_OF_SQUARED_DEVIATION_FIELD_NUMBER: _ClassVar[int]
    RANGE_FIELD_NUMBER: _ClassVar[int]
    BUCKET_OPTIONS_FIELD_NUMBER: _ClassVar[int]
    BUCKET_COUNTS_FIELD_NUMBER: _ClassVar[int]
    EXEMPLARS_FIELD_NUMBER: _ClassVar[int]
    count: int
    mean: float
    sum_of_squared_deviation: float
    range: Distribution.Range
    bucket_options: Distribution.BucketOptions
    bucket_counts: _containers.RepeatedScalarFieldContainer[int]
    exemplars: _containers.RepeatedCompositeFieldContainer[Distribution.Exemplar]
    def __init__(
        self,
        count: _Optional[int] = ...,
        mean: _Optional[float] = ...,
        sum_of_squared_deviation: _Optional[float] = ...,
        range: _Optional[_Union[Distribution.Range, _Mapping]] = ...,
        bucket_options: _Optional[_Union[Distribution.BucketOptions, _Mapping]] = ...,
        bucket_counts: _Optional[_Iterable[int]] = ...,
        exemplars: _Optional[_Iterable[_Union[Distribution.Exemplar, _Mapping]]] = ...,
    ) -> None: ...
