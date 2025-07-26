import pytest
from chromadb.errors import NotFoundError
from chromadb.test.conftest import ClientFactories


def test_get_database_not_found(client_factories: ClientFactories) -> None:
    with pytest.raises(NotFoundError):
        client_factories.create_client(database="does_not_exist")
