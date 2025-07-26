import pytest
import logging
import hypothesis.strategies as st
from chromadb.test.property.invariants import check_metadata
import chromadb.test.property.strategies as strategies
from chromadb.api import ClientAPI
import chromadb.api.types as types
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
import chromadb.test.property.invariants as invariants
from typing import Any, Dict, Mapping, Optional
import numpy
from chromadb.test.property.strategies import hashing_embedding_function


class CollectionStateMachine(RuleBasedStateMachine):
    collections: Bundle[strategies.ExternalCollection]
    _model: Dict[str, Optional[types.CollectionMetadata]]

    collections = Bundle("collections")

    def __init__(self, client: ClientAPI):
        super().__init__()
        self._model = {}
        self.client = client

    @initialize()
    def initialize(self) -> None:
        self.client.reset()
        self._model = {}

    @rule(target=collections, coll=strategies.collections())
    def create_coll(
        self, coll: strategies.ExternalCollection
    ) -> MultipleResults[strategies.ExternalCollection]:
        # Metadata can either be None or a non-empty dict
        if coll.name in self.model or (
            coll.metadata is not None and len(coll.metadata) == 0
        ):
            with pytest.raises(Exception):
                c = self.client.create_collection(
                    name=coll.name,
                    metadata=coll.metadata,  # type: ignore[arg-type]
                    embedding_function=coll.embedding_function,
                )
            return multiple()

        c = self.client.create_collection(
            name=coll.name,
            metadata=coll.metadata,  # type: ignore[arg-type]
            embedding_function=coll.embedding_function,
        )
        self.set_model(coll.name, coll.metadata)  # type: ignore[arg-type]

        assert c.name == coll.name
        check_metadata(self.model[coll.name], c.metadata)
        return multiple(coll)

    @rule(coll=collections)
    def get_coll(self, coll: strategies.ExternalCollection) -> None:
        if coll.name in self.model:
            c = self.client.get_collection(name=coll.name)
            assert c.name == coll.name
            check_metadata(self.model[coll.name], c.metadata)
        else:
            with pytest.raises(Exception):
                self.client.get_collection(name=coll.name)

    @rule(coll=consumes(collections))
    def delete_coll(self, coll: strategies.ExternalCollection) -> None:
        if coll.name in self.model:
            with invariants.collection_deleted(self.client, coll.name):
                self.client.delete_collection(name=coll.name)
                self.delete_from_model(coll.name)
        else:
            with pytest.raises(Exception):
                self.client.delete_collection(name=coll.name)

        with pytest.raises(Exception):
            self.client.get_collection(name=coll.name)

    @rule()
    def list_collections(self) -> None:
        colls = self.client.list_collections()
        assert len(colls) == len(self.model)
        for c in colls:
            assert c.name in self.model

    # @rule for list_collections with limit and offset
    @rule(
        limit=st.integers(min_value=1, max_value=5),
        offset=st.integers(min_value=0, max_value=5),
    )
    def list_collections_with_limit_offset(self, limit: int, offset: int) -> None:
        colls = self.client.list_collections(limit=limit, offset=offset)
        total_collections = self.client.count_collections()

        # get all collections
        all_colls = self.client.list_collections()
        # manually slice the collections based on the given limit and offset
        man_colls = all_colls[offset : offset + limit]

        # given limit and offset, make various assertions regarding the total number of collections
        if limit + offset > total_collections:
            assert len(colls) == max(total_collections - offset, 0)
            # assert that our manually sliced collections are the same as the ones returned by the API
            assert colls == man_colls

        else:
            assert len(colls) == limit

    @rule(
        target=collections,
        new_metadata=st.one_of(st.none(), strategies.collection_metadata),
        coll=st.one_of(consumes(collections), strategies.collections()),
    )
    def get_or_create_coll(
        self,
        coll: strategies.ExternalCollection,
        new_metadata: Optional[types.Metadata],
    ) -> MultipleResults[strategies.ExternalCollection]:
        # Cases for get_or_create

        # Case 0
        # new_metadata is none, coll is an existing collection
        # get_or_create should return the existing collection with existing metadata

        # Case 1
        # new_metadata is none, coll is a new collection
        # get_or_create should create a new collection with the metadata of None

        # Case 2
        # new_metadata is not none, coll is an existing collection
        # get_or_create should return the existing collection with the original metadata

        # Case 3
        # new_metadata is not none, coll is a new collection
        # get_or_create should create a new collection with the new metadata

        if new_metadata is not None and len(new_metadata) == 0:
            with pytest.raises(Exception):
                c = self.client.get_or_create_collection(
                    name=coll.name,
                    metadata=new_metadata,  # type: ignore[arg-type]
                    embedding_function=coll.embedding_function,
                )
            return multiple()

        # Update model
        if coll.name not in self.model:
            # Handles case 1 and 3
            coll.metadata = new_metadata
            self.set_model(coll.name, coll.metadata)  # type: ignore[arg-type]

        # Update API
        c = self.client.get_or_create_collection(
            name=coll.name,
            metadata=new_metadata,  # type: ignore[arg-type]
            embedding_function=coll.embedding_function,
        )

        # Check that model and API are in sync
        assert c.name == coll.name
        check_metadata(self.model[coll.name], c.metadata)
        return multiple(coll)

    @rule(
        target=collections,
        coll=consumes(collections),
        new_metadata=strategies.collection_metadata,
        new_name=st.one_of(st.none(), strategies.collection_name()),
    )
    def modify_coll(
        self,
        coll: strategies.ExternalCollection,
        new_metadata: types.Metadata,
        new_name: Optional[str],
    ) -> MultipleResults[strategies.ExternalCollection]:
        if coll.name not in self.model:
            with pytest.raises(Exception):
                c = self.client.get_collection(name=coll.name)
            return multiple()

        c = self.client.get_collection(name=coll.name)
        _metadata: Optional[Mapping[str, Any]] = self.model[coll.name]
        _name: str = coll.name
        if new_metadata is not None:
            # Can't set metadata to an empty dict
            if len(new_metadata) == 0:
                with pytest.raises(Exception):
                    c = self.client.get_or_create_collection(
                        name=coll.name,
                        metadata=new_metadata,  # type: ignore[arg-type]
                        embedding_function=coll.embedding_function,
                    )
                return multiple()

            coll.metadata = new_metadata
            _metadata = new_metadata

        if new_name is not None:
            if new_name in self.model and new_name != coll.name:
                with pytest.raises(Exception):
                    c.modify(metadata=new_metadata, name=new_name)  # type: ignore[arg-type]
                return multiple()

            self.delete_from_model(coll.name)
            coll.name = new_name
            _name = new_name

        self.set_model(_name, _metadata)  # type: ignore[arg-type]
        c.modify(metadata=_metadata, name=_name)  # type: ignore[arg-type]
        c = self.client.get_collection(name=coll.name)

        assert c.name == coll.name
        check_metadata(self.model[coll.name], c.metadata)
        return multiple(coll)

    def set_model(
        self,
        name: str,
        metadata: Optional[types.CollectionMetadata],
    ) -> None:
        model = self.model
        model[name] = metadata

    def delete_from_model(self, name: str) -> None:
        model = self.model
        del model[name]

    @property
    def model(self) -> Dict[str, Optional[types.CollectionMetadata]]:
        return self._model


def test_collections(caplog: pytest.LogCaptureFixture, client: ClientAPI) -> None:
    caplog.set_level(logging.ERROR)
    run_state_machine_as_test(lambda: CollectionStateMachine(client))  # type: ignore


# Below are tests that have failed in the past. If your test fails, please add
# it to protect against regressions in the test harness itself. If you need
# help doing so, talk to anton.


def test_previously_failing_one(client: ClientAPI) -> None:
    state = CollectionStateMachine(client)
    state.initialize()
    # I don't know why the typechecker is red here. This code is correct and is
    # pulled from the logs.
    (v1,) = state.get_or_create_coll(  # type: ignore[misc]
        coll=strategies.ExternalCollection(
            name="jjn2yjLW1zp2T",
            metadata=None,
            embedding_function=hashing_embedding_function(dtype=numpy.float32, dim=863),  # type: ignore[arg-type]
        ),
        new_metadata=None,
    )
    (v6,) = state.get_or_create_coll(  # type: ignore[misc]
        coll=strategies.ExternalCollection(
            name="jjn2yjLW1zp2T",
            metadata=None,
            embedding_function=hashing_embedding_function(dtype=numpy.float32, dim=863),  # type: ignore[arg-type]
        ),
        new_metadata=None,
    )
    state.modify_coll(
        coll=v1, new_metadata={"7": -1281, "fGe": -0.0, "K5j": "im"}, new_name=None
    )
    state.modify_coll(coll=v6, new_metadata=None, new_name=None)


# https://github.com/chroma-core/chroma/commit/cf476d70f0cebb7c87cb30c7172ba74d6ea175cd#diff-e81868b665d149bb315d86890dea6fc6a9fc9fc9ea3089aa7728142b54f622c5R210
def test_previously_failing_two(client: ClientAPI) -> None:
    state = CollectionStateMachine(client)
    state.initialize()
    (v13,) = state.get_or_create_coll(  # type: ignore[misc]
        coll=strategies.ExternalCollection(
            name="C1030",
            metadata={},
            embedding_function=hashing_embedding_function(dim=2, dtype=numpy.float32),  # type: ignore[arg-type]
        ),
        new_metadata=None,
    )
    (v15,) = state.modify_coll(  # type: ignore[misc]
        coll=v13,
        new_metadata={
            "0": "10",
            "40": "0",
            "p1nviWeL7fO": "qN",
            "7b": "YS",
            "VYWq4LEMWjCo": True,
        },
        new_name="OF5F0MzbQg",
    )
    state.get_or_create_coll(
        coll=strategies.ExternalCollection(
            name="VS0QGh",
            metadata={
                "h": 5.681951615025145e-227,
                "A1": 61126,
                "uhUhLEEMfeC_kN": 2147483647,
                "weF": "pSP",
                "B3DSaP": False,
                "6H533K": 1.192092896e-07,
            },
            embedding_function=hashing_embedding_function(  # type: ignore[arg-type]
                dim=1915, dtype=numpy.float32
            ),
        ),
        new_metadata={
            "xVW09xUpDZA": 31734,
            "g": 1.1,
            "n1dUTalF-MY": -1000000.0,
            "y": "G3EtXTZ",
            "ugXZ_hK": 5494,
        },
    )
    v17 = state.modify_coll(  # noqa: F841
        coll=v15, new_metadata={"L35J2S": "K0l026"}, new_name="Ai1"
    )
    v18 = state.get_or_create_coll(coll=v13, new_metadata=None)  # noqa: F841
    state.get_or_create_coll(
        coll=strategies.ExternalCollection(
            name="VS0QGh",
            metadata=None,
            embedding_function=hashing_embedding_function(dim=326, dtype=numpy.float16),  # type: ignore[arg-type]
        ),
        new_metadata=None,
    )
