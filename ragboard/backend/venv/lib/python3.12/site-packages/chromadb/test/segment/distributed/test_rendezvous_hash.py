from chromadb.utils.rendezvous_hash import assign, murmur3hasher
from math import sqrt


def test_rendezvous_hash() -> None:
    # Tests the assign works as expected
    members = ["a", "b", "c"]
    key = "key"

    def mock_hasher(member: str, key: str) -> int:
        return members.index(member)  # Highest index wins

    assert assign(key, members, mock_hasher, 1)[0] == "c"


def test_even_distribution() -> None:
    member_count = 10
    num_keys = 1000
    nodes = [str(i) for i in range(member_count)]

    expected = num_keys / len(nodes)
    # Std deviation of a binomial distribution is sqrt(n * p * (1 - p))
    # where n is the number of trials, and p is the probability of success
    stddev = sqrt(num_keys * (1 / len(nodes)) * (1 - 1 / len(nodes)))
    # https://en.wikipedia.org/wiki/68%E2%80%9395%E2%80%9399.7_rule
    # For a 99.7% confidence interval
    tolerance = 3 * stddev

    # Test if keys are evenly distributed across nodes
    key_distribution = {node: 0 for node in nodes}
    for i in range(num_keys):
        key = f"key_{i}"
        node = assign(key, nodes, murmur3hasher, 1)[0]
        key_distribution[node] += 1

    # Check if keys are somewhat evenly distributed
    for node in nodes:
        assert abs(key_distribution[node] - expected) < tolerance


def test_multi_assign_even_distribution() -> None:
    member_count = 10
    num_keys = 10000
    replication = 3
    nodes = [str(i) for i in range(member_count)]
    expected = num_keys / len(nodes) * replication

    stddev = sqrt(num_keys * replication * (1 / len(nodes)) * (1 - 1 / len(nodes)))
    tolerance = 3 * stddev

    # Test if keys are evenly distributed across nodes
    key_distribution = {node: 0 for node in nodes}
    for i in range(num_keys):
        key = f"key_{i}"
        nodes_assigned = assign(key, nodes, murmur3hasher, replication)
        # Should be three unique nodes
        assert len(set(nodes_assigned)) == replication
        for node in nodes_assigned:
            key_distribution[node] += 1

    # Check if keys are somewhat evenly distributed
    for node in nodes:
        # 3k keys expected for each node (10000 keys / 10 nodes * 3 replication)
        assert abs(key_distribution[node] - expected) < tolerance
