from typing import Any, Callable, Dict, List, Optional, Sequence, Set
import numpy as np
import numpy.typing as npt
from chromadb.types import (
    LogRecord,
    VectorEmbeddingRecord,
    VectorQuery,
    VectorQueryResult,
)

from chromadb.utils import distance_functions
import logging

logger = logging.getLogger(__name__)


class BruteForceIndex:
    """A lightweight, numpy based brute force index that is used for batches that have not been indexed into hnsw yet. It is not
    thread safe and callers should ensure that only one thread is accessing it at a time.
    """

    id_to_index: Dict[str, int]
    index_to_id: Dict[int, str]
    id_to_seq_id: Dict[str, int]
    deleted_ids: Set[str]
    free_indices: List[int]
    size: int
    dimensionality: int
    distance_fn: Callable[[npt.NDArray[Any], npt.NDArray[Any]], float]
    vectors: npt.NDArray[Any]

    def __init__(self, size: int, dimensionality: int, space: str = "l2"):
        if space == "l2":
            self.distance_fn = distance_functions.l2
        elif space == "ip":
            self.distance_fn = distance_functions.ip
        elif space == "cosine":
            self.distance_fn = distance_functions.cosine
        else:
            raise Exception(f"Unknown distance function: {space}")

        self.id_to_index = {}
        self.index_to_id = {}
        self.id_to_seq_id = {}
        self.deleted_ids = set()
        self.free_indices = list(range(size))
        self.size = size
        self.dimensionality = dimensionality
        self.vectors = np.zeros((size, dimensionality))

    def __len__(self) -> int:
        return len(self.id_to_index)

    def clear(self) -> None:
        self.id_to_index = {}
        self.index_to_id = {}
        self.id_to_seq_id = {}
        self.deleted_ids.clear()
        self.free_indices = list(range(self.size))
        self.vectors.fill(0)

    def upsert(self, records: List[LogRecord]) -> None:
        if len(records) + len(self) > self.size:
            raise Exception(
                "Index with capacity {} and {} current entries cannot add {} records".format(
                    self.size, len(self), len(records)
                )
            )

        for i, record in enumerate(records):
            id = record["record"]["id"]
            vector = record["record"]["embedding"]
            self.id_to_seq_id[id] = record["log_offset"]
            if id in self.deleted_ids:
                self.deleted_ids.remove(id)

            # TODO: It may be faster to use multi-index selection on the vectors array
            if id in self.id_to_index:
                # Update
                index = self.id_to_index[id]
                self.vectors[index] = vector
            else:
                # Add
                next_index = self.free_indices.pop()
                self.id_to_index[id] = next_index
                self.index_to_id[next_index] = id
                self.vectors[next_index] = vector

    def delete(self, records: List[LogRecord]) -> None:
        for record in records:
            id = record["record"]["id"]
            if id in self.id_to_index:
                index = self.id_to_index[id]
                self.deleted_ids.add(id)
                del self.id_to_index[id]
                del self.index_to_id[index]
                del self.id_to_seq_id[id]
                self.vectors[index].fill(np.nan)
                self.free_indices.append(index)
            else:
                logger.warning(f"Delete of nonexisting embedding ID: {id}")

    def has_id(self, id: str) -> bool:
        """Returns whether the index contains the given ID"""
        return id in self.id_to_index and id not in self.deleted_ids

    def get_vectors(
        self, ids: Optional[Sequence[str]] = None
    ) -> Sequence[VectorEmbeddingRecord]:
        target_ids = ids or self.id_to_index.keys()

        return [
            VectorEmbeddingRecord(
                id=id,
                embedding=self.vectors[self.id_to_index[id]],
            )
            for id in target_ids
        ]

    def query(self, query: VectorQuery) -> Sequence[Sequence[VectorQueryResult]]:
        np_query = np.array(query["vectors"], dtype=np.float32)
        allowed_ids = (
            None if query["allowed_ids"] is None else set(query["allowed_ids"])
        )
        distances = np.apply_along_axis(
            lambda query: np.apply_along_axis(self.distance_fn, 1, self.vectors, query),
            1,
            np_query,
        )

        indices = np.argsort(distances)
        # Filter out deleted labels
        filtered_results = []
        for i, index_list in enumerate(indices):
            curr_results = []
            for j in index_list:
                # If the index is in the index_to_id map, then it has been added
                if j in self.index_to_id:
                    id = self.index_to_id[j]
                    if id not in self.deleted_ids and (
                        allowed_ids is None or id in allowed_ids
                    ):
                        curr_results.append(
                            VectorQueryResult(
                                id=id,
                                distance=distances[i][j].item(),
                                embedding=self.vectors[j],
                            )
                        )
            filtered_results.append(curr_results)
        return filtered_results
