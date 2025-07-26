import pytest
from chromadb.api.client import AdminClient, Client
from chromadb.config import System
from chromadb.db.impl.sqlite import SqliteDB
from chromadb.errors import NotFoundError
from chromadb.test.conftest import ClientFactories


def test_deletes_database(client_factories: ClientFactories) -> None:
    client = client_factories.create_client()
    client.reset()

    admin_client = client_factories.create_admin_client_from_system()

    admin_client.create_database("test_delete_database")

    client = client_factories.create_client(database="test_delete_database")
    collection = client.create_collection("foo")

    admin_client.delete_database("test_delete_database")

    with pytest.raises(NotFoundError):
        admin_client.get_database("test_delete_database")

    with pytest.raises(NotFoundError):
        client.get_collection("foo")

    with pytest.raises(NotFoundError):
        collection.upsert(["foo"], [0.0, 0.0, 0.0])


def test_does_not_affect_other_databases(client_factories: ClientFactories) -> None:
    client = client_factories.create_client()
    client.reset()

    admin_client = client_factories.create_admin_client_from_system()

    admin_client.create_database("first")
    admin_client.create_database("second")

    first_client = client_factories.create_client(database="first")
    first_client.create_collection("test")

    second_client = client_factories.create_client(database="second")
    second_collection = second_client.create_collection("test")

    admin_client.delete_database("first")

    assert second_client.get_collection("test").id == second_collection.id

    with pytest.raises(NotFoundError):
        first_client.get_collection("test")


def test_collection_was_removed(sqlite_persistent: System) -> None:
    sqlite = sqlite_persistent.instance(SqliteDB)

    admin_client = AdminClient.from_system(sqlite_persistent)
    admin_client.create_database("test_delete_database")

    client = Client.from_system(sqlite_persistent, database="test_delete_database")
    client.create_collection("foo")

    admin_client.delete_database("test_delete_database")

    with pytest.raises(NotFoundError):
        client.get_collection("foo")

    # Check table
    with sqlite.tx() as cur:
        row = cur.execute("SELECT COUNT(*) from collections").fetchone()
        assert row[0] == 0


def test_errors_when_database_does_not_exist(client_factories: ClientFactories) -> None:
    client = client_factories.create_client()
    client.reset()

    admin_client = client_factories.create_admin_client_from_system()

    with pytest.raises(NotFoundError):
        admin_client.delete_database("foo")
