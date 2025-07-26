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
"""A thread pool that logs exceptions raised by tasks executed within it."""

from concurrent import futures
import logging

_LOGGER = logging.getLogger(__name__)


def _wrap(behavior):
    """Wraps an arbitrary callable behavior in exception-logging."""

    def _wrapping(*args, **kwargs):
        try:
            return behavior(*args, **kwargs)
        except Exception:
            _LOGGER.exception(
                "Unexpected exception from %s executed in logging pool!",
                behavior,
            )
            raise

    return _wrapping


class _LoggingPool(object):
    """An exception-logging futures.ThreadPoolExecutor-compatible thread pool."""

    def __init__(self, backing_pool):
        self._backing_pool = backing_pool

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self._backing_pool.shutdown(wait=True)

    def submit(self, fn, *args, **kwargs):
        return self._backing_pool.submit(_wrap(fn), *args, **kwargs)

    def map(self, func, *iterables, **kwargs):
        return self._backing_pool.map(
            _wrap(func), *iterables, timeout=kwargs.get("timeout", None)
        )

    def shutdown(self, wait=True):
        self._backing_pool.shutdown(wait=wait)


def pool(max_workers):
    """Creates a thread pool that logs exceptions raised by the tasks within it.

    Args:
      max_workers: The maximum number of worker threads to allow the pool.

    Returns:
      A futures.ThreadPoolExecutor-compatible thread pool that logs exceptions
        raised by the tasks executed within it.
    """
    return _LoggingPool(futures.ThreadPoolExecutor(max_workers))
