from threading import Lock
from chromadb.segment import (
    SegmentImplementation,
    SegmentManager,
    MetadataReader,
    SegmentType,
    VectorReader,
    S,
)
import logging
from chromadb.segment.impl.manager.cache.cache import (
    SegmentLRUCache,
    BasicCache,
    SegmentCache,
)
import os

from chromadb.config import System, get_class
from chromadb.db.system import SysDB
from overrides import override
from chromadb.segment.impl.vector.local_persistent_hnsw import (
    PersistentLocalHnswSegment,
)
from chromadb.telemetry.opentelemetry import (
    OpenTelemetryClient,
    OpenTelemetryGranularity,
    trace_method,
)
from chromadb.types import Collection, Operation, Segment, SegmentScope, Metadata
from typing import Dict, Type, Sequence, Optional, cast
from uuid import UUID, uuid4
import platform

from chromadb.utils.lru_cache import LRUCache
from chromadb.utils.directory import get_directory_size


if platform.system() != "Windows":
    import resource
elif platform.system() == "Windows":
    import ctypes

SEGMENT_TYPE_IMPLS = {
    SegmentType.SQLITE: "chromadb.segment.impl.metadata.sqlite.SqliteMetadataSegment",
    SegmentType.HNSW_LOCAL_MEMORY: "chromadb.segment.impl.vector.local_hnsw.LocalHnswSegment",
    SegmentType.HNSW_LOCAL_PERSISTED: "chromadb.segment.impl.vector.local_persistent_hnsw.PersistentLocalHnswSegment",
}


class LocalSegmentManager(SegmentManager):
    _sysdb: SysDB
    _system: System
    _opentelemetry_client: OpenTelemetryClient
    _instances: Dict[UUID, SegmentImplementation]
    _vector_instances_file_handle_cache: LRUCache[
        UUID, PersistentLocalHnswSegment
    ]  # LRU cache to manage file handles across vector segment instances
    _vector_segment_type: SegmentType = SegmentType.HNSW_LOCAL_MEMORY
    _lock: Lock
    _max_file_handles: int

    def __init__(self, system: System):
        super().__init__(system)
        self._sysdb = self.require(SysDB)
        self._system = system
        self._opentelemetry_client = system.require(OpenTelemetryClient)
        self.logger = logging.getLogger(__name__)
        self._instances = {}
        self.segment_cache: Dict[SegmentScope, SegmentCache] = {
            SegmentScope.METADATA: BasicCache()  # type: ignore[no-untyped-call]
        }
        if (
            system.settings.chroma_segment_cache_policy == "LRU"
            and system.settings.chroma_memory_limit_bytes > 0
        ):
            self.segment_cache[SegmentScope.VECTOR] = SegmentLRUCache(
                capacity=system.settings.chroma_memory_limit_bytes,
                callback=lambda k, v: self.callback_cache_evict(v),
                size_func=lambda k: self._get_segment_disk_size(k),
            )
        else:
            self.segment_cache[SegmentScope.VECTOR] = BasicCache()  # type: ignore[no-untyped-call]

        self._lock = Lock()

        # TODO: prototyping with distributed segment for now, but this should be a configurable option
        # we need to think about how to handle this configuration
        if self._system.settings.require("is_persistent"):
            self._vector_segment_type = SegmentType.HNSW_LOCAL_PERSISTED
            if platform.system() != "Windows":
                self._max_file_handles = resource.getrlimit(resource.RLIMIT_NOFILE)[0]
            else:
                self._max_file_handles = ctypes.windll.msvcrt._getmaxstdio()  # type: ignore
            segment_limit = (
                self._max_file_handles
                # This is integer division in Python 3, and not a comment.
                // PersistentLocalHnswSegment.get_file_handle_count()
            )
            self._vector_instances_file_handle_cache = LRUCache(
                segment_limit, callback=lambda _, v: v.close_persistent_index()
            )

    @trace_method(
        "LocalSegmentManager.callback_cache_evict",
        OpenTelemetryGranularity.OPERATION_AND_SEGMENT,
    )
    def callback_cache_evict(self, segment: Segment) -> None:
        collection_id = segment["collection"]
        self.logger.info(f"LRU cache evict collection {collection_id}")
        instance = self._instance(segment)
        instance.stop()
        del self._instances[segment["id"]]

    @override
    def start(self) -> None:
        for instance in self._instances.values():
            instance.start()
        super().start()

    @override
    def stop(self) -> None:
        for instance in self._instances.values():
            instance.stop()
        super().stop()

    @override
    def reset_state(self) -> None:
        for instance in self._instances.values():
            instance.stop()
            instance.reset_state()
        self._instances = {}
        self.segment_cache[SegmentScope.VECTOR].reset()
        super().reset_state()

    @trace_method(
        "LocalSegmentManager.prepare_segments_for_new_collection",
        OpenTelemetryGranularity.OPERATION_AND_SEGMENT,
    )
    @override
    def prepare_segments_for_new_collection(
        self, collection: Collection
    ) -> Sequence[Segment]:
        vector_segment = _segment(
            self._vector_segment_type, SegmentScope.VECTOR, collection
        )
        metadata_segment = _segment(
            SegmentType.SQLITE, SegmentScope.METADATA, collection
        )
        return [vector_segment, metadata_segment]

    @trace_method(
        "LocalSegmentManager.delete_segments",
        OpenTelemetryGranularity.OPERATION_AND_SEGMENT,
    )
    @override
    def delete_segments(self, collection_id: UUID) -> Sequence[UUID]:
        segments = self._sysdb.get_segments(collection=collection_id)
        for segment in segments:
            if segment["id"] in self._instances:
                if segment["type"] == SegmentType.HNSW_LOCAL_PERSISTED.value:
                    instance = self.get_segment(collection_id, VectorReader)
                    instance.delete()
                elif segment["type"] == SegmentType.SQLITE.value:
                    instance = self.get_segment(collection_id, MetadataReader)  # type: ignore[assignment]
                    instance.delete()
                del self._instances[segment["id"]]
            if segment["scope"] is SegmentScope.VECTOR:
                self.segment_cache[SegmentScope.VECTOR].pop(collection_id)
            if segment["scope"] is SegmentScope.METADATA:
                self.segment_cache[SegmentScope.METADATA].pop(collection_id)
        return [s["id"] for s in segments]

    def _get_segment_disk_size(self, collection_id: UUID) -> int:
        segments = self._sysdb.get_segments(
            collection=collection_id, scope=SegmentScope.VECTOR
        )
        if len(segments) == 0:
            return 0
        # With local segment manager (single server chroma), a collection always have one segment.
        size = get_directory_size(
            os.path.join(
                self._system.settings.require("persist_directory"),
                str(segments[0]["id"]),
            )
        )
        return size

    @trace_method(
        "LocalSegmentManager._get_segment_sysdb",
        OpenTelemetryGranularity.OPERATION_AND_SEGMENT,
    )
    def _get_segment_sysdb(self, collection_id: UUID, scope: SegmentScope) -> Segment:
        segments = self._sysdb.get_segments(collection=collection_id, scope=scope)
        known_types = set([k.value for k in SEGMENT_TYPE_IMPLS.keys()])
        # Get the first segment of a known type
        segment = next(filter(lambda s: s["type"] in known_types, segments))
        return segment

    @trace_method(
        "LocalSegmentManager.get_segment",
        OpenTelemetryGranularity.OPERATION_AND_SEGMENT,
    )
    def get_segment(self, collection_id: UUID, type: Type[S]) -> S:
        if type == MetadataReader:
            scope = SegmentScope.METADATA
        elif type == VectorReader:
            scope = SegmentScope.VECTOR
        else:
            raise ValueError(f"Invalid segment type: {type}")

        segment = self.segment_cache[scope].get(collection_id)
        if segment is None:
            segment = self._get_segment_sysdb(collection_id, scope)
            self.segment_cache[scope].set(collection_id, segment)

        # Instances must be atomically created, so we use a lock to ensure that only one thread
        # creates the instance.
        with self._lock:
            instance = self._instance(segment)
        return cast(S, instance)

    @trace_method(
        "LocalSegmentManager.hint_use_collection",
        OpenTelemetryGranularity.OPERATION_AND_SEGMENT,
    )
    @override
    def hint_use_collection(self, collection_id: UUID, hint_type: Operation) -> None:
        # The local segment manager responds to hints by pre-loading both the metadata and vector
        # segments for the given collection.
        for type in [MetadataReader, VectorReader]:
            # Just use get_segment to load the segment into the cache
            instance = self.get_segment(collection_id, type)
            # If the segment is a vector segment, we need to keep segments in an LRU cache
            # to avoid hitting the OS file handle limit.
            if type == VectorReader and self._system.settings.require("is_persistent"):
                instance = cast(PersistentLocalHnswSegment, instance)
                instance.open_persistent_index()
                self._vector_instances_file_handle_cache.set(collection_id, instance)

    def _cls(self, segment: Segment) -> Type[SegmentImplementation]:
        classname = SEGMENT_TYPE_IMPLS[SegmentType(segment["type"])]
        cls = get_class(classname, SegmentImplementation)
        return cls

    def _instance(self, segment: Segment) -> SegmentImplementation:
        if segment["id"] not in self._instances:
            cls = self._cls(segment)
            instance = cls(self._system, segment)
            instance.start()
            self._instances[segment["id"]] = instance
        return self._instances[segment["id"]]


def _segment(type: SegmentType, scope: SegmentScope, collection: Collection) -> Segment:
    """Create a metadata dict, propagating metadata correctly for the given segment type."""
    cls = get_class(SEGMENT_TYPE_IMPLS[type], SegmentImplementation)
    collection_metadata = collection.metadata
    metadata: Optional[Metadata] = None
    if collection_metadata:
        metadata = cls.propagate_collection_metadata(collection_metadata)

    return Segment(
        id=uuid4(),
        type=type.value,
        scope=scope,
        collection=collection.id,
        metadata=metadata,
        file_paths={},
    )
