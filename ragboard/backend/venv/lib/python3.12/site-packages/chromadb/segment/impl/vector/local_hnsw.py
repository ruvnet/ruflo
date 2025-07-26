from overrides import override
from typing import Optional, Sequence, Dict, Set, List, cast
from uuid import UUID
from chromadb.segment import VectorReader
from chromadb.ingest import Consumer
from chromadb.config import System, Settings
from chromadb.segment.impl.vector.batch import Batch
from chromadb.segment.impl.vector.hnsw_params import HnswParams
from chromadb.telemetry.opentelemetry import (
    OpenTelemetryClient,
    OpenTelemetryGranularity,
    trace_method,
)
from chromadb.types import (
    LogRecord,
    RequestVersionContext,
    VectorEmbeddingRecord,
    VectorQuery,
    VectorQueryResult,
    SeqId,
    Segment,
    Metadata,
    Operation,
    Vector,
)
from chromadb.errors import InvalidDimensionException
import hnswlib
from chromadb.utils.read_write_lock import ReadWriteLock, ReadRWLock, WriteRWLock
import logging
import numpy as np

logger = logging.getLogger(__name__)

DEFAULT_CAPACITY = 1000


class LocalHnswSegment(VectorReader):
    _id: UUID
    _consumer: Consumer
    _collection: Optional[UUID]
    _subscription: Optional[UUID]
    _settings: Settings
    _params: HnswParams

    _index: Optional[hnswlib.Index]
    _dimensionality: Optional[int]
    _total_elements_added: int
    _max_seq_id: SeqId

    _lock: ReadWriteLock

    _id_to_label: Dict[str, int]
    _label_to_id: Dict[int, str]
    # Note: As of the time of writing, this mapping is no longer needed.
    # We merely keep it around for easy compatibility with the old code and
    # debugging purposes.
    _id_to_seq_id: Dict[str, SeqId]

    _opentelemtry_client: OpenTelemetryClient

    def __init__(self, system: System, segment: Segment):
        self._consumer = system.instance(Consumer)
        self._id = segment["id"]
        self._collection = segment["collection"]
        self._subscription = None
        self._settings = system.settings
        self._params = HnswParams(segment["metadata"] or {})

        self._index = None
        self._dimensionality = None
        self._total_elements_added = 0
        self._max_seq_id = self._consumer.min_seqid()

        self._id_to_seq_id = {}
        self._id_to_label = {}
        self._label_to_id = {}

        self._lock = ReadWriteLock()
        self._opentelemtry_client = system.require(OpenTelemetryClient)

    @staticmethod
    @override
    def propagate_collection_metadata(metadata: Metadata) -> Optional[Metadata]:
        # Extract relevant metadata
        segment_metadata = HnswParams.extract(metadata)
        return segment_metadata

    @trace_method("LocalHnswSegment.start", OpenTelemetryGranularity.ALL)
    @override
    def start(self) -> None:
        super().start()
        if self._collection:
            seq_id = self.max_seqid()
            self._subscription = self._consumer.subscribe(
                self._collection, self._write_records, start=seq_id
            )

    @trace_method("LocalHnswSegment.stop", OpenTelemetryGranularity.ALL)
    @override
    def stop(self) -> None:
        super().stop()
        if self._subscription:
            self._consumer.unsubscribe(self._subscription)

    @trace_method("LocalHnswSegment.get_vectors", OpenTelemetryGranularity.ALL)
    @override
    def get_vectors(
        self,
        request_version_context: RequestVersionContext,
        ids: Optional[Sequence[str]] = None,
    ) -> Sequence[VectorEmbeddingRecord]:
        if ids is None:
            labels = list(self._label_to_id.keys())
        else:
            labels = []
            for id in ids:
                if id in self._id_to_label:
                    labels.append(self._id_to_label[id])

        results = []
        if self._index is not None:
            vectors = cast(
                Sequence[Vector], np.array(self._index.get_items(labels))
            )  # version 0.8 of hnswlib allows return_type="numpy"

            for label, vector in zip(labels, vectors):
                id = self._label_to_id[label]
                results.append(VectorEmbeddingRecord(id=id, embedding=vector))

        return results

    @trace_method("LocalHnswSegment.query_vectors", OpenTelemetryGranularity.ALL)
    @override
    def query_vectors(
        self, query: VectorQuery
    ) -> Sequence[Sequence[VectorQueryResult]]:
        if self._index is None:
            return [[] for _ in range(len(query["vectors"]))]

        k = query["k"]
        size = len(self._id_to_label)

        if k > size:
            logger.warning(
                f"Number of requested results {k} is greater than number of elements in index {size}, updating n_results = {size}"
            )
            k = size

        labels: Set[int] = set()
        ids = query["allowed_ids"]
        if ids is not None:
            labels = {self._id_to_label[id] for id in ids if id in self._id_to_label}
            if len(labels) < k:
                k = len(labels)

        def filter_function(label: int) -> bool:
            return label in labels

        query_vectors = query["vectors"]

        with ReadRWLock(self._lock):
            result_labels, distances = self._index.knn_query(
                np.array(query_vectors, dtype=np.float32),
                k=k,
                filter=filter_function if ids else None,
            )

            # TODO: these casts are not correct, hnswlib returns np
            # distances = cast(List[List[float]], distances)
            # result_labels = cast(List[List[int]], result_labels)

            all_results: List[List[VectorQueryResult]] = []
            for result_i in range(len(result_labels)):
                results: List[VectorQueryResult] = []
                for label, distance in zip(
                    result_labels[result_i], distances[result_i]
                ):
                    id = self._label_to_id[label]
                    if query["include_embeddings"]:
                        embedding = np.array(
                            self._index.get_items([label])[0]
                        )  # version 0.8 of hnswlib allows return_type="numpy"
                    else:
                        embedding = None
                    results.append(
                        VectorQueryResult(
                            id=id,
                            distance=distance.item(),
                            embedding=embedding,
                        )
                    )
                all_results.append(results)

            return all_results

    @override
    def max_seqid(self) -> SeqId:
        return self._max_seq_id

    @override
    def count(self, request_version_context: RequestVersionContext) -> int:
        return len(self._id_to_label)

    @trace_method("LocalHnswSegment._init_index", OpenTelemetryGranularity.ALL)
    def _init_index(self, dimensionality: int) -> None:
        # more comments available at the source: https://github.com/nmslib/hnswlib

        index = hnswlib.Index(
            space=self._params.space, dim=dimensionality
        )  # possible options are l2, cosine or ip
        index.init_index(
            max_elements=DEFAULT_CAPACITY,
            ef_construction=self._params.construction_ef,
            M=self._params.M,
        )
        index.set_ef(self._params.search_ef)
        index.set_num_threads(self._params.num_threads)

        self._index = index
        self._dimensionality = dimensionality

    @trace_method("LocalHnswSegment._ensure_index", OpenTelemetryGranularity.ALL)
    def _ensure_index(self, n: int, dim: int) -> None:
        """Create or resize the index as necessary to accomodate N new records"""
        if not self._index:
            self._dimensionality = dim
            self._init_index(dim)
        else:
            if dim != self._dimensionality:
                raise InvalidDimensionException(
                    f"Dimensionality of ({dim}) does not match index"
                    + f"dimensionality ({self._dimensionality})"
                )

        index = cast(hnswlib.Index, self._index)

        if (self._total_elements_added + n) > index.get_max_elements():
            new_size = int(
                (self._total_elements_added + n) * self._params.resize_factor
            )
            index.resize_index(max(new_size, DEFAULT_CAPACITY))

    @trace_method("LocalHnswSegment._apply_batch", OpenTelemetryGranularity.ALL)
    def _apply_batch(self, batch: Batch) -> None:
        """Apply a batch of changes, as atomically as possible."""
        deleted_ids = batch.get_deleted_ids()
        written_ids = batch.get_written_ids()
        vectors_to_write = batch.get_written_vectors(written_ids)
        labels_to_write = [0] * len(vectors_to_write)

        if len(deleted_ids) > 0:
            index = cast(hnswlib.Index, self._index)
            for i in range(len(deleted_ids)):
                id = deleted_ids[i]
                # Never added this id to hnsw, so we can safely ignore it for deletions
                if id not in self._id_to_label:
                    continue
                label = self._id_to_label[id]

                index.mark_deleted(label)
                del self._id_to_label[id]
                del self._label_to_id[label]
                del self._id_to_seq_id[id]

        if len(written_ids) > 0:
            self._ensure_index(batch.add_count, len(vectors_to_write[0]))

            next_label = self._total_elements_added + 1
            for i in range(len(written_ids)):
                if written_ids[i] not in self._id_to_label:
                    labels_to_write[i] = next_label
                    next_label += 1
                else:
                    labels_to_write[i] = self._id_to_label[written_ids[i]]

            index = cast(hnswlib.Index, self._index)

            # First, update the index
            index.add_items(vectors_to_write, labels_to_write)

            # If that succeeds, update the mappings
            for i, id in enumerate(written_ids):
                self._id_to_seq_id[id] = batch.get_record(id)["log_offset"]
                self._id_to_label[id] = labels_to_write[i]
                self._label_to_id[labels_to_write[i]] = id

            # If that succeeds, update the total count
            self._total_elements_added += batch.add_count

    @trace_method("LocalHnswSegment._write_records", OpenTelemetryGranularity.ALL)
    def _write_records(self, records: Sequence[LogRecord]) -> None:
        """Add a batch of embeddings to the index"""
        if not self._running:
            raise RuntimeError("Cannot add embeddings to stopped component")

        # Avoid all sorts of potential problems by ensuring single-threaded access
        with WriteRWLock(self._lock):
            batch = Batch()

            for record in records:
                self._max_seq_id = max(self._max_seq_id, record["log_offset"])
                id = record["record"]["id"]
                op = record["record"]["operation"]
                label = self._id_to_label.get(id, None)

                if op == Operation.DELETE:
                    if label:
                        batch.apply(record)
                    else:
                        logger.warning(f"Delete of nonexisting embedding ID: {id}")

                elif op == Operation.UPDATE:
                    if record["record"]["embedding"] is not None:
                        if label is not None:
                            batch.apply(record)
                        else:
                            logger.warning(
                                f"Update of nonexisting embedding ID: {record['record']['id']}"
                            )
                elif op == Operation.ADD:
                    if not label:
                        batch.apply(record, False)
                    else:
                        logger.warning(f"Add of existing embedding ID: {id}")
                elif op == Operation.UPSERT:
                    batch.apply(record, label is not None)

            self._apply_batch(batch)

    @override
    def delete(self) -> None:
        raise NotImplementedError()
