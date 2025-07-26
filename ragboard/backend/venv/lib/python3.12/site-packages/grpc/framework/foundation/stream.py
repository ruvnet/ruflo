# Copyright 2015 gRPC authors.
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
"""Interfaces related to streams of values or objects."""

import abc


class Consumer(abc.ABC):
    """Interface for consumers of finite streams of values or objects."""

    @abc.abstractmethod
    def consume(self, value):
        """Accepts a value.

        Args:
          value: Any value accepted by this Consumer.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def terminate(self):
        """Indicates to this Consumer that no more values will be supplied."""
        raise NotImplementedError()

    @abc.abstractmethod
    def consume_and_terminate(self, value):
        """Supplies a value and signals that no more values will be supplied.

        Args:
          value: Any value accepted by this Consumer.
        """
        raise NotImplementedError()
