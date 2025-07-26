from concurrent.futures import ThreadPoolExecutor

from chromadb.config import DEFAULT_TENANT
from chromadb.test.conftest import ClientFactories


def test_multiple_clients_concurrently(client_factories: ClientFactories) -> None:
    """Tests running multiple clients, each against their own database, concurrently."""
    client = client_factories.create_client()
    client.reset()
    admin_client = client_factories.create_admin_client_from_system()
    admin_client.create_database("test_db")

    CLIENT_COUNT = 50
    COLLECTION_COUNT = 10

    # Each database will create the same collections by name, with differing metadata
    databases = [f"db{i}" for i in range(CLIENT_COUNT)]
    for database in databases:
        admin_client.create_database(database)

    collections = [f"collection{i}" for i in range(COLLECTION_COUNT)]

    # Create N clients, each on a seperate thread, each with their own database
    def run_target(n: int) -> None:
        thread_client = client_factories.create_client(
            tenant=DEFAULT_TENANT,
            database=databases[n],
            settings=client._system.settings,
        )
        for collection in collections:
            thread_client.create_collection(
                collection, metadata={"database": databases[n]}
            )

    with ThreadPoolExecutor(max_workers=CLIENT_COUNT) as executor:
        executor.map(run_target, range(CLIENT_COUNT))
    executor.shutdown(wait=True)
    # Create a final client, which will be used to verify the collections were created
    client = client_factories.create_client(settings=client._system.settings)

    # Verify that the collections were created
    for database in databases:
        client.set_database(database)
        seen_collections = client.list_collections()
        assert len(seen_collections) == COLLECTION_COUNT
        for collection in seen_collections:
            assert collection.name in collections
            assert collection.metadata == {"database": database}
