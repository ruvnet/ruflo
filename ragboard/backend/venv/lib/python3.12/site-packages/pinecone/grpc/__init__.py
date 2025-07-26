"""
Connecting to Pinecone with GRPC

The `pinecone.grpc` submodule provides an alternative version of the Pinecone 
client that uses gRPC instead of HTTP for data operations. This provides a 
significant performance boost for data operations.

### Installing the gRPC client

You must install extra dependencies in order to install the GRPC client.

#### Installing with pip

```bash
# Install the latest version
pip3 install pinecone-client[grpc]

# Install a specific version
pip3 install "pinecone-client[grpc]"==3.0.0
```

#### Installing with poetry

```bash
# Install the latest version
poetry add pinecone-client --extras grpc

# Install a specific version
poetry add pinecone-client==3.0.0 --extras grpc
```

### Using the gRPC client

```python
import os
from pinecone.grpc import PineconeGRPC

client = PineconeGRPC(api_key=os.environ.get("PINECONE_API_KEY"))

# From this point on, usage is identical to the HTTP client.
index = client.Index(host=os.environ("PINECONE_INDEX_HOST"))
index.query(vector=[...], top_k=10)
```

"""

from .index_grpc import GRPCIndex
from .pinecone import PineconeGRPC

from pinecone.core.grpc.protos.vector_service_pb2 import (
    Vector as GRPCVector,
    SparseValues as GRPCSparseValues,
    Vector,
    SparseValues
)