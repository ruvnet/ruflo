from abc import abstractmethod
from dataclasses import dataclass
from typing import Any, Callable, List

from overrides import EnforceOverrides, overrides
from chromadb.config import Component, System
from chromadb.types import Segment


class SegmentDirectory(Component):
    """A segment directory is a data interface that manages the location of segments. Concretely, this
    means that for distributed chroma, it provides the grpc endpoint for a segment."""

    @abstractmethod
    def get_segment_endpoints(self, segment: Segment, n: int) -> List[str]:
        """Return the segment residences for a given segment ID. Will return at most n residences.
        Should only return less than n residences if there are less than n residences available.
        """

    @abstractmethod
    def register_updated_segment_callback(
        self, callback: Callable[[Segment], None]
    ) -> None:
        """Register a callback that will be called when a segment is updated"""
        pass


@dataclass
class Member:
    id: str
    ip: str
    node: str


Memberlist = List[Member]


class MemberlistProvider(Component, EnforceOverrides):
    """Returns the latest memberlist and provdes a callback for when it changes. This
    callback may be called from a different thread than the one that called. Callers should ensure
    that they are thread-safe."""

    callbacks: List[Callable[[Memberlist], Any]]

    def __init__(self, system: System):
        self.callbacks = []
        super().__init__(system)

    @abstractmethod
    def get_memberlist(self) -> Memberlist:
        """Returns the latest memberlist"""
        pass

    @abstractmethod
    def set_memberlist_name(self, memberlist: str) -> None:
        """Sets the memberlist that this provider will watch"""
        pass

    @overrides
    def stop(self) -> None:
        """Stops watching the memberlist"""
        self.callbacks = []

    def register_updated_memberlist_callback(
        self, callback: Callable[[Memberlist], Any]
    ) -> None:
        """Registers a callback that will be called when the memberlist changes. May be called many times
        with the same memberlist, so callers should be idempotent. May be called from a different thread.
        """
        self.callbacks.append(callback)

    def unregister_updated_memberlist_callback(
        self, callback: Callable[[Memberlist], Any]
    ) -> bool:
        """Unregisters a callback that was previously registered. Returns True if the callback was
        successfully unregistered, False if it was not ever registered."""
        if callback in self.callbacks:
            self.callbacks.remove(callback)
            return True
        return False
