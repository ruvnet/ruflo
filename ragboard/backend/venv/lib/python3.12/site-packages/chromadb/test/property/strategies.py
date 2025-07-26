import hashlib
import hypothesis
import hypothesis.strategies as st
from typing import Any, Optional, List, Dict, Union, cast
from typing_extensions import TypedDict
import uuid
import numpy as np
import numpy.typing as npt
import chromadb.api.types as types
import re
from hypothesis.strategies._internal.strategies import SearchStrategy
from chromadb.test.conftest import NOT_CLUSTER_ONLY
from dataclasses import dataclass
from chromadb.api.types import (
    Documents,
    Embeddable,
    EmbeddingFunction,
    Embeddings,
    Metadata,
)
from chromadb.types import LiteralValue, WhereOperator, LogicalOperator

# Set the random seed for reproducibility
np.random.seed(0)  # unnecessary, hypothesis does this for us

# See Hypothesis documentation for creating strategies at
# https://hypothesis.readthedocs.io/en/latest/data.html

# NOTE: Because these strategies are used in state machines, we need to
# work around an issue with state machines, in which strategies that frequently
# are marked as invalid (i.e. through the use of `assume` or `.filter`) can cause the
# state machine tests to fail with an hypothesis.errors.Unsatisfiable.

# Ultimately this is because the entire state machine is run as a single Hypothesis
# example, which ends up drawing from the same strategies an enormous number of times.
# Whenever a strategy marks itself as invalid, Hypothesis tries to start the entire
# state machine run over. See https://github.com/HypothesisWorks/hypothesis/issues/3618

# Because strategy generation is all interrelated, seemingly small changes (especially
# ones called early in a test) can have an outside effect. Generating lists with
# unique=True, or dictionaries with a min size seems especially bad.

# Please make changes to these strategies incrementally, testing to make sure they don't
# start generating unsatisfiable examples.

test_hnsw_config = {
    "hnsw:construction_ef": 128,
    "hnsw:search_ef": 128,
    "hnsw:M": 128,
}


class RecordSet(TypedDict):
    """
    A generated set of embeddings, ids, metadatas, and documents that
    represent what a user would pass to the API.
    """

    ids: Union[types.ID, List[types.ID]]
    embeddings: Optional[Union[types.Embeddings, types.Embedding]]
    metadatas: Optional[Union[List[Optional[types.Metadata]], types.Metadata]]
    documents: Optional[Union[List[types.Document], types.Document]]


class NormalizedRecordSet(TypedDict):
    """
    A RecordSet, with all fields normalized to lists.
    """

    ids: List[types.ID]
    embeddings: Optional[types.Embeddings]
    metadatas: Optional[List[Optional[types.Metadata]]]
    documents: Optional[List[types.Document]]


class StateMachineRecordSet(TypedDict):
    """
    Represents the internal state of a state machine in hypothesis tests.
    """

    ids: List[types.ID]
    embeddings: types.Embeddings
    metadatas: List[Optional[types.Metadata]]
    documents: List[Optional[types.Document]]


class Record(TypedDict):
    """
    A single generated record.
    """

    id: types.ID
    embedding: Optional[types.Embedding]
    metadata: Optional[types.Metadata]
    document: Optional[types.Document]


# TODO: support arbitrary text everywhere so we don't SQL-inject ourselves.
# TODO: support empty strings everywhere
sql_alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
safe_text = st.text(alphabet=sql_alphabet, min_size=1)
sql_alphabet_minus_underscore = (
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"
)
safe_text_min_size_3 = st.text(alphabet=sql_alphabet_minus_underscore, min_size=3)
tenant_database_name = st.text(alphabet=sql_alphabet, min_size=3)

# Workaround for FastAPI json encoding peculiarities
# https://github.com/tiangolo/fastapi/blob/8ac8d70d52bb0dd9eb55ba4e22d3e383943da05c/fastapi/encoders.py#L104
safe_text = safe_text.filter(lambda s: not s.startswith("_sa"))
safe_text_min_size_3 = safe_text_min_size_3.filter(lambda s: not s.startswith("_sa"))
tenant_database_name = tenant_database_name.filter(lambda s: not s.startswith("_sa"))

safe_integers = st.integers(
    min_value=-(2**31), max_value=2**31 - 1
)  # TODO: handle longs
# In distributed chroma, floats are 32 bit hence we need to
# restrict the generation to generate only 32 bit floats.
safe_floats = st.floats(
    allow_infinity=False,
    allow_nan=False,
    allow_subnormal=False,
    width=32,
    min_value=-1e6,
    max_value=1e6,
)  # TODO: handle infinity and NAN

safe_values: List[SearchStrategy[Union[int, float, str, bool]]] = [
    safe_text,
    safe_integers,
    safe_floats,
    st.booleans(),
]


def one_or_both(
    strategy_a: st.SearchStrategy[Any], strategy_b: st.SearchStrategy[Any]
) -> st.SearchStrategy[Any]:
    return st.one_of(
        st.tuples(strategy_a, strategy_b),
        st.tuples(strategy_a, st.none()),
        st.tuples(st.none(), strategy_b),
    )


# Temporarily generate only these to avoid SQL formatting issues.
legal_id_characters = (
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./+"
)

float_types = [np.float16, np.float32, np.float64]
int_types = [np.int16, np.int32, np.int64]  # TODO: handle int types


@st.composite
def collection_name(draw: st.DrawFn) -> str:
    _collection_name_re = re.compile(r"^[a-zA-Z][a-zA-Z0-9-]{1,60}[a-zA-Z0-9]$")
    _ipv4_address_re = re.compile(r"^([0-9]{1,3}\.){3}[0-9]{1,3}$")
    _two_periods_re = re.compile(r"\.\.")

    name: str = draw(st.from_regex(_collection_name_re)).strip()
    hypothesis.assume(not _ipv4_address_re.match(name))
    hypothesis.assume(not _two_periods_re.search(name))

    return name


collection_metadata = st.one_of(
    st.none(), st.dictionaries(safe_text, st.one_of(*safe_values))
)


# TODO: Use a hypothesis strategy while maintaining embedding uniqueness
#       Or handle duplicate embeddings within a known epsilon
def create_embeddings(
    dim: int,
    count: int,
    dtype: npt.DTypeLike,
) -> types.Embeddings:
    embeddings: types.Embeddings = cast(
        types.Embeddings,
        (
            np.random.uniform(
                low=-1.0,
                high=1.0,
                size=(count, dim),
            )
            .astype(dtype)
            .tolist()
        ),
    )

    return embeddings


def create_embeddings_ndarray(
    dim: int,
    count: int,
    dtype: npt.DTypeLike,
) -> np.typing.NDArray[Any]:
    return np.random.uniform(
        low=-1.0,
        high=1.0,
        size=(count, dim),
    ).astype(dtype)


class hashing_embedding_function(types.EmbeddingFunction[Documents]):
    def __init__(self, dim: int, dtype: npt.DTypeLike) -> None:
        self.dim = dim
        self.dtype = dtype

    def __call__(self, input: types.Documents) -> types.Embeddings:
        # Hash the texts and convert to hex strings
        hashed_texts = [
            list(hashlib.sha256(text.encode("utf-8")).hexdigest()) for text in input
        ]
        # Pad with repetition, or truncate the hex strings to the desired dimension
        padded_texts = [
            text * (self.dim // len(text)) + text[: self.dim % len(text)]
            for text in hashed_texts
        ]

        # Convert the hex strings to dtype
        embeddings: types.Embeddings = [
            np.array([int(char, 16) / 15.0 for char in text], dtype=self.dtype)
            for text in padded_texts
        ]

        return embeddings

    def __repr__(self) -> str:
        return f"hashing_embedding_function(dim={self.dim}, dtype={self.dtype})"


class not_implemented_embedding_function(types.EmbeddingFunction[Documents]):
    def __call__(self, input: Documents) -> Embeddings:
        assert False, "This embedding function is not implemented"


def embedding_function_strategy(
    dim: int, dtype: npt.DTypeLike
) -> st.SearchStrategy[types.EmbeddingFunction[Embeddable]]:
    return st.just(
        cast(EmbeddingFunction[Embeddable], hashing_embedding_function(dim, dtype))
    )


@dataclass
class ExternalCollection:
    """
    An external view of a collection.

    This strategy only contains information about a collection that a client of Chroma
    sees -- that is, it contains none of Chroma's internal bookkeeping. It should
    be used to test the API and client code.
    """

    name: str
    metadata: Optional[types.Metadata]
    embedding_function: Optional[types.EmbeddingFunction[Embeddable]]


@dataclass
class Collection(ExternalCollection):
    """
    An internal view of a collection.

    This strategy contains all the information Chroma uses internally to manage a
    collection. It is a superset of ExternalCollection and should be used to test
    internal Chroma logic.
    """

    id: uuid.UUID
    dimension: int
    dtype: npt.DTypeLike
    known_metadata_keys: types.Metadata
    known_document_keywords: List[str]
    has_documents: bool = False
    has_embeddings: bool = False


@st.composite
def collections(
    draw: st.DrawFn,
    add_filterable_data: bool = False,
    with_hnsw_params: bool = False,
    has_embeddings: Optional[bool] = None,
    has_documents: Optional[bool] = None,
    with_persistent_hnsw_params: st.SearchStrategy[bool] = st.just(False),
    max_hnsw_batch_size: int = 2000,
    max_hnsw_sync_threshold: int = 2000,
) -> Collection:
    """Strategy to generate a Collection object. If add_filterable_data is True, then known_metadata_keys and known_document_keywords will be populated with consistent data."""

    assert not ((has_embeddings is False) and (has_documents is False))

    name = draw(collection_name())
    metadata = draw(collection_metadata)
    dimension = draw(st.integers(min_value=2, max_value=2048))
    dtype = draw(st.sampled_from(float_types))

    use_persistent_hnsw_params = draw(with_persistent_hnsw_params)

    if use_persistent_hnsw_params and not with_hnsw_params:
        raise ValueError(
            "with_persistent_hnsw_params requires with_hnsw_params to be true"
        )

    if with_hnsw_params:
        if metadata is None:
            metadata = {}
        metadata.update(test_hnsw_config)
        if use_persistent_hnsw_params:
            metadata["hnsw:sync_threshold"] = draw(
                st.integers(min_value=3, max_value=max_hnsw_sync_threshold)
            )
            metadata["hnsw:batch_size"] = draw(
                st.integers(
                    min_value=3,
                    max_value=min(
                        [metadata["hnsw:sync_threshold"], max_hnsw_batch_size]
                    ),
                )
            )
        # Sometimes, select a space at random
        if draw(st.booleans()):
            # TODO: pull the distance functions from a source of truth that lives not
            # in tests once https://github.com/chroma-core/issues/issues/61 lands
            metadata["hnsw:space"] = draw(st.sampled_from(["cosine", "l2", "ip"]))

    known_metadata_keys: Dict[str, Union[int, str, float]] = {}
    if add_filterable_data:
        while len(known_metadata_keys) < 5:
            key = draw(safe_text)
            known_metadata_keys[key] = draw(st.one_of(*safe_values))

    if has_documents is None:
        has_documents = draw(st.booleans())
    assert has_documents is not None
    # For cluster tests, we want to avoid generating documents and where_document
    # clauses of length < 3. We also don't want them to contain certan special
    # characters like _ and % that implicitly involve searching for a regex in sqlite.
    if not NOT_CLUSTER_ONLY:
        if has_documents and add_filterable_data:
            known_document_keywords = draw(
                st.lists(safe_text_min_size_3, min_size=5, max_size=5)
            )
        else:
            known_document_keywords = []
    else:
        if has_documents and add_filterable_data:
            known_document_keywords = draw(st.lists(safe_text, min_size=5, max_size=5))
        else:
            known_document_keywords = []

    if not has_documents:
        has_embeddings = True
    else:
        if has_embeddings is None:
            has_embeddings = draw(st.booleans())
    assert has_embeddings is not None

    embedding_function = draw(embedding_function_strategy(dimension, dtype))

    return Collection(
        id=uuid.uuid4(),
        name=name,
        metadata=metadata,
        dimension=dimension,
        dtype=dtype,
        known_metadata_keys=known_metadata_keys,
        has_documents=has_documents,
        known_document_keywords=known_document_keywords,
        has_embeddings=has_embeddings,
        embedding_function=embedding_function,
    )


@st.composite
def metadata(
    draw: st.DrawFn,
    collection: Collection,
    min_size: int = 0,
    max_size: Optional[int] = None,
) -> Optional[types.Metadata]:
    """Strategy for generating metadata that could be a part of the given collection"""
    # First draw a random dictionary.
    metadata: types.Metadata = draw(
        st.dictionaries(
            safe_text, st.one_of(*safe_values), min_size=min_size, max_size=max_size
        )
    )
    # Then, remove keys that overlap with the known keys for the coll
    # to avoid type errors when comparing.
    if collection.known_metadata_keys:
        for key in collection.known_metadata_keys.keys():
            if key in metadata:
                del metadata[key]  # type: ignore
        # Finally, add in some of the known keys for the collection
        sampling_dict: Dict[str, st.SearchStrategy[Union[str, int, float]]] = {
            k: st.just(v) for k, v in collection.known_metadata_keys.items()
        }
        metadata.update(draw(st.fixed_dictionaries({}, optional=sampling_dict)))  # type: ignore
    # We don't allow submitting empty metadata
    if metadata == {}:
        return None
    return metadata


@st.composite
def document(draw: st.DrawFn, collection: Collection) -> types.Document:
    """Strategy for generating documents that could be a part of the given collection"""
    # For cluster tests, we want to avoid generating documents of length < 3.
    # We also don't want them to contain certan special
    # characters like _ and % that implicitly involve searching for a regex in sqlite.
    if not NOT_CLUSTER_ONLY:
        # Blacklist certain unicode characters that affect sqlite processing.
        # For example, the null (/x00) character makes sqlite stop processing a string.
        # Also, blacklist _ and % for cluster tests.
        blacklist_categories = ("Cc", "Cs", "Pc", "Po")
        if collection.known_document_keywords:
            known_words_st = st.sampled_from(collection.known_document_keywords)
        else:
            known_words_st = st.text(
                min_size=3,
                alphabet=st.characters(blacklist_categories=blacklist_categories),  # type: ignore
            )

        random_words_st = st.text(
            min_size=3, alphabet=st.characters(blacklist_categories=blacklist_categories)  # type: ignore
        )
        words = draw(st.lists(st.one_of(known_words_st, random_words_st), min_size=1))
        return " ".join(words)

    # Blacklist certain unicode characters that affect sqlite processing.
    # For example, the null (/x00) character makes sqlite stop processing a string.
    blacklist_categories = ("Cc", "Cs")  # type: ignore
    if collection.known_document_keywords:
        known_words_st = st.sampled_from(collection.known_document_keywords)
    else:
        known_words_st = st.text(
            min_size=1,
            alphabet=st.characters(blacklist_categories=blacklist_categories),  # type: ignore
        )

    random_words_st = st.text(
        min_size=1, alphabet=st.characters(blacklist_categories=blacklist_categories)  # type: ignore
    )
    words = draw(st.lists(st.one_of(known_words_st, random_words_st), min_size=1))
    return " ".join(words)


@st.composite
def recordsets(
    draw: st.DrawFn,
    collection_strategy: SearchStrategy[Collection] = collections(),
    id_strategy: SearchStrategy[str] = safe_text,
    min_size: int = 1,
    max_size: int = 50,
    # If num_unique_metadata is not None, then the number of metadata generations
    # will be the size of the record set. If set, the number of metadata
    # generations will be the value of num_unique_metadata.
    num_unique_metadata: Optional[int] = None,
    min_metadata_size: int = 0,
    max_metadata_size: Optional[int] = None,
) -> RecordSet:
    collection = draw(collection_strategy)

    ids = list(
        draw(st.lists(id_strategy, min_size=min_size, max_size=max_size, unique=True))
    )

    embeddings: Optional[Embeddings] = None
    if collection.has_embeddings:
        embeddings = create_embeddings(collection.dimension, len(ids), collection.dtype)
    num_metadata = num_unique_metadata if num_unique_metadata is not None else len(ids)
    generated_metadatas = draw(
        st.lists(
            metadata(
                collection, min_size=min_metadata_size, max_size=max_metadata_size
            ),
            min_size=num_metadata,
            max_size=num_metadata,
        )
    )
    metadatas = []
    for i in range(len(ids)):
        metadatas.append(generated_metadatas[i % len(generated_metadatas)])

    documents: Optional[Documents] = None
    if collection.has_documents:
        documents = draw(
            st.lists(document(collection), min_size=len(ids), max_size=len(ids))
        )

    # in the case where we have a single record, sometimes exercise
    # the code that handles individual values rather than lists.
    # In this case, any field may be a list or a single value.
    if len(ids) == 1:
        single_id: Union[str, List[str]] = ids[0] if draw(st.booleans()) else ids
        single_embedding = (
            embeddings[0]
            if embeddings is not None and draw(st.booleans())
            else embeddings
        )
        single_metadata: Union[Optional[Metadata], List[Optional[Metadata]]] = (
            metadatas[0] if draw(st.booleans()) else metadatas
        )
        single_document = (
            documents[0] if documents is not None and draw(st.booleans()) else documents
        )
        return {
            "ids": single_id,
            "embeddings": single_embedding,
            "metadatas": single_metadata,
            "documents": single_document,
        }
    return {
        "ids": ids,
        "embeddings": embeddings,
        "metadatas": metadatas,
        "documents": documents,
    }


def opposite_value(value: LiteralValue) -> SearchStrategy[Any]:
    """
    Returns a strategy that will generate all valid values except the input value - testing of $nin
    """
    if isinstance(value, float):
        return safe_floats.filter(lambda x: x != value)
    elif isinstance(value, str):
        return safe_text.filter(lambda x: x != value)
    elif isinstance(value, bool):
        return st.booleans().filter(lambda x: x != value)
    elif isinstance(value, int):
        return st.integers(min_value=-(2**31), max_value=2**31 - 1).filter(
            lambda x: x != value
        )
    else:
        return st.from_type(type(value)).filter(lambda x: x != value)


@st.composite
def where_clause(draw: st.DrawFn, collection: Collection) -> types.Where:
    """Generate a filter that could be used in a query against the given collection"""

    known_keys = sorted(collection.known_metadata_keys.keys())

    key = draw(st.sampled_from(known_keys))
    value = collection.known_metadata_keys[key]

    legal_ops: List[Optional[str]] = [None]

    if isinstance(value, bool):
        legal_ops.extend(["$eq", "$ne", "$in", "$nin"])
    elif isinstance(value, float):
        legal_ops.extend(["$gt", "$lt", "$lte", "$gte"])
    elif isinstance(value, int):
        legal_ops.extend(["$gt", "$lt", "$lte", "$gte", "$eq", "$ne", "$in", "$nin"])
    elif isinstance(value, str):
        legal_ops.extend(["$eq", "$ne", "$in", "$nin"])
    else:
        assert False, f"Unsupported type: {type(value)}"

    if isinstance(value, float):
        # Add or subtract a small number to avoid floating point rounding errors
        value = value + draw(st.sampled_from([1e-6, -1e-6]))
        # Truncate to 32 bit
        value = float(np.float32(value))

    op: WhereOperator = draw(st.sampled_from(legal_ops))

    if op is None:
        return {key: value}
    elif op == "$in":  # type: ignore
        if isinstance(value, str) and not value:
            return {}
        return {key: {op: [value, *[draw(opposite_value(value)) for _ in range(3)]]}}
    elif op == "$nin":  # type: ignore
        if isinstance(value, str) and not value:
            return {}
        return {key: {op: [draw(opposite_value(value)) for _ in range(3)]}}
    else:
        return {key: {op: value}}  # type: ignore


@st.composite
def where_doc_clause(draw: st.DrawFn, collection: Collection) -> types.WhereDocument:
    """Generate a where_document filter that could be used against the given collection"""
    # For cluster tests, we want to avoid generating where_document
    # clauses of length < 3. We also don't want them to contain certan special
    # characters like _ and % that implicitly involve searching for a regex in sqlite.
    if not NOT_CLUSTER_ONLY:
        if collection.known_document_keywords:
            word = draw(st.sampled_from(collection.known_document_keywords))
        else:
            word = draw(safe_text_min_size_3)
    else:
        if collection.known_document_keywords:
            word = draw(st.sampled_from(collection.known_document_keywords))
        else:
            word = draw(safe_text)

    # This is hacky, but the distributed system does not support $not_contains
    # so we need to avoid generating these operators for now in that case.
    # TODO: Remove this once the distributed system supports $not_contains
    op = draw(st.sampled_from(["$contains", "$not_contains"]))

    if op == "$contains":
        return {"$contains": word}
    else:
        assert op == "$not_contains"
        return {"$not_contains": word}


def binary_operator_clause(
    base_st: SearchStrategy[types.Where],
) -> SearchStrategy[types.Where]:
    op: SearchStrategy[LogicalOperator] = st.sampled_from(["$and", "$or"])
    return st.dictionaries(
        keys=op,
        values=st.lists(base_st, max_size=2, min_size=2),
        min_size=1,
        max_size=1,
    )


def binary_document_operator_clause(
    base_st: SearchStrategy[types.WhereDocument],
) -> SearchStrategy[types.WhereDocument]:
    op: SearchStrategy[LogicalOperator] = st.sampled_from(["$and", "$or"])
    return st.dictionaries(
        keys=op,
        values=st.lists(base_st, max_size=2, min_size=2),
        min_size=1,
        max_size=1,
    )


@st.composite
def recursive_where_clause(draw: st.DrawFn, collection: Collection) -> types.Where:
    base_st = where_clause(collection)
    where: types.Where = draw(st.recursive(base_st, binary_operator_clause))
    return where


@st.composite
def recursive_where_doc_clause(
    draw: st.DrawFn, collection: Collection
) -> types.WhereDocument:
    base_st = where_doc_clause(collection)
    where: types.WhereDocument = draw(
        st.recursive(base_st, binary_document_operator_clause)
    )
    return where


class Filter(TypedDict):
    where: Optional[types.Where]
    ids: Optional[Union[str, List[str]]]
    where_document: Optional[types.WhereDocument]


@st.composite
def filters(
    draw: st.DrawFn,
    collection_st: st.SearchStrategy[Collection],
    recordset_st: st.SearchStrategy[RecordSet],
    include_all_ids: bool = False,
) -> Filter:
    collection = draw(collection_st)
    recordset = draw(recordset_st)

    where_clause = draw(st.one_of(st.none(), recursive_where_clause(collection)))
    where_document_clause = draw(
        st.one_of(st.none(), recursive_where_doc_clause(collection))
    )

    ids: Optional[Union[List[types.ID], types.ID]]
    # Record sets can be a value instead of a list of values if there is only one record
    if isinstance(recordset["ids"], str):
        ids = [recordset["ids"]]
    else:
        ids = recordset["ids"]

    if not include_all_ids:
        ids = draw(st.one_of(st.none(), st.lists(st.sampled_from(ids), min_size=1)))
        if ids is not None:
            # Remove duplicates since hypothesis samples with replacement
            ids = list(set(ids))

    # Test both the single value list and the unwrapped single value case
    if ids is not None and len(ids) == 1 and draw(st.booleans()):
        ids = ids[0]

    return {"where": where_clause, "where_document": where_document_clause, "ids": ids}
