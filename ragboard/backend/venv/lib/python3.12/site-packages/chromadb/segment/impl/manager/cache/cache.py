import threading
import uuid
from typing import Any, Callable
from chromadb.types import Segment
from overrides import override
from typing import Dict, Optional
from abc import ABC, abstractmethod


class SegmentCache(ABC):
    @abstractmethod
    def get(self, key: uuid.UUID) -> Optional[Segment]:
        pass

    @abstractmethod
    def pop(self, key: uuid.UUID) -> Optional[Segment]:
        pass

    @abstractmethod
    def set(self, key: uuid.UUID, value: Segment) -> None:
        pass

    @abstractmethod
    def reset(self) -> None:
        pass


class BasicCache(SegmentCache):
    def __init__(self):
        self.cache: Dict[uuid.UUID, Segment] = {}
        self.lock = threading.RLock()

    @override
    def get(self, key: uuid.UUID) -> Optional[Segment]:
        with self.lock:
            return self.cache.get(key)

    @override
    def pop(self, key: uuid.UUID) -> Optional[Segment]:
        with self.lock:
            return self.cache.pop(key, None)

    @override
    def set(self, key: uuid.UUID, value: Segment) -> None:
        with self.lock:
            self.cache[key] = value

    @override
    def reset(self) -> None:
        with self.lock:
            self.cache = {}


class SegmentLRUCache(BasicCache):
    """A simple LRU cache implementation that handles objects with dynamic sizes.
    The size of each object is determined by a user-provided size function."""

    def __init__(
        self,
        capacity: int,
        size_func: Callable[[uuid.UUID], int],
        callback: Optional[Callable[[uuid.UUID, Segment], Any]] = None,
    ):
        self.capacity = capacity
        self.size_func = size_func
        self.cache: Dict[uuid.UUID, Segment] = {}
        self.history = []
        self.callback = callback
        self.lock = threading.RLock()

    def _upsert_key(self, key: uuid.UUID):
        if key in self.history:
            self.history.remove(key)
            self.history.append(key)
        else:
            self.history.append(key)

    @override
    def get(self, key: uuid.UUID) -> Optional[Segment]:
        with self.lock:
            self._upsert_key(key)
            if key in self.cache:
                return self.cache[key]
            else:
                return None

    @override
    def pop(self, key: uuid.UUID) -> Optional[Segment]:
        with self.lock:
            if key in self.history:
                self.history.remove(key)
            return self.cache.pop(key, None)

    @override
    def set(self, key: uuid.UUID, value: Segment) -> None:
        with self.lock:
            if key in self.cache:
                return
            item_size = self.size_func(key)
            key_sizes = {key: self.size_func(key) for key in self.cache}
            total_size = sum(key_sizes.values())
            index = 0
            # Evict items if capacity is exceeded
            while total_size + item_size > self.capacity and len(self.history) > index:
                key_delete = self.history[index]
                if key_delete in self.cache:
                    self.callback(key_delete, self.cache[key_delete])
                    del self.cache[key_delete]
                    total_size -= key_sizes[key_delete]
                index += 1

            self.cache[key] = value
            self._upsert_key(key)

    @override
    def reset(self):
        with self.lock:
            self.cache = {}
            self.history = []
