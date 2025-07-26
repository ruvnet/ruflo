from threading import Lock
from typing import Dict, List, Sequence
from uuid import UUID, uuid4

from overrides import override

from chromadb.config import System
from chromadb.db.system import SysDB
from chromadb.segment import (
    SegmentImplementation,
    SegmentManager,
    SegmentType,
)
from chromadb.segment.distributed import SegmentDirectory
from chromadb.segment.impl.vector.hnsw_params import PersistentHnswParams
from chromadb.telemetry.opentelemetry import (
    OpenTelemetryGranularity,
    trace_method,
)
from chromadb.types import (
    Collection,
    Operation,
    Segment,
    SegmentScope,
)


class DistributedSegmentManager(SegmentManager):
    _sysdb: SysDB
    _system: System
    _instances: Dict[UUID, SegmentImplementation]
    _segment_directory: SegmentDirectory
    _lock: Lock

    def __init__(self, system: System):
        super().__init__(system)
        self._sysdb = self.require(SysDB)
        self._segment_directory = self.require(SegmentDirectory)
        self._system = system
        self._instances = {}
        self._lock = Lock()

    @trace_method(
        "DistributedSegmentManager.prepare_segments_for_new_collection",
        OpenTelemetryGranularity.OPERATION_AND_SEGMENT,
    )
    @override
    def prepare_segments_for_new_collection(
        self, collection: Collection
    ) -> Sequence[Segment]:
        vector_segment = Segment(
            id=uuid4(),
            type=SegmentType.HNSW_DISTRIBUTED.value,
            scope=SegmentScope.VECTOR,
            collection=collection.id,
            metadata=PersistentHnswParams.extract(collection.metadata)
            if collection.metadata
            else None,
            file_paths={},
        )
        metadata_segment = Segment(
            id=uuid4(),
            type=SegmentType.BLOCKFILE_METADATA.value,
            scope=SegmentScope.METADATA,
            collection=collection.id,
            metadata=None,
            file_paths={},
        )
        record_segment = Segment(
            id=uuid4(),
            type=SegmentType.BLOCKFILE_RECORD.value,
            scope=SegmentScope.RECORD,
            collection=collection.id,
            metadata=None,
            file_paths={},
        )
        return [vector_segment, record_segment, metadata_segment]

    @override
    def delete_segments(self, collection_id: UUID) -> Sequence[UUID]:
        # delete_collection deletes segments in distributed mode
        return []

    @trace_method(
        "DistributedSegmentManager.get_endpoint",
        OpenTelemetryGranularity.OPERATION_AND_SEGMENT,
    )
    def get_endpoints(self, segment: Segment, n: int) -> List[str]:
        return self._segment_directory.get_segment_endpoints(segment, n)

    @trace_method(
        "DistributedSegmentManager.hint_use_collection",
        OpenTelemetryGranularity.OPERATION_AND_SEGMENT,
    )
    @override
    def hint_use_collection(self, collection_id: UUID, hint_type: Operation) -> None:
        pass
