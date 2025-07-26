from abc import abstractmethod
from typing import Callable, Optional, Sequence
from chromadb.types import (
    OperationRecord,
    LogRecord,
    SeqId,
    Vector,
    ScalarEncoding,
)
from chromadb.config import Component
from uuid import UUID
import numpy as np


def encode_vector(vector: Vector, encoding: ScalarEncoding) -> bytes:
    """Encode a vector into a byte array."""

    if encoding == ScalarEncoding.FLOAT32:
        return np.array(vector, dtype=np.float32).tobytes()
    elif encoding == ScalarEncoding.INT32:
        return np.array(vector, dtype=np.int32).tobytes()
    else:
        raise ValueError(f"Unsupported encoding: {encoding.value}")


def decode_vector(vector: bytes, encoding: ScalarEncoding) -> Vector:
    """Decode a byte array into a vector"""

    if encoding == ScalarEncoding.FLOAT32:
        return np.frombuffer(vector, dtype=np.float32)
    elif encoding == ScalarEncoding.INT32:
        return np.frombuffer(vector, dtype=np.float32)
    else:
        raise ValueError(f"Unsupported encoding: {encoding.value}")


class Producer(Component):
    """Interface for writing embeddings to an ingest stream"""

    @abstractmethod
    def delete_log(self, collection_id: UUID) -> None:
        pass

    @abstractmethod
    def purge_log(self, collection_id: UUID) -> None:
        """Truncates the log for the given collection, removing all seen records."""
        pass

    @abstractmethod
    def submit_embedding(
        self, collection_id: UUID, embedding: OperationRecord
    ) -> SeqId:
        """Add an embedding record to the given collections log. Returns the SeqID of the record."""
        pass

    @abstractmethod
    def submit_embeddings(
        self, collection_id: UUID, embeddings: Sequence[OperationRecord]
    ) -> Sequence[SeqId]:
        """Add a batch of embedding records to the given collections log. Returns the SeqIDs of
        the records. The returned SeqIDs will be in the same order as the given
        SubmitEmbeddingRecords. However, it is not guaranteed that the SeqIDs will be
        processed in the same order as the given SubmitEmbeddingRecords. If the number
        of records exceeds the maximum batch size, an exception will be thrown."""
        pass

    @property
    @abstractmethod
    def max_batch_size(self) -> int:
        """Return the maximum number of records that can be submitted in a single call
        to submit_embeddings."""
        pass


ConsumerCallbackFn = Callable[[Sequence[LogRecord]], None]


class Consumer(Component):
    """Interface for reading embeddings off an ingest stream"""

    @abstractmethod
    def subscribe(
        self,
        collection_id: UUID,
        consume_fn: ConsumerCallbackFn,
        start: Optional[SeqId] = None,
        end: Optional[SeqId] = None,
        id: Optional[UUID] = None,
    ) -> UUID:
        """Register a function that will be called to receive embeddings for a given
        collections log stream. The given function may be called any number of times, with any number of
        records, and may be called concurrently.

        Only records between start (exclusive) and end (inclusive) SeqIDs will be
        returned. If start is None, the first record returned will be the next record
        generated, not including those generated before creating the subscription. If
        end is None, the consumer will consume indefinitely, otherwise it will
        automatically be unsubscribed when the end SeqID is reached.

        If the function throws an exception, the function may be called again with the
        same or different records.

        Takes an optional UUID as a unique subscription ID. If no ID is provided, a new
        ID will be generated and returned."""
        pass

    @abstractmethod
    def unsubscribe(self, subscription_id: UUID) -> None:
        """Unregister a subscription. The consume function will no longer be invoked,
        and resources associated with the subscription will be released."""
        pass

    @abstractmethod
    def min_seqid(self) -> SeqId:
        """Return the minimum possible SeqID in this implementation."""
        pass

    @abstractmethod
    def max_seqid(self) -> SeqId:
        """Return the maximum possible SeqID in this implementation."""
        pass
