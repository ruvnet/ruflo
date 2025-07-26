import hypothesis.stateful
import hypothesis.strategies
from overrides import overrides
import pytest
import logging
import hypothesis
import hypothesis.strategies as st
from hypothesis import given, settings, HealthCheck
from typing import Dict, Set, cast, Union, DefaultDict, Any, List
from dataclasses import dataclass
from chromadb.api.types import (
    ID,
    Embeddings,
    Include,
    IDs,
    validate_embeddings,
    normalize_embeddings,
)
from chromadb.config import System
import chromadb.errors as errors
from chromadb.api import ClientAPI
from chromadb.api.models.Collection import Collection
import chromadb.test.property.strategies as strategies
from hypothesis.stateful import (
    Bundle,
    RuleBasedStateMachine,
    MultipleResults,
    rule,
    initialize,
    precondition,
    consumes,
    run_state_machine_as_test,
    multiple,
    invariant,
)
from collections import defaultdict
import chromadb.test.property.invariants as invariants
from chromadb.test.conftest import (
    is_client_in_process,
    NOT_CLUSTER_ONLY,
    create_isolated_database,
)
import numpy as np
import uuid
from chromadb.test.utils.wait_for_version_increase import (
    wait_for_version_increase,
    get_collection_version,
)


traces: DefaultDict[str, int] = defaultdict(lambda: 0)


VERSION_INCREASE_WAIT_TIME = 300


def trace(key: str) -> None:
    global traces
    traces[key] += 1


def print_traces() -> None:
    global traces
    for key, value in traces.items():
        print(f"{key}: {value}")


dtype_shared_st: st.SearchStrategy[
    Union[np.float16, np.float32, np.float64]
] = st.shared(st.sampled_from(strategies.float_types), key="dtype")

dimension_shared_st: st.SearchStrategy[int] = st.shared(
    st.integers(min_value=2, max_value=2048), key="dimension"
)


@dataclass
class EmbeddingStateMachineStates:
    initialize = "initialize"
    add_embeddings = "add_embeddings"
    delete_by_ids = "delete_by_ids"
    update_embeddings = "update_embeddings"
    upsert_embeddings = "upsert_embeddings"


collection_st = st.shared(strategies.collections(with_hnsw_params=True), key="coll")


class EmbeddingStateMachineBase(RuleBasedStateMachine):
    collection: Collection
    embedding_ids: Bundle[ID] = Bundle("embedding_ids")
    has_collection_mutated = False

    def __init__(self, client: ClientAPI):
        super().__init__()
        self.client = client
        self._rules_strategy = hypothesis.stateful.RuleStrategy(self)  # type: ignore

    @initialize(collection=collection_st)  # type: ignore
    def initialize(self, collection: strategies.Collection):
        self.collection = self.client.create_collection(
            name=collection.name,
            metadata=collection.metadata,  # type: ignore[arg-type]
            embedding_function=collection.embedding_function,
        )
        self.embedding_function = collection.embedding_function
        trace("init")
        self.on_state_change(EmbeddingStateMachineStates.initialize)

        self.record_set_state = strategies.StateMachineRecordSet(
            ids=[], metadatas=[], documents=[], embeddings=[]
        )

    @overrides
    def teardown(self) -> None:
        self.client.delete_collection(self.collection.name)

    @rule(
        target=embedding_ids,
        record_set=strategies.recordsets(collection_st),
    )
    def add_embeddings(self, record_set: strategies.RecordSet) -> MultipleResults[ID]:
        trace("add_embeddings")
        self.on_state_change(EmbeddingStateMachineStates.add_embeddings)

        normalized_record_set: strategies.NormalizedRecordSet = invariants.wrap_all(
            record_set
        )

        if len(normalized_record_set["ids"]) > 0:
            trace("add_more_embeddings")

        intersection = set(normalized_record_set["ids"]).intersection(
            self.record_set_state["ids"]
        )
        if len(intersection) > 0:
            # Partially apply the non-duplicative records to the state
            new_ids = list(set(normalized_record_set["ids"]).difference(intersection))
            indices = [normalized_record_set["ids"].index(id) for id in new_ids]
            filtered_record_set: strategies.NormalizedRecordSet = {
                "ids": [normalized_record_set["ids"][i] for i in indices],
                "metadatas": [normalized_record_set["metadatas"][i] for i in indices]
                if normalized_record_set["metadatas"]
                else None,
                "documents": [normalized_record_set["documents"][i] for i in indices]
                if normalized_record_set["documents"]
                else None,
                "embeddings": [normalized_record_set["embeddings"][i] for i in indices]
                if normalized_record_set["embeddings"]
                else None,
            }
            self.collection.add(**normalized_record_set)  # type: ignore[arg-type]
            self._upsert_embeddings(cast(strategies.RecordSet, filtered_record_set))
            return multiple(*filtered_record_set["ids"])

        else:
            self.collection.add(**normalized_record_set)  # type: ignore[arg-type]
            self._upsert_embeddings(cast(strategies.RecordSet, normalized_record_set))
            return multiple(*normalized_record_set["ids"])

    @rule(ids=st.lists(consumes(embedding_ids), min_size=1))
    def delete_by_ids(self, ids: IDs) -> None:
        trace("remove embeddings")
        self.on_state_change(EmbeddingStateMachineStates.delete_by_ids)
        indices_to_remove = [self.record_set_state["ids"].index(id) for id in ids]

        self.collection.delete(ids=ids)
        self._remove_embeddings(set(indices_to_remove))

    # Removing the precondition causes the tests to frequently fail as "unsatisfiable"
    # Using a value < 5 causes retries and lowers the number of valid samples
    @precondition(lambda self: len(self.record_set_state["ids"]) >= 5)
    @rule(
        record_set=strategies.recordsets(
            collection_strategy=collection_st,
            id_strategy=embedding_ids,
            min_size=1,
            max_size=5,
        ),
    )
    def update_embeddings(self, record_set: strategies.RecordSet) -> None:
        trace("update embeddings")
        self.on_state_change(EmbeddingStateMachineStates.update_embeddings)

        self.collection.update(**record_set)  # type: ignore[arg-type]
        self._upsert_embeddings(record_set)

    # Using a value < 3 causes more retries and lowers the number of valid samples
    @precondition(lambda self: len(self.record_set_state["ids"]) >= 3)
    @rule(
        record_set=strategies.recordsets(
            collection_strategy=collection_st,
            id_strategy=st.one_of(embedding_ids, strategies.safe_text),
            min_size=1,
            max_size=5,
        )
    )
    def upsert_embeddings(self, record_set: strategies.RecordSet) -> None:
        trace("upsert embeddings")
        self.on_state_change(EmbeddingStateMachineStates.upsert_embeddings)

        self.collection.upsert(**record_set)  # type: ignore[arg-type]
        self._upsert_embeddings(record_set)

    @invariant()
    def count(self) -> None:
        invariants.count(
            self.collection, cast(strategies.RecordSet, self.record_set_state)
        )

    @invariant()
    def no_duplicates(self) -> None:
        invariants.no_duplicates(self.collection)

    @invariant()
    def ann_accuracy(self) -> None:
        invariants.ann_accuracy(
            collection=self.collection,
            record_set=cast(strategies.RecordSet, self.record_set_state),
            min_recall=0.95,
            embedding_function=self.embedding_function,
        )

    @invariant()
    def fields_match(self) -> None:
        if self._is_state_empty():
            # Check that the collection is empty
            assert self.collection.count() == 0
        else:
            # RecordSet is a superset of StateMachineRecordSet
            record_set_state = cast(strategies.RecordSet, self.record_set_state)

            invariants.embeddings_match(self.collection, record_set_state)
            invariants.metadatas_match(self.collection, record_set_state)
            invariants.documents_match(self.collection, record_set_state)

    @precondition(
        lambda self: is_client_in_process(self.client)
    )  # (Can't check the log size on HTTP clients)
    @invariant()
    def log_size_below_max(self) -> None:
        system: System = self.client._system  # type: ignore
        invariants.log_size_below_max(
            system, [self.collection], self.has_collection_mutated
        )

    def _is_state_empty(self) -> bool:
        for field in self.record_set_state.values():
            if field:
                return False
        return True

    def _upsert_embeddings(self, record_set: strategies.RecordSet) -> None:
        normalized_record_set: strategies.NormalizedRecordSet = invariants.wrap_all(
            record_set
        )
        for idx, id in enumerate(normalized_record_set["ids"]):
            # Update path
            if id in self.record_set_state["ids"]:
                target_idx = self.record_set_state["ids"].index(id)
                if normalized_record_set["embeddings"] is not None:
                    self.record_set_state["embeddings"][
                        target_idx
                    ] = normalized_record_set["embeddings"][idx]
                else:
                    assert normalized_record_set["documents"] is not None
                    assert self.embedding_function is not None
                    self.record_set_state["embeddings"][
                        target_idx
                    ] = self.embedding_function(
                        [normalized_record_set["documents"][idx]]
                    )[
                        0
                    ]
                if normalized_record_set["metadatas"] is not None:
                    # Sqlite merges the metadata, as opposed to old
                    # implementations which overwrites it
                    record_set_state = self.record_set_state["metadatas"][target_idx]
                    if record_set_state is not None:
                        record_set_state = cast(
                            Dict[str, Union[str, int, float]], record_set_state
                        )
                        if normalized_record_set["metadatas"][idx] is not None:
                            record_set_state.update(
                                normalized_record_set["metadatas"][idx]  # type: ignore[arg-type]
                            )
                        else:
                            # None in the update metadata is a no-op
                            pass
                    else:
                        self.record_set_state["metadatas"][
                            target_idx
                        ] = normalized_record_set["metadatas"][idx]
                if normalized_record_set["documents"] is not None:
                    self.record_set_state["documents"][
                        target_idx
                    ] = normalized_record_set["documents"][idx]
            else:
                # Add path
                self.record_set_state["ids"].append(id)
                if normalized_record_set["embeddings"] is not None:
                    self.record_set_state["embeddings"].append(
                        normalized_record_set["embeddings"][idx]
                    )
                else:
                    assert self.embedding_function is not None
                    assert normalized_record_set["documents"] is not None
                    self.record_set_state["embeddings"].append(
                        self.embedding_function(
                            [normalized_record_set["documents"][idx]]
                        )[0]
                    )
                if normalized_record_set["metadatas"] is not None:
                    self.record_set_state["metadatas"].append(
                        normalized_record_set["metadatas"][idx]
                    )
                else:
                    self.record_set_state["metadatas"].append(None)
                if normalized_record_set["documents"] is not None:
                    self.record_set_state["documents"].append(
                        normalized_record_set["documents"][idx]
                    )
                else:
                    self.record_set_state["documents"].append(None)

    def _remove_embeddings(self, indices_to_remove: Set[int]) -> None:
        indices_list = list(indices_to_remove)
        indices_list.sort(reverse=True)

        for i in indices_list:
            del self.record_set_state["ids"][i]
            del self.record_set_state["embeddings"][i]
            del self.record_set_state["metadatas"][i]
            del self.record_set_state["documents"][i]

    def on_state_change(self, new_state: str) -> None:
        if new_state != EmbeddingStateMachineStates.initialize:
            self.has_collection_mutated = True


class EmbeddingStateMachine(EmbeddingStateMachineBase):
    embedding_ids: Bundle[ID] = Bundle("embedding_ids")

    def __init__(self, client: ClientAPI):
        super().__init__(client)

    @initialize(collection=collection_st)  # type: ignore
    def initialize(self, collection: strategies.Collection):
        super().initialize(collection)
        print(
            "[test_embeddings][initialize] Initialize collection id ",
            self.collection._model["id"],
            " hypothesis generated collection id ",
            collection.id,
        )
        self.log_operation_count = 0
        self.unique_ids_in_log: Set[ID] = set()
        self.collection_version = self.collection.get_model()["version"]

    @precondition(
        lambda self: not NOT_CLUSTER_ONLY
        and self.log_operation_count > 10
        and len(self.unique_ids_in_log) > 3
    )
    @rule()
    def wait_for_compaction(self) -> None:
        current_version = get_collection_version(self.client, self.collection.name)
        assert current_version >= self.collection_version  # type: ignore[operator]
        # This means that there was a compaction from the last time this was
        # invoked. Ok to start all over again.
        if current_version > self.collection_version:  # type: ignore[operator]
            print(
                "[test_embeddings][wait_for_compaction] collection version has changed, so reset to 0"
            )
            self.collection_version = current_version
            # This is fine even if the log has some records right now
            self.log_operation_count = 0
            self.unique_ids_in_log = set()
        else:
            print(
                "[test_embeddings][wait_for_compaction] wait for version to increase from current version ",
                current_version,
            )
            new_version = wait_for_version_increase(
                self.client,
                self.collection.name,
                current_version,
                additional_time=VERSION_INCREASE_WAIT_TIME,
            )
            # Everything got compacted.
            self.log_operation_count = 0
            self.unique_ids_in_log = set()
            self.collection_version = new_version

    @rule(
        target=embedding_ids,
        record_set=strategies.recordsets(collection_st),
    )
    def add_embeddings(self, record_set: strategies.RecordSet) -> MultipleResults[ID]:
        res = super().add_embeddings(record_set)
        normalized_record_set: strategies.NormalizedRecordSet = invariants.wrap_all(
            record_set
        )
        print(
            "[test_embeddings][add] Non Intersection ids ",
            normalized_record_set["ids"],
            " len ",
            len(normalized_record_set["ids"]),
        )
        self.log_operation_count += len(normalized_record_set["ids"])
        for id in normalized_record_set["ids"]:
            if id not in self.unique_ids_in_log:
                self.unique_ids_in_log.add(id)
        return res  # type: ignore[return-value]

    @rule(ids=st.lists(consumes(embedding_ids), min_size=1))
    def delete_by_ids(self, ids: IDs) -> None:
        super().delete_by_ids(ids)
        print("[test_embeddings][delete] ids ", ids, " len ", len(ids))
        self.log_operation_count += len(ids)
        for id in ids:
            if id in self.unique_ids_in_log:
                self.unique_ids_in_log.remove(id)

    # Removing the precondition causes the tests to frequently fail as "unsatisfiable"
    # Using a value < 5 causes retries and lowers the number of valid samples
    @precondition(lambda self: len(self.record_set_state["ids"]) >= 5)
    @rule(
        record_set=strategies.recordsets(
            collection_strategy=collection_st,
            id_strategy=embedding_ids,
            min_size=1,
            max_size=5,
        ),
    )
    def update_embeddings(self, record_set: strategies.RecordSet) -> None:
        super().update_embeddings(record_set)
        print(
            "[test_embeddings][update] ids ",
            record_set["ids"],
            " len ",
            len(invariants.wrap(record_set["ids"])),
        )
        self.log_operation_count += len(invariants.wrap(record_set["ids"]))

    # Using a value < 3 causes more retries and lowers the number of valid samples
    @precondition(lambda self: len(self.record_set_state["ids"]) >= 3)
    @rule(
        record_set=strategies.recordsets(
            collection_strategy=collection_st,
            id_strategy=st.one_of(embedding_ids, strategies.safe_text),
            min_size=1,
            max_size=5,
        )
    )
    def upsert_embeddings(self, record_set: strategies.RecordSet) -> None:
        super().upsert_embeddings(record_set)
        print(
            "[test_embeddings][upsert] ids ",
            record_set["ids"],
            " len ",
            len(invariants.wrap(record_set["ids"])),
        )
        self.log_operation_count += len(invariants.wrap(record_set["ids"]))
        for id in invariants.wrap(record_set["ids"]):
            if id not in self.unique_ids_in_log:
                self.unique_ids_in_log.add(id)


def test_embeddings_state(caplog: pytest.LogCaptureFixture, client: ClientAPI) -> None:
    create_isolated_database(client)
    caplog.set_level(logging.ERROR)
    run_state_machine_as_test(
        lambda: EmbeddingStateMachine(client),
        settings=settings(
            deadline=90000, suppress_health_check=[HealthCheck.filter_too_much]
        ),
    )  # type: ignore
    print_traces()


def test_add_then_delete_n_minus_1(client: ClientAPI) -> None:
    create_isolated_database(client)
    state = EmbeddingStateMachine(client)
    state.initialize(
        collection=strategies.Collection(
            name="A00",
            metadata={
                "hnsw:construction_ef": 128,
                "hnsw:search_ef": 128,
                "hnsw:M": 128,
            },
            embedding_function=None,
            id=uuid.uuid4(),
            dimension=2,
            dtype=np.float16,
            known_metadata_keys={},
            known_document_keywords=[],
            has_documents=False,
            has_embeddings=True,
        )
    )
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.no_duplicates()
    v1, v2, v3, v4, v5, v6 = state.add_embeddings(  # type: ignore[misc]
        record_set={
            "ids": ["0", "1", "2", "3", "4", "5"],
            "embeddings": [
                [0.09765625, 0.430419921875],
                [0.20556640625, 0.08978271484375],
                [-0.1527099609375, 0.291748046875],
                [-0.12481689453125, 0.78369140625],
                [0.92724609375, -0.233154296875],
                [0.92724609375, -0.233154296875],
            ],
            "metadatas": [None, None, None, None, None, None],
            "documents": None,
        }
    )
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.delete_by_ids(ids=[v1, v2, v3, v4, v5])
    if not NOT_CLUSTER_ONLY:
        state.wait_for_compaction()
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.teardown()


def test_embeddings_flake1(client: ClientAPI) -> None:
    create_isolated_database(client)
    state = EmbeddingStateMachine(client)
    state.initialize(
        collection=strategies.Collection(
            name="fOIBy",
            metadata={
                "-7n": False,
                "92WhVE_": "HtmY",
                "J-sW": "RTip",
                "wPGA8hY7uX": -171,
                "4rA": "5KdoaYsUQ_EWStV4",
                "hnsw:construction_ef": 128,
                "hnsw:search_ef": 128,
                "hnsw:M": 128,
            },
            embedding_function=None,
            id=uuid.UUID("ff006990-82c3-494b-97d5-cbb05092c861"),
            dimension=664,
            dtype=np.float16,
            known_metadata_keys={},
            known_document_keywords=[],
            has_documents=False,
            has_embeddings=True,
        )
    )
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.no_duplicates()
    (
        embedding_ids_0,
        embedding_ids_1,
        embedding_ids_2,
        embedding_ids_3,
        embedding_ids_4,
        embedding_ids_5,
    ) = state.add_embeddings(
        record_set={
            "ids": ["kgaT4d", "C2h2YoNSgUqRyE-Tmxf3MT", "ODI-yO", "t", "b", "vC"],
            "embeddings": [
                [0] * 664,
                [0] * 664,
                [0] * 664,
                [0] * 664,
                [0] * 664,
                [0] * 664,
            ],
            "metadatas": [
                {
                    "s": False,
                    "d1wQJV-9": -2_021_928_494,
                    "hWf7gwQ": "5DkqA9o6",
                    "rbyHg": 0.0,
                    "Pe": 251,
                    "0r6qQ5XYxeq": -0.3333333432674408,
                    "PzXpiqB": "VT",
                },
                None,
                {
                    "hqTZ6Ok767eCSwyvGEuig8a": -659321220,
                    "TRGxN": -0.3333333432674408,
                    "1h8I": "E",
                },
                {"ATRs": -0.3333333432674408, "KF0P": -23106},
                {
                    "PcFwu": -14169,
                    "PS": 0.0,
                    "WCgx": -13116,
                    "EQt": False,
                    "upcOfhu": -1.5,
                    "e": "vReD",
                    "U": -2147,
                    "zI4tO": True,
                    "MfHM7uU58tW_muctZf": -22,
                    "SvOy": 2.220446049250313e-16,
                },
                {
                    "iuTAKznMg6IdUKxaPi": -58907,
                    "oy": "uDC",
                    "c0Zb3VTUktBu-uW": "OcywKhsi",
                    "6i": -42181,
                    "nn": 5.960464477539063e-08,
                    "bs": "-",
                    "om": -1000000.0,
                    "MXnpsEEE": True,
                    "Ful8JRj": -304752924,
                    "Hi7lrY": True,
                },
            ],
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 6, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.no_duplicates()
    (embedding_ids_6,) = state.add_embeddings(
        record_set={
            "ids": "ua",
            "embeddings": [[0] * 664],
            "metadatas": None,
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 7, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.no_duplicates()
    embedding_ids_7, embedding_ids_8 = state.add_embeddings(
        record_set={
            "ids": ["K_", "yFsH"],
            "embeddings": [[0] * 664, [0] * 664],
            "metadatas": [
                None,
                {
                    "RiaaN9MNpq": -634040344,
                    "g9Wx": True,
                    "uexOH": -2.220446049250313e-16,
                    "h2": True,
                },
            ],
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 9, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.upsert_embeddings(
        record_set={
            "ids": ["SCeelWyLAWG_oHa", "lY", "3"],
            "embeddings": [[0] * 664, [0] * 664, [0] * 664],
            "metadatas": [
                {
                    "0ZbYq40P": 448094799,
                    "OT9sTxkM": 9.999999747378752e-06,
                    "-j": 158,
                    "rqsBEfrELJctJoVeLqtsPZp": -100,
                    "5M4": 64676,
                    "XFt": 227,
                    "ii": 168135.75,
                    "ly": True,
                },
                {"Dy6": "q7LZUW"},
                {
                    "fP": "KuQG8m-T",
                    "APtmt": False,
                    "xKb6": -2_147_483_647,
                    "C": "xGw",
                    "G18V": False,
                    "s": True,
                    "c-": "k",
                    "G92n": -7024,
                    "YTTBWs31rbM_L_PQDSCu": False,
                    "xOGzFeG": True,
                    "gh7cuT_ruA3mn": 883101.75,
                },
            ],
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 12, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.upsert_embeddings(
        record_set={
            "ids": [
                "O3m3-X1",
                "ZNt2PF6M5_q",
                "Ij0Yh6",
                embedding_ids_1,
                embedding_ids_7,
            ],
            "embeddings": [[0] * 664, [0] * 664, [0] * 664, [0] * 664, [0] * 664],
            "metadatas": [
                {
                    "2fDAuv7": -46139,
                    "4Et": 19926,
                    "5hqGH60G-yZ6PWyM1B": False,
                    "OkMjjG": "34oWsr93EUl",
                    "yTk": 999999.0,
                    "wZvpmS5HbTAI": -9.999999747378752e-06,
                    "bvq": "Xc80e",
                    "zPhL": "e-QXuDdnxYMd",
                },
                {
                    "WK": -9.999999747378752e-06,
                    "y": "g",
                    "GNZphPCKay88gsh3x_": 1.899999976158142,
                },
                {"_zVO2i-N": -40, "tWHxo": False, "ltu_E_fg": "JDc", "9yGpik": -153},
                {
                    "otM8": "ZnQ3ALwA",
                    "EGeKm": 50,
                    "skf71O0UKT": True,
                    "S8Kc8-l95Rpc": True,
                    "4bGz1QmzbKVySN1yrXFl56CmDS08F": 1_284_815_517,
                },
                None,
            ],
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 15, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.update_embeddings(
        record_set={
            "ids": [
                embedding_ids_1,
                embedding_ids_3,
                embedding_ids_8,
                embedding_ids_5,
                embedding_ids_6,
            ],
            "embeddings": [[0] * 664, [0] * 664, [0] * 664, [0] * 664, [0] * 664],
            "metadatas": [
                {
                    "hBFXAIA": False,
                    "Wx4dcB5": -35,
                    "8w": False,
                    "8": False,
                    "mwQ5": "c7",
                    "G9g2": "J",
                    "VY": True,
                    "VQGb_r-hzoA": -0.9999899864196777,
                    "M0lMig": True,
                    "F": True,
                    "J": 1.100000023841858,
                    "d": "R",
                    "DugrcoZv": False,
                    "45B": -2.0000100135803223,
                    "UG-sSV": False,
                    "cri4cT1G": -1_067_180_133,
                    "I": -4411,
                    "FqFWR__": False,
                    "4": -23,
                    "vwo4WERBljY3aWjWnqL": "xM0jUV4U2r",
                    "WF": "msuFYMwj_SXc",
                },
                None,
                {"m": -49054, "f4": 239658268, "Ut": False, "V_NVCw": "5"},
                {"VWuP": -9.999999747378752e-06, "7uF8": 127, "3": False},
                {
                    "a1": -6.103515625e-05,
                    "ML_Zl2Ir85KolESaX": False,
                    "iJvA": -1.5,
                    "O8o": 1_287_175_929,
                    "rMS": 200,
                    "0": -1000000.0,
                    "5AeE": 9.999999747378752e-06,
                    "2q": True,
                },
            ],
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 15, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.update_embeddings(
        record_set={
            "ids": [embedding_ids_1, embedding_ids_2, embedding_ids_8, embedding_ids_3],
            "embeddings": [[0] * 664, [0] * 664, [0] * 664, [0] * 664],
            "metadatas": [
                {"Yx": "6T9tEEC84", "lGe5GMX": 3054},
                {
                    "UvsAljL5V5ELRv": True,
                    embedding_ids_3: False,
                    "yeLTrhAIq": 1.5,
                    "iP": -0.5,
                },
                {"C": "Ri"},
                {
                    "pzHn2": -9.999999747378752e-06,
                    "YfdftMEd0C5ekByb7mhdb": 9735,
                    "LJCViu": 333447280,
                    "LT": True,
                    "5Y": False,
                    "OoVwE": False,
                    "vq": 1.899999976158142,
                    "8Wf6": False,
                },
            ],
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 15, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.update_embeddings(
        record_set={
            "ids": [embedding_ids_5],
            "embeddings": [[0] * 664],
            "metadatas": {
                "C1KbOOlKkzzLo9CGU2": -1_379_550_593,
                "NH": "d",
                "M": "ebEKOx",
                "fpu77F70Icl": True,
                "dz6fI-Gpp": True,
                "qVVW": -63204,
                "Qrcq645F": 296029.46875,
            },
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 15, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.no_duplicates()
    (
        embedding_ids_9,
        embedding_ids_10,
        embedding_ids_11,
        embedding_ids_12,
    ) = state.add_embeddings(
        record_set={
            "ids": ["F7", "Rig1", "RXi", "_nC8-"],
            "embeddings": [[0] * 664, [0] * 664, [0] * 664, [0] * 664],
            "metadatas": [
                {
                    "FBtaPcQWV24v": -25365,
                    "ddLq1My3mbUL9I": 2019,
                    "fI": 908902.125,
                    "HLxuosT": False,
                },
                {"ATUP1": -1.5},
                {"AhC": True, "wm9AwP": -0.9999899864196777},
                {"K": -33427},
            ],
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 19, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.upsert_embeddings(
        record_set={
            "ids": ["4GJ", "r", "Aunf5", embedding_ids_5],
            "embeddings": [[0] * 664, [0] * 664, [0] * 664, [0] * 664],
            "metadatas": [
                {"J8O0R8VGaY": True},
                {
                    "K2cCg": 5.960464477539063e-08,
                    "oObAcp": -2.0000100135803223,
                    "ax": "nK67g",
                    "afzp": 1000000.0,
                    "xnRCSPJUF4JZ2sKOIRDc": True,
                    "nBaQ6F1O38etVMhss2angu-": 158622.671875,
                },
                {
                    "UwbDWM2_": 9.999999747378752e-06,
                    "3": -452142.625,
                    "nfoovt": 214128.375,
                    "elaMLbhEvW": 1.100000023841858,
                    "0": "iSNcMrT",
                    "UO": True,
                    "I": 176,
                    "3ssGS4rSKXsKqRPFTBGrRPPsu": 1000000.0,
                    "Gw": False,
                    "V": True,
                },
                {"F": "tTw"},
            ],
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 22, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.update_embeddings(
        record_set={
            "ids": [embedding_ids_1, embedding_ids_9],
            "embeddings": [[0] * 664, [0] * 664],
            "metadatas": [
                {
                    "ei": -6.103515625e-05,
                    "_": "qscyRBC_",
                    "TP": "IXd",
                    "N0FG7Nta1": -745247.375,
                    "woD": 66,
                    "IV": "0L3xImGg",
                    "9N--JBl0uH_au_": -0.5,
                    "KVmhtcA": -9.999999747378752e-06,
                    "qr": False,
                    "NfL6": -0.9999899864196777,
                    "taIVpC": True,
                    "XJX": "l",
                    "5": 66,
                    "8YaEynJznB": True,
                    "k": -177,
                    "N": 671709.375,
                    "ebB": 53239,
                    "fJ": 65709.09375,
                    "QK8l3l4yP-": False,
                    "2": "cRl59jW_O",
                    "-XP899RRn": -999999.0,
                    "A9": 1.1754943508222875e-38,
                    "UlxNwmc": True,
                    "G": 128,
                    "1NoCd": False,
                    "WRn5cD": -175840.15625,
                },
                {
                    "zAbCKkEvE4s": True,
                    "hnFN": "HExeVM0iM",
                    "Uc9": False,
                    "v": 1_759_514_963,
                    "X": False,
                    "W": 1.100000023841858,
                },
            ],
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 22, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.update_embeddings(
        record_set={
            "ids": [embedding_ids_2],
            "embeddings": [[0] * 664],
            "metadatas": None,
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 22, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.update_embeddings(
        record_set={
            "ids": [
                embedding_ids_10,
                embedding_ids_2,
                embedding_ids_4,
                embedding_ids_12,
                embedding_ids_3,
            ],
            "embeddings": [[0] * 664, [0] * 664, [0] * 664, [0] * 664, [0] * 664],
            "metadatas": [
                {"Y": "-iRt8"},
                {"55m28": "8MxYq", "krQsTFdqMhYjhF": False},
                None,
                {
                    "9SnviLf": -6.103515625e-05,
                    "Y0Jw4pLTwr": -184,
                    "v3E": 6.103515625e-05,
                    "Fx3jsbcdqy": "VG7E7xm",
                    "H": 9071,
                    "-U": "1xXUHLklmIVSVgQd7EHUCu5wa",
                    "S": "kl6",
                },
                {
                    "U": -12,
                    "Qfm_6duL": False,
                    "Sh0LkduZt5qsRJrF": "sB",
                    "8DM": -64114,
                    "MZ": "xtLNrNyRo2",
                    "lY": -922831.5,
                    "7": False,
                },
            ],
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 22, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.upsert_embeddings(
        record_set={
            "ids": [embedding_ids_0, embedding_ids_7, "Oia", "iD", embedding_ids_5],
            "embeddings": [[0] * 664, [0] * 664, [0] * 664, [0] * 664, [0] * 664],
            "metadatas": [
                None,
                {
                    "tVs": True,
                    "B": "4eK",
                    "zTR": True,
                    "bq6VslBBo2_12hgyKNPddxify34-np-": -22311,
                    "F7FcZpODwCTHg91o4mKTjBL": False,
                    "1Zjfys": -13897,
                    "lg3": -866314519,
                },
                {
                    "1qr": "_TG-YhAQ",
                    "TKV": "Q",
                    "8tLu": 1000000.0,
                    "QHsxa": 1.100000023841858,
                    "F": True,
                },
                {
                    "p": True,
                    "rR": "UepiV6K_",
                    "UDZ_uR": -1.5,
                    "fFG6cZvICaGc": True,
                    "unTbxz0qd2-AV1": -332950.25,
                },
                {
                    "EXXVBZU": 2_147_483_647,
                    "tJMO": "C9OePg",
                    "4o": False,
                    "F8g8n": -999999.0,
                    "5": "aBY",
                    "hv3i": -48091,
                },
            ],
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 24, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.teardown()


def test_update_none(caplog: pytest.LogCaptureFixture, client: ClientAPI) -> None:
    create_isolated_database(client)
    state = EmbeddingStateMachine(client)
    state.initialize(
        collection=strategies.Collection(
            name="A00",
            metadata={
                "hnsw:construction_ef": 128,
                "hnsw:search_ef": 128,
                "hnsw:M": 128,
            },
            embedding_function=None,
            id=uuid.UUID("2fb0c945-b877-42ab-9417-bfe0f6b172af"),
            dimension=2,
            dtype=np.float16,
            known_metadata_keys={},
            known_document_keywords=[],
            has_documents=False,
            has_embeddings=True,
        )
    )
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.no_duplicates()
    v1, v2, v3, v4, v5 = state.add_embeddings(  # type: ignore[misc]
        record_set={
            "ids": ["0", "1", "2", "3", "4"],
            "embeddings": [
                [0.09765625, 0.430419921875],
                [0.20556640625, 0.08978271484375],
                [-0.1527099609375, 0.291748046875],
                [-0.12481689453125, 0.78369140625],
                [0.92724609375, -0.233154296875],
            ],
            "metadatas": [None, None, None, None, None],
            "documents": None,
        }
    )
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.update_embeddings(
        record_set={
            "ids": [v5],
            "embeddings": [[0.58349609375, 0.05780029296875]],
            "metadatas": [{v1: v1}],
            "documents": None,
        }
    )
    state.ann_accuracy()
    state.teardown()


def test_add_delete_add(client: ClientAPI) -> None:
    create_isolated_database(client)
    state = EmbeddingStateMachine(client)
    state.initialize(
        collection=strategies.Collection(
            name="KR3cf",
            metadata={
                "Ufmxsi3": 999999.0,
                "bMMvvrqM4MKmp5CJB8A": 62921,
                "-": True,
                "37PNi": "Vkn",
                "5KZfkpod3ND5soL_": True,
                "KA4zcZL9lRN9": 142,
                "Oc8G7ysXmE8lp4Hos_": "POQe8Unz1uJ",
                "BI930U": 31,
                "te": False,
                "tyM": -0.5,
                "R0ZiZ": True,
                "m": True,
                "IOw": -25725,
                "hnsw:construction_ef": 128,
                "hnsw:search_ef": 128,
                "hnsw:M": 128,
            },
            embedding_function=None,
            id=uuid.UUID("284b6e99-b19e-49b2-96a4-a2a93a95447d"),
            dimension=3,
            dtype=np.float32,
            known_metadata_keys={},
            known_document_keywords=[],
            has_documents=False,
            has_embeddings=True,
        )
    )
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.no_duplicates()
    embeddings = state.add_embeddings(
        record_set={
            "ids": ["255", "l", "3-", "i", "Nk", "9yPvT"],
            "embeddings": [
                [1.2, 2.3, 1.5],
                [4.5, 6.0, 2],
                [1, 2, 3],
                [4, 5, 6],
                [8.9, 9.0, 7],
                [4.5, 6.0, 5.6],
            ],
            "metadatas": None,
            "documents": None,
        }
    )
    i = 0
    emb_list = {}
    for embedding in embeddings:
        emb_list[i] = embedding
        i += 1
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.upsert_embeddings(
        record_set={
            "ids": [
                emb_list[0],
                emb_list[4],
                "KWcDaHUVD6MxEiJ",
                emb_list[5],
                "PdlP1d6w",
            ],
            "embeddings": [[1, 23, 4], [3, 5, 9], [9, 3, 5], [3, 9, 8], [1, 5, 4]],
            "documents": None,
            "metadatas": None,
        }
    )
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.no_duplicates()
    if not NOT_CLUSTER_ONLY:
        state.wait_for_compaction()
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.upsert_embeddings(
        record_set={
            "ids": ["TpjiboLSuYWBJDbRW1zeNmC", emb_list[0], emb_list[4]],
            "embeddings": [[4, 6, 7], [7, 9, 3], [1, 3, 6]],
            "metadatas": None,
            "documents": None,
        }
    )
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.no_duplicates()
    state.delete_by_ids(
        ids=[emb_list[2], emb_list[1], emb_list[5], emb_list[4], emb_list[3]]
    )
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.no_duplicates()
    embeddings = state.add_embeddings(
        record_set={
            "ids": ["o", "D3V84", "Rt", "TDwlc9C8_evn", emb_list[1]],
            "embeddings": [
                [9, 5.4, 3.22],
                [1.33, 3.44, 5.66],
                [9.90, 9.8, 1.3],
                [9.7, 5.6, 4.5],
                [3.4, 5.6, 9.65],
            ],
            "documents": None,
            "metadatas": None,
        }
    )
    i = 6
    for embedding in embeddings:
        emb_list[i] = embedding
        i += 1
    state.ann_accuracy()
    state.count()
    state.fields_match()
    if not NOT_CLUSTER_ONLY:
        state.wait_for_compaction()


def test_multi_add(client: ClientAPI) -> None:
    create_isolated_database(client)
    coll = client.create_collection(name="foo")
    coll.add(ids=["a"], embeddings=[[0.0]])  # type: ignore[arg-type]
    assert coll.count() == 1

    # after the sqlite refactor - add silently ignores duplicates, no exception is raised
    # partial adds are supported - i.e we will add whatever we can in the request
    coll.add(ids=["a"], embeddings=[[0.0]])  # type: ignore[arg-type]

    assert coll.count() == 1

    results = coll.get()
    assert results["ids"] == ["a"]

    coll.delete(ids=["a"])
    assert coll.count() == 0


def test_dup_add(client: ClientAPI) -> None:
    create_isolated_database(client)
    coll = client.create_collection(name="foo")
    with pytest.raises(errors.DuplicateIDError):
        coll.add(ids=["a", "a"], embeddings=[[0.0], [1.1]])  # type: ignore[arg-type]
    with pytest.raises(errors.DuplicateIDError):
        coll.upsert(ids=["a", "a"], embeddings=[[0.0], [1.1]])  # type: ignore[arg-type]


def test_query_without_add(client: ClientAPI) -> None:
    create_isolated_database(client)
    coll = client.create_collection(name="foo")
    fields: Include = ["documents", "metadatas", "embeddings", "distances"]  # type: ignore[list-item]
    N = np.random.randint(1, 2000)
    K = np.random.randint(1, 100)
    query_embeddings = np.random.random((N, K)).tolist()
    results = coll.query(
        query_embeddings=cast(Embeddings, query_embeddings), include=fields
    )
    for field in fields:
        field_results = results[field]  # type: ignore[literal-required]
        assert field_results is not None
        assert all([len(result) == 0 for result in field_results])


def test_get_non_existent(client: ClientAPI) -> None:
    create_isolated_database(client)
    coll = client.create_collection(name="foo")
    result = coll.get(ids=["a"], include=["documents", "metadatas", "embeddings"])  # type: ignore[list-item]
    assert len(result["ids"]) == 0
    assert len(result["metadatas"]) == 0  # type: ignore[arg-type]
    assert len(result["documents"]) == 0  # type: ignore[arg-type]
    assert len(result["embeddings"]) == 0  # type: ignore[arg-type]


# TODO: Use SQL escaping correctly internally
@pytest.mark.xfail(reason="We don't properly escape SQL internally, causing problems")
def test_escape_chars_in_ids(client: ClientAPI) -> None:
    create_isolated_database(client)
    id = "\x1f"
    coll = client.create_collection(name="foo")
    coll.add(ids=[id], embeddings=[[0.0]])  # type: ignore[arg-type]
    assert coll.count() == 1
    coll.delete(ids=[id])
    assert coll.count() == 0


def test_delete_empty_fails(client: ClientAPI) -> None:
    create_isolated_database(client)
    coll = client.create_collection(name="foo")
    with pytest.raises(ValueError):
        coll.delete()


@pytest.mark.parametrize(
    "kwargs",
    [
        {"ids": ["foo"]},
        {"where": {"foo": "bar"}},
        {"where_document": {"$contains": "bar"}},
        {"ids": ["foo"], "where": {"foo": "bar"}},
        {"ids": ["foo"], "where_document": {"$contains": "bar"}},
        {
            "ids": ["foo"],
            "where": {"foo": "bar"},
            "where_document": {"$contains": "bar"},
        },
    ],
)
def test_delete_success(client: ClientAPI, kwargs: Any) -> None:
    create_isolated_database(client)
    coll = client.create_collection(name="foo")
    # Should not raise
    coll.delete(**kwargs)


@given(supported_types=st.sampled_from([np.float32, np.int32, np.int64, int, float]))
def test_autocasting_validate_embeddings_for_compatible_types(
    supported_types: List[Any],
) -> None:
    embds = strategies.create_embeddings(10, 10, supported_types)
    validated_embeddings = validate_embeddings(
        cast(
            Embeddings,
            normalize_embeddings(embds),
        )
    )
    assert all(
        [
            isinstance(value, np.ndarray)
            and (
                value.dtype == np.float32
                or value.dtype == np.float64
                or value.dtype == np.int32
                or value.dtype == np.int64
            )
            for value in validated_embeddings
        ]
    )


@given(supported_types=st.sampled_from([np.float32, np.int32, np.int64, int, float]))
def test_autocasting_validate_embeddings_with_ndarray(
    supported_types: List[Any],
) -> None:
    embds = strategies.create_embeddings_ndarray(10, 10, supported_types)
    validated_embeddings = validate_embeddings(
        cast(Embeddings, normalize_embeddings(embds))
    )
    assert all(
        [
            isinstance(value, np.ndarray)
            and (
                value.dtype == np.float32
                or value.dtype == np.float64
                or value.dtype == np.int32
                or value.dtype == np.int64
            )
            for value in validated_embeddings
        ]
    )


@given(unsupported_types=st.sampled_from([str, bool]))
def test_autocasting_validate_embeddings_incompatible_types(
    unsupported_types: List[Any],
) -> None:
    embds = strategies.create_embeddings(10, 10, unsupported_types)
    with pytest.raises(ValueError) as e:
        validate_embeddings(cast(Embeddings, normalize_embeddings(embds)))

    assert (
        "Expected embeddings to be a list of floats or ints, a list of lists, a numpy array, or a list of numpy arrays, got "
        in str(e.value)
    )


def test_0dim_embedding_validation() -> None:
    embds: Embeddings = [np.array([])]
    with pytest.raises(ValueError) as e:
        validate_embeddings(embds)
    assert (
        "Expected each embedding in the embeddings to be a 1-dimensional numpy array with at least 1 int/float value. Got a 1-dimensional numpy array with no values at pos"
        in str(e)
    )


def test_no_op_compaction(client: ClientAPI) -> None:
    create_isolated_database(client)
    coll = client.create_collection(name="noop")
    initial_version = get_collection_version(client, coll.name)
    for batch in range(0, 5000, 100):
        coll.delete(ids=[str(i) for i in range(batch, batch + 100)])
    if not NOT_CLUSTER_ONLY:
        wait_for_version_increase(
            client, coll.name, initial_version, VERSION_INCREASE_WAIT_TIME
        )


def test_add_then_purge(client: ClientAPI) -> None:
    create_isolated_database(client)
    record_count = 5000
    batch_count = 100
    coll = client.create_collection(name="add_then_purge")
    witness_version = get_collection_version(client, coll.name)

    # Add records and wait for compaction
    for batch in range(0, record_count, batch_count):
        record_id_vals = [i for i in range(batch, batch + batch_count)]
        record_ids = [str(i) for i in record_id_vals]
        coll.add(
            ids=record_ids, embeddings=[[2 * i, 2 * i + 1] for i in record_id_vals]
        )
    if not NOT_CLUSTER_ONLY:
        wait_for_version_increase(
            client, coll.name, witness_version, VERSION_INCREASE_WAIT_TIME
        )

    # Purge records and wait for compaction
    witness_version = get_collection_version(client, coll.name)
    for batch in range(0, record_count, batch_count):
        record_id_vals = [i for i in range(batch, batch + batch_count)]
        record_ids = [str(i) for i in record_id_vals]
        coll.delete(ids=record_ids)
    if not NOT_CLUSTER_ONLY:
        wait_for_version_increase(
            client, coll.name, witness_version, VERSION_INCREASE_WAIT_TIME
        )

    # There should be no records left
    assert len(coll.get()["ids"]) == 0


def test_encompassing_delete(client: ClientAPI) -> None:
    create_isolated_database(client)
    col = client.create_collection("encompassing_delete")
    initial_version = get_collection_version(client, col.name)

    id_start = 0
    # Add and then Delete 6 records
    ids = [str(i) for i in range(id_start, id_start + 6)]
    embeddings = [[i * 1.0, i * 1.0] for i in range(id_start, id_start + 6)]
    id_start = id_start + 6

    col.add(ids=ids, embeddings=embeddings)  # type: ignore[arg-type]
    col.delete(ids=ids)

    if not NOT_CLUSTER_ONLY:
        wait_for_version_increase(
            client, col.name, initial_version, VERSION_INCREASE_WAIT_TIME
        )
    initial_version = get_collection_version(client, col.name)

    # Add and then delete and then add 16
    len_to_add = 16
    ids = [str(i) for i in range(id_start, id_start + len_to_add)]
    embeddings = [[i * 1.0, i * 1.0] for i in range(id_start, id_start + len_to_add)]

    col.add(ids=ids, embeddings=embeddings)  # type: ignore[arg-type]
    col.delete(ids=ids)
    col.add(ids=ids, embeddings=embeddings)  # type: ignore[arg-type]

    if not NOT_CLUSTER_ONLY:
        wait_for_version_increase(
            client, col.name, initial_version, VERSION_INCREASE_WAIT_TIME
        )

    # Ensure we can get all
    get_results = col.get()
    assert len(get_results["ids"]) == len_to_add
    for id in ids:
        assert id in get_results["ids"]
