# Add up to 200k records until the log-is-full message is seen.

import grpc
import math
import random
import time

import numpy as np

from chromadb.api import ClientAPI
from chromadb.proto.logservice_pb2 import SealLogRequest, MigrateLogRequest
from chromadb.proto.logservice_pb2_grpc import LogServiceStub
from chromadb.test.conftest import (
    reset,
    skip_if_not_cluster,
)
from chromadb.test.property import invariants
from chromadb.test.utils.wait_for_version_increase import wait_for_version_increase

RECORDS = 2000000
BATCH_SIZE = 100

@skip_if_not_cluster()
def test_log_backpressure(
    client: ClientAPI,
) -> None:
    seed = time.time()
    random.seed(seed)
    print("Generating data with seed ", seed)
    reset(client)
    collection = client.create_collection(
        name="test",
        metadata={"hnsw:construction_ef": 128, "hnsw:search_ef": 128, "hnsw:M": 128},
    )

    time.sleep(1)

    print('backpressuring for', collection.id)

    excepted = False
    try:
        # Add RECORDS records, where each embedding has 3 dimensions randomly generated between 0 and 1
        for i in range(0, RECORDS, BATCH_SIZE):
            ids = []
            embeddings = []
            ids.extend([str(x) for x in range(i, i + BATCH_SIZE)])
            embeddings.extend([np.random.rand(1, 3)[0] for x in range(i, i + BATCH_SIZE)])
            collection.add(ids=ids, embeddings=embeddings)
    except Exception as x:
        print(f"Caught exception:\n{x}")
        if 'log needs compaction' in str(x):
            excepted = True
    assert excepted, "Expected an exception to be thrown."
