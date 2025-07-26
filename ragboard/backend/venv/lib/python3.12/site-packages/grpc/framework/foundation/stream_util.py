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
"""Helpful utilities related to the stream module."""

import logging
import threading

from grpc.framework.foundation import stream

_NO_VALUE = object()
_LOGGER = logging.getLogger(__name__)


class TransformingConsumer(stream.Consumer):
    """A stream.Consumer that passes a transformation of its input to another."""

    def __init__(self, transformation, downstream):
        self._transformation = transformation
        self._downstream = downstream

    def consume(self, value):
        self._downstream.consume(self._transformation(value))

    def terminate(self):
        self._downstream.terminate()

    def consume_and_terminate(self, value):
        self._downstream.consume_and_terminate(self._transformation(value))


class IterableConsumer(stream.Consumer):
    """A Consumer that when iterated over emits the values it has consumed."""

    def __init__(self):
        self._condition = threading.Condition()
        self._values = []
        self._active = True

    def consume(self, value):
        with self._condition:
            if self._active:
                self._values.append(value)
                self._condition.notify()

    def terminate(self):
        with self._condition:
            self._active = False
            self._condition.notify()

    def consume_and_terminate(self, value):
        with self._condition:
            if self._active:
                self._values.append(value)
                self._active = False
                self._condition.notify()

    def __iter__(self):
        return self

    def __next__(self):
        return self.next()

    def next(self):
        with self._condition:
            while self._active and not self._values:
                self._condition.wait()
            if self._values:
                return self._values.pop(0)
            else:
                raise StopIteration()


class ThreadSwitchingConsumer(stream.Consumer):
    """A Consumer decorator that affords serialization and asynchrony."""

    def __init__(self, sink, pool):
        self._lock = threading.Lock()
        self._sink = sink
        self._pool = pool
        # True if self._spin has been submitted to the pool to be called once and
        # that call has not yet returned, False otherwise.
        self._spinning = False
        self._values = []
        self._active = True

    def _spin(self, sink, value, terminate):
        while True:
            try:
                if value is _NO_VALUE:
                    sink.terminate()
                elif terminate:
                    sink.consume_and_terminate(value)
                else:
                    sink.consume(value)
            except Exception as e:  # pylint:disable=broad-except
                _LOGGER.exception(e)

            with self._lock:
                if terminate:
                    self._spinning = False
                    return
                elif self._values:
                    value = self._values.pop(0)
                    terminate = not self._values and not self._active
                elif not self._active:
                    value = _NO_VALUE
                    terminate = True
                else:
                    self._spinning = False
                    return

    def consume(self, value):
        with self._lock:
            if self._active:
                if self._spinning:
                    self._values.append(value)
                else:
                    self._pool.submit(self._spin, self._sink, value, False)
                    self._spinning = True

    def terminate(self):
        with self._lock:
            if self._active:
                self._active = False
                if not self._spinning:
                    self._pool.submit(self._spin, self._sink, _NO_VALUE, True)
                    self._spinning = True

    def consume_and_terminate(self, value):
        with self._lock:
            if self._active:
                self._active = False
                if self._spinning:
                    self._values.append(value)
                else:
                    self._pool.submit(self._spin, self._sink, value, True)
                    self._spinning = True
