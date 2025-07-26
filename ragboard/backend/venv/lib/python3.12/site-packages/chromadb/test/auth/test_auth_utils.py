import pytest

from chromadb.auth.utils import maybe_set_tenant_and_database
from chromadb.auth import UserIdentity
from chromadb.config import DEFAULT_DATABASE, DEFAULT_TENANT
from chromadb.errors import ChromaAuthError


@pytest.fixture
def user_identity() -> UserIdentity:
    return UserIdentity(
        user_id="test_user_id",
        tenant="test_tenant",
        databases=["test_database"],
    )


def test_doesnt_overrite_from_auth(user_identity: UserIdentity) -> None:
    resolved_tenant, resolved_database = maybe_set_tenant_and_database(
        user_identity=user_identity,
        overwrite_singleton_tenant_database_access_from_auth=False,
        user_provided_tenant="user_provided_tenant",
        user_provided_database="user_provided_database",
    )

    assert resolved_tenant == "user_provided_tenant"
    assert resolved_database == "user_provided_database"


def test_sets_tenant_and_database_when_none_or_default_provided(
    user_identity: UserIdentity,
) -> None:
    resolved_tenant, resolved_database = maybe_set_tenant_and_database(
        user_identity=user_identity,
        overwrite_singleton_tenant_database_access_from_auth=True,
        user_provided_tenant=DEFAULT_TENANT,
        user_provided_database=DEFAULT_DATABASE,
    )

    assert resolved_tenant == "test_tenant"
    assert resolved_database == "test_database"

    resolved_tenant, resolved_database = maybe_set_tenant_and_database(
        user_identity=user_identity,
        overwrite_singleton_tenant_database_access_from_auth=True,
        user_provided_tenant=None,
        user_provided_database=None,
    )

    assert resolved_tenant == "test_tenant"
    assert resolved_database == "test_database"


def test_errors_when_provided_tenant_and_database_dont_match_from_auth(
    user_identity: UserIdentity,
) -> None:
    with pytest.raises(ChromaAuthError):
        maybe_set_tenant_and_database(
            user_identity=user_identity,
            overwrite_singleton_tenant_database_access_from_auth=True,
            user_provided_tenant="user_provided_tenant",
            user_provided_database="user_provided_database",
        )


def test_doesnt_overrite_from_auth_when_ambiguous(user_identity: UserIdentity) -> None:
    user_identity.tenant = "*"
    user_identity.databases = ["*"]
    resolved_tenant, resolved_database = maybe_set_tenant_and_database(
        user_identity=user_identity,
        overwrite_singleton_tenant_database_access_from_auth=True,
        user_provided_tenant=None,
        user_provided_database=None,
    )

    assert resolved_tenant is None
    assert resolved_database is None

    resolved_tenant, resolved_database = maybe_set_tenant_and_database(
        user_identity=user_identity,
        overwrite_singleton_tenant_database_access_from_auth=True,
        user_provided_tenant="user_provided_tenant",
        user_provided_database="user_provided_database",
    )

    assert resolved_tenant == "user_provided_tenant"
    assert resolved_database == "user_provided_database"
