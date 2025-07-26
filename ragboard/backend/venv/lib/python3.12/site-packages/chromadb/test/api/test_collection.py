from concurrent.futures import ThreadPoolExecutor
import uuid
from chromadb.api import ClientAPI
from chromadb.errors import ChromaError, UniqueConstraintError


def test_duplicate_collection_create(
    client: ClientAPI,
) -> None:
    client.reset()

    client.create_collection(
        name="test",
        metadata={"hnsw:construction_ef": 128, "hnsw:search_ef": 128, "hnsw:M": 128},
    )

    try:
        client.create_collection(
            name="test",
            metadata={
                "hnsw:construction_ef": 128,
                "hnsw:search_ef": 128,
                "hnsw:M": 128,
            },
        )
        assert False, "Expected exception"
    except Exception as e:
        print("Collection creation failed as expected with error ", e)
        assert "already exists" in e.args[0] or isinstance(e, UniqueConstraintError)


def test_not_existing_collection_delete(
    client: ClientAPI,
) -> None:
    try:
        client.delete_collection(
            name="test101",
        )
        assert False, "Expected exception"
    except Exception as e:
        print("Collection deletion failed as expected with error ", e)
        assert "does not exist" in e.args[0]


def test_multithreaded_get_or_create(client: ClientAPI) -> None:
    N_THREADS = 50
    new_name = str(uuid.uuid4())

    def create_maybe_delete_collection(i: int) -> None:
        try:
            coll = client.get_or_create_collection(new_name)
            assert coll.name == new_name
        except ChromaError as e:
            if "concurrent" not in e.message():
                raise e

        try:
            if i % 2 == 0:
                client.delete_collection(new_name)
        except ChromaError as e:
            if "does not exist" not in e.message():
                raise e

    # Stress to trigger a potential race condition
    with ThreadPoolExecutor(max_workers=N_THREADS) as executor:
        futures = [
            executor.submit(create_maybe_delete_collection, i) for i in range(N_THREADS)
        ]
        for future in futures:
            try:
                future.result()
            except Exception as e:
                assert False, f"Thread raised an exception: {e}"
