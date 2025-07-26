from typing import Sequence
from chromadb.test.conftest import (
    reset,
    skip_if_not_cluster,
)
from chromadb.api import ClientAPI
from kubernetes import client as k8s_client, config
import time


@skip_if_not_cluster()
def test_reroute(
    client: ClientAPI,
) -> None:
    reset(client)
    collection = client.create_collection(
        name="test",
        metadata={"hnsw:construction_ef": 128, "hnsw:search_ef": 128, "hnsw:M": 128},
    )

    ids = [str(i) for i in range(10)]
    embeddings: list[Sequence[float]] = [
        [float(i), float(i), float(i)] for i in range(10)
    ]
    collection.add(ids=ids, embeddings=embeddings)
    collection.query(query_embeddings=[embeddings[0]])

    # Restart the query service using k8s api, in order to trigger a reroute
    # of the query service
    config.load_kube_config()
    v1 = k8s_client.CoreV1Api()
    # Find all pods with the label "app=query"
    res = v1.list_namespaced_pod("chroma", label_selector="app=query-service")
    assert len(res.items) > 0
    items = res.items
    seen_ids = set()

    # Restart all the pods by deleting them
    for item in items:
        seen_ids.add(item.metadata.uid)
        name = item.metadata.name
        namespace = item.metadata.namespace
        v1.delete_namespaced_pod(name, namespace)

    # Wait until we have len(seen_ids) pods running with new UIDs
    timeout_secs = 10
    start_time = time.time()
    while True:
        res = v1.list_namespaced_pod("chroma", label_selector="app=query-service")
        items = res.items
        new_ids = set([item.metadata.uid for item in items])
        if len(new_ids) == len(seen_ids) and len(new_ids.intersection(seen_ids)) == 0:
            break
        if time.time() - start_time > timeout_secs:
            assert False, "Timed out waiting for new pods to start"
        time.sleep(1)

    # Wait for the query service to be ready, or timeout
    while True:
        res = v1.list_namespaced_pod("chroma", label_selector="app=query-service")
        items = res.items
        ready = True
        for item in items:
            if item.status.phase != "Running":
                ready = False
                break
        if ready:
            break
        if time.time() - start_time > timeout_secs:
            assert False, "Timed out waiting for new pods to be ready"
        time.sleep(1)

    time.sleep(1)
    collection.query(query_embeddings=[embeddings[0]])
