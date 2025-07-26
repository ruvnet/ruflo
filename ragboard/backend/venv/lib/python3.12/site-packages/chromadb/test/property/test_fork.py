import chromadb
import chromadb.test.property.invariants as invariants
import chromadb.test.property.strategies as strategies
import copy
import hypothesis.strategies as hyst
import logging
import pytest

from chromadb.api.models.Collection import Collection
from chromadb.test.conftest import reset, skip_if_not_cluster
from chromadb.test.utils.wait_for_version_increase import wait_for_version_increase
from hypothesis.stateful import (
    Bundle,
    RuleBasedStateMachine,
    rule,
    initialize,
    multiple,
    consumes,
    run_state_machine_as_test,
    MultipleResults,
)
from overrides import overrides
from typing import Dict, cast, Union, Tuple, Set

collection_st = hyst.shared(strategies.collections(with_hnsw_params=True), key="source")


class ForkStateMachine(RuleBasedStateMachine):
    updated_collections: Bundle[
        Tuple[Collection, strategies.StateMachineRecordSet]
    ] = Bundle("changing_collections")
    forked_collections: Bundle[
        Tuple[Collection, strategies.StateMachineRecordSet]
    ] = Bundle("collections")
    collection_names: Set[str]

    def __init__(self, client: chromadb.api.ClientAPI):
        super().__init__()
        self.client = client
        self.collection_names = set()

    @initialize(collection=collection_st, target=updated_collections)
    def initialize(
        self, collection: strategies.Collection
    ) -> Tuple[Collection, strategies.StateMachineRecordSet]:
        source = self.client.create_collection(
            name=collection.name,
            metadata=collection.metadata,  # type: ignore[arg-type]
            embedding_function=collection.embedding_function,
        )
        self.collection_names.add(source.name)
        return source, strategies.StateMachineRecordSet(
            ids=[], metadatas=[], documents=[], embeddings=[]
        )

    @overrides
    def teardown(self) -> None:
        reset(self.client)

    @rule(
        source=consumes(updated_collections),
        new_name=strategies.collection_name(),
        target=forked_collections,
    )
    def fork(
        self, source: Tuple[Collection, strategies.StateMachineRecordSet], new_name: str
    ) -> MultipleResults[Tuple[Collection, strategies.StateMachineRecordSet]]:
        collection, record_set = source
        if new_name in self.collection_names:
            with pytest.raises(Exception):
                collection.fork(new_name)
            return multiple(source)

        target = collection.fork(new_name)
        self.collection_names.add(target.name)
        return multiple(source, (target, copy.deepcopy(record_set)))

    @rule(
        cursor=consumes(forked_collections),
        delta=strategies.recordsets(collection_st),
        target=updated_collections,
    )
    def upsert(
        self,
        cursor: Tuple[Collection, strategies.StateMachineRecordSet],
        delta: strategies.RecordSet,
    ) -> Tuple[Collection, strategies.StateMachineRecordSet]:
        collection, record_set_state = cursor
        normalized_delta: strategies.NormalizedRecordSet = invariants.wrap_all(delta)
        collection.upsert(**normalized_delta)  # type: ignore[arg-type]
        for idx, id in enumerate(normalized_delta["ids"]):
            if id in record_set_state["ids"]:
                target_idx = record_set_state["ids"].index(id)
                if normalized_delta["embeddings"] is not None:
                    record_set_state["embeddings"][target_idx] = normalized_delta[
                        "embeddings"
                    ][idx]
                else:
                    assert normalized_delta["documents"] is not None
                    assert collection._embedding_function is not None
                    record_set_state["embeddings"][
                        target_idx
                    ] = collection._embedding_function(
                        [normalized_delta["documents"][idx]]
                    )[
                        0
                    ]
                if normalized_delta["metadatas"] is not None:
                    record_set_state_metadata = cast(
                        Dict[str, Union[str, int, float]],
                        record_set_state["metadatas"][target_idx],
                    )
                    if record_set_state_metadata is not None:
                        if normalized_delta["metadatas"][idx] is not None:
                            record_set_state_metadata.update(
                                normalized_delta["metadatas"][idx]  # type: ignore[arg-type]
                            )
                    else:
                        record_set_state["metadatas"][target_idx] = normalized_delta[
                            "metadatas"
                        ][idx]
                if normalized_delta["documents"] is not None:
                    record_set_state["documents"][target_idx] = normalized_delta[
                        "documents"
                    ][idx]
            else:
                record_set_state["ids"].append(id)
                if normalized_delta["embeddings"] is not None:
                    record_set_state["embeddings"].append(
                        normalized_delta["embeddings"][idx]
                    )
                else:
                    assert collection._embedding_function is not None
                    assert normalized_delta["documents"] is not None
                    record_set_state["embeddings"].append(
                        collection._embedding_function(
                            [normalized_delta["documents"][idx]]
                        )[0]
                    )
                if normalized_delta["metadatas"] is not None:
                    record_set_state["metadatas"].append(
                        normalized_delta["metadatas"][idx]
                    )
                else:
                    record_set_state["metadatas"].append(None)
                if normalized_delta["documents"] is not None:
                    record_set_state["documents"].append(
                        normalized_delta["documents"][idx]
                    )
                else:
                    record_set_state["documents"].append(None)
        return collection, record_set_state

    @rule(
        cursor=consumes(forked_collections),
        target=updated_collections,
    )
    def delete(
        self, cursor: Tuple[Collection, strategies.StateMachineRecordSet]
    ) -> Tuple[Collection, strategies.StateMachineRecordSet]:
        collection, record_set_state = cursor
        boundary = len(record_set_state["ids"]) // 10
        if boundary == 0:
            return collection, record_set_state
        ids_to_delete = record_set_state["ids"][:boundary]
        collection.delete(ids_to_delete)
        record_set_state["ids"] = record_set_state["ids"][boundary:]
        record_set_state["embeddings"] = record_set_state["embeddings"][boundary:]
        record_set_state["metadatas"] = record_set_state["metadatas"][boundary:]
        record_set_state["documents"] = record_set_state["documents"][boundary:]
        return collection, record_set_state

    @rule(
        cursor=forked_collections,
    )
    def verify(
        self, cursor: Tuple[Collection, strategies.StateMachineRecordSet]
    ) -> None:
        collection, record_set_state = cursor
        if len(record_set_state["ids"]) == 0:
            assert collection.count() == 0
        else:
            record_set = cast(strategies.RecordSet, record_set_state)
            invariants.embeddings_match(collection, record_set)
            invariants.metadatas_match(collection, record_set)
            invariants.documents_match(collection, record_set)


@skip_if_not_cluster()
def test_fork(caplog: pytest.LogCaptureFixture, client: chromadb.api.ClientAPI) -> None:
    caplog.set_level(logging.ERROR)
    run_state_machine_as_test(lambda: ForkStateMachine(client))  # type: ignore


@skip_if_not_cluster()
def test_fork_with_log_migration(
    caplog: pytest.LogCaptureFixture, client: chromadb.api.ClientAPI
) -> None:
    import grpc
    from chromadb.proto.logservice_pb2 import SealLogRequest
    from chromadb.proto.logservice_pb2_grpc import LogServiceStub
    from chromadb.proto.coordinator_pb2_grpc import SysDBStub

    caplog.set_level(logging.ERROR)
    client.reset()
    channel = grpc.insecure_channel("localhost:50052")
    go_log_service = LogServiceStub(channel)  # type: ignore[no-untyped-call]

    channel = grpc.insecure_channel("localhost:50051")
    sysdb_service = SysDBStub(channel)  # type: ignore[no-untyped-call]

    NUMBER = 100

    collection = client.create_collection("legacy-go-collection-0")
    ids = sorted([f"id_{i}" for i in range(NUMBER)])
    collection.add(ids=ids, embeddings=[[i, i] for i in range(NUMBER)])  # type: ignore[arg-type]
    go_log_service.SealLog(SealLogRequest(collection_id=collection.id.hex))
    fork_collection = collection.fork("fork-legacy-go-collection-0")
    assert sorted(fork_collection.get()["ids"]) == ids

    collection = client.create_collection("legacy-go-collection-1")
    go_log_service.SealLog(SealLogRequest(collection_id=collection.id.hex))
    ids = sorted([f"id_{i}" for i in range(NUMBER)])
    collection.add(ids=ids, embeddings=[[i, i] for i in range(NUMBER)])  # type: ignore[arg-type]
    fork_collection = collection.fork("fork-legacy-go-collection-1")
    wait_for_version_increase(client, fork_collection.name, 0)
    assert sorted(fork_collection.get()["ids"]) == ids

    collection = client.create_collection("legacy-go-collection-2")
    for i in range(NUMBER):
        collection.add(ids=[f"id_{i}"], embeddings=[[i, i]])
    wait_for_version_increase(client, collection.name, 0)
    go_log_service.SealLog(SealLogRequest(collection_id=collection.id.hex))
    collection.add(ids=[f"id_{NUMBER}"], embeddings=[[NUMBER, NUMBER]])
    fork_collection = collection.fork("fork-legacy-go-collection-2")
    ids = sorted([f"id_{i}" for i in range(NUMBER + 1)])
    assert sorted(fork_collection.get()["ids"]) == ids
