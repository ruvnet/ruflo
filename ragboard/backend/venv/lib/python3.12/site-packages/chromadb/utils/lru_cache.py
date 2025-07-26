from collections import OrderedDict
from typing import Any, Callable, Generic, Optional, TypeVar


K = TypeVar("K")
V = TypeVar("V")


class LRUCache(Generic[K, V]):
    """A simple LRU cache implementation, based on the OrderedDict class, which allows
    for a callback to be invoked when an item is evicted from the cache."""

    def __init__(self, capacity: int, callback: Optional[Callable[[K, V], Any]] = None):
        self.capacity = capacity
        self.cache: OrderedDict[K, V] = OrderedDict()
        self.callback = callback

    def get(self, key: K) -> Optional[V]:
        if key not in self.cache:
            return None
        value = self.cache.pop(key)
        self.cache[key] = value
        return value

    def set(self, key: K, value: V) -> None:
        if key in self.cache:
            self.cache.pop(key)
        elif len(self.cache) == self.capacity:
            evicted_key, evicted_value = self.cache.popitem(last=False)
            if self.callback:
                self.callback(evicted_key, evicted_value)
        self.cache[key] = value
