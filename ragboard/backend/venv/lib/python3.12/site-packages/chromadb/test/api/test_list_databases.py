from typing import Dict, List
from hypothesis import given
from chromadb.test.conftest import ClientFactories
import hypothesis.strategies as st


def test_list_databases(client_factories: ClientFactories) -> None:
    client = client_factories.create_client()
    client.reset()
    admin_client = client_factories.create_admin_client_from_system()

    for i in range(10):
        admin_client.create_database(f"test_list_databases_{i}")

    databases = admin_client.list_databases()
    assert len(databases) == 11  # add 1 for the default_database

    for i in range(10):
        assert any(d["name"] == f"test_list_databases_{i}" for d in databases)

    assert any(d["name"] == "default_database" for d in databases)


@st.composite
def tenants_and_databases_st(
    draw: st.DrawFn, max_tenants: int, max_databases: int
) -> Dict[str, List[str]]:
    """Generates a set of random tenants and databases. Each database is assigned to a random tenant. Returns a dictionary where the key is the tenant name and the value is a list of database names for that tenant."""
    num_tenants = draw(st.integers(min_value=1, max_value=max_tenants))
    num_databases = draw(st.integers(min_value=0, max_value=max_databases))

    database_i_to_tenant_i = draw(
        st.lists(
            st.integers(min_value=0, max_value=num_tenants - 1),
            min_size=num_databases,
            max_size=num_databases,
        )
    )

    tenants = [f"tenant_{i}" for i in range(num_tenants)]
    databases = [f"database_{i}" for i in range(num_databases)]

    result: Dict[str, List[str]] = {}
    for database_i, tenant_i in enumerate(database_i_to_tenant_i):
        tenant = tenants[tenant_i]
        database = databases[database_i]

        if tenant not in result:
            result[tenant] = []

        result[tenant].append(database)

    return result


@given(
    limit=st.integers(min_value=1, max_value=10),
    offset=st.integers(min_value=0, max_value=10),
    tenants_and_databases=tenants_and_databases_st(max_tenants=10, max_databases=10),
)
def test_list_databases_with_limit_offset(
    limit: int,
    offset: int,
    tenants_and_databases: Dict[str, List[str]],
    client_factories: ClientFactories,
) -> None:
    client = client_factories.create_client()
    client.reset()

    admin_client = client_factories.create_admin_client_from_system()

    for tenant, databases in tenants_and_databases.items():
        admin_client.create_tenant(tenant)

        for database in databases:
            admin_client.create_database(database, tenant)

    for tenant, all_databases in tenants_and_databases.items():
        listed_databases = admin_client.list_databases(
            limit=limit, offset=offset, tenant=tenant
        )
        expected_databases = all_databases[offset : offset + limit]

        if limit + offset > len(all_databases):
            assert len(listed_databases) == max(len(all_databases) - offset, 0)
            assert [d["name"] for d in listed_databases] == expected_databases
        else:
            assert len(listed_databases) == limit
            assert [d["name"] for d in listed_databases] == expected_databases
