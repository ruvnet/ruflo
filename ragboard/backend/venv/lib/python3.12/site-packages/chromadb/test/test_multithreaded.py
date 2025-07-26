import multiprocessing
from concurrent.futures import Future, ThreadPoolExecutor, wait
import random
import threading
from typing import Any, Dict, List, Optional, Set, Tuple, cast
import numpy as np

from chromadb.api import ClientAPI
import chromadb.test.property.invariants as invariants
from chromadb.api.segment import SegmentAPI
from chromadb.test.property.strategies import RecordSet
from chromadb.test.property.strategies import test_hnsw_config
from chromadb.types import Metadata


def generate_data_shape() -> Tuple[int, int]:
    N = random.randint(10, 10000)
    D = random.randint(10, 256)
    return (N, D)


def generate_record_set(N: int, D: int) -> RecordSet:
    ids = [str(i) for i in range(N)]
    metadatas: List[Dict[str, int]] = [{f"{i}": i} for i in range(N)]
    documents = [f"doc {i}" for i in range(N)]
    embeddings = np.random.rand(N, D).tolist()

    # Create a normalized record set to compare against
    normalized_record_set: RecordSet = {
        "ids": ids,
        "embeddings": embeddings,  # type: ignore
        "metadatas": metadatas,  # type: ignore
        "documents": documents,
    }

    return normalized_record_set


# Hypothesis is bad at generating large datasets so we manually generate data in
# this test to test multithreaded add with larger datasets
def _test_multithreaded_add(
    client: ClientAPI, N: int, D: int, num_workers: int
) -> None:
    records_set = generate_record_set(N, D)
    ids = records_set["ids"]
    embeddings = records_set["embeddings"]
    metadatas = records_set["metadatas"]
    documents = records_set["documents"]

    print(f"Adding {N} records with {D} dimensions on {num_workers} workers")

    # TODO: batch_size and sync_threshold should be configurable
    client.reset()
    coll = client.create_collection(name="test", metadata=test_hnsw_config)
    with ThreadPoolExecutor(max_workers=num_workers) as executor:
        futures: List[Future[Any]] = []
        total_sent = -1
        while total_sent < len(ids):
            # Randomly grab up to 10% of the dataset and send it to the executor
            batch_size = random.randint(1, N // 10)
            to_send = min(batch_size, len(ids) - total_sent)
            start = total_sent + 1
            end = total_sent + to_send + 1
            if embeddings is not None and len(embeddings[start:end]) == 0:
                break
            future = executor.submit(
                coll.add,
                ids=ids[start:end],
                embeddings=embeddings[start:end] if embeddings is not None else None,
                metadatas=metadatas[start:end] if metadatas is not None else None,  # type: ignore
                documents=documents[start:end] if documents is not None else None,
            )
            futures.append(future)
            total_sent += to_send

    wait(futures)

    for future in futures:
        exception = future.exception()
        if exception is not None:
            raise exception

    # Check that invariants hold
    invariants.count(coll, records_set)
    invariants.ids_match(coll, records_set)
    invariants.metadatas_match(coll, records_set)
    invariants.no_duplicates(coll)

    # Check that the ANN accuracy is good
    # On a random subset of the dataset
    query_indices = random.sample([i for i in range(N)], 10)
    n_results = 5
    invariants.ann_accuracy(
        coll,
        records_set,
        n_results=n_results,
        query_indices=query_indices,
    )


def _test_interleaved_add_query(
    client: ClientAPI, N: int, D: int, num_workers: int
) -> None:
    """Test that will use multiple threads to interleave operations on the db and verify they work correctly"""

    client.reset()
    coll = client.create_collection(name="test", metadata=test_hnsw_config)

    records_set = generate_record_set(N, D)
    ids = cast(List[str], records_set["ids"])
    embeddings = cast(List[float], records_set["embeddings"])
    metadatas = cast(List[Metadata], records_set["metadatas"])
    documents = records_set["documents"]

    added_ids: Set[str] = set()
    lock = threading.Lock()

    print(f"Adding {N} records with {D} dimensions on {num_workers} workers")

    def perform_operation(
        operation: int, ids_to_modify: Optional[List[str]] = None
    ) -> None:
        """Perform a random operation on the collection"""
        if operation == 0:
            assert ids_to_modify is not None
            indices_to_modify = [ids.index(id) for id in ids_to_modify]
            # Add a subset of the dataset
            if len(indices_to_modify) == 0:
                return
            coll.add(
                ids=ids_to_modify,
                embeddings=[embeddings[i] for i in indices_to_modify]
                if embeddings is not None
                else None,
                metadatas=[metadatas[i] for i in indices_to_modify]
                if metadatas is not None
                else None,
                documents=[documents[i] for i in indices_to_modify]
                if documents is not None
                else None,
            )
            with lock:
                added_ids.update(ids_to_modify)
        elif operation == 1:
            currently_added_ids = []
            n_results = 5
            with lock:
                currently_added_ids = list(added_ids.copy())
            currently_added_indices = [ids.index(id) for id in currently_added_ids]
            if (
                len(currently_added_ids) == 0
                or len(currently_added_indices) < n_results
            ):
                return
            # Query the collection, we can't test the results because we want to interleave
            # queries and adds. We cannot do so without a lock and serializing the operations
            # which would defeat the purpose of this test. Instead we interleave queries and
            # adds and check the invariants at the end
            query_indices = random.sample(
                currently_added_indices,
                min(10, len(currently_added_indices)),
            )
            query_vectors = [embeddings[i] for i in query_indices]
            # Query the collections
            coll.query(
                query_vectors,
                n_results=n_results,
            )

    with ThreadPoolExecutor(max_workers=num_workers) as executor:
        futures: List[Future[Any]] = []
        total_sent = -1
        while total_sent < len(ids) - 1:
            operation = random.randint(0, 2)
            if operation == 0:
                # Randomly grab up to 10% of the dataset and send it to the executor
                batch_size = random.randint(1, N // 10)
                to_send = min(batch_size, len(ids) - total_sent)
                start = total_sent + 1
                end = total_sent + to_send + 1
                future = executor.submit(perform_operation, operation, ids[start:end])
                futures.append(future)
                total_sent += to_send
            elif operation == 1:
                future = executor.submit(
                    perform_operation,
                    operation,
                )
                futures.append(future)

    wait(futures)

    for future in futures:
        exception = future.exception()
        if exception is not None:
            raise exception
    if (
        isinstance(client, SegmentAPI) and client.get_settings().is_persistent is True
    ):  # we can't check invariants for FastAPI
        invariants.fd_not_exceeding_threadpool_size(num_workers)
    # Check that invariants hold
    invariants.count(coll, records_set)
    invariants.ids_match(coll, records_set)
    invariants.metadatas_match(coll, records_set)
    invariants.no_duplicates(coll)
    # Check that the ANN accuracy is good
    # On a random subset of the dataset
    query_indices = random.sample([i for i in range(N)], 10)
    n_results = 5
    invariants.ann_accuracy(
        coll,
        records_set,
        n_results=n_results,
        query_indices=query_indices,
    )


def test_multithreaded_add(client: ClientAPI) -> None:
    for i in range(3):
        num_workers = random.randint(2, multiprocessing.cpu_count() * 2)
        N, D = generate_data_shape()
        _test_multithreaded_add(client, N, D, num_workers)


def test_interleaved_add_query(client: ClientAPI) -> None:
    for i in range(3):
        num_workers = random.randint(2, multiprocessing.cpu_count() * 2)
        N, D = generate_data_shape()
        _test_interleaved_add_query(client, N, D, num_workers)
